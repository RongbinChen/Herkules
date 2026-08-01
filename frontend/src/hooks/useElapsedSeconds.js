import { useEffect, useState } from 'react'

// Visible seconds counter for long AI requests, so a 20–150s wait doesn't look
// frozen. Uses a wall-clock baseline rather than incrementing a counter, so the
// number stays accurate even when a background tab throttles the interval.
// Resets to 0 each time `active` flips on.
export function useElapsedSeconds(active) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!active) return
    setElapsed(0)
    const started = Date.now()
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - started) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [active])

  return elapsed
}

export default useElapsedSeconds
