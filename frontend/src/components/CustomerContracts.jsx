import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { contractsAPI } from '../api/api'
import { Badge } from './ui'
import { CONTRACT_DOC_TYPES, DOC_TYPE_ORDER, docTypeMeta, fmtFileSize } from '../constants/contract'
import useContractUnlock from '../hooks/useContractUnlock'
import FileDropZone from './FileDropZone'

export default function CustomerContracts({ customerId, currentUser }) {
  const {
    unlock, team, setTeam, doUnlock: unlockWithPin, lock: clearUnlock,
    busy, error, setError, configured, refreshPinStatus, handleAuthError,
  } = useContractUnlock(currentUser?.team === 'WRC' ? 'WRC' : 'HRC')

  const [pin, setPin] = useState('')
  const [files, setFiles] = useState([])
  const [progress, setProgress] = useState(null)
  const [pinPanel, setPinPanel] = useState(false)
  const [newPin, setNewPin] = useState('')
  // Uploads here are fire-on-select, so nobody is forced past a type picker.
  // That is exactly why the default is OTHER and not COMMERCIAL: an honest
  // "unsorted" beats a wrong label applied by someone who never looked.
  const [docType, setDocType] = useState('OTHER')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const isAdmin = currentUser?.isAdmin === true

  const lock = useCallback(() => {
    clearUnlock()
    setFiles([])
  }, [clearUnlock])

  const load = useCallback(async (u) => {
    if (!u) return
    try {
      const { data } = await contractsAPI.list(customerId, u.token)
      setFiles(data)
      setError('')
    } catch (e) {
      if (handleAuthError(e)) setFiles([])
      else setError(e.response?.data?.error || 'Failed to load contract files')
    }
  }, [customerId, handleAuthError, setError])

  useEffect(() => { load(unlock) }, [load, unlock])

  async function doUnlock(e) {
    e?.preventDefault()
    if (await unlockWithPin(pin)) setPin('')
  }

  async function doUpload(file) {
    if (!file || !unlock) return
    setSaving(true)
    setError('')
    setProgress(0)
    const fd = new FormData()
    fd.append('docType', docType)
    if (note.trim()) fd.append('note', note.trim())
    fd.append('file', file)
    try {
      await contractsAPI.upload(customerId, unlock.token, fd, (evt) => {
        if (evt.total) setProgress(Math.round((evt.loaded / evt.total) * 100))
      })
      await load(unlock)
      setNote('')
    } catch (e) {
      setError(e.response?.data?.error || 'Upload failed')
    } finally {
      setSaving(false)
      setProgress(null)
    }
  }

  async function doDownload(f) {
    try {
      const res = await contractsAPI.download(f.id, unlock.token)
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = f.filename
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setError('Download failed')
    }
  }

  async function doDelete(f) {
    if (!window.confirm(`Delete “${f.filename}”? This cannot be undone.`)) return
    try {
      await contractsAPI.remove(f.id, unlock.token)
      await load(unlock)
    } catch (e) {
      setError(e.response?.data?.error || 'Delete failed')
    }
  }

  async function savePin() {
    if (newPin.trim().length < 4) { setError('PIN must be at least 4 characters'); return }
    setSaving(true)
    try {
      await contractsAPI.setPin(team, newPin.trim())
      setNewPin('')
      setPinPanel(false)
      setError('')
      await refreshPinStatus()
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to set the PIN')
    } finally {
      setSaving(false)
    }
  }

  const canDelete = (f) => isAdmin || f.uploadedBy?.id === currentUser?.id

  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-base font-bold text-slate-800">
          Contracts {unlock && <span className="ml-1 text-xs font-semibold text-brand-600">{unlock.team}</span>}
        </h2>
        <div className="flex items-center gap-2">
          {unlock && (
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500">{files.length}</span>
          )}
          <Link
            to={`/contracts?customerId=${customerId}`}
            className="text-xs font-semibold text-slate-400 transition hover:text-brand-600"
            title="Open the Contracts module filtered to this customer"
          >
            Open in Contracts →
          </Link>
          {unlock && (
            <button onClick={lock} className="text-xs font-semibold text-slate-400 transition hover:text-slate-600">
              🔒 Lock
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>
      )}

      {!unlock ? (
        <form onSubmit={doUnlock} className="space-y-3">
          <p className="text-sm text-slate-500">
            Contract files are held behind a team PIN. Choose your team and enter it to view or add files.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {['WRC', 'HRC'].map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setTeam(k)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                  team === k ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {k}
              </button>
            ))}
          </div>
          {configured && !configured.includes(team) && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              No PIN has been set for {team} yet.{isAdmin ? ' Set one below.' : ' Ask an admin to set one.'}
            </p>
          )}
          <div className="flex gap-2">
            <input
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder={`${team} PIN`}
              autoComplete="off"
              className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none transition focus:border-brand-500 focus:bg-white"
            />
            <button
              type="submit"
              disabled={!pin.trim() || busy}
              className="shrink-0 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
            >
              {busy ? 'Checking…' : 'Unlock'}
            </button>
          </div>
        </form>
      ) : (
        <>
          {/* Type and note are chosen before the file, because picking a file
              uploads immediately — there is no confirm step to come back to. */}
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-700 outline-none transition focus:border-brand-500 focus:bg-white"
            >
              {DOC_TYPE_ORDER.map((k) => (
                <option key={k} value={k}>{CONTRACT_DOC_TYPES[k].label}</option>
              ))}
            </select>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note (optional)"
              maxLength={500}
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs outline-none transition focus:border-brand-500 focus:bg-white"
            />
          </div>
          <div className="mb-3">
            <FileDropZone
              compact
              disabled={saving}
              onFile={doUpload}
              hint={`Dropping or picking a file uploads it right away, filed as “${CONTRACT_DOC_TYPES[docType].label}”. PDF / Word / Excel / PowerPoint / images / text, up to 40 MB each.`}
            />
            {progress !== null && (
              <p className="mt-1 text-[11px] font-semibold text-brand-600">Uploading… {progress}%</p>
            )}
          </div>

          {files.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">No contract files for {unlock.team} yet.</p>
          ) : (
            <ul className="space-y-2">
              {files.map((f) => (
                <li key={f.id} className="flex items-start justify-between gap-2 rounded-xl border border-slate-200 p-3">
                  <button onClick={() => doDownload(f)} className="min-w-0 flex-1 text-left">
                    <p className="flex min-w-0 items-center gap-1.5">
                      <Badge tone={docTypeMeta(f.docType).tone}>{docTypeMeta(f.docType).short}</Badge>
                      <span className="truncate text-sm font-semibold text-slate-800 hover:text-brand-600">{f.filename}</span>
                    </p>
                    {f.note && <p className="mt-0.5 truncate text-[11px] text-slate-500">{f.note}</p>}
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {fmtFileSize(f.size)} · {f.uploadedBy?.name || 'Unknown user'} · {format(new Date(f.createdAt), 'yyyy-MM-dd')}
                    </p>
                  </button>
                  {canDelete(f) && (
                    <button
                      onClick={() => doDelete(f)}
                      className="shrink-0 text-xs font-semibold text-slate-400 transition hover:text-rose-500"
                    >
                      Delete
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {isAdmin && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          {!pinPanel ? (
            <button onClick={() => setPinPanel(true)} className="text-xs font-semibold text-slate-400 hover:text-brand-600">
              ⚙ Set {team} PIN
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="password"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value)}
                placeholder={`New ${team} PIN (min 4 chars)`}
                autoComplete="new-password"
                className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs outline-none focus:border-brand-500"
              />
              <button onClick={savePin} disabled={saving} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Save</button>
              <button onClick={() => { setPinPanel(false); setNewPin('') }} className="text-xs font-semibold text-slate-500">Cancel</button>
              <p className="w-full text-[11px] text-slate-400">
                Changing the PIN does not sign anyone out — existing sessions keep working until they expire.
                {/* The master PIN lives in My Account, not here: it is an
                    account-level credential, not this team's door key. */}
                {' '}The master PIN is set in My Account.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
