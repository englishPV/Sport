export type SectionId = 'up' | 'legs'

export type ExerciseCategory = 'poly' | 'iso'

export type Unit = 'kg' | 'bodyweight'

export interface WorkoutSet {
  weight: number
  reps: number
  isWarmup?: boolean
  failure?: boolean
  /** Temps réel passé en exercice sur cette série (secondes) */
  workSeconds?: number
  /** Temps réel passé en repos juste avant cette série (secondes) */
  restBeforeSeconds?: number
  /** Cibles prévues au moment de la série */
  targetWeight?: number
  targetReps?: number
}

export interface ExerciseEntry {
  id: string
  /** Date ISO YYYY-MM-DD, ou null pour les anciennes lignes sans date */
  date: string | null
  sets: WorkoutSet[]
  /** Temps moyen de repos sur l'exercice (secondes) */
  restSeconds: number | null
  /** Temps cumulé passé en exercice sur cet exercice (secondes) */
  workSeconds?: number | null
  /** Durée totale de la séance à laquelle appartient cette entrée (secondes) */
  sessionDurationSeconds?: number | null
  note: string
  /** Si la ligne d'origine portait la mention (Objectif) */
  wasObjective?: boolean
  /** Ligne purement textuelle (ex: séance sautée / commentaire seul) */
  skipOnly?: boolean
}

export interface Exercise {
  id: string
  name: string
  normalizedName: string
  section: SectionId
  category: ExerciseCategory
  repRange: [number, number]
  weightStep: number
  unit: Unit
  defaultRestSeconds: number
  /** Inclus dans la séance active du jour */
  active: boolean
  /** Exercice mis entre parenthèses dans le bloc-notes */
  archived?: boolean
  /** Historique du plus récent (index 0) au plus ancien */
  entries: ExerciseEntry[]
}

export interface TargetSet {
  weight: number
  repsMin: number
  repsMax: number
  suggestedReps: number
  isWarmup?: boolean
}

export interface ExercisePlan {
  exerciseId: string
  sets: TargetSet[]
  restSeconds: number
  tip: string
}

export interface CoachSessionPlan {
  section: SectionId
  generatedAt: number
  source: 'ddp' | 'gemini'
  model: string | null
  /** Empreinte de l'historique de la section au moment où le plan a été généré */
  fingerprint?: string
  summaryLines: string[]
  exercises: Record<string, ExercisePlan>
}

export interface DraftSet {
  id: string
  weight: number
  reps: number
  targetWeight: number
  targetReps: number
  prevWeight: number | null
  prevReps: number | null
  isWarmup: boolean
  failure: boolean
  completedAt: number | null
  workSeconds: number | null
  restBeforeSeconds: number | null
  userEdited?: boolean
}

export interface DraftExerciseLog {
  exerciseId: string
  sets: DraftSet[]
  note: string
}

export interface ActiveDraft {
  section: SectionId
  date: string
  /** Début du chrono global de la séance */
  startedAt: number | null
  /** Début de la phase d'exercice en cours (pour mesurer le temps sous tension / exécution) */
  phaseStartedAt: number | null
  /** Début et fin du dernier repos avant la série en cours */
  pendingRestSeconds: number | null
  logs: Record<string, DraftExerciseLog>
}

export interface RestTimerState {
  startedAt: number
  durationSeconds: number
  exerciseName: string
  extraIncrementSeconds: number
}

export interface CompletedSessionExerciseLog {
  exerciseId: string
  exerciseName: string
  note: string
  totalWorkSeconds: number
  totalRestSeconds: number
  sets: WorkoutSet[]
}

export interface CompletedSessionRecord {
  id: string
  date: string
  section: SectionId
  startedAt: number
  endedAt: number
  /** Durée totale de la séance (secondes) */
  totalDurationSeconds: number
  /** Temps total passé sur les séries / en exercice (secondes) */
  totalWorkSeconds: number
  /** Temps total passé en repos entre les séries (secondes) */
  totalRestSeconds: number
  exercises: CompletedSessionExerciseLog[]
}

export type ExerciseTrendStatus =
  | 'progressing'
  | 'stable'
  | 'recalibration'
  | 'fatigue'

export interface AiExerciseStatInsight {
  exerciseId: string
  badge: string
  status: ExerciseTrendStatus
  summary: string
}

export interface AiStatsAnalysis {
  generatedAt: number
  fingerprint: string
  model: string
  headline: string
  bulletPoints: string[]
  exercises: Record<string, AiExerciseStatInsight>
}

export interface AppSettings {
  apiKey: string
  geminiModel: string
  theme: 'light' | 'dark'
  soundEnabled: boolean
  vibrationEnabled: boolean
  profileHeightCm: number
  profileWeightKg: number
}

export const SECTION_LABELS: Record<SectionId, { title: string; short: string }> = {
  up: { title: 'Haut du corps (Up)', short: 'Haut (Up)' },
  legs: { title: 'Jambes (Legs)', short: 'Jambes (Legs)' },
}

export function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function createId(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

export function formatIsoToFr(iso: string | null): string {
  if (!iso) return 'Ancienne séance'
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return iso
  return `${match[3]}/${match[2]}/${match[1]}`
}

export function formatIsoShort(iso: string | null): string {
  if (!iso) return 'Ancien'
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return iso
  return `${match[3]}/${match[2]}`
}

export function todayISODate(now: Date = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function formatNumberFr(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return String(Math.round(value * 100) / 100).replace('.', ',')
}

export function formatRestDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '—'
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  if (mins === 0) return `${secs}s`
  if (secs === 0) return `${mins}min`
  return `${mins}min${String(secs).padStart(2, '0')}`
}
