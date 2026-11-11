import { describe, expect, it } from 'vitest'
import { buildCoachPrompt, guardExercisePlan } from './coachPrompt'
import { computeExerciseDdpPlan } from './ddp'
import { parseNotepad } from './parser'
import type { ExercisePlan } from './types'

const NOTEPAD = [
  'Up',
  'Chest press (machine) :',
  '• 09/11/2026 : 30kg x 11 | 22,5kg x 12 | 22,5kg x 10 (repos : 2min30)',
  '• 05/11/2026 : 30kg x 10 | 22,5kg x 11 | 22,5kg x 10 (repos : 2min30)',
  '',
  'Jambes (Legs)',
  'Leg press :',
  '• 03/11/2026 : 100kg x 9 | 90kg x 11 | 90kg x 11 (repos : 2min30)',
].join('\n')

const { exercises } = parseNotepad(NOTEPAD)
const chest = exercises.find((e) => e.name.startsWith('Chest'))!

function aiPlan(sets: [number, number][]): ExercisePlan {
  const ddp = computeExerciseDdpPlan(chest)
  return {
    ...ddp,
    sets: sets.map(([weight, reps]) => ({ ...ddp.sets[0], isWarmup: false, weight, suggestedReps: reps })),
  }
}

describe('prompt du coach', () => {
  it("ne contient que la séance imposée par l'application", () => {
    const prompt = buildCoachPrompt({
      section: 'up',
      exercises,
      athleteRules: '',
      settings: { profileHeightCm: 0, profileWeightKg: 0 },
      todayIso: '2026-11-11',
    })
    expect(prompt).toContain('Chest press')
    expect(prompt).not.toContain('Leg press')
    expect(prompt).toContain("séance déjà choisie par l'application : Haut du corps (Up)")
  })
})

describe('garde-fou sur le plan IA', () => {
  const ddp = computeExerciseDdpPlan(chest)

  it('accepte une proposition cohérente', () => {
    const res = guardExercisePlan(chest, aiPlan([[30, 12], [22.5, 12], [22.5, 11]]), ddp)
    expect(res.corrected).toBe(false)
  })

  it('revient à la base DDP sur une charge absurde', () => {
    const res = guardExercisePlan(chest, aiPlan([[80, 10], [22.5, 12], [22.5, 11]]), ddp)
    expect(res.corrected).toBe(true)
    expect(res.plan).toBe(ddp)
  })

  it('complète une série de travail oubliée avec la base DDP', () => {
    const res = guardExercisePlan(chest, aiPlan([[30, 12], [22.5, 12]]), ddp)
    expect(res.corrected).toBe(true)
    expect(res.plan.sets.filter((s) => !s.isWarmup)).toHaveLength(3)
  })
})

describe('contexte donné au coach', () => {
  const NOTEPAD = [
    'Je mesure 1m84 pour 72kg.',
    '',
    'Up Développé incliné haltères :',
    '• 09/11/2026 : 10kg (échauffement) x 12 | 22kg x 12 (j’aurais pu faire 13) | 20kg x 12, 8 (repos : 2min30)',
    '• 02/11/2026 : 10kg x 12 | 22kg x 11 | 20kg x 12, 9 (repos : 2min30)',
    '• 22/10/2026 : 10kg x 12 | 22kg x 10, 10 (repos : 2min30)',
    '• 15/10/2026 : 10kg x 12 | 20kg x 11 (repos : 2min30)',
    '• 08/10/2026 : 10kg x 12 | 20kg x 10 (repos : 2min30)',
    '• 05/10/2026 : 10kg x 12 | 18kg x 12, 12, 10 (repos : 2min30)',
  ].join('\n')
  const { exercises } = parseNotepad(NOTEPAD)
  const prompt = buildCoachPrompt({
    section: 'up',
    exercises,
    athleteRules: '',
    settings: { profileHeightCm: 184, profileWeightKg: 72 },
    todayIso: '2026-11-11',
  })

  it('transmet les 6 dernières séances, les 3 plus récentes en détail', () => {
    expect(prompt).toContain('dernières séances, la plus récente en premier')
    expect(prompt).toContain('séances plus anciennes (tendance de fond)')
    expect(prompt).toContain('22 kg × 12')
    expect(prompt).toContain('18 kg × 12, 12, 10')
    expect(prompt).toContain('6 dernières séances')
  })

  it('transmet le commentaire de série, la marge et le décrochage', () => {
    expect(prompt).toContain('S1 : « j’aurais pu faire 13 »')
    expect(prompt).toContain('décrochage de 4 reps')
    expect(prompt).toContain('repos réel 150 s')
  })

  it('donne le volume du jour comme garde-fou', () => {
    expect(prompt).toMatch(/VOLUME DU JOUR.*\n\d+ séries de travail et \d+ kg de tonnage/)
    expect(prompt).toContain('Ne propose pas de série supplémentaire')
  })

  it('demande un « pourquoi » vérifiable par exercice', () => {
    expect(prompt).toContain('rationale : une phrase courte qui justifie le choix')
  })
})
