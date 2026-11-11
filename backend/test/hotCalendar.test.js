import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  aliasPatch,
  aliasValidationError,
  chinaDay,
  deriveHotCalendarEvents,
  extractBidOpenDay,
  normalizeAliasInput,
} from '../src/services/hotCalendar.js';

const TODAY = '2026-11-11';

function hot(customer, extra = {}) {
  return { id: extra.id || 1, customer, customerId: extra.customerId || null, closedAt: extra.closedAt || null };
}

function alias(customerName, aliasName, extra = {}) {
  return {
    id: extra.id || 1,
    customerName,
    alias: aliasName,
    confirmed: extra.confirmed !== false,
    customerId: extra.customerId || null,
  };
}

function notice(extra) {
  return {
    id: 1,
    threadKey: '0747-2540SCCSC306',
    projectName: 'Procurement of 0747-2540SCCSC306 CNC gantry',
    projectCode: '0747-2540SCCSC306',
    purchaser: 'Baosteel Group',
    deadline: '2026-11-20',
    bidStage: 'TENDER',
    status: 'PUBLISHED',
    publishDate: '2026-11-01T00:00:00.000Z',
    rawContent: '',
    ...extra,
  };
}

function derive(extra = {}) {
  return deriveHotCalendarEvents({
    today: TODAY,
    hotProjects: [hot('Baosteel')],
    aliases: [alias('Baosteel', 'Baosteel Group')],
    announcements: [notice()],
    trackings: [],
    bidOpenings: [],
    followUps: [],
    ...extra,
  });
}

function kinds(result) {
  return result.events.map((event) => `${event.kind}@${event.day}`);
}

test('china days stay on the Beijing calendar', () => {
  assert.equal(chinaDay('2026-11-10'), '2026-11-10');
  // Date-only deadlines are stored at UTC midnight, which is still the 10th in Shanghai.
  assert.equal(chinaDay(new Date('2026-11-10T00:00:00.000Z')), '2026-11-10');
  // 15:59 UTC is 23:59 in Shanghai; 16:00 UTC is the next morning.
  assert.equal(chinaDay(new Date('2026-11-10T15:59:00.000Z')), '2026-11-10');
  assert.equal(chinaDay(new Date('2026-11-10T16:00:00.000Z')), '2026-11-11');
  assert.equal(extractBidOpenDay('Open-Time of Bids: 2026-11-25 somewhere'), '2026-11-25');
  assert.equal(extractBidOpenDay('开标时间：2026-12-01'), '2026-12-01');
  assert.equal(extractBidOpenDay('no opening here'), null);
});

test('open hot-customer tenders contribute a deadline and, when present, an opening', () => {
  const result = derive({
    announcements: [notice({
      rawContent: 'Deadline for Submitting Bids: 2026-11-20 Open-Time of Bids: 2026-11-25',
    })],
  });
  assert.deepEqual(kinds(result), ['deadline@2026-11-20', 'opening@2026-11-25']);
  assert.equal(result.events[0].title.includes('Baosteel'), true);
  assert.equal(result.events[0].title.includes('CNC gantry'), true);
  assert.equal(result.events[0].detail, 'Bid deadline');
  assert.equal(result.events[0].detailZh, '投标截止');
  assert.equal(result.events[1].detail, 'Bid opening');
  assert.equal(result.events[0].href, '/chinabidding/tracking?q=0747-2540SCCSC306');
  assert.equal(result.events[0].overdue, false);
  assert.equal(result.events[0].color, 'brand');
  assert.equal(result.events[1].color, 'violet');
});

test('a bid-opening record supplies the opening when the notice text has none', () => {
  const result = derive({
    bidOpenings: [{ biddingNo: '0747-2540SCCSC306/02', openDate: '2026-11-26' }],
  });
  assert.deepEqual(kinds(result), ['deadline@2026-11-20', 'opening@2026-11-26']);
});

test('the scraped opening wins over a different bid-opening record, and only one opening is kept', () => {
  const result = derive({
    announcements: [notice({ rawContent: 'Open-Time of Bids: 2026-11-25' })],
    bidOpenings: [{ biddingNo: '0747-2540SCCSC306', openDate: '2026-12-01' }],
  });
  const openings = result.events.filter((event) => event.kind === 'opening');
  assert.equal(openings.length, 1);
  assert.equal(openings[0].day, '2026-11-25');
});

