import { useEffect, useState } from 'react'
import { Minus, Plus } from 'lucide-react'

export interface NumberStepperProps {
  label: string
  value: number
  onChange: (value: number) => void
  step: number
  min?: number
  max?: number
  inputMode?: 'decimal' | 'numeric'
  suffix?: string
  ariaLabel?: string
}

function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value).replace('.', ',')
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function NumberStepper({
  label,
  value,
  onChange,
  step,
  min = 0,
  max = 9999,
  inputMode = 'decimal',
  suffix,
  ariaLabel,
}: NumberStepperProps) {
  const [draft, setDraft] = useState(() => formatValue(value))

  useEffect(() => {
    setDraft(formatValue(value))
  }, [value])

  const apply = (next: number) => {
    const rounded = Math.round(next * 100) / 100
    onChange(clamp(rounded, min, max))
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted">
        <span>{label}</span>
        {suffix ? <span>{suffix}</span> : null}
      </div>
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          aria-label={`Diminuer ${label}`}
          className="flex min-h-touch min-w-touch items-center justify-center rounded-xl bg-elev text-ink transition-colors duration-150 hover:bg-elev/80 active:scale-[0.98]"
          onClick={() => apply(value - step)}
        >
          <Minus size={20} />
        </button>
        <input
          type="number"
          inputMode={inputMode}
          aria-label={ariaLabel ?? label}
          className="min-h-touch w-full rounded-xl border border-elev bg-base px-3 text-center text-2xl font-bold text-ink focus:border-accent focus:outline-none"
          value={draft}
          onChange={(event) => {
            const raw = event.target.value
            setDraft(raw)
            const parsed = Number(raw.replace(',', '.'))
            if (raw.trim() !== '' && Number.isFinite(parsed)) apply(parsed)
          }}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={() => setDraft(formatValue(value))}
        />
        <button
          type="button"
          aria-label={`Augmenter ${label}`}
          className="flex min-h-touch min-w-touch items-center justify-center rounded-xl bg-elev text-ink transition-colors duration-150 hover:bg-elev/80 active:scale-[0.98]"
          onClick={() => apply(value + step)}
        >
          <Plus size={20} />
        </button>
      </div>
    </div>
  )
}
