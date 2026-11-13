import test from 'node:test'
import assert from 'node:assert/strict'
import { applyCaptionChange, savePayload } from './visitReportCaptions.js'

const saved = [
  { storedName: 'a.jpg', kind: 'image', caption: 'Original caption', captionEdited: true },
  { storedName: 'b.jpg', kind: 'image', caption: 'Leave this one' },
]

test('a typed caption is in the save payload without a blur step, and cancel keeps the saved text', () => {
  const draft = applyCaptionChange(saved, 'a.jpg', 'Typed just now without blurring')
  const payload = savePayload({ title: 'Northline visit', attachments: saved }, draft)

  assert.equal(payload.attachments[0].caption, 'Typed just now without blurring')
  assert.equal(payload.attachments[0].captionEdited, true)
  assert.equal(payload.attachments[0].regenerateCaption, undefined)
  assert.equal(payload.attachments[1].caption, 'Leave this one')
  assert.equal(payload.title, 'Northline visit')
  // Cancel discards the draft. The previously saved captions are unchanged.
  assert.equal(saved[0].caption, 'Original caption')
  assert.equal(saved[0].captionEdited, true)
})

test('regenerating a caption stays on the draft and does not clear a user edit until save', () => {
  const draft = applyCaptionChange(saved, 'a.jpg', 'Fresh from the photo', { regenerate: true })
  assert.equal(draft[0].caption, 'Fresh from the photo')
  assert.equal(draft[0].regenerateCaption, true)
  assert.equal(draft[0].captionEdited, undefined)
  assert.equal(saved[0].caption, 'Original caption')

  const typedAfter = applyCaptionChange(draft, 'a.jpg', 'Engineer correction')
  assert.equal(typedAfter[0].caption, 'Engineer correction')
  assert.equal(typedAfter[0].captionEdited, true)
  assert.equal(typedAfter[0].regenerateCaption, undefined)
  assert.equal(savePayload({ attachments: saved }, typedAfter).attachments[0].caption, 'Engineer correction')
})

test('a caption is limited to the stored length and other photos are copied through', () => {
  const long = 'x'.repeat(240)
  const draft = applyCaptionChange(saved, 'b.jpg', long)
  assert.equal(draft[1].caption.length, 200)
  assert.equal(draft[0].caption, 'Original caption')
  assert.notEqual(draft, saved)
})
