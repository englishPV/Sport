/**
 * Prompt du coach et garde-fous sur sa réponse. Fonctions pures.
 *
 * Principes : l'application choisit la séance (jamais l'IA), l'IA ne reçoit que
 * les exercices de cette séance et leurs 3 dernières séances, les faits
 * calculables (base DDP, tendance, charges disponibles) sont calculés ici,
 * et toute charge hors limites revient à la base DDP.
 */
import { computeExerciseDdpPlan } from './ddp'
import { formatEntryForNotepad } from './parser'
import { buildEnrichedChronology } from './statsEngine'
import {
  SECTION_LABELS,
  formatIsoToFr,
  formatNumberFr,
  type AppSettings,
  type Exercise,
  type ExerciseEntry,
  type ExercisePlan,
  type SectionId,
} from './types'

export const COACH_HISTORY_DEPTH = 3

function realEntries(ex: Exercise): ExerciseEntry[] {
  return ex.entries.filter((e) => !e.skipOnly && e.sets.length > 0)
}

function kg(value: number, unit: Exercise['unit']): string {
  return unit === 'kg' && value > 0 ? `${formatNumberFr(value)} kg` : 'poids du corps'
}

export type ExerciseTrend = 'nouveau' | 'progression' | 'stable' | 'plateau'

/** Tendance sur la variante en cours, calculée et non laissée à l'appréciation de l'IA. */
export function computeExerciseTrend(ex: Exercise): ExerciseTrend {
  const newestFirst = [...buildEnrichedChronology(ex)].reverse().filter((item) => item.hasValidWeight || ex.unit !== 'kg')
  if (newestFirst.length === 0) return 'nouveau'
  const sameVariant = newestFirst.filter((item) => item.variant === newestFirst[0].variant).slice(0, COACH_HISTORY_DEPTH)
  if (sameVariant.length < 2) return 'nouveau'
  const [last, previous, older] = sameVariant.map((item) => item.bestE1rm)
  if (last > previous * 1.005) return 'progression'
  if (older !== undefined && last <= previous && last <= older) return 'plateau'
  return 'stable'
}

const TREND_TEXT: Record<ExerciseTrend, string> = {
  nouveau: 'moins de 2 séances sur cette variante : pas de tendance, reste prudent',
  progression: 'en progression sur la dernière séance',
  stable: 'stable',
  plateau: 'PLATEAU : aucune progression sur 3 séances de suite',
}

function describeBaseline(plan: ExercisePlan, unit: Exercise['unit']): string {
  const sets = plan.sets.map((s) =>
    s.isWarmup
      ? `échauffement ${kg(s.weight, unit)} × ${s.suggestedReps}`
      : `${kg(s.weight, unit)} × ${s.repsMin}-${s.repsMax} (cible ${s.suggestedReps})`,
  )
  return `${sets.join(' | ')} ; repos ${plan.restSeconds} s`
}

function describeExercise(ex: Exercise, index: number): string {
  const entries = realEntries(ex)
  const variantById = new Map(buildEnrichedChronology(ex).map((item) => [item.entry.id, item.variant]))
  const usedWeights = Array.from(
    new Set(
      entries
        .slice(0, 8)
        .flatMap((e) => e.sets)
        .filter((s) => s.weight > 0)
        .map((s) => s.weight),
    ),
  ).sort((a, b) => a - b)

  const sessions = entries.slice(0, COACH_HISTORY_DEPTH).map((entry) => {
    const variant = variantById.get(entry.id)
    const line = formatEntryForNotepad(entry, ex.unit).replace(/^[•\-*]\s*/, '')
    return `  - ${line}${variant && variant !== 'Standard' ? `  [variante : ${variant}]` : ''}`
  })
  const contextNotes = ex.entries
    .filter((e) => e.skipOnly && e.note.trim())
    .slice(0, 2)
    .map((e) => `  - note : ${e.note.trim()}`)

  return [
    `### ${index + 1}. ${ex.name}`,
    `exercise_id : ${ex.id}`,
    `type : ${ex.category === 'poly' ? 'polyarticulaire' : 'isolation'}, fourchette ${ex.repRange[0]}-${ex.repRange[1]} reps ; palier ${ex.unit === 'kg' ? `${formatNumberFr(ex.weightStep)} kg` : 'aucun (poids du corps)'} ; repos habituel ${ex.defaultRestSeconds} s`,
    usedWeights.length > 0 ? `charges déjà utilisées : ${usedWeights.map((w) => formatNumberFr(w)).join(', ')} kg` : '',
    `tendance (calculée) : ${TREND_TEXT[computeExerciseTrend(ex)]}`,
    sessions.length > 0
      ? `dernières séances, la plus récente en premier :\n${sessions.join('\n')}`
      : 'aucune séance enregistrée : propose une charge de départ prudente dans la fourchette',
    ...contextNotes,
    `base DDP calculée : ${describeBaseline(computeExerciseDdpPlan(ex), ex.unit)}`,
  ]
    .filter(Boolean)
    .join('\n')
}

