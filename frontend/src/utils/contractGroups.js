// Contracts list grouping. One customer can have several machines in execution,
// so a group is customer + machine serial, not the customer alone. Files with
// no serial stay in their own group under that customer — they are never
// dropped and never given a serial that nobody typed.
//
// A customer whose files are all unnumbered keeps a plain customer header.
// "No serial" is only spelled out once that customer also has a numbered
// machine, because that is when the unnumbered files need a name of their own.

export const NO_SERIAL_LABEL = 'No serial'

export function machineSerialKey(value) {
  if (value == null) return null
  const s = String(value).trim().replace(/\s+/g, ' ')
  return s || null
}

export function groupContractFiles(items) {
  const byKey = new Map()
  for (const f of items || []) {
    const customerId = f?.customer?.id ?? 0
    const name = (f?.customer?.name || '').trim() || 'Unknown customer'
    const serial = machineSerialKey(f?.machineSerial)
    const key = `${customerId}\0${serial ?? ''}`
    let g = byKey.get(key)
    if (!g) {
      g = { key, customerId, name, serial, files: [], newest: 0 }
      byKey.set(key, g)
    } else if (g.name === 'Unknown customer' && name !== 'Unknown customer') {
      g.name = name
    }
    g.files.push(f)
    const t = new Date(f?.createdAt).getTime()
    if (Number.isFinite(t)) g.newest = Math.max(g.newest, t)
  }

  const numberedCustomers = new Set()
  for (const g of byKey.values()) {
    if (g.serial) numberedCustomers.add(g.customerId)
  }
  for (const g of byKey.values()) {
    g.serialLabel = g.serial || (numberedCustomers.has(g.customerId) ? NO_SERIAL_LABEL : '')
    // "Other" sinks inside the group. Sort is stable, so the rest keep the
    // order they arrived in — the list API sends newest first.
    g.files.sort((a, b) => (a.docType === 'OTHER' ? 1 : 0) - (b.docType === 'OTHER' ? 1 : 0))
  }

  const customerNewest = new Map()
  for (const g of byKey.values()) {
    customerNewest.set(g.customerId, Math.max(customerNewest.get(g.customerId) || 0, g.newest))
  }

  return [...byKey.values()].sort((a, b) => {
    const customerCmp = (customerNewest.get(b.customerId) || 0) - (customerNewest.get(a.customerId) || 0)
    if (customerCmp !== 0) return customerCmp
    const nameCmp = a.name.localeCompare(b.name)
    if (nameCmp !== 0) return nameCmp
    if (b.newest !== a.newest) return b.newest - a.newest
    // Same moment: a numbered machine reads before the unnumbered pile.
    if (Boolean(a.serial) !== Boolean(b.serial)) return a.serial ? -1 : 1
    return String(a.serial || '').localeCompare(String(b.serial || ''), undefined, { numeric: true })
  })
}

export function contractGroupTitle(group) {
  if (!group) return ''
  if (group.name && group.serialLabel) return `${group.name} · ${group.serialLabel}`
  return group.name || group.serialLabel || NO_SERIAL_LABEL
}
