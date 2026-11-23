import test from 'node:test'
import assert from 'node:assert/strict'
import { parseIdParam, findById } from './deepLink.js'

test('parseIdParam reads positive integer query values', () => {
  assert.equal(parseIdParam('?event=504', 'event'), 504)
  assert.equal(parseIdParam('?id=3', 'id'), 3)
  assert.equal(parseIdParam('?id=0', 'id'), null)
  assert.equal(parseIdParam('?id=abc', 'id'), null)
  assert.equal(findById([{ id: 3, title: 'Demo' }, { id: 9 }], 3).title, 'Demo')
})
