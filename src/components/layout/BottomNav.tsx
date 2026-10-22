import { BarChart3, History, Home, Settings } from 'lucide-react'
import { NavLink } from 'react-router-dom'

const ITEMS = [
  { to: '/', label: 'Accueil', icon: Home },
  { to: '/stats', label: 'Stats', icon: BarChart3 },
  { to: '/history', label: 'Historique', icon: History },
  { to: '/settings', label: 'Réglages', icon: Settings },
] as const

export function BottomNav() {
  return (
    <nav
      aria-label="Navigation principale"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-elev/50 bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <div className="mx-auto flex w-full max-w-lg items-stretch justify-around px-2">
        {ITEMS.map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                [
                  'flex min-h-touch min-w-touch flex-1 flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium transition-colors duration-150',
                  isActive ? 'text-accent' : 'text-muted hover:text-ink',
                ].join(' ')
              }
            >
              <Icon size={20} />
              {item.label}
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}
