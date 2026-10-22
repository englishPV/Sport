import { formatSetsForDisplay } from './parser'
import {
  formatIsoShort,
  formatIsoToFr,
  formatNumberFr,
  type AiExerciseStatInsight,
  type Exercise,
  type ExerciseEntry,
  type WorkoutSet,
} from './types'

export type ChartMetric = 'maxWeight' | 'reps' | 'volume'

export interface EnrichedHistoryEntry {
  entry: ExerciseEntry
  chronoNumber: number
  displayDate: string
  shortLabel: string
  setsDisplay: string
  variant: string
  isPrimaryVariant: boolean
  hasValidWeight: boolean
  topWeight: number
  topSetRepsAtPeak: number
  bestE1rm: number
  volumeKg: number
}

function getWorkingPool(sets: readonly WorkoutSet[], unit: Exercise['unit']): WorkoutSet[] {
  const validSets =
    unit === 'kg' ? sets.filter((s) => s.weight > 0 && s.reps > 0) : sets.filter((s) => s.reps > 0)
  const nonWarmup = validSets.filter((s) => !s.isWarmup)
  return nonWarmup.length > 0 ? nonWarmup : validSets
}

function detectExplicitVariant(exercise: Exercise, note: string): string | null {
  const n = note.toLowerCase()
  if (/poulie\s+haute/.test(n)) return 'Poulie haute'
  if (/poulie\s+basse|poulis\s+basse/.test(n)) return 'Poulie basse'
  if (/dans\s+le\s+dos/.test(n)) return 'Presse poids dos'
  if (/par\s+c[oô]t[eé]/.test(n)) return 'Par côté'
  if (/machine\s*1\b/.test(n)) return 'Machine 1'
  if (/machine\s*2\b/.test(n)) return 'Machine 2'
  if (/\bcalf\b|debout/.test(n)) return 'Debout (Calf)'
  if (/prone\s+leg\s+curl/.test(n)) return 'Prone leg curl'
  if (/wide\s+chest\s+press/.test(n)) return 'Wide chest press'
  if (!/halt[eè]re/i.test(exercise.name) && /\bhalt[eè]res?\b/.test(n)) {
    return 'Haltères'
  }
  return null
}

/**
 * Enrichit l'historique d'un exercice (du plus ancien au plus récent) en détectant :
 * - les marqueurs d'équipement (ex: "• Poulis basse" dans Curl Biceps, "par côté", "Machine 1/2", "dans le dos")
 * - les poids manquants / erronés (ex: 0kg sur un exercice à charge)
 */
