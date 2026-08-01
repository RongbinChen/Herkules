import { useState } from 'react'

// Public share link + copy button. Shared by TripDetail and the trip wizard's
// final step — a trip gets its shareToken the moment it is created, so the link
// is copyable before the itinerary has finished generating.
export default function ShareLinkBar({ shareToken, hidePhoneOnShare = false, className = '' }) {
  const [copied, setCopied] = useState(false)
  if (!shareToken) return null

  const shareUrl = `${window.location.origin}/trip/share/${shareToken}`

  async function copyShare() {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // navigator.clipboard does not exist outside a secure context — e.g. when
      // testing the dev server over http on a phone. Fall back to a prompt the
      // user can copy out of by hand rather than failing silently.
      window.prompt('Copy this link:', shareUrl)
    }
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-2xl border border-brand-100 bg-brand-50/60 p-3 ${className}`}>
      <span className="text-sm font-semibold text-brand-700">Public share link</span>
      <input
        readOnly
        value={shareUrl}
        onFocus={(e) => e.target.select()}
        className="min-w-[220px] flex-1 rounded-lg border border-brand-200 bg-white px-3 py-1.5 text-sm text-slate-600 outline-none"
      />
      <button onClick={copyShare} className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700">
        {copied ? 'Copied ✓' : 'Copy link'}
      </button>
      <p className="w-full text-xs text-brand-600/80">
        Anyone with this link can view the trip and map without logging in (Google Maps by default; switch to AMap for China access).
        {hidePhoneOnShare ? ' Phone numbers are hidden from the public page.' : ''}
      </p>
    </div>
  )
}
