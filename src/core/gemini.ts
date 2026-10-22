import { computeExerciseDdpPlan } from './ddp'
import { DEFAULT_NOTEPAD_PREAMBLE } from './defaultNotepad'
import { formatSetsForNotepad, inferExerciseMeta } from './parser'
import { buildEnrichedChronology } from './statsEngine'
import {
  createId,
  formatIsoToFr,
  normalizeName,
  SECTION_LABELS,
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

export function detectApiProvider(apiKey: string): {
  kind: ApiProviderKind
  label: string
} {
  const trimmed = apiKey.trim()
  if (trimmed.startsWith('AQ.')) {
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

function buildGenerationConfig(
  responseSchema: Record<string, unknown>,
  thinkingMode: 'level' | 'budget' | 'none' = 'level',
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

interface RawGeminiResponse {
  candidates?: { content?: { parts?: RawGeminiPart[] } }[]
  error?: { message?: string; status?: string; code?: number }
}

function stripFences(raw: string): string {
  const trimmed = raw.trim()
  const match = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(trimmed)
  return match ? match[1].trim() : trimmed
}

function extractResponseText(payload: RawGeminiResponse): string {
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

async function postGenerateContent(params: {
  apiKey: string
  prompt: string
  responseSchema: Record<string, unknown>
  timeoutMs?: number
}): Promise<string> {
  const { apiKey, prompt, responseSchema, timeoutMs = 28_000 } = params
  const cleanKey = apiKey.trim()
  if (!cleanKey) {
    throw new Error('Clé API manquante.')
  }

  const sendToUrl = async (
    url: string,
    thinkingMode: 'level' | 'budget' | 'none' = 'level',
  ): Promise<Response> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': cleanKey,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: buildGenerationConfig(responseSchema, thinkingMode),
        }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
  }

  let targetUrl = buildEndpointUrl(cleanKey, 'v1beta1')
  let response: Response
  let preParsedErrorMessage = ''
  try {
    response = await sendToUrl(targetUrl, 'level')
    if (response.status === 404 && detectApiProvider(cleanKey).kind === 'vertex_express') {
      targetUrl = buildEndpointUrl(cleanKey, 'v1')
      response = await sendToUrl(targetUrl, 'level')
    }
    if (response.status === 400) {
      try {
        const errBody = (await response.json()) as RawGeminiResponse
        preParsedErrorMessage = errBody.error?.message ?? ''
      } catch {
        preParsedErrorMessage = ''
      }
      if (/thinking/i.test(preParsedErrorMessage)) {
        preParsedErrorMessage = ''
        response = await sendToUrl(targetUrl, 'budget')
        if (response.status === 400) {
          response = await sendToUrl(targetUrl, 'none')
        }
      }
    }
  } catch {
    throw new Error('Réseau indisponible ou délai dépassé.')
  }

  if (!response.ok) {
    let detail = preParsedErrorMessage ? ` (${preParsedErrorMessage})` : ''
    if (!detail) {
      try {
        const errBody = (await response.json()) as RawGeminiResponse
        detail = errBody.error?.message ? ` (${errBody.error.message})` : ''
      } catch {
        // ignore
      }
    }
    throw new Error(`Erreur HTTP ${response.status}${detail}`)
  }

  const data = (await response.json()) as RawGeminiResponse
  return extractResponseText(data)
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
      timeoutMs: 15_000,
    })
    return {
      ok: true,
      message: `OK (${GEMINI_MODEL} · HIGH)`,
    }
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Échec du test.',
    }
  }
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
                is_warmup: { type: 'BOOLEAN' },
              },
              required: ['weight', 'reps_min', 'reps_max', 'is_warmup'],
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

  const payload = activeExercises.map((ex) => ({
    exercise_id: ex.id,
    name: ex.name,
    category: ex.category === 'poly' ? 'polyarticulaire (8-12 reps)' : 'isolation (12-15 reps)',
    weight_step_kg: ex.weightStep,
    default_rest_seconds: ex.defaultRestSeconds,
    recent_sessions: ex.entries
      .filter((e) => !e.skipOnly)
      .slice(0, 5)
      .map((entry) => ({
        date: formatIsoToFr(entry.date),
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
      })),
  }))

  return `Tu es un coach scientifique d'hypertrophie appliquant la Double Progression Dynamique (DDP).
Profil athlète : ${settings.profileHeightCm} cm, ${settings.profileWeightKg} kg (hypertrophie).
Séance à planifier : ${SECTION_LABELS[section].title}.

Consignes personnelles de l'athlète :
${(preamble ?? DEFAULT_NOTEPAD_PREAMBLE).trim()}

INSTRUCTIONS CRUCIALES :
1. Regarde la séance la plus récente (recent_sessions[0]) de chaque exercice, ses répétitions exactes, ses séries d'échauffement, ses échecs (reached_failure) ET surtout les commentaires de l'athlète (user_comment).
2. Adapte intelligemment la charge, les répétitions ou le repos si le commentaire signale :
   - changement de machine (ex: "Leg press poids dans le dos", "Wide chest press") -> ajuste aux sensations décrites ;
   - "trop facile" / "j'aurais pu faire plus" -> autorise une progression plus franche ;
   - douleur, gêne, souffle court ou échec prématuré -> stabilise la charge et ajuste le repos.
3. Sinon applique strictement la DDP série par série (8-12 poly, 12-15 iso) en conservant les séries d'échauffement (is_warmup: true).
4. Utilise EXACTEMENT les exercise_id fournis.

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
}): Promise<CoachSessionPlan> {
  const { section, exercises, preamble, settings } = params
  const activeExercises = exercises.filter((e) => e.section === section && e.active)
  const prompt = buildCoachPromptForSection({ section, exercises, preamble, settings })

  const text = await postGenerateContent({
    apiKey: settings.apiKey,
    prompt,
    responseSchema: COACH_PLAN_SCHEMA,
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
        const isWarmup = Boolean(sObj.is_warmup)
        cleanSets.push({
          weight,
          repsMin: rMin,
          repsMax: rMax,
          suggestedReps: rMax,
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
    timeoutMs: 35_000,
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
    timeoutMs: 35_000,
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
