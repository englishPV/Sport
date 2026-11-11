import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  configureGemini,
  GeminiError,
  generateJson,
  isSupportedGeminiModel,
  resetGeminiClientState,
  sanitizeApiKey,
  testGeminiConnection,
} from './gemini'

const AQ_KEY = 'AQ.DummyKeyForTests000000000000000'
const AI_STUDIO = 'generativelanguage.googleapis.com'
const VERTEX = 'aiplatform.googleapis.com'

const ok = (text = '{"status":"ok"}') => ({
  ok: true,
  status: 200,
  json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
})

const fail = (status: number, message: string, details: object[] = []) => ({
  ok: false,
  status,
  json: async () => ({ error: { code: status, message, details } }),
})

const modelList = (names: string[]) => ({
  ok: true,
  status: 200,
  json: async () => ({
    models: names.map((name) => ({
      name: `models/${name}`,
      supportedGenerationMethods: ['generateContent'],
    })),
  }),
})

const isList = (url: string) => url.includes('/models?')

function stubFetch(handler: (url: string, init: RequestInit) => unknown) {
  const mock = vi.fn(async (url: string, init: RequestInit) => handler(String(url), init))
  vi.stubGlobal('fetch', mock)
  return mock
}

const generationUrls = (mock: ReturnType<typeof stubFetch>): string[] =>
  mock.mock.calls.map((call) => String(call[0])).filter((url) => !isList(url))

/** Requête qui ne répond jamais, mais respecte l'annulation. */
const hang = (init: RequestInit) =>
  new Promise((_, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
  })

afterEach(() => {
  resetGeminiClientState()
  vi.unstubAllGlobals()
})

describe('client Gemini', () => {
  it('envoie une clé AQ. sur AI Studio, dans un en-tête, avec gemini-3.8-flash en réflexion HIGH', async () => {
    const mock = stubFetch(() => ok('{"a":1}'))

    const res = await generateJson({ apiKey: `  ${AQ_KEY}\n`, prompt: 'p' })

    expect(res).toMatchObject({ text: '{"a":1}', model: 'gemini-3.8-flash', channel: 'ai_studio' })
    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`https://${AI_STUDIO}/v1beta/models/gemini-3.8-flash:generateContent`)
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(AQ_KEY)
    expect(JSON.parse(init.body as string).generationConfig).toEqual({
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingLevel: 'HIGH' },
    })
  })

  it('retire thinkingLevel si le point d’accès le refuse, et n’envoie rien de tel aux modèles 2.x', async () => {
    const mock = stubFetch((_url, init) =>
      JSON.parse(init?.body as string).generationConfig.thinkingConfig
        ? fail(400, 'Invalid JSON payload received. Unknown name "thinkingLevel" at generation_config.thinking_config')
        : ok(),
    )

    const res = await generateJson({ apiKey: AQ_KEY, prompt: 'p' })
    expect(res.model).toBe('gemini-3.8-flash')
    const bodies = mock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string).generationConfig)
    expect(bodies[0].thinkingConfig).toEqual({ thinkingLevel: 'HIGH' })
    expect(bodies[1].thinkingConfig).toBeUndefined()

    configureGemini({ model: 'gemini-2.5-flash' })
    await generateJson({ apiKey: AQ_KEY, prompt: 'p' })
    const last = mock.mock.calls.at(-1) as [string, RequestInit]
    expect(JSON.parse(last[1].body as string).generationConfig.thinkingConfig).toBeUndefined()
  })

  it('passe sur Vertex quand AI Studio refuse la clé, puis retient ce canal', async () => {
    const mock = stubFetch((url) =>
      url.includes(AI_STUDIO)
        ? fail(400, 'API key not valid. Please pass a valid API key.', [{ reason: 'API_KEY_INVALID' }])
        : ok(),
    )

    await generateJson({ apiKey: AQ_KEY, prompt: 'p' })
    await generateJson({ apiKey: AQ_KEY, prompt: 'p' })

    expect(generationUrls(mock).map((url) => url.includes(VERTEX))).toEqual([false, true, true])
  })

  it('réessaie une surcharge passagère sans changer de modèle', async () => {
    let calls = 0
    const mock = stubFetch(() => {
      calls += 1
      return calls < 3 ? fail(503, 'The model is overloaded.') : ok()
    })

    const res = await generateJson({ apiKey: AQ_KEY, prompt: 'p' })

    expect(res.model).toBe('gemini-3.8-flash')
    expect(mock).toHaveBeenCalledTimes(3)
  })

  it('ne bascule jamais sur un autre modèle, même quand gemini-3.8-flash ne répond pas', async () => {
    configureGemini({ model: 'gemini-3.8-flash' })
    const mock = stubFetch((_url, init) => hang(init))

    const err = await generateJson({ apiKey: AQ_KEY, prompt: 'p', timeoutMs: 20 }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(GeminiError)
    expect((err as GeminiError).kind).toBe('timeout')
    expect((err as GeminiError).message).toContain('gemini-3.8-flash')
    // Une seule tentative, sur le même modèle : jamais un autre modèle en secours.
    const urls = generationUrls(mock)
    expect(urls).not.toHaveLength(0)
    expect(urls.every((url) => url.includes('gemini-3.8-flash:generateContent'))).toBe(true)
    expect(urls.some((url) => /gemini-(1|2)\./.test(url))).toBe(false)
  })

  it('ne rabat jamais une surcharge sur un modèle 2.x', async () => {
    configureGemini({ model: 'gemini-3.8-flash' })
    const mock = stubFetch(() => fail(503, 'The model is overloaded.'))

    const err = await generateJson({ apiKey: AQ_KEY, prompt: 'p' }).catch((e: unknown) => e)

    expect((err as GeminiError).kind).toBe('overloaded')
    const urls = generationUrls(mock)
    expect(urls.some((url) => url.includes('gemini-2.5'))).toBe(false)
  })

  it('explique chaque refus en clair, sans jamais afficher la clé', async () => {
    const cases: [number, string, object[], string][] = [
      [400, 'API key not valid. Please pass a valid API key.', [{ reason: 'API_KEY_INVALID' }], 'key_invalid'],
      [403, 'Requests from referer https://x are blocked.', [{ reason: 'API_KEY_HTTP_REFERRER_BLOCKED' }], 'referrer'],
      [403, 'Generative Language API has not been used in project 1 before or it is disabled.', [{ reason: 'SERVICE_DISABLED' }], 'api_disabled'],
      [404, 'models/x is not found for API version v1beta', [], 'model_not_found'],
      [429, 'You exceeded your current quota, limit: 0', [], 'quota'],
      [400, 'Invalid JSON payload received.', [], 'bad_request'],
    ]

    for (const [status, message, details, kind] of cases) {
      resetGeminiClientState()
      stubFetch(() => fail(status, message, details))
      const err = await generateJson({ apiKey: AQ_KEY, prompt: 'p' }).catch((e: unknown) => e)

      expect(err).toBeInstanceOf(GeminiError)
      expect((err as GeminiError).kind).toBe(kind)
      expect((err as GeminiError).message).not.toContain(AQ_KEY)
    }
  })

  it('nettoie une clé collée avec son nom de variable, des guillemets ou des espaces', () => {
    expect(sanitizeApiKey('  GEMINI_API_KEY="AIzaSyExampleKey123"\n')).toBe('AIzaSyExampleKey123')
    expect(sanitizeApiKey('Bearer AQ.abc\u200B def')).toBe('AQ.abcdef')
    expect(sanitizeApiKey('')).toBe('')
  })
})

