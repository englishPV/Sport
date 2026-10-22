import type { ISODate } from './types'
import { normalizeName } from './types'

export { normalizeName }

/* -------------------------------------------------------------------------- */
/* Types publics                                                              */
/* -------------------------------------------------------------------------- */

export interface ParsedPerformance {
  exerciseName: string
  date: ISODate
  sets: { weight: number; reps: number }[]
  restSeconds: number | null
  note: string
}

export type ParseErrorReason =
  | 'unrecognized'
  | 'invalid_date'
  | 'invalid_sets'
  | 'no_exercise_context'

export interface ParseError {
  /** Numéro de ligne, 1-based. */
  line: number
  text: string
  reason: ParseErrorReason
}

export interface ParseResult {
  performances: ParsedPerformance[]
  errors: ParseError[]
}

/* -------------------------------------------------------------------------- */
/* Expressions régulières                                                     */
/* -------------------------------------------------------------------------- */

const DATE_RE = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/
const SEPARATOR_RE = /\s+[-–/]\s+/
const BLOCK_RE = /^(.*?)\s*(?:x|X|×|\*)\s*(.+)$/
const BODYWEIGHT_RE = /^(pdc|poids du corps|poids de corps|bw)$/i
const WEIGHT_RE = /^(\d+(?:[.,]\d+)?)\s*(?:kg|kgs)?$/i

/* -------------------------------------------------------------------------- */
/* Parsing d'une date                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Convertit `24/10/2026`, `20/10` ou `24.10.26` en `YYYY-MM-DD`.
 * Année absente → année courante ; année à 2 chiffres → 20xx.
 * Retourne null si la date est invalide (ex. 31/02/2026).
 */
