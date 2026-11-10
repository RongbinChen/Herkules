// Machine serial on a contract file, e.g. "5.1022".
//
// Stored on ContractFile.machineSerial. Blank means "not entered" and is
// persisted as null — the list then keeps the file in a No serial group
// rather than inventing a number. The same rules apply on upload and on edit,
// so a value that was saved can be cleared later and a value that was cleared
// is what search and grouping see after reload.

const MAX_LEN = 40;
// A serial, not a sentence: a letter or digit, then letters, digits, dots,
// hyphens, slashes, underscores or single spaces. "5.1022" and "WS-180/2"
// pass. A pasted note does not.
const SERIAL_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._\-/]*$/u;

/**
 * @returns {{ ok: true, value: string | null } | { ok: false, error: string }}
 *   value is the string to store, or null when the field was left blank.
 */
export function normalizeMachineSerial(raw) {
  if (raw == null) return { ok: true, value: null };
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    return { ok: false, error: 'Machine serial is not valid' };
  }
  const s = String(raw).replace(/[\u0000-\u001F\u007F]/g, '').trim().replace(/\s+/g, ' ');
  if (!s) return { ok: true, value: null };
  if (s.length > MAX_LEN) {
    return { ok: false, error: 'Machine serial must be 40 characters or fewer' };
  }
  if (!SERIAL_RE.test(s)) {
    return { ok: false, error: 'Machine serial can only contain letters, numbers, dots, hyphens or slashes' };
  }
  return { ok: true, value: s };
}

// The cross-customer search box matches filename, note, customer name, and
// serial. One list, so a serial typed into that box finds the machine's files
// without a separate filter.
export function contractFileSearchOr(q) {
  const contains = { contains: q, mode: 'insensitive' };
  return [
    { filename: contains },
    { note: contains },
    { machineSerial: contains },
    { customer: { name: contains } },
  ];
}
