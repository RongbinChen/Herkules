import { useState } from 'react'
import { contractsAPI } from '../api/api'
import { Button, Select, Textarea } from './ui'
import { CONTRACT_DOC_TYPES, DOC_TYPE_ORDER } from '../constants/contract'
import CustomerPicker from './CustomerPicker'
import FileDropZone from './FileDropZone'

// Fill-then-confirm, unlike the customer-detail card where picking a file
// uploads it straight away. Here the file has to be bound to a customer and a
// category first, so "upload on select" has nothing to upload to yet.
//
// Default category is COMMERCIAL rather than OTHER for the same reason: there is
// a confirm step, the person is deliberately filing something, and commercial
// contracts are the bulk of it. (The card defaults to OTHER precisely because it
// has no confirm step — see CustomerContracts.)
//
// A batch shares one customer, one category and one note, because that is how
// contract files actually arrive: a folder of scans for the same deal. Anything
// that needs a different category is a second trip through the dialog, or a
// PATCH from the list afterwards.
const MAX_BATCH = 20

// Same file twice — dropped, then picked again — must not upload twice. Name,
// size and mtime is as close to identity as the browser will give us.
const fileKey = (f) => `${f.name}|${f.size}|${f.lastModified}`

export default function ContractUploadModal({ token, team, initialCustomer = null, onClose, onUploaded }) {
  const [customer, setCustomer] = useState(initialCustomer)
  const [docType, setDocType] = useState('COMMERCIAL')
  const [note, setNote] = useState('')
  const [files, setFiles] = useState([])
  const [progress, setProgress] = useState(null)   // { index, total, pct }
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const ready = customer?.id && files.length > 0 && !busy

  function addFiles(incoming) {
    setErr('')
    setFiles((prev) => {
      const seen = new Set(prev.map(fileKey))
      const next = [...prev]
      let over = false
      for (const f of incoming) {
        if (seen.has(fileKey(f))) continue
        if (next.length >= MAX_BATCH) { over = true; break }
        seen.add(fileKey(f))
        next.push(f)
      }
      if (over) setErr(`At most ${MAX_BATCH} files at a time — the rest were left out.`)
      return next
    })
  }

  // Sequential, not parallel: the DGX is poked once per upload and a browser
  // firing twenty 40 MB requests at once is how a slow line ends up with twenty
  // timeouts instead of a few slow successes.
  async function submit(e) {
    e?.preventDefault()
    if (!ready) return
    setBusy(true)
    setErr('')

    const failed = []
    let done = 0
    for (let i = 0; i < files.length; i += 1) {
      const f = files[i]
      setProgress({ index: i + 1, total: files.length, pct: 0 })
      const fd = new FormData()
      fd.append('docType', docType)
      if (note.trim()) fd.append('note', note.trim())
      fd.append('file', f)
      try {
        await contractsAPI.upload(customer.id, token, fd, (evt) => {
          if (evt.total) setProgress({ index: i + 1, total: files.length, pct: Math.round((evt.loaded / evt.total) * 100) })
        })
        done += 1
      } catch (e2) {
        failed.push({ file: f, reason: e2.response?.data?.error || 'Upload failed' })
      }
    }

    setBusy(false)
    setProgress(null)
    // Whatever went up is on file, so refresh the list even on a partial run.
    if (done > 0) onUploaded()
    if (failed.length === 0) { onClose(); return }
    // Keep only what failed, so the retry is the same button with no re-picking.
    setFiles(failed.map((x) => x.file))
    setErr(
      failed.length === 1
        ? `${failed[0].file.name}: ${failed[0].reason}`
        : `${done} uploaded, ${failed.length} failed — still listed below. First error: ${failed[0].reason}`
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4" onClick={busy ? undefined : onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="my-8 w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">
            Upload contract files
            <span className="ml-2 text-xs font-semibold text-brand-600">{team}</span>
          </h2>
          <button type="button" onClick={onClose} disabled={busy} className="text-slate-400 transition hover:text-slate-700 disabled:opacity-40" aria-label="Close">✕</button>
        </div>

        {err && <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{err}</p>}

        <label className="block text-xs font-semibold text-slate-600">
          Customer <span className="text-rose-500">*</span>
          <div className="mt-1">
            <CustomerPicker value={customer} onChange={setCustomer} autoFocus />
          </div>
        </label>
        <p className="mt-1 text-[11px] text-slate-400">Not in the list? Type the name and pick “+ Create” from the dropdown.</p>

        <label className="mt-4 block text-xs font-semibold text-slate-600">
          Document type
          <Select value={docType} onChange={(e) => setDocType(e.target.value)} className="mt-1">
            {DOC_TYPE_ORDER.map((k) => (
              <option key={k} value={k}>{CONTRACT_DOC_TYPES[k].label}</option>
            ))}
          </Select>
        </label>

        {/* Not a <label>: the drop zone is itself a button, and nesting it in a
            label makes a click reach the hidden input twice — the picker opens,
            then reopens the moment it closes. */}
        <div className="mt-4 text-xs font-semibold text-slate-600">
          Files <span className="text-rose-500">*</span>
          {files.length > 1 && <span className="ml-1 font-normal text-slate-400">— {files.length} selected, all filed as “{CONTRACT_DOC_TYPES[docType].label}”</span>}
          <div className="mt-1">
            <FileDropZone
              multiple
              files={files}
              onFiles={addFiles}
              onRemove={(i) => setFiles((prev) => prev.filter((_, k) => k !== i))}
              disabled={busy}
              hint={`PDF / Word / Excel / PowerPoint / images / text, up to 40 MB each, ${MAX_BATCH} files at a time.`}
            />
          </div>
        </div>

        <label className="mt-4 block text-xs font-semibold text-slate-600">
          Note (optional)
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="mt-1" />
        </label>

        <div className="mt-6 flex items-center justify-end gap-2">
          {progress && (
            <span className="mr-auto text-xs font-semibold text-brand-600">
              {progress.total > 1 ? `${progress.index}/${progress.total} · ` : ''}{progress.pct}%
            </span>
          )}
          <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" size="sm" disabled={!ready}>
            {busy ? 'Uploading…' : files.length > 1 ? `Upload ${files.length} files` : 'Upload'}
          </Button>
        </div>
      </form>
    </div>
  )
}
