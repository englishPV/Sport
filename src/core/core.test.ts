import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_NOTEPAD_TEXT } from './defaultNotepad'

const TEST_VERTEX_KEY = 'AQ.TestVertexExpressDummyKey0000'
import {
  exportNotepad,
  hasUnrecognizedWorkoutText,
  parseEntryLine,
  parseNotepad,
} from './parser'
import { buildDdpSessionPlan, computeExerciseDdpPlan, getRecommendedSection } from './ddp'
import {
  analyzeStatsWithGemini,
  buildCoachPromptForSection,
  buildEndpointUrl,
  detectApiProvider,
  extractAthleteRulesFromPreamble,
  GEMINI_MODEL,
  GEMINI_THINKING_LEVEL,
  generateGeminiSessionPlan,
  isGeminiPlanFresh,
  parseWorkoutTextWithGemini,
  resetGeminiClientState,
  sanitizeApiKey,
  testGeminiConnection,
} from './gemini'
import {
  computeSetRestDuration,
  formatMinutesAndSecondsFr,
  getOptimalExtraRestSeconds,
} from './restScience'
import {
  buildEnrichedChronology,
  computeSmartExerciseInsight,
  getLatestBestSetSummary,
  getLatestRecordInfo,
} from './statsEngine'
import { buildStatsReport } from './statsReport'