test('an opening record for a different tender is not attached', () => {
  const result = derive({
    bidOpenings: [{ biddingNo: '9999-OTHER', openDate: '2026-11-26' }],
  });
  assert.deepEqual(kinds(result), ['deadline@2026-11-20']);
});

test('exact hot-project name equality is not enough, and unconfirmed aliases do not match', () => {
  const noAlias = derive({ aliases: [] });
  assert.equal(noAlias.events.length, 0);

  const sameWords = derive({
    announcements: [notice({ purchaser: 'Baosteel' })],
    aliases: [],
  });
  assert.equal(sameWords.events.length, 0);

  const pending = derive({
    aliases: [alias('Baosteel', 'Baosteel Group', { confirmed: false })],
  });
  assert.equal(pending.events.length, 0);
});

test('substring aliases do not pull in Waldrich Coburg or INNSE-BERARDI', () => {
  const waldrich = derive({
    hotProjects: [hot('Some Mill')],
    aliases: [alias('Some Mill', 'WALDRICH')],
    announcements: [notice({ purchaser: 'Waldrich Coburg' })],
  });
  assert.equal(waldrich.events.length, 0);

  const innse = derive({
    hotProjects: [hot('Some Mill')],
    aliases: [alias('Some Mill', 'INNSE')],
    announcements: [notice({ purchaser: 'INNSE-BERARDI' })],
  });
  assert.equal(innse.events.length, 0);

  // A confirmed alias still folds legal suffixes, which is the spelling a
  // person would not retype. It does not fold a different company.
  const suffix = derive({
    aliases: [alias('Baosteel', 'Baosteel Group')],
    announcements: [notice({ purchaser: 'Baosteel Group Co., Ltd.' })],
  });
  assert.equal(suffix.events.length, 1);

  const longer = derive({
    aliases: [alias('Baosteel', 'Baosteel')],
    announcements: [notice({ purchaser: 'Baosteel Group' })],
  });
  assert.equal(longer.events.length, 0);
});

test('tenders for customers who are not on an open Hot Project stay off the calendar', () => {
  const result = derive({
    hotProjects: [hot('Baosteel'), hot('Closed Mill', { id: 2, closedAt: '2026-10-01T00:00:00.000Z' })],
    aliases: [
      alias('Baosteel', 'Baosteel Group'),
      alias('Closed Mill', 'Closed Mill Procurement', { id: 2 }),
      alias('Never Hot', 'Never Hot Ltd', { id: 3 }),
    ],
    announcements: [
      notice(),
      notice({
        id: 2,
        threadKey: 'CLOSED-1',
        purchaser: 'Closed Mill Procurement',
        projectName: 'Closed mill tender',
      }),
      notice({
        id: 3,
        threadKey: 'OTHER-1',
        purchaser: 'Never Hot Ltd',
        projectName: 'Someone else',
      }),
    ],
  });
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].threadKey, '0747-2540SCCSC306');
  assert.deepEqual(result.hotCustomers.map((customer) => customer.name), ['Baosteel']);
});

test('awarded, evaluated, cancelled, and finished tracking rows drop off', () => {
  const awarded = derive({ announcements: [notice({ bidStage: 'AWARD', status: 'CLOSED' })] });
  assert.equal(awarded.events.length, 0);

  const evaluated = derive({
    announcements: [
      notice(),
      notice({
        id: 2,
        bidStage: 'EVALUATION',
        publishDate: '2026-11-18T00:00:00.000Z',
        deadline: '2026-12-01',
      }),
    ],
  });
  assert.equal(evaluated.events.length, 0);

  const cancelled = derive({ announcements: [notice({ status: 'CANCELLED' })] });
  assert.equal(cancelled.events.length, 0);

  const lost = derive({
    announcements: [notice()],
    trackings: [{ threadKey: '0747-2540SCCSC306', ourStatus: 'LOST' }],
  });
  assert.equal(lost.events.length, 0);

  for (const ourStatus of ['WON', 'ABANDONED']) {
    const finished = derive({ trackings: [{ threadKey: '0747-2540SCCSC306', ourStatus }] });
    assert.equal(finished.events.length, 0, ourStatus);
  }

  const watching = derive({ trackings: [{ threadKey: '0747-2540SCCSC306', ourStatus: 'WATCHING' }] });
  assert.equal(watching.events.length, 1);
});

