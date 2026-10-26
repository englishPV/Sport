import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetGeminiClientState, testGeminiConnection } from './gemini'

const TEST_KEY = 'AIzaSyResilienceDummyKey000000000000000000'

const okResponse = () => ({
  ok: true,
  status: 200,
  json: async () => ({
    candidates: [{ content: { parts: [{ text: '{"status":"ok"}' }] } }],
  }),
})

const errorResponse = (status: number, message: string) => ({
  ok: false,
  status,
  json: async () => ({ error: { message, details: [{ reason: 'ERROR' }] } }),
})

const calledUrls = (fetchMock: ReturnType<typeof vi.fn>): string[] =>
  fetchMock.mock.calls.map((call) => String(call[0]))

afterEach(() => {
  resetGeminiClientState()
  vi.unstubAllGlobals()
})

describe('testGeminiConnection — résilience du bouton "Tester"', () => {
  it('bascule sur un autre endpoint quand le premier est en surcharge 503 persistante', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      // Le premier endpoint (AI Studio v1beta) répond 503 en continu, les autres vont bien.
      if (url.includes('generativelanguage.googleapis.com/v1beta/models/')) {
        return errorResponse(503, 'Service overloaded')
      }
      return okResponse()
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await testGeminiConnection(TEST_KEY)

    expect(res.ok).toBe(true)
    const urls = calledUrls(fetchMock)
    // Plusieurs tentatives ont eu lieu avant de basculer, et une route saine a fini par répondre.
    expect(urls.length).toBeGreaterThan(1)
    expect(urls.some((u) => u.includes('/v1alpha/') || u.includes('aiplatform'))).toBe(true)
  })

  it('poursuit sur les routes candidates après une coupure réseau / timeout au lieu d\u2019échouer immédiatement', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      // AI Studio injoignable (CORS, coupure ou abort), Vertex répond correctement.
      if (url.includes('generativelanguage.googleapis.com')) {
        throw new TypeError('Failed to fetch')
      }
      return okResponse()
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await testGeminiConnection(TEST_KEY)

    expect(res.ok).toBe(true)
    expect(calledUrls(fetchMock).some((u) => u.includes('aiplatform.googleapis.com'))).toBe(true)
  })

  it('continue les autres routes quand une clé essuie un 429 de quota (hors limit: 0) persistant', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('generativelanguage.googleapis.com/v1beta/models/')) {
        return errorResponse(429, 'Resource exhausted: rate limit exceeded')
      }
      return okResponse()
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await testGeminiConnection(TEST_KEY)

    expect(res.ok).toBe(true)
    expect(calledUrls(fetchMock).length).toBeGreaterThan(1)
  })

  it('renvoie une erreur aimable (sans exception) quand toutes les routes échouent, après avoir tout tenté', async () => {
    const fetchMock = vi.fn(async () => errorResponse(503, 'Service overloaded'))
    vi.stubGlobal('fetch', fetchMock)

    const res = await testGeminiConnection(TEST_KEY)

    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/503/)
    // Le test ne doit pas abandonner à la première route : les 4 endpoints (dont Vertex)
    // et les 2 modes d'auth sont épuisés avant de rendre une erreur aimable.
    const urls = calledUrls(fetchMock)
    expect(urls.some((u) => u.includes('aiplatform.googleapis.com'))).toBe(true)
    expect(urls.some((u) => u.includes('/v1alpha/'))).toBe(true)
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(8)
  })
})