describe('bouton « Tester la clé »', () => {
  it('confirme la connexion et liste les modèles texte ouverts à la clé', async () => {
    stubFetch((url) =>
      isList(url)
        ? modelList(['gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-preview-tts', 'text-embedding-004'])
        : ok(),
    )

    const res = await testGeminiConnection(AQ_KEY)

    expect(res.ok).toBe(true)
    expect(res.message).toContain('gemini-3.8-flash · HIGH')
    expect(res.models).toEqual(['gemini-2.5-flash', 'gemini-3.8-flash'])
    // La liste est brute ; l'écran Réglages ne garde que les 3.8+ (voir isSupportedGeminiModel).
    expect(res.models?.filter(isSupportedGeminiModel)).toEqual(['gemini-3.8-flash'])
  })

  it('n’essaie et ne propose aucun autre modèle quand gemini-3.8-flash est saturé', async () => {
    configureGemini({ model: 'gemini-3.8-flash' })
    const mock = stubFetch((url) => {
      if (isList(url)) return modelList(['gemini-3.8-flash'])
      return fail(503, 'The model is overloaded.')
    })

    const res = await testGeminiConnection(AQ_KEY)

    expect(res).toMatchObject({ ok: false, kind: 'overloaded' })
    expect(res.message).toContain('gemini-3.8-flash')
    expect(generationUrls(mock).every((url) => url.includes('gemini-3.8-flash:generateContent'))).toBe(true)
  })

  it('laisse sa chance au modèle lent : un délai de test plus long qu’un cycle de réflexion HIGH', async () => {
    configureGemini({ model: 'gemini-3.8-flash' })
    let calls = 0
    stubFetch((url) => {
      if (isList(url)) return modelList(['gemini-3.8-flash'])
      calls += 1
      return calls === 1 ? fail(504, 'Deadline exceeded.') : ok()
    })

    const res = await testGeminiConnection(AQ_KEY)

    expect(res.ok).toBe(true)
    expect(res.message).toContain('gemini-3.8-flash · HIGH')
  })

  it('rend un message clair, sans exception, quand rien ne répond', async () => {
    stubFetch(() => {
      throw new TypeError('Failed to fetch')
    })

    const res = await testGeminiConnection(AQ_KEY)

    expect(res.ok).toBe(false)
    expect(res.kind).toBe('network')
    expect(res.models).toBeUndefined()
    expect((await testGeminiConnection('  ')).kind).toBe('missing_key')
  })
})
