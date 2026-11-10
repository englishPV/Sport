export const EXAMPLE_API_KEY =
  (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_GEMINI_API_KEY ?? ''

/** Règles par défaut (aucune donnée personnelle). Remplacées par le préambule du bloc-notes importé. */
export const DEFAULT_NOTEPAD_PREAMBLE = `Aujourd'hui, c'est soit Haut du corps (Up), soit Jambes (Legs).
RÈGLE DE SÉLECTION DU JOUR : la séance du jour est la section opposée à la dernière date enregistrée.

RÈGLE DE CHARGE (Double Progression Dynamique - DDP) :
1. Exercices polyarticulaires (développés, tirages, presse, squat) -> Fourchette 8 à 12 reps.
   - Si la Série 1 de la dernière séance a atteint 12 reps : augmente le poids d'un cran et vise 8-10 reps.
   - Sinon : conserve la même charge et vise +1 répétition par série.
2. Exercices d'isolation (élévations latérales, triceps, biceps, mollets, abdos) -> Fourchette 12 à 15 reps.
   - Si la Série 1 a atteint 15 reps : monte le poids d'un cran.
   - Sinon : garde le même poids et vise +1 rep.`

/** Modèle de départ : une liste d'exercices vide d'historique, à remplacer par son propre .txt. */
export const DEFAULT_NOTEPAD_TEXT = `${DEFAULT_NOTEPAD_PREAMBLE}


Up Développé incliné haltères :

Tirage vertical :

Développé militaire haltères :

Tirage horizontal :

Élévations latérales :

Extension triceps poulie :

Curl biceps haltères :

Jambes (Legs)

Presse à cuisses :

Leg curl :

Leg extension :

Mollets à la presse :
`
