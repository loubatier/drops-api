export interface SeedUser {
  username: string;
  displayName: string;
  bio: string | null;
  hasDrops: boolean;
}

export const SEED_PASSWORD = 'drops2026';

export const SEED_USERS: SeedUser[] = [
  { username: 'demo', displayName: 'Demo', bio: 'Compte de démonstration, ouvert à tous les tests.', hasDrops: true },
  { username: 'lea', displayName: 'Léa', bio: 'Je cherche les bancs au soleil.', hasDrops: true },
  { username: 'yanis', displayName: 'Yanis', bio: 'Café, code, et rarement dans cet ordre.', hasDrops: true },
  { username: 'camille', displayName: 'Camille', bio: null, hasDrops: true },
  { username: 'hugo', displayName: 'Hugo', bio: 'Photographe du dimanche.', hasDrops: true },
  { username: 'ines', displayName: 'Inès', bio: null, hasDrops: true },
  { username: 'noe', displayName: 'Noé', bio: 'Toujours à la bibliothèque.', hasDrops: true },
  { username: 'manon', displayName: 'Manon', bio: null, hasDrops: true },
  { username: 'lucas', displayName: 'Lucas', bio: 'Je collectionne les raccourcis.', hasDrops: true },
  { username: 'sarah', displayName: 'Sarah', bio: null, hasDrops: true },
  { username: 'tom', displayName: 'Tom', bio: 'Fan de devinettes.', hasDrops: true },
  { username: 'jade', displayName: 'Jade', bio: null, hasDrops: true },
  { username: 'zoe', displayName: 'Zoé', bio: 'Je viens d’arriver, je lis surtout.', hasDrops: false },
];

export interface SeedDropText {
  title: string;
  content: string;
}

export const NOTES: SeedDropText[] = [
  { title: 'Coucou', content: 'Un petit mot pour celles et ceux qui passent par ici. Bonne journée !' },
  { title: 'Il pleut encore', content: 'Troisième jour de pluie. Le moral tient grâce au chocolat chaud.' },
  { title: 'Mot du matin', content: "Le café de 8h est la seule raison pour laquelle je suis à l'heure." },
  { title: 'Courage', content: 'Rendu de projet dans trois jours. On respire, on avance, on boit de l’eau.' },
  { title: 'Merci', content: "Merci à la personne qui a ramassé mes clés hier. Tu te reconnaîtras." },
  { title: 'Fin de semaine', content: 'Plus que quelques heures avant le week-end. Tenez bon.' },
  { title: 'Cherche binôme', content: "Cherche quelqu'un pour relire mon code. Je paie en biscuits." },
  { title: 'Ciel du soir', content: 'Le coucher de soleil de ce soir valait le détour. Levez les yeux.' },
  { title: 'Chut', content: "La salle du fond est enfin silencieuse. Ne le dites à personne." },
  { title: 'Bug du jour', content: "J'ai cherché mon erreur pendant une heure. Il manquait une virgule." },
  { title: 'Paix à la machine', content: 'La machine à café a rendu l’âme. Paix à son dernier gobelet.' },
  { title: 'Premier jour', content: "Arrivé en avance, la porte était encore fermée. Classique." },
  { title: 'Playlist', content: 'Un morceau instrumental, le casque sur les oreilles, et le trajet passe tout seul.' },
  { title: 'Petit pas', content: "Aujourd'hui j'ai déployé mon premier site. Il est moche mais il est en ligne." },
  { title: 'Ça sent le pain', content: "Quelqu'un a croisé la boulangerie à l'angle ce matin ? L'odeur est incroyable." },
  { title: 'Pause', content: 'Dix minutes dehors, sans écran. C’est gratuit et ça marche.' },
  { title: 'Clin d’œil', content: "À celui qui sourit tous les matins dans le bus : merci, ça aide." },
  { title: 'Dernier mot', content: 'Un drop pour dire que ce quartier est plus sympa qu’on ne le croit.' },
];

export const TIPS: SeedDropText[] = [
  { title: 'Le banc le plus calme du coin', content: "Derrière le bâtiment, à l'ombre. Idéal pour réviser." },
  { title: 'Prises électriques', content: 'Il y a des prises cachées sous les tables du hall. Pense à ton chargeur.' },
  { title: 'Café moins cher', content: 'Le distributeur du premier étage est moins cher que celui du rez-de-chaussée.' },
  { title: 'Imprimer sans queue', content: 'Va imprimer avant 9h ou après 17h. Entre les deux, c’est la file.' },
  { title: 'Wi-Fi capricieux', content: 'Le réseau est meilleur près des grandes fenêtres, côté parking.' },
  { title: 'Déjeuner au soleil', content: 'Les marches côté sud sont chaudes dès midi, même en novembre.' },
  { title: 'Raccourci', content: 'Le petit chemin entre les deux parkings fait gagner trois minutes à pied.' },
  { title: 'Casier libre', content: 'Les casiers du couloir ont parfois une clé oubliée. Demande à l’accueil.' },
  { title: 'Salle de travail', content: 'La salle du deuxième est presque toujours vide le jeudi après-midi.' },
  { title: 'Parapluie de secours', content: "Il y a une boîte à parapluies oubliés à l'entrée. Sers-toi, puis rends-le." },
  { title: 'Sandwich malin', content: "La boulangerie à l'angle fait une formule étudiant. Demande-la." },
  { title: 'Vélo en sécurité', content: "Attache ton vélo à l'arceau près de l'entrée, pas à la rambarde : elle est bancale." },
  { title: 'Pause lecture', content: 'La bibliothèque la plus proche ferme tard le mardi. Parfait pour finir un rendu.' },
  { title: 'Eau gratuite', content: 'La fontaine du hall est fraîche et gratuite. Garde une gourde.' },
  { title: 'Radiateurs', content: 'Les radiateurs de la salle B tiennent mieux la chaleur : prends-la pour les cours longs.' },
  { title: 'Lumière du matin', content: "Au bord de l'eau, le matin, la lumière est parfaite pour tes projets photo." },
  { title: 'Éviter la foule', content: 'Le self est calme à 11h45. À midi pile, c’est la ruée.' },
  { title: 'Sacs à dos', content: "Il y a un coin pour poser les sacs à l'entrée de l'amphi, évite le couloir." },
];

