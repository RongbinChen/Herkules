import { Button } from '../ui'
import { STEPS } from './context'

// Page frame for the wizard: title, clickable stepper, scrolling body, and a
// sticky footer for the navigation buttons.
export default function WizardShell({
  step,
  maxReachable,
  onStep,
  onExit,
  title,
  subtitle,
  banner = null,
  errors = [],
  footer,
  children,
}) {
  return (
    <div className="mx-auto flex min-h-screen max-w-[900px] flex-col p-4 sm:p-5">
      <div className="mb-4 flex items-center gap-3">
        <Button variant="secondary" size="sm" onClick={onExit}>← Trips</Button>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold text-slate-800 sm:text-2xl">{title}</h1>
          {subtitle && <p className="truncate text-sm text-slate-500">{subtitle}</p>}
        </div>
      </div>

      {banner}

      {/* Every step already reached stays clickable — editing an existing trip
          usually means changing one thing, and walking through four screens to
          get to it is busywork. */}
      <ol className="mb-5 flex items-center gap-1 overflow-x-auto pb-1">
        {STEPS.map((label, i) => {
          const n = i + 1
          const done = n < step
          const active = n === step
          const open = n <= maxReachable
          return (
            <li key={label} className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                disabled={!open}
                onClick={() => onStep(n)}
                aria-current={active ? 'step' : undefined}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  active
                    ? 'bg-brand-600 text-white'
                    : done
                      ? 'bg-brand-50 text-brand-700 hover:bg-brand-100'
                      : 'bg-slate-100 text-slate-400'
                } ${open ? '' : 'cursor-not-allowed'}`}
              >
                <span className="tabular-nums">{done ? '✓' : n}</span>
                {label}
              </button>
              {n < STEPS.length && <span className="h-px w-4 bg-slate-200" />}
            </li>
          )
        })}
      </ol>

      <div className="min-h-0 flex-1 pb-4">{children}</div>

      {errors.length > 0 && (
        <div className="sticky bottom-[4.25rem] z-10 mb-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {errors.map((e) => <p key={e}>{e}</p>)}
        </div>
      )}

      <div className="sticky bottom-0 z-10 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-5 sm:px-5">
        {footer}
      </div>
    </div>
  )
}
