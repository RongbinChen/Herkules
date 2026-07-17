// Bid-opening record ingestion: an uploaded Excel (开标记录) is converted to
// text, then DeepSeek extracts the structured fields (bidding no, project,
// open date, purchaser, bidder list with prices) for storage/display.
import * as XLSX from 'xlsx';
import { callDeepSeek, extractJson } from './deepseek.js';
import { DeepSeekError, deepseekNetworkError } from './deepseekErrors.js';

// Flatten every sheet of the workbook into readable text (rows joined by
// " | ") so tabular bid records survive the conversion.
//
// cellDates:true + raw:false makes date-formatted cells come through as
// human-readable strings (e.g. "2026-06-20") instead of Excel's internal
// serial-day numbers (e.g. 46232) — without this, a date cell reads as a bare
// number with no date meaning, which the model can misinterpret as a year.
export function xlsxToText(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const parts = [];
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: false });
    const lines = rows
      .map((r) => r.map((c) => String(c).trim()).filter(Boolean).join(' | '))
      .filter(Boolean);
    if (lines.length) parts.push(`[Sheet: ${name}]\n${lines.join('\n')}`);
  }
  return parts.join('\n\n');
}

const EXTRACT_SYSTEM = `你是投标数据录入助手。下面是一份"开标记录"（从 Excel 提取的文本，行内以 | 分列）。开标记录常见两种版式：
(a) 表单式：字段以"标签: 值"或"标签 | 值"逐行给出；
(b) 宽表格式：第一行是独立标题（不属于表头也不是数据行，如 "Bid opening - Shanghai Electric"、"开标记录 - 某项目"），第二行是表头（如 Bid opening date / End user / Bidder / Country / Price / IFB No. / Remark 等），随后每行是一个投标人的数据；同一开标批次的日期、编号、采购方等字段可能只填在首个数据行，后续行留空（表示与首行相同）。

一份文件可能包含**多个招标编号(IFB No.)**——即多个标包/项目（例如同一开标记录里 .../01 和 .../02 是两个不同项目）。请**按 IFB No. 把投标人分组，每个不同的编号输出为一条独立记录**。

只输出 JSON，不要解释、不要 markdown 代码块：
{
  "records": [
    {
      "biddingNo": "招标编号（列名可能是 IFB No. / Tender No. / Bid No. / 标包编号 / 项目编号），找不到则 null",
      "projectName": "项目名称。若原文没有明确的\"项目名称\"标签，但首行是独立标题（不是表头/数据行），请用该标题作为项目名称——去掉 'Bid opening'/'开标记录'/'开标'/'Bid opening result' 等通用前缀词与连字符/冒号后剩余的部分；若去除后为空，则使用完整标题原文。多个编号时可在项目名后附编号后缀以区分。确实无任何可用信息才填 null",
      "openDate": "开标日期 YYYY-MM-DD，找不到则 null",
      "purchaser": "招标/采购/业主单位（列名可能是 Purchaser / Owner / Tenderee / End user / 招标单位 / 采购单位），找不到则 null",
      "bidders": [
        {
          "name": "投标人名称 (Bidder/Supplier)",
          "country": "国家/地区 (Country)，无则 null",
          "priceTerm": "价格条款 (Price term，如 CIF/FOB/EXW)，无则 null",
          "currency": "币种 (Currency，如 Euro/USD/CNY)，无则 null",
          "price": "投标报价数值(原样字符串，若币种单列则此处只放金额)",
          "deliveryTime": "交货期 (Delivery time)，无则 null",
          "destination": "目的地 (Destination)，无则 null",
          "note": "备注/其它信息 (Remark，如设备型号、是否有效标)，无则 null"
        }
      ],
      "summary": "一句话中文摘要（项目 + 几家投标 + 报价区间）"
    }
  ]
}

要求：
- **按 IFB No. 拆分**：编号不同的投标人必须归入不同 records；只有一个编号(或无编号)时 records 只含一条。
- 宽表格式下，将每一数据行都视为一个投标人，所有数据行都要归入对应编号的 bidders；把该行每一列都填入对应字段，不要丢弃 Price term / Currency / Delivery time / Destination / Country / Remark 等列。
- 日期/采购方等公共字段若某行留空，沿用同组上一非空值。
- 各字段保留原文（含币种/单位/条款）；表格里没有的列填 null，不要编造。`;

// The extraction prompt is shared: DeepSeek reads Excel-derived text, Gemini
// reads the photo — both must return the same { records: [...] } JSON shape.
export const BID_EXTRACT_SYSTEM = EXTRACT_SYSTEM;

// Turn a parsed model response (either { records:[...] } or a legacy single
// object) into a clean, normalized array of records. Shared by both extractors.
export function recordsFromParsed(parsed) {
  if (!parsed) return [];
  const raw = Array.isArray(parsed.records)
    ? parsed.records
    : Array.isArray(parsed.bidders)
      ? [parsed]
      : [];
  return raw.map(normalizeRecord).filter((r) => r.biddingNo || r.projectName || r.bidders.length);
}

