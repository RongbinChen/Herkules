// Key-terms summary for a single contract file.
//
// This is the Q&A path with the question fixed and the scope narrowed from "a
// customer" to "one file": locate pages by keyword over the transcription, hand
// those pages to the local model, read the answer back. Nothing new is asked of
// the DGX — the same /ask endpoint serves it — so this file is prompt, page
// selection, and parsing, and nothing else.
//
// Why fixed fields rather than a free-form précis: a paragraph that says "this
// is a commercial contract for two roll grinders" leaves the reader still
// hunting for the price. The eight headline terms below are what people open
// these files to find, and a fixed shape is also the form a 7B-class model is
// least able to wander away from.
//
// Why a whole-file summary is not a whole-file read: these contracts run to 140
// pages. Feeding all of it would blow the context window, and summarising page
// by page would be a hundred-odd model calls — hours on a GPU that is shared
// with transcription. The headline terms live in the first pages and in the
// clauses that name them, both of which keyword retrieval finds cheaply.
import { prisma } from '../index.js';
import { askDgx, DgxOfflineError } from './contractQa.js';
import {
  komFromNote, NOTE_SOURCE, parseSummary, pickSummaryPages, summaryPrompt, SUMMARY_VERSION,
} from './contractSummaryFormat.js';

export { DgxOfflineError };

// Load one file's readable pages and hand them to the pure picker.
export async function selectSummaryPages(fileId, docType) {
  const rows = await prisma.contractPage.findMany({
    where: { fileId, text: { not: '' } },
    select: { pageNo: true, text: true, fileId: true, file: { select: { filename: true } } },
    orderBy: { pageNo: 'asc' },
  });
  const pages = rows.map((r) => ({
    pageNo: r.pageNo, text: r.text, fileId: r.fileId, filename: r.file.filename,
  }));
  return { sent: pickSummaryPages(pages, docType), candidatePages: pages.length };
}

// Produce (or return the cached) summary for one file. Team-scoped by the
// caller's unlock token, never by anything the client sent.
//
// `reason` is set instead of throwing for the states that are not failures but
// still have nothing to show — an unread file, a file whose pages transcribed
// blank — so the UI can say which one it is.
export async function summariseContractFile({ fileId, team, refresh = false }) {
  const file = await prisma.contractFile.findFirst({
    where: { id: fileId, team },
    select: { id: true, filename: true, docType: true, note: true, ocrStatus: true, summary: true, summaryAt: true },
  });
  if (!file) return null; // caller turns this into a 404

  // A stored summary is only reusable if it was produced by this version of the
  // prompt AND for the type the file is filed under now. Re-categorising a file
  // from commercial to technical changes which questions it should have been
  // asked, so the old answer is not merely stale, it is the wrong questions.
  const reusable = file.summary
    && file.summary.version === SUMMARY_VERSION
    && file.summary.docType === file.docType;
  if (!refresh && reusable) {
    return { ...file.summary, cached: true, summaryAt: file.summaryAt };
  }
  if (file.ocrStatus !== 'DONE') {
    return { fields: [], reason: 'not-read', ocrStatus: file.ocrStatus, cached: false };
  }

  const { sent, candidatePages } = await selectSummaryPages(fileId, file.docType);
  if (!sent.length) {
    return { fields: [], reason: 'no-readable-pages', candidatePages, cached: false };
  }

  const answer = await askDgx({
    question: summaryPrompt(file.docType),
    pages: sent.map((p) => ({ filename: p.filename, pageNo: p.pageNo, text: p.text })),
  });

  const fields = parseSummary(answer, file.docType);

  // Kom. No. is the one field the contract body reliably does not carry; it is
  // written into the note when the file is filed. Falling back to the note is
  // the difference between a permanently empty row and a useful one — but the
  // source says so, because a colleague's typing and the model's reading are
  // not the same kind of evidence and the reader is entitled to tell them apart.
  const kom = fields.find((f) => f.key === 'komNo');
  if (kom && kom.value === '—') {
    const fromNote = komFromNote(file.note);
    if (fromNote) {
      kom.value = fromNote;
      kom.source = NOTE_SOURCE;
    }
  }

  const payload = {
    fields,
    raw: answer,
    version: SUMMARY_VERSION,
    docType: file.docType,
    pages: sent.map((p) => p.pageNo),
    candidatePages,
    reason: null,
  };

  // Cached even when every field came back "—": that is a real answer about
  // this file, and re-running it would cost another minute to learn the same
  // thing. Refresh is there for when the reader disagrees.
  await prisma.contractFile.update({
    where: { id: fileId },
    data: { summary: payload, summaryAt: new Date() },
  });

  return { ...payload, cached: false, summaryAt: new Date() };
}
