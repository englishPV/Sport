import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { resetGeminiClientState } from './core/gemini'
import { STORAGE_KEY, useWorkoutStore } from './store/useWorkoutStore'

/**
 * Le contrat que l'utilisateur attend : une clé neuve ne doit PAS brûler
 * plusieurs requêtes au premier lancement. Une seule séance est demandée,
 * et « Tester la clé » ne compte pas dans le quota.
 */

const KEY = 'AQ.TestVertexExpressDummyKey0000'

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

/** Faux Gemini : compte les vraies générations, répond un plan plausible. */
function stubGemini() {
  const prompts: string[] = []
  const mock = vi.fn(async (url: string, init: RequestInit) => {
    if (String(url).includes('/models?')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
          ],
        }),
      }
    }
    const prompt: string = JSON.parse(String(init.body)).contents[0].parts[0].text
    prompts.push(prompt)
    const isUp = prompt.includes("Haut du corps (Up)")
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
                    summary_lines: ['ok'],
                    exercises: [
                      {
                        exercise_id: isUp ? 'ex-tirage-vertical' : 'ex-presse',
                        rest_seconds: 120,
                        tip: 'ok',
                        sets: [
                          {
                            weight: isUp ? 52.5 : 105,
                            reps_min: 8,
                            reps_max: 12,
                            target_reps: 9,
                            is_warmup: false,
                          },
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
  return { mock, prompts }
}

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }))
  localStorage.removeItem(STORAGE_KEY)
  store().resetToDefaultNotepad()
  await store().importNotepadSmart(NOTEPAD)
  store().updateSettings({ apiKey: '' })
  useWorkoutStore.setState({ aiError: null, aiErrorSection: null })
  resetGeminiClientState()
  await new Promise((resolve) => setTimeout(resolve, 20))
})

afterEach(async () => {
  // Laisse la file de l'application (module-level) se vider avant de retirer les faux fetch.
  await new Promise((resolve) => setTimeout(resolve, 20))
  cleanup()
  vi.unstubAllGlobals()
  resetGeminiClientState()
  localStorage.removeItem(STORAGE_KEY)
  store().resetToDefaultNotepad()
})

describe('budget de requêtes IA sur une clé neuve', () => {
  it('une clé neuve + un premier lancement = au plus UNE génération', async () => {
    // Clé déjà enregistrée (comme au rechargement de la page) : premier lancement.
    store().updateSettings({ apiKey: KEY })
    const { prompts } = stubGemini()

    render(<App />)

    await waitFor(() => expect(prompts.length).toBe(1))
    // Laisse largement le temps à un éventuel second envoi (l'ancien code pré-générait l'autre séance).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60))
    })

    expect(prompts).toHaveLength(1)
    // Une seule requête, et c'est bien la séance affichée (Haut) qui est demandée.
    expect(prompts[0]).toContain("séance déjà choisie par l'application : Haut du corps (Up)")
    expect(store().getAiCallLog()).toHaveLength(1)
  })

  it('« Tester la clé » ne consomme aucune requête du quota, et une seule génération suit', async () => {
    const user = userEvent.setup()
    store().updateSettings({ apiKey: KEY })
    const { prompts } = stubGemini()

    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Réglages' }))
    const testButton = screen.getByRole('button', { name: 'Tester la clé' })
    await user.click(testButton)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Clé valide'))
    expect(screen.getByRole('status')).toHaveTextContent('0 requête du quota')
    await waitFor(() => expect(prompts.length).toBe(1))

    // Le test de clé lui-même n'a envoyé aucune génération ; seule la séance affichée en envoie une.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60))
    })
    expect(prompts).toHaveLength(1)
  }, 20_000)

  it('« Commencer » pendant la préparation ne paie pas une seconde requête', async () => {
    const user = userEvent.setup()
    store().updateSettings({ apiKey: KEY })

    // Première génération qui ne répond pas tout de suite.
    let release!: (value: unknown) => void
    const prompts: string[] = []
    const planResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    summary_lines: [],
                    exercises: [
                      {
                        exercise_id: 'ex-tirage-vertical',
                        rest_seconds: 120,
                        tip: 'ok',
                        sets: [
                          { weight: 52.5, reps_min: 8, reps_max: 12, target_reps: 9, is_warmup: false },
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const prompt: string = JSON.parse(String(init.body)).contents[0].parts[0].text
        prompts.push(prompt)
        return new Promise((resolve) => {
          release = resolve
        })
      }),
    )

    render(<App />)

    // Le premier lancement demande déjà la séance affichée.
    await waitFor(() => expect(prompts).toHaveLength(1))

    await user.click(screen.getByRole('button', { name: 'Commencer' }))
    expect(useWorkoutStore.getState().workoutStarting).toBe(true)
    expect(prompts).toHaveLength(1)

    await act(async () => {
      release(planResponse)
    })
    await waitFor(() => expect(useWorkoutStore.getState().sessionPhase).toBe('working'))
    // Toujours une seule requête pour cette séance.
    expect(prompts).toHaveLength(1)
  }, 20_000)
})
