// Shared UI primitives — the design-system foundation. Brand accent is
// engineering red (brand-*), neutrals are slate. Import from '../components/ui'.

const cx = (...c) => c.filter(Boolean).join(' ');

// ── Button ───────────────────────────────────────────────────────────────────
const BTN_VARIANTS = {
  primary: 'bg-brand-600 text-white shadow-sm hover:bg-brand-700',
  secondary: 'border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50 hover:border-slate-300',
  ghost: 'text-slate-600 hover:bg-slate-100',
  dark: 'bg-slate-900 text-white shadow-sm hover:bg-slate-800',
  danger: 'bg-brand-600 text-white shadow-sm hover:bg-brand-700',
};
const BTN_SIZES = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-5 py-2.5 text-sm',
};
export function Button({ variant = 'primary', size = 'md', pill = false, className = '', ...props }) {
  return (
    <button
      {...props}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 font-semibold transition',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200',
        'disabled:pointer-events-none disabled:opacity-50',
        pill ? 'rounded-full' : 'rounded-xl',
        BTN_SIZES[size],
        BTN_VARIANTS[variant],
        className,
      )}
    />
  );
}

// ── Card ──────────────────────────────────────────────────────────────────────
export function Card({ as: As = 'div', hover = false, className = '', ...props }) {
  return (
    <As
      {...props}
      className={cx(
        'rounded-2xl border border-slate-200 bg-white shadow-card',
        hover && 'transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-card-hover',
        className,
      )}
    />
  );
}

// ── Badge ─────────────────────────────────────────────────────────────────────
const BADGE_TONES = {
  slate: 'bg-slate-100 text-slate-600',
  brand: 'bg-brand-50 text-brand-700',
  blue: 'bg-blue-100 text-blue-700',
  green: 'bg-green-100 text-green-700',
  amber: 'bg-amber-100 text-amber-700',
  violet: 'bg-violet-100 text-violet-700',
  rose: 'bg-rose-100 text-rose-700',
  emerald: 'bg-emerald-100 text-emerald-700',
};
export function Badge({ tone = 'slate', className = '', ...props }) {
  return (
    <span
      {...props}
      className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold', BADGE_TONES[tone], className)}
    />
  );
}

// ── Form controls ─────────────────────────────────────────────────────────────
const FIELD_BASE =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-100';

export function Input({ className = '', ...props }) {
  return <input {...props} className={cx(FIELD_BASE, className)} />;
}
export function Select({ className = '', children, ...props }) {
  return (
    <select {...props} className={cx(FIELD_BASE, 'cursor-pointer', className)}>
      {children}
    </select>
  );
}
export function Textarea({ className = '', ...props }) {
  return <textarea {...props} className={cx(FIELD_BASE, className)} />;
}
