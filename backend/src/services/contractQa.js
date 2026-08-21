// Contract Q&A — answer a question about one customer's contract files.
//
// Two-step by design (see the memory note "contract-qa-design"):
//
//   1. LOCATE with text. The scanned pages were transcribed to ContractPage
//      rows; a cheap keyword score over that text picks the handful of pages
//      most likely to hold the answer. This runs in SQL/JS on the VPS and never
//      touches the GPU.
//
//   2. ANSWER from the original image. Transcription loses layout — a value can
//      land in the wrong column of a spec table — so the model does NOT answer
//      from the text. The VPS hands the DGX the page coordinates; the DGX
//      re-renders those exact pages from its local PDF copy and feeds the images
//      to the vision model. Text finds the page, the picture answers.
//
// The DGX is reached through the reverse SSH tunnel the OCR worker already
// holds open (127.0.0.1:9099). When that tunnel is down — DGX off, rebooting —
// this fails loudly with DgxOfflineError rather than falling back to answering
// from the lossy text, which is exactly the path that misreads a spec table.
import { prisma } from '../index.js';
import { rankPages } from './contractRetrieval.js';

// Reached over the reverse tunnel; loopback on the VPS lands on the DGX worker.
const ASK_URL = process.env.DGX_ASK_URL || 'http://127.0.0.1:9099/ask';
// The vision model can take tens of seconds per page plus generation. Generous,
// but bounded: a hung DGX must not hold the request open forever.
const ASK_TIMEOUT_MS = Number(process.env.DGX_ASK_TIMEOUT_MS || 150000);
// How many keyword-hit pages ("seeds") to keep before neighbour expansion. A
// customer may have several contracts (versions, or one per machine), and the
// answer might legitimately differ between them, so this is not tiny.
const MAX_PAGES = Number(process.env.CONTRACT_QA_MAX_PAGES || 6);
// At most this many seeds from any single file, so one long technical appendix
// cannot crowd out the commercial contract that actually holds the price.
const MAX_PAGES_PER_FILE = 3;
// Pages either side of a seed to include for context (same file only).
const NEIGHBOUR_WINDOW = Number(process.env.CONTRACT_QA_NEIGHBOURS || 1);
// Hard ceiling on pages of text sent to the model, after expansion. Enough to
// carry two contracts' price sections; small enough to stay fast (~20s) and
// well under the VPS's 60s proxy timeout.
const MAX_SENT_PAGES = Number(process.env.CONTRACT_QA_SENT_PAGES || 12);

export class DgxOfflineError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DgxOfflineError';
  }
}

// Score every readable page of this customer's files against the question and
// return the top pages. Team-scoped: the where clause is anchored on the unlock
// token's team, never on anything the caller sent.
export async function retrievePages({ customerId, team, question, maxPages = MAX_PAGES }) {
  const rows = await prisma.contractPage.findMany({
    where: {
      file: { customerId, team, ocrStatus: 'DONE' },
      // A blank page has nothing to match and nothing to answer from.
      text: { not: '' },
    },
    select: {
      pageNo: true,
      text: true,
      fileId: true,
      file: { select: { filename: true, storedName: true } },
    },
  });
  // Flatten the file relation so the pure ranker takes a plain shape.
  const pages = rows.map((r) => ({
    pageNo: r.pageNo, text: r.text, fileId: r.fileId,
    filename: r.file.filename, storedName: r.file.storedName,
  }));
  const { pages: seeds, terms } = rankPages(pages, question, {
    maxPages, maxPerFile: MAX_PAGES_PER_FILE,
  });

  // Neighbour expansion. A contract states the total on one page and pays it out
  // over the next few, so the answer often sits a page either side of the keyword
  // hit. Since we answer from cheap text, not a rendered image, widening by ±1
  // costs almost nothing and lets the model see "总价为 X" next to "80% = Y".
  const byFile = new Map();
  for (const p of pages) {
    if (!byFile.has(p.fileId)) byFile.set(p.fileId, new Map());
    byFile.get(p.fileId).set(p.pageNo, p);
  }
  const picked = new Map(); // `${fileId}:${pageNo}` → page, deduped
  for (const s of seeds) {
    const fm = byFile.get(s.fileId);
    for (let d = -NEIGHBOUR_WINDOW; d <= NEIGHBOUR_WINDOW; d++) {
      const pg = fm.get(s.pageNo + d);
      if (pg) picked.set(`${pg.fileId}:${pg.pageNo}`, pg);
    }
  }
  const sent = [...picked.values()]
    .sort((a, b) => a.fileId - b.fileId || a.pageNo - b.pageNo)
    .slice(0, MAX_SENT_PAGES);

  return { seeds, sent, candidatePages: pages.length, terms };
}

