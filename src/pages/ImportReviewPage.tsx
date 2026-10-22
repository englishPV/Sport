import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, Check, GitMerge, TriangleAlert } from 'lucide-react'
import { Header } from '../components/layout/Header'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { useAppStore, type ImportPlan } from '../store/useAppStore'
import { normalizeName, parseNotes, suggestSessionTypes, type ParsedPerformance } from '../core/parser'
import { createId, type Exercise, type ExerciseLog, type Session, type Unit } from '../core/types'
import { createExercise } from '../core/types'

interface ExerciseInfo {
  key: string
  name: string
  unit: Unit
  restSeconds: number | null
}

interface ReviewGroup {
  key: string
  name: string
  exerciseKeys: string[]
  dates: string[]
}

const ERROR_LABELS: Record<string, string> = {
  unrecognized: 'Ligne non reconnue',
  invalid_date: 'Date invalide',
  invalid_sets: 'Séries illisibles',
  no_exercise_context: 'Aucun exercice défini avant cette date',
}

function buildDraft(performances: ParsedPerformance[]): {
  infos: Record<string, ExerciseInfo>
  groups: ReviewGroup[]
} {
  const infos: Record<string, ExerciseInfo> = {}
  const byDate = new Map<string, string[]>()

  for (const performance of performances) {
    const key = normalizeName(performance.exerciseName)
    const existing = infos[key]
    if (!existing) {
      const bodyweightOnly = performance.sets.every((set) => set.weight === 0)
      infos[key] = {
        key,
        name: performance.exerciseName.trim(),
        unit: bodyweightOnly ? 'bodyweight' : 'kg',
        restSeconds: performance.restSeconds,
      }
    } else if (existing.restSeconds === null && performance.restSeconds !== null) {
      infos[key] = { ...existing, restSeconds: performance.restSeconds }
    }

    const names = byDate.get(performance.date) ?? []
    if (!names.includes(key)) names.push(key)
    byDate.set(performance.date, names)
  }

  const profiles = Array.from(byDate.entries()).map(([date, exerciseNames]) => ({
    date,
    exerciseNames,
  }))

  const groups: ReviewGroup[] = suggestSessionTypes(profiles).map((group, index) => ({
    key: `group-${index}`,
    name: group.name,
    exerciseKeys: group.exerciseNames,
    dates: group.dates,
  }))

  return { infos, groups }
}

function dateTimestamp(date: string, offset: number): number {
  const [year, month, day] = date.split('-').map(Number)
  return Date.UTC(year, month - 1, day, 12, 0, 0) + offset * 60_000
}

function buildPlan(
  groups: readonly ReviewGroup[],
  infos: Record<string, ExerciseInfo>,
  performances: readonly ParsedPerformance[],
  defaultRestSeconds: number,
): ImportPlan {
  const exercises: Exercise[] = []
  const idByKey: Record<string, string> = {}

  for (const group of groups) {
    for (const key of group.exerciseKeys) {
      if (idByKey[key]) continue
      const info = infos[key]
      if (!info) continue
      const exercise = createExercise({
        name: info.name,
        unit: info.unit,
        defaultRestSeconds: info.restSeconds ?? defaultRestSeconds,
      })
      exercises.push(exercise)
      idByKey[key] = exercise.id
    }
  }

  const usableGroups = groups.filter((group) =>
    group.exerciseKeys.some((key) => idByKey[key] !== undefined),
  )

  const sessionTypes = usableGroups.map((group, index) => ({
    id: createId(),
    name: group.name.trim() === '' ? `Séance ${String.fromCharCode(65 + index)}` : group.name.trim(),
    order: index,
    exerciseIds: group.exerciseKeys
      .map((key) => idByKey[key])
      .filter((id): id is string => id !== undefined),
  }))

  const sessions: Session[] = []

  for (const [index, group] of usableGroups.entries()) {
    const sessionType = sessionTypes[index]
    if (!sessionType) continue

    for (const date of group.dates) {
      const datePerformances = performances.filter((performance) => performance.date === date)
      const inGroup = datePerformances.filter((performance) =>
        group.exerciseKeys.includes(normalizeName(performance.exerciseName)),
      )
      const used = inGroup.length > 0 ? inGroup : datePerformances
      const logs = new Map<string, ExerciseLog>()

      for (const performance of used) {
        const exerciseId = idByKey[normalizeName(performance.exerciseName)]
        if (exerciseId === undefined) continue
        const log = logs.get(exerciseId) ?? { exerciseId, sets: [], note: '' }
        for (const set of performance.sets) {
          log.sets.push({
            index: log.sets.length,
            weight: set.weight,
            reps: set.reps,
            restSecondsPlanned: performance.restSeconds,
            restSecondsActual: performance.restSeconds,
            rpe: null,
            note: performance.note,
            completedAt: dateTimestamp(date, log.sets.length),
          })
        }
        if (performance.note) {
          log.note = log.note === '' ? performance.note : `${log.note} · ${performance.note}`
        }
        logs.set(exerciseId, log)
      }

      if (logs.size === 0) continue

      sessions.push({
        id: createId(),
        sessionTypeId: sessionType.id,
        date,
        startedAt: null,
        endedAt: null,
        status: 'imported' as const,
        exercises: Array.from(logs.values()),
        coachPlan: null,
        source: 'import' as const,
      })
    }
  }

  return { exercises, sessionTypes, sessions }
}

