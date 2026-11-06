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
  mergeClauses, orderProposals, parseTimelineAnswer, pickTimelinePages,
  redactProposalNotes, resolveTimeline, summaryTimelineEnough, timelineFromSummary,
  timelinePrompt,
} from './contractTimelineFormat.js';

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
    const payload = { ...cached, clauses, version: TIMELINE_VERSION, promptVersion: TIMELINE_PROMPT_VERSION, docType: file.docType };
    await prisma.contractFile.update({ where: { id: file.id }, data: { timeline: payload } }).catch((err) => {
      console.error('[timeline] cache rewrite failed:', err.message);
    });
    return { clauses, cached: true };
  }
  if (file.ocrStatus !== 'DONE') return { clauses: [], reason: 'not-read' };

  const sent = await selectTimelinePages(file.id);
  if (!sent.length) return { clauses: [], reason: 'no-readable-pages' };

  const answer = await askDgx({
    question: timelinePrompt(),
    pages: sent.map((p) => ({ filename: p.filename, pageNo: p.pageNo, text: p.text })),
  });
  const clauses = parseTimelineAnswer(answer);
  const payload = {
    version: TIMELINE_VERSION,
    promptVersion: TIMELINE_PROMPT_VERSION,
    docType: file.docType,
    raw: answer,
    clauses,
    pages: sent.map((p) => p.pageNo),
  };
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
 */
export async function suggestTimelineForFiles({ fileIds, team, today, refresh = false }) {
  const ids = [...new Set((fileIds || []).map(Number).filter(Boolean))].slice(0, 8);
  if (!ids.length) return { proposals: [], sources: [], baseDate: null };

  const files = await prisma.contractFile.findMany({
    where: { id: { in: ids }, team },
    select: {
      id: true, filename: true, docType: true, note: true,
      ocrStatus: true, summary: true, timeline: true,
    },
  });
  files.sort((a, b) => (a.docType === 'COMMERCIAL' ? 0 : 1) - (b.docType === 'COMMERCIAL' ? 0 : 1) || a.id - b.id);

  const sources = [];
  const collected = [];
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
    let clauses = fromSummary;
    let via = 'summary';
    let cached = summary?.cached === true;
    let reason = summary?.reason || null;

    const thin = !summaryTimelineEnough(fromSummary);
    if (thin && !offline && file.ocrStatus === 'DONE') {
      try {
        const extracted = await timelineFromDgx(file, { refresh });
        if (extracted.clauses?.length) {
          clauses = mergeClauses([...tag(extracted.clauses, file, 'dgx'), ...tag(fromSummary, file, 'summary')]);
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

    collected.push(...tag(clauses, file, via));
    if (!sources.some((s) => s.fileId === file.id)) {
      sources.push({
        fileId: file.id, filename: file.filename, docType: file.docType,
        ok: !reason, reason, via, cached,
      });
    }
  }

  const resolved = redactProposalNotes(orderProposals(resolveTimeline(mergeClauses(collected), { today })));
  // Filename is enough to see which file a date came from; the page text stays
  // on the DGX side of the request that produced it.
  const proposals = resolved.map(({ filename, ...rest }) => rest);
  const base = proposals.find((p) => p.kind === 'CONTRACT_SIGNED' && p.dueDate);
  return { proposals, sources, baseDate: base?.dueDate || null };
}
