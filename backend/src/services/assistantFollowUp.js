/**
 * Shape a project follow-up for the Ask AI tools. Contract amounts use the
 * same dual gate as the Follow-up pages (team membership + matching PIN).
 */
import { presentContractValue } from './followUpValue.js';
import { followUpHref, customerHref, hotProjectHref, contractsHref } from './assistantLinks.js';

function milestoneView(m) {
  if (!m) return null;
  return {
    kind: m.kind,
    label: m.label || null,
    dueDate: m.dueDate || null,
    doneAt: m.doneAt || null,
    owner: m.owner?.name || null,
  };
}

export function presentFollowUpForAssistant(row, viewer, unlockTeam, { detail = false } = {}) {
  if (!row) return { error: 'follow-up not found' };
  const gated = presentContractValue(row, viewer, unlockTeam);
  const open = (row.milestones || []).filter((m) => !m.doneAt && m.dueDate);
  const next = open.length
    ? open.reduce((a, b) => (new Date(a.dueDate) <= new Date(b.dueDate) ? a : b))
    : null;
  const out = {
    id: row.id,
    title: row.title,
    orderNo: row.orderNo || null,
    status: row.status,
    team: row.team,
    machineType: row.machineType || null,
    machineSerial: row.machineSerial || null,
    owner: row.owner?.name || null,
    customer: row.customer ? { id: row.customer.id, name: row.customer.name, href: customerHref(row.customer.id) } : null,
    href: followUpHref(row.id),
    nextMilestone: milestoneView(next),
    milestoneCount: (row.milestones || []).length,
    hasContractValue: gated.hasContractValue === true,
    contractValueLocked: gated.contractValueLocked === true,
    contractValueHidden: gated.contractValueHidden === true,
  };
  if (gated.contractValue != null) {
    out.contractValue = gated.contractValue;
    out.sensitive = true;
  }
  if (row.hotProject?.id) {
    out.hotProject = {
      id: row.hotProject.id,
      category: row.hotProject.category,
      href: hotProjectHref(row.hotProject.id),
    };
  }
  if (detail) {
    out.notes = row.notes || null;
    out.milestones = (row.milestones || []).map(milestoneView);
    out.updates = (row.updates || []).slice(0, 8).map((u) => ({
      date: u.createdAt,
      by: u.author?.name || null,
      content: String(u.content || '').slice(0, 300),
    }));
    // Contacts are operational, not contract values, and appear on the page
    // without a PIN — include names/roles only, no need for phone numbers here.
    out.contacts = (row.contacts || []).slice(0, 12).map((c) => ({
      name: c.name,
      role: c.role || null,
      company: c.company || null,
    }));
    if (row.customer?.id) out.contractsHref = contractsHref(row.customer.id);
  }
  if (out.contractValueLocked || out.contractValueHidden) {
    out.valueNote = out.contractValueHidden
      ? 'Contract value is not visible for this team.'
      : 'A contract value exists. Unlock the team PIN to view the amount.';
  }
  return out;
}

export function lockedContractResult({ customerId, message } = {}) {
  return {
    locked: true,
    href: contractsHref(customerId),
    title: 'Contracts',
    type: 'contracts',
    message: message || 'Contract Q&A needs the team PIN to be unlocked in this session. Open Contracts and unlock, or unlock from the Ask AI page, then ask again.',
  };
}
