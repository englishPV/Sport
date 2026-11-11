import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { inferProfileFromPreamble, parseEntryLine, settleObjectives } from '../core/parser'
import {
  buildBackup,
  createMigratingStorage,
  migratePersistedState,
  parseBackup,
  SCHEMA_VERSION,
  STORAGE_KEY,
} from '../core/storage'
import {
  DEFAULT_NOTEPAD_PREAMBLE,
  DEFAULT_NOTEPAD_TEXT,
  EXAMPLE_API_KEY,
} from '../core/defaultNotepad'
import {
  buildDdpSessionPlan,
  computeExerciseDdpPlan,
  getLatestEntry,
  getRecommendedSection,
} from '../core/ddp'
import {
  DEFAULT_GEMINI_MODEL,
  STATS_REQUEST_TAG,
  analyzeStatsWithGemini,
  buildSectionPlanFingerprint,
  buildStatsFingerprint,
  coachRequestTag,
  configureGemini,
  generateGeminiSessionPlan,
  isGeminiPlanFresh,
  isSupportedGeminiModel,
  parseWorkoutTextWithGemini,
  resetGeminiClientState,
  sanitizeApiKey,
} from '../core/gemini'
import { GeminiError, cancelQueuedGeminiRequests } from '../core/geminiClient'
import { hasUnrecognizedWorkoutText, parseNotepad } from '../core/parser'
import { computeSetRestDuration, getOptimalExtraRestSeconds } from '../core/restScience'
import {
  createId,
  todayISODate,
  type ActiveDraft,
  type AiStatsAnalysis,
  type AppSettings,
  type CoachSessionPlan,
  type CompletedSessionExerciseLog,
  type CompletedSessionRecord,
  type DraftExerciseLog,
  type DraftSet,
  type Exercise,
  type RestTimerState,
  type SectionId,
  type WorkoutSet,
} from '../core/types'

export { STORAGE_KEY }

export type SessionPhase = 'idle' | 'working' | 'resting' | 'done'

export interface StepCursor {
  exerciseIdx: number
  setIdx: number
}

export interface UndoSnapshot {
  activeDraft: ActiveDraft
  sessionPhase: SessionPhase
  cursor: StepCursor
  restTimer: RestTimerState | null
}

let storeEpoch = 0
const inFlightCoachBySection: Partial<Record<SectionId, Promise<void>>> = {}

/**
 * Anti-spam quota : après un échec (429, surcharge, délai…), les déclencheurs
 * automatiques (clic Haut/Jambes, démarrage, retour des réglages…) ne repartent
 * pas immédiatement. Sans cela, chaque clic relançait jusqu'à 2 générations HIGH
 * (2 à 4 min chacune) qui échouaient en boucle sans rien afficher d'utile.
 * Le bouton « Réessayer » explicite passe en force et contourne le délai.
 */
const COACH_FAILURE_COOLDOWN_MS = 60_000
const STATS_FAILURE_COOLDOWN_MS = 60_000
const lastCoachFailureAt: Partial<Record<SectionId, number>> = {}
let lastStatsFailureAt = 0

function coachCooldownRemainingMs(section: SectionId): number {
  const at = lastCoachFailureAt[section]
  if (!at) return 0
  return Math.max(0, COACH_FAILURE_COOLDOWN_MS - (Date.now() - at))
}

function clearCoachFailure(section: SectionId): void {
  delete lastCoachFailureAt[section]
}

function clearAllAiFailures(): void {
  delete lastCoachFailureAt.up
  delete lastCoachFailureAt.legs
  lastStatsFailureAt = 0
}

function clearInFlightCoachTracking(): void {
  // Les plans encore en file portent sur des données dépassées : inutile de les envoyer.
  cancelQueuedGeminiRequests(coachRequestTag('up'))
  cancelQueuedGeminiRequests(coachRequestTag('legs'))
  cancelQueuedGeminiRequests(STATS_REQUEST_TAG)
  delete inFlightCoachBySection.up
  delete inFlightCoachBySection.legs
  // Données neuves (import, restauration, test…) : l'ancien échec ne bloque plus.
  clearAllAiFailures()
}

function hasSectionHistory(exercises: readonly Exercise[], section: SectionId): boolean {
  return exercises.some(
    (ex) =>
      ex.section === section &&
      ex.active &&
      ex.entries.some((entry) => !entry.skipOnly && entry.sets.length > 0),
  )
}

function cloneDraft(draft: ActiveDraft): ActiveDraft {
  const logsCopy: Record<string, DraftExerciseLog> = {}
  for (const [k, v] of Object.entries(draft.logs)) {
    logsCopy[k] = {
      exerciseId: v.exerciseId,
      note: v.note,
      sets: v.sets.map((s) => ({ ...s })),
    }
  }
  return {
    section: draft.section,
    date: draft.date,
    startedAt: draft.startedAt,
    phaseStartedAt: draft.phaseStartedAt,
    pendingRestSeconds: draft.pendingRestSeconds,
    logs: logsCopy,
  }
}

function triggerRestFinishedFeedback(settings: Pick<AppSettings, 'soundEnabled' | 'vibrationEnabled'>): void {
  try {
    if (settings.vibrationEnabled && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate([180, 80, 180])
    }
  } catch {
    // Vibration non supportée
  }

  try {
    if (
      (settings.soundEnabled || settings.vibrationEnabled) &&
      typeof Notification !== 'undefined' &&
      Notification.permission === 'granted'
    ) {
      new Notification('Repos terminé — Série suivante !', {
        body: 'Il est temps de reprendre ta série.',
        tag: 'sport-ddp-rest',
      })
    }
  } catch {
    // Notifications système non supportées
  }

  try {
    if (!settings.soundEnabled || typeof window === 'undefined') return
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const now = ctx.currentTime
    const notes = [587.33, 880]
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, now + idx * 0.16)
      gain.gain.setValueAtTime(0.001, now + idx * 0.16)
      gain.gain.exponentialRampToValueAtTime(0.15, now + idx * 0.16 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.16 + 0.15)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + idx * 0.16)
      osc.stop(now + idx * 0.16 + 0.16)
    })
    setTimeout(() => {
      void ctx.close().catch(() => {})
    }, 500)
  } catch {
    // Web Audio indisponible (jsdom / navigateur restreint)
  }
}

function pushSnapshot(stack: readonly UndoSnapshot[], snap: UndoSnapshot): UndoSnapshot[] {
  const next = [...stack, snap]
  return next.length > 30 ? next.slice(next.length - 30) : next
}

function findMatchingPrevSets(
  plannedTargets: readonly { isWarmup?: boolean }[],
  prevSets: readonly WorkoutSet[],
): Array<WorkoutSet | undefined> {
  if (prevSets.length === 0) return plannedTargets.map(() => undefined)
  const prevWarmups = prevSets.filter((s) => s.isWarmup)
  const prevWork = prevSets.filter((s) => !s.isWarmup)

  let warmIdx = 0
  let workIdx = 0
  return plannedTargets.map((t, rawIdx) => {
    if (t.isWarmup) {
      const m = prevWarmups[warmIdx]
      warmIdx += 1
      return m
    }
    const m = prevWork[workIdx] ?? prevSets[rawIdx]
    workIdx += 1
    return m
  })
}

