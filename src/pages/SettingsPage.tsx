import { useRef, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Database,
  Download,
  Eye,
  EyeOff,
  FileUp,
  KeyRound,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react'
import { Header } from '../components/layout/Header'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Modal } from '../components/ui/Modal'
import { NumberStepper } from '../components/ui/NumberStepper'
import { useAppStore } from '../store/useAppStore'
import { AppStateSchema, DEFAULT_GEMINI_MODEL, type AppState } from '../core/types'
import { todayISODate } from '../core/timer'

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="flex min-h-touch w-full items-center justify-between rounded-xl bg-base/60 px-3 text-sm text-ink"
    >
      <span>{label}</span>
      <span
        className={`relative h-7 w-12 rounded-full transition-colors duration-150 ${
          checked ? 'bg-accent' : 'bg-elev'
        }`}
      >
        <span
          className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all duration-150 ${
            checked ? 'left-6' : 'left-1'
          }`}
        />
      </span>
    </button>
  )
}

export default function SettingsPage() {
  const navigate = useNavigate()
  const settings = useAppStore((state) => state.settings)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const testApiKey = useAppStore((state) => state.testApiKey)
  const getSnapshot = useAppStore((state) => state.getSnapshot)
  const replaceAllData = useAppStore((state) => state.replaceAllData)
  const resetAllData = useAppStore((state) => state.resetAllData)
  const setPendingImportText = useAppStore((state) => state.setPendingImportText)
  const pushToast = useAppStore((state) => state.pushToast)

  const [showKey, setShowKey] = useState(false)
  const [apiKey, setApiKey] = useState(settings.geminiApiKey)
  const [model, setModel] = useState(settings.geminiModel)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  const [pendingImport, setPendingImport] = useState<AppState | null>(null)
  const [eraseOpen, setEraseOpen] = useState(false)
  const [eraseStep, setEraseStep] = useState<1 | 2>(1)
  const [reimportOpen, setReimportOpen] = useState(false)
  const [reimportText, setReimportText] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const saveKey = () => {
    updateSettings({ geminiApiKey: apiKey.trim() })
    pushToast('Clé API enregistrée sur cet appareil.', 'success')
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      setTestResult(await testApiKey(apiKey, model))
    } finally {
      setTesting(false)
    }
  }

  const exportData = () => {
    const snapshot = getSnapshot()
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `gymlog-export-${todayISODate()}.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const raw = await file.text()
      const parsed = AppStateSchema.safeParse(JSON.parse(raw))
      if (!parsed.success) {
        pushToast('Fichier invalide : rien n’a été modifié.', 'error')
        return
      }
      setPendingImport(parsed.data)
    } catch {
      pushToast('Fichier illisible : rien n’a été modifié.', 'error')
    }
  }

  const confirmImport = () => {
    if (!pendingImport) return
    replaceAllData(pendingImport)
    setPendingImport(null)
    pushToast('Données remplacées.', 'success')
  }

  const handleReimport = () => {
    if (reimportText.trim() === '') return
    setPendingImportText(reimportText)
    setReimportOpen(false)
    navigate('/import/review?mode=merge')
  }

  return (
    <div className="mx-auto w-full max-w-lg pb-28">
      <Header title="Réglages" subtitle="Tout reste sur cet appareil" />

      <div className="space-y-4 px-4 py-4">
        <Card className="space-y-3">
          <div className="flex items-center gap-2 text-ink">
            <KeyRound size={18} className="text-accent" />
            <h2 className="text-base font-bold">Coach Gemini</h2>
          </div>

          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              onBlur={saveKey}
              placeholder="AIza…"
              aria-label="Clé API Gemini"
              autoComplete="off"
              spellCheck={false}
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

          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">Modèle</span>
            <input
              type="text"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              onBlur={() => updateSettings({ geminiModel: model.trim() || DEFAULT_GEMINI_MODEL })}
              placeholder={DEFAULT_GEMINI_MODEL}
              spellCheck={false}
              className="min-h-touch w-full rounded-xl border border-elev bg-base px-3 text-sm text-ink focus:border-accent focus:outline-none"
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={handleTest} disabled={testing || apiKey.trim() === ''}>
              {testing ? 'Test…' : 'Tester la clé'}
            </Button>
            <Button variant="ghost" onClick={saveKey}>
              Enregistrer
            </Button>
          </div>
          {testResult ? (
            <p className={`text-sm ${testResult.ok ? 'text-success' : 'text-danger'}`}>
              {testResult.ok ? '✓ ' : '✕ '}
              {testResult.message}
            </p>
          ) : null}
          <p className="text-xs text-muted">
            Requêtes envoyées uniquement à Google. L’app utilise le niveau de raisonnement « high ».
          </p>
        </Card>

        <Card className="space-y-3">
          <h2 className="text-base font-bold text-ink">Séance</h2>
          <NumberStepper
            label="Repos par défaut"
            suffix="secondes"
            value={settings.defaultRestSeconds}
            onChange={(value) => updateSettings({ defaultRestSeconds: Math.round(value) })}
            step={15}
            min={0}
            max={600}
            inputMode="numeric"
          />
          <NumberStepper
            label="Pas de poids"
            suffix="kg"
            value={settings.weightStep}
            onChange={(value) => updateSettings({ weightStep: value > 0 ? value : 2.5 })}
            step={0.5}
            min={0.5}
            max={20}
            inputMode="decimal"
          />
          <Toggle
            label="Son de fin de repos"
            checked={settings.soundEnabled}
            onChange={(value) => updateSettings({ soundEnabled: value })}
          />
          <Toggle
            label="Vibration"
            checked={settings.vibrationEnabled}
            onChange={(value) => updateSettings({ vibrationEnabled: value })}
          />
        </Card>

        <Card className="space-y-3">
          <div className="flex items-center gap-2 text-ink">
            <Database size={18} className="text-accent" />
            <h2 className="text-base font-bold">Données</h2>
          </div>
          <Button variant="secondary" fullWidth className="gap-2" onClick={exportData}>
            <Download size={16} /> Exporter en JSON
          </Button>
          <Button
            variant="secondary"
            fullWidth
            className="gap-2"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={16} /> Importer un JSON
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleFile}
          />
          <Button
            variant="secondary"
            fullWidth
            className="gap-2"
            onClick={() => setReimportOpen(true)}
          >
            <FileUp size={16} /> Ré-importer un bloc-notes
          </Button>
          <Button variant="danger" fullWidth className="gap-2" onClick={() => setEraseOpen(true)}>
            <Trash2 size={16} /> Tout effacer
          </Button>
        </Card>
      </div>

      <Modal
        open={pendingImport !== null}
        title="Remplacer toutes les données ?"
        onClose={() => setPendingImport(null)}
        footer={
          <>
            <Button variant="danger" fullWidth onClick={confirmImport}>
              Oui, remplacer
            </Button>
            <Button variant="ghost" fullWidth onClick={() => setPendingImport(null)}>
              Annuler
            </Button>
          </>
        }
      >
        <p>
          Le fichier contient {pendingImport?.exercises.length ?? 0} exercice(s),{' '}
          {pendingImport?.sessionTypes.length ?? 0} type(s) de séance et{' '}
          {pendingImport?.sessions.length ?? 0} séance(s). Ces données remplaceront tout le contenu
          actuel.
        </p>
      </Modal>

      <Modal
        open={eraseOpen}
        title={eraseStep === 1 ? 'Tout effacer ?' : 'Confirmer la suppression'}
        onClose={() => {
          setEraseOpen(false)
          setEraseStep(1)
        }}
        footer={
          <>
            <Button
              variant="danger"
              fullWidth
              onClick={() => {
                if (eraseStep === 1) {
                  setEraseStep(2)
                  return
                }
                resetAllData({ keepOnboarding: true })
                setEraseOpen(false)
                setEraseStep(1)
                pushToast('Toutes les données ont été effacées.', 'success')
                navigate('/', { replace: true })
              }}
            >
              {eraseStep === 1 ? 'Continuer' : 'Effacer définitivement'}
            </Button>
            <Button
              variant="ghost"
              fullWidth
              onClick={() => {
                setEraseOpen(false)
                setEraseStep(1)
              }}
            >
              Annuler
            </Button>
          </>
        }
      >
        <p>
          {eraseStep === 1
            ? 'Cette action supprime séances, exercices, types de séance et réglages enregistrés sur cet appareil.'
            : 'Dernière chance : cette suppression est définitive. Pense à exporter avant.'}
        </p>
      </Modal>

      <Modal
        open={reimportOpen}
        title="Ré-importer un bloc-notes"
        onClose={() => setReimportOpen(false)}
        footer={
          <>
            <Button fullWidth onClick={handleReimport} disabled={reimportText.trim() === ''}>
              Analyser
            </Button>
            <Button variant="ghost" fullWidth onClick={() => setReimportOpen(false)}>
              Annuler
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          Les données existantes sont conservées : les exercices sont dédupliqués et les séries déjà
          présentes pour une même date ne sont pas ajoutées deux fois.
        </p>
        <textarea
          value={reimportText}
          onChange={(event) => setReimportText(event.target.value)}
          rows={8}
          aria-label="Bloc-notes à ré-importer"
          className="w-full rounded-xl border border-elev bg-base p-3 font-mono text-xs text-ink focus:border-accent focus:outline-none"
          placeholder={'Squat : 24/10/2026 : 100kg x 5, 5, 5 (repos 2min)'}
        />
      </Modal>

      <div className="px-4 pb-4 text-center text-xs text-muted">
        <RefreshCw size={12} className="mr-1 inline" />
        GymLog · schéma v1 · hors ligne après la première visite
      </div>
    </div>
  )
}
