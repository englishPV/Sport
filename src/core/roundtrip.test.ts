import { describe, expect, it } from 'vitest'
import { buildDdpSessionPlan } from './ddp'
import { DEFAULT_NOTEPAD_PREAMBLE, DEFAULT_NOTEPAD_TEXT } from './defaultNotepad'
import {
  exportNotepad,
  formatEntryForNotepad,
  formatPlanLineForNotepad,
  hasUnrecognizedWorkoutText,
  inferProfileFromPreamble,
  parseNotepad,
  settleObjectives,
} from './parser'
import type { ExerciseEntry } from './types'

const roundtrip = (text: string, todayIso?: string) => {
  const parsed = parseNotepad(text, { preserveCustomPreamble: true, todayIso })
  return exportNotepad({ preamble: parsed.preamble, exercises: parsed.exercises })
}

describe('export fidèle du bloc-notes', () => {
  const lines = [
    '• 08/10/2026 : 10kg x 12 (ça échauffe vraiment ?) | 20kg x 10 (j’aurai pu aller à 13 max), 10 (là aussi sûrement) | 18kg x 12 (repos : 2min30)',
    '• 15/10/2026 : 14kg (pas trouvé 10)  x 12 | 20kg x 12, 11 | 18kg x 12 (repos : 2min30)',
    '• 16kg x 12, 12, 11 (12 mais la dernière (90% d’amplitude) donc 11)',
    '• 14kg × 6 | 12kg × 5, 6',
  ]
  const text = ['Mes règles.', '', 'Up Développé incliné haltères :', ...lines, '', 'Jambes (Legs)', '', 'Presse :', '• 100kg x 12, 10'].join('\n')

  it('garde chaque commentaire à côté de la série concernée', () => {
    const exported = roundtrip(text)
    for (const line of lines) expect(exported).toContain(line)
  })

  it('est idempotent, même avec des parenthèses imbriquées', () => {
    const once = roundtrip(text)
    expect(roundtrip(once)).toBe(once)
  })

  it('normalise la puce et ignore les cases à cocher sans toucher au contenu', () => {
    const exported = roundtrip('Règles.\n\nUp Squat haltère :\n- 10kg × 12 | 14kg × 15 (dur)\n- [ ]\n* 10kg × 12')
    expect(exported).toContain('• 10kg × 12 | 14kg × 15 (dur)\n• 10kg × 12\n')
    expect(exported).not.toContain('[ ]')
  })

  it("écrit le commentaire d'une série saisie dans l'application juste après elle", () => {
    const entry: ExerciseEntry = {
      id: 'e1',
      date: '2026-11-10',
      restSeconds: 150,
      note: '',
      sets: [
        { weight: 10, reps: 12, isWarmup: true },
        { weight: 22, reps: 12, note: 'facile (vraiment)' },
        { weight: 22, reps: 9, failure: true, note: 'épaule' },
      ],
    }
    expect(formatEntryForNotepad(entry, 'kg')).toBe(
      // L'échauffement reste marqué : au réimport il ne doit pas passer pour une série de travail.
      '• 10/11/2026 : 10kg (échauffement) x 12 | 22kg x 12 (facile vraiment), 9 (échec) (épaule) (repos : 2min30)',
    )
  })
})

describe('lignes (Objectif)', () => {
  const text = [
    'Règles.',
    '',
    'Up Tirage vertical :',
    '• 10/11/2026 (Objectif) : 55kg x 12 | 50kg x 12, 12',
    '• 09/11/2026 (Objectif) : 55kg x 11 (dur) | 50kg x 12, 12 (repos : 2min)',
    '• 02/11/2026 (Objectif) : 55kg x 10',
    '• 02/11/2026 : 55kg x 10 | 50kg x 12, 12 (repos : 2min)',
  ].join('\n')

  it('une date passée devient une séance faite, la ligne restant intacte', () => {
    const parsed = parseNotepad(text, { todayIso: '2026-11-10' })
    const [today, yesterday, older] = parsed.exercises[0].entries
    expect(parsed.exercises[0].entries).toHaveLength(3)
    expect(today.wasObjective).toBe(true)
    expect(yesterday.wasObjective).toBeUndefined()
    expect(yesterday.sets.map((s) => s.reps)).toEqual([11, 12, 12])
    expect(older.date).toBe('2026-11-02')
    expect(older.sets).toHaveLength(3)

    const exported = roundtrip(text, '2026-11-10')
    expect(exported).toContain('• 10/11/2026 (Objectif) : 55kg x 12 | 50kg x 12, 12')
    expect(exported).toContain('• 09/11/2026 : 55kg x 11 (dur) | 50kg x 12, 12 (repos : 2min)')
  })

  it('sans date du jour, rien ne change ; le lendemain tout est rangé', () => {
    const untouched = parseNotepad(text).exercises
    expect(untouched[0].entries.filter((e) => e.wasObjective)).toHaveLength(3)
    const nextDay = settleObjectives(untouched, '2026-11-11')
    expect(nextDay[0].entries.some((e) => e.wasObjective)).toBe(false)
    expect(untouched[0].entries.filter((e) => e.wasObjective)).toHaveLength(3)
  })
})

