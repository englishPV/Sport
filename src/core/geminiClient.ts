/**
 * Client Gemini (transport uniquement) : clé, canal, modèle, file d'attente,
 * reprises, délais et diagnostic d'erreur lisible. Aucune logique métier ici.
 */

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash'
/**
 * Seuls les modèles 3.8+ sont utilisés et aucun repli automatique n'existe vers un autre
 * modèle (et surtout pas vers la série 2.x) : le modèle réglé est le seul interrogé.
 * Proposés tant que la liste réelle n'a pas été lue avec la clé.
 */
export const SUGGESTED_GEMINI_MODELS = ['gemini-3.8-flash']

/** Vrai pour `gemini-3.8-flash`, ses variantes (lite, preview…) et les versions ≥ 3.8. */
export function isSupportedGeminiModel(model: string): boolean {
  const m = /^gemini-(\d+)\.(\d+)/i.exec(model.trim())
  if (!m) return false
  const major = Number(m[1])
  const minor = Number(m[2])
  return major > 3 || (major === 3 && minor >= 8)
}

/**
 * Les modèles Gemini 3+ acceptent `thinkingLevel` : on demande HIGH (réflexion maximale).
 * Les 2.x gardent leur réflexion par défaut (ils refusent `thinkingLevel`).
 */
export function thinkingLevelFor(model: string): 'HIGH' | null {
  const m = /^gemini-(\d+)/i.exec(model.trim())
  return m && Number(m[1]) >= 3 ? 'HIGH' : null
}

export function modelLabel(model: string): string {
  return thinkingLevelFor(model) ? `${model} · HIGH` : model
}

/** Endpoint/modèle qui a refusé `thinkingConfig` : on ne le renvoie plus. */
const thinkingRejected = new Set<string>()

export type GeminiChannel = 'auto' | 'ai_studio' | 'vertex'
type ConcreteChannel = Exclude<GeminiChannel, 'auto'>
export type ApiProviderKind = 'vertex_express' | 'ai_studio'

export interface GeminiConfig {
  model: string
  channel: GeminiChannel
  /** Vide = adresse officielle du canal. */
  baseUrl: string
}

export type GeminiErrorKind =
  | 'missing_key'
  | 'key_invalid'
  | 'referrer'
  | 'api_disabled'
  | 'permission'
  | 'model_not_found'
  | 'quota'
  | 'rate_limited'
  | 'overloaded'
  | 'timeout'
  | 'network'
  | 'bad_request'
  | 'blocked'
  | 'empty'
  | 'cancelled'
  | 'unknown'

export class GeminiError extends Error {
  readonly kind: GeminiErrorKind
  readonly status: number | null
  /** Message brut de Google, utile pour le support. */
  readonly detail: string
  readonly retryAfterMs: number | null

  constructor(
    kind: GeminiErrorKind,
    message: string,
    extra: { status?: number | null; detail?: string; retryAfterMs?: number | null } = {},
  ) {
    super(message)
    this.name = 'GeminiError'
    this.kind = kind
    this.status = extra.status ?? null
    this.detail = extra.detail ?? ''
    this.retryAfterMs = extra.retryAfterMs ?? null
  }
}

const CHANNEL_BASE: Record<ConcreteChannel, string> = {
  ai_studio: 'https://generativelanguage.googleapis.com',
  vertex: 'https://aiplatform.googleapis.com',
}

export const CHANNEL_LABEL: Record<ConcreteChannel, string> = {
  ai_studio: 'Google AI Studio',
  vertex: 'Vertex AI Express',
}

/** La réflexion HIGH des modèles 3.x prend 2 à 4 min sur une séance complète (mesuré). */
const GENERATION_TIMEOUT_MS = 300_000
/**
 * Une requête aussi courte que le test de connexion part quand même en réflexion HIGH :
 * mesuré entre 30 s et 2 min selon la charge de Google. Un délai plus court faisait
 * échouer `gemini-3.8-flash` à tort et poussait l'app vers un autre modèle.
 */
const TEST_TIMEOUT_MS = 180_000
const LIST_TIMEOUT_MS = 15_000
const RETRY_DELAYS_MS = [1500, 4000]
const MAX_RETRY_WAIT_MS = 15_000

