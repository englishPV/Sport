import { computeExerciseDdpPlan } from './ddp'
import { DEFAULT_NOTEPAD_PREAMBLE } from './defaultNotepad'
import { formatSetsForNotepad, inferExerciseMeta } from './parser'
import { buildEnrichedChronology } from './statsEngine'
import {
  createId,
  formatIsoToFr,
  normalizeName,
  SECTION_LABELS,
  todayISODate,
  type AiExerciseStatInsight,
  type AiStatsAnalysis,
  type AppSettings,
  type CoachSessionPlan,
  type CompletedSessionRecord,
  type Exercise,
  type ExerciseEntry,
  type ExercisePlan,
  type ExerciseTrendStatus,
  type SectionId,
  type TargetSet,
  type WorkoutSet,
} from './types'

/** Modèle strict demandé : Gemini 3.8 Flash avec raisonnement HIGH uniquement. */
export const GEMINI_MODEL = 'gemini-3.8-flash' as const
export const GEMINI_THINKING_LEVEL = 'HIGH' as const

export type ApiProviderKind = 'vertex_express' | 'ai_studio'

type AuthTransportMode = 'header' | 'query'
type ThinkingMode = 'level' | 'budget' | 'none'

interface WorkingRoute {
  url: string
  authMode: AuthTransportMode
  thinkingMode: ThinkingMode
}

const workingRouteByKey = new Map<string, WorkingRoute>()

/**
 * Nettoie une clé API collée depuis Google AI Studio, Google Cloud ou un presse-papiers mobile :
 * retire les préfixes éventuels (`GEMINI_API_KEY=...`, `Bearer ...`), guillemets, retours à la ligne
 * et caractères invisibles Unicode qui feraient échouer `fetch` dans le navigateur.
 */
export function sanitizeApiKey(rawKey: string): string {
  if (!rawKey) return ''
  let cleaned = rawKey
    .replace(/[\u200B-\u200D\uFEFF\u2060\u00A0]/g, '')
    .trim()

  cleaned = cleaned.replace(
    /^(?:export\s+)?(?:VITE_GEMINI_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY|API_KEY|key)\s*[:=]\s*/i,
    '',
  )
  cleaned = cleaned.replace(/^Bearer\s+/i, '').trim()
  cleaned = cleaned.replace(/^["'`«“”]+|["'`»“”]+$/g, '').trim()
  cleaned = Array.from(cleaned.replace(/\s+/g, ''))
    .filter((ch) => {
      const code = ch.charCodeAt(0)
      return code > 31 && (code < 127 || code > 159)
    })
    .join('')

  return cleaned
}

export function detectApiProvider(apiKey: string): {
  kind: ApiProviderKind
  label: string
} {
  const cleaned = sanitizeApiKey(apiKey)
  if (cleaned.startsWith('AQ.')) {
    return {
      kind: 'vertex_express',
      label: 'Vertex AI Express',
    }
  }
  return {
    kind: 'ai_studio',
    label: 'Google AI Studio',
  }
}

export function buildEndpointUrl(
  apiKey: string,
  vertexVersion: 'v1beta1' | 'v1' = 'v1beta1',
): string {
  const { kind } = detectApiProvider(apiKey)
  if (kind === 'vertex_express') {
    return `https://aiplatform.googleapis.com/${vertexVersion}/publishers/google/models/${GEMINI_MODEL}:generateContent`
  }
  return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`
}

function buildCandidateEndpoints(cleanKey: string): string[] {
  const aiStudioBeta = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`
  const aiStudioAlpha = `https://generativelanguage.googleapis.com/v1alpha/models/${GEMINI_MODEL}:generateContent`
  const vertexBeta = `https://aiplatform.googleapis.com/v1beta1/publishers/google/models/${GEMINI_MODEL}:generateContent`
  const vertexV1 = `https://aiplatform.googleapis.com/v1/publishers/google/models/${GEMINI_MODEL}:generateContent`

  if (detectApiProvider(cleanKey).kind === 'vertex_express') {
    return [vertexBeta, vertexV1, aiStudioBeta, aiStudioAlpha]
  }
  return [aiStudioBeta, aiStudioAlpha, vertexBeta, vertexV1]
}

/* -------------------------------------------------------------------------- */
/* File d'attente séquentielle pour éviter les erreurs 429 sur clés récentes  */
/* -------------------------------------------------------------------------- */

interface QueuedTask<T> {
  priority: 'high' | 'normal'
  epoch: number
  run: () => Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

let queueEpoch = 0
let queueRunning = false
const pendingQueue: QueuedTask<unknown>[] = []

export function resetGeminiClientState(): void {
  queueEpoch += 1
  pendingQueue.length = 0
  queueRunning = false
  workingRouteByKey.clear()
}

function drainQueue(): void {
  if (queueRunning) return
  const next = pendingQueue.shift()
  if (!next) return

  queueRunning = true
  const startedEpoch = queueEpoch

  void next
    .run()
    .then(
      (val) => next.resolve(val),
      (err) => next.reject(err),
    )
    .finally(() => {
      if (queueEpoch === startedEpoch) {
        queueRunning = false
        drainQueue()
      }
    })
}

function enqueueGeminiRequest<T>(
  run: () => Promise<T>,
  priority: 'high' | 'normal' = 'normal',
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const task: QueuedTask<unknown> = {
      priority,
      epoch: queueEpoch,
      run: run as () => Promise<unknown>,
      resolve: resolve as (value: unknown) => void,
      reject,
    }
    if (priority === 'high') {
      const firstNormalIdx = pendingQueue.findIndex((t) => t.priority !== 'high')
      if (firstNormalIdx === -1) {
        pendingQueue.push(task)
      } else {
        pendingQueue.splice(firstNormalIdx, 0, task)
      }
    } else {
      pendingQueue.push(task)
    }
    drainQueue()
  })
}

/* -------------------------------------------------------------------------- */
/* Construction & exécution résiliente des requêtes Gemini 3.8 Flash High     */
/* -------------------------------------------------------------------------- */

function buildGenerationConfig(
  responseSchema: Record<string, unknown>,
  thinkingMode: ThinkingMode = 'level',
): Record<string, unknown> {
  return {
    responseMimeType: 'application/json',
    responseSchema,
    ...(thinkingMode === 'level'
      ? { thinkingConfig: { thinkingLevel: GEMINI_THINKING_LEVEL } }
      : thinkingMode === 'budget'
        ? { thinkingConfig: { thinkingBudget: 16384 } }
        : {}),
  }
}

interface RawGeminiPart {
  text?: string
  thought?: boolean
}

interface RawGeminiErrorDetail {
  retryDelay?: string
  reason?: string
}

interface RawGeminiResponse {
  candidates?: {
    finishReason?: string
    content?: { parts?: RawGeminiPart[] }
  }[]
  promptFeedback?: { blockReason?: string }
  error?: {
    message?: string
    status?: string
    code?: number
    details?: RawGeminiErrorDetail[]
  }
}

function stripFences(raw: string): string {
  const trimmed = raw.trim()
  const match = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(trimmed)
  const unfenced = match ? match[1].trim() : trimmed
  if (unfenced.startsWith('{') && unfenced.endsWith('}')) {
    return unfenced
  }
  const firstBrace = unfenced.indexOf('{')
  const lastBrace = unfenced.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return unfenced.slice(firstBrace, lastBrace + 1)
  }
  return unfenced
}

