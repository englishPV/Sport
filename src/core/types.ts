import { z } from 'zod'

/** Jour seul, format `YYYY-MM-DD` — jamais d'heure. */
export type ISODate = string
/** Millisecondes depuis l'époque (Date.now()). */
export type Timestamp = number

/* -------------------------------------------------------------------------- */
/* Constantes partagées                                                       */
/* -------------------------------------------------------------------------- */

export const SCHEMA_VERSION = 1 as const
export const STORAGE_KEY = 'gymlog:v1'

export const DEFAULT_WEIGHT_STEP = 2.5
export const DEFAULT_REST_SECONDS = 90
/** Modèle demandé : Gemini 3.8 Flash, raisonnement « high ». */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash'
export const DEFAULT_GEMINI_THINKING_LEVEL = 'high' as const

export const NOTE_MAX_LENGTH = 600
export const TIP_MAX_LENGTH = 200

/* -------------------------------------------------------------------------- */
/* Schémas de base                                                            */
/* -------------------------------------------------------------------------- */

export const UnitSchema = z.enum(['kg', 'bodyweight'])
export type Unit = z.infer<typeof UnitSchema>

export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date ISO attendue (YYYY-MM-DD)')

export const ExerciseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  normalizedName: z.string().min(1),
  unit: UnitSchema,
  defaultRestSeconds: z.number().int().min(0).max(900),
})
export type Exercise = z.infer<typeof ExerciseSchema>

export const SessionTypeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  order: z.number().int().min(0),
  exerciseIds: z.array(z.string()),
})
export type SessionType = z.infer<typeof SessionTypeSchema>

export const SetEntrySchema = z.object({
  index: z.number().int().min(0),
  weight: z.number().min(0),
  reps: z.number().int().min(0),
  restSecondsPlanned: z.number().min(0).nullable(),
  restSecondsActual: z.number().min(0).nullable(),
  rpe: z.number().min(1).max(10).nullable(),
  note: z.string().max(1000),
  completedAt: z.number().nullable(),
})
export type SetEntry = z.infer<typeof SetEntrySchema>

export const ExerciseLogSchema = z.object({
  exerciseId: z.string().min(1),
  sets: z.array(SetEntrySchema),
  note: z.string().max(1000),
})
export type ExerciseLog = z.infer<typeof ExerciseLogSchema>

export const SessionStatusSchema = z.enum(['planned', 'in_progress', 'completed', 'imported'])
export type SessionStatus = z.infer<typeof SessionStatusSchema>

export const SessionSourceSchema = z.enum(['import', 'app'])
export type SessionSource = z.infer<typeof SessionSourceSchema>

export const ExerciseTargetSchema = z.object({
  exerciseId: z.string().min(1),
  targetWeight: z.number().min(0),
  targetRepsMin: z.number().int().min(1).max(30),
  targetRepsMax: z.number().int().min(1).max(30),
  targetRestSeconds: z.number().int().min(30).max(300),
  tip: z.string().max(TIP_MAX_LENGTH),
})
export type ExerciseTarget = z.infer<typeof ExerciseTargetSchema>

export const CoachPlanSchema = z.object({
  generatedAt: z.number(),
  source: z.enum(['gemini', 'fallback']),
  model: z.string().nullable(),
  globalNote: z.string().max(NOTE_MAX_LENGTH),
  targets: z.array(ExerciseTargetSchema),
  inputHash: z.string().min(1),
})
export type CoachPlan = z.infer<typeof CoachPlanSchema>

export const SessionSchema = z.object({
  id: z.string().min(1),
  sessionTypeId: z.string().min(1),
  date: IsoDateSchema,
  startedAt: z.number().nullable(),
  endedAt: z.number().nullable(),
  status: SessionStatusSchema,
  exercises: z.array(ExerciseLogSchema),
  coachPlan: CoachPlanSchema.nullable(),
  source: SessionSourceSchema,
})
export type Session = z.infer<typeof SessionSchema>

export const SettingsSchema = z.object({
  geminiApiKey: z.string(),
  geminiModel: z.string().min(1),
  defaultRestSeconds: z.number().int().min(0).max(900),
  soundEnabled: z.boolean(),
  vibrationEnabled: z.boolean(),
  weightStep: z.number().positive().max(50),
})
export type Settings = z.infer<typeof SettingsSchema>

export const RestTimerSchema = z.object({
  startedAt: z.number(),
  durationSeconds: z.number(),
})
export type RestTimer = z.infer<typeof RestTimerSchema>

export const AppStateSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  onboardingDone: z.boolean(),
  settings: SettingsSchema,
  exercises: z.array(ExerciseSchema),
  sessionTypes: z.array(SessionTypeSchema),
  sessions: z.array(SessionSchema),
  activeSessionId: z.string().nullable(),
  restTimer: RestTimerSchema.nullable(),
})
export type AppState = z.infer<typeof AppStateSchema>

/* -------------------------------------------------------------------------- */
/* Helpers purs                                                                */
/* -------------------------------------------------------------------------- */

/** Clé de déduplication : lowercase, sans accents, espaces simplifiés. */
export function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
}

export function createId(): string {
  return crypto.randomUUID()
}

export function createDefaultSettings(): Settings {
  return {
    geminiApiKey: '',
    geminiModel: DEFAULT_GEMINI_MODEL,
    defaultRestSeconds: DEFAULT_REST_SECONDS,
    soundEnabled: true,
    vibrationEnabled: true,
    weightStep: DEFAULT_WEIGHT_STEP,
  }
}

export function createEmptyAppState(): AppState {
  return {
    schemaVersion: SCHEMA_VERSION,
    onboardingDone: false,
    settings: createDefaultSettings(),
    exercises: [],
    sessionTypes: [],
    sessions: [],
    activeSessionId: null,
    restTimer: null,
  }
}

export function createExercise(params: {
  name: string
  unit?: Unit
  defaultRestSeconds?: number
  id?: string
}): Exercise {
  return {
    id: params.id ?? createId(),
    name: params.name.trim(),
    normalizedName: normalizeName(params.name),
    unit: params.unit ?? 'kg',
    defaultRestSeconds: params.defaultRestSeconds ?? DEFAULT_REST_SECONDS,
  }
}

export interface Toast {
  id: string
  message: string
  kind: 'info' | 'success' | 'error'
}

export type LoadError = 'unknown_version' | 'invalid_data'