export function buildCoachPrompt(params: {
  section: SectionId
  exercises: readonly Exercise[]
  /** Règles personnelles déjà débarrassées des consignes de mise en forme. */
  athleteRules: string
  settings: Pick<AppSettings, 'profileHeightCm' | 'profileWeightKg'>
  todayIso: string
}): string {
  const { section, exercises, athleteRules, settings, todayIso } = params
  const active = exercises.filter((e) => e.section === section && e.active)
  const title = SECTION_LABELS[section].title
  const profile =
    settings.profileHeightCm > 0 && settings.profileWeightKg > 0
      ? `Athlète : ${settings.profileHeightCm} cm, ${formatNumberFr(settings.profileWeightKg)} kg, pratiquant naturel, objectif hypertrophie.`
      : 'Athlète : pratiquant naturel, objectif hypertrophie.'

  return `Tu es un entraîneur de musculation expérimenté. Tu fixes les charges et répétitions d'UNE séance déjà choisie par l'application : ${title}.
Ne choisis pas la séance, ne parle d'aucun exercice absent de la liste, ne réécris pas le carnet.
Date : ${formatIsoToFr(todayIso)}. ${profile}

MÉTHODE, par ordre de priorité
1. Les consignes de l'athlète (plus bas) priment sur tout le reste.
2. Double progression, série par série, à partir de la séance la plus récente (« Série 1 » = première série de travail, hors échauffement) :
   - polyarticulaire, fourchette 8-12 : si la Série 1 a atteint 12 reps, monte la Série 1 d'un seul palier et vise 8-10 ; les séries suivantes restent à l'ancienne charge tant qu'elles n'ont pas atteint 12. Sinon même charge et +1 rep par série, plafonné à 12.
   - isolation, fourchette 12-15 : à 15 reps, monte d'un palier et vise 12-14. Sinon même charge et +1 rep.
   La « base DDP calculée » applique déjà cette règle : pars d'elle et ne t'en écarte que pour une raison tirée des données.
3. Ajustements d'entraîneur, seulement s'ils sont justifiés par une donnée citée :
   - commentaire de l'athlète (« trop facile », « j'aurais pu faire 13 », « pas trouvé 10 », douleur, fatigue, souffle) : suis-le. Douleur ou gêne : ne monte pas.
   - échec noté, ou chute de 3 reps ou plus entre deux séries à la même charge : garde la charge, cible réaliste, allonge le repos de 30 s (maximum 240 s en polyarticulaire, 150 s en isolation).
   - PLATEAU signalé : ne redonne pas la même cible une fois de plus. Soit baisse d'un palier et repars du haut de la fourchette, soit garde la charge et demande +1 rep sur une seule série. Explique-le dans tip.
   - effort visé : 1 à 2 reps de réserve sur les séries de travail ; l'échec n'est utile que sur la dernière série d'un exercice d'isolation.
   - jamais plus d'un palier de hausse sur une série, jamais charge ET reps en hausse sur la même série.
   - variantes de machine : ne compare jamais deux variantes entre elles ; repars de la dernière séance de la variante la plus récente.
4. Structure inchangée : même nombre de séries que d'habitude, mêmes échauffements (is_warmup true), charges réellement disponibles (charges déjà utilisées, ou un palier au-dessus). N'invente ni série ni échauffement.

LIMITES
Tu ne connais que les 3 dernières séances de chaque exercice. N'invente aucun chiffre. Si une donnée manque ou se contredit, reprends la base DDP calculée telle quelle.

SORTIE : JSON strict conforme au schéma
- exercises : un objet par exercice de la liste, avec son exercise_id exact, dans le même ordre.
- sets : dans l'ordre d'exécution ; weight en kg (0 au poids du corps) ; reps_min et reps_max = fourchette de la série ; target_reps = objectif précis du jour.
- rest_seconds : repos entre séries de travail.
- tip : une consigne concrète de moins de 120 caractères (ce qui change aujourd'hui et pourquoi).
- summary_lines : 2 à 4 phrases courtes en français, en tutoyant l'athlète, virgule décimale (« 22,5 kg »), sur les choix principaux.
- Exactement autant de séries de travail que la base DDP calculée pour chaque exercice.

CONSIGNES DE L'ATHLÈTE
${athleteRules.trim() || '(aucune)'}

EXERCICES DE LA SÉANCE ${title.toUpperCase()}
${active.map(describeExercise).join('\n\n')}`
}

