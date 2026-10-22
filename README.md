# Sport · DDP (Haut / Jambes)

Application web simple et claire pour suivre tes séances **Haut du corps (Up)** et **Jambes (Legs)** avec la **Double Progression Dynamique (DDP)**, un minuteur de repos automatique, l’import/export fidèle de ton bloc-notes `.txt` et un Coach IA Gemini.

## Démarrage en local (Windows, macOS, Linux)

Installe les dépendances :

```bash
npm install
```

Lance le serveur de développement :

```bash
npm run dev
```

Puis ouvre `http://localhost:5173/` dans ton navigateur.

> **Pourquoi tu avais eu `HTTP ERROR 404` la dernière fois ?**
> Sous Windows (`cmd.exe`), le caractère `#` n’est pas un commentaire. En copiant-collant `npm run dev # http://localhost:5173`, Windows envoyait `#` comme nom de dossier racine à Vite (`C:/Users/coell/Sport/#`), d’où la page 404. Le lanceur ignore désormais automatiquement tout commentaire `#` en fin de commande.

## Commandes utiles

```bash
npm run test
npm run lint
npm run build
npm run preview
```

## Fonctionnalités

- **Alternance automatique Up / Jambes** : compare la date la plus récente de chaque section pour recommander la séance du jour.
- **Double Progression Dynamique (DDP) série par série** :
  - Exercices polyarticulaires : fourchette `8–12` reps (hausse de poids dès 12 reps en Série 1, sinon `+1 rep`).
  - Exercices d’isolation : fourchette `12–15` reps (hausse de poids dès 15 reps, sinon `+1 rep`).
  - Conservation automatique des séries d’échauffement et gestion du tag `(échec)`.
- **Coach Gemini IA** : utilise strictement **`gemini-3.8-flash`** avec `thinkingLevel: "high"` (compatible clés `AQ.…` et `AIza…`).
- **Synchronisation Bloc-notes `.txt`** : exporte à tout moment l’intégralité de ton fichier bloc-notes (avec ton prompt DDP intact et les nouveaux `(Objectif)` en haut) ou colle une mise à jour.
- **Courbes de progrès & Minuteur de repos** : graphique Charge max / 1RM estimé et minuteur basé sur l’horloge réelle (ne dérive pas écran verrouillé).
