import { useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, Copy, Download, RotateCcw, Sparkles, Upload } from 'lucide-react'
import { copyText } from '../core/clipboard'
import { exportNotepad } from '../core/parser'
import { useWorkoutStore } from '../store/useWorkoutStore'

export function NotepadView({ onBack }: { onBack: () => void }) {
  const preamble = useWorkoutStore((s) => s.preamble)
  const exercises = useWorkoutStore((s) => s.exercises)
  const activeDraft = useWorkoutStore((s) => s.activeDraft)
  const aiLoading = useWorkoutStore((s) => s.aiLoading)
  const getExercisesWithLiveProgress = useWorkoutStore((s) => s.getExercisesWithLiveProgress)
  const importNotepadSmart = useWorkoutStore((s) => s.importNotepadSmart)
  const resetToDefaultNotepad = useWorkoutStore((s) => s.resetToDefaultNotepad)

  const liveExercises = useMemo(
    () => getExercisesWithLiveProgress(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [exercises, activeDraft, getExercisesWithLiveProgress],
  )

  const liveValidatedSetsCount = useMemo(() => {
    return Object.values(activeDraft.logs).reduce(
      (sum, log) => sum + log.sets.filter((s) => s.completedAt !== null && s.reps > 0).length,
      0,
    )
  }, [activeDraft])

  const exportedText = useMemo(
    () => exportNotepad({ preamble, exercises: liveExercises }),
    [preamble, liveExercises],
  )

  const [editorText, setEditorText] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const displayedText = editorText ?? exportedText

  const flash = (msg: string) => {
    setErrorMsg(null)
    setFeedback(msg)
    window.setTimeout(() => setFeedback(null), 3500)
  }

  const handleCopy = async () => {
    const ok = await copyText(displayedText)
    flash(ok ? 'Copié' : 'Copie impossible sur ce navigateur')
  }

  const handleDownload = () => {
    const blob = new Blob([displayedText], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'seances-sport.txt'
    a.click()
    URL.revokeObjectURL(url)
    flash('Fichier .txt téléchargé')
  }

  const runSmartImport = async (raw: string) => {
    setErrorMsg(null)
    try {
      const res = await importNotepadSmart(raw)
      setEditorText(null)
      flash(
        res.usedAi
          ? `Extrait par Gemini (${res.exercisesCount} exos)`
          : `Importé (${res.exercisesCount} exos)`,
      )
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Erreur lors de l'import.")
    }
  }

  const handleFileImport = async (file: File | undefined) => {
    if (!file) return
    const text = await file.text()
    setEditorText(text)
    await runSmartImport(text)
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          aria-label="Retour"
          className="tap flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-900"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-base font-extrabold text-slate-900 dark:text-white">Bloc-notes</h1>
        <div className="w-10" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="press inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
          >
            <Copy className="h-3.5 w-3.5" />
            Copier
          </button>

          <button
            type="button"
            onClick={handleDownload}
            className="press inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-700 dark:hover:bg-slate-800"
          >
            <Download className="h-3.5 w-3.5" />
            .txt
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,text/plain"
            className="hidden"
            onChange={(e) => {
              void handleFileImport(e.target.files?.[0])
              e.target.value = ''
            }}
          />

          <button
            type="button"
            disabled={aiLoading}
            onClick={() => fileInputRef.current?.click()}
            className="press inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-700 dark:hover:bg-slate-800"
          >
            <Upload className="h-3.5 w-3.5" />
            Fichier
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            resetToDefaultNotepad()
            setEditorText(null)
            flash('Réinitialisé')
          }}
          className="tap inline-flex items-center gap-1 text-xs text-slate-400 hover:text-rose-500"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Défaut
        </button>
      </div>

      {liveValidatedSetsCount > 0 && editorText === null && (
        <p className="rounded-xl bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-300">
          ✓ {liveValidatedSetsCount} série{liveValidatedSetsCount > 1 ? 's' : ''} validée
          {liveValidatedSetsCount > 1 ? 's' : ''} en cours déjà incluse
          {liveValidatedSetsCount > 1 ? 's' : ''} dans le .txt (section{' '}
          {activeDraft.section === 'legs' ? 'Jambes' : 'Up'}).
        </p>
      )}

      {feedback && (
        <p
          key={feedback}
          className="inline-flex animate-toast-in items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400"
        >
          <Check className="h-3.5 w-3.5" />
          {feedback}
        </p>
      )}

      {errorMsg && (
        <p className="animate-toast-in rounded-xl bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-600 dark:text-rose-300">
          {errorMsg}
        </p>
      )}

      <textarea
        value={displayedText}
        onChange={(e) => setEditorText(e.target.value)}
        rows={18}
        spellCheck={false}
        placeholder="Colle ton bloc-notes ou même un texte libre de séance : si le format n'est pas reconnu, Gemini 3.8 Flash High extraira automatiquement tes exercices et séries."
        className="w-full rounded-2xl border border-slate-200 bg-white p-4 font-mono text-xs leading-relaxed text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-indigo-400/10"
      />

      {editorText !== null && (
        <button
          type="button"
          disabled={aiLoading}
          onClick={() => void runSmartImport(editorText)}
          className="press inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-500 disabled:opacity-60 disabled:shadow-none"
        >
          {aiLoading ? (
            <>
              <Sparkles className="h-4 w-4 animate-spin" />
              Extraction IA (Gemini 3.8 Flash High)…
            </>
          ) : (
            'Appliquer les modifications'
          )}
        </button>
      )}
    </div>
  )
}
