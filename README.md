# GymLog

PWA mobile-first de suivi de musculation : import d’un bloc-notes, cycle de séances
(HAUT / BAS / …), minuteur de repos fiable, statistiques et coach IA Gemini.
100 % statique : aucune base de données, aucun compte, aucun backend.

## Stack

Vite 5 · React 18 · TypeScript strict · Tailwind CSS 3 · zustand (persist) ·
react-router-dom (HashRouter) · zod · recharts · vitest + Testing Library ·
vite-plugin-pwa (generateSW, autoUpdate) · lucide-react.

## Démarrage

```bash
npm install
npm run dev       # http://localhost:5173
npm run test      # vitest (85 tests)
npm run lint      # eslint
npm run build     # tsc + vite build → dist/
npm run preview   # sert dist/ localement
```

Node 20 recommandé.

## Déploiement GitHub Pages

Le workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) publie
automatiquement sur chaque `push` vers `main` :

1. `npm ci`, `npm run lint`, `npm run test`, `npm run build` ;
2. upload de `dist/` via `actions/upload-pages-artifact@v3` ;
3. publication via `actions/deploy-pages@v4`.

Dans **Settings → Pages**, source = **GitHub Actions**.

### Base path

| Cas | `VITE_BASE_PATH` |
| --- | --- |
| Dépôt `<user>.github.io` | `/` (valeur par défaut) |
| Dépôt de projet `<user>.github.io/<repo>` | `/<repo>/` |

Pour un dépôt de projet, remplace la ligne du workflow :

```yaml
env:
  VITE_BASE_PATH: /mon-repo/
```

Le build étant statique, `base` est injecté au build et le `HashRouter` évite toute
configuration de fallback SPA côté Pages.

## Coach Gemini (Gemini 3.8 Flash, raisonnement « high »)

- Clé : [Google AI Studio → Get API key](https://aistudio.google.com/apikey) (gratuit pour
  commencer). Colle-la dans l’app (onboarding ou Réglages), puis « Tester la clé ».
- Modèle par défaut : `gemini-3.8-flash` (modifiable dans Réglages).
- Niveau de raisonnement : `high` (`generationConfig.thinkingConfig.thinkingLevel`).
- Requête : `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent`,
  clé dans l’en-tête `x-goog-api-key` (jamais dans l’URL).
- Sans clé ou en cas d’échec, un plan déterministe est utilisé (badge « Règle auto ») :
  l’app reste 100 % fonctionnelle.

> ⚠️ Une PWA statique ne peut pas garder un secret : la clé est stockée dans le
> `localStorage` de l’appareil et n’est envoyée qu’à Google. Utilise une clé dédiée,
> restreinte et révocable ; ne publie jamais ce dépôt avec une clé dedans.

## Format du bloc-notes

Le parser est déterministe, sans IA. Une ligne non reconnue est **signalée**, jamais devinée.

### Forme A — ligne complète

```
<NomExercice> : <Date> : <Séries> [(<commentaire>)]
```

### Forme B — en-tête puis dates

```
<NomExercice> :
<Date> : <Séries> [(<commentaire>)]
<Date> : <Séries> [(<commentaire>)]
```

### Règles

- **Date** : `jour/mois[/année]` — `24/10/2026`, `20/10`, `24/10/26`.
  Année absente → année courante ; année à 2 chiffres → `20xx`.
- **Séries** : blocs séparés par ` - ` ou ` / `.
  Un bloc = `<Poids>kg x <Reps>[, <Reps>…]` ; `kg` optionnel ; virgule ou point décimal ;
  `x`, `X`, `×`, `*` acceptés.
- **Poids du corps** : `PDC`, `pdc`, `poids du corps`, `BW` → poids 0.
- **Commentaire** : entre parenthèses en fin de ligne.
  `repos 1m30` → 90 s, `repos 2min` → 120 s, `repos 90s` → 90 s, `(repos)` → pas de valeur.
  Le reste du commentaire devient une note.

### Exemples

```
Extension triceps à la poulie : 24/10/2026 : 15kg x 11, 9 - 12kg x 11 (repos 1m30)
```

→ 1 exercice, 1 séance, 3 séries : 15×11, 15×9, 12×11, repos 90 s.

```
Leg press :
20/10 : 120kg x 10, 10, 8
13/10 : 115kg x 10, 10, 10

Tractions : 24/10/2026 : PDC x 8, 7, 6
```

### Après analyse

L’écran de vérification affiche les groupes de séances proposés (similarité de Jaccard ≥ 0,5),
permet de renommer, fusionner, réordonner et déplacer un exercice. Rien n’est écrit avant
« Valider l’import ». Les lignes en erreur sont listées avec leur numéro.

## Utilisation

- **Accueil** : cartes par type de séance ; la suivante est surlignée en bleu. Clic → séance.
- **Séance** : une série à la fois, cible du coach, historique « fantôme », RPE, note.
  Le chrono global et le repos sont calculés depuis des timestamps : verrouiller le
  téléphone ou recharger la page ne fausse rien.
- **Repos** : bip 880 Hz ×3 (si son activé) + vibration ; « +30 s » fonctionne même en
  dépassement (`+0:15` → `0:15`).
- **Résumé** : durée, volume, séries, records battus ; le plan de la prochaine séance est
  pré-généré en arrière-plan.
- **Stats** : charge max, volume, repos moyen, 1RM estimé (Epley), progression 4 semaines.
- **Historique** : filtres type/exercice, détail en lecture seule, suppression confirmée.
- **Réglages** : clé/modèle Gemini, repos et pas de poids, son/vibration, export/import JSON,
  ré-import de bloc-notes (dédupliqué), effacement à double confirmation.

## Hors ligne

`vite-plugin-pwa` précache l’application (`generateSW`). Après une première visite :
build → `npm run preview` → mode avion → recharger → l’app s’ouvre. Les données vivent dans
`localStorage` (`gymlog:v1`).

## Structure

```
src/core/      logique pure (parser, cycle, progression, timers, stats, Gemini) + tests
src/store/     zustand + persist, migrations de schéma
src/hooks/     useNow, useWakeLock, useBeep
src/components/ui · session · layout
src/pages/     Onboarding, ImportReview, Home, Session, Summary, Stats, History, Settings
```

Décisions et compromis : [`DECISIONS.md`](DECISIONS.md).
