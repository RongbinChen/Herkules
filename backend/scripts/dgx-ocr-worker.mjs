#!/usr/bin/env node
/**
 * Reads scanned contract files on the DGX and posts the text back to the VPS.
 *
 * Every contract in the system is a scan with no text layer — 1173 pages of
 * JPEG at the time of writing — so nothing about them is searchable and the
 * assistant has nothing to read. This turns them into text with a local vision
 * model, so the files themselves never leave the company.
 *
 * WHERE THE FILES COME FROM
 * The worker does NOT download contracts over HTTP. The nightly backup already
 * rsyncs the whole storage directory here over SSH (dgx-backup.sh), so the
 * bytes are on local disk already. The VPS queue hands out ids and stored
 * names, never content — see the security note in routes/contracts.js. A file
 * uploaded since the last sync is fetched over that same SSH channel, not a
 * new one.
 *
 * HOW IT IS WOKEN
 * A tiny HTTP listener on WAKE_PORT. The VPS reaches it through the SSH reverse
 * tunnel the DGX itself dials out (contract-ocr-tunnel.service). The wake is
 * only a latency optimisation: the queue in the database is what guarantees
 * delivery, and IDLE_POLL_MS is the slow safety net for wakes that never
 * arrived because this machine was off.
 *
 *   VPS_URL         https://www.herkulesgroup-china.com
 *   OCR_TOKEN       must match the VPS value
 *   CONTRACT_DIR    local copy of the contract files
 *   VLM_MODEL       default qwen2.5vl:32b — see the note on model size below
 *
 *   --once          drain the queue and exit (for a manual backfill)
 *   --limit N       stop after N files
 *   --file ID       do one specific file, ignoring the queue
 *   --dry-run       transcribe but do not post results back
 */
import { spawn } from 'child_process';
import { createServer } from 'http';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';

const VPS_URL = (process.env.VPS_URL || 'https://www.herkulesgroup-china.com').replace(/\/$/, '');
const OCR_TOKEN = process.env.OCR_TOKEN;
const CONTRACT_DIR = process.env.CONTRACT_DIR || '/home/henner/calendar/vps-backups/contract-files';
const OLLAMA = process.env.OLLAMA_URL || 'http://localhost:11434';
// 32b, not 7b. The 7b model reads individual values correctly but cannot
// represent a BLANK cell: on a two-column spec sheet it shifts a value sideways
// to fill the gap, silently attributing one machine's rating to another. It
// also contradicts itself when asked to compare ("yes they differ — 400 mm and
// 400 mm"). Wrong specs stated confidently are worse than no answer, and this
// runs once per page for the life of the document, so the slower model is the
// cheap choice.
const VLM_MODEL = process.env.VLM_MODEL || 'qwen2.5vl:32b';
const WAKE_PORT = Number(process.env.WAKE_PORT || 9099);
// Slow on purpose: the wake covers the fast path, this only catches uploads
// that happened while the DGX was off.
const IDLE_POLL_MS = Number(process.env.IDLE_POLL_MS || 15 * 60 * 1000);
const DPI = Number(process.env.OCR_DPI || 300);
const PAGE_TIMEOUT_MS = Number(process.env.PAGE_TIMEOUT_MS || 180000);

// Pause switch. When this file exists, the worker stops claiming NEW files to
// transcribe, but keeps serving Q&A (/ask) — the two share this process and the
// GPU, so this frees the GPU for fast answers without taking the worker down.
// A file (not an in-memory flag) so it survives a restart and can be toggled
// from the shell (touch/rm) as well as over HTTP. The current file, if one is
// mid-transcription, is allowed to finish; pause only stops the NEXT claim.
const PAUSE_FILE = process.env.OCR_PAUSE_FILE || '/home/henner/.config/contract-ocr.paused';
const isPaused = () => existsSync(PAUSE_FILE);