function extractResponseText(payload: RawGeminiResponse): string {
  if (payload.promptFeedback?.blockReason) {
    throw new Error(`Requête bloquée (${payload.promptFeedback.blockReason}).`)
  }
  const parts = payload.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new Error('Réponse vide.')
  }
  const nonThought = parts
    .filter((p) => p.thought !== true && typeof p.text === 'string')
    .map((p) => p.text as string)
    .join('')
    .trim()

  if (!nonThought) {
    throw new Error('Réponse vide.')
  }
  return stripFences(nonThought)
}

interface ParsedHttpError {
  status: number
  message: string
  reason: string
  retryAfterMs: number | null
}

async function readErrorDetails(response: Response): Promise<ParsedHttpError> {
  let message = ''
  let reason = ''
  let retryAfterMs: number | null = null

  const retryHeader = response.headers?.get?.('retry-after')
  if (retryHeader) {
    const secs = Number(retryHeader)
    if (Number.isFinite(secs) && secs > 0) {
      retryAfterMs = Math.min(8_000, Math.round(secs * 1000))
    }
  }

  try {
    const errBody = (await response.json()) as RawGeminiResponse
    message = errBody.error?.message ?? ''
    if (Array.isArray(errBody.error?.details)) {
      for (const detail of errBody.error.details) {
        if (!reason && typeof detail.reason === 'string') {
          reason = detail.reason
        }
        if (retryAfterMs === null && typeof detail.retryDelay === 'string') {
          const m = /^(\d+(?:\.\d+)?)s$/i.exec(detail.retryDelay.trim())
          if (m) {
            retryAfterMs = Math.min(8_000, Math.round(Number(m[1]) * 1000))
          }
        }
      }
    }
  } catch {
    // Corps non JSON
  }

  return {
    status: response.status,
    message,
    reason,
    retryAfterMs,
  }
}

function isThinkingOrConfigError(err: ParsedHttpError): boolean {
  if (err.status !== 400) return false
  if (/api[_\s-]?key|key not valid|unauthenticated|credential|permission/i.test(err.message)) {
    return false
  }
  if (/API_KEY/i.test(err.reason)) {
    return false
  }
  return /thinking|generation_config|generationconfig|unknown name|invalid value/i.test(
    err.message,
  )
}

function isKeyOrEndpointMismatch(err: ParsedHttpError): boolean {
  if (err.status === 404 || err.status === 401 || err.status === 403) {
    // Une restriction de domaine HTTP Referrer échouera sur tous les endpoints Google
    if (/HTTP_REFERRER_BLOCKED|referer/i.test(`${err.reason} ${err.message}`)) {
      return false
    }
    return true
  }
  if (err.status === 400) {
    return (
      /API_KEY_INVALID|API_KEY_NOT_FOUND|API_KEY_SERVICE_BLOCKED/i.test(err.reason) ||
      /api key not valid|pass a valid api key|key is invalid|not found|unsupported/i.test(
        err.message,
      )
    )
  }
  return false
}

function formatFriendlyApiError(err: ParsedHttpError): string {
  const combined = `${err.reason} ${err.message}`
  if (/HTTP_REFERRER_BLOCKED|referer/i.test(combined)) {
    return 'Clé API restreinte par site web (retire la restriction HTTP Referrer dans Google AI Studio / Cloud).'
  }
  if (err.status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(combined)) {
    return err.message
      ? `Limite de requêtes atteinte sur la clé API (${err.message})`
      : 'Limite temporaire de requêtes atteinte (patiente quelques secondes puis réessaie).'
  }
  if (/API_KEY_INVALID|api key not valid|pass a valid api key/i.test(combined)) {
    return 'Clé API non reconnue par Google (vérifie que la clé complète est bien copiée sans caractère manquant).'
  }
  const detail = err.message ? ` (${err.message})` : ''
  return `Erreur HTTP ${err.status}${detail}`
}

