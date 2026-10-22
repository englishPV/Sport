import type { ExerciseCategory } from './types'

/**
 * Calcule l'incrément de repos optimal (en secondes) selon la littérature
 * scientifique en hypertrophie (Schoenfeld et al., 2016 ; Morán-Navarro et al., 2017) :
 * - Échauffement : +15s (simple transition de charge, pas de fatigue périphérique)
 * - Isolation (mono-articulaire) : +20s (+30s si échec musculaire)
 * - Polyarticulaire (lourd / systémique) : +30s (+45s si échec musculaire)
 */
export function getOptimalExtraRestSeconds(params: {
  category: ExerciseCategory
  isWarmup: boolean
  failure: boolean
}): number {
  const { category, isWarmup, failure } = params
  if (isWarmup) return 15
  if (category === 'iso') {
    return failure ? 30 : 20
  }
  return failure ? 45 : 30
}

/**
 * Ajuste la durée de repos initiale après validation d'une série :
 * - Série d'échauffement : plafonnée à 60-75s
 * - Série menée à l'échec musculaire : +30s de récupération nerveuse/périphérique
 */
export function computeSetRestDuration(params: {
  baseRestSeconds: number
  category: ExerciseCategory
  isWarmup: boolean
  failure: boolean
}): number {
  const { baseRestSeconds, category, isWarmup, failure } = params
  if (isWarmup) {
    return Math.min(60, Math.max(45, Math.round(baseRestSeconds * 0.5)))
  }
  if (failure) {
    return baseRestSeconds + (category === 'poly' ? 30 : 20)
  }
  return baseRestSeconds
}

export function formatMinutesAndSecondsFr(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const mins = Math.floor(safe / 60)
  const secs = safe % 60
  if (mins === 0) return `${secs} s`
  if (secs === 0) return `${mins} min`
  return `${mins} min ${secs} s`
}
