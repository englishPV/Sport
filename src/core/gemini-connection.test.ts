import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  configureGemini,
  GeminiError,
  generateJson,
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
  it('envoie une clé AQ. sur AI Studio, dans un en-tête, sans réglage de réflexion', async () => {
    const mock = stubFetch(() => ok('{"a":1}'))

    const res = await generateJson({ apiKey: `  ${AQ_KEY}\n`, prompt: 'p' })

    expect(res).toMatchObject({ text: '{"a":1}', model: 'gemini-2.5-flash', channel: 'ai_studio' })
    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`https://${AI_STUDIO}/v1beta/models/gemini-2.5-flash:generateContent`)
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(AQ_KEY)
    expect(JSON.parse(init.body as string).generationConfig).toEqual({
      responseMimeType: 'application/json',
    })
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

    expect(res.model).toBe('gemini-2.5-flash')
    expect(mock).toHaveBeenCalledTimes(3)
  })

  it('se rabat sur le modèle de secours quand le modèle choisi ne répond pas', async () => {
    configureGemini({ model: 'gemini-3.8-flash' })
    const mock = stubFetch((url, init) => (url.includes('gemini-3.8-flash') ? hang(init) : ok()))

    const res = await generateJson({ apiKey: AQ_KEY, prompt: 'p', timeoutMs: 20 })

    expect(res.model).toBe('gemini-2.5-flash')
    expect(generationUrls(mock).at(-1)).toContain('gemini-2.5-flash:generateContent')
  })

  it('signale un délai dépassé quand le secours est désactivé', async () => {
    configureGemini({ model: 'gemini-3.8-flash' })
    stubFetch((_url, init) => hang(init))

    const err = await generateJson({
      apiKey: AQ_KEY,
      prompt: 'p',
      timeoutMs: 20,
      allowModelFallback: false,
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(GeminiError)
    expect((err as GeminiError).kind).toBe('timeout')
    expect((err as GeminiError).message).toContain('gemini-3.8-flash')
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
      const err = await generateJson({
        apiKey: AQ_KEY,
        prompt: 'p',
        allowModelFallback: false,
      }).catch((e: unknown) => e)

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
  it('confirme la connexion et liste les modèles texte disponibles', async () => {
    stubFetch((url) =>
      isList(url)
        ? modelList(['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-preview-tts', 'text-embedding-004'])
        : ok(),
    )

    const res = await testGeminiConnection(AQ_KEY)

    expect(res.ok).toBe(true)
    expect(res.message).toContain('gemini-2.5-flash')
    expect(res.models).toEqual(['gemini-2.5-flash', 'gemini-2.5-pro'])
  })

  it('propose le modèle de secours quand celui choisi est saturé', async () => {
    configureGemini({ model: 'gemini-3.8-flash' })
    stubFetch((url) => {
      if (isList(url)) return modelList(['gemini-2.5-flash'])
      return url.includes('gemini-3.8-flash') ? fail(503, 'The model is overloaded.') : ok()
    })

    const res = await testGeminiConnection(AQ_KEY)

    expect(res).toMatchObject({ ok: false, kind: 'overloaded', suggestedModel: 'gemini-2.5-flash' })
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
