import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getRecommendedSection } from './ddp'
import { exportNotepad, hasUnrecognizedWorkoutText, parseNotepad } from './parser'
import type { Exercise } from './types'

const countSets = (exercises: readonly Exercise[]) =>
  exercises.reduce((n, ex) => n + ex.entries.reduce((m, e) => m + e.sets.length, 0), 0)

describe('cases à cocher laissées par une appli de notes', () => {
  it('ignore les lignes `- [ ]` / `- [x]` sans créer de fausse séance', () => {
    const parsed = parseNotepad(
      [
        'Mes règles perso.',
        '',
        'Up Squat haltère :',
        '• 10kg × 12 | 14kg × 15, 15, 15',
        '- [ ]',
        '• 10kg × 12 | 14kg × 15, 15, 14',
        '- [x]',
        '• [ ] 10kg × 12 | 14kg × 15, 14, 14',
      ].join('\n'),
    )
    const squat = parsed.exercises.find((e) => /squat/i.test(e.name))
    expect(squat?.entries).toHaveLength(3)
    expect(squat?.entries.every((e) => e.sets.length === 4 && !e.skipOnly)).toBe(true)
    expect(squat?.entries.every((e) => !e.note.includes('['))).toBe(true)
  })
})

/**
 * Vérification sur le vrai bloc-notes de l'utilisateur. Le fichier contient des données
 * personnelles : il reste hors du dépôt, donc ce bloc est sauté quand il est absent (CI).
 */
const REAL_FILE = 'previous repetitions.txt'

describe.skipIf(!existsSync(REAL_FILE))('vrai bloc-notes local (non versionné)', () => {
  const text = existsSync(REAL_FILE) ? readFileSync(REAL_FILE, 'utf8') : ''
  const parsed = parseNotepad(text)

  it('garde le préambule (instructions à coller dans une IA) tel quel', () => {
    expect(parsed.preamble.startsWith("Aujourd'hui, c'est soit Haut du corps (Up)")).toBe(true)
    expect(parsed.preamble).toContain('(Objectif) : [Poids] x [Reps cibles pour chaque série]')
    expect(parsed.preamble).not.toContain('Développé incliné haltères :')
  })

  it('reconnaît tout le texte, dans les deux sections, sans fausse séance', () => {
    expect(hasUnrecognizedWorkoutText(text, parsed)).toBe(false)
    expect(parsed.exercises.some((e) => e.section === 'up')).toBe(true)
    expect(parsed.exercises.some((e) => e.section === 'legs')).toBe(true)
    const junk = parsed.exercises.flatMap((e) => e.entries).filter((e) => /^\[[ xX]?\]$/.test(e.note))
    expect(junk).toHaveLength(0)
  })

  it('recommande la section opposée à la dernière date enregistrée', () => {
    const rec = getRecommendedSection(parsed.exercises)
    expect(rec.upLastDate).not.toBeNull()
    expect(rec.legsLastDate).not.toBeNull()
    const upIsLatest = String(rec.upLastDate) > String(rec.legsLastDate)
    expect(rec.recommended).toBe(upIsLatest ? 'legs' : 'up')
  })

  it("ne perd aucune série ni aucun exercice à l'export puis réimport", () => {
    const exported = exportNotepad({ preamble: parsed.preamble, exercises: parsed.exercises })
    const again = parseNotepad(exported)
    expect(again.exercises.map((e) => e.name)).toEqual(parsed.exercises.map((e) => e.name))
    expect(countSets(again.exercises)).toBe(countSets(parsed.exercises))
    expect(again.preamble).toBe(parsed.preamble)
  })

  it('réécrit chaque ligne de séance telle quelle (commentaires à leur place)', () => {
    const exported = exportNotepad({ preamble: parsed.preamble, exercises: parsed.exercises })
    const bullets = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.startsWith('•') && !/^•\s*\[[ xX]?\]$/.test(l))
    expect(bullets.length).toBeGreaterThan(100)
    // Le « ) » final d'un bloc archivé est remis par l'export : on compare sans lui.
    const missing = bullets.filter((l) => !exported.includes(l.replace(/\)$/, '')))
    expect(missing).toEqual([])
  })

  it('export idempotent', () => {
    const once = exportNotepad({ preamble: parsed.preamble, exercises: parsed.exercises })
    const again = parseNotepad(once)
    expect(exportNotepad({ preamble: again.preamble, exercises: again.exercises })).toBe(once)
  })

  it('les objectifs du 09/11 comptent comme séances faites le 10/11', () => {
    const settled = parseNotepad(text, { todayIso: '2026-11-10' })
    const entries = settled.exercises.flatMap((e) => e.entries)
    expect(entries.some((e) => e.wasObjective)).toBe(false)
    expect(countSets(settled.exercises)).toBe(countSets(parsed.exercises))
    const exported = exportNotepad({ preamble: settled.preamble, exercises: settled.exercises })
    expect(exported.split('\n').filter((l) => l.startsWith('•') && /\(objectif\)/i.test(l))).toEqual([])
  })
})