describe('modèle de départ neutre', () => {
  const parsed = parseNotepad(DEFAULT_NOTEPAD_TEXT)

  it('ne contient aucune donnée personnelle ni séance', () => {
    expect(inferProfileFromPreamble(DEFAULT_NOTEPAD_TEXT)).toBeNull()
    expect(DEFAULT_NOTEPAD_TEXT).not.toMatch(/\d{2}\/\d{2}\/\d{4}/)
    expect(parsed.exercises.every((e) => e.entries.length === 0)).toBe(true)
  })

  it('est reconnu, stable, et utilisable sans historique', () => {
    expect(parsed.preamble).toBe(DEFAULT_NOTEPAD_PREAMBLE)
    expect(parsed.exercises.filter((e) => e.section === 'up')).toHaveLength(7)
    expect(parsed.exercises.filter((e) => e.section === 'legs')).toHaveLength(4)
    expect(parsed.exercises.every((e) => e.active)).toBe(true)
    expect(hasUnrecognizedWorkoutText(DEFAULT_NOTEPAD_TEXT, parsed)).toBe(false)
    expect(roundtrip(DEFAULT_NOTEPAD_TEXT)).toBe(DEFAULT_NOTEPAD_TEXT)
    for (const section of ['up', 'legs'] as const) {
      const plan = buildDdpSessionPlan(parsed.exercises, section)
      const ids = parsed.exercises.filter((e) => e.section === section).map((e) => e.id)
      expect(Object.keys(plan.exercises).sort()).toEqual(ids.sort())
      expect(Object.values(plan.exercises).every((p) => p.sets.length > 0)).toBe(true)
    }
  })
})

describe('profil lu dans le préambule', () => {
  it('reconnaît taille et poids, ignore le reste', () => {
    expect(inferProfileFromPreamble('Règle.\nJe mesure 1m84 pour 72kg (hypertrophie).')).toEqual({
      heightCm: 184,
      weightKg: 72,
    })
    expect(inferProfileFromPreamble('1 m 70, 65,5 kg')).toEqual({ heightCm: 170, weightKg: 65.5 })
    expect(inferProfileFromPreamble('augmente de +1kg à +2,5kg et vise 8-10 reps')).toBeNull()
  })
})

describe('commentaires et échauffements du carnet', () => {
  it('rattache un commentaire de série à la série qu’il suit', () => {
    const parsed = parseNotepad(
      [
        'Up Développé incliné haltères :',
        '• 09/11/2026 : 10kg x 12 | 22kg x 12 (j’aurais pu faire 13) | 20kg x 12, 8 (repos : 2min30) (épaule gauche)',
      ].join('\n'),
    )
    const sets = parsed.exercises[0].entries[0].sets
    expect(sets[0].isWarmup).toBe(true)
    expect(sets[0].note).toBeUndefined()
    // La note collée après la série parle de cette série, pas de l'exercice entier.
    expect(sets[1].note).toBe('j’aurais pu faire 13')
    // Une note ajoutée en fin de ligne revient à la première série de travail.
    expect(sets[2].note).toBe('épaule gauche')
    // Le repos reste une donnée de l'entrée : c'est ce qui l'exporte correctement.
    expect(parsed.exercises[0].entries[0].restSeconds).toBe(150)
  })

  it('marque les échauffements à l’export pour qu’ils ne deviennent pas des séries de travail', () => {
    const parsed = parseNotepad(
      ['Up Presse :', '• 04/11/2026 : 50kg (échauffement) x 10 | 100kg x 9, 9'].join('\n'),
    )
    const exported = exportNotepad({ preamble: parsed.preamble, exercises: parsed.exercises })
    expect(exported).toContain('50kg (échauffement) x 10')
    const again = parseNotepad(exported)
    const sets = again.exercises[0].entries[0].sets
    expect(sets[0].isWarmup).toBe(true)
    expect(sets.filter((s) => !s.isWarmup)).toHaveLength(2)
  })

  it('écrit l’échauffement dans la ligne (Objectif)', () => {
    const line = formatPlanLineForNotepad({
      dateIso: '2026-11-11',
      unit: 'kg',
      restSeconds: 150,
      sets: [
        { weight: 50, repsMin: 10, repsMax: 10, isWarmup: true },
        { weight: 100, repsMin: 8, repsMax: 10 },
      ],
    })
    expect(line).toBe('• 11/11/2026 (Objectif) : 50kg (échauffement) x 10 | 100kg x 8-10 (repos : 2min30)')
  })
})
