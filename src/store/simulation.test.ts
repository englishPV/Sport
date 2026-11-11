import { afterEach, describe, expect, it, vi } from 'vitest'
import { getGeminiConfig, resetGeminiClientState } from '../core/gemini'
import { SCHEMA_VERSION } from '../core/storage'
import { STORAGE_KEY, useWorkoutStore } from './useWorkoutStore'

const KEY = 'AQ.DummyKeyForTests000000000000000'

const NOTEPAD = `Mes règles.

Up Tirage vertical :
• 01/01/2026 : 50kg x 12 | 50kg x 11
• 05/01/2026 : 50kg x 12 | 50kg x 12

Jambes (Legs)

Presse :
• 02/01/2026 : 100kg x 10 | 100kg x 9
• 06/01/2026 : 100kg x 11 | 100kg x 10
`

const store = () => useWorkoutStore.getState()
const saved = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')

/** Faux Gemini : renvoie un plan pour l'exercice cité dans la demande et note la section demandée. */
function stubGemini() {
  const asked: string[] = []
  const mock = vi.fn(async (_url: string, init: RequestInit) => {
    const prompt: string = JSON.parse(init.body as string).contents[0].parts[0].text
    const isUp = prompt.includes('ex-tirage-vertical')
    asked.push(isUp ? 'up' : 'legs')
    const weight = isUp ? 52.5 : 105
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    summary_lines: ['Plan du coach.'],
                    exercises: [
                      {
                        exercise_id: isUp ? 'ex-tirage-vertical' : 'ex-presse',
                        rest_seconds: 120,
                        tip: 'Amplitude complète.',
                        sets: [
                          { weight, reps_min: 8, reps_max: 12, target_reps: 9, is_warmup: false },
                          { weight, reps_min: 8, reps_max: 12, target_reps: 8, is_warmup: false },
                        ],
                      },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      }),
    }
  })
  vi.stubGlobal('fetch', mock)
  return { mock, asked }
}

const bothPlansFromAi = () => {
  expect(store().coachPlans.up.source).toBe('gemini')
  expect(store().coachPlans.legs.source).toBe('gemini')
  expect(store().aiLoading).toBe(false)
}

afterEach(async () => {
  store().exitSimulation()
  await vi.waitFor(() => expect(store().aiLoading).toBe(false))
  vi.unstubAllGlobals()
  localStorage.removeItem(STORAGE_KEY)
  store().updateSettings({ apiKey: '', geminiModel: '' })
  store().resetToDefaultNotepad()
  resetGeminiClientState()
})

describe('mode test', () => {
  it('rejoue une séance entière avec de vraies demandes à l’IA, sans rien enregistrer', async () => {
    await store().importNotepadSmart(NOTEPAD)
    store().updateSettings({ apiKey: KEY })
    const realExercises = store().exercises
    const savedBefore = saved().state.exercises
    const { asked } = stubGemini()

    store().startSimulation()

    // La séance du jour (Haut, car la dernière date est Jambes) passe en premier, l'autre suit en arrière-plan.
    expect(store().simulation).not.toBeNull()
    expect(store().activeDraft.section).toBe('up')
    await vi.waitFor(bothPlansFromAi)
    expect(asked).toEqual(['up', 'legs'])

    store().simulateWholeSession()
    expect(store().sessionPhase).toBe('done')

    const summary = store().saveCompletedWorkout()
    expect(summary).toMatchObject({ validatedSets: 2, nextRecommended: 'legs', nextAlreadyGenerated: true })
    expect(store().completedSessions).toHaveLength(1)
    expect(store().activeDraft.section).toBe('legs')

    // La séance qui vient d'être faite est recalculée en arrière-plan pour la fois d'après.
    await vi.waitFor(() => {
      expect(asked).toEqual(['up', 'legs', 'up'])
      bothPlansFromAi()
    })

    // Rien de simulé n'a atteint le stockage du navigateur.
    expect(saved().version).toBe(SCHEMA_VERSION)
    expect(saved().state.completedSessions).toHaveLength(0)
    expect(saved().state.exercises).toEqual(savedBefore)

    store().exitSimulation()
    expect(store().simulation).toBeNull()
    expect(store().completedSessions).toHaveLength(0)
    expect(store().exercises).toBe(realExercises)
    expect(store().sessionPhase).toBe('idle')
  })

  it('ne fait rien hors du mode test', () => {
    store().simulateNextStep()
    store().simulateWholeSession()
    expect(store().sessionPhase).toBe('idle')
    expect(store().simulation).toBeNull()
  })
})

describe('choix du modèle', () => {
  it('abandonne un ancien modèle imposé, garde un modèle choisi à la main', async () => {
    const persist = (settings: object) =>
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { settings }, version: SCHEMA_VERSION }))

    persist({ apiKey: KEY, geminiModel: 'gemini-3.8-flash' })
    await useWorkoutStore.persist.rehydrate()
    expect(store().settings.geminiModel).toBe('gemini-2.5-flash')
    expect(getGeminiConfig().model).toBe('gemini-2.5-flash')

    persist({ apiKey: KEY, geminiModel: 'gemini-2.5-pro', geminiModelChosen: true, geminiChannel: 'ai_studio' })
    await useWorkoutStore.persist.rehydrate()
    expect(store().settings.geminiModel).toBe('gemini-2.5-pro')
    expect(getGeminiConfig()).toMatchObject({ model: 'gemini-2.5-pro', channel: 'ai_studio' })

    store().updateSettings({ geminiModel: '  ' })
    expect(store().settings).toMatchObject({ geminiModel: 'gemini-2.5-flash', geminiModelChosen: false })
  })
})