export function buildEnrichedChronology(exercise: Exercise): EnrichedHistoryEntry[] {
  // Parcours du plus ancien (fin du tableau) au plus récent (début du tableau)
  const rawOldestFirst = [...exercise.entries].reverse()
  const isDumbbellExercise = /halt[eè]re/i.test(exercise.name)

  let activeBlockEquipment: string | null = null
  const validChrono: { entry: ExerciseEntry; variant: string }[] = []

  for (const entry of rawOldestFirst) {
    if (entry.skipOnly || entry.sets.length === 0) {
      const marker = detectExplicitVariant(exercise, entry.note)
      if (marker) {
        activeBlockEquipment = marker
      }
      continue
    }

    let variant = detectExplicitVariant(exercise, entry.note)

    if (!variant && activeBlockEquipment) {
      // Sur un exo haltères (ex: Curl Biceps 8-12kg), un bloc à >= 15kg juste après "Poulis basse" reste sur la poulie
      const pool = getWorkingPool(entry.sets, exercise.unit)
      const maxW = pool.length > 0 ? Math.max(...pool.map((s) => s.weight)) : 0
      if (
        isDumbbellExercise &&
        /poulie/i.test(activeBlockEquipment) &&
        maxW >= 15 &&
        !/bras|main|halt[eè]re/i.test(entry.note)
      ) {
        variant = activeBlockEquipment
      } else {
        activeBlockEquipment = null
      }
    } else if (variant && variant !== activeBlockEquipment) {
      activeBlockEquipment = null
    }

    validChrono.push({
      entry,
      variant: variant ?? 'Standard',
    })
  }

  const latestVariant =
    validChrono.length > 0 ? validChrono[validChrono.length - 1].variant : 'Standard'

  return validChrono.map(({ entry, variant }, idx) => {
    const chronoNumber = idx + 1
    const pool = getWorkingPool(entry.sets, exercise.unit)
    const hasValidWeight = pool.length > 0

    let topWeight = 0
    let topSetRepsAtPeak = 0
    let bestE1rm = 0
    let volumeKg = 0

    if (hasValidWeight) {
      topWeight = Math.max(...pool.map((s) => s.weight))
      topSetRepsAtPeak = Math.max(
        ...pool.filter((s) => s.weight === topWeight).map((s) => s.reps),
      )
      bestE1rm = Math.max(
        ...pool.map((s) => Math.round(s.weight * (1 + s.reps / 30) * 10) / 10),
      )
      volumeKg = Math.round(pool.reduce((sum, s) => sum + s.weight * s.reps, 0))
    }

    return {
      entry,
      chronoNumber,
      displayDate: entry.date ? formatIsoToFr(entry.date) : `Séance #${chronoNumber}`,
      shortLabel: entry.date ? formatIsoShort(entry.date) : `#${chronoNumber}`,
      setsDisplay: formatSetsForDisplay(entry.sets, exercise.unit),
      variant,
      // "Standard" est l'équipement nominal ; si la toute dernière séance est sur une variante ponctuelle,
      // on distingue toujours clairement chaque variante.
      isPrimaryVariant: variant === latestVariant,
      hasValidWeight,
      topWeight,
      topSetRepsAtPeak,
      bestE1rm,
      volumeKg,
    }
  })
}

export function getLatestBestSetSummary(exercise: Exercise): string {
  const chrono = buildEnrichedChronology(exercise)
  const latest = [...chrono].reverse().find((c) => c.hasValidWeight)
  if (!latest) return 'Aucune séance'
  if (exercise.unit === 'bodyweight' && latest.topWeight === 0) {
    return `PDC × ${formatNumberFr(latest.topSetRepsAtPeak)}`
  }
  const variantSuffix =
    latest.variant !== 'Standard' ? ` (${latest.variant.toLowerCase()})` : ''
  return `${formatNumberFr(latest.topWeight)} kg × ${formatNumberFr(latest.topSetRepsAtPeak)}${variantSuffix}`
}

/**
 * Analyse locale rigoureuse séance N vs séance N-1 sur le même équipement :
 * ne produit jamais de faux "+4 kg" ni de "+295%" lors d'un changement de machine.
 */
