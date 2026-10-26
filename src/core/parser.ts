import {
  createId,
  formatIsoToFr,
  formatNumberFr,
  formatRestDuration,
  normalizeName,
  type CoachSessionPlan,
  type Exercise,
  type ExerciseCategory,
  type ExerciseEntry,
  type SectionId,
  type Unit,
  type WorkoutSet,
} from './types'
import { DEFAULT_NOTEPAD_PREAMBLE } from './defaultNotepad'

export interface ParsedNotepad {
  preamble: string
  exercises: Exercise[]
}

/* -------------------------------------------------------------------------- */
/* Inférence des métadonnées par exercice                                     */
/* -------------------------------------------------------------------------- */

export function inferExerciseMeta(name: string): {
  category: ExerciseCategory
  repRange: [number, number]
  weightStep: number
  unit: Unit
  defaultRestSeconds: number
} {
  const norm = normalizeName(name)

  if (/\b(dips banc|traction|tractions)\b/.test(norm)) {
    return {
      category: 'poly',
      repRange: [8, 12],
      weightStep: 2.5,
      unit: 'bodyweight',
      defaultRestSeconds: 120,
    }
  }

  const isIso =
    /\b(elevation|elevations|triceps|biceps|curl|mollet|mollets|calf|khalf|abdo|abdominaux|crunch|oiseau|shrug|shrugs)\b/.test(
      norm,
    ) || norm.includes('extension au dessus')

  // Leg curl est un exercice jambes poly/machine travaillé en 8-12 dans le carnet
  const isLegCurl = norm.includes('leg curl') || norm.includes('prone leg curl')
  const category: ExerciseCategory = isIso && !isLegCurl ? 'iso' : 'poly'
  const repRange: [number, number] = category === 'iso' ? [12, 15] : [8, 12]

  let weightStep = 2.5
  if (
    norm.includes('haltere') ||
    norm.includes('souleve de terre roumain') ||
    norm.includes('oiseau') ||
    norm.includes('shrug')
  ) {
    weightStep = 2
  } else if (
    norm.includes('tirage') ||
    norm.includes('leg press') ||
    norm.includes('leg extension') ||
    norm.includes('leg curl') ||
    norm.includes('mollet') ||
    norm.includes('calf') ||
    norm.includes('khalf') ||
    norm.includes('abdominaux')
  ) {
    weightStep = 5
  }

  const defaultRestSeconds = category === 'iso' ? 90 : 150

  return {
    category,
    repRange,
    weightStep,
    unit: 'kg',
    defaultRestSeconds,
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers de parsing                                                         */
/* -------------------------------------------------------------------------- */

function parseFrDate(dayStr: string, monthStr: string, yearStr?: string): string | null {
  const day = Number(dayStr)
  const month = Number(monthStr)
  let year = yearStr ? Number(yearStr) : new Date().getFullYear()
  if (year < 100) year += 2000
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) {
    return null
  }
  const check = new Date(Date.UTC(year, month - 1, day))
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function detectSectionHeader(line: string): SectionId | null {
  const trimmed = line.replace(/:\s*$/, '').trim()
  const norm = normalizeName(trimmed)
  if (
    norm === 'jambes legs' ||
    norm === 'jambes' ||
    norm === 'legs' ||
    norm === 'bas du corps' ||
    norm === 'bas'
  ) {
    return 'legs'
  }
  if (
    norm === 'up' ||
    norm === 'haut du corps up' ||
    norm === 'haut du corps' ||
    norm === 'haut'
  ) {
    return 'up'
  }
  return null
}

function isPromptHeading(name: string): boolean {
  if (name.length > 65 || name.includes(',')) return true
  const norm = normalizeName(name)
  return /^(regles?|formats?|consignes?|objectifs?|prompts?|instructions?|aujourd hui|pour chaque|profil|notes?|rappels?|priorites?|contexte|attention|important|remarques?)\b/.test(
    norm,
  )
}

interface HeaderMatch {
  name: string
  sectionOverride?: SectionId
  archived?: boolean
  inlineRest?: string
}

function hasBalancedParens(text: string): boolean {
  let depth = 0
  for (const ch of text) {
    if (ch === '(') depth += 1
    else if (ch === ')') {
      depth -= 1
      if (depth < 0) return false
    }
  }
  return depth === 0
}

function matchExerciseHeader(line: string, preambleDone: boolean): HeaderMatch | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  if (/^[•\-*]/.test(trimmed)) return null
  if (/^\d+\.\s/.test(trimmed)) return null

  // Cas "(Shoulder press :" (bloc entre parenthèses)
  if (trimmed.startsWith('(') && trimmed.endsWith(':')) {
    const inner = trimmed.slice(1, -1).trim()
    if (inner.length >= 2 && hasBalancedParens(inner) && !isPromptHeading(inner)) {
      return { name: inner, archived: true }
    }
  }

  // En-tête classique finissant par ":"
  if (trimmed.endsWith(':')) {
    const rawName = trimmed.slice(0, -1).trim()
    if (!rawName || !hasBalancedParens(rawName) || isPromptHeading(rawName)) return null
    // Pas de chiffres de type "50kg" ou date au début
    if (/^\d/.test(rawName)) return null

    // Cas "Up Développé incliné haltères :"
    if (/^up\s+/i.test(rawName)) {
      return {
        name: rawName.replace(/^up\s+/i, '').trim(),
        sectionOverride: 'up',
      }
    }
    if (/^legs\s+/i.test(rawName)) {
      return {
        name: rawName.replace(/^legs\s+/i, '').trim(),
        sectionOverride: 'legs',
      }
    }
    return { name: rawName }
  }

  // Cas sur une seule ligne après le préambule : "Traction : 1 rep" ou "Shrugs haltères : 12kg × 12, 13, 14"
  if (preambleDone) {
    // Le `:` doit être hors parenthèses
    let depth = 0
    let colonIdx = -1
    for (let i = 0; i < trimmed.length; i += 1) {
      if (trimmed[i] === '(') depth += 1
      else if (trimmed[i] === ')') {
        depth -= 1
        if (depth < 0) return null
      } else if (trimmed[i] === ':' && depth === 0) {
        colonIdx = i
        break
      }
    }

    if (colonIdx > 1) {
      const left = trimmed.slice(0, colonIdx).trim()
      const right = trimmed.slice(colonIdx + 1).trim()
      if (
        left.length >= 3 &&
        hasBalancedParens(left) &&
        !/^\d/.test(left) &&
        !left.startsWith('(') &&
        !isPromptHeading(left) &&
        /\d/.test(right)
      ) {
        return { name: left, inlineRest: right }
      }
    }
  }

  return null
}

/** Extrait la durée de repos éventuelle et retourne le texte nettoyé. */
function extractRestSeconds(input: string): { cleaned: string; restSeconds: number | null } {
  let restSeconds: number | null = null
  let cleaned = input

  const patterns: RegExp[] = [
    /\(\s*repos\s*:?\s*(\d+)\s*(?:min|m)\s*(\d{1,2})?\s*(?:s|sec)?\s*\)/gi,
    /\(\s*(\d+)\s*(?:min|m)\s*(\d{1,2})?\s*de\s+repos\s*\)/gi,
    /(?:^|\s)repos\s*:?\s*(\d+)\s*(?:min|m)\s*(\d{1,2})?\s*(?:s|sec)?\s*\)?/gi,
    /\(\s*repos\s*:?\s*(\d+)\s*(?:s|sec)\s*\)/gi,
  ]

  for (const [idx, pattern] of patterns.entries()) {
    cleaned = cleaned.replace(pattern, (_match, a: string, b?: string) => {
      if (idx === 3) {
        restSeconds = Number(a)
      } else {
        restSeconds = Number(a) * 60 + (b ? Number(b) : 0)
      }
      return ' '
    })
  }

  return { cleaned: cleaned.trim(), restSeconds }
}

