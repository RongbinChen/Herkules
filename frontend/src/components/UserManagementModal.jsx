import { useEffect, useMemo, useState } from 'react'

function classNames(...values) {
  return values.filter(Boolean).join(' ')
}

function emptyForm() {
  return {
    name: '',
    email: '',
    password: '',
    isAdmin: false,
  }
}

export default function UserManagementModal({
  isOpen,
  onClose,
  users,
  currentUser,
  onCreateUser,
  onUpdateUser,
  onDeleteUser,
}) {
  const [selectedUserId, setSelectedUserId] = useState(null)
  const [form, setForm] = useState(emptyForm())
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedUserId) || null,
    [users, selectedUserId],
  )

  useEffect(() => {
    if (!isOpen) {
      setSelectedUserId(null)
      setForm(emptyForm())
      setError('')
      setSubmitting(false)
    }
  }, [isOpen])

  useEffect(() => {
    if (!selectedUser) {
      setForm(emptyForm())
      return
    }

    setForm({
      name: selectedUser.name,
      email: selectedUser.email,
      password: '',
      isAdmin: selectedUser.isAdmin,
    })
  }, [selectedUser])

  if (!isOpen) return null

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function startCreateMode() {
    setSelectedUserId(null)
    setError('')
    setForm(emptyForm())
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      if (selectedUser) {
        const payload = {
          name: form.name,
          email: form.email,
          isAdmin: form.isAdmin,
          ...(form.password ? { password: form.password } : {}),
        }
        await onUpdateUser(selectedUser.id, payload)
      } else {
        await onCreateUser({
          name: form.name,
          email: form.email,
          password: form.password,
          isAdmin: form.isAdmin,
        })
        setForm(emptyForm())
      }
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Failed to save account')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(user) {
    const message = `Delete ${user.name}'s account? This will also remove their activity records.`
    if (!window.confirm(message)) return

    setError('')
    setSubmitting(true)
    try {
      await onDeleteUser(user)
      if (selectedUserId === user.id) {
        startCreateMode()
      }
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Failed to delete account')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm sm:p-6">
      <div className="relative grid h-[92vh] w-full max-w-6xl gap-0 overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-2xl lg:h-[90vh] lg:grid-cols-[1fr,1.1fr] lg:rounded-[30px]">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 z-10 rounded-full bg-white/90 p-2 text-slate-400 shadow-sm transition hover:bg-white hover:text-slate-700 sm:right-5 sm:top-5"
        >
          <span className="text-2xl leading-none">&times;</span>
        </button>

        <section className="flex min-h-0 flex-col border-b border-slate-200 bg-slate-50/80 p-4 sm:p-6 lg:border-b-0 lg:border-r">
          <div className="flex items-start gap-4 pr-12 sm:pr-14">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">Admin Control</p>
              <h2 className="mt-2 text-xl font-semibold text-slate-950 sm:text-2xl">Manage staff accounts</h2>
              <p className="mt-2 text-sm text-slate-500">Create employee logins, update roles, or remove accounts.</p>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between">
            <div className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600">
              {users.length} accounts
            </div>
            <button
              type="button"
              onClick={startCreateMode}
              className="rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              New account
            </button>
          </div>

          <div className="mt-5 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {users.map((user) => {
              const isCurrentUser = currentUser?.id === user.id
              return (
                <div
                  key={user.id}
                  className={classNames(
                    'rounded-3xl border px-4 py-4 transition',
                    selectedUserId === user.id ? 'border-slate-900 bg-slate-950 text-white' : 'border-slate-200 bg-white',
                  )}
                >
                  <button type="button" onClick={() => setSelectedUserId(user.id)} className="w-full text-left">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-semibold">{user.name}</p>
                        <p className={classNames('text-sm', selectedUserId === user.id ? 'text-slate-300' : 'text-slate-500')}>{user.email}</p>
                      </div>
                      <span className={classNames(
                        'rounded-full px-2 py-1 text-xs font-semibold',
                        selectedUserId === user.id ? 'bg-white/10 text-white' : 'bg-slate-100 text-slate-700',
                      )}>
                        {user.isAdmin ? 'Admin' : 'Employee'}
                      </span>
                    </div>
                    <div className={classNames('mt-3 flex items-center gap-3 text-xs', selectedUserId === user.id ? 'text-slate-300' : 'text-slate-500')}>
                      <span>{user._count?.events ?? 0} activities</span>
                      {isCurrentUser && <span>Current session</span>}
                    </div>
                  </button>

                  <div className="mt-4 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedUserId(user.id)}
                      className={classNames(
                        'rounded-full px-3 py-1.5 text-xs font-semibold transition',
                        selectedUserId === user.id ? 'bg-white text-slate-900' : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
                      )}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(user)}
                      disabled={submitting || isCurrentUser}
                      className={classNames(
                        'rounded-full px-3 py-1.5 text-xs font-semibold transition',
                        isCurrentUser
                          ? 'cursor-not-allowed bg-slate-200 text-slate-400'
                          : 'bg-red-50 text-red-600 hover:bg-red-100',
                      )}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <section className="min-h-0 overflow-y-auto p-4 sm:p-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">
              {selectedUser ? 'Edit account' : 'Create account'}
            </p>
            <h3 className="mt-2 text-xl font-semibold text-slate-950 sm:text-2xl">
              {selectedUser ? `Update ${selectedUser.name}` : 'Add a new employee or admin'}
            </h3>
            <p className="mt-2 text-sm text-slate-500">
              {selectedUser
                ? 'Update the profile, reset the password, or change the account role.'
                : 'New accounts can sign in immediately after you save them.'}
            </p>
          </div>

          {error && (
            <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Full name</span>
              <input
                value={form.name}
                onChange={(event) => updateField('name', event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-brand-500 focus:bg-white"
                placeholder="Employee name"
                required
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Username</span>
              <input
                value={form.email}
                onChange={(event) => updateField('email', event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-brand-500 focus:bg-white"
                placeholder="maria or team.lead"
                required
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">
                {selectedUser ? 'New password' : 'Password'}
              </span>
              <input
                type="password"
                value={form.password}
                onChange={(event) => updateField('password', event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-brand-500 focus:bg-white"
                placeholder={selectedUser ? 'Leave blank to keep current password' : 'At least 6 characters'}
                required={!selectedUser}
                minLength={6}
              />
            </label>

            <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-slate-800">Administrator role</p>
                <p className="text-xs text-slate-500">Admins can manage accounts and all activity records.</p>
              </div>
              <input
                type="checkbox"
                checked={form.isAdmin}
                onChange={(event) => updateField('isAdmin', event.target.checked)}
                disabled={selectedUser?.id === currentUser?.id}
                className="h-4 w-4 rounded border-slate-300 text-brand-600"
              />
            </label>

            {selectedUser?.id === currentUser?.id && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Your current session cannot remove its own admin access.
              </div>
            )}

            <div className="flex flex-col gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={selectedUser ? startCreateMode : onClose}
                className="rounded-full border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100"
              >
                {selectedUser ? 'Create another account' : 'Close'}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50 sm:w-auto"
              >
                {submitting ? 'Saving...' : selectedUser ? 'Save account' : 'Create account'}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  )
}
