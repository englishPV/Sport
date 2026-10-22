import type { ReactNode } from 'react'

type Tone = 'accent' | 'success' | 'warn' | 'danger' | 'neutral'

const TONES: Record<Tone, string> = {
  accent: 'bg-accent/15 text-accent border-accent/40',
  success: 'bg-success/15 text-success border-success/40',
  warn: 'bg-warn/15 text-warn border-warn/40',
  danger: 'bg-danger/15 text-danger border-danger/40',
  neutral: 'bg-elev/60 text-muted border-elev',
}

export interface BadgeProps {
  tone?: Tone
  children: ReactNode
  className?: string
}

export function Badge({ tone = 'neutral', children, className = '' }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
        TONES[tone],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </span>
  )
}