function extractDurationTag(
  input: string,
  tagRegexSource: string,
): { cleaned: string; seconds: number | null } {
  let seconds: number | null = null
  let cleaned = input

  const minSecRe = new RegExp(
    `\\(\\s*(?:${tagRegexSource})\\s*:?\\s*(\\d+)\\s*(?:min|m)\\s*(\\d{1,2})?\\s*(?:s|sec)?\\s*\\)`,
    'gi',
  )
  const secOnlyRe = new RegExp(
    `\\(\\s*(?:${tagRegexSource})\\s*:?\\s*(\\d+)\\s*(?:s|sec)\\s*\\)`,
    'gi',
  )

  cleaned = cleaned.replace(minSecRe, (_m, a: string, b?: string) => {
    seconds = Number(a) * 60 + (b ? Number(b) : 0)
    return ' '
  })
  cleaned = cleaned.replace(secOnlyRe, (_m, a: string) => {
    seconds = Number(a)
    return ' '
  })

  return { cleaned: cleaned.trim(), seconds }
}

/**
 * Extrait les commentaires entre parenthèses (y compris imbriqués ou parenthèses
 * non fermées avant `, <reps>`) et conserve `__FAIL__` pour `(échec)`.
 */
function extractInlineComments(input: string): { cleaned: string; notes: string[] } {
  const notes: string[] = []

  // Marqueurs spéciaux pour (échec) et (échauffement) afin de les associer à la série concernée
  const text = input
    .replace(/\(\s*[eé]chec\s*\)/gi, ' __FAIL__ ')
    .replace(/\(\s*[eé]chauffement\s*\)/gi, ' __WARMUP__ ')

  let out = ''
  let i = 0
  while (i < text.length) {
    if (text[i] !== '(') {
      out += text[i]
      i += 1
      continue
    }

    // Recherche de la parenthèse fermante correspondante
    let depth = 1
    let j = i + 1
    let typoSplitAt = -1

    while (j < text.length && depth > 0) {
      // Détection du cas typo `?(, 8` où `(` a été tapé à la place de `)` avant `, <chiffre>`
      if (text[j] === '(' && /^\(\s*,\s*\d/.test(text.slice(j))) {
        typoSplitAt = j
        break
      }
      if (text[j] === '(') depth += 1
      else if (text[j] === ')') depth -= 1
      j += 1
    }

    if (typoSplitAt !== -1) {
      const rawNote = text.slice(i + 1, typoSplitAt).trim()
      if (rawNote) notes.push(rawNote)
      out += ' '
      i = typoSplitAt + 1 // saute le `(` fautif et garde `, 8`
      continue
    }

    if (depth === 0) {
      const rawNote = text.slice(i + 1, j - 1).trim()
      if (rawNote) notes.push(rawNote)
      out += ' '
      i = j
      continue
    }

    // Parenthèse jamais refermée jusqu'à la fin de la ligne :
    // Vérifie si la fin contient `, 15 13` (reps oubliées après un commentaire non fermé)
    const unclosed = text.slice(i + 1)
    const trailingRepsMatch = /^(.*?)(\s*,\s*\d+(?:[.,]\d+)?(?:\s*,?\s*\d+(?:[.,]\d+)?)*)\s*$/.exec(
      unclosed,
    )
    if (trailingRepsMatch) {
      const rawNote = trailingRepsMatch[1].trim()
      if (rawNote) notes.push(rawNote)
      out += ` ${trailingRepsMatch[2]}`
    } else {
      const rawNote = unclosed.trim()
      if (rawNote) notes.push(rawNote)
    }
    break
  }

  return { cleaned: out.replace(/\s+/g, ' ').trim(), notes }
}

function parseRepsTokens(rawReps: string): {
  repsList: { reps: number; failure?: boolean }[]
  trailingNote: string
} {
  const repsList: { reps: number; failure?: boolean }[] = []
  const extraNotes: string[] = []

  // Normalise "11,5" collé sans espace (demi-rep), "8ou9" -> "8.5", "12-13" -> 12
  const normalized = rawReps
    .replace(/(\d+),5\b/g, '$1.5')
    .replace(/(\d+)\s*ou\s*(\d+)/gi, (_m, a: string, b: string) =>
      String((Number(a) + Number(b)) / 2),
    )
    .replace(/(\d+)\s*-\s*(\d+)/g, (_m, a: string, b: string) =>
      String(Math.floor((Number(a) + Number(b)) / 2)),
    )

  const commaParts = normalized.split(',')
  for (const part of commaParts) {
    const trimmed = part.trim()
    if (!trimmed) continue

    // Cherche les nombres dans ce segment (supporte `15 13` ou `8 __FAIL__`)
    const tokenRegex = /(\d+(?:[.,]\d+)?)(\s*__FAIL__)?/g
    let match: RegExpExecArray | null
    let lastEnd = 0
    let foundAny = false

    while ((match = tokenRegex.exec(trimmed)) !== null) {
      const before = trimmed.slice(lastEnd, match.index).trim()
      // Si du texte s'intercale avant un nombre (ex: "réglage à 2/3"), on s'arrête
      if (before && /[a-zA-ZÀ-ÿ]/.test(before) && foundAny) {
        extraNotes.push(trimmed.slice(match.index - before.length).trim())
        lastEnd = trimmed.length
        break
      }
      if (before && /[a-zA-ZÀ-ÿ]/.test(before) && !foundAny) {
        extraNotes.push(trimmed)
        lastEnd = trimmed.length
        break
      }

      const val = Number(match[1].replace(',', '.'))
      if (Number.isFinite(val) && val > 0 && val <= 200) {
        repsList.push({
          reps: val,
          ...(match[2] ? { failure: true } : {}),
        })
        foundAny = true
      }
      lastEnd = tokenRegex.lastIndex
    }

    const tail = trimmed
      .slice(lastEnd)
      .replace(/__FAIL__/g, '')
      .replace(/__WARMUP__/g, '')
      .trim()
    if (tail && tail !== '.' && !/^reps?$/i.test(tail)) {
      extraNotes.push(tail)
    }
  }

  return {
    repsList,
    trailingNote: extraNotes.join(' · '),
  }
}

function markWarmupSets(sets: WorkoutSet[]): WorkoutSet[] {
  if (sets.length <= 1) return sets
  const peakWeight = Math.max(...sets.map((s) => s.weight))
  if (peakWeight <= 0) return sets
  const peakIdx = sets.findIndex((s) => s.weight === peakWeight)
  if (peakIdx <= 0) return sets

  const setsAtPeakCount = sets.filter((s) => s.weight === peakWeight).length
  const updated = sets.map((s) => ({ ...s }))
  for (let i = 0; i < peakIdx; i += 1) {
    const s = updated[i]
    const prevWarmup = i === 0 || updated[i - 1].isWarmup === true
    if (
      s.isWarmup ||
      s.weight <= peakWeight * 0.72 ||
      (prevWarmup && s.weight < peakWeight && s.reps <= 8) ||
      (i === 0 && peakIdx === 1 && s.weight < peakWeight && setsAtPeakCount >= 3)
    ) {
      s.isWarmup = true
    }
  }
  return updated
}

export function parseEntryLine(rawLine: string): ExerciseEntry {
  let working = rawLine.replace(/^[•\-*]\s*/, '').trim()
  const collectedNotes: string[] = []
  let wasObjective = false
  let date: string | null = null

  // 1. Extraction des durées (repos, exo, séance)
  const restResult = extractRestSeconds(working)
  working = restResult.cleaned
  const restSeconds = restResult.restSeconds

  const exoResult = extractDurationTag(working, 'exo|exercice')
  working = exoResult.cleaned
  const workSeconds = exoResult.seconds

  const sessionResult = extractDurationTag(working, 's[eé]ance|total')
  working = sessionResult.cleaned
  const sessionDurationSeconds = sessionResult.seconds

  // 2. Date éventuelle en début de ligne : `22/10/2026 (Objectif) : ...`
  const datePrefixRe = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b(.*)$/
  const dateMatch = datePrefixRe.exec(working)
  if (dateMatch) {
    const parsedDate = parseFrDate(dateMatch[1], dateMatch[2], dateMatch[3])
    if (parsedDate) {
      date = parsedDate
      const afterDate = dateMatch[4].trim()
      // Trouve le `:` qui sépare l'en-tête de date des séries (hors parenthèses)
      let depth = 0
      let colonPos = -1
      for (let i = 0; i < afterDate.length; i += 1) {
        if (afterDate[i] === '(') depth += 1
        else if (afterDate[i] === ')' && depth > 0) depth -= 1
        else if (afterDate[i] === ':' && depth === 0) {
          colonPos = i
          break
        }
      }
      if (colonPos >= 0) {
        let metaBetween = afterDate.slice(0, colonPos).trim()
        if (/\(\s*objectif\s*\)/i.test(metaBetween)) {
          wasObjective = true
          metaBetween = metaBetween.replace(/\(\s*objectif\s*\)/gi, '').trim()
        }
        const metaComments = extractInlineComments(metaBetween)
        collectedNotes.push(...metaComments.notes)
        if (metaComments.cleaned) collectedNotes.push(metaComments.cleaned)
        working = afterDate.slice(colonPos + 1).trim()
      } else {
        working = afterDate
      }
    }
  }

  // 3. Extraction des commentaires entre parenthèses dans la partie séries
  const { cleaned: withoutParens, notes: inlineNotes } = extractInlineComments(working)
  collectedNotes.push(...inlineNotes)

  // 4. Découpage par blocs `|`
  const blocks = withoutParens.split('|')
  const sets: WorkoutSet[] = []

  for (const rawBlock of blocks) {
    let block = rawBlock.trim()
    if (!block) continue

    let explicitWarmup = false
    if (/(?:^|[\s,(])[eé]chauffements?(?=$|[\s,.)])|__WARMUP__/i.test(block)) {
      explicitWarmup = true
      block = block
        .replace(/(?:^|[\s,(])[eé]chauffements?(?=$|[\s,.)])/gi, ' ')
        .replace(/__WARMUP__/g, ' ')
        .trim()
    }

    // Cas poids de corps : "Poids de corps × 6" ou "PDC x 8"
    const pdcMatch = /^(?:poids\s+de\s+corps|poids\s+du\s+corps|pdc|bw)\s*[xX×*]\s*(.+)$/i.exec(
      block,
    )
    if (pdcMatch) {
      const { repsList, trailingNote } = parseRepsTokens(pdcMatch[1])
      if (trailingNote) collectedNotes.push(trailingNote)
      for (const r of repsList) {
        sets.push({
          weight: 0,
          reps: r.reps,
          ...(explicitWarmup ? { isWarmup: true } : {}),
          ...(r.failure ? { failure: true } : {}),
        })
      }
      continue
    }

    // Cas "1 rep" (ex: Traction : 1 rep)
    const singleRepMatch = /^(\d+)\s*reps?$/i.exec(block)
    if (singleRepMatch) {
      sets.push({ weight: 0, reps: Number(singleRepMatch[1]) })
      continue
    }

    // Cas standard : `[préfixe éventuel] <poids>[kg] x <reps>`
    const stdMatch = /^(.*?)\b(\d+(?:[.,]\d+)?)\s*(?:kg)?\s*[xX×*]\s*(.+)$/.exec(block)
    if (stdMatch) {
      const prefix = stdMatch[1].replace(/^[:",\s]+|[:",\s]+$/g, '').trim()
      if (prefix) collectedNotes.push(prefix)
      const weight = Number(stdMatch[2].replace(',', '.'))
      const { repsList, trailingNote } = parseRepsTokens(stdMatch[3])
      if (trailingNote) collectedNotes.push(trailingNote)
      for (const r of repsList) {
        sets.push({
          weight,
          reps: r.reps,
          ...(explicitWarmup ? { isWarmup: true } : {}),
          ...(r.failure ? { failure: true } : {}),
        })
      }
      continue
    }

    // Cas `x` omis après `kg` : `10kg 13` ou `20kg 15, 12`
    const noXMatch = /^(.*?)\b(\d+(?:[.,]\d+)?)\s*kg\s+(\d.*)$/i.exec(block)
    if (noXMatch) {
      const prefix = noXMatch[1].replace(/^[:",\s]+|[:",\s]+$/g, '').trim()
      if (prefix) collectedNotes.push(prefix)
      const weight = Number(noXMatch[2].replace(',', '.'))
      const { repsList, trailingNote } = parseRepsTokens(noXMatch[3])
      if (trailingNote) collectedNotes.push(trailingNote)
      for (const r of repsList) {
        sets.push({
          weight,
          reps: r.reps,
          ...(explicitWarmup ? { isWarmup: true } : {}),
          ...(r.failure ? { failure: true } : {}),
        })
      }
      continue
    }

    // Aucun motif de série reconnu dans ce bloc -> note
    const leftover = block.replace(/__FAIL__/g, 'échec').trim()
    if (leftover) collectedNotes.push(leftover)
  }

  const finalSets = markWarmupSets(sets)
  const cleanNote = collectedNotes
    .map((n) => n.replace(/^[:",\s]+|[:",\s]+$/g, '').trim())
    .filter(Boolean)
    .join(' · ')

  if (finalSets.length === 0) {
    return {
      id: createId('entry'),
      date,
      sets: [],
      restSeconds,
      note: cleanNote || rawLine.replace(/^[•\-*]\s*/, '').trim(),
      skipOnly: true,
    }
  }

  return {
    id: createId('entry'),
    date,
    sets: finalSets,
    restSeconds,
    ...(workSeconds ? { workSeconds } : {}),
    ...(sessionDurationSeconds ? { sessionDurationSeconds } : {}),
    note: cleanNote,
    ...(wasObjective ? { wasObjective: true } : {}),
  }
}

/* -------------------------------------------------------------------------- */
/* Parsing complet du bloc-notes                                              */
/* -------------------------------------------------------------------------- */

export interface ParseNotepadOptions {
  /** Si true, respecte un préambule volontairement vidé par l'utilisateur au lieu de réinjecter le défaut */
  preserveCustomPreamble?: boolean
}

export function parseNotepad(
  rawText: string,
  options: ParseNotepadOptions = {},
): ParsedNotepad {
  const rawLines = rawText.split(/\r?\n/)
  const preambleLines: string[] = []
  const exercises: Exercise[] = []

  let preambleDone = false
  let currentSection: SectionId = 'up'
  let currentExercise: Exercise | null = null
  let inArchivedBlock = false
  let pendingBulletLines: { exercise: Exercise; text: string }[] = []

  const flushBullets = () => {
    for (const item of pendingBulletLines) {
      const entry = parseEntryLine(item.text)
      item.exercise.entries.push(entry)
    }
    pendingBulletLines = []
  }

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim()

    if (!trimmed) {
      if (!preambleDone) preambleLines.push('')
      continue
    }

    const sec = detectSectionHeader(trimmed)
    if (sec !== null) {
      flushBullets()
      preambleDone = true
      currentSection = sec
      currentExercise = null
      inArchivedBlock = false
      continue
    }

    const header = matchExerciseHeader(trimmed, preambleDone)
    if (header !== null) {
      flushBullets()
      preambleDone = true
      if (header.sectionOverride) currentSection = header.sectionOverride
      inArchivedBlock = Boolean(header.archived)

      const meta = inferExerciseMeta(header.name)
      const ex: Exercise = {
        id: `ex-${normalizeName(header.name).replace(/\s+/g, '-')}`,
        name: header.name,
        normalizedName: normalizeName(header.name),
        section: currentSection,
        category: meta.category,
        repRange: meta.repRange,
        weightStep: meta.weightStep,
        unit: meta.unit,
        defaultRestSeconds: meta.defaultRestSeconds,
        active: !header.archived,
        ...(header.archived ? { archived: true } : {}),
        entries: [],
      }
      exercises.push(ex)
      currentExercise = ex

      if (header.inlineRest) {
        pendingBulletLines.push({ exercise: ex, text: header.inlineRest })
        flushBullets()
      }
      continue
    }

    if (!preambleDone) {
      preambleLines.push(rawLine)
      continue
    }

    if (currentExercise) {
      let lineContent = trimmed
      if (inArchivedBlock && lineContent.endsWith(')')) {
        // Vérifie si la dernière parenthèse ferme le bloc `(Shoulder press : ... )`
        const opens = (lineContent.match(/\(/g) ?? []).length
        const closes = (lineContent.match(/\)/g) ?? []).length
        if (closes > opens) {
          lineContent = lineContent.slice(0, -1).trim()
          inArchivedBlock = false
        }
      }

      if (/^[•\-*]/.test(lineContent)) {
        pendingBulletLines.push({ exercise: currentExercise, text: lineContent })
      } else if (pendingBulletLines.length > 0) {
        // Ligne coupée au milieu d'une entrée (ex: `(9eme \nCompliqué)`)
        pendingBulletLines[pendingBulletLines.length - 1].text += ` ${lineContent}`
      } else {
        pendingBulletLines.push({ exercise: currentExercise, text: lineContent })
      }
    }
  }

  flushBullets()

  // Post-traitement :
  // 1. Met à jour `defaultRestSeconds` depuis l'entrée la plus récente qui a un repos explicite
  // 2. Active uniquement les exercices ayant des dates récentes dans une section si cette section
  //    contient des exercices datés (garde les anciens tests d'exercices sans date en secondaires).
  for (const section of ['up', 'legs'] as SectionId[]) {
    const sectionExercises = exercises.filter((e) => e.section === section)
    const hasDatedExercises = sectionExercises.some((e) =>
      e.entries.some((entry) => entry.date !== null && !entry.skipOnly),
    )

    for (const ex of sectionExercises) {
      const recentWithRest = ex.entries.find((e) => e.restSeconds !== null && e.restSeconds > 0)
      if (recentWithRest?.restSeconds) {
        ex.defaultRestSeconds = recentWithRest.restSeconds
      }

      if (ex.archived) {
        ex.active = false
      } else if (hasDatedExercises) {
        ex.active =
          ex.entries.length === 0 ||
          ex.entries.some((entry) => entry.date !== null && !entry.skipOnly)
      }
    }
  }

  const rawPreamble = preambleLines.join('\n').trim()
  const preamble = options.preserveCustomPreamble
    ? rawPreamble
    : rawPreamble || DEFAULT_NOTEPAD_PREAMBLE

  return { preamble, exercises }
}

