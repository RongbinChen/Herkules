import { letterheadAuthorName } from '../../../shared/originalBodyBlocks.js';

// Prefer a name already stored in content.meta.author (AI drafts, or a
// letterhead copy from import). If that is empty, read From (or a name-like
// Fax slot) from the preserved letterhead.
export function authorNameFromContent(content) {
  const fromMeta = String(content?.meta?.author || '').trim();
  if (fromMeta) return fromMeta;
  const body = typeof content?.originalBody === 'string' ? content.originalBody : '';
  return letterheadAuthorName(body) || '';
}

// Unique case-insensitive contains-match against system user names.
// No match, a short name, or more than one hit falls back to fallbackId
// (the uploader). Nothing is guessed among several users.
export function resolveAuthorIdFromUsers(content, users, fallbackId) {
  const name = String(authorNameFromContent(content) || '').trim().toLowerCase();
  if (name.length < 3) return fallbackId;
  const hits = (users || []).filter((user) => {
    const un = String(user?.name || '').trim().toLowerCase();
    return un && (un.includes(name) || name.includes(un));
  });
  return hits.length === 1 ? hits[0].id : fallbackId;
}
