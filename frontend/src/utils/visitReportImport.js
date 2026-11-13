// A suggested date or customer from the Word file fills an empty new form.
// An existing report, or a field the user has already changed, is left alone.
// A missing suggestion does not invent today's date.

export function chooseImportedDate({ existingReport = false, touched = false, current = '', suggested = null } = {}) {
  if (existingReport || touched) return current || ''
  return suggested || current || ''
}

export function chooseImportedCustomer({ touched = false, currentId = '', matchedId = null } = {}) {
  if (touched) return currentId || ''
  return currentId || matchedId || ''
}

export function warningMessages(warnings, t) {
  const lines = []
  for (const warning of warnings || []) {
    const code = warning?.code || 'extraction'
    const text = {
      'caption-unavailable': t.captionUnavailable,
      'caption-failed': t.captionFailed,
      'photo-not-stored': t.photoNotStored,
      'original-file-failed': t.originalFileFailed,
      'text-box': t.extractionWarning,
      'body-gap': t.extractionWarning,
      header: t.extractionWarning,
      footer: t.extractionWarning,
    }[code] || t.extractionWarning
    if (text && !lines.includes(text)) lines.push(text)
  }
  return lines
}
