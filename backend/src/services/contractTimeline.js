// Turn linked contracts into suggested follow-up milestones.
//
// The summary is the fast path when it already states a clock. A one-line
// payment blurb is not that. Commercial pages are read on every pass for the
// opening, the presentation window, and which event delivery is counted from,
// and that reading is cached on the file. A model call happens only when the
// pages and the summary still leave one of those clocks unread. Nothing is
// written onto a follow-up here.
import { prisma } from '../index.js';
import { askDgx, DgxOfflineError } from './contractQa.js';
import { summariseContractFile } from './contractSummary.js';
import {
  TIMELINE_PROMPT_VERSION, TIMELINE_VERSION,
  assembleProposals, clausesForDocument, commercialClausesFromText,
  commercialReadingIncomplete, detectDeliveryStart, executionClausesFromText,
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

// Every readable page, not the short list sent to the model. A letter of
// credit opening can sit on a page the ranker would not have kept, and the
// reader below is a scan, not a prompt.
async function pageTextFor(file) {
  if (!file || file.ocrStatus !== 'DONE') return '';
  const rows = await prisma.contractPage.findMany({
    where: { fileId: file.id, text: { not: '' } },
    select: { text: true },
    orderBy: { pageNo: 'asc' },
  });
  return rows.map((r) => r.text).join('\n');
}

function summaryBlob(summary) {
  const fields = summary?.fields;
  if (!Array.isArray(fields)) return '';
  return fields.map((f) => (f && f.value) || '').filter(Boolean).join('\n');
}

// The detected start is part of the cached timeline, next to any model
// answer already stored. A choice a person made is left as they made it.
async function persistCommercialReading(file, pageClauses, rule) {
  if (!file || file.docType !== 'COMMERCIAL' || !pageClauses?.length) return;
  const prev = file.timeline && typeof file.timeline === 'object' && !Array.isArray(file.timeline)
    ? file.timeline
    : {};
  const manual = prev.deliveryStartSource === 'manual'
    && (prev.deliveryStart === 'SIGNED' || prev.deliveryStart === 'PAYMENT_DOWN');
  const merged = mergeClauses([
    ...(Array.isArray(prev.clauses) ? prev.clauses : []).map((c) => ({ ...c, docType: 'COMMERCIAL' })),
    ...pageClauses.map((c) => ({ ...c, docType: 'COMMERCIAL' })),
  ]);
  const payload = {
    ...prev,
    version: prev.version || TIMELINE_VERSION,
    promptVersion: prev.promptVersion || TIMELINE_PROMPT_VERSION,
    docType: 'COMMERCIAL',
    clauses: merged,
    pageRead: true,
    deliveryStart: manual ? prev.deliveryStart : (rule || prev.deliveryStart || null),
    deliveryStartSource: manual ? 'manual' : (rule ? 'contract' : (prev.deliveryStartSource || null)),
  };
  await prisma.contractFile.update({
    where: { id: file.id },
    data: { timeline: payload, timelineAt: new Date() },
  }).catch((err) => {
    console.error('[timeline] page reading cache failed:', err.message);
  });
  file.timeline = payload;
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
      proposals: [], conditional: [], sources: [], baseDate: null,
      deliveryStart: { rule: null, detected: null, source: null, ambiguous: false, evidence: null, effectiveZh: null },
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
  const readings = [];
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
    let via = fromSummary.length ? 'summary' : null;
    let cached = summary?.cached === true;
    let reason = summary?.reason || null;

    // Pages first. A coarse payment line is not a timeline, and it must not
    // be what decides that the commercial file has already been read.
    const pageText = await pageTextFor(file);
    const parsed = file.docType === 'COMMERCIAL'
      ? commercialClausesFromText(pageText)
      : { clauses: executionClausesFromText(pageText), conditional: [] };
    const pageClauses = parsed.clauses || [];
    if (pageClauses.length) {
      clauses.push(...tag(pageClauses, file, 'pages'));
      via = 'pages';
    }
    readings.push({ file, pageClauses });

    const summaryThin = !summaryTimelineEnough(fromSummary);
    const pagesMissed = file.docType === 'COMMERCIAL' && commercialReadingIncomplete(
      [...fromSummary, ...pageClauses],
      pageText || summaryBlob(summary),
    );
    const needModel = !offline && file.ocrStatus === 'DONE' && (pagesMissed || (summaryThin && !pageClauses.length));
    if (needModel) {
      try {
        const extracted = await timelineFromDgx(file, { refresh });
        if (extracted.clauses?.length) {
          // DGX first so an equally specific summary line does not cover it.
          // Letter-of-credit lines from a technical file are removed later,
          // when the groups are assembled. Page clauses stay after it and
          // win where the page reader is the stricter source.
          clauses.unshift(...tag(extracted.clauses, file, extracted.cached ? 'dgx-cache' : 'dgx'));
          if (!pageClauses.length) via = extracted.cached ? 'dgx-cache' : 'dgx';
          cached = extracted.cached === true;
          reason = extracted.reason || null;
        } else if (extracted.reason) {
          reason = extracted.reason;
        }
      } catch (err) {
        const dgxOff = err instanceof DgxOfflineError || err?.name === 'DgxOfflineError';
        reason = dgxOff ? 'dgx-offline' : 'failed';
        via = fromSummary.length || pageClauses.length ? (pageClauses.length ? 'pages' : 'summary') : null;
      }
    }

    groups.push({
      docType: file.docType,
      fileId: file.id,
      filename: file.filename,
      clauses: clausesForDocument(clauses, file.docType),
      conditional: file.docType === 'COMMERCIAL' ? (parsed.conditional || []) : [],
    });
    if (!sources.some((s) => s.fileId === file.id)) {
      sources.push({
        fileId: file.id, filename: file.filename, docType: file.docType,
        ok: !reason, reason, via, cached,
      });
    }
  }

  const assembled = assembleProposals(groups, { today, deliveryStart: manual });
  const detectedRule = assembled.deliveryStart?.detected || null;
  for (const reading of readings) {
    await persistCommercialReading(reading.file, reading.pageClauses, detectedRule);
  }
  const base = assembled.proposals.find((p) => p.kind === 'CONTRACT_SIGNED' && p.dueDate);
  return {
    proposals: assembled.proposals,
    conditional: assembled.conditional || [],
    sources,
    baseDate: base?.dueDate || null,
    deliveryStart: assembled.deliveryStart,
  };
}

