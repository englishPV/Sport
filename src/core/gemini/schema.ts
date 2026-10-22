import { z } from 'zod'
import { NOTE_MAX_LENGTH, TIP_MAX_LENGTH, type ExerciseTarget } from '../types'
import { GeminiError, stripMarkdownFences } from './client'

/** Sous-ensemble OpenAPI accepté par `generationConfig.responseSchema`. */
export const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    global_coach_note: { type: 'STRING' },
    exercises_targets: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          exercise_id: { type: 'STRING' },
          target_weight: { type: 'NUMBER' },
          target_reps_min: { type: 'INTEGER' },
          target_reps_max: { type: 'INTEGER' },
          target_rest_seconds: { type: 'INTEGER' },
          exercise_tip: { type: 'STRING' },
        },
        required: [
          'exercise_id',
          'target_weight',
          'target_reps_min',
          'target_reps_max',
          'target_rest_seconds',
          'exercise_tip',
        ],
      },
    },
  },
  required: ['global_coach_note', 'exercises_targets'],
} as const

export const GeminiTargetSchema = z.object({
  exercise_id: z.string(),
  target_weight: z.number(),
  target_reps_min: z.number(),
  target_reps_max: z.number(),
  target_rest_seconds: z.number(),
  exercise_tip: z.string(),
})

export const GeminiCoachResponseSchema = z.object({
  global_coach_note: z.string(),
  exercises_targets: z.array(GeminiTargetSchema),
})
export type GeminiCoachResponse = z.infer<typeof GeminiCoachResponseSchema>

export interface ParsedCoachResponse {
  globalNote: string
  targets: ExerciseTarget[]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function roundToStep(value: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return Math.max(0, value)
  const rounded = Math.round(value / step) * step
  return Math.max(0, Math.round(rounded * 100) / 100)
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max).trimEnd()
}

/**
 * Valide et normalise la réponse du modèle :
 * ids inconnus ignorés, valeurs clampées, fourchette de reps ordonnée,
 * charge arrondie au pas, textes tronqués.
 */
export function normalizeCoachResponse(
  response: GeminiCoachResponse,
  options: { knownExerciseIds: readonly string[]; weightStep: number },
): ParsedCoachResponse {
  const known = new Set(options.knownExerciseIds)
  const seen = new Set<string>()
  const targets: ExerciseTarget[] = []

  for (const raw of response.exercises_targets) {
    if (!known.has(raw.exercise_id) || seen.has(raw.exercise_id)) continue
    seen.add(raw.exercise_id)

    let targetRepsMin = clamp(Math.round(raw.target_reps_min), 1, 30)
    let targetRepsMax = clamp(Math.round(raw.target_reps_max), 1, 30)
    if (targetRepsMin > targetRepsMax) {
      const swapped = targetRepsMin
      targetRepsMin = targetRepsMax
      targetRepsMax = swapped
    }

    targets.push({
      exerciseId: raw.exercise_id,
      targetWeight: roundToStep(Math.max(0, raw.target_weight), options.weightStep),
      targetRepsMin,
      targetRepsMax,
      targetRestSeconds: Math.round(clamp(raw.target_rest_seconds, 30, 300)),
      tip: truncate(raw.exercise_tip.trim(), TIP_MAX_LENGTH),
    })
  }

  return {
    globalNote: truncate(response.global_coach_note.trim(), NOTE_MAX_LENGTH),
    targets,
  }
}

/** Parse le texte brut renvoyé par Gemini (fences markdown tolérées). */
export function parseCoachResponse(
  rawText: string,
  options: { knownExerciseIds: readonly string[]; weightStep: number },
): ParsedCoachResponse {
  let json: unknown
  try {
    json = JSON.parse(stripMarkdownFences(rawText))
  } catch {
    throw new GeminiError('invalid_json')
  }

  const parsed = GeminiCoachResponseSchema.safeParse(json)
  if (!parsed.success) throw new GeminiError('invalid_response')

  return normalizeCoachResponse(parsed.data, options)
}

/** Complète les cibles manquantes avec le fallback déterministe. */
export function completeTargets(
  targets: readonly ExerciseTarget[],
  exerciseIds: readonly string[],
  fallbackTargets: readonly ExerciseTarget[],
): ExerciseTarget[] {
  const byId = new Map(targets.map((target) => [target.exerciseId, target]))
  const fallbackById = new Map(fallbackTargets.map((target) => [target.exerciseId, target]))
  const result: ExerciseTarget[] = []

  for (const exerciseId of exerciseIds) {
    const target = byId.get(exerciseId) ?? fallbackById.get(exerciseId)
    if (target) result.push(target)
  }

  return result
}
