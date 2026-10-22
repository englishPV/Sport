import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Clock,
  Flame,
  Moon,
  RotateCcw,
  SkipForward,
  Sparkles,
  Sun,
} from 'lucide-react'
import { HistoryValueInput } from '../components/HistoryValueInput'
import { Popover, Toast, useDismiss } from '../components/motion'
import { getRecommendedSection } from '../core/ddp'
import type { SectionId } from '../core/types'
import { useNow } from '../hooks/useNow'
import { useWorkoutStore } from '../store/useWorkoutStore'

function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(safe / 3600)
  const mins = Math.floor((safe % 3600) / 60)
  const secs = safe % 60
  if (hours > 0) {
    return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }
  return `${mins}:${String(secs).padStart(2, '0')}`
}

function parseClockInput(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 60
  }
  const parts = trimmed.split(':').map((p) => p.trim())
  if (parts.some((p) => !/^\d+$/.test(p))) return null
  if (parts.length === 2) {
    return Number(parts[0]) * 60 + Number(parts[1])
  }
  if (parts.length === 3) {
    return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2])
  }
  return null
}

export type ValuePerfState =
  | 'above'
  | 'target'
  | 'prev'
  | 'below-1'
  | 'below-2'
  | 'below-3'

export function computePerfState(params: {
  value: number
  target: number
  prev: number | null
  step: number
}): ValuePerfState {
  const { value, target, prev, step } = params
  const eps = 0.01

  if (value > target + eps) {
    return 'above'
  }
  if (Math.abs(value - target) <= eps) {
    return 'target'
  }
  // En dessous de l'objectif mais égal à la dernière séance -> repère ambre
  if (prev !== null && Math.abs(value - prev) <= eps) {
    return 'prev'
  }
  const safeStep = Math.max(0.5, step)
  const baseline =
    prev !== null && prev < target - eps ? prev : target
  const stepsDown = Math.max(1, Math.ceil((baseline - value - eps) / safeStep))
  if (stepsDown === 1) return 'below-1'
  if (stepsDown === 2) return 'below-2'
  return 'below-3'
}

function formatSetBadgeLabel(
  sets: readonly { isWarmup: boolean }[],
  setIdx: number,
  includeTotal: boolean,
): string {
  const current = sets[setIdx]
  if (!current) return includeTotal ? `Série 1 / ${sets.length}` : 'Série 1'

  const warmupCount = sets.filter((s) => s.isWarmup).length
  const workCount = sets.length - warmupCount

  if (current.isWarmup) {
    if (warmupCount <= 1) return 'Échauffement'
    const warmPos = sets.slice(0, setIdx + 1).filter((s) => s.isWarmup).length
    return includeTotal ? `Échauffement ${warmPos} / ${warmupCount}` : `Échauffement ${warmPos}`
  }

  const workPos = sets.slice(0, setIdx + 1).filter((s) => !s.isWarmup).length
  return includeTotal ? `Série ${workPos} / ${workCount}` : `Série ${workPos}`
}

const PERF_STYLES: Record<
  ValuePerfState,
  { card: string; text: string; unit: string }
> = {
  above: {
    card: 'border-sky-300 bg-sky-50/70 dark:border-sky-500/45 dark:bg-sky-950/35',
    text: 'text-sky-600 dark:text-sky-400',
    unit: 'text-sky-600/80 dark:text-sky-400/80',
  },
  target: {
    card: 'border-emerald-300 bg-emerald-50/65 dark:border-emerald-500/40 dark:bg-emerald-950/30',
    text: 'text-emerald-600 dark:text-emerald-400',
    unit: 'text-emerald-600/80 dark:text-emerald-400/80',
  },
  prev: {
    card: 'border-amber-300 bg-amber-50/70 dark:border-amber-500/45 dark:bg-amber-950/35',
    text: 'text-amber-600 dark:text-amber-400',
    unit: 'text-amber-600/80 dark:text-amber-400/80',
  },
  'below-1': {
    card: 'border-rose-200 bg-rose-50/60 dark:border-rose-500/30 dark:bg-rose-950/25',
    text: 'text-rose-500 dark:text-rose-400',
    unit: 'text-rose-500/80 dark:text-rose-400/80',
  },
  'below-2': {
    card: 'border-rose-400 bg-rose-100/70 dark:border-rose-500/55 dark:bg-rose-950/45',
    text: 'text-rose-600 dark:text-rose-300',
    unit: 'text-rose-600/85 dark:text-rose-300/85',
  },
  'below-3': {
    card: 'border-red-500 bg-red-100/90 dark:border-red-500/75 dark:bg-red-950/65',
    text: 'text-red-700 dark:text-red-300',
    unit: 'text-red-700/85 dark:text-red-300/85',
  },
}

