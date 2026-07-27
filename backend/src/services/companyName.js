// Shared company-name normalization for conservative cross-module matching:
// lowercase, drop parenthetical qualifiers, punctuation, and common legal
// suffixes so "COSCO SHIPPING Heavy Industry Co., Ltd." ≈ "Cosco Shipping Heavy Industry".
export function normalizeCompany(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, ' ') // drop parenthetical qualifiers e.g. "(Shanghai)"
    .replace(/[.,()（）\-–—&]/g, ' ')
    .replace(/\b(co|ltd|co ltd|company|limited|gmbh|inc|corp|corporation)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
