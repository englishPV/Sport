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

/** Extrait la durée de repos éventuelle et retourne le texte nettoyé (avec marqueur de position). */
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
      return ' __META_TAG__ '
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
    return ' __META_TAG__ '
  })
  cleaned = cleaned.replace(secOnlyRe, (_m, a: string) => {
    seconds = Number(a)
    return ' __META_TAG__ '
  })

  return { cleaned: cleaned.trim(), seconds }
}

/**
 * Extrait les commentaires entre parenthèses (y compris imbriqués ou parenthèses
 * non fermées avant `, <reps>`), conserve `__FAIL__` pour `(échec)` et `__WARMUP__`
 * pour `(échauffement)`, et peut laisser des jetons `__NOTE_i__` à l'endroit exact
 * où le commentaire a été écrit.
 */
function extractInlineComments(
  input: string,
  keepPlaceholders = false,
): { cleaned: string; notes: string[] } {
  const notes: string[] = []

  const text = input
    .replace(/\(\s*[eé]chec\s*\)/gi, ' __FAIL__ ')
    .replace(/\(\s*[eé]chauffement\s*\)/gi, ' __WARMUP__ ')

  const pushNote = (rawNote: string): string => {
    const trimmed = rawNote.trim()
    if (!trimmed) return ' '
    const idx = notes.length
    notes.push(trimmed)
    return keepPlaceholders ? ` __NOTE_${idx}__ ` : ' '
  }

  let out = ''
  let i = 0
  while (i < text.length) {
    if (text[i] !== '(') {
      out += text[i]
      i += 1
      continue
    }

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
      out += pushNote(text.slice(i + 1, typoSplitAt))
      i = typoSplitAt + 1
      continue
    }

    if (depth === 0) {
      out += pushNote(text.slice(i + 1, j - 1))
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
      out += `${pushNote(trailingRepsMatch[1])} ${trailingRepsMatch[2]}`
    } else {
      out += pushNote(unclosed)
    }
    break
  }

  return { cleaned: out.replace(/\s+/g, ' ').trim(), notes }
}

function expandNoteTokens(
  text: string,
  noteTable: readonly string[],
): { expanded: string; plainOnly: string } {
  const plainOnly = text
    .replace(/__NOTE_\d+__/g, ' ')
    .replace(/__(?:FAIL|WARMUP|META_TAG)__/g, ' ')
    .replace(/^[:",\s]+|[:",\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  const pieces: string[] = []
  const tokenRe = /__NOTE_(\d+)__/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = tokenRe.exec(text)) !== null) {
    const before = text
      .slice(last, m.index)
      .replace(/__(?:FAIL|WARMUP|META_TAG)__/g, ' ')
      .replace(/^[:",\s]+|[:",\s]+$/g, '')
      .trim()
    if (before) pieces.push(before)
    const note = noteTable[Number(m[1])]
    if (note) pieces.push(note)
    last = tokenRe.lastIndex
  }
  const after = text
    .slice(last)
    .replace(/__(?:FAIL|WARMUP|META_TAG)__/g, ' ')
    .replace(/^[:",\s]+|[:",\s]+$/g, '')
    .trim()
  if (after) pieces.push(after)

  return { expanded: pieces.join(' · '), plainOnly }
}