export function computeSmartExerciseInsight(exercise: Exercise): AiExerciseStatInsight {
  const chrono = buildEnrichedChronology(exercise).filter((c) => c.hasValidWeight)

  if (chrono.length === 0) {
    return {
      exerciseId: exercise.id,
      badge: 'Aucune donnée',
      status: 'stable',
      summary: 'Aucune série enregistrée pour le moment.',
    }
  }

  if (chrono.length === 1) {
    const only = chrono[0]
    return {
      exerciseId: exercise.id,
      badge: `${formatNumberFr(only.topWeight)} kg × ${formatNumberFr(only.topSetRepsAtPeak)}`,
      status: 'stable',
      summary: 'Première référence enregistrée sur cet exercice.',
    }
  }

  const latest = chrono[chrono.length - 1]
  const immediatelyPrevious = chrono[chrono.length - 2]

  // Cas 1 : Changement de machine / variante sur la dernière séance (ex: Leg press poids dans le dos)
  if (latest.variant !== immediatelyPrevious.variant) {
    // Cherche s'il y a déjà eu une séance sur cette même variante auparavant
    const prevSameVariant = [...chrono.slice(0, -1)]
      .reverse()
      .find((c) => c.variant === latest.variant)

    if (!prevSameVariant) {
      return {
        exerciseId: exercise.id,
        badge: `${latest.variant} · ${formatNumberFr(latest.topWeight)} kg`,
        status: 'recalibration',
        summary: `Séance réalisée sur « ${latest.variant} » (${latest.setsDisplay}) contre « ${immediatelyPrevious.variant} » la fois précédente.`,
      }
    }

    const diffSameVar = Math.round((latest.topWeight - prevSameVariant.topWeight) * 10) / 10
    return {
      exerciseId: exercise.id,
      badge:
        diffSameVar > 0
          ? `+${formatNumberFr(diffSameVar)} kg (${latest.variant.toLowerCase()})`
          : `Retour ${latest.variant.toLowerCase()}`,
      status: diffSameVar > 0 ? 'progressing' : 'recalibration',
      summary: `Retour sur « ${latest.variant} » (${latest.setsDisplay}) après un passage sur « ${immediatelyPrevious.variant} ».`,
    }
  }

  // Cas 2 : Même équipement entre les deux dernières séances
  const weightDiff = Math.round((latest.topWeight - immediatelyPrevious.topWeight) * 10) / 10
  const repsDiffAtPeak =
    Math.round((latest.topSetRepsAtPeak - immediatelyPrevious.topSetRepsAtPeak) * 10) / 10

  if (weightDiff > 0) {
    return {
      exerciseId: exercise.id,
      badge: `+${formatNumberFr(weightDiff)} kg`,
      status: 'progressing',
      summary: `Passage de ${formatNumberFr(immediatelyPrevious.topWeight)} kg (${immediatelyPrevious.displayDate}) à ${formatNumberFr(latest.topWeight)} kg × ${formatNumberFr(latest.topSetRepsAtPeak)} (${latest.displayDate}).`,
    }
  }

  if (weightDiff === 0) {
    if (repsDiffAtPeak > 0) {
      const repWord = repsDiffAtPeak === 1 ? 'rep' : 'reps'
      return {
        exerciseId: exercise.id,
        badge: `+${formatNumberFr(repsDiffAtPeak)} ${repWord} à ${formatNumberFr(latest.topWeight)} kg`,
        status: 'progressing',
        summary: `Progression à ${formatNumberFr(latest.topWeight)} kg : ${formatNumberFr(immediatelyPrevious.topSetRepsAtPeak)} → ${formatNumberFr(latest.topSetRepsAtPeak)} reps (${latest.setsDisplay}).`,
      }
    }

    // Même top set (ex: Extensions Triceps 15kg x 11,5 -> 15kg x 11,5) : regarde le total des reps de travail
    const volDiff = latest.volumeKg - immediatelyPrevious.volumeKg
    if (volDiff > 0) {
      return {
        exerciseId: exercise.id,
        badge: `+reps sur séries suiv.`,
        status: 'progressing',
        summary: `Séries de travail plus denses à ${formatNumberFr(latest.topWeight)} kg (${latest.setsDisplay} vs ${immediatelyPrevious.setsDisplay}).`,
      }
    }

    return {
      exerciseId: exercise.id,
      badge: `Stable · ${formatNumberFr(latest.topWeight)} kg`,
      status: 'stable',
      summary: `Consolidation à ${formatNumberFr(latest.topWeight)} kg (${latest.setsDisplay} le ${latest.displayDate}).`,
    }
  }

  // Baisse de charge entre N-1 et N
  return {
    exerciseId: exercise.id,
    badge: `Ajusté · ${formatNumberFr(latest.topWeight)} kg`,
    status: 'recalibration',
    summary: `Charge ajustée de ${formatNumberFr(immediatelyPrevious.topWeight)} kg à ${formatNumberFr(latest.topWeight)} kg (${latest.setsDisplay}).`,
  }
}
