import { computeExerciseDdpPlan } from './ddp'
import { DEFAULT_NOTEPAD_PREAMBLE } from './defaultNotepad'
import { inferExerciseMeta } from './parser'
import { buildEnrichedChronology } from './statsEngine'
import {
  createId,
  formatIsoToFr,
  normalizeName,
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
import { buildCoachPrompt, guardExercisePlan } from './coachPrompt'
import { generateJson, getGeminiConfig, postGenerateContent } from './geminiClient'

export * from './geminiClient'
export { buildCoachPrompt, computeExerciseTrend, guardExercisePlan } from './coachPrompt'

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
  return `plan-v3:${section}:${cleanPreamble.length}:${cleanPreamble.slice(0, 64)}:${cleanPreamble.slice(-64)}::${exSig}`
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
  return buildCoachPrompt({
    section: params.section,
    exercises: params.exercises,
    athleteRules: extractAthleteRulesFromPreamble(params.preamble),
    settings: params.settings,
    todayIso: todayISODate(),
  })
}

interface RawGeminiPlanJson {
  summary_lines?: unknown
  exercises?: unknown
}

export const COACH_REQUEST_TAG = 'coach-plan'

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

  const { text, model: usedModel } = await generateJson({
    apiKey: settings.apiKey,
    prompt,
    responseSchema: COACH_PLAN_SCHEMA,
    priority,
    tag: COACH_REQUEST_TAG,
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

      byId[ex.id] = guardExercisePlan(
        ex,
        { exerciseId: ex.id, sets: cleanSets, restSeconds, tip },
        computeExerciseDdpPlan(ex),
      ).plan
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
    model: usedModel,
    fingerprint,
    summaryLines:
      summaryLines.length > 0 ? summaryLines : [`Objectifs générés (${usedModel}).`],
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
    timeoutMs: 150_000,
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
    // Réflexion HIGH : mesuré 2 à 4 min sur un historique complet, et plus de repli possible.
    timeoutMs: 300_000,
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
    model: getGeminiConfig().model,
    headline,
    bulletPoints,
    exercises: byId,
  }
}
