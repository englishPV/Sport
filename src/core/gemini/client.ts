import { DEFAULT_GEMINI_THINKING_LEVEL } from '../types'

export type GeminiErrorCode =
  | 'invalid_key'
  | 'rate_limited'
  | 'model_not_found'
  | 'http'
  | 'network'
  | 'empty_response'
  | 'invalid_json'
  | 'invalid_response'
  | 'unknown'

export class GeminiError extends Error {
  readonly code: GeminiErrorCode
  readonly status: number | null

  constructor(code: GeminiErrorCode, status: number | null = null) {
    super(code)
    this.name = 'GeminiError'
    this.code = code
    this.status = status
  }
}

export interface CallGeminiOptions {
  apiKey: string
  model: string
  prompt: string
  responseSchema: object
  timeoutMs?: number
  /** Délai avant l'unique retry (429 / réseau). */
  retryDelayMs?: number
  /** Niveau de raisonnement demandé (Gemini 3+) — `high` par défaut. */
  thinkingLevel?: 'low' | 'medium' | 'high'
}

export const DEFAULT_TIMEOUT_MS = 20_000
export const DEFAULT_RETRY_DELAY_MS = 2_000
export const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

/** Retire les fences markdown autour d'un JSON. */
export function stripMarkdownFences(text: string): string {
  const trimmed = text.trim()
  const fenced = /^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/.exec(trimmed)
  if (fenced) return fenced[1].trim()
  return trimmed
}

/** Gemini 3 et suivants refusent les paramètres d'échantillonnage historiques. */
function supportsTemperature(model: string): boolean {
  return !/^gemini-(3|4)/.test(model)
}

function supportsThinkingLevel(model: string): boolean {
  return /^gemini-(2\.5|3|4)/.test(model)
}

function buildRequestBody(options: CallGeminiOptions): Record<string, unknown> {
  const level = options.thinkingLevel ?? DEFAULT_GEMINI_THINKING_LEVEL
  const generationConfig: Record<string, unknown> = {
    responseMimeType: 'application/json',
    responseSchema: options.responseSchema,
  }
  if (supportsTemperature(options.model)) generationConfig.temperature = 0.4
  if (supportsThinkingLevel(options.model)) generationConfig.thinkingConfig = { thinkingLevel: level }

  return {
    contents: [{ role: 'user', parts: [{ text: options.prompt }] }],
    generationConfig,
  }
}

interface GeminiPart {
  text?: string
  thought?: boolean
}

interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] } }[]
}

function extractText(data: GeminiResponse): string {
  const parts = data.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts) || parts.length === 0) throw new GeminiError('empty_response')

  const first = parts[0]
  if (first?.thought !== true && typeof first?.text === 'string' && first.text.trim() !== '') {
    return stripMarkdownFences(first.text)
  }

  const merged = parts
    .filter((part) => part.thought !== true && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('')
    .trim()
  if (merged === '') throw new GeminiError('empty_response')
  return stripMarkdownFences(merged)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function requestOnce(options: CallGeminiOptions): Promise<string> {
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetch(`${GEMINI_ENDPOINT}/${options.model}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': options.apiKey,
      },
      body: JSON.stringify(buildRequestBody(options)),
      signal: controller.signal,
    })
  } catch {
    throw new GeminiError('network')
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    const status = response.status
    if (status === 401 || status === 403) throw new GeminiError('invalid_key', status)
    if (status === 429) throw new GeminiError('rate_limited', status)
    if (status === 404) throw new GeminiError('model_not_found', status)
    throw new GeminiError('http', status)
  }

  let data: GeminiResponse
  try {
    data = (await response.json()) as GeminiResponse
  } catch {
    throw new GeminiError('empty_response')
  }

  return extractText(data)
}

/**
 * Appel REST Gemini. Une seule nouvelle tentative après `retryDelayMs`
 * uniquement pour 429 et erreur réseau.
 */
export async function callGemini(options: CallGeminiOptions): Promise<string> {
  try {
    return await requestOnce(options)
  } catch (error) {
    const retryable =
      error instanceof GeminiError && (error.code === 'rate_limited' || error.code === 'network')
    if (!retryable) throw error
    await sleep(options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS)
    return requestOnce(options)
  }
}

/** Message lisible (français) pour une erreur Gemini. */
export function describeGeminiError(error: unknown): string {
  if (error instanceof GeminiError) {
    switch (error.code) {
      case 'invalid_key':
        return 'Clé Gemini invalide ou refusée (401/403).'
      case 'rate_limited':
        return 'Quota Gemini atteint, réessaie plus tard.'
      case 'model_not_found':
        return 'Modèle introuvable : vérifie le nom du modèle.'
      case 'network':
        return 'Réseau indisponible ou délai dépassé.'
      case 'empty_response':
        return 'Réponse vide du modèle.'
      case 'invalid_json':
        return 'Le modèle n’a pas renvoyé un JSON valide.'
      case 'invalid_response':
        return 'Réponse du modèle non conforme au schéma.'
      case 'http':
        return `Erreur HTTP ${error.status ?? ''}`.trim()
      default:
        return 'Erreur inconnue.'
    }
  }
  return 'Erreur inconnue.'
}
