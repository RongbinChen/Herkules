import { useRef, useState } from 'react'
import { contractsAPI } from '../api/api'
import { Button, Select, Textarea } from './ui'
import { CONTRACT_DOC_TYPES, DOC_TYPE_ORDER } from '../constants/contract'
import CustomerPicker from './CustomerPicker'

// Fill-then-confirm, unlike the customer-detail card where picking a file
// uploads it straight away. Here the file has to be bound to a customer and a
// category first, so "upload on select" has nothing to upload to yet.
//
// Default category is COMMERCIAL rather than OTHER for the same reason: there is
// a confirm step, the person is deliberately filing something, and commercial
// contracts are the bulk of it. (The card defaults to OTHER precisely because it
// has no confirm step — see CustomerContracts.)
export default function ContractUploadModal({ token, team, initialCustomer = null, onClose, onUploaded }) {
  const [customer, setCustomer] = useState(initialCustomer)
  const [docType, setDocType] = useState('COMMERCIAL')
  const [note, setNote] = useState('')
  const [file, setFile] = useState(null)
  const [progress, setProgress] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef(null)

  const ready = customer?.id && file && !busy

  async function submit(e) {
    e?.preventDefault()
    if (!ready) return
    setBusy(true)
    setErr('')
    setProgress(0)
    const fd = new FormData()
    fd.append('docType', docType)
    if (note.trim()) fd.append('note', note.trim())
    fd.append('file', file)
    try {
      await contractsAPI.upload(customer.id, token, fd, (evt) => {
        if (evt.total) setProgress(Math.round((evt.loaded / evt.total) * 100))
      })
      onUploaded()
      onClose()
    } catch (e2) {
      setErr(e2.response?.data?.error || 'Upload failed')
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="my-8 w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">
            Upload contract file
            <span className="ml-2 text-xs font-semibold text-brand-600">{team}</span>
          </h2>
          <button type="button" onClick={onClose} className="text-slate-400 transition hover:text-slate-700" aria-label="Close">✕</button>
        </div>

        {err && <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{err}</p>}

        <label className="block text-xs font-semibold text-slate-600">
          客户 <span className="text-rose-500">*</span>
          <div className="mt-1">
            <CustomerPicker value={customer} onChange={setCustomer} autoFocus />
          </div>
        </label>
        <p className="mt-1 text-[11px] text-slate-400">找不到就直接输入名字，下拉里会出现「+ Create」新建。</p>

        <label className="mt-4 block text-xs font-semibold text-slate-600">
          文档类型
          <Select value={docType} onChange={(e) => setDocType(e.target.value)} className="mt-1">
            {DOC_TYPE_ORDER.map((k) => (
              <option key={k} value={k}>{CONTRACT_DOC_TYPES[k].label}</option>
            ))}
          </Select>
        </label>

        <label className="mt-4 block text-xs font-semibold text-slate-600">
          文件 <span className="text-rose-500">*</span>
          <input
            ref={fileRef}
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="mt-1 block w-full text-xs text-slate-500 file:mr-2 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-brand-700 hover:file:bg-brand-100"
          />
        </label>
        <p className="mt-1 text-[11px] text-slate-400">PDF / Word / Excel / PowerPoint / images / text, up to 40 MB.</p>

        <label className="mt-4 block text-xs font-semibold text-slate-600">
          备注（可选）
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="mt-1" />
        </label>

        <div className="mt-6 flex items-center justify-end gap-2">
          {progress !== null && <span className="mr-auto text-xs font-semibold text-brand-600">{progress}%</span>}
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" disabled={!ready}>{busy ? 'Uploading…' : 'Upload'}</Button>
        </div>
      </form>
    </div>
  )
}
