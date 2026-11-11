import { afterEach, describe, expect, it } from 'vitest'
import { parseNotepad } from '../core/parser'
import { LEGACY_STORAGE_KEYS, SCHEMA_VERSION } from '../core/storage'
import { STORAGE_KEY, useWorkoutStore } from './useWorkoutStore'

const LEGACY_KEY = LEGACY_STORAGE_KEYS[0]

afterEach(() => {
  localStorage.removeItem(LEGACY_KEY)
  localStorage.removeItem(STORAGE_KEY)
  useWorkoutStore.getState().resetToDefaultNotepad()
})

describe("reprise des données de l'ancienne version", () => {
  it('charge sport-ddp:v5 au premier lancement, sans le supprimer, puis écrit la nouvelle clé', async () => {
    const { preamble, exercises } = parseNotepad(
      'Mes règles.\n\nUp Tirage vertical :\n• 01/01/2026 (Objectif) : 55kg x 11 | 50kg x 12\n\nJambes (Legs)\n\nPresse :\n• 02/01/2026 : 100kg x 12',
    )
    const legacy = JSON.stringify({
      state: { preamble, exercises, settings: { apiKey: ' "AIzaLegacyKey123" ', theme: 'dark' } },
      version: 0,
    })
    localStorage.removeItem(STORAGE_KEY)
    localStorage.setItem(LEGACY_KEY, legacy)

    await useWorkoutStore.persist.rehydrate()

    const state = useWorkoutStore.getState()
    expect(state.preamble).toBe('Mes règles.')
    expect(state.exercises.map((e) => e.name)).toEqual(['Tirage vertical', 'Presse'])
    expect(state.exercises[0].entries[0].wasObjective).toBeUndefined()
    expect(state.exercises[0].entries[0].sets).toHaveLength(2)
    expect(state.settings.theme).toBe('dark')
    expect(state.settings.apiKey).toBe('AIzaLegacyKey123')
    expect(localStorage.getItem(LEGACY_KEY)).toBe(legacy)

    useWorkoutStore.getState().updateSettings({ theme: 'light' })
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    expect(saved.version).toBe(SCHEMA_VERSION)
    expect(saved.state.exercises).toHaveLength(2)
    expect(localStorage.getItem(LEGACY_KEY)).toBe(legacy)
  })
})
