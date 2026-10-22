import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import ImportReviewPage from './ImportReviewPage'
import HomePage from './HomePage'
import App from '../App'
import { RestTimer } from '../components/session/RestTimer'
import { useAppStore } from '../store/useAppStore'

const SAMPLE =
  'Extension triceps à la poulie : 24/10/2026 : 15kg x 11, 9 - 12kg x 11 (repos 1m30)'

function seedCycle(): { haut: string; bas: string } {
  const store = useAppStore.getState()
  const exerciseId = store.ensureExercise({ name: 'Développé couché' })
  const haut = store.createSessionType('HAUT', [exerciseId])
  const bas = store.createSessionType('BAS', [exerciseId])

  useAppStore.setState({
    sessions: [
      {
        id: 'last-haut',
        sessionTypeId: haut,
        date: '2026-10-20',
        startedAt: null,
        endedAt: null,
        status: 'completed',
        exercises: [],
        coachPlan: null,
        source: 'app',
      },
    ],
  })

  return { haut, bas }
}

beforeEach(() => {
  localStorage.clear()
  useAppStore.getState().resetAllData()
})

afterEach(() => {
  cleanup()
})

describe('parcours complet', () => {
  it('onboarding → analyse → import → accueil', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByText('Ton carnet de muscu')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Passer (mode sans IA)' }))

    fireEvent.change(screen.getByLabelText('Notes à importer'), { target: { value: SAMPLE } })
    await user.click(screen.getByRole('button', { name: 'Analyser' }))

    expect(await screen.findByText('Vérifier l’import')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /Valider l’import/ }))

    expect(await screen.findByRole('heading', { name: 'GymLog' })).toBeTruthy()
    expect(useAppStore.getState().onboardingDone).toBe(true)
    expect(screen.getByRole('heading', { name: 'Séance A' })).toBeTruthy()
  })
})

describe('ImportReviewPage', () => {
  it('affiche 1 exercice, 1 séance et 3 séries puis importe avec le bon repos', async () => {
    const user = userEvent.setup()
    useAppStore.getState().setPendingImportText(SAMPLE)

    render(
      <MemoryRouter
        initialEntries={['/import/review']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <ImportReviewPage />
      </MemoryRouter>,
    )

    expect(screen.getByText('Extension triceps à la poulie')).toBeTruthy()
    expect(screen.getByText('1 séance(s)')).toBeTruthy()
    expect(screen.getByText(/1 performance/)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /Valider l’import/ }))

    const state = useAppStore.getState()
    expect(state.onboardingDone).toBe(true)
    expect(state.exercises).toHaveLength(1)
    expect(state.sessions).toHaveLength(1)
    expect(state.sessions[0].status).toBe('imported')
    expect(state.sessions[0].exercises[0].sets).toHaveLength(3)
    expect(state.sessions[0].exercises[0].sets[0].restSecondsPlanned).toBe(90)
    expect(state.sessions[0].exercises[0].sets[2].weight).toBe(12)
  })

  it('liste les lignes ignorées', () => {
    useAppStore.getState().setPendingImportText('blabla sans format')
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ImportReviewPage />
      </MemoryRouter>,
    )
    expect(screen.getByText(/1 ligne\(s\) ignorée\(s\)/)).toBeTruthy()
  })
})

describe('HomePage', () => {
  it('met en avant la séance suivante du cycle', () => {
    seedCycle()
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <HomePage />
      </MemoryRouter>,
    )

    const basHeading = screen.getByRole('heading', { name: 'BAS' })
    const card = basHeading.closest('[role="button"]')
    expect(card?.className).toContain('ring-2')
    expect(screen.getByText('Suivante')).toBeTruthy()

    const hautHeading = screen.getByRole('heading', { name: 'HAUT' })
    expect(hautHeading.closest('[role="button"]')?.className).not.toContain('ring-2')
  })
})

describe('RestTimer', () => {
  it('affiche le dépassement puis repasse positif après +30 s', async () => {
    const user = userEvent.setup()
    useAppStore.getState().setRestTimer(90, Date.now() - 105_000)

    render(<RestTimer />)
    expect(screen.getByText(/^\+0:1[45]$/)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Ajouter 30 secondes' }))
    expect(screen.getByText(/^0:1[45]$/)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Passer le repos' }))
    expect(screen.queryByText(/dépassement/)).toBeNull()
  })
})
