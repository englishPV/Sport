import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { computeExerciseDdpPlan } from './ddp'
import { extractAthleteRulesFromPreamble } from './gemini'
import { buildCoachPrompt } from './coachPrompt'
import { exportNotepad, parseNotepad } from './parser'
import type { Exercise } from './types'

const countSets = (exercises: readonly Exercise[]) =>
  exercises.reduce((n, ex) => n + ex.entries.reduce((m, e) => m + e.sets.length, 0), 0)

/**
 * Vérification sur le carnet réel de l'utilisateur : il contient des données personnelles,
 * il reste donc hors du dépôt et ce bloc est sauté quand il est absent (CI).
 */
const REAL_FILE = 'previous repetitions.txt'
/** Le carnet complet collé dans le dépôt local (non versionné) : `userNotepad.txt`. */
const NOTEPAD_FILE = existsSync(REAL_FILE) ? REAL_FILE : 'userNotepad.txt'

describe.skipIf(!existsSync(NOTEPAD_FILE))('vrai carnet : ce que le coach reçoit', () => {
  const text = existsSync(NOTEPAD_FILE) ? readFileSync(NOTEPAD_FILE, 'utf8') : ''
  const parsed = parseNotepad(text)
  const prompt = buildCoachPrompt({
    section: 'legs',
    exercises: parsed.exercises,
    athleteRules: extractAthleteRulesFromPreamble(parsed.preamble),
    settings: { profileHeightCm: 184, profileWeightKg: 72 },
    todayIso: '2026-11-11',
  })

  it('ne garde du préambule que les règles d’entraînement, sans la mise en forme du carnet', () => {
    expect(prompt).toContain('Double Progression Dynamique')
    expect(prompt).not.toContain('BLOC DE CODE MARKDOWN')
    expect(prompt).not.toContain("RÈGLE DE SÉLECTION DU JOUR")
  })

  it('donne les charges réellement faites, série par série', () => {
    expect(prompt).toContain('50 kg × 10 | 80 kg × 6 | 100 kg × 9 | 90 kg × 11, 11')
    expect(prompt).toContain('24 kg × 11, 11 | 22 kg × 11')
  })

  it('transmet les commentaires de l’athlète là où ils ont été écrits', () => {
    expect(prompt).toContain('j’ai dormis peu aujourd’hui')
    expect(prompt).toContain('peut être c’est plus simple la version où je suis sur le ventre ?')
  })

  it('ne montre jamais au modèle les exercices de l’autre séance', () => {
    expect(prompt).toContain('Leg press')
    expect(prompt).not.toContain('Développé incliné haltères')
  })

  it('propose pour chaque exercice des cibles exploitables, série par série', () => {
    const legPress = parsed.exercises.find((ex) => ex.name === 'Leg press')!
    const plan = computeExerciseDdpPlan(legPress)
    // 100 kg × 9 en Série 1 → même charge, +1 rep ; les séries à 90 kg montent d'un cran à 12 reps.
    expect(plan.sets.filter((s) => !s.isWarmup).map((s) => [s.weight, s.suggestedReps])).toEqual([
      [100, 10],
      [90, 12],
      [90, 12],
    ])
    for (const ex of parsed.exercises.filter((e) => e.active)) {
      const exPlan = computeExerciseDdpPlan(ex)
      expect(exPlan.sets.length).toBeGreaterThan(0)
      expect(exPlan.sets.every((s) => s.suggestedReps > 0)).toBe(true)
    }
  })

  it('garde les échauffements et les commentaires à l’export', () => {
    const withPlan = exportNotepad({
      preamble: parsed.preamble,
      exercises: parsed.exercises,
      planDateIso: '2026-11-11',
      plan: {
        section: 'legs',
        generatedAt: 0,
        source: 'ddp',
        model: null,
        summaryLines: [],
        exercises: Object.fromEntries(
          parsed.exercises
            .filter((ex) => ex.section === 'legs')
            .map((ex) => [ex.id, computeExerciseDdpPlan(ex)]),
        ),
      },
    })
    // La ligne prévue marque les échauffements : elle ne doit pas les transformer en séries de travail.
    expect(withPlan).toContain('50kg (échauffement) x 10 | 80kg (échauffement) x 6')

    const plain = exportNotepad({ preamble: parsed.preamble, exercises: parsed.exercises })
    const again = parseNotepad(plain)
    expect(countSets(again.exercises)).toBe(countSets(parsed.exercises))
  })
})
