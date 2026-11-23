// Parse integer deep-link query params such as /calendar?event=504
// and /hotprojects?id=3 /chinabidding/bidopen?id=9.
export function parseIdParam(search, key) {
  const raw = new URLSearchParams(typeof search === 'string' ? search : search || '').get(key)
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

export function findById(rows, id) {
  if (!id) return null
  return (rows || []).find((row) => Number(row?.id) === Number(id)) || null
}