function isTestEnv(): boolean {
  const meta = import.meta as { env?: Record<string, string | boolean | undefined> }
  return meta.env?.MODE === 'test' || Boolean(meta.env?.VITEST)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function executeGenerateContentHttp(params: {
  cleanKey: string
  prompt: string
  responseSchema: Record<string, unknown>
  timeoutMs: number
}): Promise<string> {
  const { cleanKey, prompt, responseSchema, timeoutMs } = params

  const sendOnce = async (
    baseUrl: string,
    authMode: AuthTransportMode,
    thinkingMode: ThinkingMode,
  ): Promise<{ response: Response; clearTimer: () => void } | { aborted: boolean; networkError: unknown }>  => {
    const controller = new AbortController()
    let didTimeout = false
    const timer = setTimeout(() => {
      didTimeout = true
      controller.abort()
    }, timeoutMs)

    const targetUrl =
      authMode === 'query'
        ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}key=${encodeURIComponent(cleanKey)}`
        : baseUrl

    const headers: Record<string, string> =
      authMode === 'query'
        ? {
            'Content-Type': 'application/json',
          }
        : {
            'Content-Type': 'application/json',
            'x-goog-api-key': cleanKey,
          }

    try {
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: buildGenerationConfig(responseSchema, thinkingMode),
        }),
        signal: controller.signal,
      })
      return { response, clearTimer: () => clearTimeout(timer) }
    } catch (networkError) {
      clearTimeout(timer)
      return { aborted: didTimeout || controller.signal.aborted, networkError }
    }
  }

  // Ordonne les routes candidates : route déjà validée en tête si disponible
  const cachedRoute = workingRouteByKey.get(cleanKey)
  const baseEndpoints = buildCandidateEndpoints(cleanKey)
  const endpoints = cachedRoute
    ? [cachedRoute.url, ...baseEndpoints.filter((u) => u !== cachedRoute.url)]
    : baseEndpoints

  let primaryParsedError: ParsedHttpError | null = null
  let lastParsedError: ParsedHttpError | null = null
  let sawNetworkError = false

  for (let epIdx = 0; epIdx < endpoints.length; epIdx += 1) {
    const endpoint = endpoints[epIdx]
    const initialAuthModes: AuthTransportMode[] =
      cachedRoute && cachedRoute.url === endpoint
        ? [cachedRoute.authMode, ...(cachedRoute.authMode === 'header' ? (['query'] as const) : (['header'] as const))]
        : ['header', 'query']

    let moveToNextEndpoint = false

    for (let authIdx = 0; authIdx < initialAuthModes.length; authIdx += 1) {
      const authMode = initialAuthModes[authIdx]
      let thinkingMode: ThinkingMode =
        cachedRoute && cachedRoute.url === endpoint ? cachedRoute.thinkingMode : 'level'

      let rateRetry = 0
      const maxRateRetries = 2

      while (true) {
        const outcome = await sendOnce(endpoint, authMode, thinkingMode)

        if ('networkError' in outcome) {
          if (cachedRoute && cachedRoute.url === endpoint && cachedRoute.authMode === authMode) {
            workingRouteByKey.delete(cleanKey)
          }
          sawNetworkError = true
          if (outcome.aborted) {
            moveToNextEndpoint = true;
          }
          break
        }

        const { response, clearTimer } = outcome
        if (response.ok) {
          workingRouteByKey.set(cleanKey, {
            url: endpoint,
            authMode,
            thinkingMode,
          })
          try {
            const data = (await response.json()) as RawGeminiResponse
            return extractResponseText(data)
          } finally {
            clearTimer()
          }
        }

        if (cachedRoute && cachedRoute.url === endpoint && cachedRoute.authMode === authMode) {
          workingRouteByKey.delete(cleanKey)
        }

        let errInfo;
        try {
          errInfo = await readErrorDetails(response)
        } finally {
          clearTimer()
        }
        if (epIdx === 0 && primaryParsedError === null) {
          primaryParsedError = errInfo
        }
        lastParsedError = errInfo

        // 1. Adaptation automatique du paramètre thinking si l'endpoint rejette thinkingLevel
        if (isThinkingOrConfigError(errInfo)) {
          if (thinkingMode === 'level') {
            thinkingMode = 'budget'
            continue
          }
          if (thinkingMode === 'budget') {
            thinkingMode = 'none'
            continue
          }
        }

        // 2. Nouvelle clé / Free Tier : retry automatique sur 429 ou indisponibilité transitoire 5xx
        if (
          (errInfo.status === 429 ||
            errInfo.status === 500 ||
            errInfo.status === 502 ||
            errInfo.status === 503 ||
            errInfo.status === 504) &&
          rateRetry < maxRateRetries
        ) {
          rateRetry += 1
          const baseWait = isTestEnv() ? 15 : 1_800 * rateRetry
          const waitMs =
            !isTestEnv() && errInfo.retryAfterMs !== null ? errInfo.retryAfterMs : baseWait
          await sleep(waitMs)
          continue
        }

        // 3. Si 404 (modèle/version sur un autre chemin) : inutile de retenter en `?key=` sur la même URL,
        //    on passe directement à l'endpoint candidat suivant (v1alpha / v1 / Vertex <-> AI Studio).
        if (errInfo.status === 404) {
          moveToNextEndpoint = true
          break
        }

        // 4. Si erreur d'authentification / service désactivé (ex: clé GCP AIza sur AI Studio ou clé AQ. sans ?key=) :
        //    on tente le mode `?key=` puis les autres endpoints candidats.
        if (isKeyOrEndpointMismatch(errInfo)) {
          break
        }

        // 5. Quota `limit: 0` propre à un endpoint : inutile de retenter la même URL en `?key=`,
        //    on passe directement à l'endpoint candidat suivant.
        if (errInfo.status === 429 && epIdx < endpoints.length - 1 && /limit:\s*0\b/i.test(errInfo.message)) {
          moveToNextEndpoint = true
          break
        }

        // 6. 429 / 5xx persistant après les réessais internes : ne pas faire échouer tout le
        //    test sur cette route. On laisse leur chance au mode d'auth puis aux autres endpoints
        //    (surcharge/quota locale d'un endpoint Google souvent spécifique à une route).
        if (
          errInfo.status === 429 ||
          errInfo.status === 500 ||
          errInfo.status === 502 ||
          errInfo.status === 503 ||
          errInfo.status === 504
        ) {
          break
        }

        throw new Error(formatFriendlyApiError(errInfo))
      }

      if (moveToNextEndpoint) {
        break
      }
    }
  }

  const errorToReport = primaryParsedError ?? lastParsedError
  if (errorToReport) {
    throw new Error(formatFriendlyApiError(errorToReport))
  }
  if (sawNetworkError) {
    throw new Error('Réseau indisponible ou délai dépassé.')
  }
  throw new Error('Impossible de joindre Gemini.')
}

async function postGenerateContent(params: {
  apiKey: string
  prompt: string
  responseSchema: Record<string, unknown>
  timeoutMs?: number
  priority?: 'high' | 'normal'
}): Promise<string> {
  const {
    apiKey,
    prompt,
    responseSchema,
    timeoutMs = 90_000,
    priority = 'normal',
  } = params
  const cleanKey = sanitizeApiKey(apiKey)
  if (!cleanKey) {
    throw new Error('Clé API manquante.')
  }

  return enqueueGeminiRequest(
    () =>
      executeGenerateContentHttp({
        cleanKey,
        prompt,
        responseSchema,
        timeoutMs,
      }),
    priority,
  )
}

export async function testGeminiConnection(
  apiKey: string,
): Promise<{ ok: boolean; message: string }> {
  try {
    await postGenerateContent({
      apiKey,
      prompt: 'Réponds uniquement {"status":"ok"} en JSON.',
      responseSchema: {
        type: 'OBJECT',
        properties: { status: { type: 'STRING' } },
        required: ['status'],
      },
      // Le tier gratuit de gemini-3.8-flash (thinking HIGH) peut mettre 30-50 s à répondre :
      // on laisse plus de marge qu'un simple ping, et un timeout bascule désormais sur
      // les routes candidates au lieu d'échouer immédiatement.
      timeoutMs: 60_000,
      priority: 'high',
    })
    return {
      ok: true,
      message: `OK (${GEMINI_MODEL} · ${GEMINI_THINKING_LEVEL})`,
    }
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Échec du test.',
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Empreinte d'une section pour savoir si la séance est déjà pré-générée      */
/* -------------------------------------------------------------------------- */

export function buildSectionPlanFingerprint(
  exercises: readonly Exercise[],
  section: SectionId,
  preamble = '',
): string {
  const activeExercises = exercises.filter((e) => e.section === section && e.active)
  const exSig = activeExercises
    .map((ex) => {
      const realEntries = ex.entries.filter((e) => !e.skipOnly && e.sets.length > 0)
      const latest = realEntries[0]
      const setsSig = latest
        ? latest.sets
            .map(
              (s) =>
                `${s.weight}x${s.reps}${s.isWarmup ? 'w' : ''}${s.failure ? 'f' : ''}`,
            )
            .join(',')
        : 'empty'
      return `${ex.id}#${realEntries.length}#${latest?.date ?? ''}#${setsSig}#${latest?.restSeconds ?? ''}#${latest?.note ?? ''}`
    })
    .join('|')

  const cleanPreamble = preamble.trim()
  return `plan-v2:${section}:${cleanPreamble.length}:${cleanPreamble.slice(0, 64)}:${cleanPreamble.slice(-64)}::${exSig}`
}