export function parseDate(raw: string, now: Date = new Date()): ISODate | null {
  const match = DATE_RE.exec(raw.trim())
  if (!match) return null
  const day = Number(match[1])
  const month = Number(match[2])
  const yearToken = match[3]
  const year = yearToken === undefined ? now.getFullYear() : Number(yearToken.length === 2 ? `20${yearToken}` : yearToken)
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const candidate = new Date(Date.UTC(year, month - 1, day))
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null
  }
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${year}-${mm}-${dd}`
}

/* -------------------------------------------------------------------------- */
/* Parsing du commentaire                                                     */
/* -------------------------------------------------------------------------- */

interface ParsedComment {
  restSeconds: number | null
  note: string
}

const REST_HOURS_RE = /repos\s*(\d+)\s*h(?:eures?)?\s*(\d+)?\s*m?/i
const REST_MINUTES_RE = /repos\s*(\d+)\s*m(?:in|ins|inutes?)?\s*(\d+)?\s*s?/i
const REST_SECONDS_RE = /repos\s*(\d+)\s*(?:s|sec|secs|secondes?)\b/i
const REST_BARE_RE = /repos\s*(\d+)(?!\s*[a-z])/i

export function parseComment(raw: string): ParsedComment {
  const trimmed = raw.trim()
  if (trimmed === '') return { restSeconds: null, note: '' }

  let restSeconds: number | null = null
  let remainder = trimmed

  const hours = REST_HOURS_RE.exec(trimmed)
  if (hours) {
    const base = Number(hours[1]) * 3600
    const extra = hours[2] === undefined ? 0 : Number(hours[2]) * 60
    restSeconds = base + extra
    remainder = trimmed.replace(hours[0], ' ')
  }

  const minutes = hours ? null : REST_MINUTES_RE.exec(trimmed)
  if (minutes) {
    const base = Number(minutes[1]) * 60
    const extra = minutes[2] === undefined ? 0 : Number(minutes[2])
    restSeconds = base + extra
    remainder = trimmed.replace(minutes[0], ' ')
  } else if (!hours) {
    const seconds = REST_SECONDS_RE.exec(trimmed)
    if (seconds) {
      restSeconds = Number(seconds[1])
      remainder = trimmed.replace(seconds[0], ' ')
    } else {
      const bare = REST_BARE_RE.exec(trimmed)
      if (bare) {
        restSeconds = Number(bare[1])
        remainder = trimmed.replace(bare[0], ' ')
      }
    }
  }

  let note = remainder
    .replace(/^[\s,;:-]+/, '')
    .replace(/[\s,;:-]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()

  // `(repos)` sans valeur : pas de note résiduelle.
  if (note.toLowerCase() === 'repos') note = ''

  return { restSeconds, note }
}

/* -------------------------------------------------------------------------- */
/* Parsing des séries                                                         */
/* -------------------------------------------------------------------------- */

export interface ParsedSet {
  weight: number
  reps: number
}

/**
 * `15kg x 11, 9 - 12kg x 11` → [{15,11},{15,9},{12,11}]
 * Retourne null si au moins un bloc est invalide.
 */
export function parseSets(raw: string): ParsedSet[] | null {
  const blocks = raw
    .split(SEPARATOR_RE)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
  if (blocks.length === 0) return null

  const sets: ParsedSet[] = []
  for (const block of blocks) {
    const match = BLOCK_RE.exec(block)
    if (!match) return null
    const weightToken = match[1].trim()
    const repsToken = match[2].trim()

    let weight = 0
    if (BODYWEIGHT_RE.test(weightToken)) {
      weight = 0
    } else {
      const weightMatch = WEIGHT_RE.exec(weightToken)
      if (!weightMatch) return null
      weight = Number(weightMatch[1].replace(',', '.'))
      if (!Number.isFinite(weight) || weight < 0) return null
    }

    const repsList = repsToken.split(',').map((reps) => reps.trim())
    if (repsList.length === 0) return null
    for (const reps of repsList) {
      if (!/^\d+$/.test(reps)) return null
      const value = Number(reps)
      if (!Number.isInteger(value) || value < 0) return null
      sets.push({ weight, reps: value })
    }
  }

  return sets.length > 0 ? sets : null
}

/* -------------------------------------------------------------------------- */
/* Parsing d'une ligne                                                        */
/* -------------------------------------------------------------------------- */

const COLON_SEPARATOR = /\s+:\s+/
const TRAILING_PARENS_RE = /\(([^()]*)\)\s*$/

interface LineResult {
  performance?: ParsedPerformance
  header?: string
  error?: ParseErrorReason
}

function isExerciseName(candidate: string): boolean {
  if (candidate.trim() === '') return false
  if (candidate.includes(' : ')) return false
  return !/^\d/.test(candidate.trim())
}

function parseLine(rawLine: string, currentExercise: string | null, now: Date): LineResult {
  const line = rawLine.trim()

  // Forme B — en-tête `<NomExercice> :`
  if (/:$/.test(line) && !COLON_SEPARATOR.test(line)) {
    const name = line.replace(/:\s*$/, '').trim()
    if (!isExerciseName(name)) return { error: 'unrecognized' }
    return { header: name }
  }

  // Extraction du commentaire final, entre parenthèses.
  let withoutComment = line
  let comment = ''
  const parens = TRAILING_PARENS_RE.exec(line)
  if (parens) {
    comment = parens[1]
    withoutComment = line.slice(0, parens.index).trim()
  }

  const parts = withoutComment.split(COLON_SEPARATOR).map((part) => part.trim())

  if (parts.length >= 3) {
    const name = parts[0]
    const dateToken = parts[1]
    const setsToken = parts.slice(2).join(' : ')
    if (!isExerciseName(name)) return { error: 'unrecognized' }
    const date = parseDate(dateToken, now)
    if (!date) return { error: 'invalid_date' }
    const sets = parseSets(setsToken)
    if (!sets) return { error: 'invalid_sets' }
    const { restSeconds, note } = parseComment(comment)
    return { performance: { exerciseName: name, date, sets, restSeconds, note } }
  }

  if (parts.length === 2) {
    const dateToken = parts[0]
    const setsToken = parts[1]
    const date = parseDate(dateToken, now)
    if (!date) return { error: 'unrecognized' }
    if (currentExercise === null) return { error: 'no_exercise_context' }
    const sets = parseSets(setsToken)
    if (!sets) return { error: 'invalid_sets' }
    const { restSeconds, note } = parseComment(comment)
    return { performance: { exerciseName: currentExercise, date, sets, restSeconds, note } }
  }

  return { error: 'unrecognized' }
}

/* -------------------------------------------------------------------------- */
/* Point d'entrée                                                             */
/* -------------------------------------------------------------------------- */

export function parseNotes(raw: string, now: Date = new Date()): ParseResult {
  const performances: ParsedPerformance[] = []
  const errors: ParseError[] = []
  let currentExercise: string | null = null

  const lines = raw.split(/\r?\n/)
  lines.forEach((line, index) => {
    if (line.trim() === '') return
    const result = parseLine(line, currentExercise, now)
    if (result.header !== undefined) {
      currentExercise = result.header
      return
    }
    if (result.performance) {
      performances.push(result.performance)
      return
    }
    errors.push({
      line: index + 1,
      text: line.trim(),
      reason: result.error ?? 'unrecognized',
    })
  })

  return { performances, errors }
}

/* -------------------------------------------------------------------------- */
/* Regroupement / suggestion de types (utilisé par ImportReviewPage)          */
/* -------------------------------------------------------------------------- */

export interface SuggestedGroup {
  name: string
  exerciseNames: string[]
  dates: ISODate[]
}

/** Indice de Jaccard entre deux ensembles de noms d'exercices. */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let intersection = 0
  a.forEach((value) => {
    if (b.has(value)) intersection += 1
  })
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

/**
 * Regroupe les séances (par date) dont les ensembles d'exercices ont un
 * indice de Jaccard ≥ 0.5. Groupes nommés `Séance A`, `Séance B`, … dans
 * l'ordre d'apparition chronologique.
 */
export function suggestSessionTypes(
  profiles: { date: ISODate; exerciseNames: string[] }[],
  threshold = 0.5,
): SuggestedGroup[] {
  const sorted = [...profiles].sort((a, b) => a.date.localeCompare(b.date))
  const groups: { names: Set<string>; dates: ISODate[] }[] = []

  for (const profile of sorted) {
    const names = new Set(profile.exerciseNames.map(normalizeName))
    const target = groups.find((group) => jaccard(group.names, names) >= threshold)
    if (target) {
      names.forEach((name) => target.names.add(name))
      target.dates.push(profile.date)
    } else {
      groups.push({ names, dates: [profile.date] })
    }
  }

  return groups.map((group, index) => ({
    name: `Séance ${String.fromCharCode(65 + (index % 26))}`,
    exerciseNames: Array.from(group.names),
    dates: [...group.dates].sort(),
  }))
}
