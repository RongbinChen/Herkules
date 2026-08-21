// Page embeddings for semantic Q&A retrieval.
//
// The GPU (and the embedding model) live on the DGX. The VPS drives everything:
// it sends text to the worker's /embed endpoint and stores the vectors it gets
// back. Text only ever flows VPS → DGX (exactly as /ask already does); the
// worker never reads text back from the VPS, so this adds no way for a stolen
// token to pull transcriptions.
//
// prisma is passed in rather than imported, so the backfill script can run with
// its own client without booting the Express server.

// Reached over the reverse tunnel; loopback on the VPS lands on the DGX worker.
const EMBED_URL = process.env.DGX_EMBED_URL || 'http://127.0.0.1:9099/embed';
const EMBED_MODEL = process.env.EMBED_MODEL || 'bge-m3';
const EMBED_TIMEOUT_MS = Number(process.env.DGX_EMBED_TIMEOUT_MS || 120000);
// bge-m3 truncates long input; a page's topic is in its first ~2k chars anyway.
const EMBED_MAX_CHARS = Number(process.env.EMBED_MAX_CHARS || 2000);

export class EmbedOfflineError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EmbedOfflineError';
  }
}

// Embed one or more texts via the DGX. Returns an array of vectors (one per
// input). Throws EmbedOfflineError when the worker is unreachable, so callers
// can degrade gracefully (retrieval falls back to keywords).
export async function embedViaDgx(texts) {
  const token = process.env.OCR_TOKEN;
  if (!token || token.length < 16) throw new EmbedOfflineError('embedding not configured');
  const input = (Array.isArray(texts) ? texts : [texts]).map((t) => String(t ?? '').slice(0, EMBED_MAX_CHARS));
  let res;
  try {
    res = await fetch(EMBED_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Ocr-Token': token },
      body: JSON.stringify({ input }),
      signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
    });
  } catch (err) {
    throw new EmbedOfflineError(`embed worker unreachable (${err.name})`);
  }
  if (!res.ok) throw new Error(`embed failed: HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data.embeddings)) throw new Error('embed: no embeddings returned');
  return data.embeddings;
}

// Embed the pages of one file that still need it (missing, or embedded by an
// older model). Used right after a file's OCR lands, so new uploads become
// searchable without a manual pass. Best-effort: never throws into the caller.
export async function embedPagesForFile(prisma, fileId, { batch = 32 } = {}) {
  const pages = await prisma.contractPage.findMany({
    where: {
      fileId,
      text: { not: '' },
      OR: [{ embedding: { equals: null } }, { embeddingModel: { not: EMBED_MODEL } }],
    },
    select: { id: true, text: true },
    orderBy: { pageNo: 'asc' },
  });
  return embedRows(prisma, pages, batch);
}

// Backfill every readable page that lacks a current embedding. Returns
// { embedded, remaining }. Bounded by `limit` so a run can be capped.
export async function backfillEmbeddings(prisma, { batch = 32, limit = Infinity, onProgress } = {}) {
  let embedded = 0;
  for (;;) {
    if (embedded >= limit) break;
    const pages = await prisma.contractPage.findMany({
      where: {
        text: { not: '' },
        file: { ocrStatus: 'DONE' },
        OR: [{ embedding: { equals: null } }, { embeddingModel: { not: EMBED_MODEL } }],
      },
      select: { id: true, text: true },
      orderBy: { id: 'asc' },
      take: batch,
    });
    if (!pages.length) break;
    embedded += await embedRows(prisma, pages, batch);
    if (onProgress) onProgress(embedded);
  }
  const remaining = await prisma.contractPage.count({
    where: {
      text: { not: '' },
      file: { ocrStatus: 'DONE' },
      OR: [{ embedding: { equals: null } }, { embeddingModel: { not: EMBED_MODEL } }],
    },
  });
  return { embedded, remaining };
}

// Embed a set of {id, text} rows and store the vectors. Shared by the two above.
async function embedRows(prisma, rows, batch) {
  let done = 0;
  for (let i = 0; i < rows.length; i += batch) {
    const chunk = rows.slice(i, i + batch);
    const vectors = await embedViaDgx(chunk.map((r) => r.text));
    const now = new Date();
    // Sequential updates: the batch is small and this keeps one bad row from
    // failing the whole chunk. A transaction would gain nothing at this size.
    await Promise.all(chunk.map((r, j) => prisma.contractPage.update({
      where: { id: r.id },
      data: { embedding: vectors[j], embeddingModel: EMBED_MODEL, embeddedAt: now },
    })));
    done += chunk.length;
  }
  return done;
}

export { EMBED_MODEL };