function buildDraftLogsForSection(
  exercises: readonly Exercise[],
  section: SectionId,
  plan: CoachSessionPlan,
  existingLogs?: Record<string, DraftExerciseLog>,
): Record<string, DraftExerciseLog> {
  const logs: Record<string, DraftExerciseLog> = {}
  const activeExercises = exercises.filter((e) => e.section === section && e.active)

  for (const ex of activeExercises) {
    const existing = existingLogs?.[ex.id]
    const hasTouchedSets =
      existing?.sets.some((s) => s.completedAt !== null || s.userEdited) ?? false
    const exPlan = plan.exercises[ex.id]
    const plannedTargets = exPlan?.sets ?? []
    const prevEntry = getLatestEntry(ex)
    const matchedPrev = findMatchingPrevSets(plannedTargets, prevEntry?.sets ?? [])

    if (existing && hasTouchedSets) {
      const updatedSets: DraftSet[] = existing.sets.map((s, idx) => {
        if (s.completedAt !== null) return s
        const target = plannedTargets[idx]
        const prevSet = matchedPrev[idx]
        if (!target) return s
        if (s.userEdited) {
          return {
            ...s,
            targetWeight: target.weight,
            targetReps: target.suggestedReps,
            targetRepsMin: target.repsMin,
            prevWeight: prevSet ? prevSet.weight : s.prevWeight,
            prevReps: prevSet ? prevSet.reps : s.prevReps,
            isWarmup: Boolean(target.isWarmup),
          }
        }
        return {
          ...s,
          weight: target.weight,
          reps: target.suggestedReps,
          targetWeight: target.weight,
          targetReps: target.suggestedReps,
          targetRepsMin: target.repsMin,
          prevWeight: prevSet ? prevSet.weight : s.prevWeight,
          prevReps: prevSet ? prevSet.reps : s.prevReps,
          isWarmup: Boolean(target.isWarmup),
        }
      })
      logs[ex.id] = {
        exerciseId: ex.id,
        sets: updatedSets,
        note: existing.note,
      }
      continue
    }

    const sets: DraftSet[] = plannedTargets.map((target, idx) => {
      const prevSet = matchedPrev[idx]
      return {
        id: createId('set'),
        weight: target.weight,
        reps: target.suggestedReps,
        targetWeight: target.weight,
        targetReps: target.suggestedReps,
        targetRepsMin: target.repsMin,
        prevWeight: prevSet ? prevSet.weight : null,
        prevReps: prevSet ? prevSet.reps : null,
        isWarmup: Boolean(target.isWarmup),
        failure: false,
        completedAt: null,
        workSeconds: null,
        restBeforeSeconds: null,
      }
    })

    logs[ex.id] = {
      exerciseId: ex.id,
      sets:
        sets.length > 0
          ? sets
          : [0, 1, 2].map((idx) => {
              const prevSet = prevEntry?.sets[idx]
              const fallbackReps = ex.repRange[0]
              return {
                id: createId('set'),
                weight: 0,
                reps: fallbackReps,
                targetWeight: 0,
                targetReps: fallbackReps,
                targetRepsMin: fallbackReps,
                prevWeight: prevSet ? prevSet.weight : null,
                prevReps: prevSet ? prevSet.reps : null,
                isWarmup: false,
                failure: false,
                completedAt: null,
                workSeconds: null,
                restBeforeSeconds: null,
              }
            }),
      note: existing?.note ?? '',
    }
  }

  return logs
}

function findNextUncompletedCursor(
  activeExercises: readonly Exercise[],
  logs: Record<string, DraftExerciseLog>,
  fromExerciseIdx: number,
  fromSetIdx: number,
): StepCursor | null {
  for (let eIdx = fromExerciseIdx; eIdx < activeExercises.length; eIdx += 1) {
    const ex = activeExercises[eIdx]
    const sets = logs[ex.id]?.sets ?? []
    const startSet = eIdx === fromExerciseIdx ? fromSetIdx : 0
    for (let sIdx = startSet; sIdx < sets.length; sIdx += 1) {
      if (sets[sIdx].completedAt === null && !sets[sIdx].skipped) {
        return { exerciseIdx: eIdx, setIdx: sIdx }
      }
    }
  }

  for (let eIdx = 0; eIdx < fromExerciseIdx; eIdx += 1) {
    const ex = activeExercises[eIdx]
    const sets = logs[ex.id]?.sets ?? []
    for (let sIdx = 0; sIdx < sets.length; sIdx += 1) {
      if (sets[sIdx].completedAt === null && !sets[sIdx].skipped) {
        return { exerciseIdx: eIdx, setIdx: sIdx }
      }
    }
  }

  return null
}

function createInitialData() {
  const parsed = parseNotepad(DEFAULT_NOTEPAD_TEXT)
  const upPlan = buildDdpSessionPlan(parsed.exercises, 'up')
  const legsPlan = buildDdpSessionPlan(parsed.exercises, 'legs')
  const { recommended } = getRecommendedSection(parsed.exercises)
  const activePlan = recommended === 'legs' ? legsPlan : upPlan
  const date = todayISODate()

  const activeDraft: ActiveDraft = {
    section: recommended,
    date,
    startedAt: null,
    phaseStartedAt: null,
    pendingRestSeconds: null,
    logs: buildDraftLogsForSection(parsed.exercises, recommended, activePlan),
  }

  const settings: AppSettings = {
    apiKey: sanitizeApiKey(EXAMPLE_API_KEY),
    geminiModel: DEFAULT_GEMINI_MODEL,
    geminiModelChosen: false,
    geminiChannel: 'auto',
    geminiBaseUrl: '',
    theme: 'light',
    soundEnabled: false,
    vibrationEnabled: false,
    profileHeightCm: 0,
    profileWeightKg: 0,
  }

  return {
    preamble: parsed.preamble,
    exercises: parsed.exercises,
    completedSessions: [] as CompletedSessionRecord[],
    aiStats: null as AiStatsAnalysis | null,
    coachPlans: { up: upPlan, legs: legsPlan } as Record<SectionId, CoachSessionPlan>,
    activeDraft,
    sessionPhase: 'idle' as SessionPhase,
    cursor: { exerciseIdx: 0, setIdx: 0 } as StepCursor,
    restTimer: null as RestTimerState | null,
    undoStack: [] as UndoSnapshot[],
    settings,
  }
}

export interface SaveWorkoutSummary {
  savedExercises: number
  validatedSets: number
  totalVolumeKg: number
  totalDurationSeconds: number
  totalWorkSeconds: number
  totalRestSeconds: number
  nextRecommended: SectionId
  nextAlreadyGenerated: boolean
}

export interface SmartImportResult {
  usedAi: boolean
  exercisesCount: number
  entriesCount: number
}

export interface ImportNotepadOptions {
  preserveCustomPreamble?: boolean
}

export interface WorkoutStoreState {
  preamble: string
  exercises: Exercise[]
  completedSessions: CompletedSessionRecord[]
  aiStats: AiStatsAnalysis | null
  coachPlans: Record<SectionId, CoachSessionPlan>
  activeDraft: ActiveDraft
  sessionPhase: SessionPhase
  cursor: StepCursor
  restTimer: RestTimerState | null
  undoStack: UndoSnapshot[]
  settings: AppSettings
  aiLoading: boolean
  aiGeneratingSections: Record<SectionId, boolean>
  aiStatsLoading: boolean
  aiStatsError: string | null
  aiError: string | null
  lastToast: string | null
  setLastToast: (msg: string | null) => void

  selectSection: (section: SectionId) => void
  startWorkout: () => void
  exitWorkout: () => void
  validateCurrentSet: () => void
  onRestCountdownReachedZero: () => void
  skipRest: () => void
  undoLastAction: () => void
  jumpToExercise: (exerciseIdx: number) => void

  adjustWorkoutChrono: (deltaSeconds: number) => void
  setWorkoutChronoSeconds: (totalSeconds: number) => void

  updateDraftSet: (
    exerciseId: string,
    setId: string,
    patch: Partial<Pick<DraftSet, 'weight' | 'reps' | 'isWarmup' | 'failure' | 'note'>>,
  ) => void
  updateDraftNote: (exerciseId: string, note: string) => void
  addSetToExercise: (exerciseId: string) => void
  removeLastUncompletedSet: (exerciseId: string) => void
  skipRemainingSetsOfCurrentExercise: () => void
  switchDraftExerciseVariant: (exerciseId: string, variant: string) => void
  toggleExerciseActive: (exerciseId: string) => void
  exportBackupJson: (options?: { includeApiKey?: boolean }) => string
  restoreFromBackupJson: (jsonText: string) => void
  saveCompletedWorkout: () => SaveWorkoutSummary | null
  discardActiveWorkout: () => void
  getExercisesWithLiveProgress: () => Exercise[]

  askGeminiCoach: (
    section: SectionId,
    options?: { priority?: 'high' | 'normal'; force?: boolean },
  ) => Promise<void>
  ensureSessionPlansGenerated: (
    primarySection: SectionId,
    options?: { force?: boolean },
  ) => Promise<void>
  refreshAiStats: (force?: boolean) => Promise<void>
  deleteHistoryEntry: (exerciseId: string, entryId: string) => void
  updateHistoryEntry: (exerciseId: string, entryId: string, rawLineText: string) => boolean
  deleteCompletedSession: (sessionId: string) => void