/**
 * Détecte si un texte collé est uniquement de la prose libre non structurée
 * (zéro série reconnue par le parseur déterministe) et nécessite l'extraction IA.
 * Ne bloque jamais un vrai fichier .txt contenant déjà des exercices et séries valides.
 */
export function hasUnrecognizedWorkoutText(
  rawText: string,
  parsed: ParsedNotepad = parseNotepad(rawText),
): boolean {
  const trimmed = rawText.trim()
  if (!trimmed) return false

  if (parsed.exercises.length === 0) {
    return true
  }

  const totalRealEntries = parsed.exercises.reduce(
    (sum, ex) => sum + ex.entries.filter((e) => !e.skipOnly && e.sets.length > 0).length,
    0,
  )

  // Si aucune série valide n'a été reconnue alors que les blocs contiennent du texte brut
  if (totalRealEntries === 0 && parsed.exercises.some((ex) => ex.entries.length > 0)) {
    return true
  }

  return false
}

/* -------------------------------------------------------------------------- */
/* Formatage / Export vers le format exact du bloc-notes                      */
/* -------------------------------------------------------------------------- */

export function formatSetsForNotepad(sets: readonly WorkoutSet[], unit: Unit): string {
  if (sets.length === 0) return ''

  // Regroupe les séries consécutives de même poids (et même statut warmup)
  const groups: { weight: number; isWarmup: boolean; reps: { val: number; failure?: boolean }[] }[] =
    []

  for (const set of sets) {
    const prev = groups[groups.length - 1]
    if (prev && prev.weight === set.weight && prev.isWarmup === Boolean(set.isWarmup)) {
      prev.reps.push({ val: set.reps, failure: set.failure })
    } else {
      groups.push({
        weight: set.weight,
        isWarmup: Boolean(set.isWarmup),
        reps: [{ val: set.reps, failure: set.failure }],
      })
    }
  }

  return groups
    .map((group) => {
      const weightLabel =
        unit === 'bodyweight' && group.weight === 0
          ? 'Poids de corps'
          : `${formatNumberFr(group.weight)}kg`
      const repsLabel = group.reps
        .map((r) => {
          const numStr = Number.isInteger(r.val)
            ? String(r.val)
            : String(Math.round(r.val * 100) / 100)
          return `${numStr}${r.failure ? ' (échec)' : ''}`
        })
        .join(', ')
      return `${weightLabel} x ${repsLabel}`
    })
    .join(' | ')
}

