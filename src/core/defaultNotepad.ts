export const EXAMPLE_API_KEY =
  (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_GEMINI_API_KEY ?? ''

export const DEFAULT_NOTEPAD_PREAMBLE = `Aujourd'hui, c'est soit Haut du corps (Up), soit Jambes (Legs).
RÈGLE DE SÉLECTION DU JOUR : Compare la date la plus récente tout en haut de la section "Up" et celle tout en haut de "Jambes". Si la dernière date enregistrée est "Jambes", aujourd'hui c'est HAUT DU CORPS. Si c'est "Up", aujourd'hui c'est JAMBES.

RÈGLE SCIENTIFIQUE DE CHARGE (Double Progression Dynamique - DDP) :
Je mesure 1m84 pour 72kg (hypertrophie).
Pour chaque exercice de la séance du jour, regarde STRICTEMENT la 1ère ligne (la plus haute, la plus récente) et applique cette règle :
1. Exercices polyarticulaires (développés, tirages, presse, squat) -> Fourchette 8 à 12 reps.
   - Si la Série 1 de la dernière séance a atteint 12 reps : augmente le poids de la Série 1 d'un cran (+1kg à +2,5kg) et vise 8-10 reps. Laisse les séries suivantes à l'ancien poids si elles n'ont pas atteint 12.
   - Si la Série 1 n'a pas atteint 12 reps : conserve exactement la même charge et ajoute un objectif de +1 répétition par série par rapport à la dernière fois.
2. Exercices d'isolation (élévations latérales, triceps, biceps, mollets, abdos) -> Fourchette 12 à 15 reps.
   - Si la Série 1 a atteint 15 reps : monte le poids d'un cran.
   - Sinon : garde le même poids et vise +1 rep.

FORMAT D'EXÉCUTION ET D'AFFICHAGE (TRÈS STRICT) :
1. Rédige d'abord 3 ou 4 lignes d'explications résumant tes choix de charges pour la séance du jour.
2. Génère ensuite un UNIQUE BLOC DE CODE MARKDOWN (avec \`\`\`) contenant l'INTÉGRALITÉ de mon fichier bloc-notes (sans rien résumer, sans rien supprimer, en conservant ce prompt intact au tout début).
3. Dans ce bloc, insère la nouvelle séance prévue tout en haut de chaque exercice concerné avec la date d'aujourd'hui (par exemple 07/10/2026) au format :
   • 07/10/2026 (Objectif) : [Poids] x [Reps cibles pour chaque série]
Enlève les (objectif) précédent et prends en compte ou non, les commentaires précédents pour que ce soit optimal`

export const DEFAULT_NOTEPAD_TEXT = `${DEFAULT_NOTEPAD_PREAMBLE}


Up Développé incliné haltères :
• 22/10/2026 (Objectif) : 10kg x 12 | 22kg x 10 | 20kg x 12, 8(échec) (repos : 2min30)
• 15/10/2026 : 14kg (pas trouvé 10)  x 12 | 20kg x 12, 11 | 18kg x 12 (repos : 2min30)
• 08/10/2026 : 10kg x 12 (ça échauffe vraiment ?) | 20kg x 10 (j’aurai pu aller à 13 max), 10 (là aussi sûrement) | 18kg x 12 (repos : 2min30)
• 05/10/2026 : 10kg x 12 | 18kg x 12, 12, 10 (repos : 2min30)
• 30/09/2026 : 10kg x 12 | 18kg x 10, 12, 10 (repos : 2min30)
• 22/09/2026 : 16kg x 12, 12, 12
• 10kg x 12, | 20kg x 11, 10, 9,
• 18kg x 12, 12 (trop de gens pour que je puisse faire l’échauffement) (très très facile les séries) | 20kg x 12 (12eme bizarre)
• 10kg x 10, | 18kg x 12 ,12 ,10
• 10 kg x 15 (est ce qui faut augmenter le poid pour l’échauffement?) | 18kg x 12, 12, 8
• 10kg x 15 | 18kg x 12, 12, 9 (j’ai pris 4 jours de repos entre cette séance et la séance jambe)
• 10kg x 15 | 18kg x 12, 12, 9
• 10kg x 15 | 18kg x 10, 10, 10
• 10kg x 15 | 18kg x 10, 10 , 8
• 16kg x 12, 12, 11 (12 mais la dernière 90% d’amplitude donc 11)
• 16kg x 10, 10 , 8
• 14kg x 12, 10, 6
• 14kg × 6 | 12kg × 5, 6

Tirage vertical :
• 22/10/2026 (Objectif) : 50kg x 12, 12, 12 (repos : 2min)
• 15/10/2026 : 50kg x 11, 11, 11 (repos : 2min)
• 08/10/2026 : 50kg x 10, 10, 10  (dur) (repos : 2min)
• 05/10/2026 : 45kg x 12, 12, 12 (repos : 2min)
• 30/09/2026 : 45kg x 12, 12, 11 (repos : 2min)
• 45kg x 10, 10, 10,
• ça fait une semaine je suis pas allé 50kg x 12, 12, 12 (mais les dernière étaient compliqué sur le mouvement)
• 50kg x 12, 12, 10
• trop de gens donc je fais le shoulder press d’abord
• 50kg x 12, 11, 10 (ça devient dur de tirer tout en bas)
• 50kg x 11, 10, 9 (les deux dernière auraient pu être un peu meilleur)
• 50kg x 10, 10, 8
• 45kg x 12, 12, 12
• 45kg x 12, 12, 11
• 45kg x 12, 12, 10
• 45kg x 12, 10, 9
• 45kg x 10, 10 , 8
• 35kg x 12 | 40kg x 12, 12, 12
• 35kg × 12, 12, 10, 10 | 40kg × 6 | 35kg × 11

Chest press (machine) :
• 22/10/2026 (Objectif) : 25kg x 12 | 22,5kg x 12, 10 (échec)  (repos : 2min30)
• 15/10/2026 : 25kg x 11 | 22,5kg x 12, 8 (repos : 2min30)
• 08/10/2026 : 25kg x 10 (j’aurai pu faire 14 sûrement max) | 22,5kg x 12 (13max ou 14), 8 (repos : 2min30)
• 05/10/2026 : 22,5kg x 12, 10, 7.5 (repos : 2min30)
• 30/09/2026 : 22,5kg x 12, 9, 7 (repos : 2min30) (chest press classique)
• (j’ai pas trouvé chest press j’ai que "Wide chest press" c’est mauvais ? Ah attend j’ai peut être trouvé chest press classique, bon wide pour l’instant car je sais pas) 20kg x 12 , 12, 12
• 22,5kg x 12, 12 (échec), 9
• 25kg x 12, 8, 6 (3min de repos)(enfaite j’ai la possibilité de faire 22,5 c’est juste que je me disais que j’avais la force pour 25)
• 20kg x 12, 12, 11 (je pense qu’on peut augmenter les poids)
• 20kg x 12, 12 (échec) , 8 (+2 après une petite pause de quelques secondes)
• 20kg x 12, 12, 11
• 20kg x 12, 12, 8 (besoin de plus de repo?)
• 20kg x 12, 12 (12eme compliqué), 9
• 15kg x 12 (simple) , 12, 12 (+ compliqué à la fin)
• 15kg x 12, 12, 8 (9 possible à l’échec)
• 15kg x 12, 9, 7 (a cause du shoulder press ?)
• 15kg x 12, 10, 7
• 15kg (par côté) × 6 | 10kg (par côté) × 8, 6

Tirage horizontal (poulie basse) :
• 22/10/2026 (Objectif) : 50kg x 9| 45kg x 11 (échec), 8 (repos : 2min30)
• 15/10/2026 : 45kg x 12, 10, 10 (repos : 2min30)
• 08/10/2026 : 45kg x 11, 9, 9 (9eme 
Compliqué) (repos : 2min30)
• 05/10/2026 : 45kg x 10, 8, 8 (repos : 2min30)
• 30/09/2026 : 45 x 12, 9 (je me suis trompé sur le poids), | 40kg x 10 (repos : 2min)
• 40kg x 12, 10, 8
• 45kg x 10, 10, 7,
• 45kg x 10, 9, 8,
• 40kg x 12, 12, 12
• 40kg x 12, 12, 10, (je me suis réveillé à 13h, c’est pas ma meilleur séance)
• 40kg x 12, 12, 10
• 40kg x 12, 11 , 10
• 40kg x 10, 10, 10
• 40kg x 8, 8, 8
• 35kg x 12, 12, 12
• 35kg x 12 , 12 , 8
• 35kg x 12, 10, 8
• 35kg × 8, 11, 9 | 30kg × 8

(Shoulder press :
• 15kg x 10, 9, 9 (j’aurai pu faire plus sur toutes les séries) J’ai arrêté cette machine (mauvais idée ?)
• 15kg x 9, (c’est dur, est ce que je dois garder mon dos collé ? Aussi c’est la machine shoulderpress de chez techngym, je fais 1m84, je dois mettre à combien le réglage du siège ?) (Je prend trop de temps de pause ?: 2eme série je suis déjà à 1h de salle), 5 c’est la cata je préfère arrêté là pour cette série.
• j’ai pas pris ma bouteille d’eau donc je préfère skip , + shoulder press occupe, + est ce que c’est une bonne idée d’enchaîner 2 exo épaule, est ce que l’organisation des exo est bien ?
• 15kg x 10 , 9 , 6 (7 après une micro pause)
• 15kg x 9, 8, 7
• 15kg x 10, 7, 5 (pourquoi ?)
• 15kg x 12, 7, 6
• 20kg (par cote) x 9, 5 | 15kg x 6)

Élévations latérales aux haltères:
• 22/10/2026 (Objectif) : 10kg  x 12-13 | 8kg x 11-12 (c’est le meilleur exo épaule pour l’amplitude oui ou non ? Car sur la fin je dois faire des micro pause sinon c’est trop), 10 (repos : 1min30)
• 15/10/2026 : 10kg x 13 | 8kg x 13, 11 (repos : 1min30)
• 08/10/2026 : 10kg x 12 (compliqué) | 8kg x 12, 10 (repos : 1min30)
• 05/10/2026 : 8kg x 15, 11, 10 (repos : 1min30)
• 30/09/2026 : 8kg x 15, 12, 11 (repos : 1min30)
• 8kg x 14, 12, 10
• 10kg x 10, 10, 10, 8
• 10kg x 10, 10, 9, 8,
• 10kg x 10, 10 (mais à chaque fois je dois faire un pause de 1ou2 secondes entre chaques rep c’est ok?) , 10, 10, (j’ai inversé les deux exo épaules car c’était occupé)
• 10kg x 10, 10, 9, 9
• 10kg x 10, 9, 8, 8ou9 (j’ai pas fait shoulder press machine)
• 8kg x 12, 12, 12 , 12
• 8kg x 12, 12, 10, 10
• 8kg x 10, 10, 10, 10
• 8kg x 12, 10, 10, 9 (10ème bizarre)
• 6kg x 15, 15 , 15(compliqué la dernière) , 14
• 6kg x 12, 12 , 12, 12 (je me suis arrêté à 12 exprès pour la première série (j’aurai pu aller à 15))

Extensions Triceps à la poulie haute avec corde :
• 22/10/2026 (Objectif) : 15kg x 11.5, 9 | 12,5kg x 11 (repos : 2min30)
• 15/10/2026 : 15kg x 11.5, 10 | 12,5kg x 11 (repos : 2min30)
• 08/10/2026 : 15kg x 11, 9 | 12,5kg x 10 (repos : 1min30) (d’habitude c’est avec la poulie extensible que je met tout en haut, la c’est avec une poulie déjà en haut)
• 05/10/2026 : 12,5kg x 15 (je pouvais en faire plus, je me limite à 15?), 15, 14 (repos : 1min30)
• 30/09/2026 : 12,5kg x 15, 15, 12 (repos : 1min30)
• 12,5kg x 12, 10, 7
• 15kg x 12, 12, 12,
• 15kg x 10, (ça fait 1h05 que je suis là y’a un problem ?), 8, 6
• 15kg x 8 (j’ai plus de bras, trop longtemps que je suis pas allé ?), | 12,5kg x 11, 8 (c’est pas ma journée) (ou peut être la poulie est trop haute ? Ça joue ?)
• 15kg x 12, 12, 8(ou 9 je sais plus)
• 15kg x 12, 10, 9
• 15kg x 12, 9, 5 , |12,5kg x 3
• 15kg x 11, 10, 10
• 15kg x 10, 7, 6, | 12kg x 2
• 15kg x 9, 7 | 12,5kg x 8,
• 12,5kg x 15 , 12, 10
• 12,5kg x 12 , 7 | 10kg x 9, 7
• 12,5kg × 12, 11, 8 | 10kg × 12

Curl Biceps Incliné aux haltères:
• 22/10/2026 (Objectif) : 10kg x 15, 10 | 10kg (1 main par 1 main) 13 (repos : 2min30)
• 15/10/2026 : 10kg x 14, 9, 12 (1 par 1 dernière a la serie) repos : 2min30)
• 08/10/2026 : 10kg x 13, 8, 10 (1 bras par 1 bras à la dernière serie) (repos : 1min30)
• 05/10/2026 : 10kg x 12, 7 (les deux bras en même temps), 9 (1 bras par 1 bras) repos : 1min30)
• 30/09/2026 : 15kg x 15, 8, 6 (repos : 1min30) (à la poulie haute. J’aurai du faire haltère ?)
• 15kg x 12, 10, 7 ()
• 20kg x 10, 10, 7,
• 20kg x 10, 10, 7,
• 20kg x 10, 10, 5 KO
• 20kg x 10, 9, 8
• 20kg x 10, 10, 6
• 20kg x 10, 10 (dur), 7
• Poulis basse
• mon lit i po 0kg x 10, 8, 5 (les fins sont durs)
• 10kg x 10, 10, (avec deux micro pause pour reprendre mon souffle, long repos sinon risque de malaise, enfin Fin (je sens le malaise venir)
• 12kg x 9 | 10kg x 5 , (altère 1 par 1:)8
• 12kg x 9 | 10kg x 8 , 5
• 10kg x 9 | 8kg x 7 | 8kg (bras 1 par 1) x 8

Développé couché barre :
• 10kg (par côté) × 11, 10, 6, 5

Incliné Chest press (machine) :
• 10kg (par côté) × 8, 7

Extension au-dessus de la tête :
• 7,5kg × 6, 8, 8, 8

Dips banc :
• Poids de corps × 6

Traction : 1 rep

Rowing barre (buste penché) : 20kg × 12, 12, 12

Oiseau buste penché : 6kg × 12, 12, 10

Shrugs haltères : 12kg × 12, 13, 14


Jambes (Legs)

Squat machine incliné :
• 10kg x 12 échauffement | 25kg x 12, 12, 12
• 20kg (par côté) × 12, 12, 12, 9

Leg press :
• 21/10/2026 (Leg press avec Poids "dans le dos" , d’habitude je faisait avec poids devant mais là c’est pris) : 50kg x 10 | 80kg x 6 | 100kg x 7 (les poids doivent être différent je trouve que c’est très lourd la) | 80kg x 12, 12 (facile, pejt etre 90 si j’ai pas l’autre) (Repos : 2min30)
• 12/10/2026 : 25kg (par côté) x 12 | 42,5kg x 10 | 40kg x 12, 11 (Repos : 2min30)
• 07/10/2026 : 25kg (par coté) x 12 | 40kg x 12, 12, 10 (Repos : 2min30)( j’ai retrouvé la machine de base mais y’a quelqun dessus donc je reste sur celle où je dois mettre les poids moi même)
• 01/10/2026 : 20kg (par coté) x 12 | 40kg x 6 | 50kg x 10, | 40kg x 11, 10 (Repos : 2min30)
• (j’ai pas trouvé le leg press j’ai trouvé que le leg press machine ou je met mes poids moi même et l’angle est bizarre je dois mettre combien c’est la même ? Celle de technogym) : 20kg (par côté) x 12 | 40kg x 12 (j’ai oublié d’enlever la sécurité) 11, 10,
• (ça fait 8j je suis pas allé à la salle) : 50kg x 10 | 80kg x 6 | 100kg x 12, 12, 10
• (ça fait 6j je suis pas allé) 50kg x 10 | 80kg x 5 | 100kg x 12, 11, 10
• 50kg x 10 | 80kg x 6 | 100kg x 10, 10, 10
• 60kg x 12 | 90kg x 10, 10, 10. ( j’ai pas osé faire plus comme ça fait un moment que je suis pas allé)
• 60kg x 12 | 90kg x 9 , 9 , 9 (3jours que je suis pas allé à la salle depuis la séance Up)
• 50kg x 14 | 80kg x 12, 12, 12(réglage à 2/3) c’est beaucoup plus simple avec ce réglage
• 50 x 14 | 80kg x 12, 11, 10
• 50kg x 15 | 80kg x 10, 10, 10
• 50kg x 12 Échauffement | 70kg x 12, 11 , 11
• 50kg x 12 (échauffement) | 60kg x 10, 10, 10

Soulevé de Terre Roumain :
• 21/10/2026 : 22kg x 12 | 20kg x 12, 12 (Repos : 2min30)
• 12/10/2026 : 22kg x 10 | 20kg x 12, 12 (Repos : 2min30)
• 07/10/2026 : 20kg x 12, 12, 11 (Repos : 2min30)
• 01/10/2026 : 20kg x 12, 11, 10 (Repos : 2min30)
• 18kg x 12, 12, 12 (finalement j’ai retrouvé toutes les autres machines elles étaient en haut , (je garde celles que j’ai trouvé où je prend celles que je prenais avant ?))
• 22kg x 12, (j’ai du prendre plus de repo car très essoufflé) 10, 9
• 22kg x 12, 12, 12 (je suis ko)
• 22kg x 12 , 10 (j’ai mal compté je crois, peut-être plus), 10
• 20kg x 11, 12, 12 (j’aurai pu faire 12 la première ) je suis très essoufflé à la fin.
• 20 x 10, 11,
• 18 x 12, 12, 12
• 16kg x 12, 12, 12
• 16kg x 10, 12, 12 (comment savoir si je fais bien le mouvement ? Je dois sentir quoi)
• 14kg x 12, 12, 12
• 14kg x 12, 7, 8(ça tire derrière les genoux)
• 14kg x 12, 12, 12 (mouvement pas parfait ?)

Leg extension :
• 21/10/2026 : 50kg x 12 | 55kg x 10 , 9  (Repos : 2min30)
• 12/10/2026 : 50kg x 10, 10, 10 (Repos : 2min)
• 07/10/2026 : 45kg x 12, 12, 12 (dur sur la fin) (Repos : 2min)
• 01/10/2026 : 45kg x 12, 10, 8 (Repos : 2min)
• 45kg x 12, 12 (ça brule) , 10
• 55kg x 12, 9, (je commence à m’endormir), 7
• 55kg x 12, 8 (j’ai respiré trop vite peut être j’allais faire un malaise, 2minutes trop peu?(, 8
• 55kg x 12, 11, 8 (10 après quelques secondes de pause)
• 55kg x 12, 10, 8
• 50kg x 10, 10, 10 (moyen/facile)
• 45kg x 12, 12, 12,
• 40kg x 12, 12, 12 (dur la fin)
• "": 40kg x 12, 12,
• Machine 2: 35kg x 15, | 40kg x 12, 11
• Machine 1: 20kg (par cote) x 10, 10, 6
• Machine 2 : 35kg x 12, 11 , 10
• Machine 1 : 15kg (par côté) × 8 | 10kg × 12, 12

Leg curl :
• 21/10/2026 : 50kg x 12 | 50kg x 10, 8 (Repos : 2min30)
• 12/10/2026 : 50kg x 8-10 | 45kg x 12, 9 (Repos : 2min)
• 07/10/2026 : 45kg x 12, 10, 7 (je suis cuit) (Repos : 2min)
• 01/10/2026 : 45kg x 10, 10, 9 (Repos : 2min)
• curl normal : 40kg x 12, 12, 12,
• (prone leg curl car autre pas dispo) 35kg x 10 (j’en ai marre d’être la, je suis trop fatigué je vais rentrer)
• 45kg x 12, 10, 6
• 45kg x 12 , 12, 9 (manque de souffle )
• 45kg x 12, 11, 9
• 45kg x 12, 10, 8
• 40kg x 12, 12, 12,
• 40kg x 12, 12, 11 (je me suis trompé sur l’ordre j’ai fait extension avant curl cette séance)
• 40kg x 10, 10, 10
• 35kg x 12, 12, 12 (compliqué sur la fin)
• 30kg x 12 | 35kg x 11, 11
• 25kg x 12 | 30kg x 10, 9

Machine assis (mollets) :
• 21/10/2026 : 40kg x 15, 15, 12, 12(Repos : 2min)
• 12/10/2026 : 20kg x 15 | 30kg x 13 (j’aurai pu faire 15 mais je me suis limite , 15 13 (Repos : 1min30)
• 07/10/2026 : 20kg x 15 (trop facile) | 30kg x 12, 12, 12 (Repos : 1min30)
• 01/10/2026 : 20kg x 15 | 25kg x 15, 15 15 (Repos : 1min30)
• (machine ou je suis debout (Calf)) 15kg x 12 | 20kg x 15 ,15
• 25kg x 15, 13, 10, 10 (rep pas tout en haut a la fin)
• 20kg x 15, 15, 15, 14 (échec)
• haltère 16kg x 15, 14, | 20kg (machine) 15, 12
• 20kg x 15, 15, 14, 12
• 20kg x 15, 15, 12, 10
• 20kg x 15, 13.5 , 12 (dur), 11
• 20kg x 15, 14, 11, 10
• haltères de 16kg x 15, 12, 10,
• 20kg x 15, 13, 11, 9
• 20kg x 15, 11 , 10, 10
• 10kg (par côté) × 15 | 15kg (par côté) × 13, 12, 12

Total abdominaux (machine assis crunch vers le bas) :
• 21/10/2026 : 55kg x 13 | 50kg x 15, 13 (Repos : 1min30)
• 12/10/2026 : 55kg x 12 | 50kg x 15, 12 (Repos : 1min30)
• 07/10/2026 : 50kg x 15, 14, 11 (Repos : 1min30)
• 01/10/2026 : 50kg x 15, 13, 10 (Repos : 1min30)
• je sais pas si ya la machine dans cette salle pour l’instant je fais pas, est ce que ça sert à quelque chose même ?
• 50kg x 15, 12, 8
• 50kg x 15, 15, 12
• ça fait un moment que je suis pas allé, je préfère ne pas faire des séries
• 50kg x 13, 13, 13
• 50kg x 12, 12, 11
• 45kg x 15, 15, 15
• 45kg x 15, 15, 13
• 45kg x 13, 12, 11
• 40kg x 15, 15, 15

Squat haltère :
• 10kg × 12 | 14kg × 15, 15, 15`
