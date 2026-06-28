// Shared CRM display metadata for customer status and tier.
// Keep the keys in sync with the Prisma enums CustomerStatus / CustomerTier.

export const CUSTOMER_STATUS = {
  LEAD: { label: 'Lead', cls: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200', dot: 'bg-amber-500' },
  ACTIVE: { label: 'Active', cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', dot: 'bg-emerald-500' },
  INACTIVE: { label: 'Inactive', cls: 'bg-slate-100 text-slate-500 ring-1 ring-slate-200', dot: 'bg-slate-400' },
  LOST: { label: 'Lost', cls: 'bg-red-50 text-red-700 ring-1 ring-red-200', dot: 'bg-red-500' },
};

export const CUSTOMER_TIER = {
  A: { label: 'A · Strategic', short: 'A', cls: 'bg-violet-600 text-white' },
  B: { label: 'B · Key', short: 'B', cls: 'bg-blue-500 text-white' },
  C: { label: 'C · Standard', short: 'C', cls: 'bg-slate-400 text-white' },
};

export const STATUS_ORDER = ['LEAD', 'ACTIVE', 'INACTIVE', 'LOST'];
export const TIER_ORDER = ['A', 'B', 'C'];

export function statusMeta(status) {
  return CUSTOMER_STATUS[status] || CUSTOMER_STATUS.LEAD;
}

export function tierMeta(tier) {
  return CUSTOMER_TIER[tier] || CUSTOMER_TIER.C;
}
