# Décisions d’implémentation

Ce document liste les points non couverts (ou contradictoires) par le cahier des charges,
et la solution retenue. Toutes les fonctions de `src/core/` sont pures et testées.

## Gemini

1. **Modèle imposé : `gemini-3.8-flash`.** C’est le modèle demandé explicitement
   (« Gemini 3.8 Flash High ») et il correspond au modèle GA publié par Google
   (`gemini-3.8-flash`, ID stable sans suffixe). `DEFAULT_GEMINI_MODEL` est donc
   `gemini-3.8-flash`, et non `gemini-flash-latest` ni `gemini-1.5-flash`.
   Le champ est éditable dans Réglages pour suivre les évolutions.
2. **Raisonnement « high ».** Chaque appel envoie
   `generationConfig.thinkingConfig.thinkingLevel = "high"`. La constante
   `DEFAULT_GEMINI_THINKING_LEVEL` centralise cette valeur ; `callGemini` accepte
   une surcharge optionnelle `thinkingLevel` (rétro-compatible avec la signature imposée).
3. **Pas de `temperature` pour Gemini 3+.** La documentation Gemini 3 indique que les
   paramètres d’échantillonnage (`temperature`, `top_p`, `top_k`) sont dépréciés et doivent
   être retirés. `callGemini` n’envoie donc `temperature: 0.4` que pour les modèles antérieurs
   (`gemini-2.x`), et l’omet pour `gemini-3.x` / `gemini-4.x`. Le reste du corps de requête
   suit exactement le schéma imposé (`contents`, `generationConfig.responseMimeType`,
   `responseSchema`).
4. **Clé API** : header `x-goog-api-key` uniquement, jamais dans l’URL, jamais journalisée.
5. **Extraction du texte** : le chemin `candidates[0].content.parts[0].text` est prioritaire.
   Si la première partie est une partie de réflexion (`thought: true`) ou vide, les parties
   non-`thought` sont concaténées — nécessaire avec un raisonnement élevé.
6. **Retry** : une seule nouvelle tentative après 2 s (paramétrable) pour `429` et erreurs
   réseau. `401/403`, `404` et les autres statuts échouent immédiatement.
7. **Hash d’entrée** : SHA-256 via `crypto.subtle`. Repli déterministe FNV-1a si
   `crypto.subtle` n’est pas disponible (environnements de test / contextes non sécurisés).
8. **Plans de repli** : `source: 'fallback'`, `model: null`, même `inputHash` que l’entrée.
   Le note globale est le texte imposé « Mode hors-ligne… ».

## Données et persistance

9. **Validation stricte au chargement.** La valeur `gymlog:v1` est validée par
   `AppStateSchema` avant hydratation. Version de schéma inconnue → écran dédié proposant
   l’export brut et la réinitialisation ; aucune écriture n’est faite tant que l’erreur
   n’est pas résolue (l’adaptateur de stockage bloque `setItem`).
10. **Schémas zod non stricts** (`strip` par défaut) : les champs inconnus sont supprimés,
    ce qui permet d’importer un export plus récent sans casser l’app.
11. **`resetAllData` conserve l’onboarding par défaut dans Réglages**
    (`{ keepOnboarding: true }`). Cela permet le parcours d’acceptation
    « exporter → tout effacer → importer → données identiques » : après effacement,
    l’utilisateur reste dans l’app (données vides) et peut importer son JSON.
12. **Champs runtime hors `AppState`** : `toasts`, `pendingImportText`, `coachLoading`.
    `partialize` ne persiste que les champs d’`AppState`, conformément au modèle.
13. **Import** : une session importée reçoit `completedAt` synthétique
    (date à 12:00 UTC + 1 min par série) et `restSecondsActual = restSeconds` du commentaire,
    pour alimenter les graphiques et l’historique « fantôme » de façon exploitable.
14. **Déduplication à la ré-importation** : exercices par `normalizedName`, types par nom
    normalisé, séances par couple `(date, exerciseId)` comme demandé. Une séance dont toutes
    les séries existent déjà est ignorée.
15. **Regroupement de l’import** : si l’utilisateur déplace un exercice vers un autre groupe,
    les performances d’une date sans exercice restant dans le groupe d’origine sont tout de
    même conservées dans ce groupe (sinon la date serait perdue silencieusement).

## Parser

16. **Année manquante** → année courante au moment du parsing ; 2 chiffres → `20xx`.
    Le test correspondant utilise l’année courante pour rester stable dans le temps.
17. **Poids du corps** : `PDC`, `pdc`, `poids du corps`, `BW` → `weight = 0`.
18. **Commentaire** `(repos)` sans valeur : `restSeconds = null` et le mot « repos » n’est pas
    conservé comme note.
19. **Raison d’erreur supplémentaire** `invalid_sets` : le cahier des charges n’énumérait que
    `unrecognized`, `invalid_date`, `no_exercise_context` ; une série illisible (poids/reps
    invalides) est signalée distinctement, toujours avec son numéro de ligne.
