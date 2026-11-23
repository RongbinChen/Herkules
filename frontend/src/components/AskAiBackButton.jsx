import useAppBack from '../hooks/useAppBack'

const DEFAULT_CLASS =
  'rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50'

// Shown only when the page was opened from Ask AI, so list pages that do not
// otherwise have a "back to module" control can still return to /search.
export default function AskAiBackButton({ className = DEFAULT_CLASS, lang }) {
  const { source, label, go } = useAppBack(null, '', lang)
  if (source !== 'search') return null
  return (
    <button type="button" onClick={go} className={className}>
      {label}
    </button>
  )
}
