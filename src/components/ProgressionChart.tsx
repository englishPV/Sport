import { useEffect, useMemo, useState } from 'react'
import {
  buildEnrichedChronology,
  type ChartMetric,
  type EnrichedHistoryEntry,
} from '../core/statsEngine'
import { formatNumberFr, type Exercise } from '../core/types'

export type { ChartMetric }

export interface ChartPoint {
  entryId: string
  label: string
  fullDate: string
  value: number
  setsSummary: string
  variant: string
  note: string
}

export function buildExerciseSeries(
  exercise: Exercise,
  metric: ChartMetric,
  onlyPrimaryVariant = false,
): ChartPoint[] {
  const chrono = buildEnrichedChronology(exercise).filter((c: EnrichedHistoryEntry) => {
    if (!c.hasValidWeight) return false
    if (onlyPrimaryVariant && !c.isPrimaryVariant) return false
    return true
  })

  return chrono.map((item) => {
    const value =
      metric === 'maxWeight'
        ? item.topWeight
        : metric === 'volume'
          ? item.volumeKg
          : item.topSetRepsAtPeak

    return {
      entryId: item.entry.id,
      label: item.shortLabel,
      fullDate: item.displayDate,
      value,
      setsSummary: item.setsDisplay,
      variant: item.variant,
      note: item.entry.note,
    }
  })
}

