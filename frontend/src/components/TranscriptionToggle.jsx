import { useEffect, useState } from 'react'
import { contractsAPI } from '../api/api'

// Pause / resume OCR transcription from the Contracts header. Transcription and
// Q&A share one GPU on the DGX; pausing frees it for fast answers without taking
// the worker (and Q&A) down. The server restricts this to one account, and the
// parent only renders it for that account — this component assumes it is allowed
// and just reflects/toggles state.
export default function TranscriptionToggle() {
  const [status, setStatus] = useState(null) // { paused, draining, online }
  const [busy, setBusy] = useState(false)

  const load = () => contractsAPI.ocrControlStatus()
    .then((r) => setStatus(r.data))
    .catch(() => setStatus({ online: false }))

  useEffect(() => { load() }, [])

  async function toggle() {
    if (busy || !status?.online) return
    setBusy(true)
    try {
      const { data } = await contractsAPI.ocrControl(status.paused ? 'resume' : 'pause')
      setStatus((s) => ({ ...s, paused: data.paused }))
    } catch {
      // A failed toggle usually means the worker went offline; re-read so the
      // control reflects reality rather than an optimistic guess.
      load()
    } finally {
      setBusy(false)
    }
  }

  if (!status) return null

  if (!status.online) {
    return <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-400">Transcription: worker offline</span>
  }

  const paused = status.paused
  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={paused
        ? 'Transcription is paused — the GPU is free for Q&A. Click to resume reading the queue.'
        : 'Pause transcription to free the GPU for Q&A. Answers get faster; queued files wait.'}
      className={`rounded-full px-3 py-1 text-xs font-semibold transition disabled:opacity-60 ${
        paused
          ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
      }`}
    >
      {busy ? '…' : paused ? '▶ Resume transcription' : '⏸ Pause transcription'}
    </button>
  )
}
