import { useCallback, useEffect, useRef } from 'react'

export interface BeepOptions {
  soundEnabled: boolean
  vibrationEnabled: boolean
}

function createContext(): AudioContext | null {
  try {
    return new AudioContext()
  } catch {
    return null
  }
}

/**
 * Bip de fin de repos (880 Hz, 3 impulsions de 150 ms) + vibration.
 * L'AudioContext est créé au premier geste utilisateur (contrainte iOS).
 */
export function useBeep(): (options: BeepOptions) => void {
  const contextRef = useRef<AudioContext | null>(null)

  useEffect(() => {
    const unlock = (): void => {
      const context = contextRef.current ?? createContext()
      contextRef.current = context
      if (context && context.state === 'suspended') void context.resume()
    }
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  return useCallback((options: BeepOptions) => {
    if (options.soundEnabled) {
      const context = contextRef.current
      if (context) {
        try {
          for (let index = 0; index < 3; index += 1) {
            const start = context.currentTime + index * 0.25
            const oscillator = context.createOscillator()
            const gain = context.createGain()
            oscillator.type = 'sine'
            oscillator.frequency.value = 880
            gain.gain.setValueAtTime(0.0001, start)
            gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02)
            gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.15)
            oscillator.connect(gain)
            gain.connect(context.destination)
            oscillator.start(start)
            oscillator.stop(start + 0.16)
          }
        } catch {
          // Audio indisponible : on n'empêche jamais la séance
        }
      }
    }

    if (options.vibrationEnabled && typeof navigator.vibrate === 'function') {
      navigator.vibrate([200, 100, 200])
    }
  }, [])
}
