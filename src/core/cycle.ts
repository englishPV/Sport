import type { ISODate, Session, SessionType } from './types'

/** Sessions prises en compte dans le cycle. */
export function isCycleSession(session: Session): boolean {
  return session.status === 'completed' || session.status === 'imported'
}

/** Tri décroissant par date puis endedAt (les sessions sans fin passent en dernier). */
export function sortSessionsDesc(sessions: readonly Session[]): Session[] {
  return [...sessions].sort((a, b) => {
    const byDate = b.date.localeCompare(a.date)
    if (byDate !== 0) return byDate
    return (b.endedAt ?? 0) - (a.endedAt ?? 0)
  })
}

export function sortSessionTypes(sessionTypes: readonly SessionType[]): SessionType[] {
  return [...sessionTypes].sort((a, b) => a.order - b.order)
}

/**
 * Retourne l'id du type de séance à faire ensuite.
 * 1. Aucun type → null.
 * 2. Dernière session completed|imported (date desc, endedAt desc).
 * 3. Aucune → type order 0.
 * 4. Type introuvable → type order 0.
 * 5. Type dont order === (dernier.order + 1) % length.
 */
export function getNextSessionTypeId(
  sessionTypes: SessionType[],
  sessions: Session[],
): string | null {
  const ordered = sortSessionTypes(sessionTypes)
  if (ordered.length === 0) return null
  const first = ordered.find((type) => type.order === 0) ?? ordered[0]

  const history = sortSessionsDesc(sessions.filter(isCycleSession))
  const last = history[0]
  if (!last) return first.id

  const lastType = ordered.find((type) => type.id === last.sessionTypeId)
  if (!lastType) return first.id

  const nextIndex = (lastType.order + 1) % ordered.length
  const next = ordered.find((type) => type.order === nextIndex)
  return (next ?? first).id
}

/** Nombre de jours écoulés depuis une date ISO (0 = aujourd'hui). */
export function daysSince(date: ISODate, now: Date = new Date()): number {
  const [year, month, day] = date.split('-').map(Number)
  if (!year || !month || !day) return 0
  const then = Date.UTC(year, month - 1, day)
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.max(0, Math.round((today - then) / 86_400_000))
}
