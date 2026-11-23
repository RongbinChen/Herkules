// Placement and filtering helpers for SearchableSelect.
//
// The activity modal's customer field used a native <select>. With hundreds of
// customers the browser menu opens upward and spills past the window (and the
// modal) top. These helpers keep a custom menu fully inside the viewport: a
// capped height with internal scrolling, flipped above the trigger only when
// there is more room there, and clamped so the top and sides never leave the
// visible area.

export const DEFAULT_MENU_MAX_HEIGHT = 320
export const MENU_GAP = 4
export const VIEWPORT_MARGIN = 8

export function filterOptions(options, query) {
  const list = Array.isArray(options) ? options : []
  const q = String(query ?? '').trim().toLowerCase()
  if (!q) return list
  return list.filter((option) => String(option?.label ?? '').toLowerCase().includes(q))
}

function numberOr(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

// Returns fixed-position box for a portalled menu. Units are CSS pixels.
// `triggerRect` is a DOMRect-like { top, bottom, left, right, width, height }.
// `viewport` is { width, height }.
export function placeMenu({
  triggerRect,
  viewport,
  preferredMaxHeight = DEFAULT_MENU_MAX_HEIGHT,
  gap = MENU_GAP,
  margin = VIEWPORT_MARGIN,
} = {}) {
  const viewportWidth = Math.max(0, numberOr(viewport?.width))
  const viewportHeight = Math.max(0, numberOr(viewport?.height))
  const triggerTop = numberOr(triggerRect?.top)
  const triggerBottom = numberOr(triggerRect?.bottom, triggerTop + numberOr(triggerRect?.height))
  const triggerLeft = numberOr(triggerRect?.left)
  const triggerWidth = numberOr(triggerRect?.width)

  const width = Math.min(Math.max(0, triggerWidth), Math.max(0, viewportWidth - margin * 2))
  let left = triggerLeft
  if (left + width > viewportWidth - margin) left = viewportWidth - margin - width
  if (left < margin) left = margin

  const spaceBelow = viewportHeight - triggerBottom - gap - margin
  const spaceAbove = triggerTop - gap - margin
  const placement = spaceBelow >= preferredMaxHeight || spaceBelow >= spaceAbove ? 'below' : 'above'
  const available = placement === 'below' ? spaceBelow : spaceAbove
  const maxHeight = Math.max(0, Math.min(preferredMaxHeight, available))

  let top = placement === 'below' ? triggerBottom + gap : triggerTop - gap - maxHeight
  const maxTop = Math.max(margin, viewportHeight - margin - maxHeight)
  if (top < margin) top = margin
  if (top > maxTop) top = maxTop

  return {
    top,
    left,
    width,
    maxHeight,
    placement,
  }
}

export function menuFitsViewport(box, viewport, margin = VIEWPORT_MARGIN) {
  const width = numberOr(viewport?.width)
  const height = numberOr(viewport?.height)
  return (
    box.top >= margin - 0.5
    && box.left >= margin - 0.5
    && box.top + box.maxHeight <= height - margin + 0.5
    && box.left + box.width <= width - margin + 0.5
  )
}
