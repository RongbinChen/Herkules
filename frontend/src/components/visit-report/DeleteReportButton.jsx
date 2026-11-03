import { useState } from 'react'
import { visitReportsAPI } from '../../api/api'
import { STRINGS } from '../../i18n/visitReports'
import { showDeleteVisitReport } from '../../utils/visitReportAccess'

const DEFAULT_CLASS = 'shrink-0 rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50'

// Renders nothing unless this user may delete the report. Confirms first.
// Callers that wrap the row in a click handler stay put because the click
// does not bubble.
export default function DeleteReportButton({ report, user, lang = 'en', className = '', onDeleted }) {
  const t = STRINGS[lang] || STRINGS.en
  const [busy, setBusy] = useState(false)
  if (!showDeleteVisitReport(report, user)) return null

  const onClick = async (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (busy) return
    const title = report.title || (lang === 'zh' ? '该报告' : 'this report')
    if (!window.confirm(t.deleteConfirm(title))) return
    setBusy(true)
    try {
      await visitReportsAPI.delete(report.id)
      onDeleted?.(report)
    } catch {
      window.alert(t.deleteFailed)
      setBusy(false)
    }
  }

  return (
    <button type="button" onClick={onClick} disabled={busy} className={className || DEFAULT_CLASS}>
      {busy ? t.deleting : t.delete}
    </button>
  )
}
