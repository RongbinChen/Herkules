import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { DEFAULT_MENU_MAX_HEIGHT, filterOptions, placeMenu } from '../utils/searchableSelect'

// Searchable dropdown used by the activity modal's Customer field. A native
// <select> cannot filter and, with a long customer list, opens upward and
// spills past the window top. The menu is portalled to document.body so the
// modal's overflow-hidden / overflow-y-auto ancestors cannot clip it; position
// is measured from the trigger and clamped to the viewport.
export default function SearchableSelect({
  options = [],
  value = '',
  onChange,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyMessage = 'No matches',
  disabled = false,
  id,
  'aria-label': ariaLabel,
  // Test-only: render the menu open without a click. Production callers omit it.
  defaultOpen = false,
  defaultQuery = '',
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen))
  const [query, setQuery] = useState(defaultQuery)
  const [highlight, setHighlight] = useState(0)
  const [menuBox, setMenuBox] = useState(null)
  const triggerRef = useRef(null)
  const searchRef = useRef(null)
  const listRef = useRef(null)
  const reactId = useId()
  const listId = id ? `${id}-listbox` : `${reactId}-listbox`

  const selected = useMemo(
    () => options.find((option) => String(option.value) === String(value)) || null,
    [options, value],
  )
  const matches = useMemo(() => filterOptions(options, query), [options, query])

  const place = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger || typeof window === 'undefined') return null
    const box = placeMenu({
      triggerRect: trigger.getBoundingClientRect(),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      preferredMaxHeight: DEFAULT_MENU_MAX_HEIGHT,
    })
    setMenuBox(box)
    return box
  }, [])

  useEffect(() => {
    if (!open) return undefined
    place()
    window.addEventListener('resize', place)
    // Capture scroll from the modal body as well as the window.
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, place])

  useEffect(() => {
    if (!open) return undefined
    const q = String(query ?? '').trim()
    if (q) {
      setHighlight(0)
      return undefined
    }
    const selectedIndex = matches.findIndex((option) => String(option.value) === String(value))
    setHighlight(selectedIndex >= 0 ? selectedIndex : 0)
    return undefined
  }, [open, query, matches, value])

  useEffect(() => {
    if (!open) return undefined
    const frame = window.requestAnimationFrame?.(() => searchRef.current?.focus())
    return () => {
      if (frame != null && window.cancelAnimationFrame) window.cancelAnimationFrame(frame)
    }
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const node = listRef.current?.querySelector('[data-highlighted="true"]')
    node?.scrollIntoView({ block: 'nearest' })
    return undefined
  }, [open, highlight, matches])

  function close() {
    setOpen(false)
    setQuery('')
    setMenuBox(null)
  }

  function openMenu(nextQuery = '') {
    if (disabled) return
    setQuery(nextQuery)
    place()
    setOpen(true)
  }

  function pick(option) {
    onChange?.(option ? String(option.value) : '')
    close()
    triggerRef.current?.focus()
  }

  function onTriggerKeyDown(event) {
    if (disabled) return
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openMenu('')
      return
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      openMenu(event.key)
    }
  }

  function onSearchKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (matches.length === 0) return
      setHighlight((index) => (index + 1) % matches.length)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (matches.length === 0) return
      setHighlight((index) => (index - 1 + matches.length) % matches.length)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (matches[highlight]) pick(matches[highlight])
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      triggerRef.current?.focus()
    }
  }

  const canPortal = typeof document !== 'undefined'
  const menuStyle = menuBox
    ? {
        top: menuBox.top,
        left: menuBox.left,
        width: menuBox.width,
        maxHeight: menuBox.maxHeight,
      }
    : {
        // SSR / unit tests have no layout. Still advertise a capped, scrolling menu.
        maxHeight: DEFAULT_MENU_MAX_HEIGHT,
      }

  const menu = open ? (
    <div
      className="fixed z-[1200] flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
      data-searchable-select-menu="true"
      data-placement={menuBox?.placement || ''}
      style={menuStyle}
    >
      <div className="shrink-0 border-b border-slate-100 bg-white p-2">
        <input
          ref={searchRef}
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onSearchKeyDown}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          aria-controls={listId}
          aria-autocomplete="list"
          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:bg-white"
        />
      </div>
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        className="min-h-0 flex-1 overflow-y-auto py-1"
        data-searchable-select-list="true"
      >
        {matches.length === 0 ? (
          <li className="px-3 py-2 text-sm text-slate-400">{emptyMessage}</li>
        ) : matches.map((option, index) => {
          const isSelected = String(option.value) === String(value)
          const isHighlighted = index === highlight
          return (
            <li key={String(option.value)}>
              <button
                type="button"
                role="option"
                aria-selected={isSelected}
                data-highlighted={isHighlighted ? 'true' : 'false'}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => pick(option)}
                className={[
                  'block w-full truncate px-3 py-2 text-left text-sm transition',
                  isHighlighted ? 'bg-brand-50 text-slate-900' : 'text-slate-700',
                  isSelected && !isHighlighted ? 'font-semibold text-slate-900' : '',
                ].filter(Boolean).join(' ')}
              >
                {option.label}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  ) : null

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        id={id}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : openMenu(''))}
        onKeyDown={onTriggerKeyDown}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-left text-slate-900 outline-none transition focus:border-brand-500 disabled:cursor-default disabled:bg-slate-100 disabled:text-slate-600"
        data-searchable-select-trigger="true"
      >
        <span className={`min-w-0 truncate ${selected ? '' : 'text-slate-400'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <span className="pointer-events-none shrink-0 text-xs text-slate-400" aria-hidden="true">▾</span>
      </button>
      {open && canPortal && menuBox && createPortal(
        <>
          <div className="fixed inset-0 z-[1190]" onMouseDown={close} data-searchable-select-backdrop="true" />
          {menu}
        </>,
        document.body,
      )}
      {open && !canPortal && menu}
    </div>
  )
}
