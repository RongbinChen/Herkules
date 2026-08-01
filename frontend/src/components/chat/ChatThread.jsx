import { useEffect, useRef } from 'react'
import { Md } from './ChatMarkdown'

// Assistant chat transcript: user bubbles right, assistant bubbles left with
// markdown, plus a spinner bubble while a reply is in flight. Scrolls itself to
// the bottom whenever the thread or the loading state changes.
//
// `renderMeta(message)` hangs extra content under an assistant bubble —
// CommandSearch uses it for the "Queried …" tool chips. Keep it a render prop
// so this component stays unaware of what a given caller's messages carry.
export default function ChatThread({
  messages = [],
  loading = false,
  loadingLabel = 'Thinking…',
  renderMeta,
  className = '',
}) {
  const endRef = useRef(null)
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])

  return (
    <div className={`flex-1 space-y-3 ${className}`}>
      {messages.map((m, i) => (
        m.role === 'user' ? (
          <div key={i} className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-600 px-4 py-2.5 text-sm text-white">
              {m.content}
            </div>
          </div>
        ) : (
          <div key={i} className="flex min-w-0 justify-start">
            <div className={`min-w-0 max-w-[95%] overflow-hidden rounded-2xl rounded-bl-md border bg-white px-4 py-3 shadow-sm ${m.isError ? 'border-rose-200' : 'border-slate-200'}`}>
              <Md text={m.content} />
              {renderMeta?.(m)}
            </div>
          </div>
        )
      ))}
      {loading && (
        <div className="flex justify-start">
          <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-400 shadow-sm">
            <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            {loadingLabel}
          </div>
        </div>
      )}
      <div ref={endRef} />
    </div>
  )
}
