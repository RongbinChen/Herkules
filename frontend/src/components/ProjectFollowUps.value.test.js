import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadJsxModule } from '../test/loadJsx.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const AMOUNT = 'EUR 38,000,000.00'

const followUp = {
  id: 12,
  title: 'Hengli Engine (Dalian) Co., Ltd. - 4 milling machines',
  team: 'WRC',
  orderNo: '26HMSQ-Siegen0902-0212-G',
  status: 'ACTIVE',
  machineType: 'PROFIMILL 8000/120-G',
  contractValue: AMOUNT,
  hasContractValue: true,
  owner: { name: 'Becky Chen' },
  customer: { name: 'Hengli Engine (Dalian) Co., Ltd.' },
  doneCount: 1,
  totalDated: 4,
  overdueCount: 0,
  next: null,
}

test('the follow-up header does not render the contract value until unlock', async () => {
  const { ContractValueLabel } = await loadJsxModule(path.join(here, 'ProjectFollowUps.jsx'))

  const locked = renderToStaticMarkup(createElement(ContractValueLabel, {
    followUp: { ...followUp, contractValueLocked: true },
    unlocked: false,
  }))
  assert.match(locked, /Enter WRC PIN to view/)
  assert.doesNotMatch(locked, /38,000,000/)
  assert.doesNotMatch(locked, /EUR/)
  assert.doesNotMatch(locked, /💰/)

  // A stale amount left on a locked record is still not drawn.
  const stale = renderToStaticMarkup(createElement(ContractValueLabel, {
    followUp: { ...followUp, contractValueLocked: true, contractValue: AMOUNT },
    unlocked: true,
  }))
  assert.match(stale, /Enter WRC PIN to view/)
  assert.doesNotMatch(stale, /38,000,000/)
  assert.doesNotMatch(stale, /EUR/)

  const hidden = renderToStaticMarkup(createElement(ContractValueLabel, {
    followUp: { ...followUp, contractValueHidden: true, contractValue: AMOUNT },
    unlocked: true,
  }))
  assert.match(hidden, /Contract value restricted/)
  assert.doesNotMatch(hidden, /38,000,000/)
  assert.doesNotMatch(hidden, /EUR/)
  assert.doesNotMatch(hidden, /Enter WRC PIN/)

  const open = renderToStaticMarkup(createElement(ContractValueLabel, {
    followUp: { ...followUp, contractValueLocked: false },
    unlocked: true,
  }))
  assert.match(open, /EUR 38,000,000\.00/)
  assert.match(open, /💰/)
  assert.doesNotMatch(open, /Enter WRC PIN/)

  const empty = renderToStaticMarkup(createElement(ContractValueLabel, {
    followUp: { ...followUp, contractValue: null, contractValueLocked: true, hasContractValue: false },
  }))
  assert.equal(empty, '')
})

test('the follow-up list does not render the contract value', async () => {
  const { FollowUpRow } = await loadJsxModule(path.join(here, 'ProjectFollowUps.jsx'))
  const html = renderToStaticMarkup(createElement(FollowUpRow, {
    f: followUp,
    onOpen() {},
  }))
  assert.match(html, /Hengli Engine/)
  assert.match(html, /Becky Chen/)
  assert.doesNotMatch(html, /38,000,000/)
  assert.doesNotMatch(html, /EUR/)
  assert.doesNotMatch(html, /💰/)
})

test('a locked price is not treated as an empty field that fill-in may overwrite', async () => {
  const { missingContractFields } = await loadJsxModule(path.join(here, 'ProjectFollowUps.jsx'))
  const base = { machineType: 'PROFIMILL 8000/120-G', orderNo: '26HMSQ', contractValue: null }

  assert.deepEqual(missingContractFields({
    ...base, contractValueLocked: true, hasContractValue: true,
  }), [])
  assert.deepEqual(missingContractFields({
    ...base, contractValue: AMOUNT, contractValueHidden: true,
  }), [])
  assert.deepEqual(missingContractFields({
    ...base, contractValueLocked: true, hasContractValue: false,
  }), ['contractValue'])
  assert.deepEqual(missingContractFields({
    ...base, contractValue: AMOUNT, contractValueLocked: false,
  }), [])
  assert.deepEqual(missingContractFields({
    machineType: '', orderNo: '', contractValue: '', contractValueLocked: false,
  }), ['machineType', 'contractValue', 'orderNo'])
})