export function formatSetsForDisplay(sets: readonly WorkoutSet[], unit: Unit): string {
  if (sets.length === 0) return ''

  const groups: {
    weight: number
    isWarmup: boolean
    reps: { val: number; failure?: boolean }[]
  }[] = []

  for (const set of sets) {
    const prev = groups[groups.length - 1]
    if (prev && prev.weight === set.weight && prev.isWarmup === Boolean(set.isWarmup)) {
      prev.reps.push({ val: set.reps, failure: set.failure })
    } else {
      groups.push({
        weight: set.weight,
        isWarmup: Boolean(set.isWarmup),
        reps: [{ val: set.reps, failure: set.failure }],
      })
    }
  }

  return groups
    .map((group) => {
      const weightLabel =
        unit === 'bodyweight' && group.weight === 0
          ? 'PDC'
          : group.weight <= 0 && unit === 'kg'
            ? '? kg'
            : `${formatNumberFr(group.weight)} kg`
      const repsLabel = group.reps
        .map((r) => `${formatNumberFr(r.val)}${r.failure ? ' (échec)' : ''}`)
        .join(', ')
      const prefix = group.isWarmup ? 'éch. ' : ''
      return `${prefix}${weightLabel} × ${repsLabel}`
    })
    .join(' · ')
}

