// The contract price on a project follow-up.
//
// Two gates, and both have to open. The team that runs the order (and admins)
// is the first: everyone else gets the field removed, not hidden in the
// browser. That is not enough. The figure stays out of the payload until the
// request carries the same team PIN that unlocks contract files, including
// for a teammate and for an admin. A locked payload may say that a value
// exists, so the page can offer the PIN, but it never includes the number
// or the currency text. A WRC unlock does not open an HRC price.

export function viewerMaySeeValue(viewer, projectTeam) {
  if (!viewer) return false;
  if (viewer.isAdmin === true) return true;
  return Boolean(viewer.team) && viewer.team === projectTeam;
}

// A suggestion is the price, said earlier. It takes the same two gates, and
// the unlock has to be for the team the record will be filed under — reading
// one team's contracts must not fill another team's price.
export function maySuggestContractValue(viewer, forTeam, unlockTeam) {
  return viewerMaySeeValue(viewer, forTeam) && Boolean(unlockTeam) && unlockTeam === forTeam;
}

function hasAmount(value) {
  return Boolean(String(value ?? '').trim());
}

export function presentContractValue(row, viewer, unlockTeam) {
  if (!row || typeof row !== 'object') return row;
  const raw = row.contractValue;
  const exists = hasAmount(raw);
  if (!viewerMaySeeValue(viewer, row.team)) {
    const { contractValue, ...rest } = row;
    return { ...rest, contractValue: null, contractValueHidden: true };
  }
  if (unlockTeam && unlockTeam === row.team) {
    return {
      ...row,
      // A blank is not a price. Returning it as null keeps "no value" and
      // "locked value" from depending on which spaces were stored.
      contractValue: exists ? raw : null,
      contractValueLocked: false,
      hasContractValue: exists,
    };
  }
  const { contractValue, ...rest } = row;
  return {
    ...rest,
    contractValue: null,
    contractValueLocked: true,
    hasContractValue: exists,
  };
}
