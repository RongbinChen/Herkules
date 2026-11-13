import { useEffect, useRef, useState } from 'react'
import { visitReportsAPI } from '../../api/api'
import { STRINGS } from '../../i18n/visitReports'

// End-of-report gallery. Parents place this after the body (summary, sections,
// tables). No photos → render nothing, so an empty report does not grow a box.
//
// Reading (the detail page, and the modal before Edit) is static text.
// Caption fields and Regenerate exist only while the whole report is being edited.
function displayable(photos) {
  if (!Array.isArray(photos)) return []
  return photos.filter((photo) => photo && photo.storedName && photo.kind !== 'document')
}

export default function ReportPhotos({
  lang = 'en',
  photos,
  reportId = null,
  draft = false,
  editable = false,
  compact = false,
  onCaptionChange,
  onRegenerate,
}) {
  const t = STRINGS[lang] || STRINGS.en
  const items = displayable(photos)
  const [srcs, setSrcs] = useState({})
  const [active, setActive] = useState(null)
  const [busy, setBusy] = useState('')
  const key = items.map((photo) => photo.storedName).join('\n')

  useEffect(() => {
    if (!key || (!reportId && !draft)) return undefined
    let cancelled = false
    const created = []
    const names = key.split('\n')
    ;(async () => {
      const next = {}
      for (const storedName of names) {
        try {
          const res = draft
            ? await visitReportsAPI.photoFile(storedName)
            : await visitReportsAPI.photo(reportId, storedName)
          if (cancelled) return
          const url = URL.createObjectURL(res.data)
          created.push(url)
          next[storedName] = url
        } catch {
          // A missing file leaves a blank tile; the caption is still shown.
        }
      }
      if (!cancelled) setSrcs(next)
    })()
    return () => {
      cancelled = true
      created.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [key, reportId, draft])

  useEffect(() => {
    if (!active) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') setActive(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  if (!items.length) return null

  const regenerate = async (photo) => {
    if (!editable || !onRegenerate || busy) return
    setBusy(photo.storedName)
    try {
      await onRegenerate(photo)
    } finally {
      setBusy('')
    }
  }

  return (
    <section className="mt-6" data-report-photos aria-label={t.reportPhotos}>
      <h2 className={compact
        ? 'mb-3 border-l-2 border-brand-400 pl-2 text-xs font-bold text-slate-500'
        : 'mb-3 border-l-[3px] border-brand-500 pl-2.5 text-sm font-bold text-slate-700'}>
        {t.reportPhotos}
      </h2>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3">
        {items.map((photo) => (
          <PhotoTile
            key={photo.storedName}
            photo={photo}
            src={srcs[photo.storedName]}
            editable={editable}
            busy={busy === photo.storedName}
            t={t}
            onOpen={() => setActive(photo)}
            onCaptionChange={onCaptionChange}
            onRegenerate={editable && onRegenerate ? () => regenerate(photo) : null}
          />
        ))}
      </ul>

      {active && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t.reportPhotos}
          className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/80 p-4"
          onClick={() => setActive(null)}
        >
          <figure className="max-w-4xl" onClick={(event) => event.stopPropagation()}>
            {srcs[active.storedName] && (
              <img
                src={srcs[active.storedName]}
                alt={active.caption || t.reportPhotos}
                className="max-h-[80vh] max-w-full rounded-lg object-contain"
              />
            )}
            {active.caption && (
              <figcaption className="mt-3 max-w-full break-words px-2 text-center text-sm font-normal leading-relaxed text-white">{active.caption}</figcaption>
            )}
            <button
              type="button"
              onClick={() => setActive(null)}
              className="mt-3 block min-h-11 w-full text-center text-sm font-semibold text-white/80"
            >
              {t.close}
            </button>
          </figure>
        </div>
      )}
    </section>
  )
}

function PhotoTile({ photo, src, editable, busy, t, onOpen, onCaptionChange, onRegenerate }) {
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={onOpen}
        aria-label={t.viewPhoto}
        className="block w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
      >
        {src ? (
          <img src={src} alt={photo.caption || t.reportPhotos} className="aspect-[4/3] w-full object-cover" />
        ) : (
          <span className="block aspect-[4/3] w-full" />
        )}
      </button>
      {editable ? (
        <CaptionEditor
          photo={photo}
          busy={busy}
          t={t}
          onCaptionChange={onCaptionChange}
          onRegenerate={onRegenerate}
        />
      ) : (
        photo.caption ? (
          <p className="mt-1.5 break-words text-sm font-normal leading-relaxed text-slate-600">{photo.caption}</p>
        ) : null
      )}
    </li>
  )
}

function CaptionEditor({ photo, busy, t, onCaptionChange, onRegenerate }) {
  const ref = useRef(null)
  const value = photo.caption || ''

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  return (
    <>
      <textarea
        ref={ref}
        rows={2}
        maxLength={200}
        value={value}
        data-caption-editor
        aria-label={t.captionPlaceholder}
        placeholder={t.captionPlaceholder}
        onChange={(event) => onCaptionChange?.(photo, event.target.value)}
        className="mt-1.5 box-border w-full min-w-0 resize-none overflow-hidden rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm font-normal leading-relaxed text-slate-700"
      />
      {onRegenerate && (
        <button
          type="button"
          data-action="regenerate-caption"
          onClick={onRegenerate}
          disabled={busy}
          className="mt-0.5 flex min-h-11 w-full items-center text-left text-xs font-semibold leading-snug text-brand-600 disabled:opacity-50"
        >
          {busy ? t.regeneratingCaption : t.regenerateCaption}
        </button>
      )}
    </>
  )
}
