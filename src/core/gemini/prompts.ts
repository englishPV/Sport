import { sortSessionsDesc } from '../cycle'
import { getPerformedSets, isHistorySession } from '../stats'
import type { Exercise, ISODate, Session, SetEntry } from '../types'

export interface CoachInputSet {
  weight: number
  reps: number
  rpe: number | null
  note: string
}

export interface CoachInputHistory {
  date: ISODate
  sets: CoachInputSet[]
  restActualAvg: number | null
  note: string
}

export interface CoachInputExercise {
  id: string
  name: string
  history: CoachInputHistory[]
}

export interface CoachInput {
  sessionTypeName: string
  exercises: CoachInputExercise[]
  weightStep: number
}

function averageRest(sets: readonly SetEntry[]): number | null {
  const values = sets
    .map((set) => set.restSecondsActual)
    .filter((value): value is number => value !== null && Number.isFinite(value))
  if (values.length === 0) return null
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

/**
 * Construit l'entrée du coach : pour chaque exercice de la séance, les
 * 3 dernières sessions completed|imported du même type contenant l'exercice.
 */
export function buildCoachInput(params: {
  session: Session
  sessionTypeName: string
  exercises: readonly Exercise[]
  sessions: readonly Session[]
  weightStep: number
}): CoachInput {
  const { session, sessionTypeName, exercises, sessions, weightStep } = params

  const historySessions = sortSessionsDesc(
    sessions.filter(
      (candidate) =>
        candidate.id !== session.id &&
        candidate.sessionTypeId === session.sessionTypeId &&
        isHistorySession(candidate),
    ),
  )

  const inputExercises: CoachInputExercise[] = session.exercises.map((log) => {
    const exercise = exercises.find((candidate) => candidate.id === log.exerciseId)
    const history: CoachInputHistory[] = historySessions
      .map((previous) => {
        const sets = getPerformedSets(previous, log.exerciseId)
        const previousLog = previous.exercises.find((entry) => entry.exerciseId === log.exerciseId)
        if (sets.length === 0) return null
        return {
          date: previous.date,
          sets: sets.map((set) => ({
            weight: set.weight,
            reps: set.reps,
            rpe: set.rpe,
            note: set.note,
          })),
          restActualAvg: averageRest(sets),
          note: previousLog?.note ?? '',
        } satisfies CoachInputHistory
      })
      .filter((entry): entry is CoachInputHistory => entry !== null)
      .slice(0, 3)

    return {
      id: log.exerciseId,
      name: exercise?.name ?? log.exerciseId,
      history,
    }
  })

  return { sessionTypeName, exercises: inputExercises, weightStep }
}

/** Prompt envoyé à Gemini — structure fixe, en français. */
export function buildCoachPrompt(input: CoachInput): string {
  return `Tu es un coach de musculation. Réponds UNIQUEMENT en JSON conforme au schéma.
Objectif : surcharge progressive prudente. Règles :
- Si toutes les séries de la dernière fois ont atteint le haut de la fourchette de reps (ou RPE ≤ 8), proposer +${input.weightStep} kg.
- Sinon garder la charge et viser +1 rep.
- Si un commentaire mentionne douleur/blessure, ne pas augmenter et le dire dans exercise_tip.
- target_rest_seconds entre 60 et 180, basé sur les repos réels observés.
- global_coach_note : 2 à 4 phrases, en français, concret, pas de blabla.
- exercise_tip : 1 phrase max par exercice.
Utilise exactement les exercise_id fournis.

Séance : ${input.sessionTypeName}
Données (JSON) :
${JSON.stringify(input.exercises, null, 0)}`
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `fnv1a-${hash.toString(16).padStart(8, '0')}`
}

/**
 * Empreinte SHA-256 de `JSON.stringify(input)` + modèle (cache des plans).
 * Repli déterministe (FNV-1a) si `crypto.subtle` n'est pas disponible.
 */
export async function computeInputHash(input: CoachInput, model: string): Promise<string> {
  const payload = `${JSON.stringify(input)}|${model}`
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return fnv1a(payload)
  try {
    const bytes = new TextEncoder().encode(payload)
    const digest = await subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  } catch {
    return fnv1a(payload)
  }
}
