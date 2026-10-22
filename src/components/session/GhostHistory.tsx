import { formatWeight } from '../../core/stats'
import type { Unit } from '../../core/types'

export interface GhostHistoryProps {
  ghost: { weight: number; reps: number } | null
  unit: Unit
}

export function GhostHistory({ ghost, unit }: GhostHistoryProps) {
  return (
    <p className="text-sm text-ink opacity-40">
      {ghost
        ? `Dernière fois : ${formatWeight(ghost.weight, unit)} × ${ghost.reps}`
        : "Pas d'historique"}
    </p>
  )
}
