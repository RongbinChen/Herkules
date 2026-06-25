import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { tripsAPI } from '../api/api'
import TripMap from './TripMap'
import TripItinerary from './TripItinerary'
import TripModal from './TripModal'

export default function TripDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [trip, setTrip] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editOpen, setEditOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await tripsAPI.get(id)
      setTrip(res.data)
    } catch (err) {
      console.error('Failed to load trip', err)
      setTrip(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const shareUrl = trip ? `${window.location.origin}/trip/share/${trip.shareToken}` : ''

  async function copyShare() {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('复制此分享链接：', shareUrl)
    }
  }

  async function handleDelete() {
    if (!window.confirm(`删除行程「${trip.title}」？此操作不可撤销。`)) return
    try {
      await tripsAPI.delete(trip.id)
      navigate('/trips')
    } catch (err) {
      console.error('Failed to delete trip', err)
      window.alert('删除失败')
    }
  }

  if (loading) return <p className="py-16 text-center text-slate-400">Loading...</p>
  if (!trip) {
    return (
      <div className="mx-auto max-w-[1100px] p-5">
        <p className="py-16 text-center text-slate-400">行程不存在。</p>
        <div className="text-center">
          <button onClick={() => navigate('/trips')} className="text-sky-600 hover:underline">← 返回行程列表</button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1100px] p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/trips')}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            ← 行程列表
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">{trip.title}</h1>
            <p className="text-sm text-slate-500">
              {new Date(trip.startTime).toLocaleString()} → {new Date(trip.endTime).toLocaleString()}
              {trip.assignee?.name ? ` · 负责人 ${trip.assignee.name}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setEditOpen(true)} className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-sky-600 transition hover:bg-sky-50">
            编辑
          </button>
          <button onClick={handleDelete} className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-red-500 transition hover:bg-red-50">
            删除
          </button>
        </div>
      </div>

      {/* Share link */}
      <div className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl border border-sky-100 bg-sky-50/60 p-3">
        <span className="text-sm font-semibold text-sky-700">公开分享链接</span>
        <input
          readOnly
          value={shareUrl}
          onFocus={(e) => e.target.select()}
          className="min-w-[220px] flex-1 rounded-lg border border-sky-200 bg-white px-3 py-1.5 text-sm text-slate-600 outline-none"
        />
        <button onClick={copyShare} className="rounded-lg bg-sky-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-sky-700">
          {copied ? '已复制 ✓' : '复制链接'}
        </button>
        <p className="w-full text-xs text-sky-600/80">任何人通过此链接无需登录即可查看行程与地图（默认高德地图，国内可访问）。</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <TripMap stops={trip.stops} height={460} />
        <div>
          {trip.notes && (
            <p className="mb-3 rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm text-slate-600">{trip.notes}</p>
          )}
          <TripItinerary stops={trip.stops} />
        </div>
      </div>

      <TripModal isOpen={editOpen} trip={trip} onClose={() => setEditOpen(false)} onSaved={() => load()} />
    </div>
  )
}
