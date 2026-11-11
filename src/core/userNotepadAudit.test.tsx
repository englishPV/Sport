import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { LEGACY_NOTEPAD_PREAMBLE } from './__fixtures__/legacyNotepad'
import { buildCoachPrompt, guardExercisePlan } from './coachPrompt'
import { buildDdpSessionPlan, computeExerciseDdpPlan, getRecommendedSection } from './ddp'
import { DEFAULT_NOTEPAD_TEXT } from './defaultNotepad'
import { exportNotepad, parseNotepad } from './parser'
import {
  buildEnrichedChronology,
  computeSmartExerciseInsight,
  getLatestRecordInfo,
} from './statsEngine'
import { buildStatsReport } from './statsReport'
import { useWorkoutStore } from '../store/useWorkoutStore'
import { computePerfState } from '../views/WorkoutView'

const USER_PASTED_NOTEPAD_NOV = `${LEGACY_NOTEPAD_PREAMBLE}


Up Développé incliné haltères :
• 09/11/2026 (Objectif) : 12kg (pas trouvé 10) x 12 | 20kg x 10, 9 | 18kg x 11 (Repos : 2min30)
• 02/11/2026 : 10kg x 12 | 22kg x 12 (j’aurais pu faire 13) | 20kg x 12, 8 (repos : 2min30) (épaule gauche)
• 26/10/2026 : 10kg x 12 | 22kg x 10 | 20kg x 12, 9 (repos : 2min30)

Tirage vertical :
• 09/11/2026 (Objectif) : 55kg x 10 | 50kg x 12, 11 (Repos : 2min)
• 02/11/2026 : 50kg x 12, 12, 12 (Repos : 2min)

Chest press (machine) :
• 09/11/2026 (Objectif) : 30kg x 11 | 25kg x 12, 10 (Repos : 2min30)
• 02/11/2026 : 30kg x 10 | 25kg x 11, 10 (Repos : 2min30)

Tirage horizontal (poulie basse) :
• 09/11/2026 (Objectif) : 50kg x 11 | 45kg x 12, 10 (Repos : 2min30)
• 02/11/2026 : 50kg x 10 (essoufflé) | 45kg x 11, 10 (Repos : 2min30)

(Shoulder press :
• 15kg x 10, 9, 9
• 20kg (par cote) x 9, 5 | 15kg x 6)

Élévations latérales aux haltères:
• 09/11/2026 (Objectif) : 10kg x 14 | 8kg x 12/13, 11 (Repos : 1min30)
• 02/11/2026 : 10kg x 13 | 8kg x 12, 11 (Repos : 1min30)

Extensions Triceps à la poulie haute avec corde :
• 09/11/2026 (Objectif) : 15kg x 11,5 | 12,5kg x 13, 12 (Repos : 2min)
• 02/11/2026 : 15kg x 11,5 | 12,5kg x 12, 11 (Repos : 2min)

Curl incliné (haltères ou poulie) :
• 09/11/2026 (Objectif) : 10kg x 14, 12 | 9kg x 13 (1 main par 1 main) (Repos : 2min)
• 02/11/2026 : haltères de 10kg x 13, 11 | 9kg x 13 (Repos : 2min)
• 26/10/2026 (poulie) : 20kg x 12 | 15kg x 13 | 12,5kg x 13 (Repos : 2min)

Développé couché barre :
• 10kg (par côté) × 11, 10, 6, 5

Tractions :
• Poids de corps × 4, 3


Jambes (Legs)

Leg press :
• 03/11/2026 : 50kg x 12 | 100kg x 9 | 90kg x 12, 11 (Repos : 2min30)
• 26/10/2026 : 50kg x 12 | 100kg x 8 | 90kg x 11, 11 (Repos : 2min30)
• 20/10/2026 : 50kg x 12 | 100kg x 9 | 90kg x 11, 10 (Repos : 2min30)

Soulevé de Terre Roumain :
• 03/11/2026 ((Repos : 2min)
• 26/10/2026 : 24kg x 10 | 22kg x 12, 12 (Repos : 2min30)
• 21/10/2026 : 22kg x 12 | 20kg x 12, 12 (Repos : 2min30)

Leg extension :
• 03/11/2026 : 55kg x 12 | 50kg x 12, 12 (Repos : 2min)
• 26/10/2026 : 55kg x 11 | 50kg x 12, 11 (Repos : 2min)
• 21/10/2026 : Machine 2 : 50kg x 12 | 55kg x 10 , 9 (Repos : 2min30)

Leg curl :
• 03/11/2026 : 55kg x 7 | 50kg x 10, 10 (Repos : 2min)
• 26/10/2026 : 55kg x 8 | 50kg x 12, 11 (Repos : 2min)
• 21/10/2026 : 50kg x 12 | 50kg x 10, 8 (Repos : 2min30)

Machine assis (mollets) :
• 03/11/2026 : Calf : 25kg x 20, 20 (Repos : 1min30)
• 26/10/2026 : assis de hammer strengh (avant je faisais Calf, je crois, c’est des mollets jambe tendues, et je pourrais faire du Calf jusqu'au 2 novembre exclus) : 40kg x 12, 12, 12, 11 (Repos : 1min30)
• 20/10/2026 : 40kg x 12, 11, 11, 11 (Repos : 1min30)
• 12/10/2026 : 35kg x 15, 15, 14, 13 (Repos : 1min30)

Total abdominaux (machine assis crunch vers le bas) :
• 03/11/2026 : 55kg x 15 | 50kg x 15, 14 (Repos : 1min30)
• 26/10/2026 : 55kg x 14 | 50kg x 15, 13 (Repos : 1min30)
• Poids de corps x 14, 15, 11

Squat haltère :
• 10kg × 12 | 14kg × 15, 15, 15
`