export function isGeminiPlanFresh(
  plan: CoachSessionPlan | undefined | null,
  exercises: readonly Exercise[],
  section: SectionId,
  preamble = '',
): boolean {
  if (!plan || plan.source !== 'gemini') return false
  if (!plan.fingerprint) return false
  return plan.fingerprint === buildSectionPlanFingerprint(exercises, section, preamble)
}

/* -------------------------------------------------------------------------- */
/* Nettoyage intelligent du préambule utilisateur pour le prompt JSON         */
/* -------------------------------------------------------------------------- */

/**
 * Conserve 100 % des règles personnelles d'entraînement écrites par l'utilisateur
 * en haut de son `.txt`, tout en retirant les instructions contradictoires héritées
 * d'un copier-coller chat ("Génère un UNIQUE BLOC DE CODE MARKDOWN..." ou sélection
 * automatique de séance quand l'app pré-génère explicitement la séance suivante).
 */
export function extractAthleteRulesFromPreamble(rawPreamble?: string): string {
  const source = (rawPreamble ?? DEFAULT_NOTEPAD_PREAMBLE).trim()
  if (!source) return ''

  const lines = source.split(/\r?\n/)
  const kept: string[] = []
  let skippingFormatBlock = false

  for (const line of lines) {
    const trimmed = line.trim()

    if (/^Aujourd'hui,\s*c'est\s+soit\s+Haut/i.test(trimmed)) {
      continue
    }
    if (/^RÈGLE\s+DE\s+SÉLECTION\s+DU\s+JOUR\s*:/i.test(trimmed)) {
      continue
    }
    if (/^FORMAT\s+D'EXÉCUTION\s+ET\s+D'AFFICHAGE/i.test(trimmed)) {
      skippingFormatBlock = true
      continue
    }

    if (skippingFormatBlock) {
      // Fin du bloc format standard si l'utilisateur a ajouté ses propres notes après
      if (
        /^([1-3]\.\s*(Rédige|Génère|Dans ce bloc)|•\s*\d{2}\/\d{2}\/\d{4}\s*\(Objectif\)|Enlève les \(objectif\))/i.test(
          trimmed,
        ) ||
        trimmed === ''
      ) {
        continue
      }
      skippingFormatBlock = false
    }

    kept.push(line)
  }

  return kept.join('\n').trim()
}

/* -------------------------------------------------------------------------- */
/* Génération des cibles de séance via Gemini 3.8 Flash High                  */
/* -------------------------------------------------------------------------- */