export function formatEntryForNotepad(entry: ExerciseEntry, unit: Unit): string {
  if (entry.skipOnly) {
    return `• ${entry.note}`
  }
  const datePart = entry.date ? `${formatIsoToFr(entry.date)} : ` : ''
  const setsPart = formatSetsForNotepad(entry.sets, unit)
  const notePart = entry.note ? ` (${entry.note})` : ''
  const restPart = entry.restSeconds ? ` (repos : ${formatRestDuration(entry.restSeconds)})` : ''
  const workPart = entry.workSeconds ? ` (exo : ${formatRestDuration(entry.workSeconds)})` : ''
  const sessionPart = entry.sessionDurationSeconds
    ? ` (séance : ${formatRestDuration(entry.sessionDurationSeconds)})`
    : ''
  return `• ${datePart}${setsPart}${notePart}${restPart}${workPart}${sessionPart}`
}

export function formatPlanLineForNotepad(params: {
  dateIso: string
  sets: { weight: number; repsMin: number; repsMax: number; isWarmup?: boolean }[]
  restSeconds: number
  unit: Unit
}): string {
  const { dateIso, sets, restSeconds, unit } = params
  const groups: {
    weight: number
    isWarmup: boolean
    repsLabels: string[]
  }[] = []

  for (const s of sets) {
    const repLabel =
      s.repsMin === s.repsMax ? `${formatNumberFr(s.repsMin)}` : `${s.repsMin}-${s.repsMax}`
    const prev = groups[groups.length - 1]
    if (prev && prev.weight === s.weight && prev.isWarmup === Boolean(s.isWarmup)) {
      prev.repsLabels.push(repLabel)
    } else {
      groups.push({
        weight: s.weight,
        isWarmup: Boolean(s.isWarmup),
        repsLabels: [repLabel],
      })
    }
  }

  const setsStr = groups
    .map((g) => {
      const w =
        unit === 'bodyweight' && g.weight === 0 ? 'Poids de corps' : `${formatNumberFr(g.weight)}kg`
      return `${w} x ${g.repsLabels.join(', ')}`
    })
    .join(' | ')

  const restPart = restSeconds > 0 ? ` (repos : ${formatRestDuration(restSeconds)})` : ''
  return `• ${formatIsoToFr(dateIso)} (Objectif) : ${setsStr}${restPart}`
}

