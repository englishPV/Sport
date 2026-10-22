import { useEffect, useState } from 'react'
import { BarChart3, FileText, Moon, Settings, Sun } from 'lucide-react'
import { useWorkoutStore } from './store/useWorkoutStore'
import { NotepadView } from './views/NotepadView'
import { ProgressView } from './views/ProgressView'
import { SettingsView } from './views/SettingsView'
import { WorkoutView } from './views/WorkoutView'

type Screen = 'home' | 'notepad' | 'progress' | 'settings'

export default function App() {
  const [screen, setScreen] = useState<Screen>('home')

  const theme = useWorkoutStore((s) => s.settings.theme)
  const sessionPhase = useWorkoutStore((s) => s.sessionPhase)
  const updateSettings = useWorkoutStore((s) => s.updateSettings)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  // Pendant la séance (Série 1 -> Pause -> Série 2 -> Fini) : 1 seule chose à l'écran !
  if (sessionPhase !== 'idle') {
    return (
      <main className="min-h-dvh">
        <WorkoutView />
      </main>
    )
  }

  if (screen === 'notepad') {
    return <NotepadView onBack={() => setScreen('home')} />
  }
  if (screen === 'progress') {
    return <ProgressView onBack={() => setScreen('home')} />
  }
  if (screen === 'settings') {
    return <SettingsView onBack={() => setScreen('home')} />
  }

  return (
    <div className="min-h-dvh">
      {/* Icônes discrètes en haut à droite uniquement sur l'accueil */}
      <header className="mx-auto flex max-w-md items-center justify-end gap-1.5 px-5 pt-4">
        <button
          type="button"
          aria-label="Bloc-notes"
          title="Bloc-notes"
          onClick={() => setScreen('notepad')}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-200/60 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <FileText size={18} />
        </button>

        <button
          type="button"
          aria-label="Statistiques"
          title="Statistiques"
          onClick={() => setScreen('progress')}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-200/60 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <BarChart3 size={18} />
        </button>

        <button
          type="button"
          aria-label="Réglages"
          title="Réglages"
          onClick={() => setScreen('settings')}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-200/60 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <Settings size={18} />
        </button>

        <button
          type="button"
          aria-label={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
          title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
          onClick={() => updateSettings({ theme: theme === 'dark' ? 'light' : 'dark' })}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-200/60 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </header>

      <main>
        <WorkoutView />
      </main>
    </div>
  )
}
