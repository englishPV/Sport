import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ChevronDown } from 'lucide-react'
import { Collapse } from '../components/motion'
import { ProgressionChart, type ChartMetric } from '../components/ProgressionChart'
import { buildStatsFingerprint } from '../core/gemini'
import {
  buildEnrichedChronology,
  computeSmartExerciseInsight,
  getLatestBestSetSummary,
} from '../core/statsEngine'
import {
  formatIsoToFr,
  formatRestDuration,
  SECTION_LABELS,
  type AiExerciseStatInsight,
  type Exercise,
  type ExerciseTrendStatus,
  type SectionId,
} from '../core/types'
import { useWorkoutStore } from '../store/useWorkoutStore'

function formatDurationShort(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const rem = s % 60
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}`
  if (m > 0) return rem > 0 ? `${m}m${String(rem).padStart(2, '0')}s` : `${m} min`
  return `${rem}s`
}

function statusBadgeClasses(status: ExerciseTrendStatus): string {
  switch (status) {
    case 'progressing':
      return 'bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
    case 'recalibration':
      return 'bg-sky-500/15 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300'
    case 'fatigue':
      return 'bg-amber-500/15 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
    case 'stable':
    default:
      return 'bg-slate-200/80 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
  }
}

function buildLocalSynthesis(
  activeExercises: readonly Exercise[],
  insightsById: Record<string, AiExerciseStatInsight>,
): { headline: string; bullets: string[] } {
  const items = activeExercises.map((ex) => ({
    ex,
    insight: insightsById[ex.id] ?? computeSmartExerciseInsight(ex),
  }))

  const progressing = items.filter((i) => i.insight.status === 'progressing')
  const recalibrating = items.filter((i) => i.insight.status === 'recalibration')

  if (items.length === 0) {
    return {
      headline: 'Aucune séance enregistrée pour le moment.',
      bullets: [],
    }
  }

  const headline =
    progressing.length > 0
      ? `${progressing.length} exercice${progressing.length > 1 ? 's' : ''} sur ${items.length} en progression sur tes dernières séances.`
      : ` Charges consolidées sur tes ${items.length} exercices actifs.`.trim()

  const bullets: string[] = []
  if (progressing.length > 0) {
    const topMoves = progressing
      .slice(0, 3)
      .map((i) => `${i.ex.name.split('(')[0].trim()} (${i.insight.badge})`)
      .join(', ')
    bullets.push(`Hausses récentes : ${topMoves}.`)
  }
  if (recalibrating.length > 0) {
    const switched = recalibrating
      .slice(0, 2)
      .map((i) => `${i.ex.name.split('(')[0].trim()} (${i.insight.badge})`)
      .join(', ')
    bullets.push(`Variante / machine ajustée : ${switched}.`)
  }

  return { headline, bullets }
}

export function ProgressView({ onBack }: { onBack?: () => void }) {
  useWorkoutStore((s) => s.exercises)
  useWorkoutStore((s) => s.activeDraft)

  const getExercisesWithLiveProgress = useWorkoutStore(
    (s) => s.getExercisesWithLiveProgress,
  )
  const completedSessions = useWorkoutStore((s) => s.completedSessions)
  const aiStats = useWorkoutStore((s) => s.aiStats)
  const aiStatsLoading = useWorkoutStore((s) => s.aiStatsLoading)
  const aiStatsError = useWorkoutStore((s) => s.aiStatsError)
  const refreshAiStats = useWorkoutStore((s) => s.refreshAiStats)
  const apiKey = useWorkoutStore((s) => s.settings.apiKey)
  const deleteHistoryEntry = useWorkoutStore((s) => s.deleteHistoryEntry)
  const deleteCompletedSession = useWorkoutStore((s) => s.deleteCompletedSession)

  const exercises = getExercisesWithLiveProgress()

  const [section, setSection] = useState<SectionId>('up')
  const [expandedExId, setExpandedExId] = useState<string | null>(null)
  const [showHistoryExId, setShowHistoryExId] = useState<string | null>(null)
  const [showRecentTimings, setShowRecentTimings] = useState(false)
  const [metric, setMetric] = useState<ChartMetric>('maxWeight')

  useEffect(() => {
    if (apiKey.trim()) {
      void refreshAiStats(false)
    }
  }, [apiKey, exercises.length, completedSessions.length, refreshAiStats])

  const activeAllExercises = useMemo(
    () => exercises.filter((e) => e.active),
    [exercises],
  )

  const sectionExercises = useMemo(
    () => exercises.filter((e) => e.section === section && e.active),
    [exercises, section],
  )

  const localInsightsById = useMemo(() => {
    const map: Record<string, AiExerciseStatInsight> = {}
    for (const ex of activeAllExercises) {
      map[ex.id] = computeSmartExerciseInsight(ex)
    }
    return map
  }, [activeAllExercises])

  const currentFingerprint = useMemo(
    () => buildStatsFingerprint(exercises, completedSessions),
    [exercises, completedSessions],
  )

  const freshAiStats =
    aiStats && aiStats.fingerprint === currentFingerprint ? aiStats : null

  const localSynthesis = useMemo(
    () => buildLocalSynthesis(activeAllExercises, localInsightsById),
    [activeAllExercises, localInsightsById],
  )

  const totalUniqueDates = useMemo(() => {
    let total = 0
    for (const sec of ['up', 'legs'] as SectionId[]) {
      const secExs = exercises.filter((e) => e.section === sec)
      const uniqueDates = new Set<string>()
      let maxUndated = 0
      for (const ex of secExs) {
        let undatedForEx = 0
        for (const entry of ex.entries) {
          if (entry.skipOnly || entry.sets.length === 0) continue
          if (entry.date) {
            uniqueDates.add(entry.date)
          } else {
            undatedForEx += 1
          }
        }
        if (undatedForEx > maxUndated) {
          maxUndated = undatedForEx
        }
      }
      total += uniqueDates.size + maxUndated
    }
    return total
  }, [exercises])

  return (
    <div className="mx-auto max-w-xl space-y-4 px-4 py-6">
      {onBack ? (
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onBack}
            aria-label="Retour"
            className="tap flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-900"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-base font-extrabold text-slate-900 dark:text-white">
            Statistiques
          </h1>
          <div className="w-10" />
        </div>
      ) : null}

      {/* Synthèse globale concise (locale immédiate + enrichissement Gemini 3.8 Flash High) */}
      <section className="rounded-3xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              Synthèse
            </h2>
            <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
              ·
            </span>
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {totalUniqueDates} séances dans le carnet
            </span>
            {aiStatsLoading ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/10 px-2 py-0.5 text-[11px] font-semibold text-indigo-600 dark:text-indigo-300">
                <span className="h-1.5 w-1.5 animate-ping rounded-full bg-indigo-500" />
                Analyse IA…
              </span>
            ) : freshAiStats ? (
              <span className="animate-pop-in rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-semibold text-indigo-600 dark:text-indigo-300">
                IA 3.8 High
              </span>
            ) : null}
          </div>

          {apiKey.trim() ? (
            <button
              type="button"
              disabled={aiStatsLoading}
              onClick={() => void refreshAiStats(true)}
              className="tap text-xs font-semibold text-slate-400 hover:text-indigo-600 disabled:opacity-40 dark:hover:text-indigo-400"
            >
              Actualiser
            </button>
          ) : null}
        </div>

        <p
          key={freshAiStats ? 'ai' : 'local'}
          className="mt-2 animate-fade-in text-sm font-medium text-slate-700 dark:text-slate-200"
        >
          {freshAiStats ? freshAiStats.headline : localSynthesis.headline}
        </p>

        {(freshAiStats ? freshAiStats.bulletPoints : localSynthesis.bullets).length > 0 ? (
          <ul className="mt-2 space-y-1">
            {(freshAiStats ? freshAiStats.bulletPoints : localSynthesis.bullets).map(
              (pt, idx) => (
                <li
                  key={idx}
                  className="flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400"
                >
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
                  <span>{pt}</span>
                </li>
              ),
            )}
          </ul>
        ) : null}

        {aiStatsError && !freshAiStats ? (
          <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
            Synthèse locale active (IA : vérifie la clé Gemini dans Réglages si besoin).
          </p>
        ) : null}

        {/* Chronométrages en direct enregistrés sur l'appareil (dépliables à la demande) */}
        {completedSessions.length > 0 ? (
          <div className="mt-3 border-t border-slate-100 pt-2.5 dark:border-slate-800">
            <button
              type="button"
              aria-expanded={showRecentTimings}
              onClick={() => setShowRecentTimings((v) => !v)}
              className="flex w-full items-center justify-between rounded-lg text-xs font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            >
              <span>
                Chronos suivis en direct ({completedSessions.length})
              </span>
              <span className="inline-flex items-center gap-1">
                {showRecentTimings ? 'Masquer' : 'Voir'}
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform duration-300 ease-smooth ${
                    showRecentTimings ? 'rotate-180' : ''
                  }`}
                />
              </span>
            </button>

            <Collapse open={showRecentTimings} className="mt-2">
              <div className="space-y-1.5">
                {completedSessions.slice(0, 5).map((sess) => (
                  <div
                    key={sess.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800/60"
                  >
                    <span className="font-semibold text-slate-700 dark:text-slate-200">
                      {formatIsoToFr(sess.date)} ·{' '}
                      {sess.section === 'legs' ? 'Jambes' : 'Haut'}
                    </span>
                    <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                      <span>
                        Total{' '}
                        <strong className="text-slate-800 dark:text-white">
                          {formatDurationShort(sess.totalDurationSeconds)}
                        </strong>{' '}
                        (effort {formatDurationShort(sess.totalWorkSeconds)} · repos{' '}
                        {formatDurationShort(sess.totalRestSeconds)})
                      </span>
                      <button
                        type="button"
                        onClick={() => deleteCompletedSession(sess.id)}
                        title="Supprimer ce chrono"
                        className="ml-1 rounded px-1 text-slate-400 transition-all duration-200 hover:bg-rose-50 hover:text-rose-600 active:scale-90 dark:hover:bg-rose-950/40"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </Collapse>
          </div>
        ) : null}
      </section>

      {/* Sélecteur Haut / Jambes — la pastille active glisse d'un onglet à l'autre */}
      <div
        role="tablist"
        aria-label="Séance analysée"
        className="relative grid grid-cols-2 rounded-2xl bg-slate-200/70 p-1 dark:bg-slate-900"
      >
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-xl bg-white shadow-sm transition-transform duration-300 ease-smooth dark:bg-slate-800 ${
            section === 'legs' ? 'translate-x-full' : 'translate-x-0'
          }`}
        />
        {(['up', 'legs'] as SectionId[]).map((sec) => {
          const active = section === sec
          return (
            <button
              key={sec}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                setSection(sec)
                setExpandedExId(null)
                setShowHistoryExId(null)
              }}
              className={`relative z-10 rounded-xl py-2.5 text-sm font-bold transition-all duration-300 ease-smooth active:scale-[0.98] ${
                active
                  ? 'text-slate-900 dark:text-white'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              {sec === 'up' ? 'Haut' : 'Jambes'}
            </button>
          )
        })}
      </div>

      {/* Liste épurée : un clic sur un exercice ouvre sa courbe et son détail */}
      <div key={section} className="space-y-2">
        {sectionExercises.map((ex, idx) => {
          const isOpen = expandedExId === ex.id
          const showHistory = showHistoryExId === ex.id
          const insight: AiExerciseStatInsight =
            freshAiStats?.exercises[ex.id] ??
            localInsightsById[ex.id] ??
            computeSmartExerciseInsight(ex)
          const latestSummary = getLatestBestSetSummary(ex)
          const realSessionsCount = ex.entries.filter(
            (e) => !e.skipOnly && e.sets.length > 0,
          ).length
          const chronoDesc = getChronoDesc(ex, isOpen && showHistory)

          return (
            <div
              key={ex.id}
              style={{ animationDelay: `${Math.min(idx * 35, 210)}ms` }}
              className={`animate-fade-up overflow-hidden rounded-2xl border bg-white transition-[border-color,box-shadow] duration-300 ease-smooth dark:bg-slate-900 ${
                isOpen
                  ? 'border-indigo-300 shadow-md dark:border-indigo-500/50'
                  : 'border-slate-200/80 shadow-sm hover:border-slate-300 hover:shadow dark:border-slate-800 dark:hover:border-slate-700'
              }`}
            >
              {/* Ligne épurée cliquable */}
              <button
                type="button"
                onClick={() => {
                  setExpandedExId(isOpen ? null : ex.id)
                  setShowHistoryExId(null)
                }}
                className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors duration-200 hover:bg-slate-50/70 dark:hover:bg-slate-800/30"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-900 dark:text-white">
                    {ex.name}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {latestSummary ? `Dernière : ${latestSummary}` : 'Aucune séance'}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusBadgeClasses(
                      insight.status,
                    )}`}
                  >
                    {insight.badge}
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-300 ease-smooth ${
                      isOpen ? 'rotate-180' : ''
                    }`}
                  />
                </div>
              </button>

              {/* Détail progressif uniquement quand l'utilisateur clique */}
              <Collapse open={isOpen}>
                <div className="space-y-3.5 border-t border-slate-100 px-4 pb-4 pt-3 dark:border-slate-800">
                  {insight.summary ? (
                    <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600 dark:bg-slate-800/70 dark:text-slate-300">
                      {insight.summary}
                    </p>
                  ) : null}

                  {/* Choix discret de la métrique du graphique */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-400">
                      {SECTION_LABELS[ex.section].short} · {realSessionsCount} séances
                    </span>
                    <div className="relative grid grid-cols-3 rounded-xl bg-slate-100 p-0.5 text-xs dark:bg-slate-800">
                      <span
                        aria-hidden="true"
                        className={`pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc((100%_-_0.25rem)/3)] rounded-lg bg-white shadow-sm transition-transform duration-300 ease-smooth dark:bg-slate-900 ${
                          metric === 'reps'
                            ? 'translate-x-full'
                            : metric === 'volume'
                              ? 'translate-x-[200%]'
                              : 'translate-x-0'
                        }`}
                      />
                      {(
                        [
                          { id: 'maxWeight', label: 'Poids' },
                          { id: 'reps', label: 'Reps' },
                          { id: 'volume', label: 'Total' },
                        ] as const
                      ).map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setMetric(m.id)}
                          className={`relative z-10 rounded-lg px-2.5 py-1 font-semibold transition-all duration-300 ease-smooth active:scale-95 ${
                            metric === m.id
                              ? 'text-indigo-600 dark:text-indigo-400'
                              : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                          }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <ProgressionChart exercise={ex} metric={metric} />

                  {/* Historique complet dépliable en second niveau */}
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => setShowHistoryExId(showHistory ? null : ex.id)}
                      className="tap text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      {showHistory
                        ? 'Masquer les séances'
                        : `Voir les ${realSessionsCount} séances`}
                    </button>

                    <Collapse open={showHistory} className="mt-2.5">
                      <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                        {chronoDesc.map((item, itemIdx) => {
                          const entry = item.entry
                          return (
                            <div
                              key={entry.id}
                              style={{ animationDelay: `${Math.min(itemIdx * 25, 150)}ms` }}
                              className="flex animate-fade-up items-start justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800/60"
                            >
                              <div className="min-w-0 space-y-0.5">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="font-bold text-slate-700 dark:text-slate-200">
                                    {item.displayDate}
                                  </span>
                                  {item.variant !== 'Standard' ? (
                                    <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-bold text-sky-700 dark:text-sky-300">
                                      {item.variant}
                                    </span>
                                  ) : null}
                                  <span className="text-slate-300 dark:text-slate-600">
                                    ·
                                  </span>
                                  <span className="font-mono text-slate-700 dark:text-slate-300">
                                    {item.setsDisplay}
                                  </span>
                                  {entry.restSeconds ? (
                                    <span className="text-[11px] text-slate-400">
                                      · repos {formatRestDuration(entry.restSeconds)}
                                    </span>
                                  ) : null}
                                  {entry.workSeconds ? (
                                    <span className="text-[11px] text-slate-400">
                                      · effort {formatDurationShort(entry.workSeconds)}
                                    </span>
                                  ) : null}
                                </div>
                                {entry.note ? (
                                  <p className="italic text-slate-500 dark:text-slate-400">
                                    {entry.note}
                                  </p>
                                ) : null}
                              </div>

                              {!entry.id.startsWith('live-') ? (
                                <button
                                  type="button"
                                  onClick={() => deleteHistoryEntry(ex.id, entry.id)}
                                  title="Supprimer cette entrée"
                                  className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] text-slate-400 transition-all duration-200 hover:bg-rose-50 hover:text-rose-600 active:scale-90 dark:hover:bg-rose-950/40"
                                >
                                  ×
                                </button>
                              ) : null}
                            </div>
                          )
                        })}
                      </div>
                    </Collapse>
                  </div>
                </div>
              </Collapse>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function getChronoDesc(ex: Exercise, enabled: boolean) {
  if (!enabled) return []
  return [...buildEnrichedChronology(ex)].reverse()
}
