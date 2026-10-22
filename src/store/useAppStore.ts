import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { getNextSessionTypeId, sortSessionsDesc } from '../core/cycle'
import {
  DEFAULT_GEMINI_THINKING_LEVEL,
  SCHEMA_VERSION,
  STORAGE_KEY,
  createEmptyAppState,
  createExercise,
  createId,
  normalizeName,
  type AppState,
  type CoachPlan,
  type Exercise,
  type Session,
  type SessionType,
  type Settings,
  type Toast,
} from '../core/types'
import { computeFallbackTargets, buildFallbackPlan, fallbackGlobalNote } from '../core/progression'
import { isHistorySession } from '../core/stats'
import { todayISODate } from '../core/timer'
import {
  GeminiError,
  callGemini,
  describeGeminiError,
  type GeminiErrorCode,
} from '../core/gemini/client'
import {
  GEMINI_RESPONSE_SCHEMA,
  completeTargets,
  parseCoachResponse,
} from '../core/gemini/schema'
import { buildCoachInput, buildCoachPrompt, computeInputHash } from '../core/gemini/prompts'
import { createGymLogStorage } from './migrations'

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface ImportPlan {
  exercises: Exercise[]
  sessionTypes: SessionType[]
  sessions: Session[]
}

export interface ValidateSetPayload {
  sessionId: string
  exerciseId: string
  setIndex: number
  weight: number
  reps: number
  rpe: number | null
  note: string
}

export interface TestKeyResult {
  ok: boolean
  message: string
}

export interface GymLogStore extends AppState {
  toasts: Toast[]
  pendingImportText: string
  coachLoading: Record<string, boolean>

  setOnboardingDone: (done: boolean) => void
  updateSettings: (patch: Partial<Settings>) => void
  ensureExercise: (params: { name: string; unit?: 'kg' | 'bodyweight'; defaultRestSeconds?: number }) => string
  createSessionType: (name: string, exerciseIds: string[]) => string
  updateSessionType: (id: string, patch: { name?: string; exerciseIds?: string[] }) => void
  deleteSessionType: (id: string) => void
  reorderSessionTypes: (orderedIds: string[]) => void

  createOrReuseSession: (sessionTypeId: string) => string | null
  launchSession: (sessionId: string) => void
  abandonSession: (sessionId: string) => void
  finishSession: (sessionId: string) => void
  deleteSession: (sessionId: string) => void
  validateSet: (payload: ValidateSetPayload) => void
  addSet: (sessionId: string, exerciseId: string) => void
  setExerciseNote: (sessionId: string, exerciseId: string, note: string) => void

  setRestTimer: (durationSeconds: number, now?: number) => void
  extendRestTimer: (seconds: number) => void
  clearRestTimer: () => void

  ensureCoachPlan: (sessionId: string) => Promise<void>
  regenerateCoachPlan: (sessionId: string) => Promise<void>
  pregenerateNextPlan: () => Promise<void>
  testApiKey: (apiKey: string, model: string) => Promise<TestKeyResult>

  setPendingImportText: (text: string) => void
  applyImport: (plan: ImportPlan, mode: 'replace' | 'merge') => void
  replaceAllData: (state: AppState) => void
  resetAllData: (options?: { keepOnboarding?: boolean }) => void
  getSnapshot: () => AppState

  pushToast: (message: string, kind?: Toast['kind']) => void
  dismissToast: (id: string) => void
}

/* -------------------------------------------------------------------------- */
/* Helpers purs                                                               */
/* -------------------------------------------------------------------------- */

const DEFAULT_SETS_PER_EXERCISE = 3

function selectAppState(state: GymLogStore): AppState {
  return {
    schemaVersion: state.schemaVersion,
    onboardingDone: state.onboardingDone,
    settings: state.settings,
    exercises: state.exercises,
    sessionTypes: state.sessionTypes,
    sessions: state.sessions,
    activeSessionId: state.activeSessionId,
    restTimer: state.restTimer,
  }
}

