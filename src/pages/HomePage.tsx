import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowDown, ArrowUp, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react'
import { Header } from '../components/layout/Header'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { useAppStore } from '../store/useAppStore'
import { daysSince, getNextSessionTypeId, isCycleSession, sortSessionTypes, sortSessionsDesc } from '../core/cycle'

function lastSessionLabel(typeId: string, sessions: ReturnType<typeof useAppStore.getState>['sessions']): string {
  const last = sortSessionsDesc(
    sessions.filter((session) => session.sessionTypeId === typeId && isCycleSession(session)),
  )[0]
  if (!last) return 'Jamais faite'
  const days = daysSince(last.date)
  if (days === 0) return 'Aujourd’hui'
  if (days === 1) return 'Hier'
  return `Il y a ${days} jours`
}

function SessionTypeEditor({
  typeId,
  onClose,
}: {
  typeId: string
  onClose: () => void
}) {
  const sessionTypes = useAppStore((state) => state.sessionTypes)
  const exercises = useAppStore((state) => state.exercises)
  const defaultRestSeconds = useAppStore((state) => state.settings.defaultRestSeconds)
  const ensureExercise = useAppStore((state) => state.ensureExercise)
  const createSessionType = useAppStore((state) => state.createSessionType)
  const updateSessionType = useAppStore((state) => state.updateSessionType)
  const deleteSessionType = useAppStore((state) => state.deleteSessionType)
  const reorderSessionTypes = useAppStore((state) => state.reorderSessionTypes)
  const pushToast = useAppStore((state) => state.pushToast)

  const existing = sessionTypes.find((type) => type.id === typeId) ?? null
  const [name, setName] = useState(existing?.name ?? '')
  const [selected, setSelected] = useState<string[]>(existing?.exerciseIds ?? [])
  const [newExercise, setNewExercise] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const ordered = sortSessionTypes(sessionTypes)
  const position = ordered.findIndex((type) => type.id === typeId)

  const toggleExercise = (id: string) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    )
  }

  const addExercise = () => {
    const name = newExercise.trim()
    if (name === '') return
    const id = ensureExercise({ name, defaultRestSeconds })
    setSelected((current) => (current.includes(id) ? current : [...current, id]))
    setNewExercise('')
  }

  const move = (direction: -1 | 1) => {
    const target = position + direction
    if (position < 0 || target < 0 || target >= ordered.length) return
    const ids = ordered.map((type) => type.id)
    const swapped = [...ids]
    const temp = swapped[position]
    swapped[position] = swapped[target]
    swapped[target] = temp
    reorderSessionTypes(swapped)
  }

  const save = () => {
    if (name.trim() === '') {
      pushToast('Donne un nom au type de séance.', 'error')
      return
    }
    if (existing) {
      updateSessionType(existing.id, { name: name.trim(), exerciseIds: selected })
    } else {
      createSessionType(name.trim(), selected)
    }
    onClose()
  }

  return (
    <Modal
      open
      title={existing ? 'Modifier la séance' : 'Nouveau type de séance'}
      onClose={onClose}
      footer={
        <>
          <Button fullWidth size="lg" onClick={save}>
            Enregistrer
          </Button>
          {existing ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="ghost" onClick={() => move(-1)} disabled={position <= 0} className="gap-1">
                  <ArrowUp size={16} /> Monter
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => move(1)}
                  disabled={position === -1 || position >= ordered.length - 1}
                  className="gap-1"
                >
                  <ArrowDown size={16} /> Descendre
                </Button>
              </div>
              <Button
                variant="danger"
                fullWidth
                className="gap-2"
                onClick={() => {
                  if (!confirmDelete) {
                    setConfirmDelete(true)
                    return
                  }
                  deleteSessionType(existing.id)
                  onClose()
                }}
              >
                <Trash2 size={16} />
                {confirmDelete ? 'Confirmer la suppression' : 'Supprimer ce type'}
              </Button>
            </>
          ) : null}
        </>
      }
    >
      <label className="block space-y-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Nom</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="HAUT, BAS, BRAS…"
          className="min-h-touch w-full rounded-xl border border-elev bg-base px-3 text-base font-semibold text-ink focus:border-accent focus:outline-none"
        />
      </label>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
          Exercices ({selected.length})
        </p>
        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {exercises.map((exercise) => {
            const checked = selected.includes(exercise.id)
            return (
              <li key={exercise.id}>
                <button
                  type="button"
                  aria-pressed={checked}
                  onClick={() => toggleExercise(exercise.id)}
                  className={`flex min-h-touch w-full items-center justify-between rounded-lg px-3 text-left text-sm transition-colors duration-150 ${
                    checked ? 'bg-accent/15 text-accent' : 'bg-base/60 text-ink'
                  }`}
                >
                  <span>{exercise.name}</span>
                  <span>{checked ? '✓' : '+'}</span>
                </button>
              </li>
            )
          })}
          {exercises.length === 0 ? (
            <li className="text-xs text-muted">Aucun exercice encore. Ajoute-en un ci-dessous.</li>
          ) : null}
        </ul>
      </div>

      <div className="flex gap-2">
        <input
          value={newExercise}
          onChange={(event) => setNewExercise(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') addExercise()
          }}
          placeholder="Nouvel exercice…"
          aria-label="Nom du nouvel exercice"
          className="min-h-touch flex-1 rounded-xl border border-elev bg-base px-3 text-sm text-ink focus:border-accent focus:outline-none"
        />
        <Button variant="secondary" onClick={addExercise} aria-label="Ajouter l’exercice">
          <Plus size={18} />
        </Button>
      </div>
    </Modal>
  )
}

