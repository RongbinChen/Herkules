import { useCallback, useEffect, useRef, useState } from 'react'
import { ACCEPT_ATTR, fmtFileSize, validateContractFile } from '../constants/contract'

/**
 * Drag-and-drop file target that is also a plain file picker.
 *
 * Drop is an addition, never a replacement: the hidden <input type="file"> is
 * still the real control, so clicking, tabbing and screen readers keep working
 * exactly as before and touch devices — which cannot drag — lose nothing.
 *
 * Three things browsers make easy to get wrong, all handled here:
 *
 * 1. `dragover` MUST preventDefault or `drop` never fires at all. Silently.
 * 2. `dragenter`/`dragleave` fire for every child element, so tracking a
 *    boolean makes the highlight flicker as the cursor crosses the inner text.
 *    A depth counter is the standard fix.
 * 3. Dropping a file anywhere else on the page makes the browser NAVIGATE to
 *    it, discarding whatever the user had typed into the form. Missing the
 *    zone by twenty pixels should not cost them the page, so while this
 *    component is mounted, drops outside it are swallowed.
 *
 * Validation mirrors the server (see constants/contract.js) purely to fail
 * fast — the 40 MB check is the point, since without it a rejected file is
 * only rejected after all 40 MB have crossed the wire.
 */
export default function FileDropZone({
  onFile,
  disabled = false,
  file = null,
  onClear = null,
  hint = 'PDF / Word / Excel / PowerPoint / images / text, up to 40 MB.',
  compact = false,
}) {
  const [over, setOver] = useState(false)
  const [err, setErr] = useState('')
  const depth = useRef(0)
  const inputRef = useRef(null)

  // Guard the rest of the window: without this, a near miss navigates away.
  useEffect(() => {
    const swallow = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'none' }
    window.addEventListener('dragover', swallow)
    window.addEventListener('drop', swallow)
    return () => {
      window.removeEventListener('dragover', swallow)
      window.removeEventListener('drop', swallow)
    }
  }, [])

  const take = useCallback((f, extra = '') => {
    const problem = validateContractFile(f)
    if (problem) { setErr(problem); return }
    setErr(extra)
    onFile(f)
  }, [onFile])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    depth.current = 0
    setOver(false)
    if (disabled) return
    const dropped = Array.from(e.dataTransfer?.files || [])
    if (!dropped.length) { setErr('Nothing usable was dropped — try a single file'); return }
    // One file per contract row, so extra files would vanish without a word.
    take(dropped[0], dropped.length > 1 ? `${dropped.length} files dropped — kept “${dropped[0].name}”` : '')
  }, [disabled, take])

  const onDragEnter = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    depth.current += 1
    if (!disabled) setOver(true)
  }, [disabled])

  const onDragLeave = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    depth.current = Math.max(0, depth.current - 1)
    if (depth.current === 0) setOver(false)
  }, [])

  const onDragOver = useCallback((e) => {
    e.preventDefault()   // without this the drop event never arrives
    e.stopPropagation()
    e.dataTransfer.dropEffect = disabled ? 'none' : 'copy'
  }, [disabled])

  const open = () => { if (!disabled) inputRef.current?.click() }

  const border = over ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-slate-50 hover:border-brand-300'

  return (
    <div>
      <div
        onDrop={onDrop}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onClick={open}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } }}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="Choose a file or drop one here"
        aria-disabled={disabled}
        className={`cursor-pointer rounded-xl border-2 border-dashed text-center transition ${border} ${
          compact ? 'px-3 py-3' : 'px-4 py-6'
        } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTR}
          disabled={disabled}
          // Cleared on every pick so choosing the same file twice still fires.
          onClick={(e) => { e.stopPropagation(); e.currentTarget.value = '' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) take(f) }}
          className="hidden"
        />

        {file ? (
          <div className="flex min-w-0 items-center justify-center gap-2">
            <span className="min-w-0 truncate text-sm font-semibold text-slate-700">{file.name}</span>
            <span className="shrink-0 text-[11px] text-slate-400">{fmtFileSize(file.size)}</span>
            {onClear && !disabled && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setErr(''); onClear() }}
                className="shrink-0 text-xs font-semibold text-slate-400 transition hover:text-rose-500"
                aria-label="Remove the selected file"
              >
                ✕
              </button>
            )}
          </div>
        ) : (
          <p className={`font-medium text-slate-500 ${compact ? 'text-xs' : 'text-sm'}`}>
            {over ? 'Drop to attach' : <>Drop a file here, or <span className="font-semibold text-brand-600">browse</span></>}
          </p>
        )}
      </div>

      {err
        ? <p className="mt-1 text-[11px] font-medium text-rose-600">{err}</p>
        : hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
    </div>
  )
}