const STEPPER_BUTTON =
  'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/90 text-xl font-bold text-slate-700 shadow-sm transition duration-150 ease-smooth hover:bg-white hover:shadow active:scale-90 dark:bg-slate-900 dark:text-slate-200'

export function WorkoutView() {
  const exercises = useWorkoutStore((s) => s.exercises)
  const activeDraft = useWorkoutStore((s) => s.activeDraft)
  const sessionPhase = useWorkoutStore((s) => s.sessionPhase)
  const cursor = useWorkoutStore((s) => s.cursor)
  const restTimer = useWorkoutStore((s) => s.restTimer)
  const undoStack = useWorkoutStore((s) => s.undoStack)
  const settings = useWorkoutStore((s) => s.settings)
  const aiLoading = useWorkoutStore((s) => s.aiLoading)

  const selectSection = useWorkoutStore((s) => s.selectSection)
  const startWorkout = useWorkoutStore((s) => s.startWorkout)
  const exitWorkout = useWorkoutStore((s) => s.exitWorkout)
  const validateCurrentSet = useWorkoutStore((s) => s.validateCurrentSet)
  const onRestCountdownReachedZero = useWorkoutStore((s) => s.onRestCountdownReachedZero)
  const skipRest = useWorkoutStore((s) => s.skipRest)
  const undoLastAction = useWorkoutStore((s) => s.undoLastAction)
  const jumpToExercise = useWorkoutStore((s) => s.jumpToExercise)
  const adjustWorkoutChrono = useWorkoutStore((s) => s.adjustWorkoutChrono)
  const setWorkoutChronoSeconds = useWorkoutStore((s) => s.setWorkoutChronoSeconds)
  const updateDraftSet = useWorkoutStore((s) => s.updateDraftSet)
  const updateDraftNote = useWorkoutStore((s) => s.updateDraftNote)
  const saveCompletedWorkout = useWorkoutStore((s) => s.saveCompletedWorkout)
  const discardActiveWorkout = useWorkoutStore((s) => s.discardActiveWorkout)
  const adjustRestTimer = useWorkoutStore((s) => s.adjustRestTimer)
  const updateSettings = useWorkoutStore((s) => s.updateSettings)

  const [showExercisePicker, setShowExercisePicker] = useState(false)
  const [showChronoEditor, setShowChronoEditor] = useState(false)
  const [customChronoText, setCustomChronoText] = useState('')
  const [savedToast, setSavedToast] = useState<string | null>(null)

  const pickerAnchorRef = useRef<HTMLButtonElement>(null)
  const pickerPanelRef = useRef<HTMLDivElement>(null)
  const chronoAnchorRef = useRef<HTMLButtonElement>(null)
  const chronoPanelRef = useRef<HTMLDivElement>(null)

  useDismiss(showExercisePicker, () => setShowExercisePicker(false), [
    pickerAnchorRef,
    pickerPanelRef,
  ])
  useDismiss(showChronoEditor, () => setShowChronoEditor(false), [
    chronoAnchorRef,
    chronoPanelRef,
  ])

  // Changer d'étape (pause, fin de séance…) referme les petits menus flottants.
  useEffect(() => {
    setShowExercisePicker(false)
    setShowChronoEditor(false)
  }, [sessionPhase])

  // La confirmation s'efface toute seule après quelques secondes.
  useEffect(() => {
    if (!savedToast) return
    const timer = window.setTimeout(() => setSavedToast(null), 4000)
    return () => window.clearTimeout(timer)
  }, [savedToast])

  const section = activeDraft.section
  const activeExercises = exercises.filter((e) => e.section === section && e.active)
  const { recommended } = getRecommendedSection(exercises)

  const tickerActive =
    (sessionPhase !== 'idle' && activeDraft.startedAt !== null) || restTimer !== null
  const tickNow = useNow(tickerActive, 250)
  const now = Math.max(tickNow, Date.now())

  const workoutElapsedSeconds =
    activeDraft.startedAt !== null
      ? Math.max(0, Math.floor((now - activeDraft.startedAt) / 1000))
      : 0

  const restElapsedMs = restTimer ? Math.max(0, now - restTimer.startedAt) : 0
  const restRemainingMs = restTimer
    ? restTimer.durationSeconds * 1000 - restElapsedMs
    : 0
  const restRemainingSeconds = Math.max(0, Math.ceil(restRemainingMs / 1000))

  useEffect(() => {
    if (sessionPhase === 'resting' && restTimer && restRemainingMs <= 0) {
      onRestCountdownReachedZero()
    }
  }, [sessionPhase, restTimer, restRemainingMs, onRestCountdownReachedZero])

  const validatedCount = activeExercises.reduce((acc, ex) => {
    const sets = activeDraft.logs[ex.id]?.sets ?? []
    return acc + sets.filter((s) => s.completedAt !== null).length
  }, 0)

  const totalSetsCount = activeExercises.reduce((acc, ex) => {
    return acc + (activeDraft.logs[ex.id]?.sets.length ?? 0)
  }, 0)

  const toggleDarkMode = () => {
    updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })
  }

  const openChronoPopover = () => {
    setCustomChronoText(formatClock(workoutElapsedSeconds))
    setShowChronoEditor((v) => !v)
  }

  const applyCustomChrono = () => {
    const parsed = parseClockInput(customChronoText)
    if (parsed !== null) {
      setWorkoutChronoSeconds(parsed)
      setShowChronoEditor(false)
    }
  }

  // ============================================================================
  // ÉCRAN 1 : ACCUEIL MINIMALISTE
  // ============================================================================
  if (sessionPhase === 'idle') {
    return (
      <div className="relative flex min-h-[76vh] animate-fade-up flex-col items-center justify-center px-4 text-center">
        <div className="absolute left-1/2 top-1 z-20 -translate-x-1/2">
          <Toast
            message={savedToast}
            className="animate-toast-in whitespace-nowrap rounded-full border border-emerald-500/20 bg-white/90 px-4 py-1.5 text-sm font-medium text-emerald-700 shadow-sm backdrop-blur dark:border-emerald-400/20 dark:bg-slate-900/90 dark:text-emerald-300"
          />
        </div>

        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
          {section === recommended ? "Aujourd'hui" : 'Séance'}
        </p>

        <h1
          key={section}
          className="mt-2 animate-pop-in text-4xl font-bold tracking-tight text-slate-900 dark:text-white"
        >
          {section === 'legs' ? 'Jambes' : 'Haut'}
        </h1>

        {/* Sélecteur Jambes / Haut avec pastille qui glisse en douceur */}
        <div className="relative mt-6 grid w-52 grid-cols-2 rounded-full bg-slate-200/70 p-1 dark:bg-slate-800">
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-white shadow-sm transition-transform duration-300 ease-smooth dark:bg-slate-900 ${
              section === 'up' ? 'translate-x-full' : 'translate-x-0'
            }`}
          />
          {(['legs', 'up'] as SectionId[]).map((id) => {
            const selected = section === id
            return (
              <button
                key={id}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  setSavedToast(null)
                  selectSection(id)
                }}
                className={`relative z-10 rounded-full px-5 py-1.5 text-sm font-semibold transition-colors duration-300 ease-smooth ${
                  selected
                    ? 'text-slate-900 dark:text-white'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {id === 'legs' ? 'Jambes' : 'Haut'}
              </button>
            )
          })}
        </div>

        <button
          type="button"
          onClick={() => {
            setSavedToast(null)
            startWorkout()
          }}
          className="mt-10 w-full max-w-xs rounded-2xl bg-indigo-600 px-8 py-4 text-lg font-bold text-white shadow-lg shadow-indigo-600/25 transition-all duration-200 ease-smooth hover:-translate-y-0.5 hover:bg-indigo-500 hover:shadow-xl hover:shadow-indigo-600/30 active:translate-y-0 active:scale-[0.98]"
        >
          {validatedCount > 0 ? `Reprendre (${validatedCount}/${totalSetsCount})` : 'Commencer'}
        </button>

        {validatedCount > 0 && (
          <div className="mt-4 flex animate-fade-in items-center gap-4 text-xs font-semibold">
            <button
              type="button"
              onClick={() => {
                const summary = saveCompletedWorkout()
                if (summary) {
                  setSavedToast(`Séance enregistrée (${summary.validatedSets} séries)`)
                }
              }}
              className="tap text-emerald-600 hover:underline dark:text-emerald-400"
            >
              Enregistrer la séance
            </button>
            <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
              ·
            </span>
            <button
              type="button"
              onClick={() => {
                discardActiveWorkout()
                setSavedToast('Essai effacé')
              }}
              className="tap text-slate-400 hover:text-rose-500 dark:text-slate-500 dark:hover:text-rose-400"
            >
              Effacer l&apos;essai
            </button>
          </div>
        )}
      </div>
    )
  }

  const renderWorkoutTopBar = () => (
    <div className="relative flex items-center justify-between">
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={exitWorkout}
          aria-label="Retour à l'accueil"
          title="Retour à l'accueil (conserve tes séries)"
          className="tap inline-flex items-center gap-1 rounded-full p-2 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        {undoStack.length > 0 && (
          <button
            type="button"
            onClick={undoLastAction}
            aria-label="Annuler la dernière action"
            title="Annuler la dernière série validée"
            className="tap inline-flex animate-pop-in items-center gap-1 rounded-full p-2 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <button
          ref={pickerAnchorRef}
          type="button"
          onClick={() => {
            setShowChronoEditor(false)
            setShowExercisePicker((v) => !v)
          }}
          aria-expanded={showExercisePicker}
          aria-haspopup="menu"
          title="Choisir un exercice"
          className={`tap inline-flex items-center gap-1 rounded-full bg-slate-200/70 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 ${
            showExercisePicker ? 'bg-slate-200 dark:bg-slate-700' : ''
          }`}
        >
          {cursor.exerciseIdx + 1} / {activeExercises.length}
          <ChevronDown
            className={`h-3 w-3 transition-transform duration-300 ease-smooth ${
              showExercisePicker ? 'rotate-180' : 'rotate-0'
            }`}
          />
        </button>
        {aiLoading && (
          <span
            title="Gemini 3.8 Flash ajuste les cibles…"
            className="inline-flex animate-pop-in items-center text-indigo-500 dark:text-indigo-400"
          >
            <Sparkles className="h-3.5 w-3.5 animate-pulse" />
          </span>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={toggleDarkMode}
          aria-label="Basculer le mode sombre"
          className="tap rounded-full p-1.5 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <span key={settings.theme} className="inline-flex animate-icon-swap">
            {settings.theme === 'dark' ? (
              <Sun className="h-3.5 w-3.5" />
            ) : (
              <Moon className="h-3.5 w-3.5" />
            )}
          </span>
        </button>

        <button
          ref={chronoAnchorRef}
          type="button"
          onClick={openChronoPopover}
          aria-label="Chrono de séance"
          aria-expanded={showChronoEditor}
          className={`tap inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium tabular-nums text-slate-500 hover:bg-slate-200/70 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200 ${
            showChronoEditor ? 'bg-slate-200/70 dark:bg-slate-800' : ''
          }`}
        >
          <Clock className="h-3 w-3 opacity-70" />
          {formatClock(workoutElapsedSeconds)}
        </button>
      </div>

      <Popover
        open={showChronoEditor}
        panelRef={chronoPanelRef}
        className="absolute right-0 top-10 z-30 w-60 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-800 dark:bg-slate-900"
      >
        <>
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => adjustWorkoutChrono(-10)}
              className="press flex-1 rounded-xl bg-slate-100 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              -10s
            </button>
            <button
              type="button"
              onClick={() => adjustWorkoutChrono(10)}
              className="press flex-1 rounded-xl bg-slate-100 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              +10s
            </button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              applyCustomChrono()
            }}
            className="mt-2 flex items-center gap-1.5"
          >
            <input
              type="text"
              aria-label="Modifier le chrono (mm:ss)"
              value={customChronoText}
              onChange={(e) => setCustomChronoText(e.target.value)}
              placeholder="mm:ss"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-center text-xs font-semibold tabular-nums text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
            <button
              type="submit"
              className="press rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500"
            >
              OK
            </button>
          </form>
        </>
      </Popover>
    </div>
  )

  // ============================================================================
  // ÉCRAN 2 : PAUSE ÉPURÉE (sans -15s, sans bruit)
  // ============================================================================
  if (sessionPhase === 'resting') {
    const nextEx = activeExercises[cursor.exerciseIdx]
    const optimalExtra = restTimer?.extraIncrementSeconds ?? 30
    const restProgress =
      restTimer && restTimer.durationSeconds > 0
        ? Math.min(100, Math.max(0, (restElapsedMs / (restTimer.durationSeconds * 1000)) * 100))
        : 0

    return (
      <div className="mx-auto flex min-h-[82vh] max-w-md animate-fade-in flex-col justify-between px-4 py-3">
        {renderWorkoutTopBar()}

        <div className="my-auto flex animate-fade-up flex-col items-center text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400">
            Pause
          </p>

          <div
            role="timer"
            className="mt-3 text-7xl font-bold tabular-nums tracking-tight text-slate-900 transition-colors duration-500 dark:text-white"
          >
            {formatClock(restRemainingSeconds)}
          </div>

          {/* Repère visuel discret de la pause qui s'écoule */}
          <div
            aria-hidden="true"
            className="mt-5 h-1 w-40 overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800"
          >
            <div
              className="h-full rounded-full bg-indigo-500/70 transition-[width] duration-300 ease-linear"
              style={{ width: `${restProgress}%` }}
            />
          </div>

          {nextEx && (
            <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
              Suivant :{' '}
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {nextEx.name}
              </span>{' '}
              ·{' '}
              {formatSetBadgeLabel(
                activeDraft.logs[nextEx.id]?.sets ?? [],
                cursor.setIdx,
                false,
              )}
            </p>
          )}

          <button
            type="button"
            onClick={() => adjustRestTimer(optimalExtra)}
            className="press mt-7 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-700 dark:hover:bg-slate-800"
          >
            +{optimalExtra}s
          </button>

          <button
            type="button"
            onClick={skipRest}
            className="press mt-5 inline-flex w-full max-w-xs items-center justify-center gap-2 rounded-2xl bg-slate-900 px-6 py-4 text-base font-bold text-white shadow-lg shadow-slate-900/10 hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
          >
            <SkipForward className="h-4 w-4" />
            Passer
          </button>
        </div>

        <div className="h-4" />
      </div>
    )
  }

  // ============================================================================
  // ÉCRAN 3 : FIN DE SÉANCE
  // ============================================================================
  if (sessionPhase === 'done') {
    return (
      <div className="flex min-h-[78vh] animate-fade-up flex-col items-center justify-center px-4 text-center">
        <div className="flex h-14 w-14 animate-pop-in items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 shadow-sm shadow-emerald-500/10 dark:text-emerald-400">
          <Check className="h-7 w-7" />
        </div>
        <h2 className="mt-4 animate-fade-up text-2xl font-bold text-slate-900 dark:text-white">
          Séance terminée
        </h2>
        <p className="mt-1 animate-fade-up text-sm text-slate-500 [animation-delay:60ms] dark:text-slate-400">
          {validatedCount} séries · {formatClock(workoutElapsedSeconds)}
        </p>

        <button
          type="button"
          onClick={() => {
            const summary = saveCompletedWorkout()
            if (summary) {
              setSavedToast(`Séance enregistrée (${summary.validatedSets} séries)`)
            }
          }}
          className="press mt-8 w-full max-w-xs animate-fade-up rounded-2xl bg-emerald-600 px-6 py-4 text-base font-bold text-white shadow-lg shadow-emerald-600/20 [animation-delay:120ms] hover:bg-emerald-500 hover:shadow-xl hover:shadow-emerald-600/25"
        >
          Enregistrer la séance
        </button>

        <button
          type="button"
          onClick={undoLastAction}
          className="tap mt-4 inline-flex animate-fade-up items-center gap-1.5 text-sm text-slate-400 [animation-delay:180ms] hover:text-slate-600 dark:hover:text-slate-200"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Revenir à la dernière série
        </button>
      </div>
    )
  }

  // ============================================================================
  // ÉCRAN 4 : SÉRIE EN COURS — MINIMALISTE & GUIDÉ PAR LA COULEUR
  // ============================================================================
  const currentEx = activeExercises[cursor.exerciseIdx]
  if (!currentEx) {
    exitWorkout()
    return null
  }

  const currentLog = activeDraft.logs[currentEx.id]
  const sets = currentLog?.sets ?? []
  const currentSet = sets[cursor.setIdx] ?? sets[0]
  if (!currentSet) return null

  const stepKg = currentEx.weightStep || 2.5

  const weightPerf = computePerfState({
    value: currentSet.weight,
    target: currentSet.targetWeight,
    prev: currentSet.prevWeight,
    step: stepKg,
  })
  const sameWeightAsPrev =
    currentSet.prevWeight === null ||
    Math.abs(currentSet.weight - currentSet.prevWeight) <= 0.01
  const repsPerf = computePerfState({
    value: currentSet.reps,
    target: currentSet.targetReps,
    prev: sameWeightAsPrev ? currentSet.prevReps : null,
    step: 1,
  })

  const wStyle = PERF_STYLES[weightPerf]
  const rStyle = PERF_STYLES[repsPerf]

  return (
    <div className="relative mx-auto flex min-h-[84vh] max-w-md animate-fade-in flex-col justify-between px-4 py-3">
      {renderWorkoutTopBar()}

      {/* Menu flottant des exercices : ouverture/fermeture en fondu + zoom */}
      <Popover
        open={showExercisePicker}
        panelRef={pickerPanelRef}
        origin="top-center"
        className="absolute inset-x-4 top-[3.75rem] z-40 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl shadow-slate-900/5 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/40"
      >
        <>
          <div className="max-h-[60vh] overflow-y-auto">
            {activeExercises.map((ex, idx) => {
              const exSets = activeDraft.logs[ex.id]?.sets ?? []
              const done = exSets.filter((s) => s.completedAt !== null).length
              const isCurrent = idx === cursor.exerciseIdx
              return (
                <button
                  key={ex.id}
                  type="button"
                  onClick={() => {
                    jumpToExercise(idx)
                    setShowExercisePicker(false)
                  }}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-all duration-200 ease-smooth active:scale-[0.99] ${
                    isCurrent
                      ? 'bg-indigo-50 font-semibold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
                      : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <span className="truncate">{ex.name}</span>
                  <span
                    className={`ml-2 shrink-0 text-xs ${
                      isCurrent
                        ? 'text-indigo-500/80 dark:text-indigo-300/80'
                        : 'text-slate-400'
                    }`}
                  >
                    {done}/{exSets.length}
                  </span>
                </button>
              )
            })}
          </div>
          <div className="mt-1 space-y-1 border-t border-slate-100 pt-1 dark:border-slate-800">
            {validatedCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  setShowExercisePicker(false)
                  const summary = saveCompletedWorkout()
                  if (summary) {
                    setSavedToast(`Séance enregistrée (${summary.validatedSets} séries)`)
                  }
                }}
                className="w-full rounded-xl bg-emerald-500/10 px-3 py-1.5 text-center text-xs font-semibold text-emerald-700 transition-colors duration-200 hover:bg-emerald-500/20 dark:text-emerald-300"
              >
                Terminer et enregistrer ({validatedCount})
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setShowExercisePicker(false)
                exitWorkout()
              }}
              className="w-full rounded-xl px-3 py-1.5 text-center text-xs font-medium text-slate-400 transition-colors duration-200 hover:bg-slate-50 hover:text-slate-600 dark:hover:bg-slate-800/60 dark:hover:text-slate-200"
            >
              Retour à l&apos;accueil
            </button>
          </div>
        </>
      </Popover>

      {/* Centre épuré : Titre + Poids + Répétitions + Commentaire */}
      <div
        key={`${currentEx.id}-${cursor.setIdx}`}
        className="my-auto animate-fade-up py-2"
      >
        <div className="text-center">
          <span
            className={`inline-block rounded-full px-3 py-0.5 text-xs font-semibold ${
              currentSet.isWarmup
                ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                : 'bg-slate-200/70 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            {formatSetBadgeLabel(sets, cursor.setIdx, true)}
          </span>

          <h2 className="mt-2.5 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {currentEx.name}
          </h2>
        </div>

        {/* Poids (kg) et Répétitions (reps) — retour visuel par la couleur */}
        <div className="mt-7 space-y-3.5">
          {/* POIDS (KG) */}
          <div
            data-testid="weight-card"
            data-perf={weightPerf}
            className={`flex items-center justify-between rounded-2xl border p-3 transition-colors duration-300 ease-smooth ${wStyle.card}`}
          >
            <button
              type="button"
              aria-label="Diminuer le poids"
              onClick={() =>
                updateDraftSet(currentEx.id, currentSet.id, {
                  weight: Math.max(0, Number((currentSet.weight - stepKg).toFixed(2))),
                })
              }
              className={STEPPER_BUTTON}
            >
              −
            </button>

            <HistoryValueInput
              label="Poids en kg"
              unit="kg"
              value={currentSet.weight}
              previousValue={currentSet.prevWeight}
              step="any"
              inputMode="decimal"
              onChange={(e) =>
                updateDraftSet(currentEx.id, currentSet.id, {
                  weight: e.target.value === '' ? 0 : Number(e.target.value),
                })
              }
              inputClassName={`w-24 bg-transparent text-right text-3xl font-extrabold tabular-nums transition-colors duration-300 ease-smooth focus:outline-none ${wStyle.text}`}
              unitClassName={`text-sm font-bold ${wStyle.unit}`}
            />

            <button
              type="button"
              aria-label="Augmenter le poids"
              onClick={() =>
                updateDraftSet(currentEx.id, currentSet.id, {
                  weight: Number((currentSet.weight + stepKg).toFixed(2)),
                })
              }
              className={STEPPER_BUTTON}
            >
              +
            </button>
          </div>

          {/* RÉPÉTITIONS (REPS) */}
          <div
            data-testid="reps-card"
            data-perf={repsPerf}
            className={`flex items-center justify-between rounded-2xl border p-3 transition-colors duration-300 ease-smooth ${rStyle.card}`}
          >
            <button
              type="button"
              aria-label="Diminuer les répétitions"
              onClick={() => {
                const nextReps = Number.isInteger(currentSet.reps)
                  ? currentSet.reps - 1
                  : Math.floor(currentSet.reps)
                updateDraftSet(currentEx.id, currentSet.id, {
                  reps: Math.max(0, nextReps),
                })
              }}
              className={STEPPER_BUTTON}
            >
              −
            </button>

            <HistoryValueInput
              label="Nombre de répétitions"
              unit="reps"
              value={currentSet.reps}
              previousValue={currentSet.prevReps}
              step="0.5"
              inputMode="decimal"
              onChange={(e) =>
                updateDraftSet(currentEx.id, currentSet.id, {
                  reps:
                    e.target.value === ''
                      ? 0
                      : Math.max(0, Math.round(Number(e.target.value) * 2) / 2),
                })
              }
              inputClassName={`w-20 bg-transparent text-right text-3xl font-extrabold tabular-nums transition-colors duration-300 ease-smooth focus:outline-none ${rStyle.text}`}
              unitClassName={`text-sm font-bold ${rStyle.unit}`}
            />

            <button
              type="button"
              aria-label="Augmenter les répétitions"
              onClick={() => {
                const nextReps = Number.isInteger(currentSet.reps)
                  ? currentSet.reps + 1
                  : Math.ceil(currentSet.reps)
                updateDraftSet(currentEx.id, currentSet.id, {
                  reps: nextReps,
                })
              }}
              className={STEPPER_BUTTON}
            >
              +
            </button>
          </div>
        </div>

        {/* Ligne épurée : Commentaire + Échec discret */}
        <div className="mt-5 flex items-center gap-2">
          <input
            type="text"
            value={currentLog?.note ?? ''}
            onChange={(e) => updateDraftNote(currentEx.id, e.target.value)}
            placeholder="Commentaire"
            className="w-full rounded-xl border border-slate-200/90 bg-white/90 px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 dark:border-slate-800 dark:bg-slate-900/90 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:ring-indigo-400/10"
          />

          <button
            type="button"
            onClick={() =>
              updateDraftSet(currentEx.id, currentSet.id, {
                failure: !currentSet.failure,
              })
            }
            aria-label="Échec"
            title="Série menée à l'échec"
            className={`inline-flex shrink-0 items-center gap-1 rounded-xl px-3 py-2.5 text-xs font-semibold transition-all duration-200 ease-smooth active:scale-95 ${
              currentSet.failure
                ? 'bg-rose-500 text-white'
                : 'border border-slate-200/90 bg-white/90 text-slate-500 dark:border-slate-800 dark:bg-slate-900/90 dark:text-slate-400'
            }`}
          >
            <Flame className="h-3.5 w-3.5" />
            Échec
          </button>
        </div>
      </div>

      <div className="pt-1">
        <button
          type="button"
          onClick={() => {
            setShowExercisePicker(false)
            validateCurrentSet()
          }}
          className="press flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 py-4 text-lg font-bold text-white shadow-lg shadow-indigo-600/25 hover:bg-indigo-500 hover:shadow-xl hover:shadow-indigo-600/30"
        >
          <Check className="h-5 w-5" />
          Valider
        </button>
      </div>
    </div>
  )
}