function parseRepsTokens(
  rawReps: string,
  noteTable: readonly string[] = [],
): {
  repsList: { reps: number; failure?: boolean; note?: string }[]
  orphanNotes: string[]
  plainExtraNotes: string[]
} {
  const repsList: { reps: number; failure?: boolean; note?: string }[] = []
  const orphanNotes: string[] = []
  const plainExtraNotes: string[] = []

  // Normalise "11,5" collé sans espace (demi-rep), "8ou9" -> "8.5", "12-13" ou "12/13" -> 12
  const normalized = rawReps
    .replace(/(\d+),5\b/g, '$1.5')
    .replace(/(\d+)\s*ou\s*(\d+)/gi, (_m, a: string, b: string) =>
      String((Number(a) + Number(b)) / 2),
    )
    .replace(/(\d+)\s*-\s*(\d+)/g, (_m, a: string, b: string) =>
      String(Math.floor((Number(a) + Number(b)) / 2)),
    )
    .replace(/(^|,\s*)(\d+)\s*\/\s*(\d+)(?=$|[\s,])/g, (_m, lead: string, a: string, b: string) =>
      `${lead}${Math.floor((Number(a) + Number(b)) / 2)}`,
    )

  const appendSetNote = (targetIdx: number, noteText: string) => {
    const clean = noteText.trim()
    if (!clean) return
    if (targetIdx >= 0 && targetIdx < repsList.length) {
      const prev = repsList[targetIdx].note
      repsList[targetIdx].note = prev ? `${prev} · ${clean}` : clean
    } else {
      orphanNotes.push(clean)
    }
  }

  const commaParts = normalized.split(',')
  for (const part of commaParts) {
    const trimmed = part.trim()
    if (!trimmed) continue

    // Jeton : soit un nombre de reps (avec éventuel __FAIL__), soit un commentaire __NOTE_k__
    const itemRegex = /__NOTE_(\d+)__|(\d+(?:[.,]\d+)?)(\s*__FAIL__)?/g
    let match: RegExpExecArray | null
    let lastEnd = 0
    let foundRepInSegment = false

    while ((match = itemRegex.exec(trimmed)) !== null) {
      const before = trimmed
        .slice(lastEnd, match.index)
        .replace(/__(?:FAIL|WARMUP|META_TAG)__/g, ' ')
        .trim()

      // Si du texte libre s'intercale avant un nombre (ex: "c'est beaucoup plus simple avec ce réglage"), on s'arrête
      if (before && /[a-zA-ZÀ-ÿ]/.test(before)) {
        const restRaw = trimmed.slice(lastEnd)
        const { expanded, plainOnly } = expandNoteTokens(restRaw, noteTable)
        if (plainOnly && plainOnly !== '.' && !/^reps?$/i.test(plainOnly)) {
          plainExtraNotes.push(plainOnly)
        }
        appendSetNote(repsList.length - 1, expanded)
        lastEnd = trimmed.length
        break
      }

      if (match[1] !== undefined) {
        const noteContent = noteTable[Number(match[1])] ?? ''
        appendSetNote(repsList.length - 1, noteContent)
      } else if (match[2] !== undefined) {
        const val = Number(match[2].replace(',', '.'))
        if (Number.isFinite(val) && val > 0 && val <= 200) {
          repsList.push({
            reps: val,
            ...(match[3] ? { failure: true } : {}),
          })
          foundRepInSegment = true
        }
      }
      lastEnd = itemRegex.lastIndex
    }

    const tail = trimmed
      .slice(lastEnd)
      .replace(/__(?:FAIL|WARMUP|META_TAG)__/g, '')
      .trim()
    if (tail && tail !== '.' && !/^reps?$/i.test(tail)) {
      const { expanded, plainOnly } = expandNoteTokens(tail, noteTable)
      if (plainOnly && plainOnly !== '.' && !/^reps?$/i.test(plainOnly)) {
        plainExtraNotes.push(plainOnly)
      }
      if (foundRepInSegment) {
        appendSetNote(repsList.length - 1, expanded)
      } else {
        orphanNotes.push(expanded)
      }
    }
  }

  return {
    repsList,
    orphanNotes,
    plainExtraNotes,
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
  let working = rawLine
    .replace(/^[•\-*]\s*/, '')
    .replace(/^\[[ xX]?\]\s*/, '')
    .trim()
  const entryLevelNotes: string[] = []
  const allNotesForEntry: string[] = []
  let wasObjective = false
  let date: string | null = null

  const pushEntryNote = (n: string) => {
    const clean = n.replace(/^[:",\s]+|[:",\s]+$/g, '').trim()
    if (!clean || /^[():,;-]+$/.test(clean)) return
    entryLevelNotes.push(clean)
    allNotesForEntry.push(clean)
  }

  const pushAllOnlyNote = (n: string) => {
    const clean = n.replace(/^[:",\s]+|[:",\s]+$/g, '').trim()
    if (!clean || /^[():,;-]+$/.test(clean)) return
    allNotesForEntry.push(clean)
  }

  // 1. Extraction des durées (repos, exo, séance) avec marqueur de position __META_TAG__
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
        let metaBetween = afterDate
          .slice(0, colonPos)
          .replace(/__META_TAG__/g, ' ')
          .trim()
        if (/\(\s*objectif\s*\)/i.test(metaBetween)) {
          wasObjective = true
          metaBetween = metaBetween.replace(/\(\s*objectif\s*\)/gi, '').trim()
        }
        const metaComments = extractInlineComments(metaBetween, false)
        for (const n of metaComments.notes) pushEntryNote(n)
        if (metaComments.cleaned) pushEntryNote(metaComments.cleaned)
        working = afterDate.slice(colonPos + 1).trim()
      } else {
        working = afterDate
      }
    }
  }

  // 3. Sépare les éventuels commentaires de fin de ligne écrits APRÈS `(repos : ...)`
  let setsZone = working
  const metaPos = working.indexOf('__META_TAG__')
  if (metaPos >= 0) {
    const beforeMeta = working.slice(0, metaPos).trim()
    const afterMeta = working
      .slice(metaPos)
      .replace(/__META_TAG__/g, ' ')
      .trim()
    if (
      beforeMeta &&
      /\d/.test(beforeMeta) &&
      afterMeta &&
      !/\d+(?:[.,]\d+)?\s*(?:kg)?\s*[xX×*]/i.test(afterMeta)
    ) {
      const trailing = extractInlineComments(afterMeta, false)
      for (const n of trailing.notes) pushEntryNote(n)
      if (trailing.cleaned) pushEntryNote(trailing.cleaned)
      setsZone = beforeMeta
    }
  }
  setsZone = setsZone.replace(/__META_TAG__/g, ' ').trim()

  // 4. Tokenisation positionnelle des commentaires entre parenthèses dans la zone séries
  const { cleaned: tokenizedSets, notes: inlineNotes } = extractInlineComments(setsZone, true)
  for (const n of inlineNotes) pushAllOnlyNote(n)

  // 5. Découpage par blocs `|`
  const blocks = tokenizedSets.split('|')
  const sets: WorkoutSet[] = []

  const pushSetGroup = (
    weight: number,
    repsList: { reps: number; failure?: boolean; note?: string }[],
    prefixNote: string,
    orphanNotes: string[],
    warmup: boolean,
  ) => {
    const cleanPrefix = prefixNote.replace(/\s*·\s*$/, '').trim()
    const cleanOrphans = orphanNotes.map((n) => n.trim()).filter(Boolean)

    repsList.forEach((r, idx) => {
      const parts: string[] = []
      if (idx === 0 && cleanPrefix) parts.push(cleanPrefix)
      if (r.note) parts.push(r.note)
      if (idx === repsList.length - 1 && cleanOrphans.length > 0) {
        parts.push(...cleanOrphans)
      }
      const note = parts.join(' · ').trim()
      sets.push({
        weight,
        reps: r.reps,
        ...(warmup ? { isWarmup: true } : {}),
        ...(r.failure ? { failure: true } : {}),
        ...(note ? { note } : {}),
      })
    })
  }

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

    // Déplace un commentaire intercalé entre `<poids>kg` et `x <reps>` (ex: `14kg (pas trouvé 10) x 12`)
    block = block.replace(
      /(\b\d+(?:[.,]\d+)?\s*(?:kg)?)\s+((?:__NOTE_\d+__\s*)+)(?=[xX×*\d])/gi,
      '$2 $1 ',
    )

    // Cas poids de corps : "Poids de corps × 6" ou "PDC x 8"
    const pdcMatch = /^(.*?)(?:poids\s+de\s+corps|poids\s+du\s+corps|pdc|bw)\s*[xX×*]\s*(.+)$/i.exec(
      block,
    )
    if (pdcMatch) {
      const { expanded: prefixExpanded, plainOnly } = expandNoteTokens(pdcMatch[1], inlineNotes)
      if (plainOnly) pushAllOnlyNote(plainOnly)
      const { repsList, orphanNotes, plainExtraNotes } = parseRepsTokens(pdcMatch[2], inlineNotes)
      for (const n of plainExtraNotes) pushAllOnlyNote(n)
      pushSetGroup(0, repsList, prefixExpanded, orphanNotes, explicitWarmup)
      continue
    }

    // Cas "1 rep" (ex: Traction : 1 rep)
    const singleRepMatch = /^(\d+)\s*reps?((?:\s*__NOTE_\d+__)*)$/i.exec(block)
    if (singleRepMatch) {
      const { expanded } = expandNoteTokens(singleRepMatch[2] ?? '', inlineNotes)
      sets.push({
        weight: 0,
        reps: Number(singleRepMatch[1]),
        ...(expanded ? { note: expanded } : {}),
      })
      continue
    }

    // Cas standard : `[préfixe éventuel] <poids>[kg] x <reps>`
    const stdMatch = /^(.*?)\b(\d+(?:[.,]\d+)?)\s*(?:kg)?\s*[xX×*]\s*(.+)$/.exec(block)
    if (stdMatch) {
      const { expanded: prefixExpanded, plainOnly } = expandNoteTokens(stdMatch[1], inlineNotes)
      if (plainOnly) pushAllOnlyNote(plainOnly)
      const weight = Number(stdMatch[2].replace(',', '.'))
      const { repsList, orphanNotes, plainExtraNotes } = parseRepsTokens(stdMatch[3], inlineNotes)
      for (const n of plainExtraNotes) pushAllOnlyNote(n)
      pushSetGroup(weight, repsList, prefixExpanded, orphanNotes, explicitWarmup)
      continue
    }

    // Cas `x` omis après `kg` : `10kg 13` ou `20kg 15, 12`
    const noXMatch = /^(.*?)\b(\d+(?:[.,]\d+)?)\s*kg\s+(\d.*)$/i.exec(block)
    if (noXMatch) {
      const { expanded: prefixExpanded, plainOnly } = expandNoteTokens(noXMatch[1], inlineNotes)
      if (plainOnly) pushAllOnlyNote(plainOnly)
      const weight = Number(noXMatch[2].replace(',', '.'))
      const { repsList, orphanNotes, plainExtraNotes } = parseRepsTokens(noXMatch[3], inlineNotes)
      for (const n of plainExtraNotes) pushAllOnlyNote(n)
      pushSetGroup(weight, repsList, prefixExpanded, orphanNotes, explicitWarmup)
      continue
    }

    // Aucun motif de série reconnu dans ce bloc -> note d'entrée
    const leftoverRaw = block.replace(/__FAIL__/g, 'échec')
    const { expanded, plainOnly } = expandNoteTokens(leftoverRaw, inlineNotes)
    if (plainOnly) pushAllOnlyNote(plainOnly)
    if (expanded) entryLevelNotes.push(expanded)
  }

  const markedSets = markWarmupSets(sets)
  const finalSets = attributeEntryNotesToSets(markedSets, entryLevelNotes)

  const seenNotes = new Set<string>()
  const dedupedNotes: string[] = []
  for (const n of allNotesForEntry) {
    const clean = n.replace(/^[:",\s]+|[:",\s]+$/g, '').trim()
    if (!clean || /^[():,;-]+$/.test(clean)) continue
    if (!seenNotes.has(clean)) {
      seenNotes.add(clean)
      dedupedNotes.push(clean)
    }
  }
  const cleanNote = dedupedNotes.join(' · ')

  if (finalSets.length === 0) {
    const fallbackRaw = rawLine.replace(/^[•\-*]\s*/, '').trim()
    const hasStructuredHeader = date !== null || restSeconds !== null || workSeconds !== null
    return {
      id: createId('entry'),
      date,
      sets: [],
      restSeconds,
      note: cleanNote || (hasStructuredHeader ? '' : fallbackRaw),
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
  /** Date du jour (YYYY-MM-DD) : les lignes « (Objectif) » antérieures deviennent des séances faites */
  todayIso?: string
}

/**
 * Rattache uniquement les notes globales d'entrée (en-tête avant `:`, bloc libre ou commentaire
 * écrit en fin de ligne après `(repos : …)`) aux séries de travail encore muettes.
 * Les commentaires écrits directement à côté d'une série (y compris d'échauffement) y sont déjà posés.
 */
const CONTEXT_ONLY_NOTE =
  /^(?:repos\b|r[eé]cup|s[eé]ance\b|exo\b|exercice\b|[eé]chauffements?\b|objectif\b|aujourd|duree|dur[ée]e\b)/i

function attributeEntryNotesToSets(
  sets: WorkoutSet[],
  entryLevelNotes: readonly string[],
): WorkoutSet[] {
  if (entryLevelNotes.length === 0 || sets.length === 0) return sets
  const comments = entryLevelNotes
    .flatMap((part) => part.split(/\s*[|·]\s*/))
    .map((part) => part.trim())
    .filter((part) => Boolean(part) && !CONTEXT_ONLY_NOTE.test(part))
  if (comments.length === 0) return sets

  const workIdx = sets
    .map((set, idx) => (set.isWarmup ? -1 : idx))
    .filter((idx) => idx >= 0)
  if (workIdx.length === 0) return sets

  const cleaned = [...sets]
  const silent = workIdx.filter((idx) => !(cleaned[idx].note ?? '').trim())
  comments.forEach((comment, i) => {
    const target =
      silent[i] ??
      (silent[silent.length - 1] ?? workIdx[workIdx.length - 1])
    const set = cleaned[target]
    const previous = (set.note ?? '').trim()
    cleaned[target] = { ...set, note: previous ? `${previous} · ${comment}` : comment }
  })
  return cleaned
}

const PASTED_PREAMBLE_PROSE_RE =
  /^(?:aujourd['’]hui,\s*c['’]est\s+soit|r[eè]gle\s+(?:de\s+s[eé]lection|d['’]or)|format\s+d['’]ex[eé]cution|je\s+mesure\s+\d\s*m\s*\d{2}|pour\s+chaque\s+exercice|enl[eè]ve\s+les\s*\(\s*objectif\s*\)|\d+\.\s+(?:exercices\s+actifs|r[eé]dige\s+la\s+s[eé]ance|g[eé]n[eè]re\s+la\s+s[eé]ance|dans\s+ce\s+bloc))/i

export function parseNotepad(
  rawText: string,
  options: ParseNotepadOptions = {},
): ParsedNotepad {
  const rawLines = rawText.split(/\r?\n/)
  const preambleLines: string[] = []
  let exercises: Exercise[] = []

  let preambleDone = false
  let currentSection: SectionId = 'up'
  let currentExercise: Exercise | null = null
  let inArchivedBlock = false
  let pendingBulletLines: { exercise: Exercise; text: string }[] = []

  const flushBullets = () => {
    for (const item of pendingBulletLines) {
      const entry = parseEntryLine(item.text)
      entry.raw = item.text
      item.exercise.entries.push(entry)
    }
    pendingBulletLines = []
  }

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim()

    // Ignore les balises de code Markdown ``` éventuelles autour d'un carnet collé
    if (/^```[a-zA-Z0-9_-]*\s*$/.test(trimmed)) {
      continue
    }

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

    // Si l'utilisateur colle son carnet complet en dessous d'un modèle déjà présent,
    // récupère les règles du préambule collé au lieu d'en faire des entrées d'exercice.
    if (PASTED_PREAMBLE_PROSE_RE.test(trimmed)) {
      preambleLines.push(rawLine)
      currentExercise = null
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

      // Case à cocher vide laissée par l'appli de notes (`- [ ]`, `- [x]`) : aucune donnée
      if (/^[•\-*]?\s*\[[ xX]?\]$/.test(lineContent)) continue

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

  // Si l'utilisateur a collé son vrai carnet à la suite d'un squelette vierge (ex: DEFAULT_NOTEPAD_TEXT),
  // retire le bloc vierge initial dès lors qu'au moins un exercice est dupliqué plus bas avec de vraies séries.
  const firstPopulatedIdx = exercises.findIndex((ex) =>
    ex.entries.some((e) => !e.skipOnly && e.sets.length > 0),
  )
  if (firstPopulatedIdx > 0) {
    const populatedNames = new Set(
      exercises
        .slice(firstPopulatedIdx)
        .filter((ex) => ex.entries.some((e) => !e.skipOnly && e.sets.length > 0))
        .map((ex) => ex.normalizedName),
    )
    const leadingEmpty = exercises.slice(0, firstPopulatedIdx)
    const hasDuplicateWithData = leadingEmpty.some((ex) => populatedNames.has(ex.normalizedName))
    if (hasDuplicateWithData) {
      exercises = exercises.slice(firstPopulatedIdx)
    }
  }

  // Déduplique aussi les identifiants si deux exercices portent le même nom normalisé
  const usedIds = new Map<string, number>()
  for (const ex of exercises) {
    const count = usedIds.get(ex.id) ?? 0
    if (count > 0) {
      ex.id = `${ex.id}-${count + 1}`
    }
    usedIds.set(ex.id.replace(/-\d+$/, ''), count + 1)
  }

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
      const recentWithRest =
        ex.entries.find((e) => !e.skipOnly && e.restSeconds !== null && e.restSeconds > 0) ??
        ex.entries.find((e) => e.restSeconds !== null && e.restSeconds > 0)
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

  const settled = options.todayIso ? settleObjectives(exercises, options.todayIso) : exercises

  const rawPreamble = preambleLines.join('\n').trim()
  const preamble = options.preserveCustomPreamble
    ? rawPreamble
    : rawPreamble || DEFAULT_NOTEPAD_PREAMBLE

  return { preamble, exercises: settled }
}

const OBJECTIVE_MARKER_RE = /\s*\(\s*objectif\s*\)/i

/**
 * Range les lignes « (Objectif) » :
 * - date passée -> séance réellement faite (le marqueur disparaît, la ligne reste intacte) ;
 * - même date qu'une séance déjà enregistrée -> simple plan devenu inutile, retiré ;
 * - aujourd'hui ou plus tard -> reste un objectif.
 */
export function settleObjectives(exercises: readonly Exercise[], todayIso: string): Exercise[] {
  return exercises.map((ex) => {
    if (!ex.entries.some((e) => e.wasObjective)) return ex
    const performedDates = new Set(
      ex.entries
        .filter((e) => !e.wasObjective && !e.skipOnly && e.sets.length > 0 && e.date)
        .map((e) => e.date),
    )
    const entries: ExerciseEntry[] = []
    for (const entry of ex.entries) {
      if (!entry.wasObjective || !entry.date) {
        entries.push(entry)
      } else if (performedDates.has(entry.date)) {
        continue
      } else if (entry.date < todayIso) {
        const done: ExerciseEntry = { ...entry }
        delete done.wasObjective
        if (done.raw) done.raw = done.raw.replace(OBJECTIVE_MARKER_RE, '')
        entries.push(done)
      } else {
        entries.push(entry)
      }
    }
    return { ...ex, entries }
  })
}

/** Lit « Je mesure 1m84 pour 72kg » dans le préambule pour renseigner le profil. */
export function inferProfileFromPreamble(
  preamble: string,
): { heightCm: number; weightKg: number } | null {
  const match = /(\d)\s*m\s*(\d{2})\b[^\n]*?(\d{2,3}(?:[.,]\d)?)\s*kg/i.exec(preamble)
  if (!match) return null
  const heightCm = Number(match[1]) * 100 + Number(match[2])
  const weightKg = Number(match[3].replace(',', '.'))
  if (heightCm < 120 || heightCm > 230 || weightKg < 30 || weightKg > 250) return null
  return { heightCm, weightKg }
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
  const groups: {
    weight: number
    isWarmup: boolean
    reps: { val: number; failure?: boolean; note?: string }[]
  }[] = []

  for (const set of sets) {
    const prev = groups[groups.length - 1]
    if (prev && prev.weight === set.weight && prev.isWarmup === Boolean(set.isWarmup)) {
      prev.reps.push({ val: set.reps, failure: set.failure, note: set.note })
    } else {
      groups.push({
        weight: set.weight,
        isWarmup: Boolean(set.isWarmup),
        reps: [{ val: set.reps, failure: set.failure, note: set.note }],
      })
    }
  }

  return groups
    .map((group) => {
      const base =
        unit === 'bodyweight' && group.weight === 0
          ? 'Poids de corps'
          : `${formatNumberFr(group.weight)}kg`
      // Sans le marqueur, une série d'échauffement relue depuis le carnet (export puis réimport)
      // repasserait pour une série de travail et fausserait la DDP.
      const weightLabel = group.isWarmup ? `${base} (échauffement)` : base
      const repsLabel = group.reps
        .map((r) => {
          const numStr = Number.isInteger(r.val)
            ? String(r.val)
            : String(Math.round(r.val * 100) / 100)
          const note = (r.note ?? '').replace(/[()|\s]+/g, ' ').trim()
          return `${numStr}${r.failure ? ' (échec)' : ''}${note ? ` (${note})` : ''}`
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
  if (entry.raw) {
    // Ligne venue du bloc-notes : réécrite telle quelle, seule la puce est normalisée.
    return `• ${entry.raw.replace(/^[•\-*]\s*/, '').trim()}`
  }
  if (entry.skipOnly) {
    return entry.note ? `• ${entry.note}` : '•'
  }
  const datePart = entry.date ? `${formatIsoToFr(entry.date)}${entry.wasObjective ? ' (Objectif)' : ''} : ` : ''
  const setsPart = formatSetsForNotepad(entry.sets, unit)
  const notePart = entry.note ? ` (${entry.note})` : ''
  const restPart = entry.restSeconds ? ` (repos : ${formatRestDuration(entry.restSeconds)})` : ''
  const workPart = entry.workSeconds ? ` (exo : ${formatRestDuration(entry.workSeconds)})` : ''
  const sessionPart = entry.sessionDurationSeconds
    ? ` (séance : ${formatRestDuration(entry.sessionDurationSeconds)})`
    : ''
  return `• ${datePart}${setsPart}${restPart}${workPart}${sessionPart}${notePart}`
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
      // Une échauffement reste marqué, sinon la ligne objectif se relit comme une série de travail.
      return `${w}${g.isWarmup ? ' (échauffement)' : ''} x ${g.repsLabels.join(', ')}`
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

    const alreadyHasSameObjective = Boolean(
      planDateIso && ex.entries.some((e) => e.wasObjective && e.date === planDateIso),
    )

    if (
      includeObjectives &&
      !alreadyHasSameObjective &&
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
