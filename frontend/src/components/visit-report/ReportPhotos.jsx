import { useEffect, useState } from 'react'
import { visitReportsAPI } from '../../api/api'
import { STRINGS } from '../../i18n/visitReports'

// End-of-report gallery. Parents place this after the body (summary, sections,
// tables). No photos → render nothing, so an empty report does not grow a box.
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
    if (!onRegenerate || busy) return
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
        ? 'mb-2 border-l-2 border-brand-400 pl-2 text-xs font-bold text-slate-500'
        : 'mb-2 border-l-[3px] border-brand-500 pl-2.5 text-sm font-bold text-slate-700'}>
        {t.reportPhotos}
      </h2>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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
            onRegenerate={onRegenerate ? () => regenerate(photo) : null}
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
              <figcaption className="mt-3 text-center text-sm text-white">{active.caption}</figcaption>
            )}
            <button
              type="button"
              onClick={() => setActive(null)}
              className="mt-3 block w-full text-center text-xs font-semibold text-white/80"
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
  const [caption, setCaption] = useState(photo.caption || '')
  useEffect(() => {
    setCaption(photo.caption || '')
  }, [photo.storedName, photo.caption])

  const commit = (event) => {
    if (event?.relatedTarget?.dataset?.action === 'regenerate-caption') return
    if ((caption || '') === (photo.caption || '')) return
    onCaptionChange?.(photo, caption)
  }

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
        <>
          <textarea
            rows={2}
            maxLength={200}
            value={caption}
            aria-label={t.captionPlaceholder}
            placeholder={t.captionPlaceholder}
            onChange={(event) => setCaption(event.target.value)}
            onBlur={commit}
            className="mt-1.5 w-full resize-none rounded-lg border border-slate-200 px-2 py-1 text-xs leading-snug text-slate-700"
          />
          {onRegenerate && (
            <button
              type="button"
              data-action="regenerate-caption"
              onClick={onRegenerate}
              disabled={busy}
              className="mt-1 text-[11px] font-semibold text-brand-600 hover:underline disabled:opacity-50"
            >
              {busy ? t.regeneratingCaption : t.regenerateCaption}
            </button>
          )}
        </>
      ) : (
        photo.caption ? <p className="mt-1.5 text-xs leading-snug text-slate-600">{photo.caption}</p> : null
      )}
    </li>
  )
}
