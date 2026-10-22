import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, PointerEvent, SyntheticEvent } from 'react'
import { formatNumberFr } from '../core/types'

const LONG_PRESS_MS = 420

interface HistoryValueInputProps {
  label: string
  unit: string
  value: number
  previousValue: number | null
  step: string
  inputMode: 'decimal' | 'numeric'
  inputClassName: string
  unitClassName: string
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
}

/**
 * Valeur numérique modifiable qui révèle la performance de la série précédente
 * lorsqu'on maintient le doigt ou le bouton de la souris dessus.
 */
export function HistoryValueInput({
  label,
  unit,
  value,
  previousValue,
  step,
  inputMode,
  inputClassName,
  unitClassName,
  onChange,
}: HistoryValueInputProps) {
  const [showPrevious, setShowPrevious] = useState(false)
  const holdTimer = useRef<number | null>(null)

  const clearHoldTimer = () => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current)
      holdTimer.current = null
    }
  }

  useEffect(
    () => () => {
      if (holdTimer.current !== null) window.clearTimeout(holdTimer.current)
    },
    [],
  )

  const beginPress = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.button !== 0 && event.button !== undefined) || previousValue === null) return
    clearHoldTimer()
    setShowPrevious(false)
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null
      setShowPrevious(true)
    }, LONG_PRESS_MS)
  }

  const endPress = () => {
    clearHoldTimer()
    setShowPrevious(false)
  }

  const preventTextAction = (event: SyntheticEvent<HTMLDivElement>) => {
    event.preventDefault()
  }

  return (
    <div
      className="long-press-value relative flex items-baseline justify-center gap-1.5"
      onPointerDown={beginPress}
      onPointerUp={endPress}
      onPointerLeave={endPress}
      onPointerCancel={endPress}
      onContextMenu={preventTextAction}
      onCopy={preventTextAction}
      onSelect={preventTextAction}
    >
      <input
        type="number"
        inputMode={inputMode}
        step={step}
        aria-label={label}
        title="Maintiens appuyé pour voir la dernière séance"
        value={value}
        onChange={onChange}
        className={`${inputClassName} select-none`}
      />
      <span className={unitClassName}>{unit}</span>

      {showPrevious && previousValue !== null && (
        <span
          role="status"
          className="pointer-events-none absolute -top-5 left-1/2 z-20 inline-flex -translate-x-1/2 animate-fade-in items-center gap-1 whitespace-nowrap rounded-full border border-slate-300/30 bg-white/75 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-slate-500/80 opacity-90 shadow-sm backdrop-blur dark:border-slate-600/30 dark:bg-slate-900/75 dark:text-slate-300/80"
        >
          <span className="text-indigo-400/70" aria-hidden="true">
            ◌
          </span>
          <span>{formatNumberFr(previousValue)} {unit}</span>
          <span className="font-medium text-slate-400 dark:text-slate-500">· dernière fois</span>
        </span>
      )}
    </div>
  )
}
