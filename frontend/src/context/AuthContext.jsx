import { createContext, useContext, useState, useEffect } from 'react'

const AuthContext = createContext(null)

function parseJwtPayload(token) {
  try {
    const [, payload] = token.split('.')
    if (!payload) return null
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return null
  }
}

function isTokenExpired(token) {
  if (!token) return true
  const payload = parseJwtPayload(token)
  if (!payload?.exp) return false
  return payload.exp * 1000 <= Date.now()
}

function readStoredAuth() {
  const token = localStorage.getItem('token')
  const user = localStorage.getItem('user')

  if (!token || isTokenExpired(token)) {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    return { token: null, user: null }
  }

  return {
    token,
    user: user ? JSON.parse(user) : null,
  }
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => readStoredAuth().token)
  const [user, setUser] = useState(() => readStoredAuth().user)

  useEffect(() => {
    if (!token) return
    if (!isTokenExpired(token)) return
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setToken(null)
    setUser(null)
  }, [token])

  const login = (newToken, newUser) => {
    localStorage.setItem('token', newToken)
    localStorage.setItem('user', JSON.stringify(newUser))
    setToken(newToken)
    setUser(newUser)
  }

  const logout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setToken(null)
    setUser(null)
  }

  const updateUser = (nextUser) => {
    localStorage.setItem('user', JSON.stringify(nextUser))
    setUser(nextUser)
  }

  return (
    <AuthContext.Provider value={{ token, user, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
