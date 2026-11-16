import { useEffect, useRef, useState } from 'react'
import { STRINGS } from '../../i18n/visitReports'
import { PhotoLightbox } from './PhotoMedia'
import useReportPhotoSrcs from './useReportPhotoSrcs'

// End-of-report gallery. Parents place this after the body (summary, sections,
// tables). Photos already shown at in-body `[]` marks should be omitted by
// the parent, so they are not repeated. No photos → render nothing.
//
// Reading (the detail page, and the modal before Edit) is static text.
// Caption fields and Regenerate exist only while the whole report is being edited.
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
  const { items, srcs } = useReportPhotoSrcs(photos, { reportId, draft })
  const [active, setActive] = useState(null)
  const [busy, setBusy] = useState('')

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

      <PhotoLightbox
        photo={active}
        src={active ? srcs[active.storedName] : undefined}
        title={t.reportPhotos}
        closeLabel={t.close}
        onClose={() => setActive(null)}
      />
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

