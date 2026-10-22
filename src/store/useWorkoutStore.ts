import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  DEFAULT_NOTEPAD_PREAMBLE,
  DEFAULT_NOTEPAD_TEXT,
  EXAMPLE_API_KEY,
} from '../core/defaultNotepad'
import {
  buildDdpSessionPlan,
  getLatestEntry,
  getRecommendedSection,
} from '../core/ddp'
import {
  GEMINI_MODEL,
  analyzeStatsWithGemini,
  buildStatsFingerprint,
  generateGeminiSessionPlan,
  parseWorkoutTextWithGemini,
} from '../core/gemini'
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

export const STORAGE_KEY = 'sport-ddp:v5'

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
      if (sets[sIdx].completedAt === null) {
        return { exerciseIdx: eIdx, setIdx: sIdx }
      }
    }
  }

  for (let eIdx = 0; eIdx < fromExerciseIdx; eIdx += 1) {
    const ex = activeExercises[eIdx]
    const sets = logs[ex.id]?.sets ?? []
    for (let sIdx = 0; sIdx < sets.length; sIdx += 1) {
      if (sets[sIdx].completedAt === null) {
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
    apiKey: EXAMPLE_API_KEY,
    geminiModel: GEMINI_MODEL,
    theme: 'light',
    soundEnabled: false,
    vibrationEnabled: false,
    profileHeightCm: 184,
    profileWeightKg: 72,
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
}

export interface SmartImportResult {
  usedAi: boolean
  exercisesCount: number
  entriesCount: number
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
  aiStatsLoading: boolean
  aiStatsError: string | null
  aiError: string | null

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
    patch: Partial<Pick<DraftSet, 'weight' | 'reps' | 'isWarmup' | 'failure'>>,
  ) => void
  updateDraftNote: (exerciseId: string, note: string) => void
  saveCompletedWorkout: () => SaveWorkoutSummary | null
  discardActiveWorkout: () => void
  getExercisesWithLiveProgress: () => Exercise[]

  askGeminiCoach: (section: SectionId) => Promise<void>
  refreshAiStats: (force?: boolean) => Promise<void>
  deleteHistoryEntry: (exerciseId: string, entryId: string) => void
  deleteCompletedSession: (sessionId: string) => void

  importNotepadSmart: (rawText: string) => Promise<SmartImportResult>
  resetToDefaultNotepad: () => void

  adjustRestTimer: (deltaSeconds: number) => void
  updateSettings: (patch: Partial<AppSettings>) => void
  clearApiKey: () => void
}

export const useWorkoutStore = create<WorkoutStoreState>()(
  persist(
    (set, get) => ({
      ...createInitialData(),
      aiLoading: false,
      aiStatsLoading: false,
      aiStatsError: null,
      aiError: null,

      selectSection: (section) => {
        const state = get()
        if (state.activeDraft.section === section) return
        const plan = state.coachPlans[section] ?? buildDdpSessionPlan(state.exercises, section)
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

        const hasPastHistory = activeExercises.some((ex) =>
          ex.entries.some((entry) => !entry.skipOnly && entry.sets.length > 0),
        )
        const hasApiKey = state.settings.apiKey.trim().length > 0
        const alreadyGemini = state.coachPlans[section]?.source === 'gemini'
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

        if (hasPastHistory && hasApiKey && !alreadyGemini && !state.aiLoading) {
          void get().askGeminiCoach(section)
        }
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
        const firstUncompleted = sets.findIndex((s) => s.completedAt === null)
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
            ...(s.isWarmup ? { isWarmup: true } : {}),
            ...(s.failure ? { failure: true } : {}),
            ...(typeof s.workSeconds === 'number' ? { workSeconds: s.workSeconds } : {}),
            ...(typeof s.restBeforeSeconds === 'number' && s.restBeforeSeconds > 0
              ? { restBeforeSeconds: s.restBeforeSeconds }
              : {}),
          }))

          const restValues = doneSets
            .map((s) => s.restBeforeSeconds)
            .filter((v): v is number => typeof v === 'number' && v > 0)
          const avgRest =
            restValues.length > 0
              ? Math.round(restValues.reduce((a, b) => a + b, 0) / restValues.length)
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
        const plan =
          state.coachPlans[section] ?? buildDdpSessionPlan(state.exercises, section)
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

        const totalDurationSeconds = startedAt
          ? Math.max(1, Math.round((endedAt - startedAt) / 1000))
          : Math.max(1, totalWorkSeconds + totalRestSeconds)

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

        const upPlan = buildDdpSessionPlan(nextExercises, 'up')
        const legsPlan = buildDdpSessionPlan(nextExercises, 'legs')
        const { recommended } = getRecommendedSection(nextExercises)
        const nextPlan = recommended === 'legs' ? legsPlan : upPlan

        set({
          exercises: nextExercises,
          completedSessions: [sessionRecord, ...state.completedSessions],
          coachPlans: { up: upPlan, legs: legsPlan },
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

        return {
          savedExercises,
          validatedSets: validatedSetsCount,
          totalVolumeKg: Math.round(totalVolumeKg),
          totalDurationSeconds,
          totalWorkSeconds,
          totalRestSeconds,
          nextRecommended: recommended,
        }
      },

      askGeminiCoach: async (section) => {
        const state = get()
        if (!state.settings.apiKey.trim()) return
        set({ aiLoading: true, aiError: null })
        try {
          const plan = await generateGeminiSessionPlan({
            section,
            exercises: state.exercises,
            preamble: state.preamble,
            settings: state.settings,
          })
          const latestState = get()
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
            aiLoading: false,
            aiError: null,
          })
        } catch (err) {
          set({
            aiLoading: false,
            aiError: err instanceof Error ? err.message : 'Erreur Gemini.',
          })
        }
      },

      refreshAiStats: async (force = false) => {
        const state = get()
        const apiKey = state.settings.apiKey.trim()
        if (!apiKey || state.aiStatsLoading) return

        const liveExercises = get().getExercisesWithLiveProgress()
        const fp = buildStatsFingerprint(liveExercises, state.completedSessions)
        if (!force && state.aiStats && state.aiStats.fingerprint === fp) {
          return
        }

        set({ aiStatsLoading: true, aiStatsError: null })
        try {
          const analysis = await analyzeStatsWithGemini({
            exercises: liveExercises,
            completedSessions: state.completedSessions,
            apiKey,
          })
          set({ aiStats: analysis, aiStatsLoading: false, aiStatsError: null })
        } catch (err) {
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
      },

      deleteCompletedSession: (sessionId) => {
        set((state) => ({
          completedSessions: state.completedSessions.filter((s) => s.id !== sessionId),
        }))
      },

      importNotepadSmart: async (rawText) => {
        const state = get()
        const parsed = parseNotepad(rawText)
        const needsAi = hasUnrecognizedWorkoutText(rawText, parsed)

        let finalExercises = parsed.exercises
        const finalPreamble = parsed.preamble || DEFAULT_NOTEPAD_PREAMBLE
        let usedAi = false

        if (needsAi) {
          if (!state.settings.apiKey.trim()) {
            throw new Error(
              'Format libre non reconnu : renseigne ta clé Gemini dans Réglages pour l’extraction IA.',
            )
          }
          set({ aiLoading: true, aiError: null })
          try {
            finalExercises = await parseWorkoutTextWithGemini({
              rawText,
              apiKey: state.settings.apiKey,
            })
            usedAi = true
          } finally {
            set({ aiLoading: false })
          }
        }

        const upPlan = buildDdpSessionPlan(finalExercises, 'up')
        const legsPlan = buildDdpSessionPlan(finalExercises, 'legs')
        const { recommended } = getRecommendedSection(finalExercises)
        const activePlan = recommended === 'legs' ? legsPlan : upPlan
        const entriesCount = finalExercises.reduce((acc, ex) => acc + ex.entries.length, 0)

        set({
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

        return {
          usedAi,
          exercisesCount: finalExercises.length,
          entriesCount,
        }
      },

      resetToDefaultNotepad: () => {
        const fresh = createInitialData()
        set({
          ...fresh,
          settings: { ...get().settings, geminiModel: GEMINI_MODEL, soundEnabled: false },
          aiError: null,
          aiStatsError: null,
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
        set((state) => ({
          settings: { ...state.settings, ...patch, geminiModel: GEMINI_MODEL },
          ...(patch.apiKey !== undefined
            ? { aiStatsError: null, aiError: null }
            : {}),
        }))
      },

      clearApiKey: () => {
        set((state) => ({
          settings: { ...state.settings, apiKey: '' },
        }))
      },
    }),
    {
      name: STORAGE_KEY,
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<WorkoutStoreState>
        return {
          ...currentState,
          ...persisted,
          settings: {
            ...currentState.settings,
            ...(persisted.settings ?? {}),
            geminiModel: GEMINI_MODEL,
            soundEnabled: false,
          },
        }
      },
      partialize: (state) => ({
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
      }),
    },
  ),
)
