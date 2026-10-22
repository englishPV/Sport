import { useState } from 'react'
import { ChevronLeft, ChevronRight, MessageSquarePlus, Plus, SkipForward } from 'lucide-react'
import { Button } from '../ui/Button'
import { NumberStepper } from '../ui/NumberStepper'
import { GhostHistory } from './GhostHistory'
import { SetRow } from './SetRow'
import { formatWeight } from '../../core/stats'
import type { Exercise, ExerciseLog, ExerciseTarget, Unit } from '../../core/types'

export interface ExerciseCardProps {
  exercise: Exercise
  log: ExerciseLog
  setIndex: number
  target: ExerciseTarget | null
  ghost: { weight: number; reps: number } | null
  weightStep: number
  unit: Unit
  hasPrev: boolean
  hasNext: boolean
  onValidate: (values: { weight: number; reps: number; rpe: number | null; note: string }) => void
  onAddSet: () => void
  onPrev: () => void
  onNext: () => void
  onSkip: () => void
}

export function ExerciseCard({
  exercise,
  log,
  setIndex,
  target,
  ghost,
  weightStep,
  unit,
  hasPrev,
  hasNext,
  onValidate,
  onAddSet,
  onPrev,
  onNext,
  onSkip,
}: ExerciseCardProps) {
  const performed = log.sets
    .filter((set) => set.completedAt !== null)
    .sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0))
  const previousInSession = performed[performed.length - 1]
  const initialWeight = target?.targetWeight ?? ghost?.weight ?? previousInSession?.weight ?? 0
  const initialReps = target?.targetRepsMin ?? ghost?.reps ?? 0

  const [weight, setWeight] = useState(initialWeight)
  const [reps, setReps] = useState(initialReps)
  const [rpe, setRpe] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [noteOpen, setNoteOpen] = useState(false)

  const totalSets = Math.max(log.sets.length, setIndex + 1)
  const canValidate = reps > 0

  return (
    <section className="space-y-4 rounded-2xl border border-elev/50 bg-card p-4">
      <div>
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold leading-tight text-ink">{exercise.name}</h2>
          <span className="shrink-0 rounded-full bg-elev/60 px-2 py-1 text-xs font-semibold text-muted">
            Série {setIndex + 1} / {totalSets}
          </span>
        </div>
        <div className="mt-1">
          <GhostHistory ghost={ghost} unit={unit} />
        </div>
      </div>

      {target ? (
        <p className="rounded-lg bg-accent/10 px-3 py-2 text-sm font-semibold text-accent">
          Cible : {formatWeight(target.targetWeight, unit)} × {target.targetRepsMin}–
          {target.targetRepsMax} · repos {target.targetRestSeconds} s
        </p>
      ) : null}

      {target?.tip ? <p className="text-sm italic text-muted">{target.tip}</p> : null}

      <div className="space-y-4">
        <NumberStepper
          label="Poids"
          suffix={unit === 'bodyweight' ? 'kg (0 = PDC)' : 'kg'}
          value={weight}
          onChange={setWeight}
          step={weightStep}
          min={0}
          inputMode="decimal"
          ariaLabel="Poids de la série"
        />
        <NumberStepper
          label="Répétitions"
          value={reps}
          onChange={setReps}
          step={1}
          min={0}
          max={100}
          inputMode="numeric"
          ariaLabel="Répétitions de la série"
        />
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">RPE (optionnel)</p>
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={rpe === value}
              onClick={() => setRpe(rpe === value ? null : value)}
              className={[
                'min-h-touch min-w-touch flex-1 rounded-lg text-sm font-semibold transition-colors duration-150',
                rpe === value ? 'bg-accent text-[#0f172a]' : 'bg-elev text-ink hover:bg-elev/80',
              ].join(' ')}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      {noteOpen ? (
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          placeholder="Sensation, douleur, technique…"
          className="w-full rounded-xl border border-elev bg-base p-3 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
        />
      ) : (
        <Button variant="ghost" className="gap-2" onClick={() => setNoteOpen(true)}>
          <MessageSquarePlus size={16} /> + Note
        </Button>
      )}

      <Button
        size="xl"
        fullWidth
        disabled={!canValidate}
        onClick={() => onValidate({ weight, reps, rpe, note: note.trim() })}
      >
        Valider la série
      </Button>

      {performed.length > 0 ? (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Séries validées
          </p>
          <ul className="space-y-1">
            {performed.map((set) => (
              <SetRow key={set.index} set={set} unit={unit} />
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <Button variant="ghost" onClick={onPrev} disabled={!hasPrev} className="gap-1">
          <ChevronLeft size={16} /> Précédent
        </Button>
        <Button variant="ghost" onClick={onNext} disabled={!hasNext} className="gap-1">
          Suivant <ChevronRight size={16} />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onAddSet} className="gap-1">
          <Plus size={16} /> Une série
        </Button>
        <Button variant="secondary" onClick={onSkip} className="gap-1" disabled={!hasNext}>
          <SkipForward size={16} /> Sauter
        </Button>
      </div>
    </section>
  )
}
