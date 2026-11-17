import { useEffect } from 'react'

export function PhotoLightbox({ photo, src, title, closeLabel, onClose }) {
  useEffect(() => {
    if (!photo) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [photo, onClose])

  if (!photo) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/80 p-4"
      onClick={onClose}
    >
      <figure className="max-w-4xl" onClick={(event) => event.stopPropagation()}>
        {src && (
          <img
            src={src}
            alt={photo.caption || title}
            className="max-h-[80vh] max-w-full rounded-lg object-contain"
          />
        )}
        {photo.caption && (
          <figcaption className="mt-3 max-w-full break-words px-2 text-center text-sm font-normal leading-relaxed text-white">{photo.caption}</figcaption>
        )}
        <button
          type="button"
          onClick={onClose}
          className="mt-3 block min-h-11 w-full text-center text-sm font-semibold text-white/80"
        >
          {closeLabel}
        </button>
      </figure>
    </div>
  )
}

export function PhotoFigure({
  photo,
  src,
  title,
  viewLabel,
  onOpen,
  captionClassName = 'mt-1.5 break-words text-sm font-normal leading-relaxed text-slate-700',
  imageClassName = 'max-h-80 w-full object-contain',
  frameClassName = 'block w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100',
}) {
  return (
    <figure data-inline-photo className="min-w-0">
      <button
        type="button"
        onClick={onOpen}
        aria-label={viewLabel}
        className={frameClassName}
      >
        {src ? (
          <img src={src} alt={photo.caption || title} className={imageClassName} />
        ) : (
          <span className="block aspect-[4/3] w-full" />
        )}
      </button>
      {photo.caption ? <figcaption className={captionClassName}>{photo.caption}</figcaption> : null}
    </figure>
  )
}

export function PhotoRow({ photos, srcs, title, viewLabel, onOpen }) {
  const items = Array.isArray(photos) ? photos.filter(Boolean) : []
  if (!items.length) return null
  const columns = items.length === 1
    ? 'grid-cols-1'
    : (items.length === 2 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3')
  return (
    <div data-inline-photos className={`grid ${columns} gap-x-3 gap-y-5`}>
      {items.map((photo) => (
        <PhotoFigure
          key={photo.storedName}
          photo={photo}
          src={srcs?.[photo.storedName]}
          title={title}
          viewLabel={viewLabel}
          onOpen={() => onOpen?.(photo)}
        />
      ))}
    </div>
  )
}
