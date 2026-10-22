import {
  buildEnrichedChronology,
  getLatestRecordInfo,
  type EnrichedHistoryEntry,
} from './statsEngine'
import { formatSetsForDisplay } from './parser'
import {
  formatIsoToFr,
  formatNumberFr,
  SECTION_LABELS,
  type CompletedSessionRecord,
  type Exercise,
  type SectionId,
} from './types'

/**
 * Génère un bilan texte (Markdown léger) prêt à être collé dans une IA / un coach.
 * Tout est calculé localement à partir du carnet : aucun appel réseau.
 */

export interface StatsReportInput {
  exercises: readonly Exercise[]
  completedSessions?: readonly CompletedSessionRecord[]
  profile?: { heightCm?: number | null; weightKg?: number | null }
  now?: Date
}

interface VariantSummary {
  name: string
  count: number
  lastDate: string
  bestWeight: number
  isLatest: boolean
}

interface ExerciseSummary {
  ex: Exercise
  performed: EnrichedHistoryEntry[]
  latest: EnrichedHistoryEntry | null
  previous: EnrichedHistoryEntry | null
  best: EnrichedHistoryEntry | null
  totalVolume: number
  restAverage: number | null
  workTotal: number | null
  variants: VariantSummary[]
  notes: string[]
  objective: EnrichedHistoryEntry | null
  trendKg: number | null
  isPerSide: boolean
}

function formatKgFr(value: number): string {
  const rounded = Math.round(value)
  return rounded.toLocaleString('fr-FR').replace(/\u202f|\u00a0/g, ' ')
}

function datePhrase(displayDate: string): string {
  return displayDate.startsWith('Séance') ? `(${displayDate})` : `le ${displayDate}`
}

