import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'

export interface HeaderProps {
  title: string
  subtitle?: string
  onBack?: () => void
  right?: ReactNode
}

export function Header({ title, subtitle, onBack, right }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-elev/40 bg-base/95 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="mx-auto flex w-full max-w-lg items-center gap-3 px-4 py-3">
        {onBack ? (
          <button
            type="button"
            aria-label="Retour"
            onClick={onBack}
            className="flex min-h-touch min-w-touch items-center justify-center rounded-xl bg-elev/50 text-ink transition-colors duration-150 hover:bg-elev"
          >
            <ArrowLeft size={20} />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold text-ink">{title}</h1>
          {subtitle ? <p className="truncate text-xs text-muted">{subtitle}</p> : null}
        </div>
        {right}
      </div>
    </header>
  )
}
