import { describe, expect, it } from 'vitest'
import { parseNotepad } from './parser'
import {
  BackupError,
  buildBackup,
  createMigratingStorage,
  LEGACY_STORAGE_KEYS,
  migratePersistedState,
  parseBackup,
  SCHEMA_VERSION,
  STORAGE_KEY,
} from './storage'
import type { Exercise } from './types'

function fakeBackend(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
}

const sample = () =>
  parseNotepad(
    'Règles.\n\nUp Tirage vertical :\n• 09/11/2026 (Objectif) : 55kg x 11 | 50kg x 12, 12\n\nJambes (Legs)\n\nPresse :\n• 03/11/2026 : 100kg x 12',
  )

describe('stockage versionné', () => {
  const legacyKey = LEGACY_STORAGE_KEYS[0]

  it("reprend l'ancienne clé quand la nouvelle est vide, sans la supprimer", () => {
    const backend = fakeBackend({ [legacyKey]: '{"state":{"a":1}}' })
    const storage = createMigratingStorage(() => backend)
    expect(storage.getItem(STORAGE_KEY)).toBe('{"state":{"a":1}}')
    storage.setItem(STORAGE_KEY, '{"state":{"a":2},"version":6}')
    expect(backend.map.get(legacyKey)).toBe('{"state":{"a":1}}')
    expect(storage.getItem(STORAGE_KEY)).toBe('{"state":{"a":2},"version":6}')
  })

  it('démarre à vide sans rien, et survit à un stockage indisponible', () => {
    expect(createMigratingStorage(() => fakeBackend()).getItem(STORAGE_KEY)).toBeNull()
    const broken = createMigratingStorage(() => {
      throw new Error('SecurityError')
    })
    expect(broken.getItem(STORAGE_KEY)).toBeNull()
    expect(() => broken.setItem(STORAGE_KEY, 'x')).not.toThrow()
    expect(() => broken.removeItem(STORAGE_KEY)).not.toThrow()
  })

  it('la migration range les objectifs passés et tolère un état invalide', () => {
    const { preamble, exercises } = sample()
    const migrated = migratePersistedState({ preamble, exercises }, '2026-11-10')
    expect((migrated.exercises as Exercise[])[0].entries[0].wasObjective).toBeUndefined()
    expect(migratePersistedState(null, '2026-11-10')).toEqual({})
    expect(migratePersistedState('x', '2026-11-10')).toEqual({})
  })
})

describe('sauvegarde JSON complète', () => {
  const snapshot = {
    ...sample(),
    completedSessions: [],
    settings: { apiKey: 'AIzaSECRET', theme: 'dark' },
  }
  const state = () => snapshot

  it('exporte tout sauf la clé API, puis réimporte à l’identique', () => {
    const text = buildBackup(state(), { now: new Date('2026-11-10T08:00:00Z') })
    expect(text).not.toContain('AIzaSECRET')
    const file = JSON.parse(text)
    expect(file).toMatchObject({ app: 'sport-ddp', schema: SCHEMA_VERSION, exportedAt: '2026-11-10T08:00:00.000Z' })

    const restored = parseBackup(text, '2026-11-09')
    expect(restored.exercises).toEqual(state().exercises)
    expect(restored.preamble).toBe('Règles.')
    expect(restored.settings).toEqual({ apiKey: '', theme: 'dark' })
  })

  it('peut inclure la clé API sur demande et lit le format brut du navigateur', () => {
    expect(buildBackup(state(), { includeApiKey: true })).toContain('AIzaSECRET')
    const raw = JSON.stringify({ state: state(), version: 0 })
    expect((parseBackup(raw, '2026-11-09').exercises as Exercise[]).length).toBe(2)
  })

  it('refuse proprement un fichier inutilisable', () => {
    const bad = [
      'pas du json',
      '[]',
      '{"hello":1}',
      JSON.stringify({ app: 'sport-ddp', schema: SCHEMA_VERSION + 1, data: state() }),
      JSON.stringify({ app: 'sport-ddp', schema: 1, data: { preamble: 'x', exercises: [{ id: 'a' }] } }),
      JSON.stringify({ app: 'sport-ddp', schema: 1, data: { exercises: [] } }),
    ]
    for (const text of bad) expect(() => parseBackup(text, '2026-11-10')).toThrow(BackupError)
  })
})
