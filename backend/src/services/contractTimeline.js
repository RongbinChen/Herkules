// Turn linked contracts into suggested follow-up milestones.
//
// The summary is the fast path: it is already cached, and for a contract whose
// payment line says "20% within 15 days of signing" that is the whole answer.
// When the summary does not pin a single date down, a focused ask over the
// payment / letter-of-credit / delivery pages fills the gap, and that answer
// is cached on the file the same way the summary is. Either way the caller
// gets proposals. Nothing is written onto a follow-up here.
import { prisma } from '../index.js';
import { askDgx, DgxOfflineError } from './contractQa.js';
import { summariseContractFile } from './contractSummary.js';
import {
  TIMELINE_PROMPT_VERSION, TIMELINE_VERSION,
  assembleProposals, clausesForDocument, detectDeliveryStart, lcClausesFromText,
  mergeClauses, milestoneDay, parseTimelineAnswer, pickTimelinePages,
  planAnchorShift, summaryTimelineEnough, timelineFromSummary, timelinePrompt,
} from './contractTimelineFormat.js';
import { MILESTONE_BY_KIND } from './followUps.js';

export { DgxOfflineError };

async function selectTimelinePages(fileId) {
  const rows = await prisma.contractPage.findMany({
    where: { fileId, text: { not: '' } },
    select: { pageNo: true, text: true, fileId: true, file: { select: { filename: true } } },
    orderBy: { pageNo: 'asc' },
  });
  const pages = rows.map((r) => ({
    pageNo: r.pageNo, text: r.text, fileId: r.fileId, filename: r.file.filename,
  }));
  return pickTimelinePages(pages);
}

// The delivery-start choice lives on the same JSON document as the cached
// DGX answer. Rewriting the cache (a reader bump, a fresh ask) must not
// forget which basis a person chose for this file.
function keepDeliveryChoice(prev, payload) {
  if (!prev || typeof prev !== 'object' || Array.isArray(prev)) return payload;
  if (prev.deliveryStart !== 'SIGNED' && prev.deliveryStart !== 'PAYMENT_DOWN') return payload;
  return {
    ...payload,
    deliveryStart: prev.deliveryStart,
    deliveryStartSource: prev.deliveryStartSource === 'contract' ? 'contract' : 'manual',
  };
}

export function storedDeliveryChoice(files) {
  const manuals = [];
  for (const file of files || []) {
    if (file.docType !== 'COMMERCIAL') continue;
    const t = file.timeline;
    if (t?.deliveryStartSource === 'manual'
      && (t.deliveryStart === 'SIGNED' || t.deliveryStart === 'PAYMENT_DOWN')) {
      manuals.push(t.deliveryStart);
    }
  }
  const unique = [...new Set(manuals)];
  return unique.length === 1 ? unique[0] : null;
}

async function rememberDeliveryStart(files, rule) {
  if (rule !== 'SIGNED' && rule !== 'PAYMENT_DOWN') return;
  for (const file of files) {
    if (file.docType !== 'COMMERCIAL') continue;
    const prev = file.timeline && typeof file.timeline === 'object' && !Array.isArray(file.timeline)
      ? file.timeline
      : {};
    const timeline = { ...prev, deliveryStart: rule, deliveryStartSource: 'manual' };
    await prisma.contractFile.update({ where: { id: file.id }, data: { timeline } });
    file.timeline = timeline;
  }
}

async function commercialPageText(file) {
  if (file.docType !== 'COMMERCIAL' || file.ocrStatus !== 'DONE') return '';
  const pages = await selectTimelinePages(file.id);
  return pages.map((p) => p.text).join('\n');
}

async function timelineFromDgx(file, { refresh = false } = {}) {
  const cached = file.timeline;
  const samePrompt = cached?.promptVersion === TIMELINE_PROMPT_VERSION;
  if (!refresh && cached && cached.version === TIMELINE_VERSION && samePrompt && Array.isArray(cached.clauses)) {
    return { clauses: cached.clauses, cached: true };
  }
  // The prompt did not change, only the reader. Re-parse the stored answer
  // instead of spending another GPU minute to hear the same sentences.
  if (!refresh && samePrompt && cached?.raw) {
    const clauses = parseTimelineAnswer(cached.raw);
    const payload = keepDeliveryChoice(cached, {
      ...cached, clauses, version: TIMELINE_VERSION, promptVersion: TIMELINE_PROMPT_VERSION, docType: file.docType,
    });
    await prisma.contractFile.update({ where: { id: file.id }, data: { timeline: payload } }).catch((err) => {
      console.error('[timeline] cache rewrite failed:', err.message);
    });
    return { clauses, cached: true };
  }
  if (file.ocrStatus !== 'DONE') return { clauses: [], reason: 'not-read' };

  const sent = await selectTimelinePages(file.id);
  if (!sent.length) return { clauses: [], reason: 'no-readable-pages' };

  const answer = await askDgx({
    question: timelinePrompt(file.docType),
    pages: sent.map((p) => ({ filename: p.filename, pageNo: p.pageNo, text: p.text })),
  });
  const clauses = parseTimelineAnswer(answer);
  const payload = keepDeliveryChoice(file.timeline, {
    version: TIMELINE_VERSION,
    promptVersion: TIMELINE_PROMPT_VERSION,
    docType: file.docType,
    raw: answer,
    clauses,
    pages: sent.map((p) => p.pageNo),
  });
  await prisma.contractFile.update({
    where: { id: file.id },
    data: { timeline: payload, timelineAt: new Date() },
  }).catch((err) => {
    console.error('[timeline] cache write failed:', err.message);
  });
  return { clauses, cached: false };
}

