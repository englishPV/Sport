import type { ExerciseLog, ISODate, Session, SetEntry, Timestamp } from './types'

export function isHistorySession(session: Session): boolean {
  return session.status === 'completed' || session.status === 'imported'
}

/** Séries réellement effectuées d'un exercice (ignore les séries non validées). */
export function getPerformedSets(session: Session, exerciseId: string): SetEntry[] {
  const log = session.exercises.find((entry) => entry.exerciseId === exerciseId)
  if (!log) return []
  return log.sets.filter((set) => set.completedAt !== null && set.reps > 0)
}

export function getExerciseLog(session: Session, exerciseId: string): ExerciseLog | null {
  return session.exercises.find((entry) => entry.exerciseId === exerciseId) ?? null
}

export function getSessionVolume(session: Session): number {
  let total = 0
  for (const log of session.exercises) {
    for (const set of log.sets) {
      if (set.completedAt === null) continue
      total += set.weight * set.reps
    }
  }
  return round1(total)
}

export function getExerciseVolume(session: Session, exerciseId: string): number {
  return round1(getPerformedSets(session, exerciseId).reduce((sum, set) => sum + set.weight * set.reps, 0))
}

export function getSessionSetCount(session: Session): number {
  return session.exercises.reduce(
    (count, log) => count + log.sets.filter((set) => set.completedAt !== null).length,
    0,
  )
}

export function getSessionDurationSeconds(session: Session): number {
  if (session.startedAt === null || session.endedAt === null) return 0
  return Math.max(0, Math.round((session.endedAt - session.startedAt) / 1000))
}

/** 1RM estimé (Epley) : poids × (1 + reps / 30). */
export function epley1RM(weight: number, reps: number): number {
  if (reps <= 0 || weight <= 0) return 0
  return round1(weight * (1 + reps / 30))
}

export interface ExerciseSeriesPoint {
  date: ISODate
  maxWeight: number
  volume: number
  avgRest: number | null
  estimated1RM: number
}

