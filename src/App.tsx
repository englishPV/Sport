import { useState, type ReactNode } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AlertTriangle, Download, RotateCcw } from 'lucide-react'
import { BottomNav } from './components/layout/BottomNav'
import { Toaster } from './components/ui/Toast'
import { Button } from './components/ui/Button'
import OnboardingPage from './pages/OnboardingPage'
import ImportReviewPage from './pages/ImportReviewPage'
import HomePage from './pages/HomePage'
import SessionPage from './pages/SessionPage'
import SummaryPage from './pages/SummaryPage'
import StatsPage from './pages/StatsPage'
import HistoryPage from './pages/HistoryPage'
import SettingsPage from './pages/SettingsPage'
import { useAppStore } from './store/useAppStore'
import { clearPersistedValue, getLoadError, readRawPersistedValue } from './store/migrations'
import { todayISODate } from './core/timer'
import type { LoadError } from './core/types'

function RequireOnboarding({ children }: { children: ReactNode }) {
  const onboardingDone = useAppStore((state) => state.onboardingDone)
  if (!onboardingDone) return <Navigate to="/onboarding" replace />
  return <>{children}</>
}

function DataErrorScreen({ error }: { error: LoadError }) {
  const [raw] = useState<string | null>(() => readRawPersistedValue())

  const downloadRaw = () => {
    if (raw === null) return
    const blob = new Blob([raw], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `gymlog-raw-backup-${todayISODate()}.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  const reset = () => {
    clearPersistedValue()
    window.location.reload()
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-4 p-6">
      <div className="flex items-center gap-2 text-danger">
        <AlertTriangle size={22} />
        <h1 className="text-xl font-bold">Données illisibles</h1>
      </div>
      <p className="text-sm text-muted">
        {error === 'unknown_version'
          ? 'Ces données ont été écrites par une version plus récente de GymLog. Rien n’a été modifié.'
          : 'Le stockage local ne correspond pas au format attendu. Rien n’a été modifié.'}
      </p>
      <p className="rounded-xl bg-card p-3 text-xs text-muted">
        Exporte d’abord une sauvegarde brute si ces données comptent pour toi, puis réinitialise
        l’application.
      </p>
      <Button variant="secondary" fullWidth className="gap-2" onClick={downloadRaw} disabled={raw === null}>
        <Download size={16} /> Exporter les données brutes
      </Button>
      <Button variant="danger" fullWidth className="gap-2" onClick={reset}>
        <RotateCcw size={16} /> Réinitialiser l’application
      </Button>
    </div>
  )
}

function Shell() {
  const location = useLocation()
  const hideNav =
    location.pathname.startsWith('/session/') ||
    location.pathname.startsWith('/import/') ||
    location.pathname.startsWith('/onboarding')

  return (
    <div className="min-h-dvh">
      <Routes>
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/import/review" element={<ImportReviewPage />} />
        <Route
          path="/"
          element={
            <RequireOnboarding>
              <HomePage />
            </RequireOnboarding>
          }
        />
        <Route
          path="/session/:sessionId"
          element={
            <RequireOnboarding>
              <SessionPage />
            </RequireOnboarding>
          }
        />
        <Route
          path="/summary/:sessionId"
          element={
            <RequireOnboarding>
              <SummaryPage />
            </RequireOnboarding>
          }
        />
        <Route
          path="/stats"
          element={
            <RequireOnboarding>
              <StatsPage />
            </RequireOnboarding>
          }
        />
        <Route
          path="/history"
          element={
            <RequireOnboarding>
              <HistoryPage />
            </RequireOnboarding>
          }
        />
        <Route
          path="/settings"
          element={
            <RequireOnboarding>
              <SettingsPage />
            </RequireOnboarding>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {hideNav ? null : <BottomNav />}
    </div>
  )
}

export default function App() {
  const loadError = getLoadError()

  if (loadError !== null) return <DataErrorScreen error={loadError} />

  return (
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Toaster />
      <Shell />
    </HashRouter>
  )
}