const ONCE = process.argv.includes('--once');
const DRY_RUN = process.argv.includes('--dry-run');
const argOf = (flag) => { const i = process.argv.indexOf(flag); return i === -1 ? null : process.argv[i + 1]; };
const LIMIT = Number(argOf('--limit') || 0);
const ONE_FILE = argOf('--file');

const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);

const TRANSCRIBE_PROMPT = `Transcribe this scanned contract page verbatim into Markdown.

Rules:
- Transcribe only what is printed. Never invent placeholder text like "Value 1".
- Tables: a value belongs to the column it is physically under. Check the
  horizontal position of every number before placing it.
- If a cell is BLANK in the original, leave it blank. Never shift a value
  sideways to fill a gap — a blank cell is information.
- Keep Chinese as Chinese and English as English. Do not translate.
- Handwritten marks are meaningful in a signed contract: note them briefly,
  e.g. [handwritten check] or [red company stamp].
- Put page headers and footers as plain text, not as table rows.
- If the page is blank or unreadable, output exactly: [no readable content]`;

function api(pathname, opts = {}) {
  return fetch(`${VPS_URL}/api/contracts${pathname}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'X-Ocr-Token': OCR_TOKEN, ...(opts.headers || {}) },
    signal: AbortSignal.timeout(60000),
  });
}

function run(cmd, args, { timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let out = '', err = '';
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(`${cmd} timed out`)); }, timeout);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => {
      clearTimeout(t);
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} exited ${code}: ${err.slice(0, 300)}`));
    });
  });
}

async function transcribePage(jpegPath) {
  const b64 = (await fs.readFile(jpegPath)).toString('base64');
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: VLM_MODEL,
      prompt: TRANSCRIBE_PROMPT,
      images: [b64],
      stream: false,
      // Zero temperature: this is transcription, not writing. Creativity here
      // is a fabricated contract term.
      options: { temperature: 0, num_ctx: 16384 },
    }),
    signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}`);
  const text = (await res.json()).response?.trim() || '';
  return text === '[no readable content]' ? '' : text;
}

// ── Q&A (answer from the 32b transcription text, with a fast text model) ──────
//
// The pages were transcribed by qwen2.5vl:32b, which keeps tables as Markdown
// tables — the layout that the original "answer off the image" design existed to
// protect is already preserved in that text. So Q&A reads the transcription with
// a fast TEXT model (qwen3) instead of re-rendering and re-reading every page
// with the vision model: seconds instead of a minute, no PDF rendering, no scp,
// and no risk of the answer request tripping the VPS's 60s proxy timeout.
//
// The VPS locates the pages (keyword score + a boost for the page that STATES a
// value, not merely references it) and relays their text here. This only prompts
// the model — it never touches the PDFs.
const ASK_TIMEOUT_MS = Number(process.env.ASK_TIMEOUT_MS || 120000);
const ASK_MAX_PAGES = Number(process.env.ASK_MAX_PAGES || 12);
const ASK_MODEL = process.env.ASK_MODEL || 'qwen3:latest';
const ASK_NUM_CTX = Number(process.env.ASK_NUM_CTX || 32768);

function askPrompt(question, context, history = []) {
  // Prior turns let a follow-up resolve "它/那份/第二台/那付款呢" against what was
  // already asked. Marked clearly as history so the model answers the CURRENT
  // question, not an old one.
  const convo = history.length
    ? `Prior turns (for resolving references in the follow-up; do not re-answer them):\n${history
        .map((h) => `Q: ${h.question}\nA: ${h.answer}`)
        .join('\n')}\n\n`
    : '';
  // Default to English. qwen3 otherwise mirrors the language of the question and
  // the (mostly Chinese) contract text, so the cue has to be the LAST thing
  // before generation — a directive up top gets overridden by the Chinese pages
  // right above the answer. An explicit request in the question flips it back.
  const wantsZh = /用中文|中文(回答|作答|答复|说)|(answer|reply|respond)[^.]{0,12}chinese|in chinese/i.test(question);
  const cue = wantsZh
    ? '请用中文作答（把英文条款/数值也用中文表述）。\n答：'
    : 'Write your answer in English (translate any Chinese values/terms into English).\nAnswer:';
  return `/no_think