test('a change notice moves the deadline and does not leave the old day behind', () => {
  const result = derive({
    announcements: [
      notice({ deadline: '2026-11-20', publishDate: '2026-11-01T00:00:00.000Z' }),
      notice({
        id: 2,
        bidStage: 'CHANGE',
        deadline: '2026-11-28',
        publishDate: '2026-11-08T00:00:00.000Z',
        projectName: 'Procurement of 0747-2540SCCSC306 CNC gantry(1)',
      }),
    ],
  });
  assert.deepEqual(kinds(result), ['deadline@2026-11-28']);
});

test('re-tender keeps the new round only', () => {
  const result = derive({
    announcements: [
      notice({
        bidStage: 'AWARD',
        status: 'CLOSED',
        deadline: '2026-08-01',
        publishDate: '2026-08-20T00:00:00.000Z',
        projectName: 'Procurement of 0747-2540SCCSC306 CNC gantry(1)',
      }),
      notice({
        id: 2,
        bidStage: 'TENDER',
        status: 'PUBLISHED',
        deadline: '2026-12-02',
        publishDate: '2026-11-02T00:00:00.000Z',
        projectName: 'Procurement of 0747-2540SCCSC306 CNC gantry(2)',
      }),
    ],
  });
  assert.deepEqual(kinds(result), ['deadline@2026-12-02']);
});

test('deriving again from a changed deadline does not keep a stale event', () => {
  const first = derive({ announcements: [notice({ deadline: '2026-11-20' })] });
  const second = derive({ announcements: [notice({ deadline: '2026-12-02' })] });
  assert.equal(first.events.some((event) => event.day === '2026-11-20'), true);
  assert.equal(second.events.some((event) => event.day === '2026-11-20'), false);
  assert.deepEqual(kinds(second), ['deadline@2026-12-02']);
  assert.equal(second.events.filter((event) => event.kind === 'deadline').length, 1);
});

test('two tenders on the same day stay two events', () => {
  const result = derive({
    announcements: [
      notice({ deadline: '2026-11-20' }),
      notice({
        id: 2,
        threadKey: '0747-9999OTHER',
        projectName: 'Second mill tender',
        projectCode: '0747-9999OTHER',
        purchaser: 'Baosteel Group',
        deadline: '2026-11-20',
      }),
    ],
  });
  const deadlines = result.events.filter((event) => event.kind === 'deadline');
  assert.equal(deadlines.length, 2);
  assert.equal(new Set(deadlines.map((event) => event.id)).size, 2);
  assert.equal(new Set(deadlines.map((event) => event.threadKey)).size, 2);
  assert.equal(deadlines.every((event) => event.day === '2026-11-20'), true);
});

