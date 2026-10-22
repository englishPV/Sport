import { useEffect, useState } from 'react'

/**
 * Force un re-render toutes les `intervalMs` et retourne `Date.now()`.
 * L'intervalle ne sert QU'À rafraîchir l'affichage : aucun compteur n'est
 * incrémenté ici, toutes les valeurs sont dérivées de timestamps.
 */
export function useNow(intervalMs = 250): number {
  const [now, setNow] = useState<number>(() => Date.now())

  useEffect(() => {
    const tick = () => setNow(Date.now())
    const id = window.setInterval(tick, intervalMs)
    const onVisibility = () => tick()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [intervalMs])

  return now
}