function anchorOptions(rule, source, dates) {
  return {
    deliveryStart: rule || null,
    deliveryStartSource: source === 'manual' ? 'manual' : null,
    signedDate: dates.signedDate || null,
    paymentDate: dates.paymentDate || null,
    shipmentDate: dates.shipmentDate || null,
    latestShipmentDate: dates.latestShipmentDate || null,
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
    const pageText = await pageTextFor(file);
    const parsed = file.docType === 'COMMERCIAL'
      ? commercialClausesFromText(pageText)
      : { clauses: executionClausesFromText(pageText) };
    const cached = Array.isArray(file.timeline?.clauses) ? file.timeline.clauses : [];
    groups.push({
      docType: file.docType,
      fileId: file.id,
      filename: file.filename,
      clauses: clausesForDocument([
        ...cached,
        ...timelineFromSummary(file.summary?.fields),
        ...(parsed.clauses || []),
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
  const shipmentStored = milestoneDay(followUp.milestones.find((m) => m.kind === 'SHIPMENT')?.dueDate);
  const latestStored = milestoneDay(followUp.milestones.find((m) => m.kind === 'LC_LATEST_SHIPMENT')?.dueDate);
  let previousSigned = signedStored;
  let nextSigned = signedStored;
  let previousPayment = paymentStored;
  let nextPayment = paymentStored;
  let previousShipment = shipmentStored;
  let nextShipment = shipmentStored;
  let previousLatest = latestStored;
  let nextLatest = latestStored;
  if (moved === 'CONTRACT_SIGNED') {
    previousSigned = milestoneDay(change.previousDue);
    nextSigned = milestoneDay(change.nextDue);
  }
  if (moved === 'PAYMENT_DOWN') {
    previousPayment = milestoneDay(change.previousDue);
    nextPayment = milestoneDay(change.nextDue);
  }
  if (moved === 'SHIPMENT') {
    previousShipment = milestoneDay(change.previousDue);
    nextShipment = milestoneDay(change.nextDue);
  }
  if (moved === 'LC_LATEST_SHIPMENT') {
    previousLatest = milestoneDay(change.previousDue);
    nextLatest = milestoneDay(change.nextDue);
  }

  const previousChoice = moved === 'DELIVERY_START' ? (change.previousDeliveryStart || null) : stored;
  const nextChoice = moved === 'DELIVERY_START' ? (change.nextDeliveryStart || null) : stored;
  const previousManual = manualOverride(previousChoice, detected.rule);
  const nextManual = manualOverride(nextChoice, detected.rule);
  // Pin a shipment date only when that row is the one that just moved.
  // Pinning it on every save would freeze a delivery that is supposed to
  // follow the down payment.
  const beforeDates = {
    signedDate: previousSigned,
    paymentDate: previousPayment,
    shipmentDate: moved === 'SHIPMENT' ? previousShipment : null,
    latestShipmentDate: moved === 'LC_LATEST_SHIPMENT' ? previousLatest : null,
  };
  const afterDates = {
    signedDate: nextSigned,
    paymentDate: nextPayment,
    shipmentDate: moved === 'SHIPMENT' ? nextShipment : null,
    latestShipmentDate: moved === 'LC_LATEST_SHIPMENT' ? nextLatest : null,
  };

  const plan = planAnchorShift({
    clauses,
    existing: followUp.milestones,
    movedKind: moved,
    before: anchorOptions(previousManual || detected.rule, previousManual ? 'manual' : null, beforeDates),
    after: anchorOptions(nextManual || detected.rule, nextManual ? 'manual' : null, afterDates),
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
