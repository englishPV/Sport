import { useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, Copy, Download, RotateCcw, Sparkles, Upload, X } from 'lucide-react'
import { copyText } from '../core/clipboard'
import { exportNotepad } from '../core/parser'
import { useWorkoutStore } from '../store/useWorkoutStore'

export function NotepadView({ onBack }: { onBack: () => void }) {
  const preamble = useWorkoutStore((s) => s.preamble)
  const exercises = useWorkoutStore((s) => s.exercises)
  const activeDraft = useWorkoutStore((s) => s.activeDraft)
  const getExercisesWithLiveProgress = useWorkoutStore((s) => s.getExercisesWithLiveProgress)
  const importNotepadSmart = useWorkoutStore((s) => s.importNotepadSmart)
  const ensureSessionPlansGenerated = useWorkoutStore((s) => s.ensureSessionPlansGenerated)
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
  const [isImporting, setIsImporting] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const displayedText = editorText ?? exportedText
  const isDirty = editorText !== null && editorText !== exportedText

  const flash = (msg: string) => {
    setErrorMsg(null)
    setFeedback(msg)
    window.setTimeout(() => setFeedback(null), 3500)
  }

  const runSmartImport = async (
    raw: string,
    opts: { preserveCustomPreamble?: boolean; silent?: boolean } = {},
  ): Promise<boolean> => {
    setErrorMsg(null)
    setIsImporting(true)
    try {
      const res = await importNotepadSmart(raw, {
        preserveCustomPreamble: opts.preserveCustomPreamble ?? true,
      })
      setEditorText(null)
      const latestSection = useWorkoutStore.getState().activeDraft.section
      void ensureSessionPlansGenerated(latestSection)
      if (!opts.silent) {
        flash(
          res.usedAi
            ? `Extrait par Gemini (${res.exercisesCount} exos)`
            : `Modifications enregistrées (${res.exercisesCount} exos)`,
        )
      }
      return true
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Erreur lors de l'import.")
      return false
    } finally {
      setIsImporting(false)
    }
  }

  const handleBack = async () => {
    if (isDirty && editorText !== null) {
      const saved = await runSmartImport(editorText, {
        preserveCustomPreamble: true,
        silent: true,
      })
      if (!saved) return
    }
    onBack()
  }

  const handleCopy = async () => {
    const textToCopy = displayedText
    if (isDirty && editorText !== null) {
      await runSmartImport(editorText, { preserveCustomPreamble: true, silent: true })
    }
    const ok = await copyText(textToCopy)
    flash(ok ? 'Copié' : 'Copie impossible sur ce navigateur')
  }

  const handleDownload = async () => {
    const textToDownload = displayedText
    if (isDirty && editorText !== null) {
      await runSmartImport(editorText, { preserveCustomPreamble: true, silent: true })
    }
    const blob = new Blob([textToDownload], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'seances-sport.txt'
    a.click()
    URL.revokeObjectURL(url)
    flash('Fichier .txt téléchargé')
  }

  const handleFileImport = async (file: File | undefined) => {
    if (!file) return
    const text = await file.text()
    setEditorText(text)
    await runSmartImport(text, { preserveCustomPreamble: true })
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 px-4 py-6">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => void handleBack()}
          disabled={isImporting}
          aria-label="Retour"
          className="tap flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-900"
        >
          <ArrowLeft size={20} />
        </button>

        <div className="flex items-center gap-2">
          <h1 className="text-base font-extrabold text-slate-900 dark:text-white">Bloc-notes</h1>
          {isDirty && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
              Non enregistré
            </span>
          )}
        </div>

        <div className="flex min-w-[2.5rem] items-center justify-end gap-1.5">
          {isDirty && (
            <>
              <button
                type="button"
                disabled={isImporting}
                onClick={() => {
                  setEditorText(null)
                  setErrorMsg(null)
                }}
                aria-label="Annuler les modifications"
                title="Annuler les modifications"
                className="tap inline-flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-900 dark:hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
              <button
                type="button"
                disabled={isImporting}
                onClick={() => editorText !== null && void runSmartImport(editorText)}
                className="press inline-flex items-center gap-1 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-60"
              >
                <Check className="h-3.5 w-3.5" />
                Enregistrer
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="press inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
          >
            <Copy className="h-3.5 w-3.5" />
            Copier
          </button>

          <button
            type="button"
            onClick={() => void handleDownload()}
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
            disabled={isImporting}
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
            setErrorMsg(null)
            flash('Réinitialisé')
          }}
          className="tap inline-flex items-center gap-1 text-xs text-slate-400 hover:text-rose-500"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Défaut
        </button>
      </div>

      {liveValidatedSetsCount > 0 && !isDirty && (
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
        onChange={(e) => {
          const val = e.target.value
          setEditorText(val === exportedText ? null : val)
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
            e.preventDefault()
            if (isDirty && editorText !== null && !isImporting) {
              void runSmartImport(editorText)
            }
          }
        }}
        rows={18}
        spellCheck={false}
        aria-label="Contenu du bloc-notes .txt"
        placeholder="Modifie librement ton .txt (séries, poids, exercices, consignes) ou colle un texte libre : Gemini 3.8 Flash High extrait automatiquement les formats non standard."
        className="w-full rounded-2xl border border-slate-200 bg-white p-4 font-mono text-xs leading-relaxed text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-indigo-400/10"
      />

      <p className="text-[11px] text-slate-400 dark:text-slate-500">
        Tu peux modifier directement tes exercices, poids, répétitions, commentaires ou règles ci-dessus (Ctrl/Cmd+S ou Retour enregistre automatiquement).
      </p>

      {isDirty && editorText !== null && (
        <button
          type="button"
          disabled={isImporting}
          onClick={() => void runSmartImport(editorText)}
          className="press inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-500 disabled:opacity-60 disabled:shadow-none"
        >
          {isImporting ? (
            <>
              <Sparkles className="h-4 w-4 animate-spin" />
              Application / extraction IA (Gemini 3.8 Flash High)…
            </>
          ) : (
            'Appliquer les modifications'
          )}
        </button>
      )}
    </div>
  )
}
