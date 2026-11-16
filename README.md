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
- **Coach Gemini IA — une seule requête par séance** : utilise strictement **`gemini-3.8-flash`** avec `thinkingLevel: "HIGH"` (compatible clés fraîchement créées `AIza…` Google AI Studio / Cloud et `AQ.…` Vertex AI Express, avec bascule d’endpoint et file séquentielle anti-429). Le prompt envoyé à l’IA est construit à partir des données du site (pas du `.txt`) : règles personnelles nettoyées, 6 dernières séances par exercice avec les charges série par série, les commentaires rattachés à la série concernée (« j’aurais pu faire 13 »), la tendance calculée, le repos réel et le volume du jour plafonné. Réponse en JSON strict, puis garde-fou : une charge incohérente avec l’historique revient à la base DDP. Aucun repli automatique vers un autre modèle : `gemini-2.5` (et toute version < 3.8) est refusé, ignoré dans le sélecteur et remplacé par `gemini-3.8-flash`.
  **Budget de requêtes (le point clé)** : le site ne demande **jamais les deux séances d’un coup**. Au premier lancement, une seule séance est générée — celle qui est affichée — et la séance opposée garde son plan calculé sur l’appareil (DDP, gratuit) jusqu’à ce qu’on l’ouvre. « Tester la clé » vérifie la clé et le modèle via la liste des modèles : **0 requête du quota** par défaut (le vrai test de génération reste disponible en un clic, avec l’avertissement qu’il compte). Deux demandes simultanées pour la même séance sont fusionnées, et toutes les générations passent dans une file unique : ni démarrage ni pré-génération ne peuvent plus payer deux fois la même requête. Enfin, un échec d’une section n’empêche plus l’autre de tenter sa chance, et un **quota journalier épuisé** coupe tout : plus rien ne partira avant la réinitialisation, même avec « Réessayer ». L’écran Réglages affiche le **journal des requêtes réellement envoyées** (tag, heure), pour vérifier ce qui a été consommé.
  **Rythme** : pendant la génération, « Commencer » affiche « Préparation de la séance… » et l’exercice ne s’ouvre qu’une fois le plan prêt. Les réponses 429 ne sont jamais retentées automatiquement et les requêtes de génération sont espacées de 13 s pour rester sous les petits quotas RPM.
- **Édition directe & Synchronisation Bloc-notes `.txt`** : modifie librement tes exercices, charges, commentaires ou consignes personnelles directement dans l’éditeur `.txt` (`Enregistrer`, `Ctrl/Cmd+S` ou sauvegarde automatique au retour), importe ou exporte ton fichier complet sans perte.
- **Courbes de progrès & Minuteur de repos** : graphique Charge max / 1RM estimé et minuteur basé sur l’horloge réelle (ne dérive pas écran verrouillé).
