import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GeminiError,
  callGemini,
  describeGeminiError,
  stripMarkdownFences,
  type CallGeminiOptions,
} from './client'
import { parseCoachResponse } from './schema'
import { buildCoachInput, buildCoachPrompt, computeInputHash, type CoachInput } from './prompts'
import type { Session } from '../types'

const PROMPT = 'Donne un plan.'
const SCHEMA = { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } }, required: ['ok'] }

function geminiResponse(text: string): Response {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

function statusResponse(status: number): Response {
  return new Response(JSON.stringify({ error: { message: 'nope' } }), { status })
}

function makeOptions(overrides: Partial<CallGeminiOptions> = {}): CallGeminiOptions {
  return {
    apiKey: 'ma-cle-secrete',
    model: 'gemini-3.8-flash',
    prompt: PROMPT,
    responseSchema: SCHEMA,
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('callGemini', () => {
  it('envoie la requête avec la clé dans l’en-tête et le raisonnement high', async () => {
    const fetchMock = vi.fn().mockResolvedValue(geminiResponse('{"ok":true}'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await callGemini(makeOptions())

    expect(result).toBe('{"ok":true}')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
    )
    expect(url).not.toContain('ma-cle-secrete')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['x-goog-api-key']).toBe('ma-cle-secrete')
    expect(headers['Content-Type']).toBe('application/json')

    const body = JSON.parse(String(init.body)) as {
      contents: { role: string; parts: { text: string }[] }[]
      generationConfig: Record<string, unknown>
    }
    expect(body.contents[0].role).toBe('user')
    expect(body.contents[0].parts[0].text).toBe(PROMPT)
    expect(body.generationConfig.responseMimeType).toBe('application/json')
    expect(body.generationConfig.responseSchema).toEqual(SCHEMA)
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'high' })
    // Gemini 3 refuse les paramètres d'échantillonnage historiques.
    expect(body.generationConfig.temperature).toBeUndefined()
  })

  it('conserve temperature pour les modèles plus anciens', async () => {
    const fetchMock = vi.fn().mockResolvedValue(geminiResponse('{}'))
    vi.stubGlobal('fetch', fetchMock)
    await callGemini(makeOptions({ model: 'gemini-2.0-flash' }))
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as { generationConfig: Record<string, unknown> }
    expect(body.generationConfig.temperature).toBe(0.4)
    expect(body.generationConfig.thinkingConfig).toBeUndefined()
  })

  it('signale une clé invalide sans retry', async () => {
    const fetchMock = vi.fn().mockResolvedValue(statusResponse(401))
    vi.stubGlobal('fetch', fetchMock)

    await expect(callGemini(makeOptions())).rejects.toMatchObject({ code: 'invalid_key' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('signale un modèle inexistant (404)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(statusResponse(404)))
    await expect(callGemini(makeOptions())).rejects.toMatchObject({ code: 'model_not_found' })
  })

  it('réessaie une fois après un 429', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(statusResponse(429))
      .mockResolvedValueOnce(geminiResponse('{"ok":true}'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await callGemini(makeOptions({ retryDelayMs: 0 }))
    expect(result).toBe('{"ok":true}')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('échoue après un second 429', async () => {
    const fetchMock = vi.fn().mockResolvedValue(statusResponse(429))
    vi.stubGlobal('fetch', fetchMock)

    await expect(callGemini(makeOptions({ retryDelayMs: 0 }))).rejects.toMatchObject({
      code: 'rate_limited',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('réessaie une fois sur erreur réseau', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(geminiResponse('{"ok":true}'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(callGemini(makeOptions({ retryDelayMs: 0 }))).resolves.toBe('{"ok":true}')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('abandonne après le délai imparti (timeout)', async () => {
    const fetchMock = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      callGemini(makeOptions({ timeoutMs: 5, retryDelayMs: 0 })),
    ).rejects.toMatchObject({ code: 'network' })
  })

  it('retire les fences markdown JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(geminiResponse('```json\n{"ok":true}\n```')),
    )
    await expect(callGemini(makeOptions())).resolves.toBe('{"ok":true}')
    expect(stripMarkdownFences('```\n{"a":1}\n```')).toBe('{"a":1}')
  })

  it('signale une réponse sans candidat', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })))
    await expect(callGemini(makeOptions())).rejects.toMatchObject({ code: 'empty_response' })
  })

  it('ignore les parties de réflexion et concatène le texte utile', async () => {
    const payload = {
      candidates: [
        {
          content: {
            parts: [
              { text: 'Je réfléchis…', thought: true },
              { text: '{"ok":' },
              { text: 'true}' },
            ],
          },
        },
      ],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload))))
    await expect(callGemini(makeOptions())).resolves.toBe('{"ok":true}')
  })

  it('décrit les erreurs en français', () => {
    expect(describeGeminiError(new GeminiError('invalid_key'))).toContain('Clé Gemini invalide')
    expect(describeGeminiError(new GeminiError('http', 500))).toContain('500')
    expect(describeGeminiError(new Error('x'))).toBe('Erreur inconnue.')
  })
})

describe('parseCoachResponse', () => {
  const knownExerciseIds = ['ex-1', 'ex-2']

  it('ignore les identifiants inconnus et borne les valeurs', () => {
    const raw = JSON.stringify({
      global_coach_note: 'Note du coach.',
      exercises_targets: [
        {
          exercise_id: 'ex-1',
          target_weight: 101.2,
          target_reps_min: 12,
          target_reps_max: 6,
          target_rest_seconds: 500,
          exercise_tip: 'Tip.',
        },
        {
          exercise_id: 'inconnu',
          target_weight: 80,
          target_reps_min: 8,
          target_reps_max: 10,
          target_rest_seconds: 90,
          exercise_tip: 'Ignore-moi.',
        },
      ],
    })
    const parsed = parseCoachResponse(raw, { knownExerciseIds, weightStep: 2.5 })
    expect(parsed.targets).toHaveLength(1)
    const [target] = parsed.targets
    expect(target.exerciseId).toBe('ex-1')
    expect(target.targetWeight).toBe(100)
    expect(target.targetRepsMin).toBe(6)
    expect(target.targetRepsMax).toBe(12)
    expect(target.targetRestSeconds).toBe(300)
  })

  it('borne les reps basses et hautes', () => {
    const raw = JSON.stringify({
      global_coach_note: '',
      exercises_targets: [
        {
          exercise_id: 'ex-2',
          target_weight: -5,
          target_reps_min: 0,
          target_reps_max: 99,
          target_rest_seconds: 10,
          exercise_tip: 'x'.repeat(500),
        },
      ],
    })
    const parsed = parseCoachResponse(raw, { knownExerciseIds, weightStep: 2.5 })
    expect(parsed.targets[0].targetWeight).toBe(0)
    expect(parsed.targets[0].targetRepsMin).toBe(1)
    expect(parsed.targets[0].targetRepsMax).toBe(30)
    expect(parsed.targets[0].targetRestSeconds).toBe(30)
    expect(parsed.targets[0].tip.length).toBe(200)
  })

  it('rejette un JSON invalide ou un schéma non conforme', () => {
    expect(() => parseCoachResponse('pas du json', { knownExerciseIds, weightStep: 2.5 })).toThrow(
      GeminiError,
    )
    expect(() =>
      parseCoachResponse(JSON.stringify({ global_coach_note: 1 }), {
        knownExerciseIds,
        weightStep: 2.5,
      }),
    ).toThrow(GeminiError)
  })
})

describe('prompt et hash', () => {
  const session: Session = {
    id: 's1',
    sessionTypeId: 'type-1',
    date: '2026-10-24',
    startedAt: null,
    endedAt: null,
    status: 'planned',
    exercises: [{ exerciseId: 'ex-1', sets: [], note: '' }],
    coachPlan: null,
    source: 'app',
  }

  const input: CoachInput = buildCoachInput({
    session,
    sessionTypeName: 'HAUT',
    exercises: [
      {
        id: 'ex-1',
        name: 'Développé couché',
        normalizedName: 'developpe couche',
        unit: 'kg',
        defaultRestSeconds: 90,
      },
    ],
    sessions: [],
    weightStep: 2.5,
  })

  it('construit un prompt français structuré', () => {
    const prompt = buildCoachPrompt(input)
    expect(prompt).toContain('Tu es un coach de musculation')
    expect(prompt).toContain('+2.5 kg')
    expect(prompt).toContain('Séance : HAUT')
    expect(prompt).toContain('"id":"ex-1"')
    expect(prompt).toContain('Utilise exactement les exercise_id fournis.')
  })

  it('hash déterministe et sensible au modèle', async () => {
    const first = await computeInputHash(input, 'gemini-3.8-flash')
    const second = await computeInputHash(input, 'gemini-3.8-flash')
    const other = await computeInputHash(input, 'autre-modele')
    expect(first).toBe(second)
    expect(first).not.toBe(other)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
  })
})