let config: GeminiConfig = { model: DEFAULT_GEMINI_MODEL, channel: 'auto', baseUrl: '' }
const workingChannelByRoute = new Map<string, ConcreteChannel>()

export function configureGemini(patch: Partial<GeminiConfig>): void {
  const model = (patch.model ?? config.model).trim() || DEFAULT_GEMINI_MODEL
  const channel = patch.channel ?? config.channel
  const baseUrl = (patch.baseUrl ?? config.baseUrl).trim()
  if (model !== config.model || channel !== config.channel || baseUrl !== config.baseUrl) {
    workingChannelByRoute.clear()
  }
  config = { model, channel, baseUrl }
}

export function getGeminiConfig(): GeminiConfig {
  return { ...config }
}

/* ------------------------------- Clé API --------------------------------- */

/**
 * Nettoie une clé collée : préfixes (`GEMINI_API_KEY=`, `Bearer`), guillemets,
 * espaces, retours à la ligne et caractères invisibles.
 */
export function sanitizeApiKey(rawKey: string): string {
  if (!rawKey) return ''
  let cleaned = rawKey.replace(/[\u200B-\u200D\uFEFF\u2060\u00A0]/g, '').trim()
  cleaned = cleaned.replace(
    /^(?:export\s+)?(?:VITE_GEMINI_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY|API_KEY|key)\s*[:=]\s*/i,
    '',
  )
  cleaned = cleaned.replace(/^Bearer\s+/i, '').trim()
  cleaned = cleaned.replace(/^["'`«“”]+|["'`»“”]+$/g, '').trim()
  return Array.from(cleaned.replace(/\s+/g, ''))
    .filter((ch) => {
      const code = ch.charCodeAt(0)
      return code > 31 && (code < 127 || code > 159)
    })
    .join('')
}

export function detectApiProvider(apiKey: string): { kind: ApiProviderKind; label: string } {
  const cleaned = sanitizeApiKey(apiKey)
  if (cleaned.startsWith('AQ.')) {
    return { kind: 'vertex_express', label: 'Clé au format AQ. (AI Studio ou Vertex Express)' }
  }
  return { kind: 'ai_studio', label: 'Clé Google AI Studio' }
}

/* ------------------------------ Adresses --------------------------------- */

export function buildEndpointUrl(
  channel: ConcreteChannel,
  model: string = config.model,
  baseUrl: string = config.baseUrl,
): string {
  const base = (baseUrl || CHANNEL_BASE[channel]).replace(/\/+$/, '')
  return channel === 'vertex'
    ? `${base}/v1/publishers/google/models/${model}:generateContent`
    : `${base}/v1beta/models/${model}:generateContent`
}

function candidateChannels(cleanKey: string, model: string): ConcreteChannel[] {
  if (config.channel !== 'auto') return [config.channel]
  if (config.baseUrl) return [/aiplatform/i.test(config.baseUrl) ? 'vertex' : 'ai_studio']
  const remembered = workingChannelByRoute.get(`${cleanKey}|${model}`)
  const order: ConcreteChannel[] = ['ai_studio', 'vertex']
  return remembered ? [remembered, ...order.filter((c) => c !== remembered)] : order
}

/* --------------------------- File d'attente ------------------------------ */

interface QueuedTask {
  run: () => Promise<unknown>
  tag: string
  /** Vrai quand les données ont changé depuis la mise en file : la requête ne doit pas partir. */
  isStale?: () => boolean
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}

let queueBusy = false
/** Incrémenté à chaque remise à zéro : une tâche d'une génération passée ne touche plus à la file. */
let queueGeneration = 0
const pendingQueue: QueuedTask[] = []

function drainQueue(): void {
  if (queueBusy) return
  // Une requête en file dont les données ont changé entre-temps ne consomme pas de quota :
  // elle est annulée avant même le premier appel réseau (la génération en cours, elle,
  // ne peut pas être interrompue proprement et son résultat est jeté par l'appelant).
  let task = pendingQueue.shift()
  while (task && task.isStale?.()) {
    task.reject(new GeminiError('cancelled', 'Requête annulée (données modifiées).'))
    task = pendingQueue.shift()
  }
  if (!task) return
  queueBusy = true
  const generation = queueGeneration
  task
    .run()
    .then(task.resolve, task.reject)
    .finally(() => {
      if (generation !== queueGeneration) return
      queueBusy = false
      drainQueue()
    })
}

/** Une seule requête à la fois : évite les 429 du palier gratuit. */
function enqueue<T>(
  run: () => Promise<T>,
  priority: 'high' | 'normal',
  tag = '',
  isStale?: () => boolean,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const task: QueuedTask = {
      run,
      tag,
      isStale,
      resolve: resolve as (v: unknown) => void,
      reject,
    }
    if (priority === 'high') pendingQueue.unshift(task)
    else pendingQueue.push(task)
    drainQueue()
  })
}

