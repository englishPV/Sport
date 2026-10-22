import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Eye, EyeOff, KeyRound, NotebookPen } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { useAppStore } from '../store/useAppStore'

const PLACEHOLDER = `Extension triceps à la poulie : 24/10/2026 : 15kg x 11, 9 - 12kg x 11 (repos 1m30)

Leg press :
20/10 : 120kg x 10, 10, 8
13/10 : 115kg x 10, 10, 10

Tractions : 24/10/2026 : PDC x 8, 7, 6`

export default function OnboardingPage() {
  const navigate = useNavigate()
  const settings = useAppStore((state) => state.settings)
  const onboardingDone = useAppStore((state) => state.onboardingDone)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const testApiKey = useAppStore((state) => state.testApiKey)
  const createSessionType = useAppStore((state) => state.createSessionType)
  const setOnboardingDone = useAppStore((state) => state.setOnboardingDone)
  const setPendingImportText = useAppStore((state) => state.setPendingImportText)
  const pendingImportText = useAppStore((state) => state.pendingImportText)

  const [step, setStep] = useState<1 | 2>(pendingImportText === '' ? 1 : 2)
  const [apiKey, setApiKey] = useState(settings.geminiApiKey)
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testMessage, setTestMessage] = useState<{ ok: boolean; message: string } | null>(null)
  const [notes, setNotes] = useState(pendingImportText)

  if (onboardingDone) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-xl font-bold text-ink">Configuration déjà terminée</h1>
        <Button onClick={() => navigate('/', { replace: true })}>Retour à l’accueil</Button>
      </div>
    )
  }

  const saveKey = () => {
    updateSettings({ geminiApiKey: apiKey.trim() })
  }

  const handleTest = async () => {
    setTesting(true)
    setTestMessage(null)
    try {
      const result = await testApiKey(apiKey, settings.geminiModel)
      setTestMessage(result)
    } finally {
      setTesting(false)
    }
  }

  const startEmpty = () => {
    createSessionType('HAUT', [])
    createSessionType('BAS', [])
    setOnboardingDone(true)
    navigate('/', { replace: true })
  }

  const analyze = () => {
    setPendingImportText(notes)
    navigate('/import/review')
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-6 px-5 py-8">
      <header className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-widest text-accent">GymLog</p>
        <h1 className="text-3xl font-black text-ink">Ton carnet de muscu</h1>
        <p className="text-sm text-muted">
          Importe ton bloc-notes, suis tes séances et laisse le coach proposer tes charges.
        </p>
      </header>

      <div className="flex items-center gap-2" aria-label={`Étape ${step} sur 3`}>
        {[1, 2, 3].map((value) => (
          <div
            key={value}
            className={`h-1.5 flex-1 rounded-full transition-colors duration-150 ${
              step >= value ? 'bg-accent' : 'bg-elev'
            }`}
          />
        ))}
        <span className="ml-1 text-xs font-semibold text-muted">Étape {step} / 3</span>
      </div>

      {step === 1 ? (
        <section className="space-y-5 rounded-2xl border border-elev/50 bg-card p-5">
          <div className="flex items-center gap-2 text-ink">
            <KeyRound size={18} className="text-accent" />
            <h2 className="text-lg font-bold">Clé API Gemini</h2>
          </div>

          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="AIza…"
              autoComplete="off"
              spellCheck={false}
              aria-label="Clé API Gemini"
              className="min-h-touch w-full rounded-xl border border-elev bg-base px-3 pr-14 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              aria-label={showKey ? 'Masquer la clé' : 'Afficher la clé'}
              onClick={() => setShowKey((value) => !value)}
              className="absolute right-1 top-1/2 flex min-h-touch min-w-touch -translate-y-1/2 items-center justify-center text-muted"
            >
              {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          <p className="text-xs leading-relaxed text-muted">
            La clé reste sur cet appareil (localStorage) et n’est envoyée qu’à Google. Modèle :{' '}
            <span className="font-semibold text-ink">{settings.geminiModel}</span> · raisonnement
            élevé.
          </p>

          <a
            className="inline-flex min-h-touch items-center text-sm font-semibold text-accent underline underline-offset-4"
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noreferrer"
          >
            Obtenir une clé sur Google AI Studio
          </a>

          <div className="flex flex-col gap-2">
            <Button variant="secondary" onClick={handleTest} disabled={testing || apiKey.trim() === ''}>
              {testing ? 'Test en cours…' : 'Tester la clé'}
            </Button>
            {testMessage ? (
              <p className={`text-sm ${testMessage.ok ? 'text-success' : 'text-danger'}`}>
                {testMessage.ok ? '✓ ' : '✕ '}
                {testMessage.message}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Button
              fullWidth
              size="lg"
              className="gap-2"
              onClick={() => {
                saveKey()
                setStep(2)
              }}
            >
              Suivant <ArrowRight size={18} />
            </Button>
            <Button
              variant="ghost"
              fullWidth
              onClick={() => {
                saveKey()
                setStep(2)
              }}
            >
              Passer (mode sans IA)
            </Button>
          </div>
        </section>
      ) : (
        <section className="space-y-4 rounded-2xl border border-elev/50 bg-card p-5">
          <div className="flex items-center gap-2 text-ink">
            <NotebookPen size={18} className="text-accent" />
            <h2 className="text-lg font-bold">Importe ton bloc-notes</h2>
          </div>

          <p className="text-sm text-muted">
            Une ligne par exercice, ou un en-tête d’exercice suivi de ses dates. Tout le reste est
            signalé comme erreur, jamais deviné.
          </p>

          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={12}
            placeholder={PLACEHOLDER}
            aria-label="Notes à importer"
            className="w-full rounded-xl border border-elev bg-base p-3 font-mono text-xs leading-relaxed text-ink placeholder:text-muted focus:border-accent focus:outline-none"
          />

          <Button fullWidth size="lg" onClick={analyze} disabled={notes.trim() === ''}>
            Analyser
          </Button>

          <Button variant="ghost" fullWidth onClick={startEmpty}>
            Commencer de zéro
          </Button>

          <button
            type="button"
            onClick={() => setStep(1)}
            className="min-h-touch w-full text-sm font-semibold text-muted underline underline-offset-4"
          >
            Revenir à la clé API
          </button>
        </section>
      )}
    </div>
  )
}
