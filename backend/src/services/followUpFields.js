// Fields written onto a ProjectFollowUp from a create or update body.
//
// Kept beside the route so the payload can be tested without booting Prisma.
// The contract value is written only when the caller says so. That flag is
// the route's membership-and-PIN gate; team membership alone is not enough.
// The machine serial is ordinary order data, like the machine model, and is
// not part of that restriction.

// Blank and whitespace-only text is stored as null. The column is optional,
// and a cleared input should come back as "no serial", not as a string of
// spaces.
export function optionalText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

export function followUpCreateData(body, { userId, creatorTeam } = {}) {
  const b = body || {};
  // Whose order this is decides who may read its value, so it is answered at
  // creation. The creator's own team is the default; someone filed under
  // OTHER (they belong to neither) must choose, and the client offers both.
  const team = ['WRC', 'HRC'].includes(b.team)
    ? b.team
    : (['WRC', 'HRC'].includes(creatorTeam) ? creatorTeam : 'HRC');
  return {
    title: String(b.title ?? '').trim(),
    team,
    orderNo: b.orderNo || null,
    customerId: b.customerId ? parseInt(b.customerId) : null,
    hotProjectId: b.hotProjectId ? parseInt(b.hotProjectId) : null,
    ownerId: b.ownerId ? parseInt(b.ownerId) : userId,
    machineType: b.machineType || null,
    machineSerial: optionalText(b.machineSerial),
    contractValue: b.contractValue || null,
    notes: b.notes || null,
    createdById: userId,
  };
}

export function followUpUpdateData(body, { mayWriteValue = false } = {}) {
  const b = body || {};
  return {
    ...(b.title !== undefined ? { title: String(b.title).trim() } : {}),
    ...(['WRC', 'HRC'].includes(b.team) ? { team: b.team } : {}),
    ...(b.orderNo !== undefined ? { orderNo: b.orderNo || null } : {}),
    ...(b.customerId !== undefined ? { customerId: b.customerId ? parseInt(b.customerId) : null } : {}),
    ...(b.hotProjectId !== undefined ? { hotProjectId: b.hotProjectId ? parseInt(b.hotProjectId) : null } : {}),
    ...(b.ownerId !== undefined ? { ownerId: b.ownerId ? parseInt(b.ownerId) : null } : {}),
    ...(b.status !== undefined ? { status: b.status } : {}),
    ...(b.machineType !== undefined ? { machineType: b.machineType || null } : {}),
    // Absent means "leave it". An empty string is an explicit clear.
    ...(b.machineSerial !== undefined ? { machineSerial: optionalText(b.machineSerial) } : {}),
    ...(b.contractValue !== undefined && mayWriteValue ? { contractValue: b.contractValue || null } : {}),
    ...(b.notes !== undefined ? { notes: b.notes || null } : {}),
  };
}
