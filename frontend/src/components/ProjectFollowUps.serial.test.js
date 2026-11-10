import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadJsxModule } from '../test/loadJsx.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = readFileSync(new URL('./ProjectFollowUps.jsx', import.meta.url), 'utf8')

function memoryStorage() {
  const map = new Map()
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null },
    setItem(k, v) { map.set(k, String(v)) },
    removeItem(k) { map.delete(k) },
  }
}

test('the new follow-up form asks for an optional machine serial beside the model', async () => {
  globalThis.localStorage = memoryStorage()
  globalThis.sessionStorage = memoryStorage()
  const { AuthProvider, NewModal } = await loadJsxModule(path.join(here, 'ProjectFollowUps.jsx'))
  const html = renderToStaticMarkup(createElement(AuthProvider, null, createElement(NewModal, {
    users: [{ id: 2, name: 'Becky Chen' }],
    catalogue: [],
    seed: {
      title: 'Shenyang Fortune Precision Equipment Co., Ltd. — GRG-FCJM-202608A',
      machineType: 'ProfiMill evo 5000/80-G',
      orderNo: 'GRG-FCJM-202608A',
      team: 'WRC',
    },
    onClose: () => {},
    onCreated: () => {},
  })))

  const modelAt = html.indexOf('Machine model')
  const serialAt = html.indexOf('Machine serial')
  const valueAt = html.indexOf('Contract value')
  assert.ok(modelAt > -1 && serialAt > modelAt && valueAt > serialAt)
  const serialField = html.slice(serialAt, valueAt)
  assert.match(serialField, /Machine serial\s*<input[^>]*placeholder="Optional"/)
  assert.match(serialField, /value=""/)
  assert.doesNotMatch(serialField, /required/)
  assert.match(html, /ProfiMill evo 5000\/80-G/)
  assert.match(html, /Project \/ order name \*/)
  assert.doesNotMatch(html, /Machine serial \*/)

  // The create request is the form state, so a typed serial is part of the payload.
  const modal = source.slice(source.indexOf('export function NewModal'), source.indexOf('export default function ProjectFollowUps'))
  assert.match(modal, /machineSerial:\s*''/)
  assert.match(modal, /followUpsAPI\.create\(\{ \.\.\.form/)
  assert.match(modal, /followUpsAPI\.create\(\{ \.\.\.form, customerId: form\.customerId \|\| null \}, unlockToken\)/)
})

test('the detail header shows a serial and keeps the price behind the team PIN', async () => {
  const { FollowUpFactLine } = await loadJsxModule(path.join(here, 'ProjectFollowUps.jsx'))
  const amount = 'EUR 4,000,000.00'
  const base = {
    machineType: 'ProfiMill evo 5000/80-G',
    machineSerial: '5.1022',
    contractValue: amount,
    hasContractValue: true,
    team: 'WRC',
  }

  const locked = renderToStaticMarkup(createElement(FollowUpFactLine, {
    f: { ...base, contractValueLocked: true },
    unlocked: false,
  }))
  assert.match(locked, /ProfiMill evo 5000\/80-G/)
  assert.match(locked, /title="Machine serial"/)
  assert.match(locked, /Serial 5\.1022/)
  assert.match(locked, /Enter WRC PIN to view/)
  assert.doesNotMatch(locked, /4,000,000/)
  assert.doesNotMatch(locked, /EUR/)
  assert.doesNotMatch(locked, /💰/)

  // A stale amount left on a locked record is still not drawn, even if the
  // caller says the view is unlocked.
  const stale = renderToStaticMarkup(createElement(FollowUpFactLine, {
    f: { ...base, contractValueLocked: true },
    unlocked: true,
  }))
  assert.match(stale, /Serial 5\.1022/)
  assert.match(stale, /Enter WRC PIN to view/)
  assert.doesNotMatch(stale, /4,000,000/)
  assert.doesNotMatch(stale, /EUR/)

  const hidden = renderToStaticMarkup(createElement(FollowUpFactLine, {
    f: { ...base, contractValueHidden: true },
    unlocked: true,
  }))
  assert.match(hidden, /Serial 5\.1022/)
  assert.match(hidden, /Contract value restricted/)
  assert.doesNotMatch(hidden, /4,000,000/)
  assert.doesNotMatch(hidden, /EUR/)
  assert.doesNotMatch(hidden, /Enter WRC PIN/)

  const open = renderToStaticMarkup(createElement(FollowUpFactLine, {
    f: { ...base, contractValueLocked: false },
    unlocked: true,
  }))
  assert.match(open, /Serial 5\.1022/)
  assert.match(open, /EUR 4,000,000\.00/)
  assert.match(open, /💰/)
  assert.doesNotMatch(open, /Enter WRC PIN/)

  const blank = renderToStaticMarkup(createElement(FollowUpFactLine, {
    f: {
      machineType: 'WS 450',
      machineSerial: '   ',
      contractValue: null,
      contractValueLocked: true,
      hasContractValue: false,
      team: 'HRC',
    },
    unlocked: false,
  }))
  assert.match(blank, /WS 450/)
  assert.doesNotMatch(blank, /Serial/)
  assert.doesNotMatch(blank, /Enter HRC PIN/)

  const detail = source.slice(source.indexOf('function Detail('), source.indexOf('export function NewModal'))
  assert.match(detail, /<FollowUpFactLine/)
  assert.match(detail, /unlocked=\{Boolean\(unlock\?\.token\) && unlock\.team === f\.team\}/)
  const facts = source.slice(source.indexOf('export function FollowUpFactLine'), source.indexOf('export function FollowUpRow'))
  assert.match(facts, /<ContractValueLabel/)
})

test('the list card shows a saved serial and does not show the contract value', async () => {
  const { FollowUpRow } = await loadJsxModule(path.join(here, 'ProjectFollowUps.jsx'))
  const html = renderToStaticMarkup(createElement(FollowUpRow, {
    f: {
      id: 8,
      title: 'Shenyang Fortune',
      orderNo: 'GRG-FCJM-202608A',
      status: 'ACTIVE',
      machineSerial: '5.1022',
      machineType: 'ProfiMill evo 5000/80-G',
      contractValue: 'EUR 4,000,000.00',
      overdueCount: 0,
      doneCount: 1,
      totalDated: 3,
    },
    onOpen: () => {},
  }))
  assert.match(html, /#GRG-FCJM-202608A/)
  assert.match(html, /Serial 5\.1022/)
  assert.doesNotMatch(html, /4,000,000/)
  assert.doesNotMatch(html, /EUR/)
  assert.doesNotMatch(html, /💰/)
  assert.doesNotMatch(html, /Enter WRC PIN/)
  assert.doesNotMatch(html, /ProfiMill/)

  const empty = renderToStaticMarkup(createElement(FollowUpRow, {
    f: {
      id: 9,
      title: 'Older order',
      status: 'ACTIVE',
      machineSerial: null,
      overdueCount: 0,
      doneCount: 0,
      totalDated: 0,
    },
    onOpen: () => {},
  }))
  assert.doesNotMatch(empty, /Serial/)
})
