import { describe, expect, it } from 'vitest'
import { normalizeName, parseComment, parseDate, parseNotes, parseSets, suggestSessionTypes } from './parser'

const currentYear = new Date().getFullYear()

describe('parseNotes — cas obligatoires', () => {
  it('parse une ligne complète (forme A)', () => {
    const result = parseNotes(
      'Extension triceps à la poulie : 24/10/2026 : 15kg x 11, 9 - 12kg x 11 (repos 1m30)',
    )
    expect(result.errors).toEqual([])
    expect(result.performances).toHaveLength(1)
    const performance = result.performances[0]
    expect(performance.exerciseName).toBe('Extension triceps à la poulie')
    expect(performance.date).toBe('2026-10-24')
    expect(performance.sets).toEqual([
      { weight: 15, reps: 11 },
      { weight: 15, reps: 9 },
      { weight: 12, reps: 11 },
    ])
    expect(performance.restSeconds).toBe(90)
    expect(performance.note).toBe('')
  })

  it('parse un en-tête d’exercice suivi de dates (forme B)', () => {
    const raw = 'Leg press :\n20/10 : 120kg x 10, 10, 8\n13/10 : 115kg x 10, 10, 10'
    const result = parseNotes(raw, new Date(`${currentYear}-06-01T12:00:00Z`))
    expect(result.errors).toEqual([])
    expect(result.performances).toHaveLength(2)
    expect(result.performances[0].exerciseName).toBe('Leg press')
    expect(result.performances[1].exerciseName).toBe('Leg press')
    expect(result.performances.map((performance) => performance.date)).toEqual([
      `${currentYear}-10-20`,
      `${currentYear}-10-13`,
    ])
    expect(result.performances[0].sets).toHaveLength(3)
  })

  it('gère le poids du corps', () => {
    const result = parseNotes('Tractions : 24/10/2026 : PDC x 8, 7, 6')
    expect(result.errors).toEqual([])
    expect(result.performances[0].sets).toEqual([
      { weight: 0, reps: 8 },
      { weight: 0, reps: 7 },
      { weight: 0, reps: 6 },
    ])
  })

  it('gère la virgule décimale, le ×, le repos 2min et la note', () => {
    const result = parseNotes('Curl : 24/10/26 : 12,5kg × 12 (repos 2min, bras gauche faible)')
    expect(result.errors).toEqual([])
    const performance = result.performances[0]
    expect(performance.sets).toEqual([{ weight: 12.5, reps: 12 }])
    expect(performance.restSeconds).toBe(120)
    expect(performance.note).toBe('bras gauche faible')
    expect(performance.date).toBe('2026-10-24')
  })

  it('signale une ligne non reconnue', () => {
    const result = parseNotes('blabla sans format')
    expect(result.performances).toEqual([])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].reason).toBe('unrecognized')
    expect(result.errors[0].line).toBe(1)
  })

  it('signale une date sans exercice courant', () => {
    const result = parseNotes('24/10 : 10kg x 5')
    expect(result.performances).toEqual([])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].reason).toBe('no_exercise_context')
  })

  it('signale une date invalide', () => {
    const result = parseNotes('Squat : 31/02/2026 : 100kg x 5')
    expect(result.performances).toEqual([])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].reason).toBe('invalid_date')
  })
})