function mapSession(
  sessions: Session[],
  sessionId: string,
  updater: (session: Session) => Session,
): Session[] {
  return sessions.map((session) => (session.id === sessionId ? updater(session) : session))
}

function createSets(count: number, weight = 0, reps = 0): Session['exercises'][number]['sets'] {
  return Array.from({ length: count }, (_, index) => ({
    index,
    weight,
    reps,
    restSecondsPlanned: null,
    restSecondsActual: null,
    rpe: null,
    note: '',
    completedAt: null,
  }))
}

function createDraftSession(sessionType: SessionType, date: string): Session {
  return {
    id: createId(),
    sessionTypeId: sessionType.id,
    date,
    startedAt: null,
    endedAt: null,
    status: 'planned',
    exercises: sessionType.exerciseIds.map((exerciseId) => ({
      exerciseId,
      sets: createSets(DEFAULT_SETS_PER_EXERCISE),
      note: '',
    })),
    coachPlan: null,
    source: 'app',
  }
}

/**
 * Renseigne les repos réels manquants : pour chaque série validée, l'écart
 * avec la série validée suivante (toutes séries de la séance confondues).
 */
function fillRestActuals(session: Session): Session {
  const entries: { exerciseIndex: number; setIndex: number; completedAt: number }[] = []
  session.exercises.forEach((log, exerciseIndex) => {
    log.sets.forEach((set, setIndex) => {
      if (set.completedAt !== null) entries.push({ exerciseIndex, setIndex, completedAt: set.completedAt })
    })
  })
  entries.sort((a, b) => a.completedAt - b.completedAt)

  const exercises = session.exercises.map((log) => ({
    ...log,
    sets: log.sets.map((set) => ({ ...set })),
  }))

  for (let index = 0; index < entries.length - 1; index += 1) {
    const current = entries[index]
    const next = entries[index + 1]
    const set = exercises[current.exerciseIndex].sets[current.setIndex]
    if (set.restSecondsActual === null) {
      set.restSecondsActual = Math.max(0, Math.round((next.completedAt - current.completedAt) / 1000))
    }
  }

  return { ...session, exercises }
}

function coachErrorMessage(error: unknown): string {
  if (error instanceof GeminiError) {
    const code: GeminiErrorCode = error.code
    if (code === 'invalid_key') return 'Clé Gemini invalide (vérifie-la dans Réglages)'
    if (code === 'rate_limited') return 'Quota Gemini atteint, objectifs auto utilisés'
  }
  return 'Coach IA indisponible, objectifs auto utilisés'
}

function mergeImport(current: AppState, plan: ImportPlan): {
  exercises: Exercise[]
  sessionTypes: SessionType[]
  sessions: Session[]
} {
  const exercises = [...current.exercises]
  const exerciseIdMap = new Map<string, string>()

  for (const incoming of plan.exercises) {
    const existing = exercises.find((exercise) => exercise.normalizedName === incoming.normalizedName)
    if (existing) {
      exerciseIdMap.set(incoming.id, existing.id)
    } else {
      exercises.push(incoming)
      exerciseIdMap.set(incoming.id, incoming.id)
    }
  }

  const sessionTypes = [...current.sessionTypes]
  const sessionTypeIdMap = new Map<string, string>()

  for (const incoming of plan.sessionTypes) {
    const existing = sessionTypes.find(
      (type) => normalizeName(type.name) === normalizeName(incoming.name),
    )
    if (existing) {
      sessionTypeIdMap.set(incoming.id, existing.id)
    } else {
      sessionTypes.push({ ...incoming, order: sessionTypes.length })
      sessionTypeIdMap.set(incoming.id, incoming.id)
    }
  }

  const sessions = [...current.sessions]

  for (const incoming of plan.sessions) {
    const sessionTypeId = sessionTypeIdMap.get(incoming.sessionTypeId) ?? incoming.sessionTypeId
    const sameDate = sessions.filter((session) => session.date === incoming.date)

    const remappedExercises = incoming.exercises
      .map((log) => ({
        ...log,
        exerciseId: exerciseIdMap.get(log.exerciseId) ?? log.exerciseId,
      }))
      .filter((log) => !sameDate.some((session) => session.exercises.some((entry) => entry.exerciseId === log.exerciseId)))

    if (remappedExercises.length === 0) continue

    sessions.push({
      ...incoming,
      id: createId(),
      sessionTypeId,
      exercises: remappedExercises,
      coachPlan: null,
      status: 'imported',
      source: 'import',
    })
  }

  return { exercises, sessionTypes, sessions }
}