function tag(clauses, file, via) {
  return (clauses || []).map((c) => ({
    ...c,
    fileId: file.id,
    filename: file.filename,
    docType: file.docType,
    via,
  }));
}

/**
 * Proposals for the given files, already scoped to one unlocked team by the
 * caller. Money amounts are stripped from notes: a milestone note is visible
 * to every logged-in user, and the price is not.
 *
 * `deliveryStart`, when SIGNED or PAYMENT_DOWN, is a person's choice for a
 * contract that did not name one. It is stored on each commercial file so the
 * next read of that order uses the same basis. The text's own reading is used
 * when no choice has been stored.
 */
export async function suggestTimelineForFiles({
  fileIds, team, today, refresh = false, deliveryStart = null, rememberChoice = false,
}) {
  const ids = [...new Set((fileIds || []).map(Number).filter(Boolean))].slice(0, 8);
  if (!ids.length) {
    return {
      proposals: [], sources: [], baseDate: null,
      deliveryStart: { rule: null, detected: null, source: null, ambiguous: false, evidence: null },
    };
  }

  const files = await prisma.contractFile.findMany({
    where: { id: { in: ids }, team },
    select: {
      id: true, filename: true, docType: true, note: true,
      ocrStatus: true, summary: true, timeline: true,
    },
  });
  files.sort((a, b) => (a.docType === 'COMMERCIAL' ? 0 : 1) - (b.docType === 'COMMERCIAL' ? 0 : 1) || a.id - b.id);

  const requested = deliveryStart === 'SIGNED' || deliveryStart === 'PAYMENT_DOWN' ? deliveryStart : null;
  if (rememberChoice && requested) await rememberDeliveryStart(files, requested);
  const manual = requested || storedDeliveryChoice(files);

  const sources = [];
  const groups = [];
  for (const file of files) {
    let summary = null;
    let offline = false;
    try {
      summary = await summariseContractFile({ fileId: file.id, team });
    } catch (err) {
      offline = err instanceof DgxOfflineError || err?.name === 'DgxOfflineError';
      sources.push({
        fileId: file.id, filename: file.filename, docType: file.docType,
        ok: false, reason: offline ? 'dgx-offline' : 'failed', via: null, cached: false,
      });
    }

    const fromSummary = timelineFromSummary(summary?.fields);
    const clauses = [...tag(fromSummary, file, 'summary')];
    let via = 'summary';
    let cached = summary?.cached === true;
    let reason = summary?.reason || null;

    const thin = !summaryTimelineEnough(fromSummary);
    if (thin && !offline && file.ocrStatus === 'DONE') {
      try {
        const extracted = await timelineFromDgx(file, { refresh });
        if (extracted.clauses?.length) {
          // DGX first so an equally specific summary line does not cover it.
          // Letter-of-credit lines from a technical file are removed later,
          // when the groups are assembled.
          clauses.unshift(...tag(extracted.clauses, file, extracted.cached ? 'dgx-cache' : 'dgx'));
          via = extracted.cached ? 'dgx-cache' : 'dgx';
          cached = extracted.cached === true;
          reason = extracted.reason || null;
        } else if (extracted.reason) {
          reason = extracted.reason;
        }
      } catch (err) {
        const dgxOff = err instanceof DgxOfflineError || err?.name === 'DgxOfflineError';
        reason = dgxOff ? 'dgx-offline' : 'failed';
        via = fromSummary.length ? 'summary' : null;
      }
    }

    const pageText = await commercialPageText(file);
    if (pageText) clauses.push(...tag(lcClausesFromText(pageText), file, 'pages'));

    groups.push({
      docType: file.docType,
      fileId: file.id,
      filename: file.filename,
      clauses: clausesForDocument(clauses, file.docType),
    });
    if (!sources.some((s) => s.fileId === file.id)) {
      sources.push({
        fileId: file.id, filename: file.filename, docType: file.docType,
        ok: !reason, reason, via, cached,
      });
    }
  }

  const assembled = assembleProposals(groups, { today, deliveryStart: manual });
  const base = assembled.proposals.find((p) => p.kind === 'CONTRACT_SIGNED' && p.dueDate);
  return {
    proposals: assembled.proposals,
    sources,
    baseDate: base?.dueDate || null,
    deliveryStart: assembled.deliveryStart,
  };
}

