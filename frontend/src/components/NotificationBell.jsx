import { useState, useEffect } from 'react';
import { listNotifications, markNotificationRead, markAllNotificationsRead } from '../api/chinabidding';

// Lifted out of BidProjectList so the bell is not stranded on the ChinaBidding
// page. There is no shared header in this app, so each page that wants it
// mounts this component itself.
//
// Markup is unchanged from the original. The panel is fixed-position on small
// screens and anchored to the button from `sm` up, which is why the wrapper
// needs `relative` and the backdrop sits at z-[70] under the panel's z-[80].
export default function NotificationBell({ className = '' }) {
  const [notif, setNotif] = useState({ items: [], unreadCount: 0 });
  const [open, setOpen] = useState(false);

  const load = async () => {
    try { setNotif(await listNotifications()); } catch { /* a dead bell must not break the page */ }
  };

  // One fetch on mount so the unread badge is right before anyone clicks.
  useEffect(() => { load(); }, []);

  const handleClick = async (n) => {
    if (!n.readAt) {
      try { await markNotificationRead(n.id); load(); } catch { /* ignore */ }
    }
    if (n.project?.sourceUrl) window.open(n.project.sourceUrl, '_blank');
  };

  const handleMarkAllRead = async () => {
    try { await markAllNotificationsRead(); load(); } catch { /* ignore */ }
  };

  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => { if (!open) load(); setOpen(v => !v); }}
        aria-label="Notifications"
        className="relative flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:border-slate-300 sm:px-4 sm:py-2 sm:text-sm"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 00-4-5.7V5a2 2 0 10-4 0v.3A6 6 0 006 11v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {notif.unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {notif.unreadCount > 99 ? '99+' : notif.unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* click-outside backdrop */}
          <div className="fixed inset-0 z-[70]" onClick={() => setOpen(false)} />
          <div className="fixed inset-x-3 top-16 z-[80] rounded-2xl border border-slate-200 bg-white shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-96 sm:max-w-[90vw]">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <span className="text-sm font-bold text-slate-800">Notifications</span>
              <div className="flex items-center gap-3">
                {notif.unreadCount > 0 && (
                  <button onClick={handleMarkAllRead} className="text-xs font-semibold text-brand-600 hover:underline">
                    Mark all read
                  </button>
                )}
                <button onClick={() => setOpen(false)} aria-label="Close" className="text-slate-400 transition hover:text-slate-700">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <ul className="max-h-96 overflow-y-auto divide-y divide-slate-50">
              {notif.items.length === 0 ? (
                <li className="px-4 py-8 text-center text-sm text-slate-400">No notifications</li>
              ) : notif.items.map(n => (
                <li
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className={`cursor-pointer px-4 py-3 text-sm transition hover:bg-slate-50 ${n.readAt ? 'text-slate-400' : 'text-slate-700'}`}
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 shrink-0 text-base">
                      {n.type === 'OWN_WIN' ? '🏆' : n.type === 'COMPETITOR_WIN' ? '⚔️' : n.type === 'INTEREST_WIN' ? '👀' : n.type === 'DEADLINE_SOON' ? '⏰' : n.type === 'STATUS_CHANGE' ? '🔄' : '📌'}
                    </span>
                    <div className="min-w-0">
                      <p className={`leading-snug ${!n.readAt ? 'font-semibold' : ''}`}>{n.message}</p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {n.project?.publishDate
                          ? `Published: ${new Date(n.project.publishDate).toLocaleDateString('en-GB')}`
                          : new Date(n.createdAt).toLocaleDateString('en-GB')}
                      </p>
                    </div>
                    {!n.readAt && <span className="mt-1.5 ml-auto h-2 w-2 shrink-0 rounded-full bg-brand-500" />}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
