/**
 * Couche de stockage : clé versionnée, reprise automatique des anciennes données,
 * et sauvegarde JSON complète (export / import validé). Tout est pur sauf l'accès
 * au `localStorage`, injecté pour rester testable.
 */
import type { StateStorage } from 'zustand/middleware'
import { settleObjectives } from './parser'
import type { Exercise } from './types'

export const STORAGE_KEY = 'sport-ddp'
/** Anciennes clés, lues une seule fois si la nouvelle est vide. Jamais supprimées. */
export const LEGACY_STORAGE_KEYS: readonly string[] = ['sport-ddp:v5']
export const SCHEMA_VERSION = 6
export const BACKUP_APP_ID = 'sport-ddp'

type Backend = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function createMigratingStorage(
  getBackend: () => Backend = () => localStorage,
): StateStorage {
  return {
    getItem: (name) => {
      try {
        const backend = getBackend()
        const current = backend.getItem(name)
        if (current !== null) return current
        for (const legacyKey of LEGACY_STORAGE_KEYS) {
          const legacy = backend.getItem(legacyKey)
          if (legacy !== null) return legacy
        }
      } catch {
        // Stockage indisponible (navigation privée, quota) : on démarre à vide.
      }
      return null
    },
    setItem: (name, value) => {
      try {
        getBackend().setItem(name, value)
      } catch (error) {
        console.warn('[sport-ddp] Sauvegarde locale impossible :', error)
      }
    },
    removeItem: (name) => {
      try {
        getBackend().removeItem(name)
      } catch {
        // Rien à supprimer si le stockage est indisponible.
      }
    },
  }
}

/**
 * Met un état persisté (toute version) au format courant.
 * Les lignes « (Objectif) » d'une date passée sont des séances réellement faites.
 */
export function migratePersistedState(
  persisted: unknown,
  todayIso: string,
): Record<string, unknown> {
  if (!isRecord(persisted)) return {}
  const next: Record<string, unknown> = { ...persisted }
  if (Array.isArray(next.exercises)) {
    next.exercises = settleObjectives(next.exercises as Exercise[], todayIso)
  }
  return next
}

export class BackupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupError'
  }
}

export interface BackupFile {
  app: typeof BACKUP_APP_ID
  schema: number
  exportedAt: string
  data: Record<string, unknown>
}

/** Sérialise tout l'état. La clé API est retirée sauf demande explicite. */
export function buildBackup(
  state: Record<string, unknown>,
  options: { includeApiKey?: boolean; now?: Date } = {},
): string {
  const data: Record<string, unknown> = { ...state }
  if (!options.includeApiKey && isRecord(data.settings)) {
    data.settings = { ...data.settings, apiKey: '' }
  }
  const file: BackupFile = {
    app: BACKUP_APP_ID,
    schema: SCHEMA_VERSION,
    exportedAt: (options.now ?? new Date()).toISOString(),
    data,
  }
  return JSON.stringify(file, null, 2)
}

function isExerciseLike(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (typeof value.id !== 'string' || typeof value.name !== 'string') return false
  if (value.section !== 'up' && value.section !== 'legs') return false
  if (!Array.isArray(value.entries)) return false
  return value.entries.every((entry) => isRecord(entry) && Array.isArray(entry.sets))
}

/** Lit et valide une sauvegarde. Lève `BackupError` (message en français) si elle est inutilisable. */
export function parseBackup(text: string, todayIso: string): Record<string, unknown> {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new BackupError('Fichier illisible : ce n’est pas du JSON valide.')
  }
  if (!isRecord(json)) throw new BackupError('Ce fichier n’est pas une sauvegarde Sport DDP.')

  // Accepte aussi le format brut du stockage navigateur : { state, version }.
  const data =
    json.app === BACKUP_APP_ID && isRecord(json.data)
      ? json.data
      : isRecord(json.state)
        ? json.state
        : null
  if (!data) throw new BackupError('Ce fichier n’est pas une sauvegarde Sport DDP.')

  const schema =
    typeof json.schema === 'number' ? json.schema : typeof json.version === 'number' ? json.version : 0
  if (schema > SCHEMA_VERSION) {
    throw new BackupError('Sauvegarde créée par une version plus récente de l’application.')
  }
  if (
    typeof data.preamble !== 'string' ||
    !Array.isArray(data.exercises) ||
    !data.exercises.every(isExerciseLike)
  ) {
    throw new BackupError('Sauvegarde incomplète ou corrompue (exercices illisibles).')
  }
  return migratePersistedState(data, todayIso)
}
