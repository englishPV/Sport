import { useMemo, useState } from 'react'
import { ChevronRight, Trash2 } from 'lucide-react'
import { Header } from '../components/layout/Header'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Modal } from '../components/ui/Modal'
import { SetRow } from '../components/session/SetRow'
import { useAppStore } from '../store/useAppStore'
import { sortSessionsDesc } from '../core/cycle'
import {
  getSessionDurationSeconds,
  getSessionSetCount,
  getSessionVolume,
  isHistorySession,
} from '../core/stats'
import { formatElapsed } from '../core/timer'

export default function HistoryPage() {
  const sessions = useAppStore((state) => state.sessions)
  const exercises = useAppStore((state) => state.exercises)
  const sessionTypes = useAppStore((state) => state.sessionTypes)
  const deleteSession = useAppStore((state) => state.deleteSession)

  const [typeFilter, setTypeFilter] = useState('all')
  const [exerciseFilter, setExerciseFilter] = useState('all')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const history = useMemo(
    () =>
      sortSessionsDesc(
        sessions.filter(
          (session) =>
            isHistorySession(session) &&
            (typeFilter === 'all' || session.sessionTypeId === typeFilter) &&
            (exerciseFilter === 'all' ||
              session.exercises.some((log) => log.exerciseId === exerciseFilter)),
        ),
      ),
    [sessions, typeFilter, exerciseFilter],
  )

  const detail = sessions.find((session) => session.id === detailId) ?? null

  const nameOf = (exerciseId: string): string =>
    exercises.find((exercise) => exercise.id === exerciseId)?.name ?? 'Exercice'
  const typeName = (id: string): string =>
    sessionTypes.find((type) => type.id === id)?.name ?? 'Séance'

  return (
    <div className="mx-auto w-full max-w-lg pb-28">
      <Header title="Historique" subtitle={`${history.length} séance(s)`} />

      <div className="space-y-4 px-4 py-4">
        <div className="grid grid-cols-2 gap-2">
          <select
            value={typeFilter}
            aria-label="Filtrer par type de séance"
            onChange={(event) => setTypeFilter(event.target.value)}
            className="min-h-touch rounded-xl border border-elev bg-card px-2 text-sm text-ink focus:border-accent focus:outline-none"
          >
            <option value="all">Tous les types</option>
            {sessionTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
          <select
            value={exerciseFilter}
            aria-label="Filtrer par exercice"
            onChange={(event) => setExerciseFilter(event.target.value)}
            className="min-h-touch rounded-xl border border-elev bg-card px-2 text-sm text-ink focus:border-accent focus:outline-none"
          >
            <option value="all">Tous les exercices</option>
            {exercises.map((exercise) => (
              <option key={exercise.id} value={exercise.id}>
                {exercise.name}
              </option>
            ))}
          </select>
        </div>

        {history.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">Aucune séance ne correspond aux filtres.</p>
          </Card>
        ) : (
          <ul className="space-y-2">
            {history.map((session) => (
              <li key={session.id}>
                <button
                  type="button"
                  onClick={() => {
                    setDetailId(session.id)
                    setConfirmDelete(false)
                  }}
                  className="flex min-h-touch w-full items-center gap-3 rounded-2xl border border-elev/50 bg-card p-4 text-left transition-colors duration-150 hover:bg-elev/30"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-ink">
                      {typeName(session.sessionTypeId)}
                      <span className="ml-2 text-xs font-normal text-muted">{session.date}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {session.exercises.length} exercice(s) · {getSessionSetCount(session)} série(s)
                      · {Math.round(getSessionVolume(session))} kg
                    </p>
                  </div>
                  <ChevronRight size={18} className="shrink-0 text-muted" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal
        open={detail !== null}
        title={detail ? `${typeName(detail.sessionTypeId)} · ${detail.date}` : 'Séance'}
        onClose={() => {
          setDetailId(null)
          setConfirmDelete(false)
        }}
        footer={
          detail ? (
            <>
              <Button
                variant="danger"
                fullWidth
                className="gap-2"
                onClick={() => {
                  if (!confirmDelete) {
                    setConfirmDelete(true)
                    return
                  }
                  deleteSession(detail.id)
                  setDetailId(null)
                  setConfirmDelete(false)
                }}
              >
                <Trash2 size={16} />
                {confirmDelete ? 'Confirmer la suppression' : 'Supprimer'}
              </Button>
              <Button
                variant="ghost"
                fullWidth
                onClick={() => {
                  setDetailId(null)
                  setConfirmDelete(false)
                }}
              >
                Fermer
              </Button>
            </>
          ) : null
        }
      >
        {detail ? (
          <div className="space-y-4">
            <p className="text-xs text-muted">
              Durée {formatElapsed(getSessionDurationSeconds(detail) * 1000)} · Volume{' '}
              {Math.round(getSessionVolume(detail))} kg · {getSessionSetCount(detail)} série(s)
            </p>

            {detail.exercises.map((log) => {
              const exercise = exercises.find((candidate) => candidate.id === log.exerciseId)
              return (
                <div key={log.exerciseId} className="space-y-2">
                  <p className="text-sm font-semibold text-ink">
                    {exercise?.name ?? nameOf(log.exerciseId)}
                  </p>
                  <ul className="space-y-1">
                    {log.sets.map((set) => (
                      <SetRow key={set.index} set={set} unit={exercise?.unit ?? 'kg'} />
                    ))}
                    {log.sets.length === 0 ? (
                      <li className="text-xs text-muted">Aucune série enregistrée.</li>
                    ) : null}
                  </ul>
                  {log.note ? <p className="text-xs italic text-muted">« {log.note} »</p> : null}
                </div>
              )
            })}
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
