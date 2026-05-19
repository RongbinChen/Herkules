import { useEffect, useState } from 'react'
import { eventsAPI, usersAPI } from '../api/api'

function emptyForm(user) {
  return {
    name: user?.name || '',
    email: user?.email || '',
    currentPassword: '',
    password: '',
    confirmPassword: '',
  }
}

export default function ProfileModal({ isOpen, onClose, user, onSave }) {
  const [form, setForm] = useState(emptyForm(user))
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [feedInfo, setFeedInfo] = useState(null)
  const [teamFeeds, setTeamFeeds] = useState([])
  const [feedError, setFeedError] = useState('')
  const [feedLoading, setFeedLoading] = useState(false)
  const [copyState, setCopyState] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [rotating, setRotating] = useState(false)

  useEffect(() => {
    if (!isOpen) {
      setError('')
      setSubmitting(false)
      setFeedLoading(false)
      setCopyState('')
      setTeamFeeds([])
      return
    }

    setForm(emptyForm(user))
    setError('')
    loadCalendarFeed()
  }, [isOpen, user])

  useEffect(() => {
    if (!copyState) return undefined

    const timer = window.setTimeout(() => setCopyState(''), 1800)
    return () => window.clearTimeout(timer)
  }, [copyState])

  if (!isOpen) return null

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function loadCalendarFeed() {
    setFeedLoading(true)
    setFeedError('')

    try {
      const requests = [usersAPI.getCalendarFeed()]
      if (user?.isAdmin) {
        requests.push(usersAPI.getAllCalendarFeeds())
      }

      const [feedResponse, teamResponse] = await Promise.all(requests)
      setFeedInfo(feedResponse.data)
      setTeamFeeds(teamResponse?.data || [])
    } catch (requestError) {
      setFeedInfo(null)
      setTeamFeeds([])
      setFeedError(requestError.response?.data?.error || 'Failed to load calendar sync links')
    } finally {
      setFeedLoading(false)
    }
  }

  async function handleCopy(value, mode = 'link') {
    try {
      await navigator.clipboard.writeText(value)
      setCopyState(mode === 'webcal' ? 'Apple subscription link copied' : 'Calendar link copied')
    } catch {
      setCopyState('Copy failed')
    }
  }

  async function handleDownloadCalendar() {
    setDownloading(true)
    setFeedError('')

    try {
      const response = await eventsAPI.exportIcs()
      const blob = new Blob([response.data], { type: 'text/calendar;charset=utf-8' })
      const blobUrl = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = `${(user?.name || 'calendar').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.ics`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(blobUrl)
    } catch (requestError) {
      setFeedError(requestError.response?.data?.error || 'Failed to download calendar export')
    } finally {
      setDownloading(false)
    }
  }

  async function handleRotateFeed() {
    setRotating(true)
    setFeedError('')

    try {
      const response = await usersAPI.rotateCalendarFeed()
      setFeedInfo(response.data)
      setCopyState('Calendar link reset')
    } catch (requestError) {
      setFeedError(requestError.response?.data?.error || 'Failed to reset calendar link')
    } finally {
      setRotating(false)
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')

    if (form.password && form.password !== form.confirmPassword) {
      setError('New password and confirmation do not match')
      return
    }

    const payload = {}

    if (form.name.trim() && form.name !== user?.name) payload.name = form.name.trim()
    if (form.email.trim() && form.email !== user?.email) payload.email = form.email.trim()
    if (form.password) {
      payload.currentPassword = form.currentPassword
      payload.password = form.password
    }

    if (Object.keys(payload).length === 0) {
      setError('No changes to save')
      return
    }

    setSubmitting(true)
    try {
      await onSave(payload)
      onClose()
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Failed to update account')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm sm:p-6">
      <div className="flex h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-2xl sm:h-[88vh] sm:rounded-[28px]">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4 sm:px-8 sm:py-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">My Account</p>
            <h2 className="mt-2 text-xl font-semibold text-slate-900 sm:text-2xl">Update profile and password</h2>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
            <span className="text-2xl leading-none">&times;</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:space-y-6 sm:px-8 sm:py-7">
          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="grid gap-5 sm:gap-6">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Full name</span>
              <input
                value={form.name}
                onChange={(event) => updateField('name', event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-sky-500 focus:bg-white"
                required
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Username</span>
              <input
                value={form.email}
                onChange={(event) => updateField('email', event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-sky-500 focus:bg-white"
                required
              />
            </label>

            <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4 sm:p-5">
              <p className="text-sm font-semibold text-slate-900">Change password</p>
              <p className="mt-1 text-sm text-slate-500">Leave the password fields empty if you only want to update your name or username.</p>

              <div className="mt-4 grid gap-4">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Current password</span>
                  <input
                    type="password"
                    value={form.currentPassword}
                    onChange={(event) => updateField('currentPassword', event.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-sky-500"
                    placeholder="Required only when setting a new password"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">New password</span>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(event) => updateField('password', event.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-sky-500"
                    placeholder="At least 6 characters"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Confirm new password</span>
                  <input
                    type="password"
                    value={form.confirmPassword}
                    onChange={(event) => updateField('confirmPassword', event.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-sky-500"
                  />
                </label>
              </div>
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4 sm:p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Mobile calendar sync</p>
                  <p className="mt-1 text-sm text-slate-500">
                    Subscribe to a read-only feed on iPhone, iPad, Mac, or Google Calendar. Use the download button for a one-time `.ics` export.
                  </p>
                </div>
                {copyState && (
                  <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">
                    {copyState}
                  </span>
                )}
              </div>

              {feedError && (
                <div className="mt-4 rounded-2xl border border-red-200 bg-white px-4 py-3 text-sm text-red-700">
                  {feedError}
                </div>
              )}

              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Subscription URL</p>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <input
                      readOnly
                      value={feedLoading ? 'Loading calendar link...' : feedInfo?.feedUrl || ''}
                      className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => feedInfo?.feedUrl && handleCopy(feedInfo.feedUrl)}
                      disabled={!feedInfo?.feedUrl}
                      className="rounded-full border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Copy URL
                    </button>
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-sm font-semibold text-slate-900">Apple Calendar</p>
                    <p className="mt-1 text-sm text-slate-500">
                      On Apple devices you can open a subscription link directly. The feed stays read-only and updates automatically.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => feedInfo?.webcalUrl && window.open(feedInfo.webcalUrl, '_blank', 'noopener,noreferrer')}
                        disabled={!feedInfo?.webcalUrl}
                        className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                      >
                        Open on iPhone / Mac
                      </button>
                      <button
                        type="button"
                        onClick={() => feedInfo?.webcalUrl && handleCopy(feedInfo.webcalUrl, 'webcal')}
                        disabled={!feedInfo?.webcalUrl}
                        className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Copy `webcal://`
                      </button>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-sm font-semibold text-slate-900">Android / Google Calendar</p>
                    <p className="mt-1 text-sm text-slate-500">
                      Use <span className="font-medium text-slate-700">From URL</span> in Google Calendar on desktop, then the subscribed calendar will sync to Android.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => feedInfo?.feedUrl && handleCopy(feedInfo.feedUrl)}
                        disabled={!feedInfo?.feedUrl}
                        className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-300 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Copy Google URL
                      </button>
                      <button
                        type="button"
                        onClick={handleDownloadCalendar}
                        disabled={downloading}
                        className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {downloading ? 'Downloading...' : 'Download .ics'}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Resetting the subscription link will immediately invalidate the old mobile sync URL.
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={loadCalendarFeed}
                    disabled={feedLoading}
                    className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {feedLoading ? 'Refreshing...' : 'Refresh link'}
                  </button>
                  <button
                    type="button"
                    onClick={handleRotateFeed}
                    disabled={rotating}
                    className="rounded-full border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {rotating ? 'Resetting...' : 'Reset subscription link'}
                  </button>
                </div>
              </div>
            </div>

            {user?.isAdmin && (
              <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4 sm:p-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Team calendar subscriptions</p>
                    <p className="mt-1 text-sm text-slate-500">
                      As an administrator you can subscribe to every user&apos;s calendar separately on your phone or desktop calendar app.
                    </p>
                  </div>
                  <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-600">
                    {teamFeeds.length} feeds
                  </span>
                </div>

                <div className="mt-4 max-h-72 space-y-3 overflow-y-auto pr-1">
                  {teamFeeds.map((teamFeed) => (
                    <div key={teamFeed.userId} className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{teamFeed.name}</p>
                          <p className="text-xs text-slate-500">
                            {teamFeed.email}
                            {teamFeed.isAdmin ? ' · Admin' : ''}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => window.open(teamFeed.webcalUrl, '_blank', 'noopener,noreferrer')}
                            className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800"
                          >
                            Open
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCopy(teamFeed.feedUrl)}
                            className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                          >
                            Copy URL
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCopy(teamFeed.webcalUrl, 'webcal')}
                            className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                          >
                            Copy `webcal://`
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}

                  {teamFeeds.length === 0 && !feedLoading && (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-slate-500">
                      No team feeds available.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-center sm:justify-end">
            <button type="button" onClick={onClose} className="rounded-full border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {submitting ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