// Hand the located pages to the DGX and get an answer read off the original
// images. The stored token authenticates the VPS to the worker; the worker only
// accepts this on the loopback port the tunnel lands on.
export async function askDgx({ question, pages, history = [], files = [] }) {
  const token = process.env.OCR_TOKEN;
  if (!token || token.length < 16) {
    throw new DgxOfflineError('contract Q&A is not configured');
  }
  let res;
  try {
    res = await fetch(ASK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Ocr-Token': token },
      body: JSON.stringify({ question, pages, history, files }),
      signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
    });
  } catch (err) {
    // Timeout, tunnel down, DGX asleep — all the same to the user: the local
    // model cannot be reached right now. We do NOT answer from the text instead.
    throw new DgxOfflineError(`local model unreachable (${err.name})`);
  }
  if (res.status === 503) throw new DgxOfflineError('local model is busy or starting up');
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`DGX ask failed: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return String(data.answer || '').trim();
}

// Orchestrate: locate, then answer. Returns a small object the route serialises
// as-is. `reason` is set (and `answer` null) for the states that are not an
// error but still have no answer to give, so the UI can explain them.
export async function answerContractQuestion({ customerId, team, question, history = [] }) {
  // A follow-up often names its subject only through the previous turn ("那第二台
  // 呢", "它的质保期"). Prepend the last question to the RETRIEVAL query so those
  // pages are still found; the answer question itself stays exactly what was
  // asked, and the full history goes to the model for the answer.
  const lastQ = history.length ? String(history[history.length - 1].question || '') : '';
  const retrievalQuery = lastQ ? `${lastQ} ${question}` : question;
  const { seeds, sent, candidatePages, terms } = await retrievePages({ customerId, team, question: retrievalQuery });

  if (candidatePages === 0) {
    return { answer: null, reason: 'no-readable-pages', sources: [], candidatePages: 0, terms };
  }
  if (!sent.length) {
    return { answer: null, reason: 'no-match', sources: [], candidatePages, terms };
  }

  // The DGX gets only what it needs to answer: the page text with its label. It
  // already has the files; it does not need storedName here, and the snippet is
  // for the UI, not the model.
  // The authoritative list of this customer's files (all of them, not only the
  // ones with retrieved pages), so questions like "which files are on record" or
  // "what is X.pdf" are answered from ground truth rather than from whichever
  // pages the keyword search happened to surface. A small file whose text never
  // ranks (e.g. a one-page "Kom. No." sheet) would otherwise look nonexistent.
  const fileRows = await prisma.contractFile.findMany({
    where: { customerId, team },
    select: { filename: true, docType: true, ocrStatus: true },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });

  const answer = await askDgx({
    question,
    history,
    files: fileRows,
    pages: sent.map((p) => ({ filename: p.filename, pageNo: p.pageNo, text: p.text })),
  });

  // Sources are the keyword hits, not every neighbour we sent for context — those
  // are the pages worth citing. filename + page only: the request is to show
  // where it came from, not to offer a download.
  const sources = seeds.map((p) => ({ filename: p.filename, pageNo: p.pageNo, snippet: p.snippet }));
  return { answer, reason: null, sources, candidatePages, terms };
}
