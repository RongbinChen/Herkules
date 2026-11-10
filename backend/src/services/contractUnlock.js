// The team a contract-unlock token covers, without rejecting the request.
//
// requireUnlock answers "no token" with 401, which is right for a download.
// A follow-up is still readable without the PIN — only its price is not — so
// that route needs the same check with a quieter answer: null means locked.
import jwt from 'jsonwebtoken';

const TEAMS = new Set(['WRC', 'HRC']);

export function readContractUnlock(req) {
  const raw = req?.headers?.['x-contract-token'];
  if (!raw || req?.user?.userId == null) return null;
  try {
    const payload = jwt.verify(String(raw), process.env.JWT_SECRET);
    if (!payload || payload.scope !== 'contract' || !TEAMS.has(payload.team)) return null;
    // The unlock is tied to the account that performed it, so a token cannot
    // be passed to a colleague who never entered the PIN. Same comparison
    // requireUnlock makes; a second spelling would be a second rule.
    if (payload.userId !== req.user.userId) return null;
    return payload.team;
  } catch {
    return null;
  }
}
