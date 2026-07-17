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
      setError(err.response?.data?.error || 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 px-4 py-8">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-md">
        <div className="mb-6 flex justify-center">
          <img
            src={HERKULES_GROUP_LOGO_URL}
            alt="HerkulesGroup"
            className="max-h-16 w-auto object-contain sm:max-h-20"
          />
        </div>

        <h1 className="text-2xl font-bold mb-6 text-center text-gray-800">
          Calendar App
        </h1>

        <h2 className="text-xl mb-4 text-center">Login</h2>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            placeholder="Email or username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md"
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md"
            required
            minLength={6}
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-500 text-white py-2 rounded-md hover:bg-blue-600 disabled:opacity-50"
          >
            {loading ? 'Please wait...' : 'Login'}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-gray-500">
          Accounts are provisioned by an administrator.
        </p>
      </div>
    </div>
  )
}
