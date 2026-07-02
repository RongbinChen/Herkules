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

请提取结构化信息，只输出 JSON，不要解释、不要 markdown 代码块：
{
  "biddingNo": "招标编号（列名可能是 IFB No. / Tender No. / Bid No. / 标包编号 / 项目编号），找不到则 null",
  "projectName": "项目名称。若原文没有明确的\"项目名称\"标签，但首行是独立标题（不是表头/数据行），请用该标题作为项目名称——去掉 'Bid opening'/'开标记录'/'开标'/'Bid opening result' 等通用前缀词与连字符/冒号后剩余的部分；若去除后为空，则使用完整标题原文。确实无任何可用信息才填 null",
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

要求：
- 宽表格式下，将每一数据行都视为一个投标人，bidders 必须覆盖所有数据行；把该行每一列都填入对应字段，不要丢弃 Price term / Currency / Delivery time / Destination / Country / Remark 等列。
- 日期/编号/采购方等公共字段若后续行留空，取首个非空值。
- 各字段保留原文（含币种/单位/条款）；表格里没有的列填 null，不要编造。`;

// Returns the extracted record { biddingNo, projectName, openDate, purchaser,
// bidders, summary }. Throws DeepSeekError when the AI service is unavailable.
export async function extractBidOpening(text) {
  const content = text.slice(0, 6000); // keep prompt bounded
  let reply;
  try {
    reply = await callDeepSeek(
      [
        { role: 'system', content: EXTRACT_SYSTEM },
        { role: 'user', content },
      ],
      1500,
    );
  } catch (err) {
    if (err instanceof DeepSeekError || err?.isDeepSeek) throw err;
    throw deepseekNetworkError(err);
  }
  const parsed = extractJson(reply);
  if (!parsed) return null;
  // Sanity-check the year — guards against the model echoing back a raw
  // Excel date serial (e.g. "46232") which Date.parse would otherwise happily
  // read as year 46232 and blow up the DB write.
  let openDate = null;
  if (parsed.openDate) {
    const d = new Date(parsed.openDate);
    if (!Number.isNaN(d.getTime()) && d.getFullYear() >= 2000 && d.getFullYear() <= 2100) {
      openDate = d;
    }
  }
  // Normalize bidders to a stable shape (all columns preserved, missing → null).
  const bidders = (Array.isArray(parsed.bidders) ? parsed.bidders : []).map((b) => ({
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
    biddingNo: parsed.biddingNo || null,
    projectName: parsed.projectName || null,
    openDate,
    purchaser: parsed.purchaser || null,
    bidders,
    summary: parsed.summary || null,
  };
}
