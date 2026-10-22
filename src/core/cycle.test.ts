import { describe, expect, it } from 'vitest'
import { daysSince, getNextSessionTypeId } from './cycle'
import type { Session, SessionStatus, SessionType } from './types'

function makeType(id: string, name: string, order: number): SessionType {
  return { id, name, order, exerciseIds: [] }
}

function makeSession(params: {
  id: string
  sessionTypeId: string
  date: string
  endedAt?: number | null
  status?: SessionStatus
}): Session {
  return {
    id: params.id,
    sessionTypeId: params.sessionTypeId,
    date: params.date,
    startedAt: null,
    endedAt: params.endedAt ?? null,
    status: params.status ?? 'completed',
    exercises: [],
    coachPlan: null,
    source: 'app',
  }
}

const haut = makeType('t-haut', 'HAUT', 0)
const bas = makeType('t-bas', 'BAS', 1)
const bras = makeType('t-bras', 'BRAS', 2)

describe('getNextSessionTypeId', () => {
  it('retourne null sans type de séance', () => {
    expect(getNextSessionTypeId([], [])).toBeNull()
  })

  it('retourne le type order 0 sans historique', () => {
    expect(getNextSessionTypeId([bas, haut], [])).toBe('t-haut')
  })

  it('alternerait HAUT → BAS sur un cycle de 2', () => {
    const sessions = [makeSession({ id: 's1', sessionTypeId: 't-haut', date: '2026-10-20' })]
    expect(getNextSessionTypeId([haut, bas], sessions)).toBe('t-bas')
  })

  it('alternerait BAS → HAUT sur un cycle de 2', () => {
    const sessions = [makeSession({ id: 's1', sessionTypeId: 't-bas', date: '2026-10-20' })]
    expect(getNextSessionTypeId([haut, bas], sessions)).toBe('t-haut')
  })

  it('boucle sur un cycle de 3', () => {
    const sessions = [makeSession({ id: 's1', sessionTypeId: 't-bras', date: '2026-10-20' })]
    expect(getNextSessionTypeId([haut, bas, bras], sessions)).toBe('t-haut')
  })

  it('utilise la séance la plus récente (date puis endedAt)', () => {
    const sessions = [
      makeSession({ id: 's1', sessionTypeId: 't-bas', date: '2026-10-18', endedAt: 5 }),
      makeSession({ id: 's2', sessionTypeId: 't-haut', date: '2026-10-18', endedAt: 9 }),
    ]
    expect(getNextSessionTypeId([haut, bas], sessions)).toBe('t-bas')
  })

  it('ignore une session en cours et les sessions planifiées', () => {
    const sessions = [
      makeSession({ id: 's0', sessionTypeId: 't-haut', date: '2026-10-10' }),
      makeSession({ id: 's1', sessionTypeId: 't-haut', date: '2026-10-21', status: 'in_progress' }),
      makeSession({ id: 's2', sessionTypeId: 't-haut', date: '2026-10-22', status: 'planned' }),
    ]
    expect(getNextSessionTypeId([haut, bas], sessions)).toBe('t-bas')
  })

  it('retombe sur order 0 si le type de la dernière séance a disparu', () => {
    const sessions = [makeSession({ id: 's1', sessionTypeId: 'supprimé', date: '2026-10-20' })]
    expect(getNextSessionTypeId([haut, bas], sessions)).toBe('t-haut')
  })
})

describe('daysSince', () => {
  it('compte les jours calendaires', () => {
    const now = new Date('2026-10-22T20:00:00')
    expect(daysSince('2026-10-22', now)).toBe(0)
    expect(daysSince('2026-10-20', now)).toBe(2)
  })
})
