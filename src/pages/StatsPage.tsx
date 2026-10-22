import { useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { TrendingDown, TrendingUp } from 'lucide-react'
import { Header } from '../components/layout/Header'
import { Card } from '../components/ui/Card'
import { useAppStore } from '../store/useAppStore'
import { getExerciseSeries, getGlobalProgression } from '../core/stats'

function ChartBlock({
  title,
  unit,
  points,
}: {
  title: string
  unit: string
  points: { date: string; value: number | null }[]
}) {
  return (
    <Card className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-ink">{title}</h2>
        <span className="text-[11px] uppercase tracking-wide text-muted">{unit}</span>
      </div>
      <div className="h-[220px] w-full">
        {points.length === 0 ? (
          <p className="flex h-full items-center justify-center text-sm text-muted">
            Pas encore de données
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="#334155" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: '#94a3b8', fontSize: 10 }}
                tickFormatter={(value: string) => value.slice(5)}
                stroke="#334155"
              />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} stroke="#334155" width={44} />
              <Tooltip
                contentStyle={{
                  background: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: 12,
                  color: '#f1f5f9',
                  fontSize: 12,
                }}
                labelStyle={{ color: '#94a3b8' }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#38bdf8"
                strokeWidth={2}
                dot={{ r: 3, fill: '#38bdf8' }}
                connectNulls={false}
                name={title}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  )
}

export default function StatsPage() {
  const exercises = useAppStore((state) => state.exercises)
  const sessions = useAppStore((state) => state.sessions)

  const withHistory = useMemo(() => {
    const ids = new Set<string>()
    for (const session of sessions) {
      if (session.status !== 'completed' && session.status !== 'imported') continue
      for (const log of session.exercises) ids.add(log.exerciseId)
    }
    return exercises.filter((exercise) => ids.has(exercise.id))
  }, [exercises, sessions])

  const [exerciseId, setExerciseId] = useState('')

  useEffect(() => {
    if (exerciseId !== '' && withHistory.some((exercise) => exercise.id === exerciseId)) return
    setExerciseId(withHistory[0]?.id ?? '')
  }, [withHistory, exerciseId])

  const series = useMemo(
    () => (exerciseId === '' ? [] : getExerciseSeries(exerciseId, sessions)),
    [exerciseId, sessions],
  )

  const progression = useMemo(() => getGlobalProgression(sessions), [sessions])

  const weightPoints = series.map((point) => ({ date: point.date, value: point.maxWeight }))
  const volumePoints = series.map((point) => ({ date: point.date, value: Math.round(point.volume) }))
  const restPoints = series.map((point) => ({ date: point.date, value: point.avgRest }))

  return (
    <div className="mx-auto w-full max-w-lg pb-28">
      <Header title="Statistiques" subtitle="Charge, volume et repos" />

      <div className="space-y-4 px-4 py-4">
        <Card className="space-y-3">
          <h2 className="text-sm font-bold text-ink">Progression globale</h2>
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-full ${
                (progression.percent ?? 0) >= 0 ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'
              }`}
            >
              {(progression.percent ?? 0) >= 0 ? (
                <TrendingUp size={20} />
              ) : (
                <TrendingDown size={20} />
              )}
            </div>
            <div>
              <p className="text-lg font-bold text-ink">
                {progression.percent === null
                  ? 'Pas assez de données'
                  : `${progression.percent > 0 ? '+' : ''}${progression.percent} %`}
              </p>
              <p className="text-xs text-muted">
                4 dernières semaines : {Math.round(progression.currentVolume)} kg vs{' '}
                {Math.round(progression.previousVolume)} kg
              </p>
            </div>
          </div>
        </Card>

        <label className="block space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">Exercice</span>
          <select
            value={exerciseId}
            onChange={(event) => setExerciseId(event.target.value)}
            className="min-h-touch w-full rounded-xl border border-elev bg-card px-3 text-sm text-ink focus:border-accent focus:outline-none"
          >
            {withHistory.length === 0 ? <option value="">Aucun exercice</option> : null}
            {withHistory.map((exercise) => (
              <option key={exercise.id} value={exercise.id}>
                {exercise.name}
              </option>
            ))}
          </select>
        </label>

        <ChartBlock title="Charge max" unit="kg" points={weightPoints} />
        <ChartBlock title="Volume" unit="kg" points={volumePoints} />
        <ChartBlock title="Repos moyen" unit="secondes" points={restPoints} />

        {series.length > 0 ? (
          <p className="text-center text-xs text-muted">
            {series.length} séance(s) · dernier 1RM estimé :{' '}
            {series[series.length - 1].estimated1RM} kg
          </p>
        ) : null}
      </div>
    </div>
  )
}