function averageRest(sets: readonly SetEntry[]): number | null {
  const values = sets
    .map((set) => set.restSecondsActual)
    .filter((value): value is number => value !== null && Number.isFinite(value))
  if (values.length === 0) return null
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

/** Série temporelle d'un exercice sur les sessions completed|imported, triée par date. */
export function getExerciseSeries(exerciseId: string, sessions: Session[]): ExerciseSeriesPoint[] {
  return sessions
    .filter(isHistorySession)
    .map((session) => ({ session, sets: getPerformedSets(session, exerciseId) }))
    .filter(({ sets }) => sets.length > 0)
    .sort((a, b) => a.session.date.localeCompare(b.session.date))
    .map(({ session, sets }) => ({
      date: session.date,
      maxWeight: Math.max(...sets.map((set) => set.weight)),
      volume: round1(sets.reduce((sum, set) => sum + set.weight * set.reps, 0)),
      avgRest: averageRest(sets),
      estimated1RM: Math.max(...sets.map((set) => epley1RM(set.weight, set.reps))),
    }))
}

export type RecordKind = 'weight' | 'volume'

export interface RecordBreak {
  exerciseId: string
  kind: RecordKind
  value: number
  previous: number | null
}

function isBefore(candidate: Session, reference: Session): boolean {
  if (candidate.date !== reference.date) return candidate.date < reference.date
  return (candidate.endedAt ?? 0) < (reference.endedAt ?? 0)
}

/**
 * Records battus par `session` : poids max sur une série (reps ≥ 1) et volume
 * max par exercice, comparés à toutes les sessions antérieures.
 */
export function getRecordBreaks(session: Session, allSessions: readonly Session[]): RecordBreak[] {
  const previousSessions = allSessions.filter(
    (candidate) =>
      candidate.id !== session.id && isHistorySession(candidate) && isBefore(candidate, session),
  )
  const records: RecordBreak[] = []

  for (const log of session.exercises) {
    const sets = getPerformedSets(session, log.exerciseId)
    if (sets.length === 0) continue

    const maxWeight = Math.max(...sets.map((set) => set.weight))
    const volume = getExerciseVolume(session, log.exerciseId)

    const previousWeights = previousSessions.flatMap((previous) =>
      getPerformedSets(previous, log.exerciseId).map((set) => set.weight),
    )
    const previousVolumes = previousSessions
      .map((previous) => getExerciseVolume(previous, log.exerciseId))
      .filter((value) => value > 0)

    const previousMax = previousWeights.length > 0 ? Math.max(...previousWeights) : null
    if (maxWeight > 0 && (previousMax === null || maxWeight > previousMax)) {
      records.push({ exerciseId: log.exerciseId, kind: 'weight', value: maxWeight, previous: previousMax })
    }

    const previousVolume = previousVolumes.length > 0 ? Math.max(...previousVolumes) : null
    if (volume > 0 && (previousVolume === null || volume > previousVolume)) {
      records.push({ exerciseId: log.exerciseId, kind: 'volume', value: volume, previous: previousVolume })
    }
  }

  return records
}

export interface GlobalProgression {
  currentVolume: number
  previousVolume: number
  percent: number | null
}

const DAY_MS = 86_400_000

/** Volume des 4 dernières semaines vs les 4 précédentes. */
export function getGlobalProgression(
  sessions: readonly Session[],
  now: Timestamp = Date.now(),
): GlobalProgression {
  const today = new Date(now)
  const endOfToday = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) + DAY_MS - 1
  const fourWeeksAgo = endOfToday - 28 * DAY_MS
  const eightWeeksAgo = endOfToday - 56 * DAY_MS

  let currentVolume = 0
  let previousVolume = 0
  for (const session of sessions) {
    if (!isHistorySession(session)) continue
    const sessionTime = dateToUtc(session.date)
    if (sessionTime === null) continue
    const volume = getSessionVolume(session)
    if (sessionTime >= fourWeeksAgo && sessionTime <= endOfToday) currentVolume += volume
    else if (sessionTime >= eightWeeksAgo && sessionTime < fourWeeksAgo) previousVolume += volume
  }

  currentVolume = round1(currentVolume)
  previousVolume = round1(previousVolume)
  const percent =
    previousVolume > 0 ? Math.round(((currentVolume - previousVolume) / previousVolume) * 100) : null

  return { currentVolume, previousVolume, percent }
}

function dateToUtc(date: ISODate): number | null {
  const [year, month, day] = date.split('-').map(Number)
  if (!year || !month || !day) return null
  return Date.UTC(year, month - 1, day)
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/** Affichage d'une charge : `PDC` quand le poids est nul et l'exercice au poids du corps. */
export function formatWeight(weight: number, unit: 'kg' | 'bodyweight' = 'kg'): string {
  if (weight === 0 && unit === 'bodyweight') return 'PDC'
  const rounded = Math.round(weight * 100) / 100
  return `${rounded} kg`
}

/** Série « fantôme » : même index dans la dernière session du même type. */
export function getGhostSet(
  sessionTypeId: string,
  exerciseId: string,
  setIndex: number,
  sessions: readonly Session[],
  excludeSessionId?: string,
): { weight: number; reps: number; date: ISODate } | null {
  const candidates = [...sessions]
    .filter(
      (session) =>
        session.id !== excludeSessionId &&
        session.sessionTypeId === sessionTypeId &&
        isHistorySession(session),
    )
    .sort((a, b) => {
      const byDate = b.date.localeCompare(a.date)
      if (byDate !== 0) return byDate
      return (b.endedAt ?? 0) - (a.endedAt ?? 0)
    })

  for (const session of candidates) {
    const match = getPerformedSets(session, exerciseId).find((set) => set.index === setIndex)
    if (match) return { weight: match.weight, reps: match.reps, date: session.date }
  }

  return null
}
