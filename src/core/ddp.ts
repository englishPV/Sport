import {
  formatIsoToFr,
  formatNumberFr,
  SECTION_LABELS,
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

export function getLatestEntry(exercise: Exercise): ExerciseEntry | null {
  return exercise.entries.find((e) => !e.skipOnly && e.sets.length > 0) ?? null
}

export function getLatestSectionDate(
  exercises: readonly Exercise[],
  section: SectionId,
): string | null {
  let latest: string | null = null
  for (const ex of exercises) {
    if (ex.section !== section) continue
    for (const entry of ex.entries) {
      if (entry.skipOnly || !entry.date) continue
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

export function computeExerciseDdpPlan(exercise: Exercise): ExercisePlan {
  const [minReps, maxReps] = exercise.repRange
  const step = exercise.unit === 'bodyweight' ? 0 : exercise.weightStep
  const restSeconds = exercise.defaultRestSeconds
  const latest = getLatestEntry(exercise)

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

  const targetSets: TargetSet[] = warmups.map((w) => ({
    weight: w.weight,
    repsMin: Math.round(w.reps),
    repsMax: Math.round(w.reps),
    suggestedReps: Math.round(w.reps),
    isWarmup: true,
  }))

  const firstWork = workSets[0]
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
