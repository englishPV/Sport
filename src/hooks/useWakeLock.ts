import { useEffect } from 'react'

/**
 * Demande un Wake Lock « screen » tant que `active` est vrai.
 * Silencieux si l'API n'existe pas (iOS ancien, desktop, iframe).
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return

    let sentinel: WakeLockSentinel | null = null
    let cancelled = false

    const request = async (): Promise<void> => {
      try {
        const lock = await navigator.wakeLock.request('screen')
        if (cancelled) {
          void lock.release()
          return
        }
        sentinel = lock
      } catch {
        // refusé ou non supporté : on ignore silencieusement
      }
    }

    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') void request()
    }

    void request()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      if (sentinel) void sentinel.release().catch(() => undefined)
      sentinel = null
    }
  }, [active])
}