  importNotepadSmart: (
    rawText: string,
    options?: ImportNotepadOptions,
  ) => Promise<SmartImportResult>
  resetToDefaultNotepad: () => void

  adjustRestTimer: (deltaSeconds: number) => void
  updateSettings: (patch: Partial<AppSettings>) => void
  clearApiKey: () => void

  /** Mode test : copie des vraies données, remise en place telle quelle à la sortie. */
  simulation: PersistedSlice | null
  startSimulation: () => void
  exitSimulation: () => void
  simulateNextStep: () => void
  simulateWholeSession: () => void
}

/** Ce qui est écrit dans le stockage du navigateur. */
export type PersistedSlice = Pick<
  WorkoutStoreState,
  | 'preamble'
  | 'exercises'
  | 'completedSessions'
  | 'aiStats'
  | 'coachPlans'
  | 'activeDraft'
  | 'sessionPhase'
  | 'cursor'
  | 'restTimer'
  | 'settings'
>

function pickPersisted(state: WorkoutStoreState): PersistedSlice {
  return {
    preamble: state.preamble,
    exercises: state.exercises,
    completedSessions: state.completedSessions,
    aiStats: state.aiStats,
    coachPlans: state.coachPlans,
    activeDraft: state.activeDraft,
    sessionPhase: state.sessionPhase,
    cursor: state.cursor,
    restTimer: state.restTimer,
    settings: state.settings,
  }
}

