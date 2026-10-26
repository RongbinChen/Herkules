import { Component } from 'react'

// The calendar route is the whole React tree. A render error with no boundary
// unmounts #root and leaves a blank page. This keeps a visible fallback there,
// and a smaller one when only the grid fails.
export default class CalendarErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error) {
    console.error('Calendar failed to render', error)
  }

  render() {
    if (!this.state.error) return this.props.children

    if (this.props.variant === 'panel') {
      return (
        <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-[24px] border border-dashed border-slate-200 bg-white px-6 py-10 text-center">
          <p className="text-sm font-semibold text-slate-800">This calendar couldn't be drawn</p>
          <p className="max-w-sm text-sm text-slate-500">The rest of the page is still available. Try again, or open the dashboard.</p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Try again
          </button>
        </div>
      )
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <div className="w-full max-w-md rounded-[28px] border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Calendar</p>
          <h1 className="mt-2 text-lg font-semibold text-slate-900">This view couldn't be displayed</h1>
          <p className="mt-2 text-sm text-slate-500">
            Something went wrong while drawing the calendar, so the page stopped instead of going blank.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              Try again
            </button>
            <a
              href="/"
              className="rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Dashboard
            </a>
          </div>
        </div>
      </div>
    )
  }
}
