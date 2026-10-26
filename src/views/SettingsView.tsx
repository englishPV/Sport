import { useRef, useState } from 'react'
import { ArrowLeft, Eye, EyeOff, Loader2, Moon, Sun, Trash2, Wifi } from 'lucide-react'
import {
  GEMINI_MODEL,
  GEMINI_THINKING_LEVEL,
  detectApiProvider,
  sanitizeApiKey,
  testGeminiConnection,
} from '../core/gemini'
import { useWorkoutStore } from '../store/useWorkoutStore'

export function SettingsView({ onBack }: { onBack: () => void }) {
  const settings = useWorkoutStore((s) => s.settings)
  const activeDraft = useWorkoutStore((s) => s.activeDraft)
  const updateSettings = useWorkoutStore((s) => s.updateSettings)
  const clearApiKey = useWorkoutStore((s) => s.clearApiKey)
  const ensureSessionPlansGenerated = useWorkoutStore((s) => s.ensureSessionPlansGenerated)

  const initialKeyRef = useRef(settings.apiKey)
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)

  const cleanedKey = sanitizeApiKey(settings.apiKey)
  const detectedProvider = cleanedKey ? detectApiProvider(cleanedKey) : null

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

      <div className="animate-fade-up space-y-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between text-xs font-bold">
          <span className="text-slate-500 dark:text-slate-400">Modèle IA</span>
          <span className="rounded-lg bg-blue-50 px-2.5 py-1 font-mono text-blue-700 transition-colors duration-300 dark:bg-blue-950/60 dark:text-blue-300">
            {GEMINI_MODEL} · {GEMINI_THINKING_LEVEL}
          </span>
        </div>

        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={settings.apiKey}
            onChange={(e) => {
              updateSettings({ apiKey: sanitizeApiKey(e.target.value) })
              setStatus(null)
            }}
            placeholder="Clé API AIza… ou AQ.…"
            autoComplete="off"
            spellCheck={false}
            aria-label="Clé API Gemini"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-3.5 pr-10 font-mono text-xs text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-500/10 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-blue-400/10"
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

        {detectedProvider && (
          <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
            Canal détecté :{' '}
            <span className="font-semibold text-slate-600 dark:text-slate-300">
              {detectedProvider.label}
            </span>{' '}
            · secours multi-endpoint actif
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={!cleanedKey || testing}
            onClick={() => void handleTest()}
            className="press flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-2.5 text-xs font-bold text-white shadow-sm shadow-blue-600/20 hover:bg-blue-700 disabled:opacity-40 disabled:shadow-none"
          >
            {testing ? <Loader2 size={14} className="animate-spin" /> : <Wifi size={14} />}
            {testing ? 'Test…' : 'Tester'}
          </button>

          <button
            type="button"
            disabled={!settings.apiKey}
            onClick={() => {
              clearApiKey()
              initialKeyRef.current = ''
              setStatus(null)
            }}
            className="press flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2.5 text-xs font-bold text-slate-600 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-800 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-800"
          >
            <Trash2 size={14} />
            Retirer la clé
          </button>
        </div>

        {status ? (
          <p
            key={status.message}
            className={`animate-toast-in text-center text-xs font-semibold ${
              status.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'
            }`}
          >
            {status.message}
          </p>
        ) : null}
      </div>

      <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm font-bold text-slate-800 transition-colors duration-300 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-700">
        <span>Mode sombre</span>
        <span className="relative inline-flex shrink-0 items-center">
          <input
            type="checkbox"
            checked={settings.theme === 'dark'}
            onChange={(e) =>
              updateSettings({ theme: e.target.checked ? 'dark' : 'light' })
            }
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
