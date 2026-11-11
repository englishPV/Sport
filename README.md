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
- **Coach Gemini IA & Pré-génération** : utilise strictement **`gemini-3.8-flash`** avec `thinkingLevel: "HIGH"` (compatible clés fraîchement créées `AIza…` Google AI Studio / Cloud et `AQ.…` Vertex AI Express avec bascule multi-endpoint et file séquentielle anti-429). Le prompt envoyé à l'IA est construit à partir des données du site (pas du `.txt`) : règles personnelles nettoyées, 6 dernières séances par exercice avec les charges série par série, les commentaires rattachés à la série concernée (« j'aurais pu faire 13 »), la tendance calculée, le repos réel et le volume du jour plafonné. Réponse en JSON strict, puis garde-fou : une charge incohérente avec l'historique revient à la base DDP. Aucun repli automatique vers un autre modèle : `gemini-2.5` (et toute version < 3.8) est refusé, ignoré dans le sélecteur et remplacé par `gemini-3.8-flash` ; le test de clé laisse jusqu’à 3 min au modèle au lieu de le déclarer en échec au bout de 25 s. En appuyant sur **Jambes** (ou **Haut**), l’application génère la séance en cours si elle ne l’était pas encore et pré-génère en tâche de fond la prochaine séance opposée (**Up** / **Jambes**) pour qu’elle soit immédiatement prête à la fin de l’entraînement. Anti-spam du quota : les demandes sont taguées par section (`coach-plan:up` / `coach-plan:legs` / `stats-analysis`), une requête devenue périmée pendant qu’elle attend son tour est supprimée **avant** l’appel réseau (zéro quota consommé), et après un échec (429, surcharge, délai) plus rien ne repart automatiquement pendant 60 s — seul le lien « Réessayer » relance immédiatement.
- **Édition directe & Synchronisation Bloc-notes `.txt`** : modifie librement tes exercices, charges, commentaires ou consignes personnelles directement dans l’éditeur `.txt` (`Enregistrer`, `Ctrl/Cmd+S` ou sauvegarde automatique au retour), importe ou exporte ton fichier complet sans perte.
- **Courbes de progrès & Minuteur de repos** : graphique Charge max / 1RM estimé et minuteur basé sur l’horloge réelle (ne dérive pas écran verrouillé).
