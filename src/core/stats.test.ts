import { describe, expect, it } from 'vitest'
import {
  epley1RM,
  getExerciseSeries,
  getGlobalProgression,
  getRecordBreaks,
  getSessionDurationSeconds,
  getSessionSetCount,
  getSessionVolume,
} from './stats'
import type { Session, SetEntry } from './types'

function makeSets(entries: { weight: number; reps: number; rest?: number | null }[]): SetEntry[] {
  return entries.map((entry, index) => ({
    index,
    weight: entry.weight,
    reps: entry.reps,
    restSecondsPlanned: 90,
    restSecondsActual: entry.rest ?? null,
    rpe: null,
    note: '',
    completedAt: 1_700_000_000_000 + index * 60_000,
  }))
}

function makeSession(params: {
  id: string
  date: string
  sets: SetEntry[]
  exerciseId?: string
  status?: Session['status']
  startedAt?: number | null
  endedAt?: number | null
}): Session {
  return {
    id: params.id,
    sessionTypeId: 'type-1',
    date: params.date,
    startedAt: params.startedAt ?? null,
    endedAt: params.endedAt ?? null,
    status: params.status ?? 'completed',
    exercises: [
      { exerciseId: params.exerciseId ?? 'ex-1', sets: params.sets, note: '' },
    ],
    coachPlan: null,
    source: 'app',
  }
}

describe('stats — séries', () => {
  it('calcule poids max, volume, repos moyen et 1RM estimé', () => {
    const session = makeSession({
      id: 's1',
      date: '2026-10-20',
      sets: makeSets([
        { weight: 100, reps: 10, rest: 90 },
        { weight: 110, reps: 5, rest: 120 },
      ]),
    })
    const [point] = getExerciseSeries('ex-1', [session])
    expect(point.maxWeight).toBe(110)
    expect(point.volume).toBe(1550)
    expect(point.avgRest).toBe(105)
    expect(point.estimated1RM).toBe(Math.max(epley1RM(100, 10), epley1RM(110, 5)))
  })

  it('retourne null quand aucun repos réel n’est renseigné', () => {
    const session = makeSession({ id: 's1', date: '2026-10-20', sets: makeSets([{ weight: 80, reps: 8 }]) })
    const [point] = getExerciseSeries('ex-1', [session])
    expect(point.avgRest).toBeNull()
  })

  it('trie par date et ignore les sessions planifiées', () => {
    const sessions = [
      makeSession({ id: 's2', date: '2026-10-20', sets: makeSets([{ weight: 90, reps: 8 }]) }),
      makeSession({ id: 's0', date: '2026-09-01', sets: makeSets([{ weight: 80, reps: 8 }]) }),
      makeSession({
        id: 's3',
        date: '2026-10-25',
        status: 'planned',
        sets: makeSets([{ weight: 300, reps: 8 }]),
      }),
      makeSession({ id: 's4', date: '2026-10-21', exerciseId: 'autre', sets: makeSets([{ weight: 10, reps: 5 }]) }),
    ]
    const series = getExerciseSeries('ex-1', sessions)
    expect(series.map((point) => point.date)).toEqual(['2026-09-01', '2026-10-20'])
  })

  it('calcule volume, séries et durée d’une séance', () => {
    const session = makeSession({
      id: 's1',
      date: '2026-10-20',
      sets: makeSets([
        { weight: 50, reps: 10 },
        { weight: 50, reps: 8 },
      ]),
      startedAt: 1_000_000,
      endedAt: 1_000_000 + 3_600_000,
    })
    expect(getSessionVolume(session)).toBe(900)
    expect(getSessionSetCount(session)).toBe(2)
    expect(getSessionDurationSeconds(session)).toBe(3600)
  })
})

describe('stats — records', () => {
  it('détecte un record de poids et de volume', () => {
    const previous = makeSession({
      id: 's1',
      date: '2026-10-10',
      sets: makeSets([{ weight: 100, reps: 8 }]),
    })
    const current = makeSession({
      id: 's2',
      date: '2026-10-20',
      sets: makeSets([
        { weight: 105, reps: 8 },
        { weight: 100, reps: 8 },
      ]),
    })
    const records = getRecordBreaks(current, [previous, current])
    expect(records).toEqual(
      expect.arrayContaining([
        { exerciseId: 'ex-1', kind: 'weight', value: 105, previous: 100 },
        { exerciseId: 'ex-1', kind: 'volume', value: 1640, previous: 800 },
      ]),
    )
  })

  it('ne signale pas de record en dessous de l’historique', () => {
    const previous = makeSession({
      id: 's1',
      date: '2026-10-10',
      sets: makeSets([{ weight: 120, reps: 8 }]),
    })
    const current = makeSession({
      id: 's2',
      date: '2026-10-20',
      sets: makeSets([{ weight: 100, reps: 8 }]),
    })
    expect(getRecordBreaks(current, [previous, current])).toEqual([])
  })

  it('ignore les répétitions nulles pour le record de poids', () => {
    const current = makeSession({
      id: 's2',
      date: '2026-10-20',
      sets: makeSets([{ weight: 200, reps: 0 }]),
    })
    expect(getRecordBreaks(current, [current])).toEqual([])
  })
})

describe('stats — progression globale', () => {
  it('compare les 4 dernières semaines aux 4 précédentes', () => {
    const now = new Date('2026-10-22T12:00:00Z').getTime()
    const sessions = [
      makeSession({ id: 's1', date: '2026-09-10', sets: makeSets([{ weight: 100, reps: 10 }]) }),
      makeSession({ id: 's2', date: '2026-10-12', sets: makeSets([{ weight: 100, reps: 15 }]) }),
    ]
    const progression = getGlobalProgression(sessions, now)
    expect(progression.previousVolume).toBe(1000)
    expect(progression.currentVolume).toBe(1500)
    expect(progression.percent).toBe(50)
  })

  it('retourne null sans volume précédent', () => {
    const now = new Date('2026-10-22T12:00:00Z').getTime()
    const sessions = [makeSession({ id: 's1', date: '2026-10-12', sets: makeSets([{ weight: 100, reps: 10 }]) })]
    expect(getGlobalProgression(sessions, now).percent).toBeNull()
  })
})
