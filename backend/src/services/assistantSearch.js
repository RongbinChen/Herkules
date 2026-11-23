/**
 * Tightened text matching for Ask AI tool search.
 * A Latin query such as "hengli" must not hit "Shengli" (the letters occur
 * inside another word). It should still match "Hengli Engine (Dalian) Co., Ltd."
 * or "Dalian Hengli". Chinese queries keep ordinary substring matching.
 */

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function textMatchesQuery(text, query) {
  const q = String(query || '').trim();
  if (!q) return false;
  const t = String(text || '');
  if (!t) return false;
  const latinOnly = /[A-Za-z]/.test(q) && !/[一-鿿]/.test(q);
  if (latinOnly) {
    return new RegExp(`(^|[^A-Za-z])${escapeRegExp(q)}`, 'i').test(t);
  }
  return t.toLowerCase().includes(q.toLowerCase());
}

export function selectMatching(rows, query, textsOf, limit) {
  const list = Array.isArray(rows) ? rows : [];
  const q = String(query || '').trim();
  const matched = q
    ? list.filter((row) => (textsOf(row) || []).some((text) => textMatchesQuery(text, q)))
    : list;
  return typeof limit === 'number' ? matched.slice(0, limit) : matched;
}
