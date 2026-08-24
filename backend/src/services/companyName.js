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

// Match a company mentioned in announcement text against a list of tracked
// company profiles ({ name, aliases }). Pure and list-driven so operational
// scripts can run the very same matching the scraper does, without booting the
// server for it.
//
// Short aliases (≤4 chars, e.g. "SMS", "VAI") require word boundaries to avoid
// false positives inside longer words.
export function matchCompanyProfile(text, profiles = []) {
  if (!text) return null;
  // chinabidding.com sometimes mangles the separators inside a company name
  // ("WALDRICH？SIEGEN？GmbH？&？Co.KG"), so compare on a form where every
  // non-alphanumeric run is a single space. Aliases go through the same
  // flattening, which keeps the longest-alias rule below meaningful.
  const flat = (t) => String(t).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ').trim();
  const haystack = flat(text);
  // Whole-word only, on the flattened form: "GEORG" must not be found inside
  // "George Fischer", and "MAG" must not be found inside "Magnesium".
  const hasWord = (needle) => {
    const n = flat(needle);
    if (!n) return false;
    return new RegExp(`(?:^| )${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: |$)`).test(haystack);
  };

  // Find the most SPECIFIC match: among all alias hits, keep the longest alias.
  // This prevents a short/broad alias on one company from shadowing a precise
  // alias on another (e.g. "WALDRICH" must not match "Waldrich Coburg").
  let best = null;
  let bestLen = 0;
  for (const profile of profiles) {
    // Lookalike guard: some names are a substring of an unrelated company's
    // ("GEORG" vs "GEORG SAHM", a winding-machine maker). Word boundaries alone
    // cannot separate those, so a profile can name the neighbours it must not
    // be confused with.
    if ((profile.exclude || []).some(hasWord)) continue;

    for (const alias of [profile.name, ...(profile.aliases || [])]) {
      if (!alias) continue;
      if (hasWord(alias) && alias.length > bestLen) {
        best = profile;
        bestLen = alias.length;
      }
    }
  }
  return best;
}