export function ProgressionChart({
  exercise,
  metric,
}: {
  exercise: Exercise
  metric: ChartMetric
}) {
  const allPoints = useMemo(
    () => buildExerciseSeries(exercise, metric, false),
    [exercise, metric],
  )
  const primaryPoints = useMemo(
    () => buildExerciseSeries(exercise, metric, true),
    [exercise, metric],
  )

  const hasVariantSwitch =
    primaryPoints.length >= 2 && primaryPoints.length < allPoints.length

  const [filterSameMachine, setFilterSameMachine] = useState<boolean>(true)
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const [pinnedIdx, setPinnedIdx] = useState<number | null>(null)

  useEffect(() => {
    setHoveredIdx(null)
    setPinnedIdx(null)
    setFilterSameMachine(true)
  }, [exercise.id, metric])

  const points =
    hasVariantSwitch && filterSameMachine ? primaryPoints : allPoints

  if (points.length === 0) {
    return (
      <div className="rounded-2xl bg-slate-50 p-6 text-center text-sm text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
        Pas encore de données enregistrées pour cet exercice.
      </div>
    )
  }

  const width = 580
  const height = 210
  const padLeft = 46
  const padRight = 18
  const padTop = 20
  const padBottom = 30

  const values = points.map((p) => p.value)
  const minVal = Math.min(...values)
  const maxVal = Math.max(...values)

  // Le PR n'est calculé que sur l'équipement actuel pour ne jamais marquer une ancienne poulie comme PR d'haltères
  const latestVariant = points[points.length - 1].variant
  let peakIdx = -1
  let peakVal = -Infinity
  points.forEach((p, idx) => {
    if (p.variant === latestVariant && p.value >= peakVal) {
      peakVal = p.value
      peakIdx = idx
    }
  })

  const span = Math.max(2, maxVal - minVal)
  const yMin = Math.max(0, Math.floor(minVal - span * 0.15))
  const yMax = Math.ceil(maxVal + span * 0.15)

  const plotW = width - padLeft - padRight
  const plotH = height - padTop - padBottom

  const coords = points.map((pt, idx) => {
    const x =
      points.length === 1
        ? padLeft + plotW / 2
        : padLeft + (idx / (points.length - 1)) * plotW
    const y = padTop + plotH - ((pt.value - yMin) / Math.max(1, yMax - yMin)) * plotH
    return { ...pt, x, y, idx }
  })

  const activeIdx =
    hoveredIdx !== null && coords[hoveredIdx]
      ? hoveredIdx
      : pinnedIdx !== null && coords[pinnedIdx]
        ? pinnedIdx
        : coords.length - 1
  const activePoint = coords[activeIdx]

  const prevSameVarPoint =
    activePoint.idx > 0 && coords[activePoint.idx - 1].variant === activePoint.variant
      ? coords[activePoint.idx - 1]
      : null
  const deltaFromPrev = prevSameVarPoint
    ? Math.round((activePoint.value - prevSameVarPoint.value) * 10) / 10
    : null

  const yTicks = [yMin, Math.round(((yMin + yMax) / 2) * 10) / 10, yMax]
  const labelStride = Math.max(1, Math.ceil(coords.length / 6))

  const strokeColor =
    metric === 'reps' ? '#4f46e5' : metric === 'maxWeight' ? '#0284c7' : '#059669'

  const unitLabel =
    metric === 'reps'
      ? Math.abs(activePoint.value) <= 1
        ? 'rep'
        : 'reps'
      : 'kg'

  const deltaUnitLabel =
    metric === 'reps'
      ? deltaFromPrev !== null && Math.abs(deltaFromPrev) <= 1
        ? 'rep'
        : 'reps'
      : 'kg'

  const linePath = coords
    .map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
    .join(' ')

  const areaPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${(
    padTop + plotH
  ).toFixed(1)} L ${coords[0].x.toFixed(1)} ${(padTop + plotH).toFixed(1)} Z`

  return (
    <div className="space-y-2.5">
      {hasVariantSwitch && (
        <div className="flex items-center justify-end gap-1.5 text-[11px]">
          <button
            type="button"
            onClick={() => {
              setFilterSameMachine(true)
              setHoveredIdx(null)
              setPinnedIdx(null)
            }}
            className={`rounded-full px-2.5 py-0.5 font-semibold transition-all duration-300 ease-smooth active:scale-95 ${
              filterSameMachine
                ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/25'
                : 'bg-slate-100 text-slate-500 hover:text-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            Même machine ({primaryPoints.length})
          </button>
          <button
            type="button"
            onClick={() => {
              setFilterSameMachine(false)
              setHoveredIdx(null)
              setPinnedIdx(null)
            }}
            className={`rounded-full px-2.5 py-0.5 font-semibold transition-all duration-300 ease-smooth active:scale-95 ${
              !filterSameMachine
                ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/25'
                : 'bg-slate-100 text-slate-500 hover:text-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            Tout ({allPoints.length})
          </button>
        </div>
      )}

      {/* Détail du point inspecté (revient automatiquement à la dernière séance quand la souris sort) */}
      <div className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs transition-colors duration-300 dark:bg-slate-800/60">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold text-slate-700 dark:text-slate-200">
              {activePoint.fullDate}
            </span>
            <span className="text-slate-400">·</span>
            <span className="text-sm font-extrabold text-indigo-600 dark:text-indigo-400">
              {formatNumberFr(activePoint.value)} {unitLabel}
            </span>
            {activePoint.variant !== 'Standard' && (
              <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-bold text-sky-700 dark:text-sky-300">
                {activePoint.variant}
              </span>
            )}
            {deltaFromPrev !== null && deltaFromPrev !== 0 && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  deltaFromPrev > 0
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                    : 'bg-rose-500/15 text-rose-600 dark:text-rose-300'
                }`}
              >
                {deltaFromPrev > 0 ? '+' : ''}
                {formatNumberFr(deltaFromPrev)} {deltaUnitLabel}
              </span>
            )}
            {activePoint.idx === peakIdx && points.length > 1 && (
              <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                Record
              </span>
            )}
          </div>
          <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
            {activePoint.setsSummary}
          </span>
        </div>

        {activePoint.note ? (
          <p className="mt-1 truncate text-[11px] italic text-slate-500 dark:text-slate-400">
            « {activePoint.note} »
          </p>
        ) : null}
      </div>

      <svg
        key={metric}
        viewBox={`0 0 ${width} ${height}`}
        className="h-48 w-full animate-fade-in select-none overflow-visible"
        role="img"
        aria-label={`Progression ${exercise.name}`}
        onMouseLeave={() => setHoveredIdx(null)}
      >
        <defs>
          <linearGradient id={`grad-${metric}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={strokeColor} stopOpacity="0.22" />
            <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {yTicks.map((tick, i) => {
          const y = padTop + plotH - ((tick - yMin) / Math.max(1, yMax - yMin)) * plotH
          return (
            <g key={i}>
              <line
                x1={padLeft}
                x2={width - padRight}
                y1={y}
                y2={y}
                stroke="currentColor"
                className="text-slate-200 dark:text-slate-800"
                strokeDasharray="3 3"
              />
              <text
                x={padLeft - 7}
                y={y + 4}
                textAnchor="end"
                className="fill-slate-400 text-[10px]"
              >
                {formatNumberFr(tick)}
              </text>
            </g>
          )
        })}

        {coords.length > 1 && (!hasVariantSwitch || filterSameMachine) ? (
          <path
            d={areaPath}
            fill={`url(#grad-${metric})`}
            className="animate-fade-in"
            style={{ animationDuration: '600ms' }}
          />
        ) : null}

        {/* Segments : pointillés lorsqu'il y a changement de machine entre 2 séances */}
        {coords.map((c, idx) => {
          if (idx === 0) return null
          const prev = coords[idx - 1]
          const switchedMachine = prev.variant !== c.variant
          return (
            <line
              key={`seg-${idx}`}
              x1={prev.x}
              y1={prev.y}
              x2={c.x}
              y2={c.y}
              stroke={switchedMachine ? '#94a3b8' : strokeColor}
              strokeWidth={switchedMachine ? 1.75 : 2.75}
              strokeDasharray={switchedMachine ? '4 4' : undefined}
              strokeLinecap="round"
              className="animate-fade-in"
              style={{ animationDelay: `${Math.min(idx * 35, 400)}ms` }}
            />
          )
        })}

        {coords.map((c) => {
          const isSelected = c.idx === activePoint.idx
          const isPeak = c.idx === peakIdx && coords.length > 1
          const isOtherMachine = c.variant !== latestVariant
          const showXLabel = c.idx % labelStride === 0 || c.idx === coords.length - 1
          return (
            <g
              key={c.idx}
              className="animate-fade-in cursor-pointer"
              style={{ animationDelay: `${Math.min(c.idx * 35, 400)}ms` }}
              onMouseEnter={() => setHoveredIdx(c.idx)}
              onClick={() =>
                setPinnedIdx((cur) => (cur === c.idx ? null : c.idx))
              }
            >
              <circle cx={c.x} cy={c.y} r={13} fill="transparent" />
              <circle
                cx={c.x}
                cy={c.y}
                r={isSelected ? 6 : isPeak ? 5 : 3.5}
                fill={
                  isSelected
                    ? strokeColor
                    : isPeak
                      ? '#f59e0b'
                      : isOtherMachine
                        ? '#cbd5e1'
                        : '#ffffff'
                }
                stroke={
                  isPeak && !isSelected
                    ? '#f59e0b'
                    : isOtherMachine && !isSelected
                      ? '#64748b'
                      : strokeColor
                }
                strokeWidth={2}
                style={{
                  transition:
                    'r 180ms cubic-bezier(0.22, 1, 0.36, 1), fill 180ms ease, stroke 180ms ease',
                }}
              />
              {showXLabel ? (
                <text
                  x={c.x}
                  y={height - 6}
                  textAnchor="middle"
                  className="fill-slate-400 text-[10px]"
                >
                  {c.label}
                </text>
              ) : null}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
