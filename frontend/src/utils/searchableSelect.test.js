import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_MENU_MAX_HEIGHT,
  VIEWPORT_MARGIN,
  filterOptions,
  menuFitsViewport,
  placeMenu,
} from './searchableSelect.js'

const OPTIONS = [
  { value: '1', label: 'Alpha Mill Co.' },
  { value: '2', label: 'Beta Machinery Works' },
  { value: '3', label: 'Gamma Plant Ltd.' },
  { value: '4', label: 'beta north warehouse' },
]

test('filterOptions is case-insensitive and matches name substrings', () => {
  assert.deepEqual(filterOptions(OPTIONS, '').map((o) => o.value), ['1', '2', '3', '4'])
  assert.deepEqual(filterOptions(OPTIONS, '   ').map((o) => o.value), ['1', '2', '3', '4'])
  assert.deepEqual(filterOptions(OPTIONS, 'beta').map((o) => o.label), [
    'Beta Machinery Works',
    'beta north warehouse',
  ])
  assert.deepEqual(filterOptions(OPTIONS, 'MILL').map((o) => o.value), ['1'])
  assert.deepEqual(filterOptions(OPTIONS, 'plant ltd').map((o) => o.value), ['3'])
  assert.equal(filterOptions(OPTIONS, 'nope').length, 0)
  assert.equal(filterOptions(undefined, 'beta').length, 0)
})

test('filterOptions does not match against fields that are not the option label', () => {
  const withAddress = [
    { value: '1', label: 'Alpha Mill Co.', address: 'Hidden Harbor Road' },
  ]
  assert.equal(filterOptions(withAddress, 'Harbor').length, 0)
  assert.equal(filterOptions(withAddress, 'Alpha').length, 1)
})

test('placeMenu opens below the trigger when there is enough room', () => {
  const viewport = { width: 1280, height: 800 }
  const triggerRect = { top: 120, bottom: 160, left: 200, right: 520, width: 320, height: 40 }
  const box = placeMenu({ triggerRect, viewport })

  assert.equal(box.placement, 'below')
  assert.equal(box.top, 164)
  assert.equal(box.left, 200)
  assert.equal(box.width, 320)
  assert.equal(box.maxHeight, DEFAULT_MENU_MAX_HEIGHT)
  assert.equal(menuFitsViewport(box, viewport), true)
})

test('placeMenu flips above when the trigger is low and keeps a capped menu in view', () => {
  const viewport = { width: 1280, height: 800 }
  // Trigger sits low in the window, the way the activity modal's Customer field does.
  const triggerRect = { top: 620, bottom: 660, left: 80, right: 480, width: 400, height: 40 }
  const box = placeMenu({ triggerRect, viewport, preferredMaxHeight: 320 })

  assert.equal(box.placement, 'above')
  assert.equal(box.maxHeight, 320)
  assert.equal(box.top, triggerRect.top - 4 - box.maxHeight)
  assert.ok(box.top >= VIEWPORT_MARGIN)
  assert.equal(box.top + box.maxHeight, triggerRect.top - 4)
  assert.equal(menuFitsViewport(box, viewport), true)
})

test('placeMenu shrinks when opening upward would otherwise spill past the top', () => {
  const viewport = { width: 800, height: 400 }
  const triggerRect = { top: 280, bottom: 320, left: 40, right: 440, width: 400, height: 40 }
  const box = placeMenu({ triggerRect, viewport, preferredMaxHeight: 320 })

  assert.equal(box.placement, 'above')
  assert.ok(box.maxHeight < 320)
  assert.equal(box.top, VIEWPORT_MARGIN)
  assert.equal(box.top + box.maxHeight, triggerRect.top - 4)
  assert.ok(box.top >= VIEWPORT_MARGIN)
  assert.equal(menuFitsViewport(box, viewport), true)
})

test('placeMenu still stays inside the viewport when even the larger side is short', () => {
  const viewport = { width: 400, height: 200 }
  const triggerRect = { top: 80, bottom: 120, left: 20, right: 220, width: 200, height: 40 }
  const box = placeMenu({ triggerRect, viewport, preferredMaxHeight: 320 })

  assert.ok(box.maxHeight <= 320)
  assert.ok(box.maxHeight > 0)
  assert.equal(menuFitsViewport(box, viewport), true)
})

test('placeMenu clamps horizontal overflow at the viewport edges', () => {
  const viewport = { width: 400, height: 600 }
  const hangingOffRight = placeMenu({
    triggerRect: { top: 40, bottom: 80, left: 300, right: 700, width: 400, height: 40 },
    viewport,
  })
  assert.equal(hangingOffRight.left + hangingOffRight.width, viewport.width - VIEWPORT_MARGIN)
  assert.ok(hangingOffRight.left >= VIEWPORT_MARGIN)
  assert.ok(hangingOffRight.width <= viewport.width - VIEWPORT_MARGIN * 2)
  assert.equal(menuFitsViewport(hangingOffRight, viewport), true)

  const hangingOffLeft = placeMenu({
    triggerRect: { top: 40, bottom: 80, left: -80, right: 120, width: 200, height: 40 },
    viewport,
  })
  assert.equal(hangingOffLeft.left, VIEWPORT_MARGIN)
  assert.equal(menuFitsViewport(hangingOffLeft, viewport), true)
})
