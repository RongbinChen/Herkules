import { useEffect, useRef } from 'react'

// Sticky chat input. `children` render inside the same relative wrapper as the
// form, so a caller can float a panel above it (CommandSearch puts its slash
// command palette there).
//
// Two details that look cosmetic but are not:
//   - `text-base sm:text-sm` — iOS auto-zooms the viewport on focus for any
//     input under 16px, which leaves the page blown up and scrolled sideways.
//   - autoFocus only at ≥640px — on a phone it pops the keyboard on mount and
//     triggers that same zoom before the user has asked for anything.
export default function ChatComposer({
  value,
  onChange,
  onSubmit,
  placeholder = 'Type a message…',
  disabled = false,
  leftSlot = null,
  showClear = true,
  onClear,
  showSend = true,
  sendLabel = 'Send',
  sendDisabled,
  inputRef,
  autoFocusDesktop = true,
  children,
}) {
  const innerRef = useRef(null)
  const ref = inputRef || innerRef

  useEffect(() => {
    if (autoFocusDesktop && window.matchMedia?.('(min-width: 640px)').matches) ref.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const clear = () => {
    onClear ? onClear() : onChange('')
    ref.current?.focus()
  }

  return (
    <div className="sticky bottom-3 mt-auto">
      <div className="relative">
        <form
          onSubmit={(e) => { e.preventDefault(); onSubmit?.() }}
          className="flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-3 shadow-lg focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100"
        >
          {leftSlot}
          <input
            ref={ref}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            className="w-full bg-transparent text-base outline-none placeholder:text-slate-400 sm:text-sm"
            autoComplete="off"
            spellCheck={false}
          />
          {showClear && value && (
            <button type="button" onClick={clear}
              className="shrink-0 text-slate-300 hover:text-slate-500" aria-label="Clear">✕</button>
          )}
          {showSend && (
            <button type="submit" disabled={sendDisabled ?? (!value.trim() || disabled)}
              className="shrink-0 rounded-full bg-brand-600 px-4 py-1.5 text-xs font-bold text-white transition hover:bg-brand-700 disabled:opacity-40">
              {sendLabel}
            </button>
          )}
        </form>
        {children}
      </div>
    </div>
  )
}
