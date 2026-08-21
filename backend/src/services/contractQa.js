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
// How many pages we send to the model. Few on purpose: retrieval was measured
// as the bottleneck, not the model — 3 pages answered in 24s where 16 took 45s
// — and a wall of pages both slows the answer and dilutes it.
const MAX_PAGES = Number(process.env.CONTRACT_QA_MAX_PAGES || 5);
// At most this many pages from any single file, so one long technical appendix
// cannot crowd out the commercial contract that actually holds the price.
const MAX_PAGES_PER_FILE = 3;

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
  const { pages: chosen, terms } = rankPages(pages, question, {
    maxPages, maxPerFile: MAX_PAGES_PER_FILE,
  });
  return { pages: chosen, candidatePages: pages.length, terms };
}

// Hand the located pages to the DGX and get an answer read off the original
// images. The stored token authenticates the VPS to the worker; the worker only
// accepts this on the loopback port the tunnel lands on.
export async function askDgx({ question, pages }) {
  const token = process.env.OCR_TOKEN;
  if (!token || token.length < 16) {
    throw new DgxOfflineError('contract Q&A is not configured');
  }
  let res;
  try {
    res = await fetch(ASK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Ocr-Token': token },
      body: JSON.stringify({ question, pages }),
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
export async function answerContractQuestion({ customerId, team, question }) {
  const { pages, candidatePages, terms } = await retrievePages({ customerId, team, question });

  if (candidatePages === 0) {
    return { answer: null, reason: 'no-readable-pages', sources: [], candidatePages: 0, terms };
  }
  if (pages.length === 0) {
    return { answer: null, reason: 'no-match', sources: [], candidatePages, terms };
  }

  const answer = await askDgx({ question, pages });
  // The sources are exactly the pages we sent — the model answered from these
  // and nothing else, so this is an honest "where it came from", openable in the
  // UI by downloading the file.
  const sources = pages.map((p) => ({ fileId: p.fileId, filename: p.filename, pageNo: p.pageNo, snippet: p.snippet }));
  return { answer, reason: null, sources, candidatePages, terms };
}
