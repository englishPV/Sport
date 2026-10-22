import { useState } from 'react'
import { ArrowLeft, Eye, EyeOff, Trash2, Wifi } from 'lucide-react'
import { GEMINI_MODEL, GEMINI_THINKING_LEVEL, testGeminiConnection } from '../core/gemini'
import { useWorkoutStore } from '../store/useWorkoutStore'

export function SettingsView({ onBack }: { onBack: () => void }) {
  const settings = useWorkoutStore((s) => s.settings)
  const updateSettings = useWorkoutStore((s) => s.updateSettings)
  const clearApiKey = useWorkoutStore((s) => s.clearApiKey)

  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)

  const handleTest = async () => {
    setTesting(true)
    setStatus(null)
    try {
      const res = await testGeminiConnection(settings.apiKey)
      setStatus(res)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6 px-5 py-6">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          aria-label="Retour"
          className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-900"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-base font-extrabold text-slate-900 dark:text-white">Réglages</h1>
        <div className="w-10" />
      </div>

      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between text-xs font-bold">
          <span className="text-slate-500 dark:text-slate-400">Modèle IA</span>
          <span className="rounded-lg bg-blue-50 px-2.5 py-1 font-mono text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
            {GEMINI_MODEL} · {GEMINI_THINKING_LEVEL}
          </span>
        </div>

        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={settings.apiKey}
            onChange={(e) => {
              updateSettings({ apiKey: e.target.value })
              setStatus(null)
            }}
            placeholder="Clé API…"
            autoComplete="off"
            spellCheck={false}
            aria-label="Clé API Gemini"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-3.5 pr-10 font-mono text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
          />
          <button
            type="button"
            onClick={() => setShowKey((v) => !v)}
            aria-label={showKey ? 'Masquer la clé' : 'Afficher la clé'}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-700"
          >
            {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={!settings.apiKey.trim() || testing}
            onClick={() => void handleTest()}
            className="flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-2.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-40"
          >
            <Wifi size={14} />
            {testing ? 'Test…' : 'Tester'}
          </button>

          <button
            type="button"
            disabled={!settings.apiKey}
            onClick={() => {
              clearApiKey()
              setStatus(null)
            }}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-800 dark:text-slate-300"
          >
            <Trash2 size={14} />
            Retirer la clé
          </button>
        </div>

        {status ? (
          <p
            className={`text-center text-xs font-semibold ${
              status.ok ? 'text-emerald-600' : 'text-rose-500'
            }`}
          >
            {status.message}
          </p>
        ) : null}
      </div>

      <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm font-bold text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
        <span>Mode sombre</span>
        <input
          type="checkbox"
          checked={settings.theme === 'dark'}
          onChange={(e) =>
            updateSettings({ theme: e.target.checked ? 'dark' : 'light' })
          }
          className="h-5 w-5 rounded border-slate-300 text-indigo-600"
        />
      </label>
    </div>
  )
}
