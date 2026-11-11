import { buildEnrichedChronology } from './statsEngine'
import {
  formatIsoToFr,
  formatNumberFr,
  SECTION_LABELS,
  todayISODate,
  type CoachSessionPlan,
  type Exercise,
  type ExerciseEntry,
  type ExercisePlan,
  type SectionId,
  type TargetSet,
} from './types'

function roundWeight(value: number): number {
  return Math.max(0, Math.round(value * 100) / 100)
}

/** Un objectif daté d'aujourd'hui ou du futur n'est pas encore une séance réalisée. */
export function isPendingObjective(entry: ExerciseEntry, todayIso = todayISODate()): boolean {
  return Boolean(entry.wasObjective && entry.date && entry.date >= todayIso)
}

function resolveIntendedWarmupWeight(
  warmupWeight: number,
  note: string | undefined,
  firstWorkWeight: number,
): number {
  if (!note) return warmupWeight
  const m = /pas\s+trouv[eé]\s+(\d+(?:[.,]\d+)?)/i.exec(note)
  if (!m) return warmupWeight
  const intended = Number(m[1].replace(',', '.'))
  if (Number.isFinite(intended) && intended > 0 && (firstWorkWeight <= 0 || intended < firstWorkWeight)) {
    return intended
  }
  return warmupWeight
}

export function getExerciseVariants(exercise: Exercise, todayIso = todayISODate()): string[] {
  const realized = exercise.entries.filter(
    (e) => !e.skipOnly && e.sets.length > 0 && !isPendingObjective(e, todayIso),
  )
  if (realized.length === 0) return []
  const chrono = buildEnrichedChronology({ ...exercise, entries: realized })
  const seen = new Set<string>()
  // Du plus récent au plus ancien pour mettre les variantes récentes en premier
  for (let i = chrono.length - 1; i >= 0; i -= 1) {
    seen.add(chrono[i].variant)
  }
  const list = Array.from(seen)
  if (list.includes('Standard')) {
    return ['Standard', ...list.filter((v) => v !== 'Standard')]
  }
  return list
}

export function getLatestEntry(
  exercise: Exercise,
  todayIso = todayISODate(),
  variant?: string,
): ExerciseEntry | null {
  const realized = exercise.entries.filter(
    (e) => !e.skipOnly && e.sets.length > 0 && !isPendingObjective(e, todayIso),
  )
  if (realized.length === 0) return null

  const chrono = buildEnrichedChronology({ ...exercise, entries: realized })
  if (chrono.length === 0) return realized[0] ?? null

  if (variant) {
    for (let i = chrono.length - 1; i >= 0; i -= 1) {
      if (chrono[i].variant === variant) return chrono[i].entry
    }
    return realized[0] ?? null
  }

  // Si la toute dernière séance est un dépannage isolé d'une seule séance sur une autre
  // variante alors que les 2+ séances précédentes étaient sur la variante principale Standard
  // (ex: 03/11 Calf debout après 26/10 et 20/10 sur Machine assis), reprend la dernière séance Standard.
  const latestChrono = chrono[chrono.length - 1]
  if (
    latestChrono &&
    latestChrono.variant !== 'Standard' &&
    !latestChrono.isPrimaryVariant &&
    chrono.length >= 3 &&
    chrono[chrono.length - 2].variant === 'Standard' &&
    chrono[chrono.length - 3].variant === 'Standard'
  ) {
    return chrono[chrono.length - 2].entry
  }

  return realized[0] ?? null
}

export function getLatestSectionDate(
  exercises: readonly Exercise[],
  section: SectionId,
  todayIso = todayISODate(),
): string | null {
  let latest: string | null = null
  for (const ex of exercises) {
    if (ex.section !== section) continue
    for (const entry of ex.entries) {
      if (entry.skipOnly || !entry.date || isPendingObjective(entry, todayIso)) continue
      if (latest === null || entry.date > latest) {
        latest = entry.date
      }
    }
  }
  return latest
}

/**
 * RÈGLE DE SÉLECTION DU JOUR :
 * Compare la date la plus récente de "Up" et celle de "Jambes".
 * Si la dernière enregistrée est "Jambes", aujourd'hui c'est HAUT DU CORPS.
 * Si c'est "Up", aujourd'hui c'est JAMBES.
 */