function formatSecondsFr(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined || totalSeconds <= 0) return '—'
  const safe = Math.round(totalSeconds)
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = safe % 60
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, '0')}`
  if (minutes > 0) {
    return seconds > 0 ? `${minutes}min${String(seconds).padStart(2, '0')}` : `${minutes} min`
  }
  return `${seconds}s`
}

function formatWeight(ex: Exercise, weight: number): string {
  if (ex.unit === 'bodyweight' && weight === 0) return 'poids de corps'
  return `${formatNumberFr(weight)} kg`
}

function sentence(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > 160 ? `${clean.slice(0, 157)}…` : clean
}

function summarizeExercise(ex: Exercise): ExerciseSummary {
  const chrono = buildEnrichedChronology(ex)
  const performed = chrono.filter((c) => !c.entry.wasObjective)
  const objective =
    [...chrono].reverse().find((c) => c.entry.wasObjective) ?? null

  const latest = performed.length > 0 ? performed[performed.length - 1] : null
  const previous = performed.length > 1 ? performed[performed.length - 2] : null

  const withWeight = performed.filter((c) => c.hasValidWeight)
  const best =
    withWeight.length > 0
      ? withWeight.reduce((acc, cur) => (cur.topWeight >= acc.topWeight ? cur : acc))
      : null

  const totalVolume = performed.reduce((sum, c) => sum + c.volumeKg, 0)

  const rests = performed
    .map((c) => c.entry.restSeconds)
    .filter((v): v is number => typeof v === 'number' && v > 0)
  const restAverage =
    rests.length > 0 ? Math.round(rests.reduce((a, b) => a + b, 0) / rests.length) : null

  const works = performed
    .map((c) => c.entry.workSeconds)
    .filter((v): v is number => typeof v === 'number' && v > 0)
  const workTotal = works.length > 0 ? works.reduce((a, b) => a + b, 0) : null

  const variantMap = new Map<string, VariantSummary>()
  for (const item of withWeight) {
    const current = variantMap.get(item.variant)
    if (!current) {
      variantMap.set(item.variant, {
        name: item.variant,
        count: 1,
        lastDate: item.displayDate,
        bestWeight: item.topWeight,
        isLatest: latest?.variant === item.variant,
      })
    } else {
      current.count += 1
      current.lastDate = item.displayDate
      current.bestWeight = Math.max(current.bestWeight, item.topWeight)
    }
  }

  const notes = [...performed]
    .reverse()
    .map((c) => c.entry.note.trim())
    .filter((n) => n.length > 0)
    .slice(0, 2)

  const sameVariantRecent = withWeight
    .filter((c) => latest !== null && c.variant === latest.variant)
    .slice(-4)
  const trendKg =
    sameVariantRecent.length >= 2
      ? Math.round(
          (sameVariantRecent[sameVariantRecent.length - 1].topWeight -
            sameVariantRecent[0].topWeight) *
            10,
        ) / 10
      : null

  const isPerSide = latest !== null && /par\s+c[oô]t[eé]/i.test(latest.entry.note)

  return {
    ex,
    performed,
    latest,
    previous,
    best,
    totalVolume,
    restAverage,
    workTotal,
    variants: [...variantMap.values()],
    notes,
    objective,
    trendKg,
    isPerSide,
  }
}

function countSessions(exercises: readonly Exercise[], section: SectionId): number {
  const dates = new Set<string>()
  let maxUndated = 0

  for (const ex of exercises) {
    if (ex.section !== section) continue
    let undatedForExercise = 0
    for (const entry of ex.entries) {
      if (entry.skipOnly || entry.sets.length === 0 || entry.wasObjective) continue
      if (entry.date) {
        dates.add(entry.date)
      } else {
        undatedForExercise += 1
      }
    }
    maxUndated = Math.max(maxUndated, undatedForExercise)
  }

  return dates.size + maxUndated
}

/** Convertit un chrono « 1h12 » / « 2min30 » lisible en une ligne de stats. */
function formatSessionTime(seconds: number): string {
  return formatSecondsFr(seconds)
}

export function buildStatsReport({
  exercises,
  completedSessions = [],
  profile,
  now = new Date(),
}: StatsReportInput): string {
  const active = exercises.filter((ex) => ex.active)
  const summaries = active.map(summarizeExercise)

  const upSessions = countSessions(active, 'up')
  const legsSessions = countSessions(active, 'legs')
  const totalSessions = upSessions + legsSessions

  const totalVolume = summaries.reduce((sum, s) => sum + s.totalVolume, 0)

  // Volume par séance (somme des exercices d'une même date)
  const volumeBySession = new Map<string, { section: SectionId; date: string; volume: number }>()
  for (const summary of summaries) {
    for (const entry of summary.performed) {
      if (!entry.entry.date || entry.volumeKg <= 0) continue
      const key = `${summary.ex.section}|${entry.entry.date}`
      const current = volumeBySession.get(key)
      if (current) {
        current.volume += entry.volumeKg
      } else {
        volumeBySession.set(key, {
          section: summary.ex.section,
          date: entry.entry.date,
          volume: entry.volumeKg,
        })
      }
    }
  }
  const heaviestSession = [...volumeBySession.values()].sort(
    (a, b) => b.volume - a.volume,
  )[0]

  const bestLoad = summaries
    .flatMap((s) =>
      s.performed
        .filter((entry) => entry.hasValidWeight && s.ex.unit === 'kg')
        .map((entry) => ({ entry, ex: s.ex })),
    )
    .sort((a, b) => b.entry.topWeight - a.entry.topWeight)[0]

  // Temps mesurés : soit les séances suivies dans l'app, soit les balises du carnet.
  const chronoTotals = completedSessions.map((s) => s.totalDurationSeconds)
  const entryChronos = summaries.flatMap((s) =>
    s.performed
      .map((entry) => entry.entry.sessionDurationSeconds)
      .filter((v): v is number => typeof v === 'number' && v > 0),
  )
  const sessionChronos = chronoTotals.length > 0 ? chronoTotals : entryChronos
  const averageSessionSeconds =
    sessionChronos.length > 0
      ? Math.round(sessionChronos.reduce((a, b) => a + b, 0) / sessionChronos.length)
      : null
  const shortestSessionSeconds = sessionChronos.length > 0 ? Math.min(...sessionChronos) : null
  const longestSessionSeconds = sessionChronos.length > 0 ? Math.max(...sessionChronos) : null

  const totalWorkSeconds = completedSessions.reduce((sum, s) => sum + s.totalWorkSeconds, 0)
  const totalRestSeconds = completedSessions.reduce((sum, s) => sum + s.totalRestSeconds, 0)

  const dates = new Set<string>()
  for (const summary of summaries) {
    for (const entry of summary.performed) {
      if (entry.entry.date) dates.add(entry.entry.date)
    }
  }
  const lastDate = [...dates].sort().at(-1) ?? null

  const lines: string[] = []
  const today = now.toLocaleDateString('fr-FR')

  lines.push(`# Bilan musculation — ${today}`)
  lines.push('')
  lines.push(
    'Bilan généré automatiquement depuis mon carnet d’entraînement (suivi DDP, haut du corps / jambes).',
  )
  lines.push('')

  const profileParts: string[] = []
  if (profile?.heightCm) profileParts.push(`1m${String(profile.heightCm % 100).padStart(2, '0')}`)
  if (profile?.weightKg) profileParts.push(`${formatNumberFr(profile.weightKg)} kg`)
  if (profileParts.length > 0) {
    lines.push(`**Profil** : ${profileParts.join(' · ')} — objectif hypertrophie.`)
  }
  lines.push(
    '**Méthode** : Double Progression Dynamique — polyarticulaires 8–12 reps, isolation 12–15 reps ; on ajoute 1 rep avant d’ajouter de la charge.',
  )
  lines.push(
    `**Séances enregistrées** : ${totalSessions} (Haut ${upSessions} · Jambes ${legsSessions})${
      lastDate ? ` — dernière séance le ${formatIsoToFr(lastDate)}` : ''
    }.`,
  )
  lines.push('')

  const upVolume = summaries
    .filter((s) => s.ex.section === 'up')
    .reduce((sum, s) => sum + s.totalVolume, 0)
  const legsVolume = summaries
    .filter((s) => s.ex.section === 'legs')
    .reduce((sum, s) => sum + s.totalVolume, 0)

  lines.push('## Chiffres clés')
  lines.push(
    `- Volume total soulevé : **${formatKgFr(totalVolume)} kg** (séries de travail, échauffements exclus).`,
  )
  if (upVolume > 0 || legsVolume > 0) {
    lines.push(
      `- Répartition : Haut ${formatKgFr(upVolume)} kg · Jambes ${formatKgFr(legsVolume)} kg.`,
    )
  }
  if (heaviestSession) {
    lines.push(
      `- Séance la plus volumineuse : ${formatIsoToFr(heaviestSession.date)} · ${
        heaviestSession.section === 'legs' ? 'Jambes' : 'Haut'
      } — ${formatKgFr(heaviestSession.volume)} kg.`,
    )
  }
  if (bestLoad) {
    lines.push(
      `- Charge max : ${formatWeight(bestLoad.ex, bestLoad.entry.topWeight)} sur ${bestLoad.ex.name} (${bestLoad.entry.displayDate}).`,
    )
  }
  if (averageSessionSeconds !== null) {
    lines.push(
      `- Temps à la salle : ${averageSessionSeconds !== null ? formatSessionTime(averageSessionSeconds) : '—'} en moyenne sur ${sessionChronos.length} séance${
        sessionChronos.length > 1 ? 's' : ''
      } chronométrée${sessionChronos.length > 1 ? 's' : ''}${
        shortestSessionSeconds !== null && longestSessionSeconds !== null
          ? ` (de ${formatSessionTime(shortestSessionSeconds)} à ${formatSessionTime(longestSessionSeconds)})`
          : ''
      }.`,
    )
  } else {
    lines.push(
      '- Temps à la salle : pas encore de données (les chronos s’enregistrent quand je suis une séance dans l’app).',
    )
  }
  if (totalWorkSeconds > 0 || totalRestSeconds > 0) {
    lines.push(
      `- Temps d’exécution cumulé : ${formatSessionTime(totalWorkSeconds)} · temps de repos cumulé : ${formatSessionTime(totalRestSeconds)}.`,
    )
  }
  lines.push('')

  for (const section of ['up', 'legs'] as SectionId[]) {
    const sectionSummaries = summaries.filter((s) => s.ex.section === section)
    if (sectionSummaries.length === 0) continue

    lines.push(`## ${SECTION_LABELS[section].title}`)
    lines.push('')

    for (const summary of sectionSummaries) {
      const { ex, latest, previous, best, variants } = summary
      const kind = ex.category === 'iso' ? 'isolation' : 'polyarticulaire'
      lines.push(
        `### ${ex.name} _(${kind} · cible ${ex.repRange[0]}–${ex.repRange[1]} reps)_`,
      )

      if (!latest) {
        lines.push('- Aucune séance réalisée pour le moment.')
        lines.push('')
        continue
      }

      const setsLabel = formatSetsForDisplay(latest.entry.sets, ex.unit)
      const perSide = summary.isPerSide ? ' (charges par côté)' : ''
      const isRecord = getLatestRecordInfo(ex)?.isRecord ?? false
      lines.push(
        `- Dernière séance : ${latest.displayDate} — ${setsLabel}${perSide} · volume ${
          latest.volumeKg > 0 ? `${formatKgFr(latest.volumeKg)} kg` : 'n/a'
        }${latest.entry.restSeconds ? ` · repos ${formatSecondsFr(latest.entry.restSeconds)}` : ''}${
          isRecord ? ' · 🏆 nouveau record' : ''
        }`,
      )

      if (best) {
        const e1rm =
          ex.unit === 'kg' && best.topWeight > 0
            ? ` (1RM estimé ${formatNumberFr(Math.round(best.bestE1rm * 10) / 10)} kg)`
            : ''
        lines.push(
          `- Record : ${formatWeight(ex, best.topWeight)} × ${formatNumberFr(best.topSetRepsAtPeak)}${e1rm} ${datePhrase(best.displayDate)}.`,
        )
      }

      const recentHistory = summary.performed.slice(-5).reverse()
      if (recentHistory.length > 1) {
        const historyLine = recentHistory
          .map(
            (entry) =>
              `${entry.shortLabel} ${formatWeight(ex, entry.topWeight)} × ${formatNumberFr(entry.topSetRepsAtPeak)}`,
          )
          .join(' · ')
        lines.push(`- 5 dernières : ${historyLine}.`)
      }

      if (summary.trendKg !== null && summary.trendKg !== 0) {
        lines.push(
          `- Tendance récente (même variante) : ${
            summary.trendKg > 0 ? '+' : ''
          }${formatNumberFr(summary.trendKg)} kg.`,
        )
      }

      if (variants.length > 1) {
        const variantLine = variants
          .map(
            (v) =>
              `${v.name} (${v.count} séance${v.count > 1 ? 's' : ''}, dernière ${v.lastDate}, max ${formatWeight(ex, v.bestWeight)})${
                v.isLatest ? ' ← actuelle' : ''
              }`,
          )
          .join(' · ')
        lines.push(`- Variantes d’équipement : ${variantLine}.`)
        lines.push(
          '  ⚠️ Charges non comparables entre variantes (machine / position différentes) : comparer à variante identique.',
        )
      }

      if (summary.restAverage !== null) {
        lines.push(`- Repos moyen : ${formatSecondsFr(summary.restAverage)} par série.`)
      }
      if (summary.workTotal !== null && summary.workTotal > 0) {
        lines.push(
          `- Temps d’exécution : ${formatSecondsFr(summary.workTotal)} sur ${
            summary.performed.length
          } séance${summary.performed.length > 1 ? 's' : ''} suivie${summary.performed.length > 1 ? 's' : ''}.`,
        )
      }

      if (summary.objective) {
        lines.push(
          `- Objectif en cours (${summary.objective.displayDate}) : ${formatSetsForDisplay(
            summary.objective.entry.sets,
            ex.unit,
          )}.`,
        )
      }

      if (summary.notes.length > 0) {
        lines.push(
          `- Notes récentes : ${summary.notes.map((n) => `« ${sentence(n)} »`).join(' · ')}.`,
        )
      }

      if (previous && latest.variant !== previous.variant) {
        lines.push(
          `- Changement d’équipement sur la dernière séance (${previous.variant} → ${latest.variant}).`,
        )
      }

      lines.push('')
    }
  }

  // ---------------------------------------------------------------------------
  // Points d'attention : faits objectifs, utiles à un coach pour prioriser.
  // ---------------------------------------------------------------------------
  const stagnations: string[] = []
  const equipmentChanges: string[] = []
  const firstReferences: string[] = []
  const pauses: string[] = []
  const longRests: string[] = []

  for (const summary of summaries) {
    const { ex, performed, latest, previous } = summary
    if (!latest) continue

    const sameVariant = performed.filter((c) => c.variant === latest.variant)
    const last3 = sameVariant.slice(-3)
    if (
      last3.length >= 3 &&
      last3.every((c) => Math.abs(c.topWeight - last3[0].topWeight) <= 0.01) &&
      latest.topSetRepsAtPeak <= last3[0].topSetRepsAtPeak
    ) {
      stagnations.push(
        `Stagnation : ${ex.name} — ${last3.length} séances à ${formatWeight(
          ex,
          latest.topWeight,
        )} sans hausse de reps (${formatNumberFr(last3[0].topSetRepsAtPeak)} → ${formatNumberFr(
          latest.topSetRepsAtPeak,
        )}).`,
      )
    }

    if (previous && latest.variant !== previous.variant) {
      equipmentChanges.push(
        `Changement d’équipement : ${ex.name} — ${previous.variant} → ${latest.variant} (${latest.displayDate}). Les charges ne sont pas comparables.`,
      )
    }

    if (summary.performed.length === 1) {
      firstReferences.push(
        `Première référence : ${ex.name} — ${formatSetsForDisplay(
          latest.entry.sets,
          ex.unit,
        )} ${datePhrase(latest.displayDate)}.`,
      )
    }

    if (summary.restAverage !== null && summary.restAverage >= 180) {
      longRests.push(
        `Repos long : ${ex.name} — ${formatSecondsFr(summary.restAverage)} de repos moyen.`,
      )
    }

    const lastDateForExercise = latest.entry.date
    if (lastDateForExercise) {
      const days = Math.floor(
        (now.getTime() - new Date(`${lastDateForExercise}T12:00:00`).getTime()) / 86_400_000,
      )
      if (days >= 14) {
        pauses.push(`Pause : ${ex.name} — aucune séance depuis ${days} jours.`)
      }
    }
  }

  const signals = [
    ...stagnations.slice(0, 4),
    ...equipmentChanges.slice(0, 4),
    ...firstReferences.slice(0, 3),
    ...pauses.slice(0, 2),
    ...longRests.slice(0, 2),
  ]

  if (signals.length > 0) {
    lines.push('## Points d’attention')
    for (const signal of signals) {
      lines.push(`- ${signal}`)
    }
    lines.push('')
  }

  lines.push('## Comment lire ce bilan')
  lines.push(
    '- Les charges sont celles notées dans le carnet ; « par côté » signifie que le poids indiqué est celui d’un seul côté (haltère ou machine à chargement latéral).',
  )
  lines.push(
    '- Un changement de variante (machine, position assise/debout, jambes tendues…) rend les charges non comparables : on compare à variante identique.',
  )
  lines.push(
    '- Les temps (séance, exécution, repos) proviennent des séances suivies avec le chrono de l’app ; les séances simplement notées n’en ont pas encore.',
  )
  lines.push(
    '- Repères : 8 à 12 reps en polyarticulaire, 12 à 15 reps en isolation.',
  )
  lines.push('')

  lines.push('## Ce que j’attends de toi (coach)')
  lines.push(
    'Analyse ce bilan comme un coach musculation : points forts, exercices en stagnation, déséquilibres entre haut du corps et jambes, temps de repos à ajuster, puis donne-moi des priorités concrètes (charge / reps / repos) pour les 2 prochaines semaines.',
  )

  return lines.join('\n').trim()
}