/* -------------------------------------------------------------------------- */
/* Store                                                                      */
/* -------------------------------------------------------------------------- */

export const useAppStore = create<GymLogStore>()(
  persist(
    (set, get) => {
      const generatePlan = async (sessionId: string, force: boolean): Promise<void> => {
        const state = get()
        const session = state.sessions.find((candidate) => candidate.id === sessionId)
        if (!session) return
        if (session.status === 'completed' || session.status === 'imported') return
        if (force && session.exercises.some((log) => log.sets.some((entry) => entry.completedAt !== null))) {
          return
        }

        const sessionType = state.sessionTypes.find((type) => type.id === session.sessionTypeId)
        const inputExercises = session.exercises
          .map((log) => state.exercises.find((exercise) => exercise.id === log.exerciseId))
          .filter((exercise): exercise is Exercise => exercise !== undefined)
        if (inputExercises.length === 0) return

        const input = buildCoachInput({
          session,
          sessionTypeName: sessionType?.name ?? 'Séance',
          exercises: state.exercises,
          sessions: state.sessions,
          weightStep: state.settings.weightStep,
        })
        const model = state.settings.geminiModel
        const inputHash = await computeInputHash(input, model)

        if (!force && session.coachPlan?.inputHash === inputHash) return

        if (!force) {
          const reusable = state.sessions.find(
            (other) =>
              other.id !== sessionId &&
              other.sessionTypeId === session.sessionTypeId &&
              other.status === 'planned' &&
              other.coachPlan?.inputHash === inputHash,
          )
          if (reusable?.coachPlan) {
            const copied: CoachPlan = { ...reusable.coachPlan, generatedAt: Date.now() }
            set((current) => ({
              sessions: mapSession(current.sessions, sessionId, (entry) => ({ ...entry, coachPlan: copied })),
            }))
            return
          }
        }

        set((current) => ({
          coachLoading: { ...current.coachLoading, [sessionId]: true },
        }))

        const historySessions = sortSessionsDesc(
          state.sessions.filter(
            (candidate) =>
              candidate.sessionTypeId === session.sessionTypeId &&
              candidate.id !== session.id &&
              isHistorySession(candidate),
          ),
        )
        const exerciseIds = inputExercises.map((exercise) => exercise.id)
        const fallbackTargets = computeFallbackTargets(inputExercises, historySessions, state.settings)

        let plan: CoachPlan
        const apiKey = state.settings.geminiApiKey.trim()

        if (apiKey === '') {
          plan = buildFallbackPlan({
            exercises: inputExercises,
            sessions: historySessions,
            settings: state.settings,
            inputHash,
            model: null,
            targets: fallbackTargets,
          })
        } else {
          try {
            const raw = await callGemini({
              apiKey,
              model,
              prompt: buildCoachPrompt(input),
              responseSchema: GEMINI_RESPONSE_SCHEMA,
              thinkingLevel: DEFAULT_GEMINI_THINKING_LEVEL,
            })
            const parsed = parseCoachResponse(raw, {
              knownExerciseIds: exerciseIds,
              weightStep: state.settings.weightStep,
            })
            plan = {
              generatedAt: Date.now(),
              source: 'gemini',
              model,
              globalNote: parsed.globalNote === '' ? fallbackGlobalNote(state.settings) : parsed.globalNote,
              targets: completeTargets(parsed.targets, exerciseIds, fallbackTargets),
              inputHash,
            }
          } catch (error) {
            plan = buildFallbackPlan({
              exercises: inputExercises,
              sessions: historySessions,
              settings: state.settings,
              inputHash,
              model: null,
              targets: fallbackTargets,
            })
            get().pushToast(coachErrorMessage(error), 'error')
          }
        }

        set((current) => ({
          sessions: mapSession(current.sessions, sessionId, (entry) => ({ ...entry, coachPlan: plan })),
          coachLoading: { ...current.coachLoading, [sessionId]: false },
        }))
      }

      return {
        ...createEmptyAppState(),
        toasts: [],
        pendingImportText: '',
        coachLoading: {},

        /* ---------------------------- Réglages ---------------------------- */
        setOnboardingDone: (done) => {
          set({ onboardingDone: done })
        },

        updateSettings: (patch) => {
          set((state) => ({
            settings: { ...state.settings, ...patch },
          }))
        },

        /* ------------------------- Exercices / types ---------------------- */
        ensureExercise: (params) => {
          const normalizedName = normalizeName(params.name)
          const existing = get().exercises.find(
            (exercise) => exercise.normalizedName === normalizedName,
          )
          if (existing) return existing.id
          const exercise = createExercise({
            name: params.name,
            unit: params.unit,
            defaultRestSeconds: params.defaultRestSeconds ?? get().settings.defaultRestSeconds,
          })
          set((state) => ({ exercises: [...state.exercises, exercise] }))
          return exercise.id
        },

        createSessionType: (name, exerciseIds) => {
          const type: SessionType = {
            id: createId(),
            name: name.trim(),
            order: get().sessionTypes.length,
            exerciseIds,
          }
          set((state) => ({ sessionTypes: [...state.sessionTypes, type] }))
          return type.id
        },

        updateSessionType: (id, patch) => {
          set((state) => ({
            sessionTypes: state.sessionTypes.map((type) =>
              type.id === id
                ? {
                    ...type,
                    name: patch.name !== undefined ? patch.name : type.name,
                    exerciseIds: patch.exerciseIds !== undefined ? patch.exerciseIds : type.exerciseIds,
                  }
                : type,
            ),
          }))
        },

        deleteSessionType: (id) => {
          set((state) => ({
            sessionTypes: state.sessionTypes
              .filter((type) => type.id !== id)
              .map((type, index) => ({ ...type, order: index })),
          }))
        },

        reorderSessionTypes: (orderedIds) => {
          set((state) => ({
            sessionTypes: orderedIds
              .map((id, index) => {
                const type = state.sessionTypes.find((candidate) => candidate.id === id)
                return type ? { ...type, order: index } : null
              })
              .filter((type): type is SessionType => type !== null),
          }))
        },

        /* ----------------------------- Séances ---------------------------- */
        createOrReuseSession: (sessionTypeId) => {
          const state = get()
          const type = state.sessionTypes.find((candidate) => candidate.id === sessionTypeId)
          if (!type) return null

          const inProgress = state.sessions.find((session) => session.status === 'in_progress')
          if (inProgress) return inProgress.id

          const draft = state.sessions.find(
            (session) =>
              session.status === 'planned' &&
              session.sessionTypeId === sessionTypeId &&
              session.startedAt === null,
          )
          if (draft) return draft.id

          const session = createDraftSession(type, todayISODate())
          set((current) => ({ sessions: [...current.sessions, session] }))
          return session.id
        },

        launchSession: (sessionId) => {
          const now = Date.now()
          set((state) => ({
            sessions: mapSession(state.sessions, sessionId, (session) =>
              session.status === 'in_progress'
                ? session
                : {
                    ...session,
                    status: 'in_progress',
                    startedAt: session.startedAt ?? now,
                    endedAt: null,
                  },
            ),
            activeSessionId: sessionId,
          }))
        },

        abandonSession: (sessionId) => {
          set((state) => ({
            sessions: state.sessions.filter((session) => session.id !== sessionId),
            activeSessionId:
              state.activeSessionId === sessionId ? null : state.activeSessionId,
            restTimer: state.activeSessionId === sessionId ? null : state.restTimer,
          }))
        },

        deleteSession: (sessionId) => {
          get().abandonSession(sessionId)
        },

        finishSession: (sessionId) => {
          const now = Date.now()
          set((state) => ({
            sessions: mapSession(state.sessions, sessionId, (session) => ({
              ...session,
              status: 'completed',
              endedAt: now,
              exercises: session.exercises.map((log) => ({
                ...log,
                sets: log.sets.filter((entry) => entry.completedAt !== null),
              })),
            })),
            activeSessionId: state.activeSessionId === sessionId ? null : state.activeSessionId,
            restTimer: state.activeSessionId === sessionId ? null : state.restTimer,
          }))
        },

        validateSet: (payload) => {
          const now = Date.now()
          const state = get()
          const session = state.sessions.find((candidate) => candidate.id === payload.sessionId)
          if (!session) return
          const exercise = state.exercises.find((candidate) => candidate.id === payload.exerciseId)
          const target = session.coachPlan?.targets.find(
            (candidate) => candidate.exerciseId === payload.exerciseId,
          )
          const restSecondsPlanned =
            target?.targetRestSeconds ?? exercise?.defaultRestSeconds ?? state.settings.defaultRestSeconds

          const updated: Session = {
            ...session,
            status: session.status === 'planned' ? 'in_progress' : session.status,
            startedAt: session.startedAt ?? now,
            exercises: session.exercises.map((log) => {
              if (log.exerciseId !== payload.exerciseId) return log
              return {
                ...log,
                sets: log.sets.map((entry) =>
                  entry.index === payload.setIndex
                    ? {
                        ...entry,
                        weight: Math.max(0, payload.weight),
                        reps: Math.max(0, Math.round(payload.reps)),
                        rpe:
                          payload.rpe !== null && payload.rpe >= 1 && payload.rpe <= 10
                            ? payload.rpe
                            : null,
                        note: payload.note,
                        completedAt: now,
                        restSecondsPlanned,
                        restSecondsActual: null,
                      }
                    : entry,
                ),
              }
            }),
          }

          const withRest = fillRestActuals(updated)

          set((current) => ({
            sessions: mapSession(current.sessions, payload.sessionId, () => withRest),
            restTimer: { startedAt: now, durationSeconds: restSecondsPlanned },
            activeSessionId: payload.sessionId,
          }))
        },

        addSet: (sessionId, exerciseId) => {
          set((state) => ({
            sessions: mapSession(state.sessions, sessionId, (session) => ({
              ...session,
              exercises: session.exercises.map((log) => {
                if (log.exerciseId !== exerciseId) return log
                const last = log.sets[log.sets.length - 1]
                return {
                  ...log,
                  sets: [
                    ...log.sets,
                    {
                      index: log.sets.length,
                      weight: last?.weight ?? 0,
                      reps: last?.reps ?? 0,
                      restSecondsPlanned: null,
                      restSecondsActual: null,
                      rpe: null,
                      note: '',
                      completedAt: null,
                    },
                  ],
                }
              }),
            })),
          }))
        },

        setExerciseNote: (sessionId, exerciseId, note) => {
          set((state) => ({
            sessions: mapSession(state.sessions, sessionId, (session) => ({
              ...session,
              exercises: session.exercises.map((log) =>
                log.exerciseId === exerciseId ? { ...log, note } : log,
              ),
            })),
          }))
        },

        /* ------------------------------ Timers ---------------------------- */
        setRestTimer: (durationSeconds, now = Date.now()) => {
          set({ restTimer: { startedAt: now, durationSeconds } })
        },

        extendRestTimer: (seconds) => {
          const timer = get().restTimer
          if (timer === null) return
          set({ restTimer: { ...timer, durationSeconds: timer.durationSeconds + seconds } })
        },

        clearRestTimer: () => {
          set({ restTimer: null })
        },

        /* ------------------------------ Coach ----------------------------- */
        ensureCoachPlan: async (sessionId) => {
          await generatePlan(sessionId, false)
        },

        regenerateCoachPlan: async (sessionId) => {
          await generatePlan(sessionId, true)
        },

        pregenerateNextPlan: async () => {
          const state = get()
          const nextTypeId = getNextSessionTypeId(state.sessionTypes, state.sessions)
          if (nextTypeId === null) return
          const type = state.sessionTypes.find((candidate) => candidate.id === nextTypeId)
          if (!type) return

          const existing = state.sessions.find(
            (session) => session.status === 'planned' && session.sessionTypeId === nextTypeId,
          )
          const draft = existing ?? createDraftSession(type, todayISODate())
          if (!existing) {
            set((current) => ({ sessions: [...current.sessions, draft] }))
          }
          await generatePlan(draft.id, false)
        },

        testApiKey: async (apiKey, model) => {
          try {
            await callGemini({
              apiKey: apiKey.trim(),
              model,
              prompt: 'Réponds {"ok":true}',
              responseSchema: {
                type: 'OBJECT',
                properties: { ok: { type: 'BOOLEAN' } },
                required: ['ok'],
              },
              timeoutMs: 15_000,
              retryDelayMs: 500,
              thinkingLevel: DEFAULT_GEMINI_THINKING_LEVEL,
            })
            return { ok: true, message: 'Clé valide : Gemini répond.' }
          } catch (error) {
            return { ok: false, message: describeGeminiError(error) }
          }
        },

        /* ------------------------------ Import ---------------------------- */
        setPendingImportText: (text) => {
          set({ pendingImportText: text })
        },

        applyImport: (plan, mode) => {
          if (mode === 'replace') {
            set({
              exercises: plan.exercises,
              sessionTypes: plan.sessionTypes,
              sessions: plan.sessions,
              onboardingDone: true,
              activeSessionId: null,
              restTimer: null,
            })
            return
          }

          const merged = mergeImport(selectAppState(get()), plan)
          set({
            exercises: merged.exercises,
            sessionTypes: merged.sessionTypes,
            sessions: merged.sessions,
            onboardingDone: true,
          })
        },

        replaceAllData: (next) => {
          set({
            schemaVersion: next.schemaVersion,
            onboardingDone: next.onboardingDone,
            settings: next.settings,
            exercises: next.exercises,
            sessionTypes: next.sessionTypes,
            sessions: next.sessions,
            activeSessionId: next.activeSessionId,
            restTimer: next.restTimer,
          })
        },

        resetAllData: (options) => {
          const empty = createEmptyAppState()
          set({
            ...empty,
            onboardingDone: options?.keepOnboarding === true,
            toasts: [],
            coachLoading: {},
            pendingImportText: '',
          })
        },

        getSnapshot: () => selectAppState(get()),

        /* ------------------------------ Toasts ---------------------------- */
        pushToast: (message, kind = 'info') => {
          const toast: Toast = { id: createId(), message, kind }
          set((state) => ({ toasts: [...state.toasts, toast] }))
        },

        dismissToast: (id) => {
          set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }))
        },
      }
    },
    {
      name: STORAGE_KEY,
      version: SCHEMA_VERSION,
      storage: createJSONStorage(createGymLogStorage),
      partialize: (state) => selectAppState(state),
    },
  ),
)
