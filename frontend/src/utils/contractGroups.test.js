import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { contractGroupTitle, groupContractFiles, NO_SERIAL_LABEL } from './contractGroups.js'

const CUSTOMER = 'Zhejiang Fuchunjiang Hydropower Equipment Co., Ltd.'

const file = (overrides) => ({
  id: 1,
  docType: 'COMMERCIAL',
  filename: 'contract.pdf',
  machineSerial: null,
  createdAt: '2026-10-21T00:00:00.000Z',
  customer: { id: 10, name: CUSTOMER },
  ...overrides,
})

test('same customer with two serials is two groups, and both files stay visible', () => {
  const commercial = file({ id: 1, machineSerial: '5.1022', docType: 'COMMERCIAL', createdAt: '2026-10-21T00:00:00.000Z' })
  const technical = file({ id: 2, machineSerial: '5.1022', docType: 'TECHNICAL', filename: 'Signed Technical Agreement.pdf', createdAt: '2026-09-18T00:00:00.000Z' })
  const otherMachine = file({ id: 3, machineSerial: '5.2044', docType: 'COMMERCIAL', createdAt: '2026-08-01T00:00:00.000Z' })

  const groups = groupContractFiles([commercial, technical, otherMachine])

  assert.equal(groups.length, 2)
  assert.equal(groups[0].serial, '5.1022')
  assert.equal(contractGroupTitle(groups[0]), `${CUSTOMER} · 5.1022`)
  assert.deepEqual(groups[0].files.map((f) => f.id), [1, 2])
  assert.equal(groups[1].serial, '5.2044')
  assert.equal(contractGroupTitle(groups[1]), `${CUSTOMER} · 5.2044`)
  assert.deepEqual(groups[1].files.map((f) => f.id), [3])
  assert.equal(groups.reduce((n, g) => n + g.files.length, 0), 3)
})

test('a file with no serial stays in a No serial group and is not dropped', () => {
  const numbered = file({ id: 1, machineSerial: '5.1022', createdAt: '2026-10-21T00:00:00.000Z' })
  const missing = file({ id: 2, machineSerial: null, createdAt: '2026-09-01T00:00:00.000Z' })
  const blank = file({ id: 3, machineSerial: '   ', createdAt: '2026-08-01T00:00:00.000Z' })
  const unset = file({ id: 4, createdAt: '2026-07-01T00:00:00.000Z' })
  delete unset.machineSerial

  const groups = groupContractFiles([numbered, missing, blank, unset])
  const none = groups.find((g) => g.serial == null)

  assert.ok(none)
  assert.equal(none.serialLabel, NO_SERIAL_LABEL)
  assert.equal(contractGroupTitle(none), `${CUSTOMER} · No serial`)
  assert.deepEqual(none.files.map((f) => f.id).sort((a, b) => a - b), [2, 3, 4])
  assert.equal(groups.reduce((n, g) => n + g.files.length, 0), 4)
})

test('unnumbered files keep a plain customer header until a serial exists beside them', () => {
  const a = file({ id: 1, machineSerial: null })
  const b = file({ id: 2, machineSerial: '' })
  const groups = groupContractFiles([a, b])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].serial, null)
  assert.equal(groups[0].serialLabel, '')
  assert.equal(contractGroupTitle(groups[0]), CUSTOMER)
  assert.deepEqual(groups[0].files.map((f) => f.id), [1, 2])
})

test('the same serial under two customers stays two groups', () => {
  const groups = groupContractFiles([
    file({ id: 1, machineSerial: '5.1022', customer: { id: 10, name: 'Alpha' }, createdAt: '2026-10-02T00:00:00.000Z' }),
    file({ id: 2, machineSerial: '5.1022', customer: { id: 11, name: 'Beta' }, createdAt: '2026-10-01T00:00:00.000Z' }),
  ])
  assert.deepEqual(groups.map((g) => [g.customerId, g.serial]), [[10, '5.1022'], [11, '5.1022']])
})

test('a customer’s machines stay together, newest customer first, Other sinks inside the group', () => {
  const groups = groupContractFiles([
    file({ id: 1, machineSerial: '5.1022', docType: 'OTHER', createdAt: '2026-01-01T00:00:00.000Z' }),
    file({ id: 2, machineSerial: '5.1022', docType: 'COMMERCIAL', createdAt: '2026-06-01T00:00:00.000Z' }),
    file({ id: 3, machineSerial: '5.2044', docType: 'TECHNICAL', createdAt: '2026-10-21T00:00:00.000Z' }),
    file({
      id: 4,
      machineSerial: '9.0001',
      customer: { id: 11, name: 'Older Customer' },
      createdAt: '2026-09-01T00:00:00.000Z',
    }),
  ])
  assert.deepEqual(groups.map((g) => g.serial), ['5.2044', '5.1022', '9.0001'])
  assert.deepEqual(groups[1].files.map((f) => f.id), [2, 1])
})

test('upload sends the serial and edit can clear it', () => {
  const modal = readFileSync(new URL('../components/ContractUploadModal.jsx', import.meta.url), 'utf8')
  assert.match(modal, /fd\.append\('machineSerial', serial\.trim\(\)\)/)
  assert.match(modal, /Machine serial \/ 机床序列号/)
  assert.match(modal, /placeholder="5\.1022"/)

  const page = readFileSync(new URL('../components/ContractsPage.jsx', import.meta.url), 'utf8')
  assert.match(page, /machineSerial: editing\.machineSerial\.trim\(\) \|\| null/)
  assert.match(page, /setUploadSerial\(g\.serial \|\| ''\)/)
  assert.match(page, /groupContractFiles/)
  assert.match(page, /Search file name, note, serial or customer/)
})
