import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { formatNumberFr } from './core/types'
import { STORAGE_KEY, useWorkoutStore } from './store/useWorkoutStore'
import { computePerfState } from './views/WorkoutView'

const TEST_VERTEX_KEY = 'AQ.TestVertexExpressDummyKey0000'

beforeEach(() => {
  window.scrollTo = vi.fn()
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    summary_lines: [],
                    headline: 'Progression propre sur les dernières séances.',
                    bullet_points: ['Changements de machines pris en compte.'],
                    exercises: [],
                  }),
                },
              ],
            },
          },
        ],
      }),
    }),
  )
  localStorage.removeItem(STORAGE_KEY)
  useWorkoutStore.getState().resetToDefaultNotepad()
  useWorkoutStore.getState().updateSettings({ apiKey: TEST_VERTEX_KEY })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Écran exercice épuré, code couleur, télémétrie 100% backend et statistiques dépliables', () => {
  it('code la couleur selon objectif (vert), au-dessus (bleu), dernière série (ambre) et descente progressive dans le rouge', () => {
    // Objectif = 11 reps, dernière fois = 10 reps
    expect(computePerfState({ value: 11, target: 11, prev: 10, step: 1 })).toBe('target')
    expect(computePerfState({ value: 12, target: 11, prev: 10, step: 1 })).toBe('above')
    expect(computePerfState({ value: 10, target: 11, prev: 10, step: 1 })).toBe('prev')
    expect(computePerfState({ value: 9, target: 11, prev: 10, step: 1 })).toBe('below-1')
    expect(computePerfState({ value: 8, target: 11, prev: 10, step: 1 })).toBe('below-2')
    expect(computePerfState({ value: 7, target: 11, prev: 10, step: 1 })).toBe('below-3')

    // Changement interactif dans l'interface
    render(<App />)
    act(() => {
      useWorkoutStore.getState().startWorkout()
    })

    const repsCard = screen.getByTestId('reps-card')
    expect(repsCard).toHaveAttribute('data-perf', 'target')
  })

  it('révèle la valeur de la séance précédente au maintien, sans menu de copie sur mobile', async () => {
    useWorkoutStore.getState().updateSettings({ apiKey: '' })
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Commencer' }))

    const state = useWorkoutStore.getState()
    const activeExercises = state.exercises.filter(
      (exercise) => exercise.section === state.activeDraft.section && exercise.active,
    )
    const exercise = activeExercises[state.cursor.exerciseIdx]
    const currentSet = state.activeDraft.logs[exercise.id].sets[state.cursor.setIdx]
    expect(currentSet.prevWeight).not.toBeNull()
    expect(currentSet.prevReps).not.toBeNull()

    const weightInput = screen.getByRole('spinbutton', { name: 'Poids en kg' })
    const repsInput = screen.getByRole('spinbutton', { name: 'Nombre de répétitions' })

    vi.useFakeTimers()
    try {
      fireEvent.pointerDown(weightInput, { button: 0, pointerType: 'touch' })
      act(() => vi.advanceTimersByTime(420))
      expect(screen.getByRole('status')).toHaveTextContent(
        `${formatNumberFr(currentSet.prevWeight!)} kg`,
      )
      expect(screen.getByRole('status')).toHaveTextContent('dernière fois')
      fireEvent.pointerUp(weightInput, { button: 0, pointerType: 'touch' })
      expect(screen.queryByRole('status')).not.toBeInTheDocument()

      fireEvent.pointerDown(repsInput, { button: 0, pointerType: 'touch' })
      act(() => vi.advanceTimersByTime(420))
      expect(screen.getByRole('status')).toHaveTextContent(
        `${formatNumberFr(currentSet.prevReps!)} reps`,
      )
      expect(screen.getByRole('status')).toHaveTextContent('dernière fois')
      fireEvent.pointerUp(repsInput, { button: 0, pointerType: 'touch' })

      // Un appui long ne déclenche ni sélection/copier ni le menu contextuel du téléphone.
      expect(fireEvent.contextMenu(weightInput)).toBe(false)
      expect(fireEvent.copy(weightInput)).toBe(false)
      expect(weightInput).toHaveClass('select-none')
      expect(repsInput).toHaveClass('select-none')
    } finally {
      vi.useRealTimers()
    }
  })

  it("n'écrase jamais une série déjà modifiée par l'utilisateur quand Gemini répond en arrière-plan", async () => {
    let resolveFetch!: (val: unknown) => void
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve
          }),
      ),
    )

    useWorkoutStore.getState().startWorkout()
    const legPressLog = useWorkoutStore.getState().activeDraft.logs['ex-leg-press']
    const set1Id = legPressLog.sets[0].id

    // L'utilisateur modifie manuellement le poids de la série 1 pendant que Gemini réfléchit
    useWorkoutStore.getState().updateDraftSet('ex-leg-press', set1Id, { weight: 115, reps: 9 })

    // Gemini finit de répondre avec une autre cible (ex: 105 kg x 8)
    await act(async () => {
      resolveFetch({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      summary_lines: [],
                      exercises: [
                        {
                          exercise_id: 'ex-leg-press',
                          rest_seconds: 150,
                          tip: 'Contrôle la descente.',
                          sets: [
                            { weight: 105, reps_min: 8, reps_max: 10, is_warmup: false },
                            { weight: 85, reps_min: 10, reps_max: 12, is_warmup: false },
                            { weight: 85, reps_min: 10, reps_max: 12, is_warmup: false },
                          ],
                        },
                      ],
                    }),
                  },
                ],
              },
            },
          ],
        }),
      })
    })

    const updatedLog = useWorkoutStore.getState().activeDraft.logs['ex-leg-press']
    // Série 1 modifiée par l'utilisateur reste intacte à 115 kg x 9
    expect(updatedLog.sets[0].weight).toBe(115)
    expect(updatedLog.sets[0].reps).toBe(9)
    // Série 2 non touchée reçoit bien la cible Gemini (85 kg)
    expect(updatedLog.sets[1].weight).toBe(85)
  })

  it("affiche un écran d'exercice épuré (sans Dernière, sans bouton Échauffement/+1 série, placeholder 'Commentaire') et une pause sans -15s", async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Commencer' }))

    // Écran épuré : pas de texte "Dernière :", pas de bouton Échauffement ni +1 série
    expect(screen.queryByText(/Dernière :/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Échauffement' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /\+1 série/i })).not.toBeInTheDocument()

    // Placeholder exactement "Commentaire" sans parenthèses
    const commentInput = screen.getByPlaceholderText('Commentaire') as HTMLInputElement
    expect(commentInput).toBeInTheDocument()

    // Couleur passe en bleu quand on monte les reps au-dessus de l'objectif
    await user.click(screen.getByRole('button', { name: 'Augmenter les répétitions' }))
    expect(screen.getByTestId('reps-card')).toHaveAttribute('data-perf', 'above')

    // Validation -> Pause sans bouton -15s
    await user.click(screen.getByRole('button', { name: 'Valider' }))
    expect(screen.getByText('Pause')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '-15s' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /\+\d+s/ })).toBeInTheDocument()
  })

  it('retient 100% des temps en backend : temps en exercice, temps en repos, temps total, reps, poids et commentaires', () => {
    const baseNow = 1_700_000_000_000
    let fakeNow = baseNow
    vi.spyOn(Date, 'now').mockImplementation(() => fakeNow)

    // 1. Début de séance à t = 0s
    useWorkoutStore.getState().startWorkout()

    // 2. Exécution de la série 1 pendant 42 secondes + commentaire
    const legPressEx = useWorkoutStore
      .getState()
      .exercises.find((e) => e.id === 'ex-leg-press')!
    useWorkoutStore.getState().updateDraftNote(legPressEx.id, 'Super amplitude')
    fakeNow += 42_000
    useWorkoutStore.getState().validateCurrentSet()

    // 3. Repos pendant 95 secondes puis passage à la série 2
    fakeNow += 95_000
    useWorkoutStore.getState().onRestCountdownReachedZero()

    // 4. Exécution de la série 2 pendant 38 secondes
    fakeNow += 38_000
    useWorkoutStore.getState().validateCurrentSet()

    // 5. Enregistrement de la séance à t = 200s
    fakeNow = baseNow + 200_000
    const summary = useWorkoutStore.getState().saveCompletedWorkout()

    expect(summary).not.toBeNull()
    expect(summary?.totalDurationSeconds).toBe(200)
    expect(summary?.totalWorkSeconds).toBe(42 + 38)
    expect(summary?.totalRestSeconds).toBe(95)

    const savedSession = useWorkoutStore.getState().completedSessions[0]
    expect(savedSession.totalDurationSeconds).toBe(200)
    expect(savedSession.totalWorkSeconds).toBe(80)
    expect(savedSession.totalRestSeconds).toBe(95)
    expect(savedSession.exercises[0].note).toBe('Super amplitude')
    expect(savedSession.exercises[0].sets[0].workSeconds).toBe(42)
    expect(savedSession.exercises[0].sets[1].restBeforeSeconds).toBe(95)
    expect(savedSession.exercises[0].sets[1].workSeconds).toBe(38)
  })

  it('affiche des Statistiques épurées sans % absurdes et déplie les détails au clic', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Statistiques' }))
    expect(screen.getByRole('heading', { name: 'Statistiques' })).toBeInTheDocument()

    // Aucun pourcentage absurde comme +295,8% et aucun mur d'historique affiché d'un coup
    expect(screen.queryByText(/295,8%/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Voir les \d+ séances/i)).not.toBeInTheDocument()

    // Clic sur un exercice -> déplie sa courbe et le bouton d'historique
    await user.click(screen.getByText('Développé incliné haltères'))
    const historyBtn = screen.getByRole('button', { name: /Voir les \d+ séances/i })
    expect(historyBtn).toBeInTheDocument()

    // Clic sur "Voir les X séances" -> déplie l'historique détaillé
    await user.click(historyBtn)
    expect(screen.getByText('Séance #1')).toBeInTheDocument()

    // Curl Biceps : filtre "Même machine" actif par défaut, dernière séance 22/10/2026 à 10 kg (et non bloquée sur Séance #7 à 20 kg)
    await user.click(screen.getByText('Curl Biceps Incliné aux haltères'))
    expect(screen.getByRole('button', { name: /Même machine/i })).toBeInTheDocument()
    expect(screen.getByText('22/10/2026')).toBeInTheDocument()

    const curlHistoryBtn = screen.getByRole('button', { name: /Voir les 17 séances/i })
    await user.click(curlHistoryBtn)
    expect(screen.getByText('? kg × 10, 8, 5')).toBeInTheDocument()
    expect(screen.getAllByText('Poulie basse').length).toBeGreaterThan(0)

    // Pas de jargon "1RM" : les métriques sont Poids / Total / Repos / Durée
    expect(screen.queryByRole('button', { name: '1RM' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reps' })).not.toBeInTheDocument()

    // Les temps (repos / exécution) remplacent les répétitions, avec un message clair sans données
    await user.click(screen.getByRole('button', { name: 'Repos' }))
    expect(screen.getAllByText('2,5 min').length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Durée' }))
    expect(screen.getByText(/Pas encore de temps d'exécution/i)).toBeInTheDocument()
  })

  it('copie un bilan complet des statistiques prêt à coller dans une IA', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Statistiques' }))
    const copyButton = screen.getByRole('button', { name: 'Copier les statistiques' })
    expect(copyButton).toHaveTextContent('Copier')

    await user.click(copyButton)

    const clipboardText = await navigator.clipboard.readText()
    expect(clipboardText).toContain('# Bilan musculation')
    expect(clipboardText).toContain('Volume total soulevé')
    expect(clipboardText).toContain('### Leg press')
    expect(clipboardText).toContain('Ce que j’attends de toi (coach)')
    expect(copyButton).toHaveTextContent('Copié')
  })

  it('conserve les séries validées quand on revient à l’accueil via ←, les inclut dans le .txt, et permet d’effacer un essai rapide', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Commencer' }))
    // Augmente le poids et les reps puis valide la série
    await user.click(screen.getByRole('button', { name: 'Augmenter le poids' }))
    await user.click(screen.getByRole('button', { name: 'Augmenter les répétitions' }))
    await user.click(screen.getByRole('button', { name: 'Valider' }))

    // Clique sur ← (Retour à l'accueil) : NE DOIT PAS annuler la série validée !
    await user.click(screen.getByRole('button', { name: "Retour à l'accueil" }))
    expect(screen.getByRole('button', { name: /Reprendre \(1\//i })).toBeInTheDocument()

    // Ouvre Bloc-notes : le .txt contient bien la nouvelle série validée
    await user.click(screen.getByRole('button', { name: 'Bloc-notes' }))
    expect(screen.getByText(/1 série validée en cours déjà incluse dans le \.txt/i)).toBeInTheDocument()
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(textarea.value).toContain('Leg press :\n• ')
    await user.click(screen.getByRole('button', { name: 'Retour' }))

    // L'utilisateur peut effacer son petit test en 1 clic
    await user.click(screen.getByRole('button', { name: /Effacer l'essai/i }))
    expect(screen.getByRole('button', { name: 'Commencer' })).toBeInTheDocument()
  })
})
