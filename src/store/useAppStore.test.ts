import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createDefaultSettings,
  createEmptyAppState,
  createExercise,
  type AppState,
  type SessionType,
} from '../core/types'
import { migratePersistedState, parsePersistedState } from './migrations'
import { useAppStore } from './useAppStore'

function sampleState(): AppState {
  const exercise = createExercise({ name: 'Squat', id: 'ex-squat' })
  const type: SessionType = {
    id: 'type-jambes',
    name: 'BAS',
    order: 0,
    exerciseIds: [exercise.id],
  }
  return {
    ...createEmptyAppState(),
    onboardingDone: true,
    settings: { ...createDefaultSettings(), geminiApiKey: 'abc' },
    exercises: [exercise],
    sessionTypes: [type],
    sessions: [],
  }
}

describe('sérialisation / désérialisation', () => {
  it('fait un aller-retour sans perte', () => {
    const state = sampleState()
    const outcome = parsePersistedState(JSON.stringify({ state, version: 1 }))
    expect(outcome.error).toBeNull()
    expect(outcome.state).toEqual(state)
  })

  it('accepte un AppState brut (sans enveloppe)', () => {
    const state = sampleState()
    const outcome = parsePersistedState(JSON.stringify(state))
    expect(outcome.state).toEqual(state)
  })

  it('refuse une version de schéma inconnue sans écraser', () => {
    const outcome = parsePersistedState(JSON.stringify({ state: { schemaVersion: 2 }, version: 2 }))
    expect(outcome.state).toBeNull()
    expect(outcome.error).toBe('unknown_version')
  })

  it('refuse des données invalides', () => {
    expect(parsePersistedState('{oops').error).toBe('invalid_data')
    expect(parsePersistedState(JSON.stringify({ state: { foo: 'bar' }, version: 1 })).error).toBe(
      'invalid_data',
    )
  })

  it('migre uniquement des données valides', () => {
    const state = sampleState()
    expect(migratePersistedState(state, 0)).toEqual(state)
    expect(() => migratePersistedState({ schemaVersion: 9 }, 9)).toThrow()
  })
})