You are answering questions about one customer's contracts. Below are contract pages, each labelled with its file name and page number.

Rules:
- Use ONLY the pages below; if the answer is not there, say so plainly ("not found in the provided pages") — do not guess.
- Answer per contract file. For a total/amount, report only the figure stated as "合同总价为 X / TOTAL CONTRACT VALUE: X"; never treat an installment ("合同总价的百分之N") as the total, and never sum installments.
- If different files give different values (e.g. two contract versions), list each value with its file; do not merge them.
- This is a running conversation; the last "Question" is the one to answer — use the prior turns to resolve references.
- Cite sources (file · page). Be concise; do not restate every page.

Contract pages:
${context}

${convo}Question: ${question}

${cue}`;
}

// pages: [{ filename, pageNo, text }]. The VPS has already checked the PIN,
// picked the pages and included their transcription. This only prompts the model.
async function answerFromPages(question, pages, history = []) {
  const wanted = pages.filter((p) => p && p.text).slice(0, ASK_MAX_PAGES);
  if (!wanted.length) throw new Error('no page text supplied');

  const context = wanted
    .map((p) => `【${p.filename || 'contract'} · 第${p.pageNo}页】\n${p.text}`)
    .join('\n\n---\n\n');

  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ASK_MODEL,
      prompt: askPrompt(question, context, history),
      stream: false,
      // Qwen3's thinking mode roughly doubles the latency for no accuracy gain on
      // a lookup like this — the /no_think tag and this flag both turn it off.
      think: false,
      // Zero temperature: reading a figure out of a contract is not a creative act.
      options: { temperature: 0, num_ctx: ASK_NUM_CTX },
    }),
    signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}`);
  return (await res.json()).response?.trim() || '';
}

// PDFs only for now. A .docx already has a text layer and deserves a plain
// extractor rather than a vision model reading pictures of its own words.
const isPdf = (f) => f.toLowerCase().endsWith('.pdf');

// Return the absolute path to a stored file, fetching it over SSH if the nightly
// sync has not brought it down yet. Shared by transcription and by Q&A, which
// both need the original bytes on local disk.
async function ensureLocal(storedName) {
  const src = path.join(CONTRACT_DIR, storedName);
  try {
    await fs.access(src);
  } catch {
    // Uploaded since the last nightly sync. Pull just this one over the SSH
    // channel the backup already uses, rather than opening an HTTP route that
    // would serve contract bytes to a bearer token.
    log(`  本地没有，走 SSH 单独拉: ${storedName}`);
    const key = process.env.VPS_SSH_KEY || '/home/henner/calendar/LightsailDefaultKey-ap-northeast-1.pem';
    const host = process.env.VPS_SSH_HOST || 'ubuntu@35.76.38.203';
    await run('scp', ['-i', key, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new',
      `${host}:/home/ubuntu/contract-files/${storedName}`, src], { timeout: 300000 });
  }
  return src;
}

