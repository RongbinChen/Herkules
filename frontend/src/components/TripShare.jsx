import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { tripsAPI } from '../api/api'
import TripMap from './TripMap'
import TripItinerary from './TripItinerary'

// Public, login-free itinerary view reached via /trip/share/:token.
export default function TripShare() {
  const { token } = useParams()
  const [trip, setTrip] = useState(null)
  const [state, setState] = useState('loading') // loading | ready | notfound | error

  useEffect(() => {
    let ignore = false
    tripsAPI
      .getShared(token)
      .then((res) => {
        if (ignore) return
        setTrip(res.data)
        setState('ready')
      })
      .catch((err) => {
        if (ignore) return
        setState(err?.response?.status === 404 ? 'notfound' : 'error')
      })
    return () => {
      ignore = true
    }
  }, [token])

  if (state === 'loading') {
    return <p className="py-20 text-center text-slate-400">加载中...</p>
  }
  if (state === 'notfound') {
    return <p className="py-20 text-center text-slate-400">行程不存在或链接已失效。</p>
  }
  if (state === 'error') {
    return <p className="py-20 text-center text-slate-400">加载失败，请稍后重试。</p>
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-[1000px] px-4 py-6 sm:py-8">
        <header className="mb-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">行程分享</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-800 sm:text-3xl">{trip.title}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {new Date(trip.startTime).toLocaleString()} → {new Date(trip.endTime).toLocaleString()}
            {trip.assignee?.name ? ` · 负责人 ${trip.assignee.name}` : ''}
          </p>
          {trip.notes && (
            <p className="mt-2 rounded-xl bg-white px-3.5 py-2.5 text-sm text-slate-600 ring-1 ring-slate-200">{trip.notes}</p>
          )}
        </header>

        <div className="mb-5">
          <TripMap stops={trip.stops} height={420} />
        </div>

        <h2 className="mb-3 text-lg font-semibold text-slate-800">拜访顺序（{trip.stops?.length || 0} 站）</h2>
        <TripItinerary stops={trip.stops} />

        <p className="mt-8 text-center text-xs text-slate-400">由 Herkules CRM 生成 · 地图支持高德 / OpenStreetMap 切换</p>
      </div>
    </div>
  )
}
