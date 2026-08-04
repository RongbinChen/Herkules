import { useState } from 'react'
import { format } from 'date-fns'
import { customersAPI } from '../api/api'

// A running log on a customer: anyone can add an entry, each one stamped with
// who wrote it and when. Editing and deleting are limited to the author (or an
// admin) — the backend enforces this too; the UI just avoids offering buttons
// that would fail.
export default function CustomerNotes({ customerId, notes, currentUser, onChanged }) {
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState('')

  const canModify = (note) =>
    currentUser?.isAdmin === true || (note.author?.id && note.author.id === currentUser?.id)

  async function add() {
    const content = draft.trim()
    if (!content || saving) return
    setSaving(true)
    setError('')
    try {
      await customersAPI.addNote(customerId, content)
      setDraft('')
      await onChanged()
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to save the note')
    } finally {
      setSaving(false)
    }
  }

  async function saveEdit(noteId) {
    const content = editDraft.trim()
    if (!content) return
    setSaving(true)
    setError('')
    try {
      await customersAPI.updateNote(customerId, noteId, content)
      setEditingId(null)
      await onChanged()
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to update the note')
    } finally {
      setSaving(false)
    }
  }

  async function remove(noteId) {
    if (!window.confirm('Delete this note?')) return
    setError('')
    try {
      await customersAPI.deleteNote(customerId, noteId)
      await onChanged()
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to delete the note')
    }
  }

  const stamp = (note) => {
    const when = format(new Date(note.createdAt), 'yyyy-MM-dd HH:mm')
    // A note whose author was deleted keeps its content; say so plainly rather
    // than showing a blank name.
    const who = note.author?.name || 'Unknown user'
    const edited = note.updatedAt && note.updatedAt !== note.createdAt
    return `${who} · ${when}${edited ? ' · edited' : ''}`
  }

  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-bold text-slate-800">Notes</h2>
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500">
          {notes.length}
        </span>
      </div>

      <div className="mb-4">
        <textarea
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Record something about this customer — a call, a decision, something to remember…"
          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:bg-white"
        />
        <div className="mt-2 flex items-center justify-end gap-2">
          {draft && (
            <button
              onClick={() => setDraft('')}
              className="text-xs font-semibold text-slate-500 hover:text-slate-700"
            >
              Clear
            </button>
          )}
          <button
            onClick={add}
            disabled={!draft.trim() || saving}
            className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Add note'}
          </button>
        </div>
      </div>

      {error && (
        <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>
      )}

      {notes.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">No notes yet.</p>
      ) : (
        <ul className="space-y-3">
          {notes.map((note) => (
            <li key={note.id} className="rounded-xl border border-slate-200 p-3.5">
              <div className="mb-1.5 flex items-start justify-between gap-2">
                <p className="text-xs font-semibold text-slate-500">{stamp(note)}</p>
                {canModify(note) && editingId !== note.id && (
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => { setEditingId(note.id); setEditDraft(note.content) }}
                      className="text-xs font-semibold text-slate-400 transition hover:text-brand-600"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => remove(note.id)}
                      className="text-xs font-semibold text-slate-400 transition hover:text-rose-500"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>

              {editingId === note.id ? (
                <>
                  <textarea
                    rows={3}
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-500"
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      onClick={() => setEditingId(null)}
                      className="text-xs font-semibold text-slate-500 hover:text-slate-700"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => saveEdit(note.id)}
                      disabled={!editDraft.trim() || saving}
                      className="rounded-lg bg-brand-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
                    >
                      Save
                    </button>
                  </div>
                </>
              ) : (
                <p className="whitespace-pre-wrap break-words text-sm text-slate-700">{note.content}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