export interface GuardResult {
  plan: ExercisePlan
  /** Vrai si la proposition de l'IA a été écartée ou complétée. */
  corrected: boolean
}

/**
 * Garde-fou : une proposition incohérente avec l'historique (charge hors limites,
 * nombre de séries fantaisiste, échauffement oublié) revient à la base DDP.
 */
export function guardExercisePlan(ex: Exercise, ai: ExercisePlan, ddp: ExercisePlan): GuardResult {
  const aiWork = ai.sets.filter((s) => !s.isWarmup)
  const ddpWork = ddp.sets.filter((s) => !s.isWarmup)
  const fallback: GuardResult = { plan: ddp, corrected: true }

  if (aiWork.length === 0) return fallback
  if (ddpWork.length > 0 && Math.abs(aiWork.length - ddpWork.length) > 1) return fallback
  // Même nombre de séries de travail qu'à l'habitude : série manquante reprise de la base DDP, série en trop retirée.
  let countFixed = false
  if (ddpWork.length > 0 && aiWork.length !== ddpWork.length) {
    countFixed = true
    if (aiWork.length > ddpWork.length) aiWork.length = ddpWork.length
    else aiWork.push(...ddpWork.slice(aiWork.length))
  }

  const recentWork = realEntries(ex)
    .slice(0, COACH_HISTORY_DEPTH)
    .flatMap((e) => e.sets)
    .filter((s) => !s.isWarmup && s.weight > 0)
    .map((s) => s.weight)

  if (ex.unit === 'kg' && recentWork.length > 0) {
    const highest = Math.max(...recentWork)
    const ceiling = highest + Math.max(ex.weightStep, highest * 0.1)
    const floor = Math.min(...recentWork) * 0.6
    if (aiWork.some((s) => s.weight > ceiling + 1e-6 || s.weight < floor - 1e-6)) return fallback
  }

  const ddpWarmups = ddp.sets.filter((s) => s.isWarmup)
  const aiWarmups = ai.sets.filter((s) => s.isWarmup)
  const lightestWork = Math.min(...aiWork.map((s) => s.weight))
  const warmupsBroken =
    (ddpWarmups.length > 0 && aiWarmups.length === 0) ||
    (ddpWarmups.length === 0 && aiWarmups.length > 0) ||
    (ex.unit === 'kg' && aiWarmups.some((s) => s.weight > lightestWork))
  if (warmupsBroken) {
    return { plan: { ...ai, sets: [...ddpWarmups, ...aiWork] }, corrected: true }
  }
  if (countFixed) return { plan: { ...ai, sets: [...aiWarmups, ...aiWork] }, corrected: true }
  return { plan: ai, corrected: false }
}
