import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { CheckCircle2, Flag, Play, Power } from 'lucide-react'
import { Header } from '../components/layout/Header'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { CoachNote } from '../components/session/CoachNote'
import { ExerciseCard } from '../components/session/ExerciseCard'
import { RestTimer } from '../components/session/RestTimer'
import { useAppStore } from '../store/useAppStore'
import { useNow } from '../hooks/useNow'
import { useWakeLock } from '../hooks/useWakeLock'
import { formatElapsed } from '../core/timer'
import { getGhostSet } from '../core/stats'
import type { Session } from '../core/types'

function getInitialPosition(session: Session | undefined): { exerciseIndex: number; setIndex: number } {
  if (!session) return { exerciseIndex: 0, setIndex: 0 }
  for (const [exerciseIndex, log] of session.exercises.entries()) {
    const setIndex = log.sets.findIndex((set) => set.completedAt === null)
    if (setIndex >= 0) return { exerciseIndex, setIndex }
  }
  return {
    exerciseIndex: 0,
    setIndex: 0,
  }
}

export default function SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()

  const sessions = useAppStore((state) => state.sessions)
  const exercises = useAppStore((state) => state.exercises)
  const sessionTypes = useAppStore((state) => state.sessionTypes)
  const weightStep = useAppStore((state) => state.settings.weightStep)
  const coachLoadingMap = useAppStore((state) => state.coachLoading)
  const restTimer = useAppStore((state) => state.restTimer)

  const launchSession = useAppStore((state) => state.launchSession)
  const finishSession = useAppStore((state) => state.finishSession)
  const validateSet = useAppStore((state) => state.validateSet)
  const addSet = useAppStore((state) => state.addSet)
  const ensureCoachPlan = useAppStore((state) => state.ensureCoachPlan)
  const regenerateCoachPlan = useAppStore((state) => state.regenerateCoachPlan)

  const session = sessions.find((candidate) => candidate.id === sessionId)
  const sessionType = sessionTypes.find((type) => type.id === session?.sessionTypeId)

  const [position, setPosition] = useState(() => getInitialPosition(session))
  const [allDone, setAllDone] = useState(() => {
    if (!session || session.exercises.length === 0) return false
    return session.exercises.every((entry) => entry.sets.every((set) => set.completedAt !== null))
  })
  const [confirmFinishOpen, setConfirmFinishOpen] = useState(false)
  const requestedPlanFor = useRef<string | null>(null)

  const now = useNow()
  const coachLoading = sessionId ? coachLoadingMap[sessionId] === true : false
  useWakeLock(session?.status === 'in_progress')

  useEffect(() => {
    if (!session) return
    if (session.status !== 'in_progress') return
    if (session.coachPlan !== null || coachLoading) return
    if (requestedPlanFor.current === session.id) return
    requestedPlanFor.current = session.id
    void ensureCoachPlan(session.id)
  }, [session, coachLoading, ensureCoachPlan])

  if (!session) return <Navigate to="/" replace />
  if (session.status === 'completed') return <Navigate to={`/summary/${session.id}`} replace />

  const log = session.exercises[position.exerciseIndex]
  const exercise = log ? exercises.find((candidate) => candidate.id === log.exerciseId) : undefined
  const target =
    session.coachPlan?.targets.find((candidate) => candidate.exerciseId === log?.exerciseId) ?? null
  const ghost = log
    ? getGhostSet(session.sessionTypeId, log.exerciseId, position.setIndex, sessions, session.id)
    : null

  const hasPrev = position.exerciseIndex > 0
  const hasNext = position.exerciseIndex < session.exercises.length - 1
  const pendingSets = session.exercises.reduce(
    (total, entry) => total + entry.sets.filter((set) => set.completedAt === null).length,
    0,
  )
  const chrono = formatElapsed(session.startedAt === null ? 0 : now - session.startedAt)
  const canRegenerate =
    session.status === 'in_progress' &&
    !session.exercises.some((entry) => entry.sets.some((set) => set.completedAt !== null))

  const doFinish = () => {
    setConfirmFinishOpen(false)
    finishSession(session.id)
    navigate(`/summary/${session.id}`, { replace: true })
  }

  const requestFinish = () => {
    if (pendingSets > 0) {
      setConfirmFinishOpen(true)
      return
    }
    doFinish()
  }

  const goTo = (exerciseIndex: number) => {
    setAllDone(false)
    setPosition({ exerciseIndex, setIndex: 0 })
  }

  const handleValidate = (values: {
    weight: number
    reps: number
    rpe: number | null
    note: string
  }) => {
    if (!log) return
    validateSet({
      sessionId: session.id,
      exerciseId: log.exerciseId,
      setIndex: position.setIndex,
      weight: values.weight,
      reps: values.reps,
      rpe: values.rpe,
      note: values.note,
    })

    const isLastSet = position.setIndex >= log.sets.length - 1
    if (!isLastSet) {
      setPosition((current) => ({ ...current, setIndex: current.setIndex + 1 }))
      return
    }
    if (position.exerciseIndex < session.exercises.length - 1) {
      setPosition({ exerciseIndex: position.exerciseIndex + 1, setIndex: 0 })
      return
    }
    setAllDone(true)
  }

  return (
    <div className={`mx-auto w-full max-w-lg ${restTimer ? 'pb-48' : 'pb-28'}`}>
      <Header
        title={sessionType?.name ?? 'Séance'}
        subtitle={`${chrono} · Exercice ${position.exerciseIndex + 1} / ${session.exercises.length}`}
        onBack={() => navigate('/')}
        right={
          session.status === 'in_progress' ? (
            <Button variant="danger" onClick={requestFinish} className="gap-1">
              <Flag size={16} /> Terminer
            </Button>
          ) : null
        }
      />

      <div className="space-y-4 px-4 py-4">
        {session.status === 'planned' ? (
          <section className="space-y-4 rounded-2xl border border-elev/50 bg-card p-5 text-center">
            <h2 className="text-xl font-bold text-ink">Prêt pour {sessionType?.name ?? 'la séance'} ?</h2>
            <p className="text-sm text-muted">
              {session.exercises.length} exercice(s) au programme. Le chrono démarre au lancement.
            </p>
            <Button
              size="xl"
              fullWidth
              className="gap-2"
              onClick={() => launchSession(session.id)}
            >
              <Play size={20} /> Lancer la séance
            </Button>
          </section>
        ) : null}

        {session.status === 'in_progress' ? (
          <>
            <CoachNote
              plan={session.coachPlan}
              loading={coachLoading}
              canRegenerate={canRegenerate}
              onRegenerate={() => void regenerateCoachPlan(session.id)}
            />

            {allDone ? (
              <section className="space-y-4 rounded-2xl border border-success/40 bg-success/10 p-5 text-center">
                <CheckCircle2 size={32} className="mx-auto text-success" />
                <h2 className="text-xl font-bold text-ink">Toutes les séries sont validées</h2>
                <p className="text-sm text-muted">
                  Vérifie que rien ne manque, puis termine la séance pour voir ton résumé.
                </p>
                <Button size="xl" fullWidth className="gap-2" onClick={requestFinish}>
                  <Flag size={20} /> Terminer la séance
                </Button>
                <Button
                  variant="ghost"
                  fullWidth
                  onClick={() => setAllDone(false)}
                  className="gap-2"
                >
                  <Power size={16} /> Revenir aux séries
                </Button>
              </section>
            ) : log && exercise ? (
              <>
                <ExerciseCard
                  key={`${log.exerciseId}-${position.setIndex}`}
                  exercise={exercise}
                  log={log}
                  setIndex={position.setIndex}
                  target={target}
                  ghost={ghost}
                  weightStep={weightStep}
                  unit={exercise.unit}
                  hasPrev={hasPrev}
                  hasNext={hasNext}
                  onValidate={handleValidate}
                  onAddSet={() => {
                    addSet(session.id, log.exerciseId)
                    setPosition((current) => ({ ...current, setIndex: log.sets.length }))
                  }}
                  onPrev={() => goTo(position.exerciseIndex - 1)}
                  onNext={() => goTo(position.exerciseIndex + 1)}
                  onSkip={() => goTo(position.exerciseIndex + 1)}
                />
                {pendingSets > 0 ? (
                  <p className="text-center text-xs text-muted">
                    {pendingSets} série(s) encore non validée(s) seront ignorées à la fin de la séance.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-center text-sm text-muted">Cette séance ne contient aucun exercice.</p>
            )}
          </>
        ) : null}
      </div>

      {restTimer ? (
        <div className="fixed inset-x-0 bottom-0 z-30 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <div className="mx-auto w-full max-w-lg">
            <RestTimer />
          </div>
        </div>
      ) : null}

      <Modal
        open={confirmFinishOpen}
        title="Terminer la séance ?"
        onClose={() => setConfirmFinishOpen(false)}
        footer={
          <>
            <Button variant="danger" fullWidth onClick={doFinish}>
              Terminer et ignorer les séries vides
            </Button>
            <Button variant="ghost" fullWidth onClick={() => setConfirmFinishOpen(false)}>
              Continuer la séance
            </Button>
          </>
        }
      >
        <p>
          {pendingSets} série(s) ne sont pas validées. Elles seront supprimées de la séance
          enregistrée.
        </p>
      </Modal>
    </div>
  )
}
