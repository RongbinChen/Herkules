/**
 * Ask AI reply language.
 * Default is English (including the Auto control). Switch to Chinese only when
 * the language toggle is 中文, or the user explicitly asks to be answered in
 * Chinese. A question or tool result that happens to be in Chinese is not
 * such a request.
 */

const ZH_REQUEST = [
  /用中文(?:来)?(?:回答|回复|讲解|说明|撰写)/,
  /请(?:用|改成|换成|改为)中文/,
  /(?:改成|换成|改为|切换到)中文/,
  /中文(?:来)?(?:回答|回复)/,
  /answer(?:\s+me)?\s+in\s+(?:simplified\s+)?chinese/i,
  /respond\s+in\s+(?:simplified\s+)?chinese/i,
  /in\s+(?:simplified\s+)?chinese(?:\s+please)?(?:\s*[.!]?)?\s*$/i,
  /switch\s+to\s+(?:simplified\s+)?chinese/i,
];

const EN_REQUEST = [
  /用英文(?:来)?(?:回答|回复|讲解|说明|撰写)/,
  /请(?:用|改成|换成|改为)英文/,
  /(?:改成|换成|改为|切换到)英文/,
  /英文(?:来)?(?:回答|回复)/,
  /answer(?:\s+me)?\s+in\s+english/i,
  /respond\s+in\s+english/i,
  /in\s+english(?:\s+please)?(?:\s*[.!]?)?\s*$/i,
  /switch\s+to\s+english/i,
];

export function explicitReplyLang(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  const zh = ZH_REQUEST.some((re) => re.test(s));
  const en = EN_REQUEST.some((re) => re.test(s));
  if (zh && !en) return 'zh';
  if (en && !zh) return 'en';
  return null;
}

// lang from the Ask AI control: 'zh' | 'en' | 'auto' | undefined (Auto).
// The latest user message may override with an explicit language request.
export function resolveReplyLang(lang, history = []) {
  let lastUser = '';
  for (let i = (history || []).length - 1; i >= 0; i -= 1) {
    if (history[i]?.role === 'user') {
      lastUser = history[i].content;
      break;
    }
  }
  const explicit = explicitReplyLang(lastUser);
  if (lang === 'zh') return explicit === 'en' ? 'en' : 'zh';
  if (lang === 'en') return explicit === 'zh' ? 'zh' : 'en';
  return explicit === 'zh' ? 'zh' : 'en';
}

export function languageDirective(resolvedLang) {
  if (resolvedLang === 'zh') {
    return '\n- 强制：用中文回答，包括列表标签（日期 / 概述 / 报告链接）。不要仅仅因为用户这句是英文提问就改用英文。';
  }
  return '\n- MANDATORY: Reply in English, including list labels (Date / Overview / Report link). Do not switch to Chinese because customer names, visit reports, or other tool text are in Chinese, and do not auto-detect the reply language from the question or the data.';
}
