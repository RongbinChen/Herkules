import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  copyForLang,
  dismissAskAiUpgradeBanner,
  resolveBannerLang,
  shouldShowAskAiUpgradeBanner,
} from '../utils/askAiUpgradeBanner'

function SparkleIcon() {
  return (
    <svg className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M9.5 3.2c.2-.6 1-.6 1.2 0l.9 2.6c.4 1.1 1.3 2 2.4 2.4l2.6.9c.6.2.6 1 0 1.2l-2.6.9c-1.1.4-2 1.3-2.4 2.4l-.9 2.6c-.2.6-1 .6-1.2 0l-.9-2.6a3.6 3.6 0 0 0-2.4-2.4l-2.6-.9c-.6-.2-.6-1 0-1.2l2.6-.9a3.6 3.6 0 0 0 2.4-2.4L9.5 3.2Z" />
      <path d="M16.8 13.4c.15-.4.7-.4.85 0l.45 1.3c.25.7.8 1.25 1.5 1.5l1.3.45c.4.15.4.7 0 .85l-1.3.45c-.7.25-1.25.8-1.5 1.5l-.45 1.3c-.15.4-.7.4-.85 0l-.45-1.3a2.3 2.3 0 0 0-1.5-1.5l-1.3-.45c-.4-.15-.4-.7 0-.85l1.3-.45c.7-.25 1.25-.8 1.5-1.5l.45-1.3Z" />
    </svg>
  )
}

// Presentational piece, exported so tests can render the banner without Auth.
export function AskAiUpgradeBannerView({ lang = 'en', onTry, onDismiss }) {
  const copy = copyForLang(lang)
  return (
    <aside
      className="relative mb-6 overflow-hidden rounded-2xl border border-sky-100 bg-sky-50 shadow-sm sm:mb-8"
      aria-labelledby="ask-ai-upgrade-banner-title"
    >
      <div className="absolute inset-y-0 left-0 w-[4px] bg-sky-500" aria-hidden="true" />
      <div className="flex flex-col gap-3 py-3.5 pl-5 pr-4 sm:flex-row sm:items-center sm:gap-4 sm:py-4 sm:pl-6 sm:pr-5">
        <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-500 sm:mt-0">
            <SparkleIcon />
          </span>
          <div className="min-w-0 flex-1 pr-6 sm:pr-0">
            <h2 id="ask-ai-upgrade-banner-title" className="text-base font-semibold text-slate-900">
              {copy.title}
            </h2>
            <p className="mt-0.5 text-sm leading-relaxed text-slate-600">{copy.body}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
          <button
            type="button"
            onClick={onTry}
            className="rounded-xl bg-blue-800 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-900"
          >
            {copy.cta}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-sky-100 hover:text-slate-600"
            aria-label={copy.dismiss}
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  )
}

export default function AskAiUpgradeBanner({ now, lang } = {}) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const userId = user?.id
  const [visible, setVisible] = useState(() => shouldShowAskAiUpgradeBanner({ userId, now }))

  useEffect(() => {
    setVisible(shouldShowAskAiUpgradeBanner({ userId, now }))
  }, [userId, now])

  if (!visible) return null

  const hide = () => {
    dismissAskAiUpgradeBanner(userId)
    setVisible(false)
  }

  return (
    <AskAiUpgradeBannerView
      lang={resolveBannerLang(lang)}
      onTry={() => { hide(); navigate('/search') }}
      onDismiss={hide}
    />
  )
}