describe('parseNotes — tolérance', () => {
  it('ignore les lignes vides et les espaces multiples', () => {
    const result = parseNotes(
      '\n\nDéveloppé couché :   24/10/2026 :   80kg   x   10\n\n\t\n',
    )
    expect(result.errors).toEqual([])
    expect(result.performances[0].sets).toEqual([{ weight: 80, reps: 10 }])
  })

  it('accepte l’unité absente et le séparateur slash', () => {
    const result = parseNotes('Squat : 24/10/2026 : 15 x 11 / 20kg x 8')
    expect(result.performances[0].sets).toEqual([
      { weight: 15, reps: 11 },
      { weight: 20, reps: 8 },
    ])
  })

  it('accepte le séparateur * et X', () => {
    const result = parseNotes('Rowing : 24/10/2026 : 60KG * 10 - 60kg X 8')
    expect(result.performances[0].sets).toEqual([
      { weight: 60, reps: 10 },
      { weight: 60, reps: 8 },
    ])
  })

  it('remonte les erreurs avec leur numéro de ligne', () => {
    const result = parseNotes('Squat : 24/10/2026 : 100kg x 5\nfoo\nbad date : 32/13/2026 : 10kg x 2')
    expect(result.performances).toHaveLength(1)
    expect(result.errors.map((error) => error.line)).toEqual([2, 3])
  })
})

describe('parseSets', () => {
  it('retourne null si un bloc est invalide', () => {
    expect(parseSets('15kg x')).toBeNull()
    expect(parseSets('abc')).toBeNull()
    expect(parseSets('15kg x 10, abc')).toBeNull()
  })

  it('accepte poids du corps en minuscules et points décimaux', () => {
    expect(parseSets('pdc x 5')).toEqual([{ weight: 0, reps: 5 }])
    expect(parseSets('BW x 5')).toEqual([{ weight: 0, reps: 5 }])
    expect(parseSets('poids du corps x 5')).toEqual([{ weight: 0, reps: 5 }])
    expect(parseSets('12.5 x 5')).toEqual([{ weight: 12.5, reps: 5 }])
  })
})

describe('parseComment', () => {
  it('convertit les repos en secondes', () => {
    expect(parseComment('repos 1m30').restSeconds).toBe(90)
    expect(parseComment('repos 2min').restSeconds).toBe(120)
    expect(parseComment('repos 90s').restSeconds).toBe(90)
    expect(parseComment('repos').restSeconds).toBeNull()
    expect(parseComment('repos').note).toBe('')
    expect(parseComment('REPOS 1M').restSeconds).toBe(60)
    expect(parseComment('repos 1h').restSeconds).toBe(3600)
    expect(parseComment('repos 90').restSeconds).toBe(90)
  })

  it('conserve le reste du commentaire comme note', () => {
    expect(parseComment('repos 1m30, douleur épaule')).toEqual({
      restSeconds: 90,
      note: 'douleur épaule',
    })
    expect(parseComment('bras gauche faible')).toEqual({
      restSeconds: null,
      note: 'bras gauche faible',
    })
  })
})

describe('parseDate', () => {
  it('complète l’année et rejette les dates impossibles', () => {
    const now = new Date('2026-10-22T10:00:00Z')
    expect(parseDate('24/10', now)).toBe('2026-10-24')
    expect(parseDate('24/10/26', now)).toBe('2026-10-24')
    expect(parseDate('24.10.2026', now)).toBe('2026-10-24')
    expect(parseDate('29/02/2024', now)).toBe('2024-02-29')
    expect(parseDate('31/02/2026', now)).toBeNull()
    expect(parseDate('32/13/2026', now)).toBeNull()
  })
})

describe('normalizeName', () => {
  it('supprime accents, casse et espaces multiples', () => {
    expect(normalizeName('  Extension  Triceps à la POULIE ')).toBe('extension triceps a la poulie')
    expect(normalizeName('Développé   couché')).toBe('developpe couche')
  })
})

describe('suggestSessionTypes', () => {
  it('regroupe les séances proches (Jaccard ≥ 0.5)', () => {
    const groups = suggestSessionTypes([
      { date: '2026-10-01', exerciseNames: ['Squat', 'Leg press', 'Mollets'] },
      { date: '2026-10-03', exerciseNames: ['Développé couché', 'Rowing'] },
      { date: '2026-10-05', exerciseNames: ['Squat', 'Leg press', 'Fentes'] },
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0].name).toBe('Séance A')
    expect(groups[0].dates).toEqual(['2026-10-01', '2026-10-05'])
    expect(groups[1].name).toBe('Séance B')
  })
})