/** Annule les requêtes encore en file (pas celle en cours) portant ce tag. */
export function cancelQueuedGeminiRequests(tag: string): void {
  for (let i = pendingQueue.length - 1; i >= 0; i -= 1) {
    if (pendingQueue[i].tag !== tag) continue
    const [task] = pendingQueue.splice(i, 1)
    task.reject(new GeminiError('cancelled', 'Requête annulée.'))
  }
}

export function resetGeminiClientState(): void {
  queueGeneration += 1
  // Les requêtes en attente sont annulées proprement (jamais laissées sans réponse).
  const dropped = pendingQueue.splice(0, pendingQueue.length)
  for (const task of dropped) task.reject(new GeminiError('cancelled', 'Requête annulée.'))
  queueBusy = false
  workingChannelByRoute.clear()
  thinkingRejected.clear()
  config = { model: DEFAULT_GEMINI_MODEL, channel: 'auto', baseUrl: '' }
}

/* ----------------------------- Diagnostic -------------------------------- */

interface RawErrorPayload {
  error?: {
    code?: number
    message?: string
    status?: string
    details?: { reason?: string; retryDelay?: string }[]
  }
}

function currentOrigin(): string {
  return typeof window !== 'undefined' && window.location?.origin ? window.location.origin : ''
}

function seconds(ms: number): string {
  return String(Math.max(1, Math.round(ms / 1000)))
}

export function classifyHttpError(status: number, payload: unknown, model: string): GeminiError {
  const err = (payload as RawErrorPayload | null)?.error
  const detail = typeof err?.message === 'string' ? err.message : typeof payload === 'string' ? payload : ''
  const reasons = (err?.details ?? []).map((d) => d?.reason ?? '').join(' ')
  const blob = `${err?.status ?? ''} ${reasons} ${detail}`
  const retryRaw = (err?.details ?? []).find((d) => typeof d?.retryDelay === 'string')?.retryDelay
  const retryAfterMs = retryRaw ? Math.round(parseFloat(retryRaw) * 1000) || null : null
  const extra = { status, detail, retryAfterMs }

  if (/API_KEY_HTTP_REFERRER_BLOCKED|referr?er/i.test(blob)) {
    const origin = currentOrigin()
    return new GeminiError(
      'referrer',
      `Cette clé est restreinte à d'autres sites. Dans Google Cloud > Identifiants, autorisez ${origin || 'l’adresse de cette page'} ou retirez la restriction « Sites web ».`,
      extra,
    )
  }
  if (/API_KEY_INVALID|API key not valid|API key expired|reported as leaked/i.test(blob) || status === 401) {
    return new GeminiError(
      'key_invalid',
      /leaked/i.test(blob)
        ? 'Google a désactivé cette clé (signalée comme divulguée). Créez-en une nouvelle sur aistudio.google.com/apikey.'
        : 'Clé refusée par Google : invalide, supprimée ou mal copiée. Créez-en une nouvelle sur aistudio.google.com/apikey.',
      extra,
    )
  }
  if (/SERVICE_DISABLED|has not been used in project|is disabled/i.test(blob)) {
    return new GeminiError(
      'api_disabled',
      'L’API Gemini n’est pas activée pour le projet Google de cette clé. Activez « Generative Language API » ou créez la clé depuis aistudio.google.com/apikey.',
      extra,
    )
  }
  if (status === 404 || /is not found for API version|not supported for generateContent/i.test(blob)) {
    return new GeminiError(
      'model_not_found',
      `Le modèle « ${model} » n’est pas accessible avec cette clé. Vérifiez qu’elle vient d’un projet Google où ${DEFAULT_GEMINI_MODEL} est ouvert.`,
      extra,
    )
  }
  if (status === 429) {
    if (/limit:\s*0\b|billing|exceeded your current quota/i.test(blob) && !retryAfterMs) {
      return new GeminiError(
        'quota',
        `Quota épuisé pour « ${model} » avec cette clé. Choisissez un autre modèle ou activez la facturation du projet.`,
        extra,
      )
    }
    return new GeminiError(
      'rate_limited',
      `Trop de requêtes pour l’instant sur « ${model} ».${retryAfterMs ? ` Réessayez dans ${seconds(retryAfterMs)} s.` : ' Réessayez dans une minute.'}`,
      extra,
    )
  }
  if (status === 403) {
    return new GeminiError(
      'permission',
      'Google refuse l’accès avec cette clé (permission manquante sur le projet ou le modèle).',
      extra,
    )
  }
  if (status >= 500) {
    return new GeminiError(
      'overloaded',
      `Le modèle « ${model} » est surchargé côté Google. Réessayez dans un instant.`,
      extra,
    )
  }
  if (status === 400) {
    return new GeminiError('bad_request', `Requête refusée par Google : ${detail || 'paramètre invalide'}.`, extra)
  }
  return new GeminiError('unknown', `Erreur ${status} renvoyée par Google.${detail ? ` ${detail}` : ''}`, extra)
}