export function getRecommendedSection(exercises: readonly Exercise[]): {
  recommended: SectionId
  upLastDate: string | null
  legsLastDate: string | null
  reason: string
} {
  const upLastDate = getLatestSectionDate(exercises, 'up')
  const legsLastDate = getLatestSectionDate(exercises, 'legs')

  if (upLastDate && legsLastDate) {
    if (upLastDate > legsLastDate) {
      return {
        recommended: 'legs',
        upLastDate,
        legsLastDate,
        reason: `Dernière séance : Haut le ${formatIsoToFr(upLastDate)} (Jambes le ${formatIsoToFr(legsLastDate)}) → place aux Jambes.`,
      }
    }
    return {
      recommended: 'up',
      upLastDate,
      legsLastDate,
      reason: `Dernière séance : Jambes le ${formatIsoToFr(legsLastDate)} (Haut le ${formatIsoToFr(upLastDate)}) → place au Haut du corps.`,
    }
  }

  if (upLastDate && !legsLastDate) {
    return {
      recommended: 'legs',
      upLastDate,
      legsLastDate,
      reason: `Dernière séance : Haut le ${formatIsoToFr(upLastDate)} → place aux Jambes.`,
    }
  }

  return {
    recommended: 'up',
    upLastDate,
    legsLastDate,
    reason: legsLastDate
      ? `Dernière séance : Jambes le ${formatIsoToFr(legsLastDate)} → place au Haut du corps.`
      : 'Commence par Haut du corps (Up) ou Jambes (Legs).',
  }
}

export function computeExerciseDdpPlan(exercise: Exercise, variant?: string): ExercisePlan {
  const [minReps, maxReps] = exercise.repRange
  const step = exercise.unit === 'bodyweight' ? 0 : exercise.weightStep
  const restSeconds = exercise.defaultRestSeconds
  const latest = getLatestEntry(exercise, todayISODate(), variant)

  if (!latest || latest.sets.length === 0) {
    return {
      exerciseId: exercise.id,
      restSeconds,
      tip: `Première séance enregistrée — vise ${minReps} à ${maxReps} reps propres.`,
      sets: [0, 1, 2].map(() => ({
        weight: 0,
        repsMin: minReps,
        repsMax: maxReps,
        suggestedReps: minReps,
      })),
    }
  }

  const warmups = latest.sets.filter((s) => s.isWarmup)
  let workSets = latest.sets.filter((s) => !s.isWarmup)
  if (workSets.length === 0) {
    workSets = latest.sets
  }

  const firstWork = workSets[0]
  const targetSets: TargetSet[] = warmups.map((w) => ({
    weight: resolveIntendedWarmupWeight(w.weight, w.note, firstWork.weight),
    repsMin: Math.round(w.reps),
    repsMax: Math.round(w.reps),
    suggestedReps: Math.round(w.reps),
    isWarmup: true,
  }))

  const s1HitTop = firstWork.reps >= maxReps && step > 0
  const s1Weight = s1HitTop ? roundWeight(firstWork.weight + step) : firstWork.weight
  const resetRepMax = Math.min(maxReps, minReps + 2)

  if (s1HitTop) {
    targetSets.push({
      weight: s1Weight,
      repsMin: minReps,
      repsMax: resetRepMax,
      suggestedReps: resetRepMax,
    })
  } else {
    const nextRep = Math.min(maxReps, Math.floor(firstWork.reps) + 1)
    targetSets.push({
      weight: s1Weight,
      repsMin: nextRep,
      repsMax: nextRep,
      suggestedReps: nextRep,
    })
  }

  let bumpedSecondary = 0
  for (let i = 1; i < workSets.length; i += 1) {
    const current = workSets[i]
    const hitTop = current.reps >= maxReps && step > 0
    const nextWeightCandidate = roundWeight(current.weight + step)
    const canBump =
      hitTop && (s1HitTop ? nextWeightCandidate <= s1Weight : nextWeightCandidate < s1Weight)

    if (canBump) {
      bumpedSecondary += 1
      targetSets.push({
        weight: nextWeightCandidate,
        repsMin: minReps,
        repsMax: resetRepMax,
        suggestedReps: resetRepMax,
      })
    } else if (current.reps >= maxReps) {
      targetSets.push({
        weight: current.weight,
        repsMin: maxReps,
        repsMax: maxReps,
        suggestedReps: maxReps,
      })
    } else {
      const nextRep = Math.min(maxReps, Math.floor(current.reps) + 1)
      targetSets.push({
        weight: current.weight,
        repsMin: nextRep,
        repsMax: nextRep,
        suggestedReps: nextRep,
      })
    }
  }

  let tip: string
  if (s1HitTop) {
    tip = `Série 1 validée à ${maxReps} reps → monte à ${formatNumberFr(s1Weight)}kg (${minReps}-${resetRepMax} reps).`
  } else if (bumpedSecondary > 0) {
    tip = `Garde ${formatNumberFr(s1Weight)}kg en Série 1 (+1 rep) et monte la série secondaire à ${maxReps} reps validées.`
  } else {
    const targetRep = targetSets.find((s) => !s.isWarmup)?.suggestedReps ?? minReps
    tip = `Conserve ${formatNumberFr(s1Weight)}kg et vise +1 rep (objectif ${targetRep} reps en S1).`
  }

  const allNotes = [latest.note, ...latest.sets.map((s) => s.note ?? '')].join(' ')
  if (/micro[\s-]*pause|petite\s*pause|quelques\s*secondes\s*de\s*pause/i.test(allNotes)) {
    tip += ' Valide les reps d’une traite sans micro-pause.'
  } else if (/1\s*(?:main|bras)?\s*par\s*1/i.test(allNotes)) {
    tip += ' Même repère des deux côtés (1 par 1).'
  }

  return {
    exerciseId: exercise.id,
    sets: targetSets,
    restSeconds,
    tip,
  }
}

