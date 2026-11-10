import { useCallback, useEffect, useState } from 'react'
import { contractsAPI } from '../api/api'

// The unlock token is scoped to one team and expires server-side. Keeping it in
// sessionStorage means walking between customers doesn't ask for the PIN again,
// while closing the tab ends the session.
//
// Shared by the customer-detail card, the Contracts page, and a follow-up.
// Unlock WRC on a customer, walk into /contracts, and it is already open; lock
// it there and the card is locked too. Those two are never mounted together.
// A follow-up is different: the price in the header and the contract section
// under it are on screen at once, and each calls this hook. A custom event
// keeps them on the same token. The storage event would not — it does not
// fire in the window that wrote the value.
const TOKEN_KEY = 'contractUnlock'
const UNLOCK_EVENT = 'herkules-contract-unlock'
const TEAM_EVENT = 'herkules-contract-team'

function publishUnlock(unlock) {
  if (unlock) sessionStorage.setItem(TOKEN_KEY, JSON.stringify(unlock))
  else sessionStorage.removeItem(TOKEN_KEY)
  window.dispatchEvent(new CustomEvent(UNLOCK_EVENT, { detail: unlock }))
}

// The PIN that last worked, kept so that switching teams with a master PIN
// does not ask for it again. One copy for every caller of this hook: the
// price in the header and the contract section under it each have their own
// state, and a switch from either one has to reuse the PIN just typed.
// Never sessionStorage — the token is what survives a reload, the password
// itself should not sit where any script on the page could read it back out.
let rememberedPin = ''

const read = () => {
  try {
    return JSON.parse(sessionStorage.getItem(TOKEN_KEY)) || null
  } catch {
    return null
  }
}

export default function useContractUnlock(defaultTeam = 'HRC') {
  const [unlock, setUnlock] = useState(read)
  const [team, setTeamState] = useState(() => read()?.team || defaultTeam)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [configured, setConfigured] = useState(null)
  const [masterSet, setMasterSet] = useState(false)

  const setTeam = useCallback((next) => {
    setTeamState(next)
    window.dispatchEvent(new CustomEvent(TEAM_EVENT, { detail: next }))
  }, [])

  // Another caller of this hook, on the same page, unlocked or changed team.
  useEffect(() => {
    const onUnlock = (e) => {
      const next = e.detail || null
      setUnlock(next)
      if (next?.team) setTeamState(next.team)
    }
    const onTeam = (e) => setTeamState(e.detail)
    window.addEventListener(UNLOCK_EVENT, onUnlock)
    window.addEventListener(TEAM_EVENT, onTeam)
    return () => {
      window.removeEventListener(UNLOCK_EVENT, onUnlock)
      window.removeEventListener(TEAM_EVENT, onTeam)
    }
  }, [])

  useEffect(() => {
    contractsAPI.pinStatus()
      .then((r) => { setConfigured(r.data.configured); setMasterSet(r.data.master === true) })
      .catch(() => setConfigured([]))
  }, [])

  const lock = useCallback(() => {
    rememberedPin = ''
    setUnlock(null)
    publishUnlock(null)
  }, [])

  const doUnlock = useCallback(async (pin, forTeam) => {
    const t = forTeam || team
    if (!pin?.trim() || busy) return false
    setBusy(true)
    setError('')
    try {
      const { data } = await contractsAPI.unlock(t, pin.trim())
      const u = { token: data.token, team: data.team, via: data.via }
      rememberedPin = pin.trim()
      setUnlock(u)
      setTeamState(data.team)
      publishUnlock(u)
      return true
    } catch (e) {
      setError(e.response?.data?.error || 'Unlock failed')
      return false
    } finally {
      setBusy(false)
    }
  }, [team, busy])

  /**
   * Move to another team, reusing the PIN already typed if it opens that one
   * too — which is exactly what a master PIN does. Returns true when the switch
   * happened silently; false means the caller should ask for a PIN.
   *
   * Deliberately not "unlock everything at once": the token still covers one
   * team, so the server-side `where.team` is unchanged. This only removes the
   * retyping, it does not widen what any single token can reach.
   */
  const switchTeam = useCallback(async (next) => {
    setTeam(next)
    const pin = rememberedPin
    if (!pin) { lock(); return false }
    setBusy(true)
    try {
      const { data } = await contractsAPI.unlock(next, pin)
      const u = { token: data.token, team: data.team, via: data.via }
      setUnlock(u)
      setTeamState(data.team)
      setError('')
      publishUnlock(u)
      return true
    } catch {
      // A team PIN opens only its own team, so this is the normal path for
      // anyone without a master PIN. Fall back to asking, without an error.
      lock()
      return false
    } finally {
      setBusy(false)
    }
  }, [lock, setTeam])

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
      setMasterSet(r.data.master === true)
    } catch { /* the banner just stays as it was */ }
  }, [])

  return {
    unlock, team, setTeam, doUnlock, switchTeam, lock, busy, error, setError,
    configured, masterSet, refreshPinStatus, handleAuthError,
  }
}
