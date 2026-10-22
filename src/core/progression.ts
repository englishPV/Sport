import { sortSessionsDesc } from './cycle'
import { getPerformedSets, isHistorySession } from './stats'
import type { CoachPlan, Exercise, ExerciseTarget, Session, Settings, SetEntry, Timestamp } from './types'

export const FIRST_TIME_TIP = 'Première fois : choisis une charge qui permet 8 à 12 reps propres.'
export const INCREASE_TIP = 'Toutes les séries ≥ 12 reps : charge augmentée.'
export const REP_TIP = 'Même charge, vise une rep de plus par série.'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function averageRest(sets: readonly SetEntry[]): number | null {
  const values = sets
    .map((set) => set.restSecondsActual)
    .filter((value): value is number => value !== null && Number.isFinite(value))
  if (values.length === 0) return null
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

export interface LastPerformance {
  session: Session
  sets: SetEntry[]
}

/** Dernière performance d'un exercice dans les sessions fournies (les plus récentes d'abord). */
export function getLastPerformance(
  exerciseId: string,
  sessions: readonly Session[],
): LastPerformance | null {
  const ordered = sortSessionsDesc(sessions.filter(isHistorySession))
  for (const session of ordered) {
    const sets = getPerformedSets(session, exerciseId)
    if (sets.length > 0) return { session, sets }
  }
  return null
}

export function computeFallbackTarget(
  exercise: Exercise,
  sessions: readonly Session[],
  settings: Settings,
): ExerciseTarget {
  const last = getLastPerformance(exercise.id, sessions)

  if (!last) {
    return {
      exerciseId: exercise.id,
      targetWeight: 0,
      targetRepsMin: 8,
      targetRepsMax: 12,
      targetRestSeconds: settings.defaultRestSeconds,
      tip: FIRST_TIME_TIP,
    }
  }

  const performance = last.sets
  const weight = performance[0]?.weight ?? 0
  const repValues = performance.map((set) => set.reps)
  const minReps = Math.min(...repValues)
  const maxReps = Math.max(...repValues)
  const restAverage = averageRest(performance)
  const targetRestSeconds =
    restAverage === null ? settings.defaultRestSeconds : clamp(restAverage, 60, 180)

  const base = {
    exerciseId: exercise.id,
    targetRestSeconds,
  }

  // Poids du corps : jamais d'augmentation de charge.
  if (weight === 0) {
    return {
      ...base,
      targetWeight: 0,
      targetRepsMin: minReps + 1,
      targetRepsMax: Math.max(maxReps, minReps + 1),
      tip: REP_TIP,
    }
  }

  if (minReps >= 12) {
    return {
      ...base,
      targetWeight: weight + settings.weightStep,
      targetRepsMin: 8,
      targetRepsMax: 12,
      tip: INCREASE_TIP,
    }
  }

  return {
    ...base,
    targetWeight: weight,
    targetRepsMin: minReps + 1,
    targetRepsMax: Math.max(maxReps, minReps + 1),
    tip: REP_TIP,
  }
}

/** Objectifs déterministes pour chaque exercice (mode sans IA). */
export function computeFallbackTargets(
  exercises: readonly Exercise[],
  sessions: readonly Session[],
  settings: Settings,
): ExerciseTarget[] {
  return exercises.map((exercise) => computeFallbackTarget(exercise, sessions, settings))
}

export function fallbackGlobalNote(settings: Settings): string {
  return `Mode hors-ligne : objectifs calculés automatiquement (+1 rep ou +${settings.weightStep} kg).`
}

export function buildFallbackPlan(params: {
  exercises: readonly Exercise[]
  sessions: readonly Session[]
  settings: Settings
  inputHash: string
  model?: string | null
  generatedAt?: Timestamp
  targets?: ExerciseTarget[]
}): CoachPlan {
  return {
    generatedAt: params.generatedAt ?? Date.now(),
    source: 'fallback',
    model: params.model ?? null,
    globalNote: fallbackGlobalNote(params.settings),
    targets: params.targets ?? computeFallbackTargets(params.exercises, params.sessions, params.settings),
    inputHash: params.inputHash,
  }
}
