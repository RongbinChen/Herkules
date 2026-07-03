// Google Gemini vision — OCR + structured extraction of bid-opening photos.
// Returns the same { records: [...] } shape as the DeepSeek/Excel path so the
// upload route can treat images and spreadsheets uniformly.
import { BID_EXTRACT_SYSTEM, recordsFromParsed } from './bidOpening.js';

// Try the best vision model first; on transient overload (503) fall through to
// less-busy alternatives so uploads still work during demand spikes.
const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'];
const urlFor = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

export function isGeminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

// Classified, user-facing errors (parallels deepseekErrors).
export class GeminiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
    this.isGemini = true;
  }
}

function geminiMessage(status, bodyText = '') {
  const t = (bodyText || '').toLowerCase();
  if (status === 429 || t.includes('resource_exhausted') || t.includes('quota')) {
    return "Image recognition is temporarily unavailable: Google Gemini's free daily quota has been used up. Please try again tomorrow, upload an Excel/manual entry instead, or upgrade the Gemini plan. (Gemini 今日免费额度已用完)";
  }
  if (status === 400 || status === 403 || t.includes('api key') || t.includes('permission')) {
    return 'Image recognition unavailable: the Gemini API key is invalid or lacks permission. (Gemini API Key 无效或无权限)';
  }
  if (status === 503 || t.includes('overloaded') || t.includes('unavailable')) {
    return 'Image recognition is busy right now (Gemini model overloaded). Please try again in a moment. (Gemini 模型繁忙，请稍后重试)';
  }
  return `Image recognition temporarily unavailable (Gemini HTTP ${status || '?'}). Please try again later.`;
}

const IMAGE_INSTRUCTION =
  '下面是一张"开标记录"的照片/扫描件。请先对图片做 OCR，再按下述规则提取结构化信息。' +
  '表格通常为竖排或横排，列含：招标编号(IFB No.)、投标人、国家/地区、报价方式(Price term)、币种、报价、交货期、目的地、备注等。';

// Extract bid-opening records from an image buffer. Throws GeminiError when the
// service is unavailable (quota/key/network).
export async function extractBidOpeningsFromImage(buffer, mimeType) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new GeminiError(geminiMessage(403), 403);

  const body = {
    // Gemini has no separate "system" role; prepend the shared schema prompt.
    contents: [
      {
        parts: [
          { text: `${BID_EXTRACT_SYSTEM}\n\n${IMAGE_INSTRUCTION}` },
          { inline_data: { mime_type: mimeType, data: buffer.toString('base64') } },
        ],
      },
    ],
    generationConfig: { maxOutputTokens: 8192, responseMimeType: 'application/json' },
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let res = null;
  let lastStatus = 503;
  let lastBody = '';
  // Model-fallback loop: each model retried once, then move to the next on 503.
  outer: for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await sleep(1200);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60000);
      let r;
      try {
        r = await fetch(`${urlFor(model)}?key=${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        throw new GeminiError(
          err?.name === 'AbortError'
            ? 'Image recognition timed out. Please try again.'
            : 'Cannot reach Google Gemini. Please try again later.',
        );
      }
      clearTimeout(timer);
      if (r.ok) { res = r; break outer; }
      lastStatus = r.status;
      lastBody = await r.text().catch(() => '');
      // Quota (429) / key (400,403) errors fail fast — no point trying other models.
      if (r.status !== 503) {
        console.error('[gemini] API error', r.status, lastBody.slice(0, 200));
        throw new GeminiError(geminiMessage(r.status, lastBody), r.status);
      }
      console.warn(`[gemini] ${model} 503 overloaded (try ${attempt + 1}/2)`);
    }
  }
  if (!res) {
    console.error('[gemini] all models overloaded (503)');
    throw new GeminiError(geminiMessage(lastStatus, lastBody), lastStatus);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    // responseMimeType should give clean JSON, but guard with a brace scan.
    const m = text.match(/\{[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : null;
  }
  return recordsFromParsed(parsed);
}