describe('parseNotepad sur le vrai bloc-notes utilisateur', () => {
  const parsed = parseNotepad(DEFAULT_NOTEPAD_TEXT)

  afterEach(() => {
    resetGeminiClientState()
    vi.unstubAllGlobals()
  })

  it('conserve le préambule DDP intact', () => {
    expect(parsed.preamble).toContain('RÈGLE SCIENTIFIQUE DE CHARGE')
    expect(parsed.preamble).toContain('Je mesure 1m84 pour 72kg')
  })

  it('extrait tous les exercices Up et Jambes sans perte', () => {
    const upActive = parsed.exercises.filter((e) => e.section === 'up' && e.active)
    const legsActive = parsed.exercises.filter((e) => e.section === 'legs' && e.active)

    expect(upActive.map((e) => e.name)).toEqual([
      'Développé incliné haltères',
      'Tirage vertical',
      'Chest press (machine)',
      'Tirage horizontal (poulie basse)',
      'Élévations latérales aux haltères',
      'Extensions Triceps à la poulie haute avec corde',
      'Curl Biceps Incliné aux haltères',
    ])

    expect(legsActive.map((e) => e.name)).toEqual([
      'Leg press',
      'Soulevé de Terre Roumain',
      'Leg extension',
      'Leg curl',
      'Machine assis (mollets)',
      'Total abdominaux (machine assis crunch vers le bas)',
    ])

    // Exercice entre parenthèses mis en pause
    const shoulder = parsed.exercises.find((e) => e.name === 'Shoulder press')
    expect(shoulder).toBeDefined()
    expect(shoulder?.archived).toBe(true)
    expect(shoulder?.active).toBe(false)
    expect(shoulder?.entries.length).toBe(8)
  })

  it('gère les cas complexes de lignes réelles (pipes, échec, demi-reps, parenthèses non fermées, multi-lignes)', () => {
    const devIncline = parsed.exercises.find((e) => e.name === 'Développé incliné haltères')!
    const latest = devIncline.entries[0]
    expect(latest.date).toBe('2026-10-22')
    expect(latest.restSeconds).toBe(150)
    expect(latest.sets).toEqual([
      { weight: 10, reps: 12, isWarmup: true },
      { weight: 22, reps: 10 },
      { weight: 20, reps: 12 },
      { weight: 20, reps: 8, failure: true },
    ])

    // Ligne coupée sur 2 lignes dans Tirage horizontal (08/10/2026)
    const tirageH = parsed.exercises.find((e) => e.name === 'Tirage horizontal (poulie basse)')!
    const oct08 = tirageH.entries.find((e) => e.date === '2026-10-08')!
    expect(oct08.sets.map((s) => `${s.weight}x${s.reps}`)).toEqual(['45x11', '45x9', '45x9'])
    expect(oct08.restSeconds).toBe(150)
    expect(oct08.note).toContain('Compliqué')

    // Demi-répétition 11.5 sur Extensions Triceps
    const triceps = parsed.exercises.find(
      (e) => e.name === 'Extensions Triceps à la poulie haute avec corde',
    )!
    expect(triceps.entries[0].sets[0]).toEqual({ weight: 15, reps: 11.5 })

    // `10kg (1 main par 1 main) 13` sans signe `x`
    const curl = parsed.exercises.find((e) => e.name === 'Curl Biceps Incliné aux haltères')!
    expect(curl.entries[0].sets.map((s) => `${s.weight}x${s.reps}`)).toEqual([
      '10x15',
      '10x10',
      '10x13',
    ])

    // Parenthèse non fermée avant `, 15 13` sur Mollets 12/10/2026
    const mollets = parsed.exercises.find((e) => e.name === 'Machine assis (mollets)')!
    const molletsOct12 = mollets.entries.find((e) => e.date === '2026-10-12')!
    expect(molletsOct12.sets.map((s) => `${s.weight}x${s.reps}`)).toEqual([
      '20x15',
      '30x13',
      '30x15',
      '30x13',
    ])

    // Parenthèse fautive `?(, 8` sur Leg extension
    const fixedTypo = parseEntryLine(
      '• 55kg x 12, 8 (j’ai respiré trop vite peut être j’allais faire un malaise, 2minutes trop peu?(, 8',
    )
    expect(fixedTypo.sets.map((s) => `${s.weight}x${s.reps}`)).toEqual(['55x12', '55x8', '55x8'])

    // `(échauffement)` explicite entre parenthèses sur la première séance de Leg press
    const legPress = parsed.exercises.find((e) => e.name === 'Leg press')!
    const oldestLegPress = legPress.entries[legPress.entries.length - 1]
    expect(oldestLegPress.sets[0]).toEqual({ weight: 50, reps: 12, isWarmup: true })
    expect(oldestLegPress.note).toBe('')
  })

  it('recommande JAMBES quand la dernière date enregistrée est Up (22/10 vs 21/10)', () => {
    const skips = parsed.exercises.flatMap((ex) =>
      ex.entries.filter((e) => e.skipOnly).map((e) => `${ex.name}: ${e.note}`),
    )
    expect(skips.length).toBe(5)

    const rec = getRecommendedSection(parsed.exercises)
    expect(rec.upLastDate).toBe('2026-10-22')
    expect(rec.legsLastDate).toBe('2026-10-21')
    expect(rec.recommended).toBe('legs')
  })

  it('applique la règle DDP série par série', () => {
    const rdl = parsed.exercises.find((e) => e.name === 'Soulevé de Terre Roumain')!
    // Dernière séance 21/10 : 22kg x 12 | 20kg x 12, 12 -> S1 passe à 24kg x 8-10, S2/S3 à 22kg x 8-10
    const rdlPlan = computeExerciseDdpPlan(rdl)
    expect(rdlPlan.sets[0]).toMatchObject({ weight: 24, repsMin: 8, repsMax: 10 })
    expect(rdlPlan.sets[1]).toMatchObject({ weight: 22, repsMin: 8, repsMax: 10 })

    const abdos = parsed.exercises.find((e) => e.name.startsWith('Total abdominaux'))!
    // Dernière séance 21/10 : 55kg x 13 | 50kg x 15, 13 (iso 12-15) -> S1 reste à 55kg x 14
    const abdosPlan = computeExerciseDdpPlan(abdos)
    expect(abdosPlan.sets[0]).toMatchObject({ weight: 55, repsMin: 14, repsMax: 14 })
  })

  it('exporte un bloc-notes complet avec les nouveaux (Objectif) en haut de la séance prévue', () => {
    const plan = buildDdpSessionPlan(parsed.exercises, 'legs')
    const exported = exportNotepad({
      preamble: parsed.preamble,
      exercises: parsed.exercises,
      plan,
      planDateIso: '2026-10-23',
      includeObjectives: true,
    })

    expect(exported).toContain('Soulevé de Terre Roumain :\n• 23/10/2026 (Objectif) : 24kg x 8-10')
    // Les anciens (Objectif) sur les séances déjà réalisées ont été nettoyés
    expect(exported).not.toContain('22/10/2026 (Objectif)')
    expect(exported).toContain('• 22/10/2026 : 10kg x 12 | 22kg x 10 | 20kg x 12, 8 (échec)')
  })
})

