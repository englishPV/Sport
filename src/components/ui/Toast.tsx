import { useEffect } from 'react'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import type { Toast } from '../../core/types'

const ICONS = {
  info: Info,
  success: CheckCircle2,
  error: AlertTriangle,
} as const

const TONES = {
  info: 'border-accent/40 text-ink',
  success: 'border-success/40 text-ink',
  error: 'border-danger/50 text-ink',
} as const

function ToastItem({ toast }: { toast: Toast }) {
  const dismissToast = useAppStore((state) => state.dismissToast)
  const Icon = ICONS[toast.kind]

  useEffect(() => {
    const id = window.setTimeout(() => dismissToast(toast.id), 5000)
    return () => window.clearTimeout(id)
  }, [toast.id, dismissToast])

  return (
    <div
      role="status"
      className={`pointer-events-auto flex items-start gap-3 rounded-xl border bg-card p-3 shadow-lg ${TONES[toast.kind]}`}
    >
      <Icon size={18} className="mt-0.5 shrink-0" />
      <p className="flex-1 text-sm">{toast.message}</p>
      <button
        type="button"
        aria-label="Fermer le message"
        className="-mr-1 -mt-1 flex min-h-touch min-w-touch items-center justify-center text-muted"
        onClick={() => dismissToast(toast.id)}
      >
        <X size={16} />
      </button>
    </div>
  )
}

export function Toaster() {
  const toasts = useAppStore((state) => state.toasts)
  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] mx-auto flex w-full max-w-lg flex-col gap-2 p-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  )
}
