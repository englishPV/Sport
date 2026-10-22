import { useState } from 'react'
import { ChevronDown, ChevronUp, RefreshCw, Sparkles } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import type { CoachPlan } from '../../core/types'

export interface CoachNoteProps {
  plan: CoachPlan | null
  loading: boolean
  canRegenerate: boolean
  onRegenerate: () => void
}

export function CoachNote({ plan, loading, canRegenerate, onRegenerate }: CoachNoteProps) {
  const [open, setOpen] = useState(true)

  if (loading && !plan) {
    return (
      <div className="rounded-2xl border border-elev/50 bg-card p-4" aria-busy="true">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted">
          <Sparkles size={16} className="animate-pulse text-accent" />
          Le coach prépare la séance…
        </div>
        <div className="h-16 animate-pulse rounded-lg bg-elev/50" />
      </div>
    )
  }

  if (!plan) return null

  return (
    <div className="rounded-2xl border border-elev/50 bg-card p-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex min-h-touch flex-1 items-center gap-2 text-left"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <Sparkles size={16} className="text-accent" />
          <span className="text-sm font-semibold text-ink">Note du coach</span>
          <Badge tone={plan.source === 'gemini' ? 'accent' : 'neutral'}>
            {plan.source === 'gemini' ? 'IA' : 'Règle auto'}
          </Badge>
          <span className="ml-auto text-muted">
            {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </span>
        </button>
      </div>

      {open ? (
        <div className="mt-2 space-y-3">
          <p className="text-sm leading-relaxed text-ink">{plan.globalNote}</p>
          {canRegenerate ? (
            <Button
              variant="ghost"
              size="md"
              onClick={onRegenerate}
              disabled={loading}
              className="gap-2"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : undefined} />
              {loading ? 'Calcul en cours…' : 'Regénérer'}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