describe('Carnet réel collé sur le site (audit & non-régression)', () => {
  beforeEach(() => {
    localStorage.clear()
    useWorkoutStore.getState().resetToDefaultNotepad()
    useWorkoutStore.getState().clearApiKey()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('parse fidèlement les notations réelles (12/13, notes par série, échauffements, balises ``` et collage sous le modèle)', () => {
    const parsed = parseNotepad(USER_PASTED_NOTEPAD_NOV, { todayIso: '2026-11-11' })
    expect(getRecommendedSection(parsed.exercises).recommended).toBe('legs')

    // Slash 12/13 -> 1 série (pas 2)
    const lat = parsed.exercises.find((e) => e.name.startsWith('Élévations'))!
    expect(lat.entries[0].sets.map((s) => s.reps)).toEqual([14, 12, 11])

    // Note d'échauffement conservée sur set[0], et DDP restaure l'échauffement voulu à 10 kg
    const dev = parsed.exercises.find((e) => e.name.startsWith('Développé incliné'))!
    expect(dev.entries[0].sets[0]).toMatchObject({
      weight: 12,
      reps: 12,
      isWarmup: true,
      note: 'pas trouvé 10',
    })
    expect(dev.entries[0].sets[1].note).toBeUndefined()
    expect(computeExerciseDdpPlan(dev).sets[0]).toMatchObject({ weight: 10, isWarmup: true })

    // Commentaire en S3 reste sur S3 ; préfixe "haltères de" conservé dans entry.note ; palier affiné à 1 kg (10kg | 9kg)
    const curl = parsed.exercises.find((e) => e.name.startsWith('Curl incliné'))!
    expect(curl.entries[0].sets[2].note).toBe('1 main par 1 main')
    expect(curl.entries[0].sets[0].note).toBeUndefined()
    expect(curl.entries[1].note).toContain('haltères de')
    expect(curl.weightStep).toBe(1)

    // Chest press (30kg | 25kg sur les 2 dernières séances) -> palier affiné à 5 kg
    const chest = parsed.exercises.find((e) => e.name.startsWith('Chest press'))!
    expect(chest.weightStep).toBe(5)

    // Ligne sautée `03/11/2026 ((Repos : 2min)` : note propre et repos habituel 2min30 conservé
    const rdl = parsed.exercises.find((e) => e.name.startsWith('Soulevé'))!
    expect(rdl.entries[0].skipOnly).toBe(true)
    expect(rdl.entries[0].note).toBe('')
    expect(rdl.defaultRestSeconds).toBe(150)
    expect(rdl.weightStep).toBe(2)

    // Tolère les blocs Markdown ``` et le collage sous DEFAULT_NOTEPAD_TEXT sans dupliquer les exos vides
    const fenced = parseNotepad('```txt\n' + USER_PASTED_NOTEPAD_NOV + '\n```', {
      todayIso: '2026-11-11',
    })
    const appended = parseNotepad(DEFAULT_NOTEPAD_TEXT + '\n' + USER_PASTED_NOTEPAD_NOV, {
      todayIso: '2026-11-11',
    })
    expect(fenced.exercises.map((e) => e.name)).toEqual(parsed.exercises.map((e) => e.name))
    expect(appended.exercises.map((e) => e.name)).toEqual(parsed.exercises.map((e) => e.name))
  })

  it('isole correctement les variantes (Hammer Strength assis vs Calf debout, Poulie vs Haltères) et la progression réelle', () => {
    const parsed = parseNotepad(USER_PASTED_NOTEPAD_NOV, { todayIso: '2026-11-11' })

    const mollets = parsed.exercises.find((e) => e.name.startsWith('Machine assis'))!
    const molletsChrono = buildEnrichedChronology(mollets)
    expect(molletsChrono.find((c) => c.entry.date === '2026-10-26')?.variant).toBe('Standard')
    expect(molletsChrono.find((c) => c.entry.date === '2026-11-03')?.variant).toBe('Debout (Calf)')
    expect(getLatestRecordInfo(mollets)?.isRecord).toBe(false)
    // La variante principale reste Standard (3 séances) au lieu de s'écraser sur le dépannage Calf (1 séance)
    expect(molletsChrono.filter((c) => c.isPrimaryVariant)).toHaveLength(3)

    // DDP hors-ligne + Garde-fou IA : reviennent tous deux aux 4 séries habituelles à 40 kg sur Machine assis
    const ddpMollets = computeExerciseDdpPlan(mollets)
    expect(ddpMollets.sets.map((s) => [s.weight, s.suggestedReps])).toEqual([
      [40, 13],
      [40, 13],
      [40, 13],
      [40, 12],
    ])
    // Et si la machine assise est occupée, la variante Debout (Calf) repart bien du 25 kg x 20, 20
    const ddpCalfVariant = computeExerciseDdpPlan(mollets, 'Debout (Calf)')
    expect(ddpCalfVariant.sets.map((s) => [s.weight, s.suggestedReps])).toEqual([
      [30, 14],
      [30, 14],
    ])
    const aiRestore = {
      exerciseId: mollets.id,
      restSeconds: 90,
      tip: 'Retour sur la machine assise à 40 kg.',
      sets: [13, 13, 13, 12].map((r) => ({
        weight: 40,
        repsMin: r,
        repsMax: r,
        suggestedReps: r,
      })),
    }
    expect(guardExercisePlan(mollets, aiRestore, ddpMollets).corrected).toBe(false)

    // Leg curl (55×8 -> 55×7) n'est pas compté comme "progressing"
    const legCurl = parsed.exercises.find((e) => e.name === 'Leg curl')!
    expect(computeSmartExerciseInsight(legCurl).status).toBe('stable')

    // Rapport stats cohérent (pas de fausse stagnation sur Leg press 8->9, record Curl = 10 kg et non 20 kg poulie)
    const report = buildStatsReport({
      exercises: parsed.exercises,
      profile: { heightCm: 184, weightKg: 72 },
      now: new Date('2026-11-11T12:00:00'),
    })
    expect(report).not.toContain('Stagnation : Leg press')
    expect(report).toContain('- Record : 10 kg × 14')

    // Prompt coach remonte aussi les signaux d'échauffement ("pas trouvé 10") et le DDP mentionne l'unilatéral (1 par 1)
    const upPrompt = buildCoachPrompt({
      section: 'up',
      exercises: parsed.exercises,
      athleteRules: parsed.preamble,
      settings: { profileHeightCm: 184, profileWeightKg: 72 },
      todayIso: '2026-11-11',
    })
    expect(upPrompt).toContain('échauffement : « pas trouvé 10 »')
    const curlEx = parsed.exercises.find((e) => e.name.startsWith('Curl incliné'))!
    expect(computeExerciseDdpPlan(curlEx).tip).toContain('1 par 1')
  })

  it('exporte et réimporte les lignes (Objectif) du jour sans inverser la séance recommandée', () => {
    const parsed = parseNotepad(USER_PASTED_NOTEPAD_NOV, { todayIso: '2026-11-11' })
    const legsPlan = buildDdpSessionPlan(parsed.exercises, 'legs')
    const exportedWithObj = exportNotepad({
      preamble: parsed.preamble,
      exercises: parsed.exercises,
      plan: legsPlan,
      planDateIso: '2026-11-11',
      includeObjectives: true,
    })
    expect(exportedWithObj).toContain('• 11/11/2026 (Objectif) :')

    const reimported = parseNotepad(exportedWithObj)
    // Même sans settlement, un (Objectif) daté d'aujourd'hui (2026-11-11) ne passe pas pour une séance faite
    const rec = getRecommendedSection(reimported.exercises)
    expect(rec.recommended).toBe('legs')
    expect(rec.legsLastDate).toBe('2026-11-03')
  })

  it('gère une vraie séance en salle : fourchette verte 8-10, commentaire par série, repos intra-exo pur et ajout/saut de série', async () => {
    // 1. Couleur verte sur toute la fourchette 8-10 lors d'une montée de charge
    expect(
      computePerfState({ value: 8, target: 10, targetMin: 8, prev: null, step: 1 }),
    ).toBe('target')
    expect(
      computePerfState({ value: 9, target: 10, targetMin: 8, prev: null, step: 1 }),
    ).toBe('target')
    expect(
      computePerfState({ value: 11, target: 10, targetMin: 8, prev: null, step: 1 }),
    ).toBe('above')

    // 2. Parcours UI complet sur le carnet importé
    await useWorkoutStore.getState().importNotepadSmart(USER_PASTED_NOTEPAD_NOV)
    const user = userEvent.setup()
    render(<App />)

    // Accueil : séance recommandée = Jambes + aperçu dépliable sans lancer le chrono
    expect(screen.getByRole('heading', { name: 'Jambes' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Aperçu de la séance/i }))
    expect(screen.getByText(/1\. Leg press/i)).toBeInTheDocument()

    // Lance la séance : Échauffement Leg press (50 kg x 12)
    await user.click(screen.getByRole('button', { name: 'Commencer' }))
    const commentInput = screen.getByPlaceholderText('Commentaire') as HTMLInputElement
    await user.type(commentInput, 'échauffement fluide')
    await user.click(screen.getByRole('button', { name: 'Valider' }))

    // Passe la pause de 60s après l'échauffement
    await user.click(screen.getByRole('button', { name: 'Passer' }))

    // Série 1 de travail : le commentaire de l'échauffement ne bave PAS sur la Série 1 !
    expect((screen.getByPlaceholderText('Commentaire') as HTMLInputElement).value).toBe('')

    // Pastille rapide en 1 tap ("+ 1 main par 1 main")
    await user.click(screen.getByRole('button', { name: /\+ 1 main par 1 main/i }))
    expect((screen.getByPlaceholderText('Commentaire') as HTMLInputElement).value).toBe(
      '1 main par 1 main',
    )

    // Menu 1 / 6 : ajoute une série puis passe la fin de l'exercice
    await user.click(screen.getByRole('button', { name: /1 \/ 6/ }))
    await user.click(screen.getByRole('button', { name: /Ajouter série/i }))
    await user.click(screen.getByRole('button', { name: /Passer la fin de cet exercice/i }))
    expect(screen.getByRole('heading', { name: /Soulevé de Terre Roumain/i })).toBeInTheDocument()

    // Sauvegarde JSON complète & restauration fidèle
    const backup = useWorkoutStore.getState().exportBackupJson()
    useWorkoutStore.getState().resetToDefaultNotepad()
    expect(useWorkoutStore.getState().exercises.some((e) => e.name === 'Soulevé de Terre Roumain')).toBe(
      false,
    )
    useWorkoutStore.getState().restoreFromBackupJson(backup)
    expect(useWorkoutStore.getState().exercises.some((e) => e.name === 'Soulevé de Terre Roumain')).toBe(
      true,
    )

    // Changement de variante en pleine séance (Machine assis <-> Debout (Calf))
    const molletsEx = useWorkoutStore
      .getState()
      .exercises.find((e) => e.name.startsWith('Machine assis'))!
    expect(useWorkoutStore.getState().activeDraft.logs[molletsEx.id].sets).toHaveLength(4)
    expect(useWorkoutStore.getState().activeDraft.logs[molletsEx.id].sets[0].weight).toBe(40)
    useWorkoutStore.getState().switchDraftExerciseVariant(molletsEx.id, 'Debout (Calf)')
    expect(useWorkoutStore.getState().activeDraft.logs[molletsEx.id].sets).toHaveLength(2)
    expect(useWorkoutStore.getState().activeDraft.logs[molletsEx.id].sets[0].weight).toBe(30)
    expect(useWorkoutStore.getState().activeDraft.logs[molletsEx.id].note).toBe('Debout (Calf)')

    // Correction directe d'une entrée d'historique sans passer par le gros .txt
    const curlEx = useWorkoutStore
      .getState()
      .exercises.find((e) => e.name.startsWith('Curl incliné'))!
    const targetEntryId = curlEx.entries[0].id
    const ok = useWorkoutStore
      .getState()
      .updateHistoryEntry(curlEx.id, targetEntryId, '10kg x 15, 13 | 9kg x 14 (Repos : 2min)')
    expect(ok).toBe(true)
    const updatedCurl = useWorkoutStore
      .getState()
      .exercises.find((e) => e.id === curlEx.id)!
    expect(updatedCurl.entries[0].sets.map((s) => s.reps)).toEqual([15, 13, 14])
  })
})