function anchorOptions(rule, source, signedDate, paymentDate) {
  return {
    deliveryStart: rule || null,
    deliveryStartSource: source === 'manual' ? 'manual' : null,
    signedDate: signedDate || null,
    paymentDate: paymentDate || null,
  };
}

// A stored choice that repeats what the text already says must not be applied
// as an override: that rewrite would flatten "after effectiveness" into
// "after the down payment" and drop a gap the contract wrote between them.
function manualOverride(stored, detectedRule) {
  if (stored !== 'SIGNED' && stored !== 'PAYMENT_DOWN') return null;
  if (stored === detectedRule) return null;
  return stored;
}

/**
 * Recompute milestone dates after a confirmed anchor moves.
 *
 * The down-payment date on the record is the receipt the person confirmed,
 * not the contractual expectation. Delivery, later payments and anything
 * counted from them follow this contract's start rule: from signing they stay
 * put when the receipt moves; from the down payment they move with it. A
 * signature correction moves what the text counts from signing, including a
 * down payment that is still just "N days after signing" and has not been
 * ticked off.
 *
 * Cached summary and timeline text only — confirming a date must not start
 * another GPU read.
 */
export async function shiftFollowUpMilestones(followUpId, change = {}) {
  const followUp = await prisma.projectFollowUp.findUnique({
    where: { id: followUpId },
    include: {
      milestones: true,
      contractFiles: {
        select: { id: true, docType: true, filename: true, ocrStatus: true, summary: true, timeline: true },
      },
    },
  });
  if (!followUp) return [];

  const groups = [];
  for (const file of followUp.contractFiles) {
    const pageText = await commercialPageText(file);
    const cached = Array.isArray(file.timeline?.clauses) ? file.timeline.clauses : [];
    groups.push({
      docType: file.docType,
      fileId: file.id,
      filename: file.filename,
      clauses: clausesForDocument([
        ...cached,
        ...timelineFromSummary(file.summary?.fields),
        ...lcClausesFromText(pageText),
      ], file.docType),
    });
  }

  const collected = [];
  for (const g of groups) {
    collected.push(...(g.clauses || []).map((c) => ({ ...c, docType: c.docType || g.docType })));
  }
  const clauses = mergeClauses(collected);
  const detected = detectDeliveryStart(clauses.filter((c) => c.docType === 'COMMERCIAL'));
  const stored = storedDeliveryChoice(followUp.contractFiles);
  const moved = change.movedKind;

  const signedStored = milestoneDay(followUp.milestones.find((m) => m.kind === 'CONTRACT_SIGNED')?.dueDate);
  const paymentStored = milestoneDay(followUp.milestones.find((m) => m.kind === 'PAYMENT_DOWN')?.dueDate);
  let previousSigned = signedStored;
  let nextSigned = signedStored;
  let previousPayment = paymentStored;
  let nextPayment = paymentStored;
  if (moved === 'CONTRACT_SIGNED') {
    previousSigned = milestoneDay(change.previousDue);
    nextSigned = milestoneDay(change.nextDue);
  }
  if (moved === 'PAYMENT_DOWN') {
    previousPayment = milestoneDay(change.previousDue);
    nextPayment = milestoneDay(change.nextDue);
  }

  const previousChoice = moved === 'DELIVERY_START' ? (change.previousDeliveryStart || null) : stored;
  const nextChoice = moved === 'DELIVERY_START' ? (change.nextDeliveryStart || null) : stored;
  const previousManual = manualOverride(previousChoice, detected.rule);
  const nextManual = manualOverride(nextChoice, detected.rule);

  const plan = planAnchorShift({
    clauses,
    existing: followUp.milestones,
    movedKind: moved,
    before: anchorOptions(previousManual || detected.rule, previousManual ? 'manual' : null, previousSigned, previousPayment),
    after: anchorOptions(nextManual || detected.rule, nextManual ? 'manual' : null, nextSigned, nextPayment),
  });

  for (const step of plan) {
    const dueDate = step.dueDate ? new Date(`${step.dueDate}T00:00:00.000Z`) : null;
    if (step.action === 'create') {
      await prisma.followUpMilestone.create({
        data: {
          followUpId,
          kind: step.kind,
          dueDate,
          remindDaysBefore: MILESTONE_BY_KIND.get(step.kind)?.lead ?? [14, 7, 1],
          lastRemindedOn: null,
        },
      });
    } else if (step.id) {
      await prisma.followUpMilestone.update({
        where: { id: step.id },
        data: { dueDate, lastRemindedOn: null },
      });
    }
  }
  return plan.map(({ kind, dueDate: day, action }) => ({ kind, dueDate: day, action }));
}