/* ------------------------------ Requête ---------------------------------- */

interface RawGeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] }
    finishReason?: string
  }[]
  promptFeedback?: { blockReason?: string }
  modelVersion?: string
}

function isTestEnv(): boolean {
  return (import.meta as { env?: { MODE?: string } }).env?.MODE === 'test'
}

function sleep(ms: number): Promise<void> {
  if (isTestEnv()) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function stripFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim()
}

async function readBody(response: Response): Promise<unknown> {
  try {
    if (typeof response.json === 'function') return await response.json()
  } catch {
    /* corps non JSON */
  }
  try {
    if (typeof response.text === 'function') return await response.text()
  } catch {
    /* corps illisible */
  }
  return null
}

async function fetchWithTimeout<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  model: string,
  read: (response: Response) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  // Le minuteur couvre aussi la lecture du corps : sinon un flux bloqué ne se termine jamais.
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    return await read(response)
  } catch (err) {
    if (err instanceof GeminiError) throw err
    if (controller.signal.aborted) {
      throw new GeminiError(
        'timeout',
        `Pas de réponse de « ${model} » en ${seconds(timeoutMs)} s. La réflexion HIGH est lente ou Google est saturé : relancez dans un instant.`,
      )
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new GeminiError('network', 'Vous êtes hors ligne. La séance continue avec la progression calculée sur l’appareil.')
    }
    throw new GeminiError(
      'network',
      'Connexion à Google impossible (réseau, pare-feu ou bloqueur de publicité).',
      { detail: err instanceof Error ? err.message : String(err) },
    )
  } finally {
    clearTimeout(timer)
  }
}

export interface GeminiJsonResult {
  text: string
  /** Modèle qui a réellement répondu. */
  model: string
  channel: ConcreteChannel
  latencyMs: number
}

async function callChannel(params: {
  cleanKey: string
  channel: ConcreteChannel
  model: string
  prompt: string
  responseSchema?: Record<string, unknown>
  timeoutMs: number
}): Promise<GeminiJsonResult> {
  const { channel, model } = params
  const routeKey = `${channel}|${model}`
  const level = thinkingRejected.has(routeKey) ? null : thinkingLevelFor(model)
  try {
    return await callChannelOnce({ ...params, thinkingLevel: level })
  } catch (err) {
    // Endpoint qui ne connaît pas thinkingLevel : on réessaie une fois sans.
    if (level && err instanceof GeminiError && err.kind === 'bad_request' && /thinking/i.test(`${err.message} ${err.detail}`)) {
      thinkingRejected.add(routeKey)
      return callChannelOnce({ ...params, thinkingLevel: null })
    }
    throw err
  }
}

