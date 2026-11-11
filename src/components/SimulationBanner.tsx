import { FlaskConical } from 'lucide-react'
import { SECTION_LABELS, type SectionId } from '../core/types'
import { useWorkoutStore } from '../store/useWorkoutStore'

const SECTIONS: readonly SectionId[] = ['up', 'legs']

const ACTION_BUTTON =
  'press rounded-lg border border-amber-400/70 bg-white/70 px-3 py-1.5 text-xs font-bold text-amber-950 hover:bg-white dark:border-amber-400/40 dark:bg-amber-900/60 dark:text-amber-50 dark:hover:bg-amber-900'

/**
 * Bandeau du mode test : rappelle que rien n'est enregistré, montre où en est
 * l'IA pour chaque séance et permet d'avancer vite dans la séance simulée.
 */
export function SimulationBanner() {
  const simulating = useWorkoutStore((s) => s.simulation !== null)
  const sessionPhase = useWorkoutStore((s) => s.sessionPhase)
  const coachPlans = useWorkoutStore((s) => s.coachPlans)
  const generating = useWorkoutStore((s) => s.aiGeneratingSections)
  const aiError = useWorkoutStore((s) => s.aiError)
  const hasKey = useWorkoutStore((s) => s.settings.apiKey !== '')
  const simulateNextStep = useWorkoutStore((s) => s.simulateNextStep)
  const simulateWholeSession = useWorkoutStore((s) => s.simulateWholeSession)
  const exitSimulation = useWorkoutStore((s) => s.exitSimulation)

  if (!simulating) return null

  const describePlan = (section: SectionId): string => {
    if (generating[section]) return 'l’IA prépare le plan…'
    const plan = coachPlans[section]
    if (plan?.source === 'gemini') return `plan de l’IA prêt${plan.model ? ` (${plan.model})` : ''}`
    return hasKey ? 'progression calculée, pas de plan IA' : 'progression calculée (aucune clé API)'
  }

  const nextLabel =
    sessionPhase === 'idle'
      ? 'Démarrer la séance'
      : sessionPhase === 'working'
        ? 'Valider la série'
        : sessionPhase === 'resting'
          ? 'Passer le repos'
          : null

  return (
    <section
      aria-label="Mode test"
      className="sticky top-0 z-50 border-b border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-500/40 dark:bg-amber-950 dark:text-amber-50"
    >
      <div className="mx-auto flex max-w-md flex-col gap-2 px-4 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-sm font-bold">
            <FlaskConical size={16} aria-hidden="true" />
            Mode test : rien n’est enregistré
          </p>
          <button type="button" onClick={exitSimulation} className={ACTION_BUTTON}>
            Quitter le test
          </button>
        </div>

        <ul aria-live="polite" className="space-y-0.5 text-xs">
          {SECTIONS.map((section) => (
            <li key={section}>
              <span className="font-bold">{SECTION_LABELS[section].short}</span> : {describePlan(section)}
            </li>
          ))}
        </ul>

        {aiError ? (
          <p role="alert" className="text-xs font-semibold text-rose-700 dark:text-rose-300">
            {aiError}
          </p>
        ) : null}

        {nextLabel ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={simulateNextStep} className={ACTION_BUTTON}>
              {nextLabel}
            </button>
            <button type="button" onClick={simulateWholeSession} className={ACTION_BUTTON}>
              Aller à la fin de la séance
            </button>
          </div>
        ) : (
          <p className="text-xs">Séance terminée : enregistrez-la pour tester la suite, rien ne sera gardé.</p>
        )}
      </div>
    </section>
  )
}
