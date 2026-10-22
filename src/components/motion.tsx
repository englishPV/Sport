import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'

/** Durées partagées (ms) pour rester cohérent d'un écran à l'autre. */
export const MOTION = {
  fast: 160,
  base: 220,
  slow: 320,
} as const

/**
 * Garde un élément monté pendant sa sortie (fade + scale) avant de le retirer du DOM.
 * Évite le « pop » brutal quand un menu se ferme.
 */
export function usePresence(open: boolean, duration: number = MOTION.base) {
  const [mounted, setMounted] = useState(open)
  const [visible, setVisible] = useState(open)

  useEffect(() => {
    if (open) {
      setMounted(true)
      // Une frame plus tard : on laisse le navigateur peindre l'état fermé
      // pour que la transition d'ouverture soit bien animée.
      const frame = requestAnimationFrame(() => setVisible(true))
      return () => cancelAnimationFrame(frame)
    }

    setVisible(false)
    const timer = window.setTimeout(() => setMounted(false), duration)
    return () => window.clearTimeout(timer)
  }, [open, duration])

  return { mounted: mounted || open, visible: open && visible }
}

/**
 * Menu flottant : fondu + glissement + léger zoom, dans les deux sens.
 * `invisible` dans l'état fermé pour ne jamais piéger le focus clavier.
 */
export function Popover({
  open,
  children,
  className = '',
  duration = MOTION.base,
  origin = 'top-right',
  panelRef,
}: {
  open: boolean
  children: ReactNode
  className?: string
  duration?: number
  origin?: 'top-right' | 'top-center' | 'bottom-right'
  panelRef?: RefObject<HTMLDivElement>
}) {
  const { mounted, visible } = usePresence(open, duration)
  if (!mounted) return null

  const originClass =
    origin === 'top-center'
      ? 'origin-top'
      : origin === 'bottom-right'
        ? 'origin-bottom-right'
        : 'origin-top-right'

  return (
    <div
      ref={panelRef}
      aria-hidden={!open}
      style={{ transitionDuration: `${duration}ms` }}
      className={`${originClass} transition-all ease-smooth ${className} ${
        visible
          ? 'pointer-events-auto visible translate-y-0 scale-100 opacity-100'
          : 'pointer-events-none invisible -translate-y-1.5 scale-[0.97] opacity-0'
      }`}
    >
      {children}
    </div>
  )
}

/**
 * Panneau dépliable « en accordéon » : la hauteur s'ouvre en douceur (grid 0fr -> 1fr).
 * Le contenu n'est monté que lorsque c'est ouvert (rendu instantané à la fermeture,
 * ce qui garde le DOM léger et les tests déterministes).
 */
export function Collapse({
  open,
  children,
  className = '',
  duration = MOTION.slow,
}: {
  open: boolean
  children: ReactNode
  className?: string
  duration?: number
}) {
  if (!open) return null

  return (
    <div
      className={`grid animate-accordion-down ${className}`}
      style={{ animationDuration: `${duration}ms` }}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}

/**
 * Ferme un menu au clic extérieur ou avec Échap.
 * On ignore les éléments « ancre » (le bouton qui ouvre le menu) pour ne pas
 * fermer puis réouvrir dans le même clic.
 */
export function useDismiss(
  open: boolean,
  onDismiss: () => void,
  keepRefs: Array<RefObject<HTMLElement | null>>,
) {
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss
  const keepRefsRef = useRef(keepRefs)
  keepRefsRef.current = keepRefs

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (keepRefsRef.current.some((ref) => ref.current?.contains(target))) return
      dismissRef.current()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismissRef.current()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])
}

/**
 * Petite pastille de confirmation : apparition douce, disparition en fondu.
 * Le texte reste affiché pendant l'animation de sortie.
 */
export function Toast({
  message,
  className = '',
  duration = 260,
}: {
  message: string | null
  className?: string
  duration?: number
}) {
  const [text, setText] = useState(message)
  const { mounted, visible } = usePresence(Boolean(message), duration)

  useEffect(() => {
    if (message) setText(message)
  }, [message])

  if (!mounted || !text) return null

  return (
    <div
      aria-live="polite"
      style={{ transitionDuration: `${duration}ms` }}
      className={`transition-all ease-smooth ${
        visible ? 'translate-y-0 opacity-100' : '-translate-y-1 opacity-0'
      }`}
    >
      <div key={text} className={className}>
        {text}
      </div>
    </div>
  )
}