export function exportNotepad(params: {
  preamble: string
  exercises: readonly Exercise[]
  plan?: CoachSessionPlan | null
  planDateIso?: string
  includeObjectives?: boolean
}): string {
  const { preamble, exercises, plan, planDateIso, includeObjectives = true } = params
  const trimmedPreamble = preamble.trim()
  const lines: string[] = trimmedPreamble ? [trimmedPreamble, '', ''] : []

  const upExercises = exercises.filter((e) => e.section === 'up')
  const legsExercises = exercises.filter((e) => e.section === 'legs')

  const renderExerciseBlock = (ex: Exercise, isFirstUp: boolean) => {
    const prefix = isFirstUp ? 'Up ' : ''
    if (ex.archived) {
      lines.push(ex.entries.length === 0 ? `(${ex.name} :)` : `(${ex.name} :`)
    } else {
      lines.push(`${prefix}${ex.name} :`)
    }

    if (
      includeObjectives &&
      plan &&
      planDateIso &&
      plan.section === ex.section &&
      ex.active &&
      plan.exercises[ex.id]
    ) {
      const exPlan = plan.exercises[ex.id]
      lines.push(
        formatPlanLineForNotepad({
          dateIso: planDateIso,
          sets: exPlan.sets,
          restSeconds: exPlan.restSeconds,
          unit: ex.unit,
        }),
      )
    }

    ex.entries.forEach((entry, idx) => {
      const formatted = formatEntryForNotepad(entry, ex.unit)
      const isLastArchived = ex.archived && idx === ex.entries.length - 1
      lines.push(isLastArchived ? `${formatted})` : formatted)
    })

    lines.push('')
  }

  upExercises.forEach((ex, index) => renderExerciseBlock(ex, index === 0))

  lines.push('Jambes (Legs)', '')
  legsExercises.forEach((ex) => renderExerciseBlock(ex, false))

  return lines.join('\n').trimEnd() + '\n'
}