describe('Client Gemini 3.8 Flash High & détection clé AQ. Vertex AI Express vs AIza', () => {
  it('utilise strictement gemini-3.8-flash en thinking HIGH', () => {
    expect(GEMINI_MODEL).toBe('gemini-3.8-flash')
    expect(GEMINI_THINKING_LEVEL).toBe('HIGH')
    expect(detectApiProvider(TEST_VERTEX_KEY).kind).toBe('vertex_express')
    expect(buildEndpointUrl(TEST_VERTEX_KEY)).toBe(
      'https://aiplatform.googleapis.com/v1beta1/publishers/google/models/gemini-3.8-flash:generateContent',
    )
  })

  it('détecte une clé AI Studio classique AIza sur gemini-3.8-flash', () => {
    expect(detectApiProvider('AIzaSyExampleKey123').kind).toBe('ai_studio')
    expect(buildEndpointUrl('AIzaSyExampleKey123')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
    )
  })

  it('parse une réponse structurée Gemini 3.8 Flash High et complète avec le fallback DDP si besoin', async () => {
    const parsed = parseNotepad(DEFAULT_NOTEPAD_TEXT)
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                { thought: true, text: 'Réflexion interne...' },
                {
                  text: JSON.stringify({
                    summary_lines: ['Super dernière séance jambes, on monte sur le RDL.'],
                    exercises: [
                      {
                        exercise_id: 'ex-souleve-de-terre-roumain',
                        rest_seconds: 150,
                        tip: 'Garde le dos neutre et pousse les hanches.',
                        sets: [
                          { weight: 24, reps_min: 8, reps_max: 10, is_warmup: false },
                          { weight: 22, reps_min: 8, reps_max: 10, is_warmup: false },
                          { weight: 22, reps_min: 8, reps_max: 10, is_warmup: false },
                        ],
                      },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const plan = await generateGeminiSessionPlan({
      section: 'legs',
      exercises: parsed.exercises,
      settings: {
        apiKey: TEST_VERTEX_KEY,
        profileHeightCm: 184,
        profileWeightKg: 72,
      },
    })

    expect(plan.source).toBe('gemini')
    expect(plan.model).toBe('gemini-3.8-flash')
    expect(plan.exercises['ex-souleve-de-terre-roumain'].sets[0].weight).toBe(24)
    expect(plan.exercises['ex-leg-press']).toBeDefined()

    // Vérifie que la requête envoie bien thinkingLevel: "HIGH" sur gemini-3.8-flash et les commentaires
    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(calledUrl).toContain('gemini-3.8-flash:generateContent')
    const sentBody = JSON.parse(calledInit.body as string)
    expect(sentBody.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'HIGH' })
    expect(sentBody.contents[0].parts[0].text).toContain('user_comment')
  })

  it('bascule automatiquement sur thinkingBudget: 16384 sur gemini-3.8-flash si un endpoint rejette thinkingLevel', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: { message: 'Invalid value at generation_config.thinking_config.thinking_level' },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      headline: 'OK avec thinkingBudget high.',
                      bullet_points: [],
                      exercises: [],
                    }),
                  },
                ],
              },
            },
          ],
        }),
      })
    vi.stubGlobal('fetch', mockFetch)

    const parsed = parseNotepad(DEFAULT_NOTEPAD_TEXT)
    const stats = await analyzeStatsWithGemini({
      exercises: parsed.exercises,
      apiKey: TEST_VERTEX_KEY,
    })

    expect(stats.headline).toBe('OK avec thinkingBudget high.')
    expect(mockFetch).toHaveBeenCalledTimes(2)
    const [secondUrl, secondInit] = mockFetch.mock.calls[1] as [string, RequestInit]
    expect(secondUrl).toContain('gemini-3.8-flash:generateContent')
    const secondBody = JSON.parse(secondInit.body as string)
    expect(secondBody.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 16384 })
  })

  it('détecte un texte libre non reconnu et extrait les exercices/séries via Gemini 3.8 Flash High', async () => {
    const standardParsed = parseNotepad(DEFAULT_NOTEPAD_TEXT)
    expect(hasUnrecognizedWorkoutText(DEFAULT_NOTEPAD_TEXT, standardParsed)).toBe(false)

    const freeformText = `Séance haut hier soir :
J'ai fait 3 séries de développé couché haltères à 26 kilos pour 10, 9 et 8 répétitions (échec sur la dernière).
Ensuite tirage vertical 55 kilos 12 reps puis 10 reps.`
    const freeformParsed = parseNotepad(freeformText)
    expect(hasUnrecognizedWorkoutText(freeformText, freeformParsed)).toBe(true)

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    exercises: [
                      {
                        name: 'Développé couché haltères',
                        section: 'up',
                        active: true,
                        entries: [
                          {
                            date_iso: '2026-10-21',
                            rest_seconds: 150,
                            note: 'Séance soir',
                            sets: [
                              { weight: 26, reps: 10, is_warmup: false, failure: false },
                              { weight: 26, reps: 9, is_warmup: false, failure: false },
                              { weight: 26, reps: 8, is_warmup: false, failure: true },
                            ],
                          },
                        ],
                      },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const extracted = await parseWorkoutTextWithGemini({
      rawText: freeformText,
      apiKey: TEST_VERTEX_KEY,
    })

    expect(extracted).toHaveLength(1)
    expect(extracted[0].name).toBe('Développé couché haltères')
    expect(extracted[0].entries[0].sets[2]).toEqual({
      weight: 26,
      reps: 8,
      failure: true,
    })
  })
})

