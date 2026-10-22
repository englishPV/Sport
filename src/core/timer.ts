import type { ISODate, Timestamp } from './types'

export interface RestTimerValue {
  startedAt: Timestamp
  durationSeconds: number
}

/** Secondes restantes (peut être négatif = dépassement). */
export function getRemaining(timer: RestTimerValue, now: Timestamp): number {
  return timer.durationSeconds - (now - timer.startedAt) / 1000
}

/** Ajoute des secondes au timer (fonctionne aussi en dépassement). */
export function extendTimer(timer: RestTimerValue, seconds: number): RestTimerValue {
  return { ...timer, durationSeconds: timer.durationSeconds + seconds }
}

export function hasExpired(timer: RestTimerValue, now: Timestamp): boolean {
  return getRemaining(timer, now) < 0
}

/** Signe du temps restant : sert à détecter le passage ≥ 0 → < 0. */
export function remainingSign(remainingSeconds: number): -1 | 0 | 1 {
  if (remainingSeconds < 0) return -1
  if (remainingSeconds === 0) return 0
  return 1
}

function splitSeconds(seconds: number): { total: number; minutes: number; secs: number } {
  // Compte à rebours : on arrondit vers le haut pour afficher 1:30 dès le départ.
  const total = seconds >= 0 ? Math.ceil(seconds) : Math.floor(Math.abs(seconds))
  return { total, minutes: Math.floor(total / 60), secs: total % 60 }
}

/** `m:ss` si restant ≥ 0, `+m:ss` en dépassement. */
export function formatRemaining(remainingSeconds: number): string {
  const { minutes, secs } = splitSeconds(remainingSeconds)
  const body = `${minutes}:${String(secs).padStart(2, '0')}`
  return remainingSeconds < 0 ? `+${body}` : body
}

/** `mm:ss`, ou `h:mm:ss` à partir d'une heure. */
export function formatElapsed(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

/** Date locale au format `YYYY-MM-DD`. */
export function toISODate(date: Date): ISODate {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function todayISODate(now: Date = new Date()): ISODate {
  return toISODate(now)
}
