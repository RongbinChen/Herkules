import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { authAPI } from '../api/api'

const HERKULES_GROUP_LOGO_URL = 'https://hgms.herkulesgroup.info/template-extension/hgms/herkulesgroup.png'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await authAPI.login({ email, password })
      login(res.data.token, res.data.user)
    } catch (err) {
      setError(err.response?.data?.error || 'Invalid credentials')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-scene">
      {/* Animated aurora + floating orbs */}
      <div className="auth-aurora" aria-hidden="true" />
      <div className="auth-orb auth-orb--one" aria-hidden="true" />
      <div className="auth-orb auth-orb--two" aria-hidden="true" />
      <div className="auth-orb auth-orb--three" aria-hidden="true" />
      <div className="auth-grid" aria-hidden="true" />

      <div className="auth-card">
        <div className="auth-card__glow" aria-hidden="true" />

        <div className="auth-card__inner">
          <div className="mb-6 flex justify-center">
            <div className="auth-logo">
              <span className="auth-logo__ring" aria-hidden="true" />
              <img
                src={HERKULES_GROUP_LOGO_URL}
                alt="HerkulesGroup"
                className="auth-logo__img"
              />
            </div>
          </div>

          <h1 className="auth-title">Calendar App</h1>
          <p className="auth-subtitle">Sign in to continue</p>

          {error && <div className="auth-error">{error}</div>}

          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            <label className="auth-field">
              <span className="auth-field__label">Email or username</span>
              <input
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@waldrich-siegen.com"
                className="auth-input"
                autoComplete="username"
                required
              />
            </label>

            <label className="auth-field">
              <span className="auth-field__label">Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="auth-input"
                autoComplete="current-password"
                required
                minLength={6}
              />
            </label>

            <button type="submit" disabled={loading} className="auth-submit">
              <span>{loading ? 'Signing in…' : 'Sign in'}</span>
            </button>
          </form>

          <p className="auth-footnote">
            Accounts are provisioned by your administrator.
          </p>
        </div>
      </div>
    </div>
  )
}
