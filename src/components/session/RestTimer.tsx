import { useEffect, useRef } from 'react'
import { Plus, SkipForward, Timer } from 'lucide-react'
import { formatRemaining, getRemaining } from '../../core/timer'
import { useAppStore } from '../../store/useAppStore'
import { useNow } from '../../hooks/useNow'
import { useBeep } from '../../hooks/useBeep'
import { Button } from '../ui/Button'

export function RestTimer() {
  const timer = useAppStore((state) => state.restTimer)
  const extendRestTimer = useAppStore((state) => state.extendRestTimer)
  const clearRestTimer = useAppStore((state) => state.clearRestTimer)
  const soundEnabled = useAppStore((state) => state.settings.soundEnabled)
  const vibrationEnabled = useAppStore((state) => state.settings.vibrationEnabled)

  const now = useNow()
  const beep = useBeep()
  const signaledForStartedAt = useRef<number | null>(null)

  const remaining = timer === null ? null : getRemaining(timer, now)
  const expired = remaining !== null && remaining < 0

  useEffect(() => {
    if (timer === null || remaining === null) return
    if (remaining < 0 && signaledForStartedAt.current !== timer.startedAt) {
      signaledForStartedAt.current = timer.startedAt
      beep({ soundEnabled, vibrationEnabled })
    }
  }, [timer, remaining, beep, soundEnabled, vibrationEnabled])

  useEffect(() => {
    const onReturn = () => {
      const current = useAppStore.getState().restTimer
      if (current === null) return
      if (getRemaining(current, Date.now()) >= 0) return
      if (signaledForStartedAt.current === current.startedAt) return
      signaledForStartedAt.current = current.startedAt
      beep({ soundEnabled, vibrationEnabled })
    }
    document.addEventListener('visibilitychange', onReturn)
    return () => document.removeEventListener('visibilitychange', onReturn)
  }, [beep, soundEnabled, vibrationEnabled])

  if (timer === null || remaining === null) return null

  const duration = timer.durationSeconds
  const ratio = duration > 0 ? Math.min(1, Math.max(0, remaining / duration)) : 0

  return (
    <div className="w-full rounded-2xl border border-elev/60 bg-card p-3 shadow-2xl">
      <div className="flex items-center gap-3">
        <Timer size={18} className={expired ? 'text-warn' : 'text-accent'} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span
              className={`font-mono text-3xl font-bold tabular-nums ${expired ? 'text-warn' : 'text-accent'}`}
              aria-live="polite"
            >
              {formatRemaining(remaining)}
            </span>
            <span className="text-xs text-muted">
              {expired ? 'dépassement' : 'repos'}
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-elev">
            <div
              className={`h-full rounded-full ${expired ? 'bg-warn' : 'bg-accent'}`}
              style={{ width: `${ratio * 100}%` }}
            />
          </div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="secondary" aria-label="Ajouter 30 secondes" onClick={() => extendRestTimer(30)}>
          <Plus size={16} /> 30 s
        </Button>
        <Button variant="ghost" aria-label="Passer le repos" onClick={clearRestTimer}>
          <SkipForward size={16} /> Passer
        </Button>
      </div>
    </div>
  )

}
