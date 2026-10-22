import type { StateStorage } from 'zustand/middleware'
import { AppStateSchema, SCHEMA_VERSION, STORAGE_KEY, type AppState, type LoadError } from '../core/types'

export interface LoadOutcome {
  state: AppState | null
  error: LoadError | null
}

/**
 * Valide une valeur persistée. Ne modifie jamais rien : en cas de version
 * inconnue ou de données invalides, l'appelant doit proposer un export brut
 * ou une réinitialisation explicite.
 */
export function parsePersistedState(raw: string): LoadOutcome {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return { state: null, error: 'invalid_data' }
  }

  if (typeof json !== 'object' || json === null) return { state: null, error: 'invalid_data' }

  const envelope = json as { state?: unknown }
  const candidate = envelope.state ?? json
  if (typeof candidate !== 'object' || candidate === null) {
    return { state: null, error: 'invalid_data' }
  }

  const version = (candidate as { schemaVersion?: unknown }).schemaVersion
  if (version !== undefined && version !== SCHEMA_VERSION) {
    return { state: null, error: 'unknown_version' }
  }

  const parsed = AppStateSchema.safeParse(candidate)
  if (!parsed.success) return { state: null, error: 'invalid_data' }
  return { state: parsed.data, error: null }
}

/** Erreur détectée au chargement — lue par App pour afficher l'écran dédié. */
export const loadStatus: { error: LoadError | null } = { error: null }

export function getLoadError(): LoadError | null {
  return loadStatus.error
}

export function readRawPersistedValue(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function clearPersistedValue(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // stockage indisponible : rien à effacer
  }
  loadStatus.error = null
}

/** Migration explicite : seule la version 1 est supportée aujourd'hui. */
export function migratePersistedState(persisted: unknown, version: number): AppState {
  const parsed = AppStateSchema.safeParse(persisted)
  if (!parsed.success) {
    throw new Error(`Migration impossible depuis la version ${version}`)
  }
  return parsed.data
}

/**
 * Adaptateur localStorage : valide avant de laisser zustand hydrater, et
 * n'écrit plus rien tant qu'une erreur de chargement n'est pas résolue.
 */
export function createGymLogStorage(): StateStorage {
  return {
    getItem: (name) => {
      let raw: string | null = null
      try {
        raw = localStorage.getItem(name)
      } catch {
        return null
      }
      if (raw === null) return null

      const outcome = parsePersistedState(raw)
      if (outcome.error !== null) {
        loadStatus.error = outcome.error
        return null
      }
      if (outcome.state === null) return null

      return JSON.stringify({ state: outcome.state, version: SCHEMA_VERSION })
    },
    setItem: (name, value) => {
      if (loadStatus.error !== null) return
      try {
        localStorage.setItem(name, value)
      } catch {
        // quota dépassé : on ne bloque pas l'usage de l'app
      }
    },
    removeItem: (name) => {
      try {
        localStorage.removeItem(name)
      } catch {
        // stockage indisponible
      }
    },
  }
}
