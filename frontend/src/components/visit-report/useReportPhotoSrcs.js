import { useEffect, useState } from 'react'
import { visitReportsAPI } from '../../api/api'
import { displayablePhotos } from '../../../../shared/inlineBodyPhotos.js'

export default function useReportPhotoSrcs(photos, { reportId = null, draft = false } = {}) {
  const items = displayablePhotos(photos)
  const [srcs, setSrcs] = useState({})
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

  return { items, srcs }
}
