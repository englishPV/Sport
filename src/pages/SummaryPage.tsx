import { useEffect } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { Dumbbell, ListChecks, Timer, Trophy } from 'lucide-react'
import { Header } from '../components/layout/Header'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { useAppStore } from '../store/useAppStore'
import {
  formatWeight,
  getExerciseVolume,
  getRecordBreaks,
  getSessionDurationSeconds,
  getSessionSetCount,
  getSessionVolume,
} from '../core/stats'
import { formatElapsed } from '../core/timer'

export default function SummaryPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()

  const sessions = useAppStore((state) => state.sessions)
  const exercises = useAppStore((state) => state.exercises)
  const sessionTypes = useAppStore((state) => state.sessionTypes)
  const pregenerateNextPlan = useAppStore((state) => state.pregenerateNextPlan)

  const session = sessions.find((candidate) => candidate.id === sessionId)

  useEffect(() => {
    void pregenerateNextPlan().catch(() => undefined)
  }, [pregenerateNextPlan])

  if (!session) return <Navigate to="/" replace />

  const type = sessionTypes.find((candidate) => candidate.id === session.sessionTypeId)
  const volume = getSessionVolume(session)
  const setCount = getSessionSetCount(session)
  const duration = getSessionDurationSeconds(session)
  const records = getRecordBreaks(session, sessions)

  const nameOf = (exerciseId: string): string =>
    exercises.find((exercise) => exercise.id === exerciseId)?.name ?? 'Exercice'

  return (
    <div className="mx-auto w-full max-w-lg pb-28">
      <Header title="Séance terminée" subtitle={`${type?.name ?? 'Séance'} · ${session.date}`} />

      <div className="space-y-4 px-4 py-4">
        <div className="grid grid-cols-3 gap-2">
          <Card className="text-center">
            <Timer size={18} className="mx-auto text-accent" />
            <p className="mt-1 text-lg font-bold text-ink">{formatElapsed(duration * 1000)}</p>
            <p className="text-[11px] uppercase tracking-wide text-muted">Durée</p>
          </Card>
          <Card className="text-center">
            <Dumbbell size={18} className="mx-auto text-accent" />
            <p className="mt-1 text-lg font-bold text-ink">{Math.round(volume)}</p>
            <p className="text-[11px] uppercase tracking-wide text-muted">Volume kg</p>
          </Card>
          <Card className="text-center">
            <ListChecks size={18} className="mx-auto text-accent" />
            <p className="mt-1 text-lg font-bold text-ink">{setCount}</p>
            <p className="text-[11px] uppercase tracking-wide text-muted">Séries</p>
          </Card>
        </div>

        <Card className="space-y-3">
          <h2 className="text-base font-bold text-ink">Détail par exercice</h2>
          <ul className="space-y-2">
            {session.exercises.map((log) => {
              const exercise = exercises.find((candidate) => candidate.id === log.exerciseId)
              const exerciseVolume = getExerciseVolume(session, log.exerciseId)
              return (
                <li
                  key={log.exerciseId}
                  className="flex items-center justify-between gap-2 rounded-lg bg-base/50 px-3 py-2 text-sm"
                >
                  <span className="truncate text-ink">{exercise?.name ?? 'Exercice'}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {log.sets.length} série(s) · {Math.round(exerciseVolume)} kg
                  </span>
                </li>
              )
            })}
            {session.exercises.length === 0 ? (
              <li className="text-xs text-muted">Aucun exercice enregistré.</li>
            ) : null}
          </ul>
        </Card>

        <Card className="space-y-3">
          <div className="flex items-center gap-2">
            <Trophy size={18} className="text-success" />
            <h2 className="text-base font-bold text-ink">Records battus</h2>
          </div>
          {records.length === 0 ? (
            <p className="text-sm text-muted">Pas de nouveau record cette fois — la régularité paie.</p>
          ) : (
            <ul className="space-y-2">
              {records.map((record) => (
                <li
                  key={`${record.exerciseId}-${record.kind}`}
                  className="rounded-lg bg-success/10 px-3 py-2 text-sm text-ink"
                >
                  <span className="font-semibold">{nameOf(record.exerciseId)}</span> ·{' '}
                  {record.kind === 'weight'
                    ? `record de charge : ${formatWeight(record.value)}`
                    : `record de volume : ${Math.round(record.value)} kg`}
                  {record.previous !== null ? (
                    <span className="text-xs text-muted"> (avant : {Math.round(record.previous)})</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Button fullWidth size="xl" onClick={() => navigate('/', { replace: true })}>
          Retour à l’accueil
        </Button>
      </div>
    </div>
  )
}