export function buildDdpSessionPlan(
  exercises: readonly Exercise[],
  section: SectionId,
): CoachSessionPlan {
  const activeExercises = exercises.filter((e) => e.section === section && e.active)
  const plans: Record<string, ExercisePlan> = {}

  const weightIncreases: string[] = []
  const repIncreases: string[] = []

  for (const ex of activeExercises) {
    const plan = computeExerciseDdpPlan(ex)
    plans[ex.id] = plan

    const latest = getLatestEntry(ex)
    const prevFirstWork = latest?.sets.find((s) => !s.isWarmup) ?? latest?.sets[0]
    const nextFirstWork = plan.sets.find((s) => !s.isWarmup) ?? plan.sets[0]

    if (prevFirstWork && nextFirstWork && nextFirstWork.weight > prevFirstWork.weight) {
      weightIncreases.push(
        `${ex.name} (${formatNumberFr(nextFirstWork.weight)}kg × ${nextFirstWork.repsMin}-${nextFirstWork.repsMax})`,
      )
    } else if (nextFirstWork) {
      repIncreases.push(
        `${ex.name} (${formatNumberFr(nextFirstWork.weight)}kg → +1 rep)`,
      )
    }
  }

  const summaryLines: string[] = [
    `Séance ${SECTION_LABELS[section].title} calibrée par Double Progression Dynamique (8–12 poly / 12–15 iso).`,
  ]
  if (weightIncreases.length > 0) {
    summaryLines.push(`Hausse de charge sur : ${weightIncreases.join(', ')}.`)
  }
  if (repIncreases.length > 0) {
    summaryLines.push(`Progression +1 répétition à charge fixe sur : ${repIncreases.join(', ')}.`)
  }

  return {
    section,
    generatedAt: Date.now(),
    source: 'ddp',
    model: null,
    summaryLines,
    exercises: plans,
  }
}

export function formatExercisePlanInline(plan: ExercisePlan, unit: 'kg' | 'bodyweight'): string {
  const groups: { weight: number; isWarmup: boolean; labels: string[] }[] = []
  for (const s of plan.sets) {
    const label = s.repsMin === s.repsMax ? String(s.repsMin) : `${s.repsMin}-${s.repsMax}`
    const prev = groups[groups.length - 1]
    if (prev && prev.weight === s.weight && prev.isWarmup === Boolean(s.isWarmup)) {
      prev.labels.push(label)
    } else {
      groups.push({
        weight: s.weight,
        isWarmup: Boolean(s.isWarmup),
        labels: [label],
      })
    }
  }

  return groups
    .map((g) => {
      const w = unit === 'bodyweight' && g.weight === 0 ? 'PDC' : `${formatNumberFr(g.weight)}kg`
      const prefix = g.isWarmup ? 'Éch. ' : ''
      return `${prefix}${w} × ${g.labels.join(', ')}`
    })
    .join(' | ')
}
