import { describe, expect, it } from 'vitest'
import {
  extendTimer,
  formatElapsed,
  formatRemaining,
  getRemaining,
  hasExpired,
  remainingSign,
  toISODate,
} from './timer'

describe('timer', () => {
  it('calcule le restant et accepte le dépassement', () => {
    const timer = { startedAt: 0, durationSeconds: 90 }
    expect(getRemaining(timer, 0)).toBe(90)
    expect(getRemaining(timer, 100_000)).toBe(-10)
    expect(getRemaining(timer, 30_000)).toBe(60)
  })

  it('+30 s fait repasser un timer dépassé en positif', () => {
    const timer = { startedAt: 0, durationSeconds: 90 }
    const now = 100_000
    const before = getRemaining(timer, now)
    expect(before).toBe(-10)
    const extended = extendTimer(timer, 30)
    expect(getRemaining(extended, now)).toBe(20)
  })

  it('détecte l’expiration et le signe', () => {
    const timer = { startedAt: 0, durationSeconds: 60 }
    expect(hasExpired(timer, 10_000)).toBe(false)
    expect(hasExpired(timer, 61_000)).toBe(true)
    expect(remainingSign(1)).toBe(1)
    expect(remainingSign(0)).toBe(0)
    expect(remainingSign(-1)).toBe(-1)
  })

  it('formate le restant avec signe explicite en dépassement', () => {
    expect(formatRemaining(90)).toBe('1:30')
    expect(formatRemaining(89.4)).toBe('1:30')
    expect(formatRemaining(15)).toBe('0:15')
    expect(formatRemaining(-15)).toBe('+0:15')
    expect(formatRemaining(-75)).toBe('+1:15')
  })

  it('formate le chrono global', () => {
    expect(formatElapsed(0)).toBe('00:00')
    expect(formatElapsed(65_000)).toBe('01:05')
    expect(formatElapsed(3_725_000)).toBe('1:02:05')
  })

  it('convertit une date locale en ISO', () => {
    expect(toISODate(new Date(2026, 9, 24, 8, 30))).toBe('2026-10-24')
  })
})