describe('store — import et séances', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    localStorage.clear()
    useAppStore.getState().resetAllData()
  })

  it('importe puis exporte un état identique', () => {
    const state = sampleState()
    useAppStore.getState().replaceAllData(state)
    expect(useAppStore.getState().getSnapshot()).toEqual(state)
  })

  it('déduplique les exercices à l’import (par nom normalisé)', () => {
    const exercise = createExercise({ name: 'Développé couché' })
    const duplicate = createExercise({ name: 'developpe  couche' })
    const type: SessionType = { id: 't1', name: 'HAUT', order: 0, exerciseIds: [exercise.id] }

    useAppStore.getState().applyImport(
      {
        exercises: [exercise],
        sessionTypes: [type],
        sessions: [
          {
            id: 's1',
            sessionTypeId: 't1',
            date: '2026-10-20',
            startedAt: null,
            endedAt: null,
            status: 'imported',
            exercises: [{ exerciseId: exercise.id, sets: [], note: '' }],
            coachPlan: null,
            source: 'import',
          },
        ],
      },
      'replace',
    )

    useAppStore.getState().applyImport(
      {
        exercises: [duplicate],
        sessionTypes: [{ id: 't2', name: 'HAUT', order: 0, exerciseIds: [duplicate.id] }],
        sessions: [
          {
            id: 's2',
            sessionTypeId: 't2',
            date: '2026-10-20',
            startedAt: null,
            endedAt: null,
            status: 'imported',
            exercises: [{ exerciseId: duplicate.id, sets: [], note: '' }],
            coachPlan: null,
            source: 'import',
          },
        ],
      },
      'merge',
    )

    const state = useAppStore.getState()
    expect(state.exercises).toHaveLength(1)
    // Même date + même exercice : la séance n'est pas dupliquée.
    expect(state.sessions).toHaveLength(1)
  })

  it('valide une série et remplit le repos réel de la précédente', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-22T18:00:00Z'))

    const state = useAppStore.getState()
    const exerciseId = state.ensureExercise({ name: 'Développé couché' })
    const typeId = state.createSessionType('HAUT', [exerciseId])
    const sessionId = useAppStore.getState().createOrReuseSession(typeId)
    expect(sessionId).not.toBeNull()
    if (sessionId === null) return

    useAppStore.getState().launchSession(sessionId)
    useAppStore.getState().validateSet({
      sessionId,
      exerciseId,
      setIndex: 0,
      weight: 80,
      reps: 10,
      rpe: 8,
      note: '',
    })

    const afterFirst = useAppStore.getState()
    expect(afterFirst.restTimer).not.toBeNull()
    expect(afterFirst.restTimer?.durationSeconds).toBe(90)
    expect(afterFirst.sessions[0].exercises[0].sets[0].restSecondsPlanned).toBe(90)

    vi.setSystemTime(new Date('2026-10-22T18:02:00Z'))
    useAppStore.getState().validateSet({
      sessionId,
      exerciseId,
      setIndex: 1,
      weight: 80,
      reps: 9,
      rpe: null,
      note: 'dur',
    })

    const afterSecond = useAppStore.getState()
    expect(afterSecond.sessions[0].exercises[0].sets[0].restSecondsActual).toBe(120)
    expect(afterSecond.sessions[0].exercises[0].sets[1].note).toBe('dur')

    vi.useRealTimers()
  })

  it('supprime les séries non validées à la fin de séance', () => {
    const state = useAppStore.getState()
    const exerciseId = state.ensureExercise({ name: 'Squat' })
    const typeId = state.createSessionType('BAS', [exerciseId])
    const sessionId = useAppStore.getState().createOrReuseSession(typeId)
    if (sessionId === null) return

    useAppStore.getState().launchSession(sessionId)
    useAppStore.getState().validateSet({
      sessionId,
      exerciseId,
      setIndex: 0,
      weight: 100,
      reps: 5,
      rpe: null,
      note: '',
    })
    useAppStore.getState().finishSession(sessionId)

    const finished = useAppStore.getState().sessions[0]
    expect(finished.status).toBe('completed')
    expect(finished.endedAt).not.toBeNull()
    expect(finished.exercises[0].sets).toHaveLength(1)
    expect(useAppStore.getState().activeSessionId).toBeNull()
    expect(useAppStore.getState().restTimer).toBeNull()
  })

  it('signale une clé invalide et retombe sur le plan de repli', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })))

    const state = useAppStore.getState()
    state.updateSettings({ geminiApiKey: 'cle-invalide', geminiModel: 'gemini-3.8-flash' })
    const exerciseId = state.ensureExercise({ name: 'Développé couché' })
    const typeId = useAppStore.getState().createSessionType('HAUT', [exerciseId])
    const sessionId = useAppStore.getState().createOrReuseSession(typeId)
    if (sessionId === null) return

    await useAppStore.getState().ensureCoachPlan(sessionId)
    const after = useAppStore.getState()
    const plan = after.sessions.find((session) => session.id === sessionId)?.coachPlan
    expect(plan?.source).toBe('fallback')
    expect(after.toasts.some((toast) => toast.message.includes('Clé Gemini invalide'))).toBe(true)

    vi.unstubAllGlobals()
  })

  it('utilise la réponse Gemini et ignore les cibles inconnues', async () => {
    const state = useAppStore.getState()
    state.updateSettings({ geminiApiKey: 'cle-valide', geminiModel: 'gemini-3.8-flash' })
    const exerciseId = state.ensureExercise({ name: 'Squat' })
    const typeId = useAppStore.getState().createSessionType('BAS', [exerciseId])
    const sessionId = useAppStore.getState().createOrReuseSession(typeId)
    if (sessionId === null) return

    const payload = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  global_coach_note: 'Bonne séance, vise la régularité.',
                  exercises_targets: [
                    {
                      exercise_id: exerciseId,
                      target_weight: 80,
                      target_reps_min: 8,
                      target_reps_max: 10,
                      target_rest_seconds: 120,
                      exercise_tip: 'Contrôle la descente.',
                    },
                    {
                      exercise_id: 'inconnu',
                      target_weight: 50,
                      target_reps_min: 8,
                      target_reps_max: 10,
                      target_rest_seconds: 90,
                      exercise_tip: 'Ignore.',
                    },
                  ],
                }),
              },
            ],
          },
        },
      ],
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload)))
    vi.stubGlobal('fetch', fetchMock)

    await useAppStore.getState().ensureCoachPlan(sessionId)

    const after = useAppStore.getState()
    const plan = after.sessions.find((session) => session.id === sessionId)?.coachPlan
    expect(plan?.source).toBe('gemini')
    expect(plan?.model).toBe('gemini-3.8-flash')
    expect(plan?.globalNote).toContain('Bonne séance')
    expect(plan?.targets).toHaveLength(1)
    expect(plan?.targets[0].exerciseId).toBe(exerciseId)
    expect(plan?.targets[0].targetRestSeconds).toBe(120)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as {
      generationConfig: { thinkingConfig?: { thinkingLevel?: string } }
    }
    expect(body.generationConfig.thinkingConfig?.thinkingLevel).toBe('high')
  })

  it('propose un objectif de repli sans clé API', async () => {
    const state = useAppStore.getState()
    const exerciseId = state.ensureExercise({ name: 'Rowing' })
    const typeId = state.createSessionType('HAUT', [exerciseId])
    const sessionId = useAppStore.getState().createOrReuseSession(typeId)
    if (sessionId === null) return

    await useAppStore.getState().ensureCoachPlan(sessionId)
    const plan = useAppStore.getState().sessions.find((session) => session.id === sessionId)?.coachPlan
    expect(plan?.source).toBe('fallback')
    expect(plan?.targets).toHaveLength(1)
    expect(plan?.targets[0].tip).toContain('Première fois')
  })
})
