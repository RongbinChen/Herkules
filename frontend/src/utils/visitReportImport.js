import { isChromeParagraph } from '../../../shared/originalBodyBlocks.js'

// A suggested date or customer from the Word file fills an empty new form.
// An existing report, or a field the user has already changed, is left alone.
// A missing suggestion does not invent today's date.

export function chooseImportedDate({ existingReport = false, touched = false, current = '', suggested = null } = {}) {
  if (existingReport || touched) return current || ''
  // A missing suggestion must not keep a new form's default "today".
  return suggested || ''
}

export function chooseImportedCustomer({ touched = false, currentId = '', matchedId = null } = {}) {
  if (touched) return currentId || ''
  return currentId || matchedId || ''
}

export function isUnsetImportedTitle(value) {
  const title = String(value || '').trim()
  return !title || isChromeParagraph(title)
}

// A suggested title from the Word file or the model fills an empty or
// template-placeholder field. A title the user already typed, or a genuine
// imported heading, is left alone.
export function chooseImportedTitle({ touched = false, current = '', suggested = null } = {}) {
  if (touched) return current || ''
  if (!isUnsetImportedTitle(current)) return current
  return suggested || ''
}


export function warningMessages(warnings, t, { hasOriginalFile = false } = {}) {
  const lines = []
  // The extraction note only promises the Word download when a stored
  // `kind: 'document'` attachment actually exists, so the text and the
  // conditional download button stay in agreement.
  const extractionText = (hasOriginalFile && t.extractionWarningDownload) || t.extractionWarning
  for (const warning of warnings || []) {
    const code = warning?.code || 'extraction'
    const text = {
      'caption-unavailable': t.captionUnavailable,
      'caption-failed': t.captionFailed,
      'photo-not-stored': t.photoNotStored,
      'original-file-failed': t.originalFileFailed,
      'text-box': extractionText,
      'body-gap': extractionText,
      header: extractionText,
      footer: extractionText,
    }[code] || extractionText
    if (text && !lines.includes(text)) lines.push(text)
  }
  return lines
}

const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/

export function missingSaveFields({ title, visitDate } = {}) {
  return {
    missingTitle: isUnsetImportedTitle(title),
    missingDate: !DATE_ISO.test(String(visitDate || '').trim()),
  }
}

export function saveValidationMessage(fields, t = {}) {
  const { missingTitle, missingDate } = missingSaveFields(fields)
  if (missingTitle && missingDate) return t.errTitleAndVisitDateRequired || ''
  if (missingTitle) return t.errTitleRequired || ''
  if (missingDate) return t.errVisitDateRequired || ''
  return ''
}

// After a preserved Word import, warn only when the date field will actually
// be empty. A date the user already set, or one found in the letterhead, is
// not a reason to nag.
export function shouldWarnMissingImportedDate({
  preserved = false,
  existingReport = false,
  touched = false,
  current = '',
  suggested = null,
} = {}) {
  if (!preserved) return false
  return !chooseImportedDate({ existingReport, touched, current, suggested })
}