export default function ImportReviewPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const mode = searchParams.get('mode') === 'merge' ? 'merge' : 'replace'

  const rawText = useAppStore((state) => state.pendingImportText)
  const setPendingImportText = useAppStore((state) => state.setPendingImportText)
  const applyImport = useAppStore((state) => state.applyImport)
  const defaultRestSeconds = useAppStore((state) => state.settings.defaultRestSeconds)
  const pushToast = useAppStore((state) => state.pushToast)

  const parsed = useMemo(() => parseNotes(rawText), [rawText])
  const initial = useMemo(() => buildDraft(parsed.performances), [parsed.performances])

  const [groups, setGroups] = useState<ReviewGroup[]>(initial.groups)
  const infos = initial.infos

  const totalSets = parsed.performances.reduce(
    (total, performance) => total + performance.sets.length,
    0,
  )

  const updateGroup = (key: string, updater: (group: ReviewGroup) => ReviewGroup) => {
    setGroups((current) => current.map((group) => (group.key === key ? updater(group) : group)))
  }

  const moveGroup = (index: number, direction: -1 | 1) => {
    setGroups((current) => {
      const target = index + direction
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      const [removed] = next.splice(index, 1)
      next.splice(target, 0, removed)
      return next
    })
  }

  const mergeWithNext = (index: number) => {
    setGroups((current) => {
      const next = [...current]
      const first = next[index]
      const second = next[index + 1]
      if (!first || !second) return current
      const merged: ReviewGroup = {
        ...first,
        exerciseKeys: Array.from(new Set([...first.exerciseKeys, ...second.exerciseKeys])),
        dates: Array.from(new Set([...first.dates, ...second.dates])).sort(),
      }
      next.splice(index, 2, merged)
      return next
    })
  }

  const moveExercise = (fromKey: string, exerciseKey: string, toKey: string) => {
    if (fromKey === toKey) return
    setGroups((current) =>
      current.map((group) => {
        if (group.key === fromKey) {
          return { ...group, exerciseKeys: group.exerciseKeys.filter((key) => key !== exerciseKey) }
        }
        if (group.key === toKey && !group.exerciseKeys.includes(exerciseKey)) {
          return { ...group, exerciseKeys: [...group.exerciseKeys, exerciseKey] }
        }
        return group
      }),
    )
  }

  const validate = () => {
    const plan = buildPlan(groups, infos, parsed.performances, defaultRestSeconds)
    if (plan.sessions.length === 0) {
      pushToast('Aucune séance exploitable dans cet import.', 'error')
      return
    }
    applyImport(plan, mode)
    setPendingImportText('')
    pushToast(
      mode === 'merge'
        ? `${plan.sessions.length} séance(s) ajoutée(s).`
        : `Import terminé : ${plan.sessions.length} séance(s).`,
      'success',
    )
    navigate('/', { replace: true })
  }

  if (rawText.trim() === '') {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-xl font-bold text-ink">Rien à analyser</h1>
        <p className="text-sm text-muted">Colle d’abord ton bloc-notes à l’étape précédente.</p>
        <Button onClick={() => navigate('/onboarding')}>Revenir à l’import</Button>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-lg pb-32">
      <Header
        title={mode === 'merge' ? 'Ajouter des séances' : 'Vérifier l’import'}
        subtitle={`Étape 3 / 3 · ${parsed.performances.length} performance(s), ${totalSets} série(s)`}
        onBack={() => navigate(mode === 'merge' ? '/settings' : '/onboarding')}
      />

      <div className="space-y-4 px-4 py-4">
        <div className="rounded-2xl border border-elev/50 bg-card p-4">
          <p className="text-sm text-muted">Aucune déduction silencieuse : vérifie et corrige.</p>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-base/60 p-2">
              <p className="text-xl font-bold text-ink">{Object.keys(infos).length}</p>
              <p className="text-[11px] uppercase tracking-wide text-muted">Exercices</p>
            </div>
            <div className="rounded-xl bg-base/60 p-2">
              <p className="text-xl font-bold text-ink">{parsed.performances.length}</p>
              <p className="text-[11px] uppercase tracking-wide text-muted">Performances</p>
            </div>
            <div className="rounded-xl bg-base/60 p-2">
              <p className="text-xl font-bold text-ink">{groups.length}</p>
              <p className="text-[11px] uppercase tracking-wide text-muted">Types</p>
            </div>
          </div>
        </div>

        {parsed.errors.length > 0 ? (
          <div className="rounded-2xl border border-warn/40 bg-warn/10 p-4">
            <div className="mb-2 flex items-center gap-2 text-warn">
              <TriangleAlert size={16} />
              <p className="text-sm font-semibold">
                {parsed.errors.length} ligne(s) ignorée(s)
              </p>
            </div>
            <ul className="max-h-40 space-y-2 overflow-y-auto text-xs text-ink">
              {parsed.errors.map((error) => (
                <li key={`${error.line}-${error.reason}`} className="rounded-lg bg-base/40 p-2">
                  <span className="font-semibold">Ligne {error.line}</span> ·{' '}
                  {ERROR_LABELS[error.reason] ?? error.reason}
                  <p className="mt-1 break-words font-mono text-[11px] text-muted">{error.text}</p>
                </li>
              ))}
            </ul>
            <Button
              variant="ghost"
              className="mt-3"
              onClick={() => navigate(mode === 'merge' ? '/settings' : '/onboarding')}
            >
              Revenir corriger le texte
            </Button>
          </div>
        ) : null}

        {groups.map((group, index) => (
          <section key={group.key} className="space-y-3 rounded-2xl border border-elev/50 bg-card p-4">
            <div className="flex items-start gap-2">
              <input
                value={group.name}
                onChange={(event) => updateGroup(group.key, (current) => ({ ...current, name: event.target.value }))}
                aria-label={`Nom du groupe ${index + 1}`}
                className="min-h-touch w-full rounded-xl border border-elev bg-base px-3 text-base font-bold text-ink focus:border-accent focus:outline-none"
              />
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  aria-label="Monter ce groupe"
                  disabled={index === 0}
                  onClick={() => moveGroup(index, -1)}
                  className="flex min-h-touch min-w-touch items-center justify-center rounded-xl bg-elev text-ink disabled:opacity-30"
                >
                  <ArrowUp size={18} />
                </button>
                <button
                  type="button"
                  aria-label="Descendre ce groupe"
                  disabled={index === groups.length - 1}
                  onClick={() => moveGroup(index, 1)}
                  className="flex min-h-touch min-w-touch items-center justify-center rounded-xl bg-elev text-ink disabled:opacity-30"
                >
                  <ArrowDown size={18} />
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="accent">{group.dates.length} séance(s)</Badge>
              <Badge>{group.exerciseKeys.length} exercice(s)</Badge>
              {index < groups.length - 1 ? (
                <Button variant="ghost" className="ml-auto gap-1" onClick={() => mergeWithNext(index)}>
                  <GitMerge size={16} /> Fusionner
                </Button>
              ) : null}
            </div>

            <ul className="space-y-2">
              {group.exerciseKeys.map((exerciseKey) => {
                const info = infos[exerciseKey]
                if (!info) return null
                return (
                  <li
                    key={exerciseKey}
                    className="flex flex-wrap items-center gap-2 rounded-lg bg-base/50 px-3 py-2"
                  >
                    <span className="flex-1 text-sm text-ink">{info.name}</span>
                    {info.restSeconds !== null ? (
                      <span className="text-[11px] text-muted">repos {info.restSeconds} s</span>
                    ) : null}
                    <select
                      value={group.key}
                      aria-label={`Déplacer ${info.name}`}
                      onChange={(event) => moveExercise(group.key, exerciseKey, event.target.value)}
                      className="min-h-touch rounded-lg border border-elev bg-base px-2 text-xs text-ink focus:border-accent focus:outline-none"
                    >
                      {groups.map((candidate, candidateIndex) => (
                        <option key={candidate.key} value={candidate.key}>
                          {candidate.name || `Séance ${candidateIndex + 1}`}
                        </option>
                      ))}
                    </select>
                  </li>
                )
              })}
              {group.exerciseKeys.length === 0 ? (
                <li className="text-xs text-muted">Groupe vide — il sera ignoré.</li>
              ) : null}
            </ul>
          </section>
        ))}

        {groups.length === 0 ? (
          <div className="rounded-2xl border border-danger/40 bg-danger/10 p-4 text-sm text-ink">
            Aucune performance reconnue. Corrige le texte puis relance l’analyse.
          </div>
        ) : null}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-elev/50 bg-base/95 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto w-full max-w-lg">
          <Button fullWidth size="xl" onClick={validate} disabled={groups.length === 0} className="gap-2">
            <Check size={20} /> Valider l’import
          </Button>
        </div>
      </div>
    </div>
  )
}
