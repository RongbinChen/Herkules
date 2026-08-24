import { useEffect, useState } from 'react'
import { contractsAPI } from '../api/api'

// Pause / resume OCR transcription from the Contracts header. Transcription and
// Q&A share one GPU on the DGX; pausing frees it for fast answers without taking
// the worker (and Q&A) down. The server restricts this to one account, and the
// parent only renders it for that account — this component assumes it is allowed
// and just reflects/toggles state.
function queueLabel(status) {
  const count = (status.pending || 0) + (status.running || 0)
  return count === 1 ? '1 queued file' : `${count} queued files`
}

export default function TranscriptionToggle() {
  const [status, setStatus] = useState(null) // { paused, draining, online, pending, running }
  const [busy, setBusy] = useState(false)

  const load = () => contractsAPI.ocrControlStatus()
    .then((r) => setStatus(r.data))
    .catch(() => setStatus({ online: false }))

  // Re-read on a timer: the queue fills up from uploads elsewhere in the page
  // (and from other people), so a control that keys off queue depth would go
  // stale within seconds of a fresh upload.
  useEffect(() => {
    load()
    const timer = setInterval(load, 20000)
    return () => clearInterval(timer)
  }, [])

  // Pausing an empty queue does nothing — the GPU is already free. Resume stays
  // clickable whatever the queue looks like, otherwise a pause taken while files
  // were waiting could never be undone once they drained.
  const queued = (status?.pending || 0) + (status?.running || 0) > 0
  const idle = status?.online === true && !status.paused && !queued

  async function toggle() {
    if (busy || idle || !status?.online) return
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
      disabled={busy || idle}
      title={idle
        ? 'Nothing to transcribe — the queue is empty, so the GPU is already free for Q&A.'
        : paused
          ? 'Transcription is paused — the GPU is free for Q&A. Click to resume reading the queue.'
          : `Pause transcription to free the GPU for Q&A. Answers get faster; ${queueLabel(status)} wait.`}
      className={`rounded-full px-3 py-1 text-xs font-semibold transition disabled:cursor-default ${
        idle
          ? 'bg-slate-100 text-slate-400'
          : paused
            ? 'bg-amber-100 text-amber-700 hover:bg-amber-200 disabled:opacity-60'
            : 'bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-60'
      }`}
    >
      {busy ? '…' : paused ? '▶ Resume transcription' : '⏸ Pause transcription'}
    </button>
  )
}
