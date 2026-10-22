import { useEffect, useState } from 'react'

export function useNow(enabled: boolean, intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!enabled) return
    setNow(Date.now())
    const id = window.setInterval(() => {
      setNow(Date.now())
    }, intervalMs)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') setNow(Date.now())
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled, intervalMs])

  return now
}
