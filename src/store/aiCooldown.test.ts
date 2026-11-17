import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetGeminiClientState } from '../core/gemini'
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

const quotaExceeded = () => ({
  ok: false,
  status: 429,
  json: async () => ({
    error: { code: 429, message: 'You exceeded your current quota, please check your plan and billing details.' },
  }),
})

/** Refus immédiat, jamais réessayé automatiquement : une seule requête consommée. */
const refused = () => ({
  ok: false,
  status: 400,
  json: async () => ({ error: { code: 400, message: 'Invalid JSON payload received.' } }),
})

const okPlan = (isUp: boolean) => ({
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
                      { weight: isUp ? 52.5 : 105, reps_min: 8, reps_max: 12, target_reps: 9, is_warmup: false },
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
})

/** Compte les appels réseau réellement envoyés à Gemini. */
function stubFetch(handler: (prompt: string) => unknown) {
  const mock = vi.fn(async (_url: string, init: RequestInit) => {
    const prompt: string = JSON.parse(init.body as string).contents[0].parts[0].text
    return handler(prompt)
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

const requestCount = (mock: ReturnType<typeof stubFetch>) => mock.mock.calls.length

async function prepareStoreWithKey() {
  await store().importNotepadSmart(NOTEPAD)
  store().updateSettings({ apiKey: KEY })
}

afterEach(async () => {
  await vi.waitFor(() => expect(store().aiLoading).toBe(false))
  vi.unstubAllGlobals()
  localStorage.removeItem(STORAGE_KEY)
  store().updateSettings({ apiKey: '', geminiModel: '' })
  store().resetToDefaultNotepad()
  resetGeminiClientState()
})

describe('anti-spam des demandes IA', () => {
  it('après un quota épuisé, les déclencheurs automatiques ne relancent rien pendant le délai', async () => {
    await prepareStoreWithKey()
    const mock = stubFetch(() => quotaExceeded())

    await store().ensureSessionPlansGenerated('up')
    // Une seule séance demandée à la fois : une tentative, un échec, une requête consommée.
    expect(requestCount(mock)).toBe(1)
    expect(store().aiError).toContain('Quota')

    // Clics suivants (changement de section, retour des réglages…) : aucune requête de plus.
    await store().ensureSessionPlansGenerated('up')
    await store().ensureSessionPlansGenerated('legs')
    expect(requestCount(mock)).toBe(1)
  })

  it('garde visible l’échec d’une section même si l’autre séance est générée avec succès', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-10T10:00:00Z'))
    await prepareStoreWithKey()
    const mock = stubFetch((prompt) =>
      prompt.includes('Haut du corps (Up)') ? refused() : okPlan(false),
    )

    // Chaque section est demandée séparément (jamais les deux d'un coup).
    await store().ensureSessionPlansGenerated('up')
    expect(requestCount(mock)).toBe(1)
    expect(store().aiError).toContain('Requête refusée')
    expect(store().aiErrorSection).toBe('up')

    await store().ensureSessionPlansGenerated('legs')
    expect(requestCount(mock)).toBe(2)
    expect(store().coachPlans.legs.source).toBe('gemini')
    // L'échec de Haut reste affiché, il n'est pas effacé par le succès de Jambes.
    expect(store().aiError).toContain('Requête refusée')
    expect(store().aiErrorSection).toBe('up')
  })

  it('un quota journalier épuisé arrête TOUT : l’autre section ne consomme pas une requête de plus', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-10T10:00:00Z'))
    await prepareStoreWithKey()
    const mock = stubFetch(() => quotaExceeded())

    await store().ensureSessionPlansGenerated('up')
    expect(requestCount(mock)).toBe(1)

    await store().ensureSessionPlansGenerated('legs')
    await store().refreshAiStats(true)
    expect(requestCount(mock)).toBe(1)
    expect(store().coachPlans.legs.source).toBe('ddp')

    // Une relance explicite ne part pas non plus, mais elle dit pourquoi clairement.
    await store().ensureSessionPlansGenerated('legs', { force: true })
    expect(requestCount(mock)).toBe(1)
    expect(store().aiError).toContain('journalier épuisé')
    expect(store().aiError).toContain('Change de clé')
  })

  it('un « Réessayer » explicite repart tout de suite après un échec passager', async () => {
    await prepareStoreWithKey()
    const mock = stubFetch(() => refused())

    await store().ensureSessionPlansGenerated('up')
    expect(requestCount(mock)).toBe(1)

    // Le délai de 60 s empêche les relances automatiques, pas une action explicite.
    await store().ensureSessionPlansGenerated('up')
    expect(requestCount(mock)).toBe(1)

    await store().ensureSessionPlansGenerated('up', { force: true })
    expect(requestCount(mock)).toBe(2)
  })

  it('une génération réussie lève le délai pour de bon', async () => {
    await prepareStoreWithKey()
    let failing = true
    const mock = stubFetch((prompt) => {
      if (failing) return refused()
      return okPlan(prompt.includes('ex-tirage-vertical'))
    })

    await store().ensureSessionPlansGenerated('up')
    expect(store().aiError).toContain('Requête refusée')

    failing = false
    await store().ensureSessionPlansGenerated('up', { force: true })
    expect(store().aiError).toBeNull()
    expect(store().coachPlans.up.source).toBe('gemini')

    // Le plan est frais : plus aucune requête n'est nécessaire.
    const afterSuccess = requestCount(mock)
    await store().ensureSessionPlansGenerated('up')
    expect(requestCount(mock)).toBe(afterSuccess)
  })
})
