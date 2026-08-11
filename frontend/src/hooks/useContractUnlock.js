import { useCallback, useEffect, useState } from 'react'
import { contractsAPI } from '../api/api'

// The unlock token is scoped to one team and expires server-side. Keeping it in
// sessionStorage means walking between customers doesn't ask for the PIN again,
// while closing the tab ends the session.
//
// Shared by the customer-detail card and the standalone Contracts page so the
// two cannot drift: unlock WRC on a customer, walk into /contracts, and it is
// already open; lock it there and the card is locked too. They are never
// mounted at the same time, so no cross-component syncing is needed — adding a
// storage listener would be complexity for a case that cannot occur.
const TOKEN_KEY = 'contractUnlock'

const read = () => {
  try {
    return JSON.parse(sessionStorage.getItem(TOKEN_KEY)) || null
  } catch {
    return null
  }
}

export default function useContractUnlock(defaultTeam = 'HRC') {
  const [unlock, setUnlock] = useState(read)
  const [team, setTeam] = useState(() => read()?.team || defaultTeam)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [configured, setConfigured] = useState(null)

  useEffect(() => {
    contractsAPI.pinStatus().then((r) => setConfigured(r.data.configured)).catch(() => setConfigured([]))
  }, [])

  const lock = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY)
    setUnlock(null)
  }, [])

  const doUnlock = useCallback(async (pin, forTeam) => {
    const t = forTeam || team
    if (!pin?.trim() || busy) return false
    setBusy(true)
    setError('')
    try {
      const { data } = await contractsAPI.unlock(t, pin.trim())
      const u = { token: data.token, team: data.team }
      sessionStorage.setItem(TOKEN_KEY, JSON.stringify(u))
      setUnlock(u)
      setTeam(data.team)
      return true
    } catch (e) {
      setError(e.response?.data?.error || 'Unlock failed')
      return false
    } finally {
      setBusy(false)
    }
  }, [team, busy])

  // A 401 on any contract call means the 45-minute token ran out while the page
  // was open. Returns true when it handled the error, so callers can skip their
  // own message.
  const handleAuthError = useCallback((e) => {
    if (e?.response?.status !== 401) return false
    lock()
    setError('The contract session expired — enter the PIN again.')
    return true
  }, [lock])

  const refreshPinStatus = useCallback(async () => {
    try {
      const r = await contractsAPI.pinStatus()
      setConfigured(r.data.configured)
    } catch { /* the banner just stays as it was */ }
  }, [])

  return { unlock, team, setTeam, doUnlock, lock, busy, error, setError, configured, refreshPinStatus, handleAuthError }
}