20. **Séries** : les blocs sont séparés par ` - ` ou ` / ` (espaces obligatoires), ce qui évite
    de couper les dates `24/10`.

## Séances et progression

21. **Nouvelle séance = 3 séries vides par exercice.** Le nombre de séries d’une séance à venir
    n’est pas connu ; 3 est la valeur usuelle, et « + Ajouter une série » permet d’ajuster.
22. **Réutilisation d’un brouillon.** La pré-génération du résumé crée (si besoin) une séance
    `planned` pour le type suivant ; l’accueil réutilise ce brouillon au lieu d’en créer un
    autre. Évite les doublons et rend le plan IA immédiatement disponible.
23. **Génération du plan** : déclenchée au passage en `in_progress` si `coachPlan === null`.
    Aucune régénération automatique ensuite ; « Regénérer » n’est proposé que si aucune série
    n’a été validée.
24. **Repos réels** : à chaque validation, toutes les séries validées dont le repos est encore
    inconnu sont complétées avec l’écart vers la série validée suivante (la dernière reste
    `null`, faute de série suivante).
25. **Fin de séance** : les séries non validées sont supprimées, `endedAt`, `status`,
    `activeSessionId` et `restTimer` sont mis à jour.
26. **Fallback de progression** : strictement les règles 8.4. La charge cible n’est jamais
    arrondie au pas dans le fallback (elle est déjà un multiple) ; l’arrondi au pas ne concerne
    que les réponses Gemini.
27. **Poids du corps** : jamais d’ajout de charge, règle « +1 rep » appliquée.

## Stats

28. **Volume** : Σ poids × reps des séries validées (`completedAt !== null`). Les séries au
    poids du corps contribuent 0, comme prévu par la formule.
29. **Repos moyen** : moyenne des `restSecondsActual` non nuls, arrondie à l’entier ; `null`
    si aucun repos renseigné (point absent du graphique, pas de 0 artificiel).
30. **1RM estimé** : Epley `poids × (1 + reps/30)`, maximum sur les séries de la séance.
31. **Records** : poids max (reps ≥ 1) et volume max par exercice, comparés aux sessions
    strictement antérieures (date, puis `endedAt`). Les sessions planifiées sont ignorées.
32. **Progression globale** : fenêtre de 28 jours vs les 28 jours précédents, dates locales.

## UI / technique

33. **Aucun dialogue natif** : `Modal` et `Toast` maison. Confirmations en deux temps pour les
    suppressions (effacement total, type de séance, séance historique).
34. **Timers** : aucun compteur incrémental ; `useNow` ne sert qu’à rafraîchir l’affichage,
    toutes les valeurs sont dérivées de `Date.now()` et des timestamps persistés.
35. **Audio** : `AudioContext` créé/débloqué au premier geste utilisateur (pointerdown/keydown),
    obligatoire sur iOS. Le bip est joué une seule fois par timer (`signaledForStartedAt`),
    y compris au retour de veille via `visibilitychange`.
36. **Wake Lock** silencieux si non supporté ; libéré au démontage et à la fin de séance.
37. **Formatage** : repos `m:ss` (préfixe `+` en dépassement), chrono `mm:ss` puis `h:mm:ss`.
38. **Dates de séance** : date locale (`YYYY-MM-DD`), pas UTC, pour éviter les décalages de
    soirée.
39. **Icônes PWA** : générées localement (`public/icon-192.png`, `icon-512.png`) plus un
    favicon SVG.
40. **Fichiers ajoutés hors arborescence imposée** : `postcss.config.js` (Tailwind),
    `.eslintrc.cjs`, `.gitignore`, `public/` (icônes), et deux fichiers de tests
    (`src/store/useAppStore.test.ts`, `src/pages/pages.test.tsx`). Le reste de l’arborescence
    suit exactement la section 2.
41. **`tsconfig.json` unique** (pas de `tsconfig.app.json`), `npm run build` = `tsc -b` puis
    `vite build`. `strict: true`, aucun `any`, aucun `@ts-ignore`.
42. **Recharts reste en 2.x** (version imposée) malgré l’avertissement de dépréciation npm.
43. **ESLint 8** (config `.eslintrc.cjs`) pour rester compatible avec les plugins React
    utilisés ; `npm run lint` ne produit ni erreur ni avertissement.
44. **Workflow de déploiement** : lint et tests ajoutés avant le build comme garde-fous ;
    `VITE_BASE_PATH` vaut `/` dans le workflow, à remplacer par `/<repo>/` pour un dépôt de
    projet.
45. **Sécurité de la clé** : une SPA statique ne peut pas cacher un secret. La clé est stockée
    en `localStorage`, envoyée uniquement à Google via HTTPS, et jamais incluse dans le bundle
    ni dans l’URL. Le README le rappelle explicitement.
