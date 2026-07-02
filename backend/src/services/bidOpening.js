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

const EXTRACT_SYSTEM = `你是投标数据录入助手。下面是一份"开标记录"（从 Excel 提取的文本，行内以 | 分列）。请提取结构化信息。

只输出 JSON，不要解释、不要 markdown 代码块：
{
  "biddingNo": "招标编号/项目编号（如 0712-254112DG050），找不到则 null",
  "projectName": "项目名称，找不到则 null",
  "openDate": "开标日期 YYYY-MM-DD，找不到则 null",
  "purchaser": "招标/采购单位，找不到则 null",
  "bidders": [ { "name": "投标人名称", "price": "投标报价(原样字符串，含币种)", "note": "备注(如是否有效标)，可 null" } ],
  "summary": "一句话中文摘要（项目 + 几家投标 + 报价区间）"
}

要求：bidders 覆盖记录中出现的所有投标人；报价保留原文（含币种/万元等）；不确定的字段用 null，不要编造。`;

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
  return {
    biddingNo: parsed.biddingNo || null,
    projectName: parsed.projectName || null,
    openDate,
    purchaser: parsed.purchaser || null,
    bidders: Array.isArray(parsed.bidders) ? parsed.bidders : [],
    summary: parsed.summary || null,
  };
}