const LANG_NAMES = { en: 'English', zh: '中文（简体）' };

// Translate a bid-opening record's free-text fields into the target language via
// DeepSeek. Company names, prices, bidding No. and dates are kept as-is; only
// descriptive fields (project name, purchaser, country, price term, currency,
// delivery time, destination, remark) are translated. Returns a partial
// { projectName, purchaser, bidders:[{country,priceTerm,currency,deliveryTime,
// destination,note}] } — index-aligned to record.bidders. Throws on AI failure.
export async function translateBidOpening(record, lang = 'en') {
  const target = LANG_NAMES[lang] || 'English';
  const payload = {
    projectName: record.projectName || null,
    purchaser: record.purchaser || null,
    bidders: (record.bidders || []).map((b) => ({
      country: b.country || null,
      priceTerm: b.priceTerm || null,
      currency: b.currency || null,
      deliveryTime: b.deliveryTime || null,
      destination: b.destination || null,
      note: b.note || null,
    })),
  };
  const sys =
    `你是专业翻译。把下面 JSON 里的字段值翻译成${target}，并严格返回结构完全相同的 JSON（键不变、bidders 数组顺序与长度不变）。规则：\n` +
    `- projectName（项目名）、purchaser（采购/招标单位名）、deliveryTime、note、destination 等要翻译成${target}；采购单位若有通用英文名则用英文名，否则直译。\n` +
    `- 投标人公司名(bidders[].name 不在本次输入内)、设备型号、招标编号、数字金额、日期保持原文不译。\n` +
    `- 常见词用标准译法：德国→Germany、捷克→Czech、意大利→Italy、西班牙→Spain、欧元→Euro、美元→USD、人民币→CNY；CIF/FOB/EXW 等贸易术语保持原样。\n` +
    `- 已是目标语言的值保持不变；为 null 的值仍返回 null。\n` +
    `只输出 JSON，不要解释、不要 markdown 代码块。`;
  const reply = await callDeepSeek(
    [
      { role: 'system', content: sys },
      { role: 'user', content: JSON.stringify(payload) },
    ],
    2000,
  );
  const t = extractJson(reply) || {};
  const bidders = Array.isArray(t.bidders) ? t.bidders : [];
  return {
    projectName: t.projectName ?? null,
    purchaser: t.purchaser ?? null,
    bidders: payload.bidders.map((_, i) => {
      const tb = bidders[i] || {};
      return {
        country: tb.country ?? null,
        priceTerm: tb.priceTerm ?? null,
        currency: tb.currency ?? null,
        deliveryTime: tb.deliveryTime ?? null,
        destination: tb.destination ?? null,
        note: tb.note ?? null,
      };
    }),
  };
}

// Parse an open-date that may arrive as an ISO/locale string OR a bare Excel
// serial day-number (when a date cell wasn't date-formatted, e.g. "46205" for
// 2026-07-02). Converting the serial preserves the real date instead of nulling
// it; New Date("46205") would otherwise read it as the year 46205 and crash the
// Prisma insert. Returns a Date, or null when unrecognizable / out of range.
export function parseOpenDate(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  // 5-digit Excel serial. Years 2000–2100 span serials ~36526–73415.
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (serial >= 36526 && serial <= 73415) {
      const d = new Date(Math.round((serial - 25569) * 86400000)); // 25569 = Excel→Unix epoch offset (days)
      return Number.isNaN(d.getTime()) ? null : d;
    }
    return null; // out-of-range 5-digit number is not a date
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime()) && d.getFullYear() >= 2000 && d.getFullYear() <= 2100) return d;
  return null;
}

function normalizeRecord(r) {
  const openDate = parseOpenDate(r.openDate);
  const bidders = (Array.isArray(r.bidders) ? r.bidders : []).map((b) => ({
    name: b.name || '',
    country: b.country ?? null,
    priceTerm: b.priceTerm ?? null,
    currency: b.currency ?? null,
    price: b.price ?? null,
    deliveryTime: b.deliveryTime ?? null,
    destination: b.destination ?? null,
    note: b.note ?? null,
  }));
  return {
    biddingNo: r.biddingNo || null,
    projectName: r.projectName || null,
    openDate,
    purchaser: r.purchaser || null,
    bidders,
    summary: r.summary || null,
  };
}

// Returns an ARRAY of extracted records — one per IFB No. found in the file
// (a single file can contain several tender packages). Throws DeepSeekError
// when the AI service is unavailable; returns [] when nothing usable is found.
export async function extractBidOpenings(text) {
  const content = text.slice(0, 8000); // keep prompt bounded (multi-record needs more room)
  let reply;
  try {
    reply = await callDeepSeek(
      [
        { role: 'system', content: EXTRACT_SYSTEM },
        { role: 'user', content },
      ],
      2500,
    );
  } catch (err) {
    if (err instanceof DeepSeekError || err?.isDeepSeek) throw err;
    throw deepseekNetworkError(err);
  }
  return recordsFromParsed(extractJson(reply));
}