export const PHOTOS: SeedDropText[] = [
  { title: 'Reflets après la pluie', content: 'Le parking vu de près, on dirait un miroir.' },
  { title: 'Vue depuis la fenêtre', content: 'Ce que je regarde quand le cours est long.' },
  { title: 'Le mur gris', content: 'Quelqu’un a dessiné un soleil dessus. Ça change tout.' },
  { title: 'Le chat du quartier', content: 'Il garde l’entrée comme un videur et ne laisse passer personne sans caresse.' },
  { title: 'Ciel orange', content: 'Dix minutes de couleurs, pas de filtre.' },
  { title: 'Feuilles d’automne', content: 'Le tapis devant l’entrée, glissant mais magnifique.' },
  { title: 'Escalier en spirale', content: 'Je le prends toujours, même quand l’ascenseur est libre.' },
  { title: 'Brume sur la rivière', content: 'Sept heures du matin, personne dehors, tout est calme.' },
  { title: 'Café du matin', content: 'Le rituel avant de s’asseoir devant l’écran.' },
  { title: 'Le vélo oublié', content: 'Il est là depuis des semaines. Quelqu’un le réclame ?' },
  { title: 'Lumière d’après-midi', content: 'La salle de TP en fin de journée, presque belle.' },
  { title: 'Premier givre', content: 'Le banc ce matin, avant que le soleil ne passe.' },
];

export const RIDDLES: SeedDropText[] = [
  { title: 'Devinette de la serviette', content: 'Plus je sèche, plus je suis mouillée. Qui suis-je ?' },
  { title: 'Énigme du clavier', content: 'J’ai beaucoup de touches mais aucune serrure. Qui suis-je ?' },
  { title: 'Énigme de l’escalier', content: 'Je monte et je descends sans jamais bouger. Qui suis-je ?' },
  { title: 'Énigme du vide', content: 'Plus on m’enlève de matière, plus je deviens grand. Qui suis-je ?' },
  { title: 'Énigme de l’écho', content: 'Je parle sans bouche et j’entends sans oreilles. Qui suis-je ?' },
  { title: 'Énigme du peigne', content: 'J’ai des dents mais je ne mords jamais. Qui suis-je ?' },
  { title: 'Énigme du lendemain', content: 'Je suis toujours devant toi, mais tu ne peux jamais me voir. Qui suis-je ?' },
  { title: 'Énigme du sous-bois', content: 'J’ai un chapeau mais pas de tête, un pied mais pas de chaussure. Qui suis-je ?' },
  { title: 'Énigme de la cuisine', content: 'Je suis plein de trous et pourtant je retiens l’eau. Qui suis-je ?' },
  { title: 'Énigme du ciel', content: 'Je vole sans ailes et je pleure sans yeux. Qui suis-je ?' },
  { title: 'Énigme de la flamme', content: 'Donne-moi à manger et je vis, donne-moi à boire et je meurs. Qui suis-je ?' },
  { title: 'Énigme du prénom', content: 'Je t’appartiens, mais les autres m’utilisent plus que toi. Qui suis-je ?' },
];

export const COMMENTS: string[] = [
  'Validé !',
  'Merci pour le tuyau.',
  "Haha, j'y suis passé ce matin.",
  'Super idée, je teste demain.',
  'Trop vrai.',
  'Je confirme, c’est le meilleur coin.',
  'Ça m’a fait sourire.',
  'Bien vu !',
  'Je ne connaissais pas, merci.',
  'Pareil pour moi.',
  'Courage à toi !',
  'Belle photo.',
  'Dur, celle-là.',
  'Je sèche complètement…',
  'Ah, je pensais être le seul.',
  'Merci, ça tombe bien.',
  'On se croise là-bas ?',
  'Excellent.',
  'Je vote pour.',
  'Même constat de mon côté.',
  'À refaire !',
  'Ça change la journée.',
  'Noté, merci.',
  "J'adore.",
  'Pas faux.',
  'Très utile.',
  'Je file voir ça.',
  'J’ai ma petite idée sur la réponse.',
];
