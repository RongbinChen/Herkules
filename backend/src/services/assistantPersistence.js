/**
 * Persistence helpers for Ask AI threads.
 * Never store a PIN or unlock token. Contract excerpts and amounts are not
 * kept on source cards or tool traces; a reply that may contain them is
 * marked sensitiveTeam and redacted on read unless the same team is unlocked.
 */

export const LOCKED_REPLY = {
  en: 'This answer includes contract or order-value details. Unlock the same team PIN to view it again, or open the Contracts / Follow-up page.',
  zh: '这条回复含有合同或订单金额细节。请解锁同一团队的 PIN 后再查看，或打开合同 / 项目跟进页面。',
};

const AMOUNT_KEYS = new Set([
  'contractValue', 'amount', 'value', 'price', 'winningPrice',
  'snippet', 'text', 'content', 'answer', 'excerpts', 'pages',
]);

export function isSensitiveTool(name) {
  return name === 'ask_contracts' || name === 'search_followups' || name === 'get_followup';
}

export function threadTitleFrom(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return 'New conversation';
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}

function scrub(value, depth = 0) {
  if (depth > 6 || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrub(v, depth + 1));
  if (typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (AMOUNT_KEYS.has(k)) continue;
    if (k === 'args' && v && typeof v === 'object') {
      const args = { ...v };
      delete args.pin;
      delete args.token;
      delete args.password;
      out[k] = scrub(args, depth + 1);
      continue;
    }
    out[k] = scrub(v, depth + 1);
  }
  return out;
}

// Persist only chip metadata plus trusted href/title, never tool payloads
// (those may include contract text when a PIN was unlocked).
export function stepsForStore(steps = []) {
  return (steps || []).map((s) => ({
    tool: s.tool,
    count: s.count,
    args: scrub({ ...(s.args || {}), pin: undefined, token: undefined }),
  }));
}

export function sourcesForStore(sources = []) {
  return (sources || []).map((s) => {
    const card = {
      type: s.type,
      title: s.title,
      href: s.href,
    };
    if (s.subtitle) card.subtitle = s.subtitle;
    if (s.locked) card.locked = true;
    if (s.sensitive) card.sensitive = true;
    return card;
  });
}

export function sensitiveTeamFromSteps(steps = [], unlockTeam) {
  if (!unlockTeam) return null;
  for (const step of steps || []) {
    if (!isSensitiveTool(step.tool)) continue;
    const result = step.result;
    const rows = Array.isArray(result) ? result : result ? [result] : [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      if (row.locked) continue;
      if (row.contractValue || row.answer || row.sensitive) return unlockTeam;
    }
  }
  return null;
}

export function redactMessage(message, unlockTeam, lang = 'en') {
  if (!message) return message;
  const team = message.sensitiveTeam || null;
  if (!team || team === unlockTeam) {
    return {
      role: message.role,
      content: message.content,
      steps: message.steps || [],
      sources: message.sources || [],
      suggestions: message.suggestions || [],
      sensitiveTeam: team,
      createdAt: message.createdAt,
      id: message.id,
    };
  }
  return {
    role: message.role,
    content: lang === 'zh' ? LOCKED_REPLY.zh : LOCKED_REPLY.en,
    steps: stepsForStore(message.steps || []),
    sources: (message.sources || []).map((s) => (
      s.sensitive ? { type: s.type, title: s.title, href: s.href, locked: true, sensitive: true } : s
    )),
    suggestions: message.suggestions || [],
    sensitiveTeam: team,
    redacted: true,
    createdAt: message.createdAt,
    id: message.id,
  };
}

export function assertNoSecret(payload) {
  const dumped = JSON.stringify(payload);
  if (/x-contract-token/i.test(dumped)) throw new Error('unlock token leaked into stored payload');
  return dumped;
}