test('live follow-up milestones are included and completed or closed ones are not', () => {
  const result = derive({
    announcements: [],
    aliases: [],
    followUps: [
      {
        id: 7,
        title: 'Roll grinder WS 180',
        status: 'ACTIVE',
        customerName: 'Baosteel',
        milestones: [
          { kind: 'LC_OPEN_DEADLINE', label: null, dueDate: '2026-11-02', doneAt: null },
          { kind: 'PAYMENT_DOWN', label: 'Down payment received', dueDate: '2026-11-20', doneAt: '2026-11-01T00:00:00.000Z' },
          { kind: 'FAT', label: null, dueDate: new Date('2026-11-30T00:00:00.000Z'), doneAt: null },
          { kind: 'SHIPMENT', label: null, dueDate: new Date('2026-11-30T16:00:00.000Z'), doneAt: null },
        ],
      },
      {
        id: 8,
        title: 'On hold order',
        status: 'ON_HOLD',
        customerName: 'Baosteel',
        milestones: [{ kind: 'FAC', dueDate: '2026-12-01', doneAt: null }],
      },
      {
        id: 9,
        title: 'Finished order',
        status: 'COMPLETED',
        customerName: 'Baosteel',
        milestones: [{ kind: 'LC_OPEN_DEADLINE', dueDate: '2026-11-02', doneAt: null }],
      },
      {
        id: 10,
        title: 'Cancelled order',
        status: 'CANCELLED',
        customerName: 'Baosteel',
        milestones: [{ kind: 'LC_OPEN_DEADLINE', dueDate: '2026-11-02', doneAt: null }],
      },
    ],
  });
  assert.deepEqual(kinds(result), [
    'LC_OPEN_DEADLINE@2026-11-02',
    'FAT@2026-11-30',
    'SHIPMENT@2026-12-01',
    'FAC@2026-12-01',
  ]);
  const lc = result.events[0];
  assert.equal(lc.overdue, true);
  assert.equal(lc.color, 'rose');
  assert.equal(lc.title, 'Baosteel · Roll grinder WS 180');
  assert.equal(lc.detail, 'L/C to be opened by');
  assert.equal(lc.detailZh, '信用证开证截止');
  assert.equal(lc.href, '/followups/7');
  assert.equal(result.events[1].overdue, false);
  assert.equal(result.events[1].day, '2026-11-30');
  assert.equal(result.events.find((event) => event.kind === 'SHIPMENT').day, '2026-12-01');
});

test('a tender and a follow-up on the same day stay stacked as separate events, deadline first', () => {
  const result = derive({
    announcements: [notice({
      deadline: '2026-11-20',
      rawContent: 'Open-Time of Bids: 2026-11-20',
    })],
    followUps: [{
      id: 7,
      title: 'Roll grinder',
      status: 'ACTIVE',
      customerName: 'Baosteel',
      milestones: [{ kind: 'LC_OPEN_DEADLINE', dueDate: '2026-11-20', doneAt: null }],
    }],
  });
  assert.deepEqual(result.events.map((event) => event.source + ':' + event.kind), [
    'tender:deadline',
    'tender:opening',
    'followup:LC_OPEN_DEADLINE',
  ]);
  assert.equal(new Set(result.events.map((event) => event.id)).size, 3);
});

test('an overdue bid deadline is still listed while the tender is open', () => {
  const result = derive({ announcements: [notice({ deadline: '2026-11-01' })] });
  assert.equal(result.events[0].day, '2026-11-01');
  assert.equal(result.events[0].overdue, true);
  assert.equal(result.events[0].color, 'rose');
});

test('alias edits withdraw confirmation when the names change and keep it for a note', () => {
  const existing = { customerName: 'Baosteel', alias: 'Baosteel Group', customerId: 4, confirmed: true };
  const noteOnly = aliasPatch(existing, normalizeAliasInput({
    customerName: 'Baosteel',
    alias: 'Baosteel Group',
    customerId: 4,
    note: 'as printed on the notice',
  }));
  assert.equal(noteOnly.note, 'as printed on the notice');
  assert.equal(Object.hasOwn(noteOnly, 'confirmed'), false);

  const renamed = aliasPatch(existing, normalizeAliasInput({
    customerName: 'Baosteel',
    alias: 'Baosteel Co',
    customerId: 4,
  }));
  assert.equal(renamed.confirmed, false);
  assert.equal(renamed.confirmedAt, null);
  assert.equal(renamed.confirmedById, null);

  const duplicate = aliasValidationError(
    normalizeAliasInput({ customerName: 'Baosteel', alias: 'Baosteel Group Co., Ltd.' }),
    [{ id: 1, customerName: 'Baosteel', alias: 'Baosteel Group' }],
  );
  assert.equal(duplicate, 'That alias is already on this customer');
  assert.equal(aliasValidationError(normalizeAliasInput({ customerName: 'A', alias: 'Baosteel' })), 'Customer name is too short');
});

test('calendar routes are registered before the :id detail route', () => {
  const src = readFileSync(new URL('../src/routes/hotProjects.js', import.meta.url), 'utf8');
  const calendar = src.indexOf("router.get('/calendar'");
  const aliases = src.indexOf("router.post('/aliases'");
  const detail = src.indexOf("router.get('/:id'");
  assert.ok(calendar > 0 && calendar < detail);
  assert.ok(aliases > 0 && aliases < detail);
});
