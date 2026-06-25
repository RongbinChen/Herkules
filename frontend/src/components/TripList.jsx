import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { tripsAPI } from '../api/api'
import TripModal from './TripModal'

function fmtRange(start, end) {
  const s = new Date(start)
  const e = new Date(end)
  const d = (x) => x.toLocaleDateString()
  return d(s) === d(e) ? d(s) : `${d(s)} → ${d(e)}`
}

export default function TripList() {
  const navigate = useNavigate()
  const [trips, setTrips] = useState([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await tripsAPI.getAll()
      setTrips(res.data)
    } catch (err) {
      console.error('Failed to load trips', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  return (
    <div className="mx-auto max-w-[1100px] p-5">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            ← Modules
          </button>
          <h1 className="text-2xl font-bold text-slate-800">行程安排</h1>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-sm font-semibold text-slate-500">{trips.length}</span>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-700"
        >
          + 安排行程
        </button>
      </div>

      {loading ? (
        <p className="py-16 text-center text-slate-400">Loading...</p>
      ) : trips.length === 0 ? (
        <p className="py-16 text-center text-slate-400">还没有行程。点击「安排行程」创建第一个。</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {trips.map((t) => (
            <button
              key={t.id}
              onClick={() => navigate(`/trips/${t.id}`)}
              className="rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-sky-300 hover:shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-semibold text-slate-800">{t.title}</h2>
                <span className="shrink-0 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700">
                  {t._count?.stops ?? 0} 站
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-500">{fmtRange(t.startTime, t.endTime)}</p>
              {t.assignee?.name && (
                <p className="mt-1 text-xs text-slate-400">负责人：{t.assignee.name}</p>
              )}
            </button>
          ))}
        </div>
      )}

      <TripModal
        isOpen={modalOpen}
        trip={null}
        onClose={() => setModalOpen(false)}
        onSaved={(created) => navigate(`/trips/${created.id}`)}
      />
    </div>
  )
}