async function callChannelOnce(params: {
  cleanKey: string
  channel: ConcreteChannel
  model: string
  prompt: string
  responseSchema?: Record<string, unknown>
  timeoutMs: number
  thinkingLevel: 'HIGH' | null
}): Promise<GeminiJsonResult> {
  const { cleanKey, channel, model, prompt, responseSchema, timeoutMs, thinkingLevel } = params
  const startedAt = Date.now()
  // Mesuré avec gemini-3.8-flash HIGH : un responseSchema imposé fait exploser la réflexion
  // (≈ 46 k jetons, 4 min) contre ≈ 15 k jetons et < 2 min avec le schéma dans le prompt.
  const inlineSchema = Boolean(responseSchema) && thinkingLevelFor(model) !== null
  const promptText = inlineSchema
    ? `${prompt}\n\nRéponds uniquement par un objet JSON valide conforme à ce schéma (types OpenAPI) :\n${JSON.stringify(responseSchema)}`
    : prompt
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: promptText }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      ...(responseSchema && !inlineSchema ? { responseSchema } : {}),
      ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
    },
  })

  return fetchWithTimeout(
    buildEndpointUrl(channel, model),
    { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cleanKey }, body },
    timeoutMs,
    model,
    async (response) => {
      const payload = await readBody(response)
      if (!response.ok) throw classifyHttpError(response.status, payload, model)

      const data = (payload ?? {}) as RawGeminiResponse
      const candidate = data.candidates?.[0]
      const text = stripFences(
        (candidate?.content?.parts ?? [])
          .filter((part) => !part.thought && typeof part.text === 'string')
          .map((part) => part.text)
          .join(''),
      )
      if (!text) {
        if (data.promptFeedback?.blockReason) {
          throw new GeminiError('blocked', 'Réponse bloquée par les filtres de Google.', {
            detail: data.promptFeedback.blockReason,
          })
        }
        throw new GeminiError(
          'empty',
          candidate?.finishReason === 'MAX_TOKENS'
            ? `« ${model} » a épuisé sa limite de réponse avant de répondre. Réessayez ou changez de modèle.`
            : `« ${model} » a renvoyé une réponse vide. Réessayez.`,
          { detail: candidate?.finishReason ?? '' },
        )
      }
      return { text, model: data.modelVersion || model, channel, latencyMs: Date.now() - startedAt }
    },
  )
}

const CHANNEL_SPECIFIC: ReadonlySet<GeminiErrorKind> = new Set([
  'key_invalid',
  'api_disabled',
  'permission',
  'model_not_found',
  'network',
])

async function callModel(params: {
  cleanKey: string
  model: string
  prompt: string
  responseSchema?: Record<string, unknown>
  timeoutMs: number
}): Promise<GeminiJsonResult> {
  const channels = candidateChannels(params.cleanKey, params.model)
  let firstError: GeminiError | null = null

  for (const channel of channels) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const result = await callChannel({ ...params, channel })
        workingChannelByRoute.set(`${params.cleanKey}|${params.model}`, channel)
        return result
      } catch (raw) {
        const err = raw instanceof GeminiError ? raw : new GeminiError('unknown', String(raw))
        // Aucun autre modèle ne prend le relais : seules les surcharges passagères sont retentées,
        // sur le même modèle (un délai dépassé doublerait l'attente pour rien).
        const retryable = err.kind === 'rate_limited' || err.kind === 'overloaded'
        const wait = err.retryAfterMs ?? RETRY_DELAYS_MS[attempt]
        if (retryable && attempt < RETRY_DELAYS_MS.length && wait <= MAX_RETRY_WAIT_MS) {
          await sleep(wait)
          continue
        }
        // L'erreur du canal principal est la plus parlante, sauf simple coupure réseau.
        if (!firstError || firstError.kind === 'network') firstError = err
        if (!CHANNEL_SPECIFIC.has(err.kind)) throw firstError
        break
      }
    }
  }
  throw firstError ?? new GeminiError('unknown', 'Échec de la requête Gemini.')
}