describe('Temps de repos scientifiques hypertrophie (restScience)', () => {
  it('adapte les ajouts optimaux selon échauffement / isolation / polyarticulaire / échec', () => {
    expect(
      getOptimalExtraRestSeconds({ category: 'poly', isWarmup: true, failure: false }),
    ).toBe(15)
    expect(
      getOptimalExtraRestSeconds({ category: 'iso', isWarmup: false, failure: false }),
    ).toBe(20)
    expect(
      getOptimalExtraRestSeconds({ category: 'iso', isWarmup: false, failure: true }),
    ).toBe(30)
    expect(
      getOptimalExtraRestSeconds({ category: 'poly', isWarmup: false, failure: false }),
    ).toBe(30)
    expect(
      getOptimalExtraRestSeconds({ category: 'poly', isWarmup: false, failure: true }),
    ).toBe(45)

    expect(
      computeSetRestDuration({
        baseRestSeconds: 150,
        category: 'poly',
        isWarmup: true,
        failure: false,
      }),
    ).toBe(60)

    expect(formatMinutesAndSecondsFr(154)).toBe('2 min 34 s')
  })

  it('conserve 100% des durées (repos, exo, séance) à l’export/import du bloc-notes', () => {
    const line =
      '• 22/10/2026 : 50kg x 10 (super séance) (repos : 2min30) (exo : 1min15) (séance : 48min20)'
    const entry = parseEntryLine(line)
    expect(entry.restSeconds).toBe(150)
    expect(entry.workSeconds).toBe(75)
    expect(entry.sessionDurationSeconds).toBe(2900)
    expect(entry.note).toBe('super séance')
  })

  it('analyse les statistiques via Gemini 3.8 Flash High sans pourcentages absurdes', async () => {
    const parsed = parseNotepad(DEFAULT_NOTEPAD_TEXT)
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    headline: 'Progression régulière sur les 4 dernières semaines.',
                    bullet_points: [
                      'Hausse propre sur le développé incliné (+2 kg).',
                      'Changement de machine pris en compte sur les jambes.',
                    ],
                    exercises: [
                      {
                        exercise_id: 'ex-leg-press',
                        badge: 'Nouvelle machine',
                        status: 'recalibration',
                        summary: 'Changement de presse détecté, repère actuel à 130 kg.',
                      },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const stats = await analyzeStatsWithGemini({
      exercises: parsed.exercises,
      apiKey: TEST_VERTEX_KEY,
    })

    expect(stats.model).toBe('gemini-3.8-flash')
    expect(stats.headline).toContain('Progression régulière')
    expect(stats.exercises['ex-leg-press'].badge).toBe('Nouvelle machine')
  })

  it('distingue proprement les variantes de machines et ignore les oublis de poids 0kg dans statsEngine', () => {
    const parsed = parseNotepad(DEFAULT_NOTEPAD_TEXT)
    const curl = parsed.exercises.find((e) => e.name === 'Curl Biceps Incliné aux haltères')!
    const curlChrono = buildEnrichedChronology(curl)

    // La séance #5 (0kg x 10, 8, 5) est marquée invalide en poids et affichée "? kg × 10, 8, 5"
    const zeroEntry = curlChrono.find((c) => !c.hasValidWeight)!
    expect(zeroEntry).toBeDefined()
    expect(zeroEntry.setsDisplay).toBe('? kg × 10, 8, 5')

    // Les séances poulie sont bien taguées et séparées des haltères ("Standard")
    expect(curlChrono.some((c) => c.variant === 'Poulie basse')).toBe(true)
    expect(curlChrono.some((c) => c.variant === 'Poulie haute')).toBe(true)

    const curlInsight = computeSmartExerciseInsight(curl)
    expect(curlInsight.status).toBe('progressing')
    expect(curlInsight.badge).toBe('+1 rep à 10 kg')

    // Leg press : passage de "Par côté" (42,5 kg) à "Presse poids dos" (100 kg) -> recalibration et non +135%
    const legPress = parsed.exercises.find((e) => e.name === 'Leg press')!
    const lpInsight = computeSmartExerciseInsight(legPress)
    expect(lpInsight.status).toBe('recalibration')
    expect(lpInsight.badge).toContain('Presse poids dos')

    // Virgule française sur les demi-répétitions (Extensions Triceps : 15 kg × 11,5)
    const triceps = parsed.exercises.find((e) =>
      e.name.startsWith('Extensions Triceps'),
    )!
    expect(getLatestBestSetSummary(triceps)).toBe('15 kg × 11,5')
  })

  it('classe « Calf » / mollets debout comme isolation et reconnaît la variante jambes tendues', () => {
    const calf = parseNotepad(
      'Jambes (Legs)\n\nCalf debout (jambes tendues) :\n• 22/10/2026 : 40kg x 15, 15, 12, 12 (repos : 2min)\n',
    ).exercises[0]

    expect(calf.name).toBe('Calf debout (jambes tendues)')
    // Mollets = isolation (12-15 reps) et incrément de 5 kg, comme la machine assise
    expect(calf.category).toBe('iso')
    expect(calf.repRange).toEqual([12, 15])
    expect(calf.weightStep).toBe(5)
    expect(calf.defaultRestSeconds).toBe(120)
  })

  it('signale un PR uniquement quand la dernière séance réalisée dépasse la variante en cours', () => {
    const parsed = parseNotepad(
      [
        'Jambes (Legs)',
        '',
        'Calf debout (jambes tendues) :',
        '• 22/10/2026 : 45kg (par côté) x 15, 12 (repos : 2min)',
        '• 15/10/2026 : 40kg (par côté) x 15, 12 (repos : 2min)',
        '• 08/10/2026 : 35kg (par côté) x 15, 15 (repos : 2min)',
        '',
        'Leg extension :',
        '• 22/10/2026 (Objectif) : 60kg x 12',
        '• 22/10/2026 : 50kg x 12',
        '• 15/10/2026 : 55kg x 12',
        '',
      ].join('\n'),
    )

    const calf = parsed.exercises.find((e) => e.name === 'Calf debout (jambes tendues)')!
    // 45 kg dépasse les 40 kg de la séance précédente sur la même variante : c'est un PR
    expect(getLatestRecordInfo(calf)?.isRecord).toBe(true)

    const legExtension = parsed.exercises.find((e) => e.name === 'Leg extension')!
    // L'objectif 60 kg du 22/10 n'est pas une perf : le dernier vrai 50 kg n'est pas un PR
    expect(getLatestRecordInfo(legExtension)?.isRecord).toBe(false)
  })

  it('génère un bilan complet prêt pour une IA (volume, records, variantes, temps)', () => {
    const parsed = parseNotepad(DEFAULT_NOTEPAD_TEXT)
    const report = buildStatsReport({
      exercises: parsed.exercises,
      profile: { heightCm: 184, weightKg: 72 },
      now: new Date('2026-10-22T12:00:00'),
    })

    // En-tête et contexte
    expect(report).toContain('# Bilan musculation')
    expect(report).toContain('1m84')
    expect(report).toContain('72 kg')
    expect(report).toContain('Double Progression Dynamique')

    // Chiffres clés calculés
    expect(report).toMatch(/Volume total soulevé : \*\*[\d ]+ kg\*\*/)
    expect(report).toContain('Répartition : Haut')
    expect(report).toContain('Séance la plus volumineuse')

    // Détail par exercice, records et variantes d'équipement
    expect(report).toContain('### Leg press')
    expect(report).toContain('- Record :')
    expect(report).toContain('Variantes d’équipement')
    expect(report).toContain('Charges non comparables entre variantes')
    expect(report).toContain('Machine assis (mollets)')

    // Les lignes (Objectif) ne sont jamais comptées comme des séances réalisées
    expect(report).toContain('Objectif en cours')
    const latestLine = report.split('\n').find((line) => line.startsWith('- Dernière séance'))
    expect(latestLine).toBeDefined()

    // Les temps sont expliqués même quand il n'y a pas encore de données
    expect(report).toContain('Temps à la salle')
    expect(report).toContain('Ce que j’attends de toi (coach)')
  })

  it('garantit un aller-retour export/import 100% idempotent sans perte sur les 762 séries (y compris demi-reps)', () => {
    const parsed1 = parseNotepad(DEFAULT_NOTEPAD_TEXT)
    const exported1 = exportNotepad({
      preamble: parsed1.preamble,
      exercises: parsed1.exercises,
    })
    const parsed2 = parseNotepad(exported1)
    const exported2 = exportNotepad({
      preamble: parsed2.preamble,
      exercises: parsed2.exercises,
    })

    const countSets = (exs: typeof parsed1.exercises) =>
      exs.reduce(
        (acc, ex) => acc + ex.entries.reduce((s, entry) => s + entry.sets.length, 0),
        0,
      )

    expect(countSets(parsed2.exercises)).toBe(countSets(parsed1.exercises))
    expect(exported2).toBe(exported1)
  })

  it('nettoie les clés API fraîchement copiées et bascule automatiquement en ?key=, cross-provider ou retry 429', async () => {
    expect(
      sanitizeApiKey('  GEMINI_API_KEY="AIzaSyBrandNewKey123\u200B\n"  '),
    ).toBe('AIzaSyBrandNewKey123')
    expect(sanitizeApiKey('Bearer   AQ.FreshVertexKey999\u00A0')).toBe(
      'AQ.FreshVertexKey999',
    )

    // Cas 1 : échec CORS sur l'en-tête x-goog-api-key -> bascule transparente en ?key=
    const corsFallbackFetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: '{"status":"ok"}' }] } }],
        }),
      })
    vi.stubGlobal('fetch', corsFallbackFetch)

    const res1 = await testGeminiConnection('  "AIzaSyCorsNewKey111" ')
    expect(res1.ok).toBe(true)
    expect(res1.message).toContain('gemini-3.8-flash')
    expect(corsFallbackFetch).toHaveBeenCalledTimes(2)
    expect(String(corsFallbackFetch.mock.calls[1][0])).toContain(
      'generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=AIzaSyCorsNewKey111',
    )

    // Cas 2 : clé AIza créée dans Google Cloud Vertex (403 sur AI Studio) + 429 transitoire -> bascule Vertex + retry
    resetGeminiClientState()
    const crossProviderFetch = vi
      .fn()
      // v1beta header -> 403
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({
          error: { message: 'Generative Language API has not been used in project' },
        }),
      })
      // v1beta query -> 403
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({
          error: { message: 'Generative Language API has not been used in project' },
        }),
      })
      // v1alpha -> 404 (skip direct)
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: { message: 'Not found' } }),
      })
      // Vertex v1beta1 -> 429 transitoire (nouvelle clé) puis 200 OK !
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({
          error: { status: 'RESOURCE_EXHAUSTED', message: 'Rate limit spike' },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: '{"status":"ok"}' }] } }],
        }),
      })
    vi.stubGlobal('fetch', crossProviderFetch)

    const res2 = await testGeminiConnection('AIzaSyGcpVertexBoundKey222')
    expect(res2.ok).toBe(true)
    expect(String(crossProviderFetch.mock.calls[4][0])).toContain(
      'aiplatform.googleapis.com/v1beta1/publishers/google/models/gemini-3.8-flash:generateContent',
    )
  })

  it('permet à l’utilisateur de modifier librement son .txt (nouvel exo vide, commentaires avec kg, préambule perso)', () => {
    const customTxt = [
      'Objectif personnel : focus contrôle excentrique 3s.',
      '',
      'Up',
      'Développé incliné haltères :',
      '• 26/10/2026 : 22kg x 10, 9 (repos : 2min30)',
      '',
      'Jambes (Legs)',
      'Leg press :',
      '• 24/10/2026 : 130kg x 12, 11 (repos : 2min30)',
      '• 20/10/2026 : pas fait, machine 100kg occupée pour mes 3 séries',
      '',
      'Hip thrust :',
      '',
    ].join('\n')

    expect(hasUnrecognizedWorkoutText(customTxt)).toBe(false)
    const customParsed = parseNotepad(customTxt, { preserveCustomPreamble: true })
    expect(customParsed.preamble).toBe('Objectif personnel : focus contrôle excentrique 3s.')

    const hipThrust = customParsed.exercises.find((e) => e.name === 'Hip thrust')!
    expect(hipThrust).toBeDefined()
    expect(hipThrust.section).toBe('legs')
    expect(hipThrust.active).toBe(true)

    const reExported = exportNotepad(customParsed)
    expect(reExported.startsWith('Objectif personnel : focus contrôle excentrique 3s.')).toBe(
      true,
    )
    expect(reExported).toContain('Hip thrust :')
  })

  it('construit un prompt coach de haute précision et suit la fraîcheur des plans pré-générés par section', async () => {
    const parsed = parseNotepad(DEFAULT_NOTEPAD_TEXT)
    resetGeminiClientState()

    const cleanRules = extractAthleteRulesFromPreamble(
      `${parsed.preamble}\n Règle perso : ne jamais dépasser RPE 9 au roumain.`,
    )
    expect(cleanRules).toContain('Je mesure 1m84 pour 72kg')
    expect(cleanRules).toContain('Règle perso : ne jamais dépasser RPE 9 au roumain.')
    expect(cleanRules).not.toContain('UNIQUE BLOC DE CODE MARKDOWN')
    expect(cleanRules).not.toContain('RÈGLE DE SÉLECTION DU JOUR')

    const prompt = buildCoachPromptForSection({
      section: 'up',
      exercises: parsed.exercises,
      preamble: parsed.preamble,
      settings: { profileHeightCm: 184, profileWeightKg: 72 },
    })
    expect(prompt).toContain('ddp_mathematical_baseline')
    expect(prompt).toContain('equipment_variant')
    expect(prompt).toContain('target_reps')
    expect(prompt).toContain('user_comment')
    expect(prompt).not.toContain('UNIQUE BLOC DE CODE MARKDOWN')

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    summary_lines: ['Haut pré-généré avec succès.'],
                    exercises: [
                      {
                        exercise_id: 'ex-developpe-incline-halteres',
                        rest_seconds: 150,
                        tip: 'Contrôle la descente.',
                        sets: [
                          {
                            weight: 10,
                            reps_min: 12,
                            reps_max: 12,
                            target_reps: 12,
                            is_warmup: true,
                          },
                          {
                            weight: 22,
                            reps_min: 8,
                            reps_max: 12,
                            target_reps: 11,
                            is_warmup: false,
                          },
                        ],
                      },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const upPlan = await generateGeminiSessionPlan({
      section: 'up',
      exercises: parsed.exercises,
      preamble: parsed.preamble,
      settings: {
        apiKey: TEST_VERTEX_KEY,
        profileHeightCm: 184,
        profileWeightKg: 72,
      },
    })

    expect(upPlan.exercises['ex-developpe-incline-halteres'].sets[1].suggestedReps).toBe(11)
    expect(isGeminiPlanFresh(upPlan, parsed.exercises, 'up', parsed.preamble)).toBe(true)

    // Ajouter une nouvelle séance Jambes NE périme PAS le plan Haut pré-généré !
    const afterLegsSaved = parsed.exercises.map((ex) =>
      ex.id === 'ex-leg-press'
        ? {
            ...ex,
            entries: [
              {
                id: 'new-legs',
                date: '2026-10-26',
                sets: [{ weight: 135, reps: 10 }],
                restSeconds: 150,
                note: '',
                rawLine: '• 26/10/2026 : 135kg x 10',
              },
              ...ex.entries,
            ],
          }
        : ex,
    )
    expect(isGeminiPlanFresh(upPlan, afterLegsSaved, 'up', parsed.preamble)).toBe(true)
  })
})
