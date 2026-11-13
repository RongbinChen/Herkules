// Caption edits live on the report draft until Save Draft / Save & Finalize.
// Reading a report does not call these. Cancel throws the draft away, so the
// saved row is untouched: these helpers never mutate the array they are given.

const MAX = 200

function clip(caption) {
  return String(caption ?? '').replace(/[\u0000-\u001f]+/g, ' ').slice(0, MAX)
}

export function applyCaptionChange(attachments, storedName, caption, { regenerate = false } = {}) {
  const text = clip(caption)
  return (Array.isArray(attachments) ? attachments : []).map((item) => {
    if (!item || item.storedName !== storedName) return item
    if (regenerate) {
      const next = { ...item, caption: text, regenerateCaption: true }
      delete next.captionEdited
      return next
    }
    const next = { ...item, caption: text, captionEdited: true }
    delete next.regenerateCaption
    return next
  })
}

// Save reads the ref, not a possibly stale copy of the form. A caption typed
// in the same moment as Save is already on that ref.
export function savePayload(form, attachments) {
  return {
    ...form,
    attachments: Array.isArray(attachments) ? attachments : (form?.attachments || []),
  }
}