export async function generateJson(params: {
  apiKey: string
  prompt: string
  responseSchema?: Record<string, unknown>
  timeoutMs?: number
  priority?: 'high' | 'normal'
  /** Permet d'annuler en bloc les requêtes d'une même famille encore en file. */
  tag?: string
  /** Vrai quand les données ont changé : la requête en file ne part pas (zéro quota). */
  isStale?: () => boolean
  model?: string
}): Promise<GeminiJsonResult> {
  const cleanKey = sanitizeApiKey(params.apiKey)
  if (!cleanKey) throw new GeminiError('missing_key', 'Clé API manquante.')
  const model = params.model ?? config.model

  return enqueue(
    // Un seul modèle est interrogé, celui qui est réglé : aucun basculement silencieux.
    () =>
      callModel({
        cleanKey,
        model,
        prompt: params.prompt,
        responseSchema: params.responseSchema,
        timeoutMs: params.timeoutMs ?? GENERATION_TIMEOUT_MS,
      }),
    params.priority ?? 'normal',
    params.tag,
    params.isStale,
  )
}

/** Compatibilité : renvoie uniquement le texte JSON. */
export async function postGenerateContent(params: {
  apiKey: string
  prompt: string
  responseSchema: Record<string, unknown>
  timeoutMs?: number
  priority?: 'high' | 'normal'
  tag?: string
  isStale?: () => boolean
}): Promise<string> {
  return (await generateJson(params)).text
}

/* ------------------------- Liste des modèles ----------------------------- */

const NON_TEXT_MODEL = /tts|image|audio|live|embedding|robotics|computer|transcribe|banana|customtools/i

/** Modèles texte réellement accessibles avec cette clé (canal AI Studio). */
export async function listGeminiModels(apiKey: string): Promise<string[]> {
  const cleanKey = sanitizeApiKey(apiKey)
  if (!cleanKey) throw new GeminiError('missing_key', 'Clé API manquante.')
  const base = (config.baseUrl || CHANNEL_BASE.ai_studio).replace(/\/+$/, '')
  return fetchWithTimeout(
    `${base}/v1beta/models?pageSize=200`,
    { method: 'GET', headers: { 'x-goog-api-key': cleanKey } },
    LIST_TIMEOUT_MS,
    'liste des modèles',
    async (response) => {
      const payload = await readBody(response)
      if (!response.ok) throw classifyHttpError(response.status, payload, 'liste des modèles')
      const models = ((payload as { models?: { name?: string; supportedGenerationMethods?: string[] }[] })?.models ?? [])
        .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
        .map((m) => (m.name ?? '').replace(/^models\//, ''))
        .filter((name) => /^gemini/i.test(name) && !NON_TEXT_MODEL.test(name))
      return Array.from(new Set(models)).sort()
    },
  )
}

/* --------------------------- Test de connexion --------------------------- */

export interface ConnectionTestResult {
  ok: boolean
  message: string
  kind?: GeminiErrorKind
  models?: string[]
  latencyMs?: number
}

const TEST_PROMPT = 'Réponds uniquement {"status":"ok"} en JSON.'
const TEST_SCHEMA = { type: 'OBJECT', properties: { status: { type: 'STRING' } }, required: ['status'] }

export async function testGeminiConnection(apiKey: string): Promise<ConnectionTestResult> {
  if (!sanitizeApiKey(apiKey)) return { ok: false, kind: 'missing_key', message: 'Collez d’abord une clé API.' }
  const model = config.model
  const models = await listGeminiModels(apiKey).catch(() => undefined)
  const base = { apiKey, prompt: TEST_PROMPT, responseSchema: TEST_SCHEMA, priority: 'high' as const }

  try {
    // Le modèle réglé est le seul interrogé : si le test échoue, la génération échouera aussi.
    const res = await generateJson({ ...base, model, timeoutMs: TEST_TIMEOUT_MS })
    return {
      ok: true,
      models,
      latencyMs: res.latencyMs,
      message: `Connexion réussie : ${modelLabel(model)} a répondu en ${(res.latencyMs / 1000).toFixed(1).replace('.', ',')} s (${CHANNEL_LABEL[res.channel]}).`,
    }
  } catch (raw) {
    const err = raw instanceof GeminiError ? raw : new GeminiError('unknown', 'Échec du test.')
    const slow = err.kind === 'timeout' || err.kind === 'overloaded' || err.kind === 'empty'
    return {
      ok: false,
      kind: err.kind,
      models,
      message: slow
        ? `${err.message} La clé est valide : ${modelLabel(model)} demande simplement plus de temps (réflexion HIGH). Relancez le test.`
        : err.message,
    }
  }
}