const COACH_PLAN_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  properties: {
    summary_lines: {
      type: 'ARRAY',
      items: { type: 'STRING' },
    },
    exercises: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          exercise_id: { type: 'STRING' },
          rest_seconds: { type: 'INTEGER' },
          tip: { type: 'STRING' },
          sets: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                weight: { type: 'NUMBER' },
                reps_min: { type: 'INTEGER' },
                reps_max: { type: 'INTEGER' },
                target_reps: { type: 'INTEGER' },
                is_warmup: { type: 'BOOLEAN' },
              },
              required: ['weight', 'reps_min', 'reps_max', 'target_reps', 'is_warmup'],
            },
          },
        },
        required: ['exercise_id', 'rest_seconds', 'tip', 'sets'],
      },
    },
  },
  required: ['summary_lines', 'exercises'],
}

export function buildCoachPromptForSection(params: {
  section: SectionId
  exercises: readonly Exercise[]
  preamble?: string
  settings: Pick<AppSettings, 'profileHeightCm' | 'profileWeightKg'>
}): string {
  const { section, exercises, preamble, settings } = params
  const activeExercises = exercises.filter((e) => e.section === section && e.active)
  const athleteRules = extractAthleteRulesFromPreamble(preamble)

  const payload = activeExercises.map((ex, idx) => {
    const ddpReference = computeExerciseDdpPlan(ex)
    const enrichedNewestFirst = [...buildEnrichedChronology(ex)].reverse()
    const variantByEntryId = new Map(
      enrichedNewestFirst.map((item) => [item.entry.id, item.variant]),
    )

    const recentSessions = ex.entries
      .filter((e) => !e.skipOnly && e.sets.length > 0)
      .slice(0, 6)
      .map((entry) => ({
        date: formatIsoToFr(entry.date),
        equipment_variant: variantByEntryId.get(entry.id) ?? 'Standard',
        formatted: formatSetsForNotepad(entry.sets, ex.unit),
        sets_detail: entry.sets.map((s) => ({
          weight_kg: s.weight,
          reps: s.reps,
          is_warmup: Boolean(s.isWarmup),
          reached_failure: Boolean(s.failure),
          ...(s.workSeconds ? { work_seconds: s.workSeconds } : {}),
          ...(s.restBeforeSeconds ? { rest_before_seconds: s.restBeforeSeconds } : {}),
        })),
        rest_seconds: entry.restSeconds,
        ...(entry.workSeconds ? { exercise_work_seconds: entry.workSeconds } : {}),
        ...(entry.sessionDurationSeconds
          ? { session_duration_seconds: entry.sessionDurationSeconds }
          : {}),
        user_comment: entry.note,
      }))

    const recentSkipNotes = ex.entries
      .filter((e) => e.skipOnly && e.note.trim().length > 0)
      .slice(0, 2)
      .map((e) => e.note.trim())

    return {
      order_in_session: idx + 1,
      exercise_id: ex.id,
      name: ex.name,
      category:
        ex.category === 'poly'
          ? `polyarticulaire (${ex.repRange[0]}-${ex.repRange[1]} reps)`
          : `isolation (${ex.repRange[0]}-${ex.repRange[1]} reps)`,
      unit: ex.unit,
      weight_step_kg: ex.weightStep,
      default_rest_seconds: ex.defaultRestSeconds,
      ddp_mathematical_baseline: {
        rest_seconds: ddpReference.restSeconds,
        sets: ddpReference.sets.map((s) => ({
          weight: s.weight,
          reps_min: s.repsMin,
          reps_max: s.repsMax,
          target_reps: s.suggestedReps,
          is_warmup: Boolean(s.isWarmup),
        })),
      },
      recent_sessions: recentSessions,
      ...(recentSkipNotes.length > 0 ? { recent_context_notes: recentSkipNotes } : {}),
    }
  })

  return `Tu es un coach scientifique expert en hypertrophie et biomécanique appliquant la Double Progression Dynamique (DDP).
Date de référence : ${formatIsoToFr(todayISODate())}.
Profil athlète : ${settings.profileHeightCm} cm, ${settings.profileWeightKg} kg — objectif hypertrophie naturelle.
Séance cible à planifier maintenant : ${SECTION_LABELS[section].title} (cette séance peut être lancée aujourd'hui ou pré-générée à l'avance pour la prochaine venue à la salle : base-toi exclusivement sur l'historique de ${SECTION_LABELS[section].title} fourni ci-dessous).

${athleteRules ? `Consignes personnelles de l'athlète (issues de son fichier .txt) :\n${athleteRules}\n` : ''}RÈGLES DE PROGRAMMATION SCIENTIFIQUES & PRATIQUES :
1. Analyse en priorité recent_sessions[0] (la dernière séance réalisée) et la tendance des séances précédentes sur le MÊME equipment_variant :
   - Ne mélange jamais les charges de deux machines ou variantes différentes (ex: "Presse poids dos" vs "Par côté", "Poulie haute" vs "Standard", "Debout (Calf)" vs "Assis").
2. Double Progression Dynamique (DDP) série par série (référence fournie dans ddp_mathematical_baseline) :
   - Polyarticulaires (${section === 'up' ? 'développés, tirages' : 'presse, roumain, leg extension, leg curl'}) : fourchette 8 à 12 reps. Si la Série 1 de travail a validé >= 12 reps propres, monte la Série 1 d'un palier réaliste (+weight_step_kg) et vise 8–10 reps (target_reps = 9, ou 8 si le saut relatif en % est élevé comme aux haltères). Garde les séries suivantes (S2, S3) à l'ancien poids tant qu'elles n'ont pas validé 12 reps (top-set + back-off sets), ou monte-les d'un cran si elles ont validé 12 reps sans dépasser la charge de S1. Sinon, conserve la charge et vise +1 rep (target_reps = dernière rep + 1, plafonné à 12).
   - Isolation (élévations latérales, triceps, biceps, mollets, abdos) : fourchette 12 à 15 reps. Monte d'un cran à 15 reps validées (vise 12–14 reps, target_reps = 12 ou 13), sinon conserve la charge et vise +1 rep.
3. Adaptation intelligente aux commentaires (user_comment), à l'échec (reached_failure) et à la fatigue en cours de séance (order_in_session) :
   - Si l'athlète écrit "trop facile", "j'aurais pu faire 13-14", "je me suis limité" ou suggère un poids précis (ex: "80kg facile, peut-être 90 si j'ai pas l'autre") -> suis ce ressenti et ajuste la charge/reps en conséquence.
   - Si échec prématuré (chute franche des reps sur S2/S3), souffle court, malaise évoqué, reprise après pause ou gêne -> stabilise la charge sans monter prématurément, fixe un target_reps réaliste et accorde un repos suffisant (150–180s polyarticulaire intense, 90–150s isolation).
4. Échauffements & paliers réels de salle :
   - Conserve fidèlement les séries d'échauffement habituelles de l'athlète (is_warmup: true, ex: 10kg x 12 au développé incliné, montée progressive à la presse) sans inventer d'échauffements sur les exercices où il n'en fait jamais.
   - Utilise uniquement des charges réalistes en salle selon weight_step_kg (0 pour poids du corps) et renseigne précisément target_reps (l'objectif exact du jour sur chaque série, compris entre reps_min et reps_max).
5. Réponse JSON pure conforme au schéma demandé (aucun bloc Markdown) :
   - summary_lines : 2 à 4 phrases courtes, précises et concrètes en français (virgule décimale française, ex: "22,5 kg") résumant les progressions clés du jour.
   - exercises : inclut OBLIGATOIREMENT chaque exercise_id fourni, avec tip court (< 120 caractères) directement utile sous la barre.

Historique complet par exercice (JSON) :
${JSON.stringify(payload)}`
}

interface RawGeminiPlanJson {
  summary_lines?: unknown
  exercises?: unknown
}

export async function generateGeminiSessionPlan(params: {
  section: SectionId
  exercises: readonly Exercise[]
  preamble?: string
  settings: Pick<AppSettings, 'apiKey' | 'profileHeightCm' | 'profileWeightKg'>
  priority?: 'high' | 'normal'
}): Promise<CoachSessionPlan> {
  const { section, exercises, preamble, settings, priority = 'normal' } = params
  const activeExercises = exercises.filter((e) => e.section === section && e.active)
  const fingerprint = buildSectionPlanFingerprint(exercises, section, preamble)
  const prompt = buildCoachPromptForSection({ section, exercises, preamble, settings })

  const text = await postGenerateContent({
    apiKey: settings.apiKey,
    prompt,
    responseSchema: COACH_PLAN_SCHEMA,
    priority,
  })

  let parsed: RawGeminiPlanJson
  try {
    parsed = JSON.parse(text) as RawGeminiPlanJson
  } catch {
    throw new Error('JSON invalide renvoyé par Gemini.')
  }

  const summaryLines = Array.isArray(parsed.summary_lines)
    ? parsed.summary_lines
        .filter((line): line is string => typeof line === 'string' && line.trim().length > 0)
        .slice(0, 4)
    : []

  const byId: Record<string, ExercisePlan> = {}

  if (Array.isArray(parsed.exercises)) {
    for (const item of parsed.exercises) {
      if (!item || typeof item !== 'object') continue
      const rec = item as Record<string, unknown>
      const exId = typeof rec.exercise_id === 'string' ? rec.exercise_id : ''
      const ex = activeExercises.find((candidate) => candidate.id === exId)
      if (!ex) continue

      const rawSets = Array.isArray(rec.sets) ? rec.sets : []
      const cleanSets: TargetSet[] = []
      for (const rs of rawSets) {
        if (!rs || typeof rs !== 'object') continue
        const sObj = rs as Record<string, unknown>
        const weight = Math.max(0, Number(sObj.weight) || 0)
        const rMin = Math.max(1, Math.min(40, Math.round(Number(sObj.reps_min) || ex.repRange[0])))
        const rMax = Math.max(rMin, Math.min(40, Math.round(Number(sObj.reps_max) || rMin)))
        const rawTarget = Number(sObj.target_reps)
        const suggestedReps =
          Number.isFinite(rawTarget) && rawTarget > 0
            ? Math.max(rMin, Math.min(rMax, Math.round(rawTarget)))
            : rMax
        const isWarmup = Boolean(sObj.is_warmup)
        cleanSets.push({
          weight,
          repsMin: rMin,
          repsMax: rMax,
          suggestedReps,
          ...(isWarmup ? { isWarmup: true } : {}),
        })
      }

      if (cleanSets.length === 0) continue

      const restSeconds = Math.max(
        30,
        Math.min(360, Math.round(Number(rec.rest_seconds) || ex.defaultRestSeconds)),
      )
      const tip = typeof rec.tip === 'string' ? rec.tip.trim().slice(0, 140) : ''

      byId[ex.id] = {
        exerciseId: ex.id,
        sets: cleanSets,
        restSeconds,
        tip,
      }
    }
  }

  for (const ex of activeExercises) {
    if (!byId[ex.id]) {
      byId[ex.id] = computeExerciseDdpPlan(ex)
    }
  }

  return {
    section,
    generatedAt: Date.now(),
    source: 'gemini',
    model: GEMINI_MODEL,
    fingerprint,
    summaryLines:
      summaryLines.length > 0 ? summaryLines : [`Objectifs générés (${GEMINI_MODEL} · high).`],
    exercises: byId,
  }
}

/* -------------------------------------------------------------------------- */
/* Extraction IA d'un bloc-notes / texte libre non reconnu par le parseur     */
/* -------------------------------------------------------------------------- */

const EXTRACT_WORKOUT_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  properties: {
    exercises: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          section: { type: 'STRING', enum: ['up', 'legs'] },
          entries: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                date_iso: { type: 'STRING' },
                rest_seconds: { type: 'INTEGER' },
                note: { type: 'STRING' },
                sets: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      weight: { type: 'NUMBER' },
                      reps: { type: 'NUMBER' },
                      is_warmup: { type: 'BOOLEAN' },
                      failure: { type: 'BOOLEAN' },
                    },
                    required: ['weight', 'reps', 'is_warmup', 'failure'],
                  },
                },
              },
              required: ['date_iso', 'rest_seconds', 'note', 'sets'],
            },
          },
        },
        required: ['name', 'section', 'entries'],
      },
    },
  },
  required: ['exercises'],
}

export async function parseWorkoutTextWithGemini(params: {
  rawText: string
  apiKey: string
}): Promise<Exercise[]> {
  const { rawText, apiKey } = params

  const prompt = `Tu es un extracteur expert de carnets de musculation.
L'utilisateur a envoyé des notes d'entraînement dans un format libre que le parseur classique n'a pas pu lire entièrement.
Analyse l'intégralité du texte ci-dessous et extrais TOUS les exercices pratiqués ainsi que toutes leurs séances et séries, du plus récent au plus ancien :
- Classe chaque exercice dans "up" (haut du corps : pecs, dos, épaules, bras) ou "legs" (jambes, fessiers, mollets, abdos).
- Convertis les dates éventuelles au format YYYY-MM-DD (ex: "22/10/2026" -> "2026-10-22"). S'il n'y a pas de date, renvoie "" dans date_iso.
- Pour le poids du corps (tractions, dips sans lest), mets weight = 0.
- Pour chaque série, indique weight (en kg), reps (nombre de répétitions), is_warmup (true si échauffement), failure (true si échec mentionné).
- Si un temps de repos est mentionné, mets-le en secondes dans rest_seconds (sinon 0).
- Conserve les remarques utiles dans note.

Texte brut de l'utilisateur :
"""
${rawText}
"""`

  const responseText = await postGenerateContent({
    apiKey,
    prompt,
    responseSchema: EXTRACT_WORKOUT_SCHEMA,
    timeoutMs: 90_000,
    priority: 'high',
  })

  const parsed = JSON.parse(responseText) as { exercises?: unknown }
  if (!Array.isArray(parsed.exercises) || parsed.exercises.length === 0) {
    throw new Error('Aucun exercice détecté par Gemini dans ce texte.')
  }

  const result: Exercise[] = []

  for (const rawEx of parsed.exercises) {
    if (!rawEx || typeof rawEx !== 'object') continue
    const rec = rawEx as Record<string, unknown>
    const name = typeof rec.name === 'string' ? rec.name.trim() : ''
    if (!name) continue

    const section: SectionId = rec.section === 'legs' ? 'legs' : 'up'
    const meta = inferExerciseMeta(name)
    const rawEntries = Array.isArray(rec.entries) ? rec.entries : []

    const entries: ExerciseEntry[] = []
    for (const re of rawEntries) {
      if (!re || typeof re !== 'object') continue
      const eObj = re as Record<string, unknown>
      const dateRaw = typeof eObj.date_iso === 'string' ? eObj.date_iso.trim() : ''
      const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : null
      const restNum = Number(eObj.rest_seconds) || 0
      const note = typeof eObj.note === 'string' ? eObj.note.trim() : ''
      const rawSets = Array.isArray(eObj.sets) ? eObj.sets : []

      const sets: WorkoutSet[] = []
      for (const rs of rawSets) {
        if (!rs || typeof rs !== 'object') continue
        const sObj = rs as Record<string, unknown>
        const weight = Math.max(0, Number(sObj.weight) || 0)
        const reps = Math.max(0, Number(sObj.reps) || 0)
        if (reps <= 0) continue
        sets.push({
          weight,
          reps,
          ...(sObj.is_warmup ? { isWarmup: true } : {}),
          ...(sObj.failure ? { failure: true } : {}),
        })
      }

      if (sets.length > 0) {
        entries.push({
          id: createId('entry'),
          date,
          sets,
          restSeconds: restNum > 0 ? restNum : null,
          note,
        })
      }
    }

    const recentRest = entries.find((e) => e.restSeconds && e.restSeconds > 0)?.restSeconds

    result.push({
      id: `ex-${normalizeName(name).replace(/\s+/g, '-') || createId('x')}`,
      name,
      normalizedName: normalizeName(name),
      section,
      category: meta.category,
      repRange: meta.repRange,
      weightStep: meta.weightStep,
      unit: meta.unit,
      defaultRestSeconds: recentRest ?? meta.defaultRestSeconds,
      active: true,
      entries,
    })
  }

  if (result.length === 0) {
    throw new Error('Aucune série valide extraite par Gemini.')
  }

  return result
}

/* -------------------------------------------------------------------------- */
/* Analyse intelligente des Statistiques via Gemini 3.8 Flash High            */
/* -------------------------------------------------------------------------- */

const STATS_ANALYSIS_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  properties: {
    headline: { type: 'STRING' },
    bullet_points: {
      type: 'ARRAY',
      items: { type: 'STRING' },
    },
    exercises: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          exercise_id: { type: 'STRING' },
          badge: { type: 'STRING' },
          status: {
            type: 'STRING',
            enum: ['progressing', 'stable', 'recalibration', 'fatigue'],
          },
          summary: { type: 'STRING' },
        },
        required: ['exercise_id', 'badge', 'status', 'summary'],
      },
    },
  },
  required: ['headline', 'bullet_points', 'exercises'],
}

export function buildStatsFingerprint(
  exercises: readonly Exercise[],
  completedSessions: readonly CompletedSessionRecord[] = [],
): string {
  const parts = exercises
    .filter((e) => e.active)
    .map((ex) => {
      const latest = ex.entries[0]
      return `${ex.id}:${ex.entries.length}:${latest?.date ?? ''}:${latest?.sets.length ?? 0}:${latest?.sets[0]?.weight ?? 0}x${latest?.sets[0]?.reps ?? 0}`
    })
  return `v2:${parts.join('|')}#sessions:${completedSessions.length}`
}

export async function analyzeStatsWithGemini(params: {
  exercises: readonly Exercise[]
  completedSessions?: readonly CompletedSessionRecord[]
  apiKey: string
}): Promise<AiStatsAnalysis> {
  const { exercises, completedSessions = [], apiKey } = params
  const activeExercises = exercises.filter((e) => e.active)

  const payload = activeExercises.map((ex) => {
    const chronoEntries = buildEnrichedChronology(ex)

    return {
      exercise_id: ex.id,
      name: ex.name,
      section: ex.section,
      sessions_count: chronoEntries.length,
      chronological_sessions: chronoEntries.map((item) => ({
        index: item.chronoNumber,
        date: item.displayDate,
        equipment_variant: item.variant,
        valid_weight: item.hasValidWeight,
        sets: item.setsDisplay,
        rest_seconds: item.entry.restSeconds,
        work_seconds: item.entry.workSeconds ?? null,
        comment: item.entry.note,
      })),
    }
  })

  const timingSummary = completedSessions.slice(0, 10).map((s) => ({
    date: formatIsoToFr(s.date),
    section: s.section,
    total_duration_min: Math.round((s.totalDurationSeconds / 60) * 10) / 10,
    work_min: Math.round((s.totalWorkSeconds / 60) * 10) / 10,
    rest_min: Math.round((s.totalRestSeconds / 60) * 10) / 10,
  }))

  const prompt = `Tu es un analyste expert en musculation et hypertrophie.
Analyse l'historique réel de cet athlète avec discernement humain :
RÈGLES ESSENTIELLES :
1. NE CALCULE JAMAIS de pourcentages absurdes (comme "+295%") dus à une première séance de découverte à poids léger ou à un changement de machine.
2. Chaque séance comporte déjà un champ "equipment_variant" (ex: "Standard", "Poulie basse", "Poulie haute", "Par côté", "Presse poids dos", "Machine 2") et "valid_weight" (false si oubli de poids "0kg"). NE COMPARE JAMAIS les charges de deux equipment_variant différents comme une hausse ou baisse de force ! Compare toujours la séance la plus récente à la précédente sur le MÊME équipement.
3. Détecte intelligemment :
   - les changements de machine ou réglages ("recalibration"),
   - les baisses volontaires suivies d'une remontée propre (correction d'exécution, reprise),
   - la vraie progression récente sur le même équipement ("progressing"),
   - les plateaux ("stable") ou signes de fatigue/gêne dans les commentaires ("fatigue").
4. Formatage français impeccable : utilise la virgule pour les décimales ("11,5" et non "11.5") et reste ULTRA CONCIS :
   - headline : 1 phrase courte et juste sur la dynamique globale actuelle.
   - bullet_points : 2 ou 3 constats factuels courts maximum (pas de blabla).
   - Pour chaque exercice actif (utilise exactement exercise_id) :
     - badge : étiquette très courte (max 22 caractères, ex: "+2 kg · 22 kg", "Nouvelle presse", "Stable · 10 kg", "+1 rep à 10 kg").
     - status : "progressing" | "stable" | "recalibration" | "fatigue".
     - summary : 1 à 2 phrases courtes expliquant l'évolution réelle sur le même équipement (mentionne si changement de variante ou reprise détectée).

Chronométrages récents de séances complètes (si disponibles) :
${JSON.stringify(timingSummary)}

Historique chronologique des exercices actifs :
${JSON.stringify(payload)}`

  const responseText = await postGenerateContent({
    apiKey,
    prompt,
    responseSchema: STATS_ANALYSIS_SCHEMA,
    timeoutMs: 90_000,
    priority: 'normal',
  })

  const parsed = JSON.parse(responseText) as {
    headline?: unknown
    bullet_points?: unknown
    exercises?: unknown
  }

  const headline =
    typeof parsed.headline === 'string' && parsed.headline.trim()
      ? parsed.headline.trim()
      : 'Progression analysée sur tes séances récentes.'

  const bulletPoints = Array.isArray(parsed.bullet_points)
    ? parsed.bullet_points
        .filter((b): b is string => typeof b === 'string' && b.trim().length > 0)
        .slice(0, 3)
    : []

  const byId: Record<string, AiExerciseStatInsight> = {}
  const validStatuses: ExerciseTrendStatus[] = [
    'progressing',
    'stable',
    'recalibration',
    'fatigue',
  ]

  if (Array.isArray(parsed.exercises)) {
    for (const rawItem of parsed.exercises) {
      if (!rawItem || typeof rawItem !== 'object') continue
      const rec = rawItem as Record<string, unknown>
      const exId = typeof rec.exercise_id === 'string' ? rec.exercise_id : ''
      if (!exId) continue
      const rawStatus = rec.status as ExerciseTrendStatus
      const status: ExerciseTrendStatus = validStatuses.includes(rawStatus)
        ? rawStatus
        : 'stable'
      byId[exId] = {
        exerciseId: exId,
        badge:
          typeof rec.badge === 'string' && rec.badge.trim()
            ? rec.badge.trim().slice(0, 32)
            : 'Analysé',
        status,
        summary:
          typeof rec.summary === 'string' && rec.summary.trim()
            ? rec.summary.trim()
            : '',
      }
    }
  }

  return {
    generatedAt: Date.now(),
    fingerprint: buildStatsFingerprint(exercises, completedSessions),
    model: GEMINI_MODEL,
    headline,
    bulletPoints,
    exercises: byId,
  }
}
