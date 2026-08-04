import { useCallback, useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import { contractsAPI } from '../api/api'

// The unlock token is scoped to one team and expires server-side. Keeping it in
// sessionStorage means walking between customers doesn't ask for the PIN again,
// while closing the tab ends the session.
const TOKEN_KEY = 'contractUnlock'

const loadUnlock = () => {
  try {
    return JSON.parse(sessionStorage.getItem(TOKEN_KEY)) || null
  } catch {
    return null
  }
}

const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

export default function CustomerContracts({ customerId, currentUser }) {
  const [unlock, setUnlock] = useState(loadUnlock)
  const [team, setTeam] = useState(currentUser?.team === 'WRC' ? 'WRC' : 'HRC')
  const [pin, setPin] = useState('')
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState(null)
  const [configured, setConfigured] = useState(null)
  const [pinPanel, setPinPanel] = useState(false)
  const [newPin, setNewPin] = useState('')
  const fileRef = useRef(null)

  const isAdmin = currentUser?.isAdmin === true

  useEffect(() => {
    contractsAPI.pinStatus().then((r) => setConfigured(r.data.configured)).catch(() => setConfigured([]))
  }, [])

  const lock = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY)
    setUnlock(null)
    setFiles([])
  }, [])

  const load = useCallback(async (u) => {
    if (!u) return
    try {
      const { data } = await contractsAPI.list(customerId, u.token)
      setFiles(data)
      setError('')
    } catch (e) {
      // 401 here means the token expired while the page was open.
      if (e.response?.status === 401) { lock(); setError('The contract session expired — enter the PIN again.') }
      else setError(e.response?.data?.error || 'Failed to load contract files')
    }
  }, [customerId, lock])

  useEffect(() => { load(unlock) }, [load, unlock])

  async function doUnlock(e) {
    e?.preventDefault()
    if (!pin.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const { data } = await contractsAPI.unlock(team, pin)
      const u = { token: data.token, team: data.team }
      sessionStorage.setItem(TOKEN_KEY, JSON.stringify(u))
      setUnlock(u)
      setPin('')
    } catch (e2) {
      setError(e2.response?.data?.error || 'Unlock failed')
    } finally {
      setBusy(false)
    }
  }

  async function doUpload(file) {
    if (!file || !unlock) return
    setBusy(true)
    setError('')
    setProgress(0)
    const fd = new FormData()
    fd.append('file', file)
    try {
      await contractsAPI.upload(customerId, unlock.token, fd, (evt) => {
        if (evt.total) setProgress(Math.round((evt.loaded / evt.total) * 100))
      })
      await load(unlock)
    } catch (e) {
      setError(e.response?.data?.error || 'Upload failed')
    } finally {
      setBusy(false)
      setProgress(null)
      if (fileRef.current) fileRef.current.value = ''
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
    setBusy(true)
    try {
      await contractsAPI.setPin(team, newPin.trim())
      setNewPin('')
      setPinPanel(false)
      setError('')
      const r = await contractsAPI.pinStatus()
      setConfigured(r.data.configured)
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to set the PIN')
    } finally {
      setBusy(false)
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
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              onChange={(e) => doUpload(e.target.files?.[0])}
              disabled={busy}
              className="min-w-0 flex-1 text-xs text-slate-500 file:mr-2 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-brand-700 hover:file:bg-brand-100"
            />
            {progress !== null && <span className="text-xs font-semibold text-brand-600">{progress}%</span>}
          </div>
          <p className="mb-3 text-[11px] text-slate-400">
            PDF / Word / Excel / PowerPoint / images / text, up to 40 MB each.
          </p>

          {files.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">No contract files for {unlock.team} yet.</p>
          ) : (
            <ul className="space-y-2">
              {files.map((f) => (
                <li key={f.id} className="flex items-start justify-between gap-2 rounded-xl border border-slate-200 p-3">
                  <button onClick={() => doDownload(f)} className="min-w-0 flex-1 text-left">
                    <p className="truncate text-sm font-semibold text-slate-800 hover:text-brand-600">📄 {f.filename}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {fmtSize(f.size)} · {f.uploadedBy?.name || 'Unknown user'} · {format(new Date(f.createdAt), 'yyyy-MM-dd')}
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
              <button onClick={savePin} disabled={busy} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Save</button>
              <button onClick={() => { setPinPanel(false); setNewPin('') }} className="text-xs font-semibold text-slate-500">Cancel</button>
              <p className="w-full text-[11px] text-slate-400">
                Changing the PIN does not sign anyone out — existing sessions keep working until they expire.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
