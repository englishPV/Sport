import { useRef, useState } from 'react'
import { ArrowLeft, Eye, EyeOff, FlaskConical, Loader2, Moon, Sun, Trash2, Wifi } from 'lucide-react'
import {
  DEFAULT_GEMINI_MODEL,
  SUGGESTED_GEMINI_MODELS,
  detectApiProvider,
  sanitizeApiKey,
  testGeminiConnection,
  type ConnectionTestResult,
  type GeminiChannel,
} from '../core/gemini'
import { useWorkoutStore } from '../store/useWorkoutStore'

const CARD =
  'animate-fade-up space-y-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900'
const FIELD =
  'w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-500/10 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-blue-400/10'
const LABEL = 'mb-1.5 block text-xs font-bold text-slate-600 dark:text-slate-300'
const SECONDARY_BUTTON =
  'press flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2.5 text-xs font-bold text-slate-600 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-800 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-800'

const CHANNEL_OPTIONS: { value: GeminiChannel; label: string }[] = [
  { value: 'auto', label: 'Automatique (recommandé)' },
  { value: 'ai_studio', label: 'Google AI Studio' },
  { value: 'vertex', label: 'Vertex AI Express' },
]

export function SettingsView({ onBack }: { onBack: () => void }) {
  const settings = useWorkoutStore((s) => s.settings)
  const activeDraft = useWorkoutStore((s) => s.activeDraft)
  const simulating = useWorkoutStore((s) => s.simulation !== null)
  const updateSettings = useWorkoutStore((s) => s.updateSettings)
  const clearApiKey = useWorkoutStore((s) => s.clearApiKey)
  const ensureSessionPlansGenerated = useWorkoutStore((s) => s.ensureSessionPlansGenerated)
  const startSimulation = useWorkoutStore((s) => s.startSimulation)

  const initialKeyRef = useRef(settings.apiKey)
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [status, setStatus] = useState<ConnectionTestResult | null>(null)
  const [availableModels, setAvailableModels] = useState<string[]>([])

  const cleanedKey = sanitizeApiKey(settings.apiKey)
  const detectedProvider = cleanedKey ? detectApiProvider(cleanedKey) : null
  const currentModel = settings.geminiModel || DEFAULT_GEMINI_MODEL
  const modelOptions = Array.from(
    new Set([currentModel, ...(availableModels.length > 0 ? availableModels : SUGGESTED_GEMINI_MODELS)]),
  )

  const handleTest = async () => {
    const keyToTest = sanitizeApiKey(settings.apiKey)
    if (keyToTest !== settings.apiKey) {
      updateSettings({ apiKey: keyToTest })
    }
    setTesting(true)
    setStatus(null)
    try {
      const res = await testGeminiConnection(keyToTest)
      setStatus(res)
      if (res.models && res.models.length > 0) setAvailableModels(res.models)
      if (res.ok) {
        initialKeyRef.current = keyToTest
        void ensureSessionPlansGenerated(activeDraft.section)
      }
    } finally {
      setTesting(false)
    }
  }

  const handleBack = () => {
    const clean = sanitizeApiKey(settings.apiKey)
    if (clean !== settings.apiKey) {
      updateSettings({ apiKey: clean })
    }
    if (clean && clean !== initialKeyRef.current) {
      void ensureSessionPlansGenerated(activeDraft.section)
    }
    onBack()
  }

  return (
    <div className="mx-auto max-w-md space-y-6 px-5 py-6">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={handleBack}
          aria-label="Retour"
          className="tap flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-900"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-base font-extrabold text-slate-900 dark:text-white">Réglages</h1>
        <div className="w-10" />
      </div>

      <section className={CARD} aria-labelledby="settings-coach">
        <h2 id="settings-coach" className="text-sm font-extrabold text-slate-900 dark:text-white">
          Coach IA (Gemini)
        </h2>

        <div>
          <label htmlFor="settings-api-key" className={LABEL}>
            Clé API
          </label>
          <div className="relative">
            <input
              id="settings-api-key"
              type={showKey ? 'text' : 'password'}
              value={settings.apiKey}
              onChange={(e) => {
                updateSettings({ apiKey: sanitizeApiKey(e.target.value) })
                setStatus(null)
              }}
              placeholder="AIza… ou AQ.…"
              autoComplete="off"
              spellCheck={false}
              className={`${FIELD} pr-10 font-mono text-xs`}
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              aria-label={showKey ? 'Masquer la clé' : 'Afficher la clé'}
              className="tap absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <span key={showKey ? 'off' : 'on'} className="inline-flex animate-icon-swap">
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </span>
            </button>
          </div>
          <p className="mt-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
            {detectedProvider
              ? `${detectedProvider.label}. Elle reste sur cet appareil.`
              : 'Gratuite sur aistudio.google.com/apikey. Sans clé, la progression est calculée sur l’appareil.'}
          </p>
        </div>

        <div>
          <label htmlFor="settings-model" className={LABEL}>
            Modèle
          </label>
          <select
            id="settings-model"
            value={currentModel}
            onChange={(e) => {
              updateSettings({ geminiModel: e.target.value })
              setStatus(null)
            }}
            className={FIELD}
          >
            {modelOptions.map((model) => (
              <option key={model} value={model}>
                {model === DEFAULT_GEMINI_MODEL ? `${model} (rapide, recommandé)` : model}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
            {availableModels.length > 0
              ? 'Liste des modèles ouverts à votre clé.'
              : 'Testez la clé pour voir tous les modèles ouverts à votre clé.'}
          </p>
        </div>

        <details className="rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs dark:border-slate-800">
          <summary className="cursor-pointer font-bold text-slate-600 dark:text-slate-300">
            Options avancées
          </summary>
          <div className="mt-3 space-y-3">
            <div>
              <label htmlFor="settings-channel" className={LABEL}>
                Service Google
              </label>
              <select
                id="settings-channel"
                value={settings.geminiChannel ?? 'auto'}
                onChange={(e) => {
                  updateSettings({ geminiChannel: e.target.value as GeminiChannel })
                  setStatus(null)
                }}
                className={FIELD}
              >
                {CHANNEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="settings-base-url" className={LABEL}>
                Adresse de remplacement (proxy)
              </label>
              <input
                id="settings-base-url"
                type="url"
                inputMode="url"
                value={settings.geminiBaseUrl ?? ''}
                onChange={(e) => {
                  updateSettings({ geminiBaseUrl: e.target.value })
                  setStatus(null)
                }}
                placeholder="Laisser vide pour les serveurs Google"
                autoComplete="off"
                spellCheck={false}
                className={`${FIELD} font-mono text-xs`}
              />
            </div>
          </div>
        </details>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={!cleanedKey || testing}
            onClick={() => void handleTest()}
            className="press flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-2.5 text-xs font-bold text-white shadow-sm shadow-blue-600/20 hover:bg-blue-700 disabled:opacity-40 disabled:shadow-none"
          >
            {testing ? <Loader2 size={14} className="animate-spin" /> : <Wifi size={14} />}
            {testing ? 'Test en cours…' : 'Tester la clé'}
          </button>

          <button
            type="button"
            disabled={!settings.apiKey}
            onClick={() => {
              clearApiKey()
              initialKeyRef.current = ''
              setStatus(null)
              setAvailableModels([])
            }}
            className={SECONDARY_BUTTON}
          >
            <Trash2 size={14} />
            Retirer la clé
          </button>
        </div>

        {status ? (
          <div key={status.message} role="status" className="animate-toast-in space-y-2 text-center">
            <p
              className={`text-xs font-semibold ${
                status.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {status.message}
            </p>
            {status.suggestedModel ? (
              <button
                type="button"
                onClick={() => {
                  updateSettings({ geminiModel: status.suggestedModel })
                  setStatus(null)
                }}
                className={`${SECONDARY_BUTTON} w-full`}
              >
                Utiliser {status.suggestedModel}
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className={CARD} aria-labelledby="settings-test">
        <h2 id="settings-test" className="text-sm font-extrabold text-slate-900 dark:text-white">
          Séance test
        </h2>
        <p className="text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-400">
          Rejoue une séance complète à partir de vos données actuelles, avec de vraies demandes à
          l’IA. Rien n’est enregistré : tout revient en l’état quand vous quittez le test.
        </p>
        <button
          type="button"
          disabled={simulating}
          onClick={() => {
            startSimulation()
            onBack()
          }}
          className={`${SECONDARY_BUTTON} w-full`}
        >
          <FlaskConical size={14} />
          {simulating ? 'Test en cours' : 'Lancer une séance test'}
        </button>
      </section>

      <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm font-bold text-slate-800 transition-colors duration-300 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-700">
        <span>Mode sombre</span>
        <span className="relative inline-flex shrink-0 items-center">
          <input
            type="checkbox"
            checked={settings.theme === 'dark'}
            onChange={(e) => updateSettings({ theme: e.target.checked ? 'dark' : 'light' })}
            className="peer sr-only"
          />
          <span
            aria-hidden="true"
            className="h-6 w-11 rounded-full bg-slate-200 transition-colors duration-300 ease-smooth peer-checked:bg-indigo-600 peer-focus-visible:ring-4 peer-focus-visible:ring-indigo-500/20 dark:bg-slate-700"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-0.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow transition-transform duration-300 ease-smooth peer-checked:translate-x-5"
          >
            <span key={settings.theme} className="inline-flex animate-icon-swap">
              {settings.theme === 'dark' ? (
                <Moon className="h-3 w-3 text-indigo-600" />
              ) : (
                <Sun className="h-3 w-3 text-amber-500" />
              )}
            </span>
          </span>
        </span>
      </label>
    </div>
  )
}
