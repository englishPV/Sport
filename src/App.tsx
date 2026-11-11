import { useEffect, useState } from 'react'
import { BarChart3, FileText, FlaskConical, Moon, Settings, Sun } from 'lucide-react'
import { SimulationBanner } from './components/SimulationBanner'
import { useWorkoutStore } from './store/useWorkoutStore'
import { NotepadView } from './views/NotepadView'
import { ProgressView } from './views/ProgressView'
import { SettingsView } from './views/SettingsView'
import { WorkoutView } from './views/WorkoutView'

type Screen = 'home' | 'notepad' | 'progress' | 'settings'

const HEADER_BUTTON =
  'tap flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200'

export default function App() {
  const [screen, setScreen] = useState<Screen>('home')

  const theme = useWorkoutStore((s) => s.settings.theme)
  const sessionPhase = useWorkoutStore((s) => s.sessionPhase)
  const updateSettings = useWorkoutStore((s) => s.updateSettings)
  const simulating = useWorkoutStore((s) => s.simulation !== null)
  const startSimulation = useWorkoutStore((s) => s.startSimulation)

  useEffect(() => {
    const root = document.documentElement
    // Petite fenêtre pendant laquelle toutes les couleurs sont transitionnées :
    // le passage clair <-> sombre se fait en fondu au lieu de « flasher ».
    root.classList.add('theme-changing')
    root.classList.toggle('dark', theme === 'dark')
    const timer = window.setTimeout(() => root.classList.remove('theme-changing'), 320)
    return () => window.clearTimeout(timer)
  }, [theme])

  // Pendant la séance (Série 1 -> Pause -> Série 2 -> Fini) : 1 seule chose à l'écran !
  if (sessionPhase !== 'idle') {
    return (
      <>
        <SimulationBanner />
        <main key="session" className="min-h-dvh animate-fade-in">
          <WorkoutView />
        </main>
      </>
    )
  }

  if (screen === 'notepad') {
    return (
      <>
        <SimulationBanner />
        <div key="notepad" className="min-h-dvh animate-fade-up">
          <NotepadView onBack={() => setScreen('home')} />
        </div>
      </>
    )
  }
  if (screen === 'progress') {
    return (
      <>
        <SimulationBanner />
        <div key="progress" className="min-h-dvh animate-fade-up">
          <ProgressView onBack={() => setScreen('home')} />
        </div>
      </>
    )
  }
  if (screen === 'settings') {
    return (
      <>
        <SimulationBanner />
        <div key="settings" className="min-h-dvh animate-fade-up">
          <SettingsView onBack={() => setScreen('home')} />
        </div>
      </>
    )
  }

  return (
    <div key="home" className="min-h-dvh animate-fade-in">
      <SimulationBanner />
      {/* Icônes discrètes en haut à droite uniquement sur l'accueil */}
      <header className="mx-auto flex max-w-md animate-fade-in items-center justify-end gap-1.5 px-5 pt-4">
        {simulating ? null : (
          <button
            type="button"
            title="Rejouer une séance complète sans rien enregistrer"
            onClick={startSimulation}
            className="tap mr-auto flex h-10 items-center gap-1.5 rounded-xl px-3 text-xs font-bold text-slate-500 hover:bg-slate-200/60 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            <FlaskConical size={16} aria-hidden="true" />
            Séance test
          </button>
        )}
        <button
          type="button"
          aria-label="Bloc-notes"
          title="Bloc-notes"
          onClick={() => setScreen('notepad')}
          className={HEADER_BUTTON}
        >
          <FileText size={18} />
        </button>

        <button
          type="button"
          aria-label="Statistiques"
          title="Statistiques"
          onClick={() => setScreen('progress')}
          className={HEADER_BUTTON}
        >
          <BarChart3 size={18} />
        </button>

        <button
          type="button"
          aria-label="Réglages"
          title="Réglages"
          onClick={() => setScreen('settings')}
          className={HEADER_BUTTON}
        >
          <Settings size={18} />
        </button>

        <button
          type="button"
          aria-label={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
          title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
          onClick={() => updateSettings({ theme: theme === 'dark' ? 'light' : 'dark' })}
          className={HEADER_BUTTON}
        >
          <span key={theme} className="inline-flex animate-icon-swap">
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </span>
        </button>
      </header>

      <main className="animate-fade-in">
        <WorkoutView />
      </main>
    </div>
  )
}
