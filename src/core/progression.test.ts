import { describe, expect, it } from 'vitest'
import { computeFallbackTargets, fallbackGlobalNote, getLastPerformance } from './progression'
import { createDefaultSettings, type Exercise, type Session, type SetEntry } from './types'

const exercise: Exercise = {
  id: 'ex-triceps',
  name: 'Extension triceps à la poulie',
  normalizedName: 'extension triceps a la poulie',
  unit: 'kg',
  defaultRestSeconds: 90,
}

const settings = createDefaultSettings()

function makeSets(entries: { weight: number; reps: number; rest?: number | null }[]): SetEntry[] {
  return entries.map((entry, index) => ({
    index,
    weight: entry.weight,
    reps: entry.reps,
    restSecondsPlanned: 90,
    restSecondsActual: entry.rest ?? null,
    rpe: null,
    note: '',
    completedAt: 1_700_000_000_000 + index * 120_000,
  }))
}

function makeSession(date: string, sets: SetEntry[]): Session {
  return {
    id: `s-${date}`,
    sessionTypeId: 'type-1',
    date,
    startedAt: null,
    endedAt: null,
    status: 'completed',
    exercises: [{ exerciseId: exercise.id, sets, note: '' }],
    coachPlan: null,
    source: 'app',
  }
}

describe('computeFallbackTargets', () => {
  it('garde la charge et vise +1 rep', () => {
    const session = makeSession(
      '2026-10-20',
      makeSets([
        { weight: 15, reps: 11 },
        { weight: 15, reps: 9 },
        { weight: 12, reps: 11 },
      ]),
    )
    const [target] = computeFallbackTargets([exercise], [session], settings)
    expect(target.targetWeight).toBe(15)
    expect(target.targetRepsMin).toBe(10)
    expect(target.targetRepsMax).toBe(11)
    expect(target.tip).toBe('Même charge, vise une rep de plus par série.')
  })

  it('augmente la charge quand toutes les séries font ≥ 12 reps', () => {
    const session = makeSession(
      '2026-10-20',
      makeSets([
        { weight: 100, reps: 12 },
        { weight: 100, reps: 12 },
        { weight: 100, reps: 12 },
      ]),
    )
    const [target] = computeFallbackTargets([exercise], [session], settings)
    expect(target.targetWeight).toBe(102.5)
    expect(target.targetRepsMin).toBe(8)
    expect(target.targetRepsMax).toBe(12)
    expect(target.tip).toBe('Toutes les séries ≥ 12 reps : charge augmentée.')
  })

  it('n’ajoute jamais de poids au poids du corps', () => {
    const session = makeSession(
      '2026-10-20',
      makeSets([
        { weight: 0, reps: 8 },
        { weight: 0, reps: 7 },
      ]),
    )
    const [target] = computeFallbackTargets([exercise], [session], settings)
    expect(target.targetWeight).toBe(0)
    expect(target.targetRepsMin).toBe(8)
    expect(target.targetRepsMax).toBe(8)
  })

  it('propose une fourchette 8–12 sans historique', () => {
    const [target] = computeFallbackTargets([exercise], [], settings)
    expect(target.targetWeight).toBe(0)
    expect(target.targetRepsMin).toBe(8)
    expect(target.targetRepsMax).toBe(12)
    expect(target.targetRestSeconds).toBe(settings.defaultRestSeconds)
    expect(target.tip).toBe('Première fois : choisis une charge qui permet 8 à 12 reps propres.')
  })

  it('moyenne les repos réels et les borne entre 60 et 180 s', () => {
    const session = makeSession(
      '2026-10-20',
      makeSets([
        { weight: 50, reps: 10, rest: 300 },
        { weight: 50, reps: 9, rest: 300 },
      ]),
    )
    const [clamped] = computeFallbackTargets([exercise], [session], settings)
    expect(clamped.targetRestSeconds).toBe(180)

    const shortSession = makeSession(
      '2026-10-21',
      makeSets([
        { weight: 50, reps: 10, rest: 10 },
        { weight: 50, reps: 9, rest: 20 },
      ]),
    )
    const [tooShort] = computeFallbackTargets([exercise], [shortSession], settings)
    expect(tooShort.targetRestSeconds).toBe(60)
  })

  it('utilise la performance la plus récente', () => {
    const older = makeSession('2026-10-01', makeSets([{ weight: 40, reps: 12 }]))
    const recent = makeSession('2026-10-20', makeSets([{ weight: 50, reps: 8 }]))
    const last = getLastPerformance(exercise.id, [older, recent])
    expect(last?.session.date).toBe('2026-10-20')
    const [target] = computeFallbackTargets([exercise], [older, recent], settings)
    expect(target.targetWeight).toBe(50)
    expect(target.targetRepsMin).toBe(9)
  })

  it('ignore les séries non validées et les sessions planifiées', () => {
    const planned: Session = {
      ...makeSession('2026-10-22', []),
      status: 'planned',
      exercises: [{ exerciseId: exercise.id, sets: makeSets([{ weight: 999, reps: 10 }]), note: '' }],
    }
    const [target] = computeFallbackTargets([exercise], [planned], settings)
    expect(target.targetWeight).toBe(0)
  })

  it('formule la note globale du mode hors-ligne', () => {
    expect(fallbackGlobalNote(settings)).toContain('Mode hors-ligne')
    expect(fallbackGlobalNote(settings)).toContain('2.5 kg')
  })
})