export default function HomePage() {
  const navigate = useNavigate()
  const sessionTypes = useAppStore((state) => state.sessionTypes)
  const sessions = useAppStore((state) => state.sessions)
  const activeSessionId = useAppStore((state) => state.activeSessionId)
  const createOrReuseSession = useAppStore((state) => state.createOrReuseSession)
  const abandonSession = useAppStore((state) => state.abandonSession)

  const [editor, setEditor] = useState<string | null>(null)
  const [pendingTypeId, setPendingTypeId] = useState<string | null>(null)
  const [resumeOpen, setResumeOpen] = useState(false)

  const ordered = sortSessionTypes(sessionTypes)
  const nextId = getNextSessionTypeId(sessionTypes, sessions)
  const inProgress = sessions.find((session) => session.status === 'in_progress')

  const openSession = (typeId: string) => {
    if (inProgress) {
      setPendingTypeId(typeId)
      setResumeOpen(true)
      return
    }
    const id = createOrReuseSession(typeId)
    if (id) navigate(`/session/${id}`)
  }

  const resumeCurrent = () => {
    setResumeOpen(false)
    if (inProgress) navigate(`/session/${inProgress.id}`)
  }

  const discardCurrent = () => {
    if (!inProgress) return
    abandonSession(inProgress.id)
    setResumeOpen(false)
    const typeId = pendingTypeId ?? nextId
    setPendingTypeId(null)
    if (!typeId) return
    const id = createOrReuseSession(typeId)
    if (id) navigate(`/session/${id}`)
  }

  return (
    <div className="mx-auto w-full max-w-lg pb-28">
      <Header
        title="GymLog"
        subtitle={
          nextId
            ? `Prochaine séance : ${ordered.find((type) => type.id === nextId)?.name ?? '—'}`
            : 'Ajoute un premier type de séance'
        }
        right={
          <Button
            variant="ghost"
            aria-label="Ajouter un type de séance"
            className="!min-w-[48px] !px-2"
            onClick={() => setEditor('new')}
          >
            <Plus size={20} />
          </Button>
        }
      />

      <div className="space-y-4 px-4 py-4">
        {inProgress ? (
          <button
            type="button"
            onClick={() => navigate(`/session/${inProgress.id}`)}
            className="flex min-h-[64px] w-full items-center gap-3 rounded-2xl border border-warn/50 bg-warn/10 p-4 text-left"
          >
            <span className="text-2xl">⏱</span>
            <span className="flex-1">
              <span className="block text-sm font-bold text-warn">Séance en cours</span>
              <span className="block text-xs text-muted">Appuie pour reprendre là où tu t’es arrêté.</span>
            </span>
            <ChevronRight size={18} className="text-warn" />
          </button>
        ) : null}

        {ordered.map((type) => {
          const isNext = type.id === nextId
          return (
            <div
              key={type.id}
              role="button"
              tabIndex={0}
              onClick={() => openSession(type.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  openSession(type.id)
                }
              }}
              className={`w-full cursor-pointer rounded-2xl border border-elev/50 bg-card p-4 text-left transition-transform duration-150 active:scale-[0.99] ${
                isNext ? 'ring-2 ring-accent shadow-[0_0_20px_#38bdf8]' : ''
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-xl font-black text-ink">{type.name}</h2>
                    {isNext ? <Badge tone="accent">Suivante</Badge> : null}
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {type.exerciseIds.length} exercice(s) · {lastSessionLabel(type.id, sessions)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Modifier ${type.name}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      setEditor(type.id)
                    }}
                    className="flex min-h-touch min-w-touch items-center justify-center rounded-xl text-muted transition-colors duration-150 hover:bg-elev/50 hover:text-ink"
                  >
                    <Pencil size={18} />
                  </button>
                  <ChevronRight size={20} className={isNext ? 'text-accent' : 'text-muted'} />
                </div>
              </div>
            </div>
          )
        })}

        {ordered.length === 0 ? (
          <div className="rounded-2xl border border-elev/50 bg-card p-6 text-center">
            <p className="text-sm text-muted">
              Aucun type de séance. Crée « HAUT » et « BAS » pour démarrer.
            </p>
            <Button className="mt-4 gap-2" onClick={() => setEditor('new')}>
              <Plus size={16} /> Ajouter un type de séance
            </Button>
          </div>
        ) : (
          <Button variant="ghost" fullWidth className="gap-2" onClick={() => setEditor('new')}>
            <Plus size={16} /> Ajouter un type de séance
          </Button>
        )}

        {activeSessionId ? (
          <p className="text-center text-xs text-muted">Une séance est déjà ouverte.</p>
        ) : null}
      </div>

      {editor ? (
        <SessionTypeEditor key={editor} typeId={editor} onClose={() => setEditor(null)} />
      ) : null}

      <Modal
        open={resumeOpen}
        title="Séance en cours"
        onClose={() => setResumeOpen(false)}
        footer={
          <>
            <Button fullWidth onClick={resumeCurrent}>
              Reprendre la séance en cours
            </Button>
            <Button variant="danger" fullWidth onClick={discardCurrent}>
              L’abandonner
            </Button>
          </>
        }
      >
        <p>
          Une séance est déjà en cours. Reprends-la, ou abandonne-la pour démarrer la nouvelle
          séance demandée.
        </p>
      </Modal>
    </div>
  )
}