async function processFile(file) {
  const src = await ensureLocal(file.storedName);

  if (!isPdf(file.storedName)) {
    log(`  跳过（非 PDF）: ${file.filename}`);
    return { pages: [], skipped: true };
  }

  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'ocr-'));
  try {
    await run('pdftoppm', ['-r', String(DPI), '-jpeg', '-q', src, path.join(work, 'p')], { timeout: 600000 });
    const jpegs = (await fs.readdir(work)).filter((f) => f.endsWith('.jpg')).sort();
    log(`  ${jpegs.length} 页，开始转写`);

    const pages = [];
    for (const [i, j] of jpegs.entries()) {
      // pdftoppm names files p-001.jpg; that number is the page, not the index.
      const pageNo = Number(j.match(/-(\d+)\.jpg$/)?.[1] || i + 1);
      const t0 = Date.now();
      let text = '';
      try {
        text = await transcribePage(path.join(work, j));
      } catch (e) {
        // One bad page must not lose the other 173. Record the gap, move on.
        log(`  第 ${pageNo} 页失败: ${e.message}`);
        text = `[transcription failed: ${e.message.slice(0, 120)}]`;
      }
      pages.push({ pageNo, text });
      // Every page on a short file, every tenth on a long one. A 4-page file
      // that only logs at the end looks indistinguishable from a hung one.
      const step = jpegs.length <= 20 ? 1 : 10;
      if (pageNo % step === 0 || pageNo === jpegs.length) {
        log(`  ${pageNo}/${jpegs.length} 页（本页 ${((Date.now() - t0) / 1000).toFixed(1)}s）`);
      }
    }
    return { pages, skipped: false };
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

let draining = false;

async function drain() {
  if (draining) return;            // a wake during a run must not start a second pass
  if (isPaused()) { log('转写已暂停（存在暂停标记），只服务问答，不领取新文件'); return; }
  draining = true;
  // Totals for the "queue is empty" mail. Scoped to this pass, not the process:
  // what the reader wants to know is "the batch I just uploaded is ready", not
  // a lifetime counter.
  const pass = { processed: 0, pages: 0, failed: 0, startedAt: Date.now() };
  try {
    let done = 0;
    for (;;) {
      let queue;
      if (ONE_FILE) {
        queue = { items: [{ id: Number(ONE_FILE) }], pending: 1 };
      } else {
        const r = await api('/ocr/pending?limit=20');
        if (!r.ok) { log(`取队列失败: ${r.status}`); return; }
        queue = await r.json();
      }
      if (!queue.items.length) { log('队列已空'); return; }

      for (const item of queue.items) {
        if (LIMIT && done >= LIMIT) { log(`到达 --limit ${LIMIT}`); return; }
        // Re-checked each file so a pause set mid-pass takes effect at the next
        // file boundary rather than only at the start of a drain.
        if (isPaused()) { log('转写已暂停，停在当前文件之后'); return; }
        const c = await api(`/ocr/claim/${item.id}`, { method: 'POST' });
        if (c.status === 409) continue;          // someone else got it
        if (!c.ok) { log(`认领 ${item.id} 失败: ${c.status}`); continue; }
        const file = await c.json();
        log(`▶ #${file.id} ${file.filename}`);
        const t0 = Date.now();
        try {
          const { pages, skipped } = await processFile({ ...item, ...file });
          if (DRY_RUN) {
            log(`  [dry-run] ${pages.length} 页，不回传`);
          } else {
            const r = await api(`/ocr/result/${file.id}`, {
              method: 'POST',
              body: JSON.stringify({ attempt: file.ocrAttempt, pages, skipped }),
            });
            // Checking the status matters more here than almost anywhere else:
            // the work that just got thrown away took nearly an hour of GPU
            // time. A 413 once printed as a tick, and the file sat in RUNNING
            // forever because nothing ever told the queue it had failed.
            if (!r.ok) throw new Error(`回传被拒: HTTP ${r.status}`);
            log(`  ✓ ${pages.length} 页，${((Date.now() - t0) / 1000 / 60).toFixed(1)} 分钟`);
            pass.processed += 1;
            pass.pages += pages.length;
          }
        } catch (e) {
          log(`  ✗ ${e.message}`);
          pass.failed += 1;
          if (!DRY_RUN) {
            await api(`/ocr/result/${file.id}`, {
              method: 'POST',
              body: JSON.stringify({ attempt: file.ocrAttempt, pages: [], error: e.message.slice(0, 2000) }),
            }).catch(() => {});
          }
        }
        done += 1;
      }
      if (ONE_FILE) return;
    }
  } finally {
    draining = false;
    // Only after real work: an idle poll finding nothing to do is not news.
    // The VPS still checks the queue itself before mailing, so a pass that
    // stopped early (--limit, an error) does not announce a false finish.
    if (pass.processed > 0 && !DRY_RUN) {
      await api('/ocr/drained', {
        method: 'POST',
        body: JSON.stringify({
          processed: pass.processed,
          pages: pass.pages,
          failed: pass.failed,
          elapsedMs: Date.now() - pass.startedAt,
        }),
      }).catch((e) => log('汇报失败（不影响已入库的结果）:', e.message));
    }
  }
}

// ── main ────────────────────────────────────────────────────────────────────
if (!OCR_TOKEN) {
  console.error('OCR_TOKEN 未配置 —— 无处回传，先配好再跑');
  process.exit(2);
}

if (ONCE || ONE_FILE) {
  await drain();
  process.exit(0);
}

createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/wake') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
    log('收到唤醒');
    // Answer first, work after: the VPS is holding an upload response open.
    drain().catch((e) => log('drain 出错:', e.message));
    return;
  }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, draining, paused: isPaused(), model: VLM_MODEL }));
    return;
  }
  // Toggle the transcription pause. Same token as /ask; Q&A keeps working while
  // paused. /resume kicks a drain so queued files start again without waiting
  // for the idle poll. touch/rm on PAUSE_FILE does the same thing from a shell.
  if (req.method === 'POST' && (req.url === '/pause' || req.url === '/resume')) {
    if (String(req.headers['x-ocr-token'] || '') !== OCR_TOKEN) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end('{"error":"unauthorized"}');
      return;
    }
    const pause = req.url === '/pause';
    (pause
      ? fs.writeFile(PAUSE_FILE, `paused ${new Date().toISOString()}\n`).catch(() => {})
      : fs.unlink(PAUSE_FILE).catch(() => {})
    ).then(() => {
      log(pause ? '转写已暂停（收到 /pause）' : '转写已恢复（收到 /resume）');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, paused: pause }));
      if (!pause) drain().catch((e) => log('resume drain 出错:', e.message));
    });
    return;
  }
  // Q&A: the VPS relays a question plus the pages it located. Same token as the
  // OCR queue — this is another machine-to-machine door reached only over the
  // tunnel, and it never returns file bytes, only an answer read off the image.
  if (req.method === 'POST' && req.url === '/ask') {
    if (String(req.headers['x-ocr-token'] || '') !== OCR_TOKEN) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end('{"error":"unauthorized"}');
      return;
    }
    let body = '';
    let tooBig = false;
    req.on('data', (c) => {
      body += c;
      // Page coordinates and a question are tiny; anything large is not ours.
      // Now carries the pages' transcription text, not just coordinates, so the
      // ceiling is larger — but still bounded, a question is not a file upload.
      if (body.length > 2 * 1024 * 1024) { tooBig = true; req.destroy(); }
    });
    req.on('end', async () => {
      if (tooBig) return;
      try {
        const { question, pages, history } = JSON.parse(body || '{}');
        if (!question || !Array.isArray(pages) || !pages.length) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end('{"error":"question and pages are required"}');
          return;
        }
        log(`收到提问（${pages.length} 页）: ${String(question).slice(0, 40)}`);
        const answer = await answerFromPages(String(question), pages, Array.isArray(history) ? history : []);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ answer }));
      } catch (e) {
        log('提问处理失败:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message.slice(0, 200) }));
      }
    });
    return;
  }
  res.writeHead(404); res.end();
// Bound to loopback: the only thing that should reach this is the far end of
// the SSH tunnel, which surfaces here as a local connection.
}).listen(WAKE_PORT, '127.0.0.1', () => log(`唤醒端口 127.0.0.1:${WAKE_PORT}，模型 ${VLM_MODEL}`));

setInterval(() => drain().catch((e) => log('定时 drain 出错:', e.message)), IDLE_POLL_MS);
drain().catch((e) => log('启动 drain 出错:', e.message));
