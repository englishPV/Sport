import { RotateCcw, X } from 'lucide-react'
import { useWorkoutStore } from '../store/useWorkoutStore'

/** Persistent, app-wide surfacing for Gemini failures (including the mid-workout case). */
export function AiErrorNotice() {
  const coachError = useWorkoutStore((s) => s.aiError)
  const coachErrorSection = useWorkoutStore((s) => s.aiErrorSection)
  const activeSection = useWorkoutStore((s) => s.activeDraft.section)
  const statsError = useWorkoutStore((s) => s.aiStatsError)
  const ensureSessionPlansGenerated = useWorkoutStore((s) => s.ensureSessionPlansGenerated)
  const refreshAiStats = useWorkoutStore((s) => s.refreshAiStats)

  if (!coachError && !statsError) return null

  const dismissCoachError = () => {
    // An empty toast is not used here; clearing the AI message also clears its retry target.
    useWorkoutStore.setState({ aiError: null, aiErrorSection: null })
  }
  const dismissStatsError = () => {
    useWorkoutStore.setState({ aiStatsError: null })
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 top-2 z-[100] mx-auto flex w-full max-w-lg flex-col gap-2 px-3">
      {coachError ? (
        <div
          role="alert"
          className="pointer-events-auto rounded-2xl border border-rose-300 bg-white/95 p-3 shadow-xl backdrop-blur dark:border-rose-900 dark:bg-slate-950/95"
        >
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-extrabold text-rose-700 dark:text-rose-300">
                La génération de séance a échoué
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-700 dark:text-slate-200">{coachError}</p>
              <button
                type="button"
                onClick={() =>
                  void ensureSessionPlansGenerated(coachErrorSection ?? activeSection, { force: true })
                }
                className="tap mt-2 inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-500"
              >
                <RotateCcw size={13} aria-hidden="true" />
                Réessayer explicitement
              </button>
            </div>
            <button
              type="button"
              aria-label="Masquer l’erreur de génération de séance"
              onClick={dismissCoachError}
              className="tap rounded-md p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}

      {statsError ? (
        <div
          role="alert"
          className="pointer-events-auto rounded-2xl border border-amber-300 bg-white/95 p-3 shadow-xl backdrop-blur dark:border-amber-900 dark:bg-slate-950/95"
        >
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-extrabold text-amber-700 dark:text-amber-300">
                L’analyse IA des statistiques a échoué
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-700 dark:text-slate-200">{statsError}</p>
              <button
                type="button"
                onClick={() => void refreshAiStats(true)}
                className="tap mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-500"
              >
                <RotateCcw size={13} aria-hidden="true" />
                Réessayer l’analyse
              </button>
            </div>
            <button
              type="button"
              aria-label="Masquer l’erreur d’analyse des statistiques"
              onClick={dismissStatsError}
              className="tap rounded-md p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
