import { Check } from 'lucide-react'
import { formatWeight } from '../../core/stats'
import type { SetEntry, Unit } from '../../core/types'

export interface SetRowProps {
  set: SetEntry
  unit: Unit
}

export function SetRow({ set, unit }: SetRowProps) {
  return (
    <li className="flex items-center gap-2 rounded-lg bg-base/60 px-3 py-2 text-sm">
      <Check size={14} className="shrink-0 text-success" aria-label="Validée" />
      <span className="font-semibold text-ink">{formatWeight(set.weight, unit)}</span>
      <span className="text-muted">×</span>
      <span className="font-semibold text-ink">{set.reps}</span>
      {set.rpe !== null ? <span className="text-xs text-muted">RPE {set.rpe}</span> : null}
      {set.restSecondsActual !== null ? (
        <span className="ml-auto text-xs text-muted">repos {set.restSecondsActual} s</span>
      ) : null}
      {set.note ? <span className="ml-auto truncate text-xs italic text-muted">« {set.note} »</span> : null}
    </li>
  )
}
