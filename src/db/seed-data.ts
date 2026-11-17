export interface SeedUser {
  username: string;
  displayName: string;
  bio: string | null;
}

export const SEED_PASSWORD = 'drops2026';

export const SEED_USERS: SeedUser[] = [
  { username: 'mathis', displayName: 'Mathis', bio: null },
  { username: 'noah', displayName: 'Noah', bio: null },
  { username: 'ethan', displayName: 'Ethan', bio: null },
  { username: 'paul', displayName: 'Paul', bio: null },
  { username: 'paolo', displayName: 'Paolo', bio: null },
  { username: 'nicolas', displayName: 'Nicolas', bio: null },
  { username: 'ugo', displayName: 'Ugo', bio: null },
  { username: 'bryan', displayName: 'Bryan', bio: null },
  { username: 'tom', displayName: 'Tom', bio: 'Fan de devinettes.' },
];

export interface SeedDrop {
  author: string;
  category: 'note' | 'photo' | 'tip' | 'riddle';
  title: string;
  content: string;
}

export const SEED_DROPS: SeedDrop[] = [
  { author: 'mathis', category: 'note', title: 'Coucou', content: 'Un petit mot pour celles et ceux qui passent par ici. Bonne journée !' },
  { author: 'noah', category: 'tip', title: 'Prises électriques', content: 'Il y a des prises cachées sous les tables du hall. Pense à ton chargeur.' },
  { author: 'ethan', category: 'photo', title: 'Reflets après la pluie', content: 'Le parking vu de près, on dirait un miroir.' },
  { author: 'paul', category: 'note', title: 'Bug du jour', content: "J'ai cherché mon erreur pendant une heure. Il manquait une virgule." },
  { author: 'paolo', category: 'tip', title: 'Déjeuner au soleil', content: 'Les marches côté sud sont chaudes dès midi, même en novembre.' },
  { author: 'nicolas', category: 'photo', title: 'Ciel orange', content: 'Dix minutes de couleurs, pas de filtre.' },
  { author: 'ugo', category: 'note', title: 'Chut', content: 'La salle du fond est enfin silencieuse. Ne le dites à personne.' },
  { author: 'bryan', category: 'tip', title: 'Imprimer sans queue', content: 'Va imprimer avant 9h ou après 17h. Entre les deux, c’est la file.' },
  { author: 'tom', category: 'riddle', title: 'Énigme du clavier', content: 'J’ai beaucoup de touches mais aucune serrure. Qui suis-je ?' },
];