export const useWorkoutStore = create<WorkoutStoreState>()(
  persist(
    (set, get) => ({
      ...createInitialData(),
      aiLoading: false,
      aiGeneratingSections: { up: false, legs: false },
      aiStatsLoading: false,
      aiStatsError: null,
      aiError: null,
      lastToast: null,
      setLastToast: (msg) => set({ lastToast: msg }),
      simulation: null,

      selectSection: (section) => {
        const state = get()
        if (state.activeDraft.section !== section) {
          // Un plan IA périmé (historique modifié) repart de la DDP : la séance reste alignée
          // sur les dernières séries, sans attendre la nouvelle réponse de Gemini.
          const plan = isGeminiPlanFresh(state.coachPlans[section], state.exercises, section, state.preamble)
            ? state.coachPlans[section]
            : buildDdpSessionPlan(state.exercises, section)
          set({
            aiError: null,
            sessionPhase: 'idle',
            cursor: { exerciseIdx: 0, setIdx: 0 },
            restTimer: null,
            undoStack: [],
            activeDraft: {
              section,
              date: todayISODate(),
              startedAt: null,
              phaseStartedAt: null,
              pendingRestSeconds: null,
              logs: buildDraftLogsForSection(state.exercises, section, plan),
            },
          })
        } else if (state.aiError) {
          set({ aiError: null })
        }

        // Quand on appuie sur Jambes (ou Haut) :
        // 1. Génère cette séance si elle n'a pas déjà été générée dans le passé
        // 2. Pré-génère la prochaine séance opposée (ex: Up quand on presse Jambes) en tâche de fond !
        void get().ensureSessionPlansGenerated(section)
      },

      startWorkout: () => {
        const state = get()
        const section = state.activeDraft.section
        const activeExercises = state.exercises.filter(
          (e) => e.section === section && e.active,
        )
        const next = findNextUncompletedCursor(
          activeExercises,
          state.activeDraft.logs,
          0,
          0,
        )
        const now = Date.now()

        set({
          sessionPhase: next ? 'working' : 'done',
          cursor: next ?? { exerciseIdx: 0, setIdx: 0 },
          activeDraft: {
            ...state.activeDraft,
            date: todayISODate(),
            startedAt: state.activeDraft.startedAt ?? now,
            phaseStartedAt: state.activeDraft.phaseStartedAt ?? now,
          },
        })

        void get().ensureSessionPlansGenerated(section)
      },

      exitWorkout: () => {
        set({ sessionPhase: 'idle' })
      },

      validateCurrentSet: () => {
        const state = get()
        const section = state.activeDraft.section
        const activeExercises = state.exercises.filter(
          (e) => e.section === section && e.active,
        )
        const currentEx = activeExercises[state.cursor.exerciseIdx]
        if (!currentEx) return

        const log = state.activeDraft.logs[currentEx.id]
        const currentSet = log?.sets[state.cursor.setIdx]
        if (!log || !currentSet) return

        const snapshot: UndoSnapshot = {
          activeDraft: cloneDraft(state.activeDraft),
          sessionPhase: state.sessionPhase,
          cursor: { ...state.cursor },
          restTimer: state.restTimer ? { ...state.restTimer } : null,
        }

        const now = Date.now()
        const workSeconds = state.activeDraft.phaseStartedAt
          ? Math.max(1, Math.round((now - state.activeDraft.phaseStartedAt) / 1000))
          : 0
        const restBeforeSeconds = state.activeDraft.pendingRestSeconds ?? 0

        const updatedSets = log.sets.map((s, idx) =>
          idx === state.cursor.setIdx
            ? {
                ...s,
                completedAt: now,
                workSeconds,
                restBeforeSeconds,
              }
            : s,
        )
        const updatedLogs: Record<string, DraftExerciseLog> = {
          ...state.activeDraft.logs,
          [currentEx.id]: { ...log, sets: updatedSets },
        }

        const nextCursor = findNextUncompletedCursor(
          activeExercises,
          updatedLogs,
          state.cursor.exerciseIdx,
          state.cursor.setIdx + 1,
        )

        if (!nextCursor) {
          set({
            undoStack: pushSnapshot(state.undoStack, snapshot),
            activeDraft: {
              ...state.activeDraft,
              phaseStartedAt: null,
              pendingRestSeconds: null,
              logs: updatedLogs,
            },
            sessionPhase: 'done',
            restTimer: null,
          })
          return
        }

        const baseRest =
          state.coachPlans[section]?.exercises[currentEx.id]?.restSeconds ??
          currentEx.defaultRestSeconds ??
          120

        const durationSeconds = computeSetRestDuration({
          baseRestSeconds: baseRest,
          category: currentEx.category,
          isWarmup: currentSet.isWarmup,
          failure: currentSet.failure,
        })

        const extraIncrementSeconds = getOptimalExtraRestSeconds({
          category: currentEx.category,
          isWarmup: currentSet.isWarmup,
          failure: currentSet.failure,
        })

        set({
          undoStack: pushSnapshot(state.undoStack, snapshot),
          activeDraft: {
            ...state.activeDraft,
            phaseStartedAt: null,
            pendingRestSeconds: null,
            logs: updatedLogs,
          },
          cursor: nextCursor,
          sessionPhase: 'resting',
          restTimer: {
            startedAt: now,
            durationSeconds,
            exerciseName: currentEx.name,
            extraIncrementSeconds,
          },
        })
      },

      onRestCountdownReachedZero: () => {
        const state = get()
        if (state.sessionPhase !== 'resting') return
        const now = Date.now()
        const waitedRest = state.restTimer
          ? Math.max(0, Math.round((now - state.restTimer.startedAt) / 1000))
          : 0

        if (!state.simulation) {
          triggerRestFinishedFeedback(state.settings)
        }

        set({
          sessionPhase: 'working',
          restTimer: null,
          activeDraft: {
            ...state.activeDraft,
            phaseStartedAt: now,
            pendingRestSeconds: waitedRest,
          },
        })
      },

      skipRest: () => {
        const state = get()
        const snapshot: UndoSnapshot = {
          activeDraft: cloneDraft(state.activeDraft),
          sessionPhase: state.sessionPhase,
          cursor: { ...state.cursor },
          restTimer: state.restTimer ? { ...state.restTimer } : null,
        }
        const now = Date.now()
        const waitedRest = state.restTimer
          ? Math.max(0, Math.round((now - state.restTimer.startedAt) / 1000))
          : 0

        set({
          undoStack: pushSnapshot(state.undoStack, snapshot),
          sessionPhase: 'working',
          restTimer: null,
          activeDraft: {
            ...state.activeDraft,
            phaseStartedAt: now,
            pendingRestSeconds: waitedRest,
          },
        })
      },

      undoLastAction: () => {
        const state = get()
        if (state.undoStack.length === 0) {
          set({ sessionPhase: 'idle' })
          return
        }
        const prev = state.undoStack[state.undoStack.length - 1]
        set({
          activeDraft: prev.activeDraft,
          sessionPhase: prev.sessionPhase,
          cursor: prev.cursor,
          restTimer: prev.restTimer,
          undoStack: state.undoStack.slice(0, -1),
        })
      },

      jumpToExercise: (exerciseIdx) => {
        const state = get()
        const activeExercises = state.exercises.filter(
          (e) => e.section === state.activeDraft.section && e.active,
        )
        const ex = activeExercises[exerciseIdx]
        if (!ex) return
        const snapshot: UndoSnapshot = {
          activeDraft: cloneDraft(state.activeDraft),
          sessionPhase: state.sessionPhase,
          cursor: { ...state.cursor },
          restTimer: state.restTimer ? { ...state.restTimer } : null,
        }
        const sets = state.activeDraft.logs[ex.id]?.sets ?? []
        const firstUncompleted = sets.findIndex((s) => s.completedAt === null && !s.skipped)
        const now = Date.now()
        set({
          undoStack: pushSnapshot(state.undoStack, snapshot),
          sessionPhase: 'working',
          restTimer: null,
          activeDraft: {
            ...state.activeDraft,
            phaseStartedAt: state.activeDraft.phaseStartedAt ?? now,
          },
          cursor: {
            exerciseIdx,
            setIdx: firstUncompleted >= 0 ? firstUncompleted : 0,
          },
        })
      },

      adjustWorkoutChrono: (deltaSeconds) => {
        set((state) => {
          const now = Date.now()
          const currentStart = state.activeDraft.startedAt ?? now
          const nextStart = Math.min(now, currentStart - deltaSeconds * 1000)
          return {
            activeDraft: {
              ...state.activeDraft,
              startedAt: nextStart,
            },
          }
        })
      },

      setWorkoutChronoSeconds: (totalSeconds) => {
        set((state) => ({
          activeDraft: {
            ...state.activeDraft,
            startedAt: Date.now() - Math.max(0, totalSeconds) * 1000,
          },
        }))
      },

      updateDraftSet: (exerciseId, setId, patch) => {
        set((state) => {
          const log = state.activeDraft.logs[exerciseId]
          if (!log) return state
          const touchedValue =
            patch.weight !== undefined || patch.reps !== undefined
          const updatedSets = log.sets.map((s) =>
            s.id === setId
              ? {
                  ...s,
                  ...patch,
                  ...(touchedValue ? { userEdited: true } : {}),
                  weight: patch.weight !== undefined ? Math.max(0, patch.weight) : s.weight,
                  reps: patch.reps !== undefined ? Math.max(0, patch.reps) : s.reps,
                }
              : s,
          )
          return {
            activeDraft: {
              ...state.activeDraft,
              logs: {
                ...state.activeDraft.logs,
                [exerciseId]: { ...log, sets: updatedSets },
              },
            },
          }
        })
      },

      updateDraftNote: (exerciseId, note) => {
        set((state) => {
          const log = state.activeDraft.logs[exerciseId]
          if (!log) return state
          return {
            activeDraft: {
              ...state.activeDraft,
              logs: {
                ...state.activeDraft.logs,
                [exerciseId]: { ...log, note },
              },
            },
          }
        })
      },

      addSetToExercise: (exerciseId) => {
        set((state) => {
          const log = state.activeDraft.logs[exerciseId]
          if (!log) return state
          const snapshot: UndoSnapshot = {
            activeDraft: cloneDraft(state.activeDraft),
            sessionPhase: state.sessionPhase,
            cursor: { ...state.cursor },
            restTimer: state.restTimer ? { ...state.restTimer } : null,
          }
          const last = log.sets[log.sets.length - 1]
          const newSet: DraftSet = {
            id: createId('set'),
            weight: last ? last.weight : 0,
            reps: last ? last.reps : 10,
            targetWeight: last ? last.targetWeight : 0,
            targetReps: last ? last.targetReps : 10,
            targetRepsMin: last?.targetRepsMin ?? last?.targetReps ?? 8,
            prevWeight: null,
            prevReps: null,
            isWarmup: false,
            failure: false,
            completedAt: null,
            workSeconds: null,
            restBeforeSeconds: null,
          }
          const updatedLogs = {
            ...state.activeDraft.logs,
            [exerciseId]: { ...log, sets: [...log.sets, newSet] },
          }
          const activeExercises = state.exercises.filter(
            (e) => e.section === state.activeDraft.section && e.active,
          )
          const exIdx = activeExercises.findIndex((e) => e.id === exerciseId)
          const resumeDone = state.sessionPhase === 'done' && exIdx >= 0
          return {
            undoStack: pushSnapshot(state.undoStack, snapshot),
            ...(resumeDone
              ? {
                  sessionPhase: 'working' as SessionPhase,
                  cursor: { exerciseIdx: exIdx, setIdx: log.sets.length },
                }
              : {}),
            activeDraft: {
              ...state.activeDraft,
              ...(resumeDone ? { phaseStartedAt: Date.now() } : {}),
              logs: updatedLogs,
            },
          }
        })
      },

      removeLastUncompletedSet: (exerciseId) => {
        set((state) => {
          const log = state.activeDraft.logs[exerciseId]
          if (!log || log.sets.length <= 1) return state
          let removeIdx = -1
          for (let i = log.sets.length - 1; i >= 0; i -= 1) {
            if (log.sets[i].completedAt === null) {
              removeIdx = i
              break
            }
          }
          if (removeIdx < 0) return state
          const snapshot: UndoSnapshot = {
            activeDraft: cloneDraft(state.activeDraft),
            sessionPhase: state.sessionPhase,
            cursor: { ...state.cursor },
            restTimer: state.restTimer ? { ...state.restTimer } : null,
          }
          const nextSets = log.sets.filter((_, idx) => idx !== removeIdx)
          const updatedLogs = {
            ...state.activeDraft.logs,
            [exerciseId]: { ...log, sets: nextSets },
          }
          const activeExercises = state.exercises.filter(
            (e) => e.section === state.activeDraft.section && e.active,
          )
          const exIdx = activeExercises.findIndex((e) => e.id === exerciseId)
          let nextCursor: StepCursor | null = state.cursor
          let nextPhase = state.sessionPhase
          if (exIdx === state.cursor.exerciseIdx && state.cursor.setIdx >= nextSets.length) {
            nextCursor = findNextUncompletedCursor(activeExercises, updatedLogs, exIdx, 0)
            if (!nextCursor && state.sessionPhase !== 'idle') {
              nextPhase = 'done'
            }
          }
          return {
            undoStack: pushSnapshot(state.undoStack, snapshot),
            sessionPhase: nextPhase,
            cursor: nextCursor ?? { exerciseIdx: 0, setIdx: 0 },
            activeDraft: {
              ...state.activeDraft,
              logs: updatedLogs,
            },
          }
        })
      },

      skipRemainingSetsOfCurrentExercise: () => {
        const state = get()
        const section = state.activeDraft.section
        const activeExercises = state.exercises.filter((e) => e.section === section && e.active)
        const currentEx = activeExercises[state.cursor.exerciseIdx]
        if (!currentEx) return
        const log = state.activeDraft.logs[currentEx.id]
        if (!log) return

        const snapshot: UndoSnapshot = {
          activeDraft: cloneDraft(state.activeDraft),
          sessionPhase: state.sessionPhase,
          cursor: { ...state.cursor },
          restTimer: state.restTimer ? { ...state.restTimer } : null,
        }

        const updatedSets = log.sets.map((s) =>
          s.completedAt === null ? { ...s, skipped: true } : s,
        )
        const updatedLogs: Record<string, DraftExerciseLog> = {
          ...state.activeDraft.logs,
          [currentEx.id]: { ...log, sets: updatedSets },
        }

        const nextCursor = findNextUncompletedCursor(
          activeExercises,
          updatedLogs,
          state.cursor.exerciseIdx + 1,
          0,
        )
        const now = Date.now()
        set({
          undoStack: pushSnapshot(state.undoStack, snapshot),
          sessionPhase: nextCursor ? 'working' : 'done',
          cursor: nextCursor ?? { exerciseIdx: 0, setIdx: 0 },
          restTimer: null,
          activeDraft: {
            ...state.activeDraft,
            phaseStartedAt: nextCursor ? now : null,
            logs: updatedLogs,
          },
        })
      },

      switchDraftExerciseVariant: (exerciseId, variant) => {
        const state = get()
        const ex = state.exercises.find((e) => e.id === exerciseId)
        const log = state.activeDraft.logs[exerciseId]
        if (!ex || !log) return

        const variantPlan = computeExerciseDdpPlan(ex, variant)
        const prevEntry = getLatestEntry(ex, todayISODate(), variant)
        const matchedPrevSets = findMatchingPrevSets(variantPlan.sets, prevEntry?.sets ?? [])

        const completedSets = log.sets.filter((s) => s.completedAt !== null)
        const newPlannedSets: DraftSet[] = variantPlan.sets
          .slice(completedSets.length)
          .map((t, offsetIdx) => {
            const idx = completedSets.length + offsetIdx
            const prevSet = matchedPrevSets[idx]
            return {
              id: log.sets[idx]?.id ?? createId('set'),
              weight: t.weight,
              reps: t.suggestedReps,
              targetWeight: t.weight,
              targetReps: t.suggestedReps,
              targetRepsMin: t.repsMin,
              prevWeight: prevSet ? prevSet.weight : null,
              prevReps: prevSet ? prevSet.reps : null,
              isWarmup: Boolean(t.isWarmup),
              failure: false,
              completedAt: null,
              workSeconds: null,
              restBeforeSeconds: null,
            }
          })

        const nextSets =
          completedSets.length + newPlannedSets.length > 0
            ? [...completedSets, ...newPlannedSets]
            : log.sets

        const activeExercises = state.exercises.filter(
          (e) => e.section === state.activeDraft.section && e.active,
        )
        const exIdx = activeExercises.findIndex((e) => e.id === exerciseId)
        const nextSetIdx =
          exIdx === state.cursor.exerciseIdx
            ? Math.min(state.cursor.setIdx, Math.max(0, nextSets.length - 1))
            : state.cursor.setIdx

        set({
          cursor: { ...state.cursor, setIdx: nextSetIdx },
          activeDraft: {
            ...state.activeDraft,
            logs: {
              ...state.activeDraft.logs,
              [exerciseId]: {
                ...log,
                sets: nextSets,
                note: variant === 'Standard' ? '' : variant,
              },
            },
          },
        })
      },

      toggleExerciseActive: (exerciseId) => {
        const state = get()
        const target = state.exercises.find((e) => e.id === exerciseId)
        if (!target) return
        const nextActive = !target.active
        const nextExercises = state.exercises.map((ex) =>
          ex.id === exerciseId
            ? { ...ex, active: nextActive, ...(nextActive ? { archived: false } : {}) }
            : ex,
        )
        const upPlan = buildDdpSessionPlan(nextExercises, 'up')
        const legsPlan = buildDdpSessionPlan(nextExercises, 'legs')
        const section = state.activeDraft.section
        const activePlan = section === 'legs' ? legsPlan : upPlan
        clearInFlightCoachTracking()
        set({
          exercises: nextExercises,
          coachPlans: { up: upPlan, legs: legsPlan },
          activeDraft: {
            ...state.activeDraft,
            logs: buildDraftLogsForSection(
              nextExercises,
              section,
              activePlan,
              state.activeDraft.logs,
            ),
          },
        })
        if (sanitizeApiKey(state.settings.apiKey)) {
          void get().ensureSessionPlansGenerated(section)
        }
      },

      exportBackupJson: (options = {}) => {
        const state = get()
        const slice = state.simulation
          ? { ...state.simulation, settings: state.settings }
          : pickPersisted(state)
        return buildBackup(slice as unknown as Record<string, unknown>, options)
      },

      restoreFromBackupJson: (jsonText) => {
        const today = todayISODate()
        const restored = parseBackup(jsonText, today)
        storeEpoch += 1
        clearInFlightCoachTracking()
        const current = get()
        const restoredExercises = (restored.exercises as Exercise[]) ?? current.exercises
        const restoredPreamble =
          typeof restored.preamble === 'string' ? restored.preamble : current.preamble
        const upPlan = buildDdpSessionPlan(restoredExercises, 'up')
        const legsPlan = buildDdpSessionPlan(restoredExercises, 'legs')
        const { recommended } = getRecommendedSection(restoredExercises)
        const restoredSettings = (restored.settings ?? {}) as Partial<AppSettings>
        const nextApiKey = sanitizeApiKey(restoredSettings.apiKey || current.settings.apiKey)
        set({
          preamble: restoredPreamble,
          exercises: restoredExercises,
          completedSessions: Array.isArray(restored.completedSessions)
            ? (restored.completedSessions as CompletedSessionRecord[])
            : [],
          aiStats: null,
          coachPlans: { up: upPlan, legs: legsPlan },
          sessionPhase: 'idle',
          cursor: { exerciseIdx: 0, setIdx: 0 },
          restTimer: null,
          undoStack: [],
          simulation: null,
          aiError: null,
          aiStatsError: null,
          settings: {
            ...current.settings,
            ...restoredSettings,
            apiKey: nextApiKey,
            geminiModel: DEFAULT_GEMINI_MODEL,
          },
          activeDraft: {
            section: recommended,
            date: today,
            startedAt: null,
            phaseStartedAt: null,
            pendingRestSeconds: null,
            logs: buildDraftLogsForSection(
              restoredExercises,
              recommended,
              recommended === 'legs' ? legsPlan : upPlan,
            ),
          },
        })
        if (nextApiKey) {
          void get().ensureSessionPlansGenerated(recommended)
        }
      },

      getExercisesWithLiveProgress: () => {
        const state = get()
        const { section, date, startedAt, logs } = state.activeDraft
        const sessionDurationSeconds = startedAt
          ? Math.max(1, Math.round((Date.now() - startedAt) / 1000))
          : null

        return state.exercises.map((ex) => {
          if (ex.section !== section || !ex.active) return ex
          const log = logs[ex.id]
          if (!log) return ex
          const doneSets = log.sets.filter((s) => s.completedAt !== null && s.reps > 0)
          const trimmedNote = log.note.trim()
          if (doneSets.length === 0 && !trimmedNote) return ex

          const workoutSets: WorkoutSet[] = doneSets.map((s) => ({
            weight: s.weight,
            reps: s.reps,
            targetWeight: s.targetWeight,
            targetReps: s.targetReps,
            ...(s.note?.trim() ? { note: s.note.trim() } : {}),
            ...(s.isWarmup ? { isWarmup: true } : {}),
            ...(s.failure ? { failure: true } : {}),
            ...(typeof s.workSeconds === 'number' ? { workSeconds: s.workSeconds } : {}),
            ...(typeof s.restBeforeSeconds === 'number' && s.restBeforeSeconds > 0
              ? { restBeforeSeconds: s.restBeforeSeconds }
              : {}),
          }))

          // Seuls les repos entre séries de travail d'un même exercice entrent dans `(repos : …)` :
          // exclut la transition depuis l'exercice précédent (idx === 0) et le repos post-échauffement.
          const intraWorkRests = doneSets
            .filter((s, idx) => idx > 0 && !s.isWarmup && !doneSets[idx - 1].isWarmup)
            .map((s) => s.restBeforeSeconds)
            .filter((v): v is number => typeof v === 'number' && v > 0)
          const avgRest =
            intraWorkRests.length > 0
              ? Math.round(intraWorkRests.reduce((a, b) => a + b, 0) / intraWorkRests.length)
              : (state.coachPlans[section]?.exercises[ex.id]?.restSeconds ??
                ex.defaultRestSeconds)

          const totalExWorkSeconds = doneSets.reduce(
            (sum, s) => sum + (s.workSeconds ?? 0),
            0,
          )

          const liveEntry = {
            id: `live-${ex.id}-${date}`,
            date,
            sets: workoutSets,
            restSeconds: avgRest,
            workSeconds: totalExWorkSeconds > 0 ? totalExWorkSeconds : null,
            sessionDurationSeconds,
            note: trimmedNote,
            ...(workoutSets.length === 0 ? { skipOnly: true } : {}),
          }

          const entries = ex.entries[0]?.id.startsWith('live-')
            ? [liveEntry, ...ex.entries.slice(1)]
            : [liveEntry, ...ex.entries]

          return { ...ex, entries }
        })
      },

      discardActiveWorkout: () => {
        const state = get()
        const section = state.activeDraft.section
        const plan = isGeminiPlanFresh(state.coachPlans[section], state.exercises, section, state.preamble)
          ? state.coachPlans[section]
          : buildDdpSessionPlan(state.exercises, section)
        set({
          sessionPhase: 'idle',
          cursor: { exerciseIdx: 0, setIdx: 0 },
          restTimer: null,
          undoStack: [],
          activeDraft: {
            section,
            date: todayISODate(),
            startedAt: null,
            phaseStartedAt: null,
            pendingRestSeconds: null,
            logs: buildDraftLogsForSection(state.exercises, section, plan),
          },
        })
      },

      saveCompletedWorkout: () => {
        const state = get()
        const { section, date, startedAt, logs } = state.activeDraft
        const endedAt = Date.now()
        let savedExercises = 0
        let validatedSetsCount = 0
        let totalVolumeKg = 0
        let totalWorkSeconds = 0
        let totalRestSeconds = 0
        const sessionExercises: CompletedSessionExerciseLog[] = []

        for (const ex of state.exercises) {
          if (ex.section !== section || !ex.active) continue
          const log = logs[ex.id]
          if (!log) continue
          const doneSets = log.sets.filter((s) => s.completedAt !== null && s.reps > 0)
          const trimmedNote = log.note.trim()
          if (doneSets.length === 0 && !trimmedNote) continue

          savedExercises += 1
          validatedSetsCount += doneSets.length

          let exWork = 0
          let exRest = 0
          const recordedSets: WorkoutSet[] = doneSets.map((s) => {
            if (!s.isWarmup) totalVolumeKg += s.weight * s.reps
            exWork += s.workSeconds ?? 0
            exRest += s.restBeforeSeconds ?? 0
            return {
              weight: s.weight,
              reps: s.reps,
              targetWeight: s.targetWeight,
              targetReps: s.targetReps,
              ...(s.note?.trim() ? { note: s.note.trim() } : {}),
              ...(s.isWarmup ? { isWarmup: true } : {}),
              ...(s.failure ? { failure: true } : {}),
              ...(typeof s.workSeconds === 'number' ? { workSeconds: s.workSeconds } : {}),
              ...(typeof s.restBeforeSeconds === 'number'
                ? { restBeforeSeconds: s.restBeforeSeconds }
                : {}),
            }
          })

          totalWorkSeconds += exWork
          totalRestSeconds += exRest
          sessionExercises.push({
            exerciseId: ex.id,
            exerciseName: ex.name,
            note: trimmedNote,
            totalWorkSeconds: exWork,
            totalRestSeconds: exRest,
            sets: recordedSets,
          })
        }

        if (savedExercises === 0) return null

        const minChrono = Math.max(1, totalWorkSeconds + totalRestSeconds)
        const totalDurationSeconds = startedAt
          ? Math.max(minChrono, Math.round((endedAt - startedAt) / 1000))
          : minChrono

        const sessionRecord: CompletedSessionRecord = {
          id: createId('session'),
          date,
          section,
          startedAt: startedAt ?? endedAt - totalDurationSeconds * 1000,
          endedAt,
          totalDurationSeconds,
          totalWorkSeconds,
          totalRestSeconds,
          exercises: sessionExercises,
        }

        // Convertit les entrées live-* en entrées définitives avec sessionDurationSeconds exact
        const nextExercises = get()
          .getExercisesWithLiveProgress()
          .map((ex) => ({
            ...ex,
            entries: ex.entries.map((entry) =>
              entry.id.startsWith('live-')
                ? {
                    ...entry,
                    id: createId('entry'),
                    sessionDurationSeconds: totalDurationSeconds,
                  }
                : entry,
            ),
          }))

        // Préserve le plan Gemini déjà pré-généré pour la séance opposée (ex: Up pré-généré pendant Jambes) !
        const otherSection: SectionId = section === 'legs' ? 'up' : 'legs'
        const updatedCompletedSectionPlan = buildDdpSessionPlan(nextExercises, section)
        const existingOtherPlan = state.coachPlans[otherSection]
        const preservedOtherPlan = isGeminiPlanFresh(
          existingOtherPlan,
          nextExercises,
          otherSection,
          state.preamble,
        )
          ? existingOtherPlan
          : buildDdpSessionPlan(nextExercises, otherSection)

        const nextCoachPlans: Record<SectionId, CoachSessionPlan> =
          section === 'legs'
            ? { legs: updatedCompletedSectionPlan, up: preservedOtherPlan }
            : { up: updatedCompletedSectionPlan, legs: preservedOtherPlan }

        const { recommended } = getRecommendedSection(nextExercises)
        const nextPlan = nextCoachPlans[recommended]
        const nextAlreadyGenerated = isGeminiPlanFresh(
          nextPlan,
          nextExercises,
          recommended,
          state.preamble,
        )

        set({
          exercises: nextExercises,
          completedSessions: [sessionRecord, ...state.completedSessions],
          coachPlans: nextCoachPlans,
          sessionPhase: 'idle',
          cursor: { exerciseIdx: 0, setIdx: 0 },
          restTimer: null,
          undoStack: [],
          activeDraft: {
            section: recommended,
            date: todayISODate(),
            startedAt: null,
            phaseStartedAt: null,
            pendingRestSeconds: null,
            logs: buildDraftLogsForSection(nextExercises, recommended, nextPlan),
          },
        })

        // La séance suivante est déjà prête ; celle qui vient d'être faite se recalcule en arrière-plan.
        void get().ensureSessionPlansGenerated(recommended)

        return {
          savedExercises,
          validatedSets: validatedSetsCount,
          totalVolumeKg: Math.round(totalVolumeKg),
          totalDurationSeconds,
          totalWorkSeconds,
          totalRestSeconds,
          nextRecommended: recommended,
          nextAlreadyGenerated,
        }
      },

      askGeminiCoach: async (section, options = {}) => {
        const state = get()
        if (!sanitizeApiKey(state.settings.apiKey)) return

        const existingPromise = inFlightCoachBySection[section]
        if (existingPromise) {
          return existingPromise
        }

        // Délai anti-spam après échec : les déclencheurs automatiques attendent,
        // seul un « Réessayer » explicite (force) repart tout de suite.
        if (!options.force && coachCooldownRemainingMs(section) > 0) return

        const myEpoch = storeEpoch
        const requestFingerprint = buildSectionPlanFingerprint(
          state.exercises,
          section,
          state.preamble,
        )

        const nextGenState = {
          ...state.aiGeneratingSections,
          [section]: true,
        }
        set({
          aiGeneratingSections: nextGenState,
          aiLoading: true,
          aiError: null,
        })

        const tracked: { promise?: Promise<void> } = {}
        const taskPromise = (async () => {
          try {
            const plan = await generateGeminiSessionPlan({
              section,
              exercises: state.exercises,
              preamble: state.preamble,
              settings: state.settings,
              priority: options.priority ?? 'normal',
              // En file derrière une autre génération : si l'historique a changé
              // d'ici là, la requête ne part pas du tout (zéro quota consommé).
              isStale: () =>
                buildSectionPlanFingerprint(get().exercises, section, get().preamble) !==
                requestFingerprint,
            })

            if (storeEpoch !== myEpoch) return

            const latestState = get()
            const currentFp = buildSectionPlanFingerprint(
              latestState.exercises,
              section,
              latestState.preamble,
            )
            // N'écrase pas si l'historique de cette section a changé entre-temps
            if (currentFp !== requestFingerprint) {
              return
            }

            clearCoachFailure(section)
            const updatedPlans = { ...latestState.coachPlans, [section]: plan }
            const nextDraft =
              latestState.activeDraft.section === section
                ? {
                    ...latestState.activeDraft,
                    logs: buildDraftLogsForSection(
                      latestState.exercises,
                      section,
                      plan,
                      latestState.activeDraft.logs,
                    ),
                  }
                : latestState.activeDraft

            set({
              coachPlans: updatedPlans,
              activeDraft: nextDraft,
              aiError: null,
            })
          } catch (err) {
            if (storeEpoch !== myEpoch) return
            // Annulée car remplacée par des données plus récentes : pas un échec,
            // pas de délai, pas de message d'erreur.
            if (err instanceof GeminiError && err.kind === 'cancelled') return
            lastCoachFailureAt[section] = Date.now()
            set({
              aiError: err instanceof Error ? err.message : 'Erreur Gemini.',
            })
          } finally {
            // Une requête d'avant une remise à zéro ne doit pas effacer le suivi de la suivante.
            if (inFlightCoachBySection[section] === tracked.promise) delete inFlightCoachBySection[section]
            // Une génération plus récente de la même section garde son indicateur.
            if (storeEpoch === myEpoch && !inFlightCoachBySection[section]) {
              const current = get()
              const updatedGenerating = {
                ...current.aiGeneratingSections,
                [section]: false,
              }
              set({
                aiGeneratingSections: updatedGenerating,
                aiLoading: updatedGenerating.up || updatedGenerating.legs,
              })
            }
          }
        })()

        tracked.promise = taskPromise
        inFlightCoachBySection[section] = taskPromise
        return taskPromise
      },

      ensureSessionPlansGenerated: async (primarySection, options = {}) => {
        const state = get()
        if (!sanitizeApiKey(state.settings.apiKey)) return

        const force = options.force === true
        const nextSection: SectionId = primarySection === 'legs' ? 'up' : 'legs'
        const tasks: Promise<void>[] = []

        // Si la séance demandée (ex: Jambes) n'était pas déjà générée dans le passé, on la génère d'abord
        if (
          hasSectionHistory(state.exercises, primarySection) &&
          !isGeminiPlanFresh(
            state.coachPlans[primarySection],
            state.exercises,
            primarySection,
            state.preamble,
          )
        ) {
          tasks.push(get().askGeminiCoach(primarySection, { priority: 'high', force }))
        }

        // Et on pré-génère automatiquement la prochaine séance opposée (ex: Up quand on presse Jambes)
        // pour qu'elle s'ouvre instantanément et soit déjà prête en fin de séance !
        if (
          hasSectionHistory(state.exercises, nextSection) &&
          !isGeminiPlanFresh(
            state.coachPlans[nextSection],
            state.exercises,
            nextSection,
            state.preamble,
          )
        ) {
          tasks.push(get().askGeminiCoach(nextSection, { priority: 'normal', force }))
        }

        await Promise.all(tasks)
      },

      refreshAiStats: async (force = false) => {
        const state = get()
        const apiKey = sanitizeApiKey(state.settings.apiKey)
        if (!apiKey || state.aiStatsLoading) return

        const liveExercises = get().getExercisesWithLiveProgress()
        const fp = buildStatsFingerprint(liveExercises, state.completedSessions)
        if (!force && state.aiStats && state.aiStats.fingerprint === fp) {
          return
        }
        // Délai anti-spam après échec (429, délai dépassé…) : même garde que côté coach,
        // sinon chaque visite de l'onglet relançait une analyse HIGH de plusieurs minutes.
        if (!force && lastStatsFailureAt > 0 && Date.now() - lastStatsFailureAt < STATS_FAILURE_COOLDOWN_MS) {
          return
        }

        set({ aiStatsLoading: true, aiStatsError: null })
        try {
          const analysis = await analyzeStatsWithGemini({
            exercises: liveExercises,
            completedSessions: state.completedSessions,
            apiKey,
            isStale: () =>
              buildStatsFingerprint(
                get().getExercisesWithLiveProgress(),
                get().completedSessions,
              ) !== fp,
          })
          lastStatsFailureAt = 0
          set({ aiStats: analysis, aiStatsLoading: false, aiStatsError: null })
        } catch (err) {
          if (err instanceof GeminiError && err.kind === 'cancelled') {
            set({ aiStatsLoading: false })
            return
          }
          lastStatsFailureAt = Date.now()
          set({
            aiStatsLoading: false,
            aiStatsError: err instanceof Error ? err.message : 'Analyse IA indisponible.',
          })
        }
      },

      deleteHistoryEntry: (exerciseId, entryId) => {
        const state = get()
        const nextExercises = state.exercises.map((ex) =>
          ex.id === exerciseId
            ? { ...ex, entries: ex.entries.filter((e) => e.id !== entryId) }
            : ex,
        )
        const upPlan = isGeminiPlanFresh(
          state.coachPlans.up,
          nextExercises,
          'up',
          state.preamble,
        )
          ? state.coachPlans.up
          : buildDdpSessionPlan(nextExercises, 'up')
        const legsPlan = isGeminiPlanFresh(
          state.coachPlans.legs,
          nextExercises,
          'legs',
          state.preamble,
        )
          ? state.coachPlans.legs
          : buildDdpSessionPlan(nextExercises, 'legs')
        const section = state.activeDraft.section
        const activePlan = section === 'legs' ? legsPlan : upPlan
        set({
          exercises: nextExercises,
          coachPlans: { up: upPlan, legs: legsPlan },
          activeDraft: {
            ...state.activeDraft,
            logs: buildDraftLogsForSection(
              nextExercises,
              section,
              activePlan,
              state.activeDraft.logs,
            ),
          },
        })
      },

      updateHistoryEntry: (exerciseId, entryId, rawLineText) => {
        const state = get()
        const targetEx = state.exercises.find((e) => e.id === exerciseId)
        const existingEntry = targetEx?.entries.find((e) => e.id === entryId)
        if (!targetEx || !existingEntry) return false

        const parsedEntry = parseEntryLine(rawLineText)
        if (!parsedEntry.skipOnly && parsedEntry.sets.length === 0) return false

        const updatedEntry = {
          ...parsedEntry,
          id: existingEntry.id,
          date: parsedEntry.date ?? existingEntry.date,
          restSeconds: parsedEntry.restSeconds ?? existingEntry.restSeconds,
          ...(existingEntry.sessionDurationSeconds !== undefined
            ? { sessionDurationSeconds: existingEntry.sessionDurationSeconds }
            : {}),
        }

        const nextExercises = state.exercises.map((ex) =>
          ex.id === exerciseId
            ? {
                ...ex,
                entries: ex.entries.map((e) => (e.id === entryId ? updatedEntry : e)),
              }
            : ex,
        )
        const upPlan = buildDdpSessionPlan(nextExercises, 'up')
        const legsPlan = buildDdpSessionPlan(nextExercises, 'legs')
        const section = state.activeDraft.section
        const activePlan = section === 'legs' ? legsPlan : upPlan
        set({
          exercises: nextExercises,
          coachPlans: { up: upPlan, legs: legsPlan },
          activeDraft: {
            ...state.activeDraft,
            logs: buildDraftLogsForSection(
              nextExercises,
              section,
              activePlan,
              state.activeDraft.logs,
            ),
          },
        })
        return true
      },

      deleteCompletedSession: (sessionId) => {
        set((state) => ({
          completedSessions: state.completedSessions.filter((s) => s.id !== sessionId),
        }))
      },

      importNotepadSmart: async (rawText, options = {}) => {
        const state = get()
        const parsed = parseNotepad(rawText, {
          preserveCustomPreamble: options.preserveCustomPreamble,
          todayIso: todayISODate(),
        })
        const needsAi = hasUnrecognizedWorkoutText(rawText, parsed)

        let finalExercises = parsed.exercises
        const finalPreamble = options.preserveCustomPreamble
          ? parsed.preamble
          : parsed.preamble || DEFAULT_NOTEPAD_PREAMBLE
        let usedAi = false

        if (needsAi) {
          const cleanKey = sanitizeApiKey(state.settings.apiKey)
          if (!cleanKey) {
            throw new Error(
              'Format libre non reconnu : renseigne ta clé Gemini dans Réglages ou utilise le format « Nom de l’exercice : • poids x reps ».',
            )
          }
          set({ aiLoading: true, aiError: null })
          try {
            finalExercises = await parseWorkoutTextWithGemini({
              rawText,
              apiKey: cleanKey,
            })
            usedAi = true
          } finally {
            const cur = get()
            set({
              aiLoading: cur.aiGeneratingSections.up || cur.aiGeneratingSections.legs,
            })
          }
        }

        // Conserve tout plan Gemini dont la section n'a pas été modifiée dans le .txt
        const upPlan = isGeminiPlanFresh(
          state.coachPlans.up,
          finalExercises,
          'up',
          finalPreamble,
        )
          ? state.coachPlans.up
          : buildDdpSessionPlan(finalExercises, 'up')

        const legsPlan = isGeminiPlanFresh(
          state.coachPlans.legs,
          finalExercises,
          'legs',
          finalPreamble,
        )
          ? state.coachPlans.legs
          : buildDdpSessionPlan(finalExercises, 'legs')

        const { recommended } = getRecommendedSection(finalExercises)
        const activePlan = recommended === 'legs' ? legsPlan : upPlan
        const entriesCount = finalExercises.reduce((acc, ex) => acc + ex.entries.length, 0)

        const profile = inferProfileFromPreamble(finalPreamble)
        // Nouvel historique : les plans demandés sur l'ancien sont abandonnés.
        clearInFlightCoachTracking()

        set({
          ...(profile
            ? {
                settings: {
                  ...get().settings,
                  profileHeightCm: profile.heightCm,
                  profileWeightKg: profile.weightKg,
                },
              }
            : {}),
          preamble: finalPreamble,
          exercises: finalExercises,
          aiStats: null,
          coachPlans: { up: upPlan, legs: legsPlan },
          sessionPhase: 'idle',
          cursor: { exerciseIdx: 0, setIdx: 0 },
          restTimer: null,
          undoStack: [],
          aiError: null,
          activeDraft: {
            section: recommended,
            date: todayISODate(),
            startedAt: null,
            phaseStartedAt: null,
            pendingRestSeconds: null,
            logs: buildDraftLogsForSection(finalExercises, recommended, activePlan),
          },
        })

        // Régénère en tâche de fond les séances impactées si une clé API est présente
        if (sanitizeApiKey(state.settings.apiKey)) {
          void get().ensureSessionPlansGenerated(recommended)
        }

        return {
          usedAi,
          exercisesCount: finalExercises.length,
          entriesCount,
        }
      },

      resetToDefaultNotepad: () => {
        storeEpoch += 1
        clearInFlightCoachTracking()
        resetGeminiClientState()
        const fresh = createInitialData()
        set({
          ...fresh,
          settings: { ...get().settings, soundEnabled: false },
          aiLoading: false,
          aiGeneratingSections: { up: false, legs: false },
          aiStatsLoading: false,
          aiError: null,
          aiStatsError: null,
          lastToast: null,
        })
      },

      adjustRestTimer: (deltaSeconds) => {
        set((state) => {
          if (!state.restTimer) return state
          const snapshot: UndoSnapshot = {
            activeDraft: cloneDraft(state.activeDraft),
            sessionPhase: state.sessionPhase,
            cursor: { ...state.cursor },
            restTimer: { ...state.restTimer },
          }
          return {
            undoStack: pushSnapshot(state.undoStack, snapshot),
            restTimer: {
              ...state.restTimer,
              durationSeconds: Math.max(5, state.restTimer.durationSeconds + deltaSeconds),
            },
          }
        })
      },

      updateSettings: (patch) => {
        const cleanedPatch: Partial<AppSettings> = { ...patch }
        if (patch.apiKey !== undefined) cleanedPatch.apiKey = sanitizeApiKey(patch.apiKey)
        if (patch.geminiModel !== undefined) {
          // Un modèle hors gemini-3.8-flash (ancien réglage, 2.x…) est refusé : retour au modèle unique.
          const model = patch.geminiModel.trim()
          cleanedPatch.geminiModel = isSupportedGeminiModel(model) ? model : DEFAULT_GEMINI_MODEL
          cleanedPatch.geminiModelChosen = isSupportedGeminiModel(model)
        }
        if (patch.geminiBaseUrl !== undefined) cleanedPatch.geminiBaseUrl = patch.geminiBaseUrl.trim()
        const touchesAi =
          patch.apiKey !== undefined ||
          patch.geminiModel !== undefined ||
          patch.geminiChannel !== undefined ||
          patch.geminiBaseUrl !== undefined
        set((state) => ({
          settings: { ...state.settings, ...cleanedPatch },
          ...(touchesAi ? { aiStatsError: null, aiError: null } : {}),
        }))
      },

      clearApiKey: () => {
        clearInFlightCoachTracking()
        set((state) => ({
          settings: { ...state.settings, apiKey: '' },
          aiError: null,
          aiStatsError: null,
        }))
      },

      startSimulation: () => {
        const state = get()
        if (state.simulation) return
        // Les réponses IA encore en route appartiennent aux vraies données : on les ignore.
        storeEpoch += 1
        clearInFlightCoachTracking()

        const section = getRecommendedSection(state.exercises).recommended
        // Plans remis à la base calculée : les générations IA sont réellement rejouées.
        const coachPlans: Record<SectionId, CoachSessionPlan> = {
          up: buildDdpSessionPlan(state.exercises, 'up'),
          legs: buildDdpSessionPlan(state.exercises, 'legs'),
        }
        set({
          simulation: pickPersisted(state),
          coachPlans,
          aiLoading: false,
          aiGeneratingSections: { up: false, legs: false },
          aiError: null,
          sessionPhase: 'idle',
          cursor: { exerciseIdx: 0, setIdx: 0 },
          restTimer: null,
          undoStack: [],
          activeDraft: {
            section,
            date: todayISODate(),
            startedAt: null,
            phaseStartedAt: null,
            pendingRestSeconds: null,
            logs: buildDraftLogsForSection(state.exercises, section, coachPlans[section]),
          },
        })
        void get().ensureSessionPlansGenerated(section)
      },

      exitSimulation: () => {
        const state = get()
        if (!state.simulation) return
        storeEpoch += 1
        clearInFlightCoachTracking()
        set({
          ...state.simulation,
          // Les réglages modifiés pendant le test (clé, modèle, thème) sont gardés.
          settings: state.settings,
          simulation: null,
          undoStack: [],
          aiLoading: false,
          aiGeneratingSections: { up: false, legs: false },
          aiError: null,
          lastToast: null,
        })
        void get().ensureSessionPlansGenerated(get().activeDraft.section)
      },

      simulateNextStep: () => {
        const state = get()
        if (!state.simulation) return
        if (state.sessionPhase === 'idle') get().startWorkout()
        else if (state.sessionPhase === 'working') get().validateCurrentSet()
        else if (state.sessionPhase === 'resting') get().skipRest()
      },

      simulateWholeSession: () => {
        if (!get().simulation) return
        if (get().sessionPhase === 'idle') get().startWorkout()
        for (let guard = 0; guard < 500; guard += 1) {
          const phase = get().sessionPhase
          if (phase === 'working') get().validateCurrentSet()
          else if (phase === 'resting') get().skipRest()
          else break
        }
      },
    }),
    {
      name: STORAGE_KEY,
      version: SCHEMA_VERSION,
      storage: createJSONStorage(() => createMigratingStorage()),
      // Reprend les données de l'ancienne clé (sport-ddp:v5) sans jamais la supprimer.
      migrate: (persistedState) => migratePersistedState(persistedState, todayISODate()) as never,
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<WorkoutStoreState>
        const rawKey = persisted.settings?.apiKey ?? currentState.settings.apiKey
        const savedModel = persisted.settings?.geminiModel?.trim() ?? ''
        // Un modèle hors gemini-3.8-flash (anciennes versions, série 2.x) est abandonné.
        const modelChosen =
          persisted.settings?.geminiModelChosen === true && isSupportedGeminiModel(savedModel)
        return {
          ...currentState,
          ...persisted,
          exercises: settleObjectives(
            persisted.exercises ?? currentState.exercises,
            todayISODate(),
          ),
          settings: {
            ...currentState.settings,
            ...(persisted.settings ?? {}),
            apiKey: sanitizeApiKey(rawKey),
            geminiModel: modelChosen ? savedModel : DEFAULT_GEMINI_MODEL,
            geminiModelChosen: modelChosen,
            soundEnabled: Boolean(persisted.settings?.soundEnabled ?? false),
            vibrationEnabled: Boolean(persisted.settings?.vibrationEnabled ?? false),
          },
        }
      },
      // En mode test, seule la copie des vraies données est écrite : rien de simulé n'est enregistré,
      // même si l'onglet est fermé en plein test.
      partialize: (state): PersistedSlice =>
        state.simulation ? { ...state.simulation, settings: state.settings } : pickPersisted(state),
    },
  ),
)

/* Le client Gemini suit les réglages (modèle, canal, adresse). */
function syncGeminiConfig(settings: AppSettings): void {
  configureGemini({
    model: settings.geminiModel,
    channel: settings.geminiChannel ?? 'auto',
    baseUrl: settings.geminiBaseUrl ?? '',
  })
}

syncGeminiConfig(useWorkoutStore.getState().settings)
useWorkoutStore.subscribe((state, prev) => {
  if (state.settings !== prev.settings) syncGeminiConfig(state.settings)
})
