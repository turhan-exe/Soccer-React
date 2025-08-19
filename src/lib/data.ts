import { Player, Match, Team, Training, FinanceRecord } from '@/types';

export const mockPlayers: Player[] = [
  {
    id: '1',
    name: 'Mehmet Özkan',
    position: 'GK',
    overall: 0.852,
    stats: { speed: 0.432, acceleration: 0.5, agility: 0.5, shooting: 0.123, passing: 0.765, defending: 0.891, dribbling: 0.234, stamina: 0.5, physical: 0.789 },
    age: 28,
    category: 'starting'
  },
  {
    id: '2',
    name: 'Ali Yılmaz',
    position: 'CB',
    overall: 0.789,
    stats: { speed: 0.567, acceleration: 0.5, agility: 0.5, shooting: 0.234, passing: 0.678, defending: 0.912, dribbling: 0.345, stamina: 0.5, physical: 0.823 },
    age: 26,
    category: 'starting'
  },
  {
    id: '3',
    name: 'Can Demir',
    position: 'CB',
    overall: 0.776,
    stats: { speed: 0.534, acceleration: 0.5, agility: 0.5, shooting: 0.267, passing: 0.689, defending: 0.898, dribbling: 0.312, stamina: 0.5, physical: 0.834 },
    age: 24,
    category: 'starting'
  },
  {
    id: '4',
    name: 'Emre Kara',
    position: 'LB',
    overall: 0.723,
    stats: { speed: 0.789, acceleration: 0.5, agility: 0.5, shooting: 0.345, passing: 0.712, defending: 0.678, dribbling: 0.567, stamina: 0.5, physical: 0.654 },
    age: 25,
    category: 'starting'
  },
  {
    id: '5',
    name: 'Burak Şen',
    position: 'RB',
    overall: 0.734,
    stats: { speed: 0.798, acceleration: 0.5, agility: 0.5, shooting: 0.356, passing: 0.723, defending: 0.689, dribbling: 0.578, stamina: 0.5, physical: 0.665 },
    age: 27,
    category: 'starting'
  },
  {
    id: '6',
    name: 'Oğuz Çelik',
    position: 'CM',
    overall: 0.812,
    stats: { speed: 0.656, acceleration: 0.5, agility: 0.5, shooting: 0.534, passing: 0.887, defending: 0.567, dribbling: 0.723, stamina: 0.5, physical: 0.678 },
    age: 24,
    category: 'starting'
  },
  {
    id: '7',
    name: 'Serkan Aydın',
    position: 'CM',
    overall: 0.798,
    stats: { speed: 0.645, acceleration: 0.5, agility: 0.5, shooting: 0.523, passing: 0.876, defending: 0.556, dribbling: 0.712, stamina: 0.5, physical: 0.667 },
    age: 26,
    category: 'starting'
  },
  {
    id: '8',
    name: 'Kemal Arslan',
    position: 'LW',
    overall: 0.845,
    stats: { speed: 0.923, acceleration: 0.5, agility: 0.5, shooting: 0.678, passing: 0.734, defending: 0.234, dribbling: 0.889, stamina: 0.5, physical: 0.567 },
    age: 23,
    category: 'starting'
  },
  {
    id: '9',
    name: 'Hakan Polat',
    position: 'RW',
    overall: 0.834,
    stats: { speed: 0.912, acceleration: 0.5, agility: 0.5, shooting: 0.667, passing: 0.723, defending: 0.223, dribbling: 0.878, stamina: 0.5, physical: 0.556 },
    age: 25,
    category: 'starting'
  },
  {
    id: '10',
    name: 'Murat Koç',
    position: 'CAM',
    overall: 0.867,
    stats: { speed: 0.734, acceleration: 0.5, agility: 0.5, shooting: 0.789, passing: 0.923, defending: 0.345, dribbling: 0.845, stamina: 0.5, physical: 0.623 },
    age: 27,
    category: 'starting'
  },
  {
    id: '11',
    name: 'Volkan Tekin',
    position: 'ST',
    overall: 0.889,
    stats: { speed: 0.823, acceleration: 0.5, agility: 0.5, shooting: 0.945, passing: 0.678, defending: 0.234, dribbling: 0.787, stamina: 0.5, physical: 0.756 },
    age: 29,
    category: 'starting'
  },
  // Bench players
  {
    id: '12',
    name: 'Yusuf Balık',
    position: 'GK',
    overall: 0.678,
    stats: { speed: 0.345, acceleration: 0.5, agility: 0.5, shooting: 0.089, passing: 0.567, defending: 0.723, dribbling: 0.123, stamina: 0.5, physical: 0.634 },
    age: 31,
    category: 'bench'
  },
  {
    id: '13',
    name: 'Fatih Güven',
    position: 'CB',
    overall: 0.634,
    stats: { speed: 0.456, acceleration: 0.5, agility: 0.5, shooting: 0.167, passing: 0.523, defending: 0.789, dribbling: 0.234, stamina: 0.5, physical: 0.678 },
    age: 30,
    category: 'bench'
  },
  {
    id: '14',
    name: 'Deniz Akın',
    position: 'CM',
    overall: 0.687,
    stats: { speed: 0.567, acceleration: 0.5, agility: 0.5, shooting: 0.445, passing: 0.734, defending: 0.456, dribbling: 0.612, stamina: 0.5, physical: 0.578 },
    age: 28,
    category: 'bench'
  },
];

export const youthPlayers: Player[] = [
  {
    id: 'y1',
    name: 'Ahmet Genç',
    position: 'ST',
    overall: 0.567,
    stats: { speed: 0.712, acceleration: 0.5, agility: 0.5, shooting: 0.634, passing: 0.456, defending: 0.123, dribbling: 0.678, stamina: 0.5, physical: 0.445 },
    age: 18,
    category: 'youth'
  },
  {
    id: 'y2',
    name: 'Berkay Yeni',
    position: 'CM',
    overall: 0.523,
    stats: { speed: 0.578, acceleration: 0.5, agility: 0.5, shooting: 0.423, passing: 0.667, defending: 0.445, dribbling: 0.567, stamina: 0.5, physical: 0.456 },
    age: 17,
    category: 'youth'
  },
];

export const upcomingMatches: Match[] = [
  {
    id: '1',
    opponent: 'Galatasaray',
    opponentLogo: '🦁',
    date: '2025-08-20',
    time: '20:00',
    venue: 'home',
    status: 'scheduled',
    competition: 'Süper Lig'
  },
  {
    id: '2',
    opponent: 'Fenerbahçe',
    opponentLogo: '🐦',
    date: '2025-08-25',
    time: '19:00',
    venue: 'away',
    status: 'scheduled',
    competition: 'Süper Lig'
  },
];

export const leagueTable: Team[] = [
  { name: 'Takımım', logo: '⚽', overall: 0.823, form: 'WWDWL', position: 3, points: 15, played: 7, won: 4, drawn: 3, lost: 0, goalDifference: 8 },
  { name: 'Galatasaray', logo: '🦁', overall: 0.889, form: 'WWWWW', position: 1, points: 21, played: 7, won: 7, drawn: 0, lost: 0, goalDifference: 15 },
  { name: 'Fenerbahçe', logo: '🐦', overall: 0.867, form: 'WWWDL', position: 2, points: 16, played: 7, won: 5, drawn: 1, lost: 1, goalDifference: 12 },
  { name: 'Beşiktaş', logo: '🦅', overall: 0.845, form: 'DWWLW', position: 4, points: 13, played: 7, won: 4, drawn: 1, lost: 2, goalDifference: 3 },
];

export const trainings: Training[] = [
  { id: '1', name: 'Hız Antrenmanı', type: 'speed', description: 'Oyuncunun hızını artırır', duration: 60 },
  { id: '2', name: 'Şut Antrenmanı', type: 'shooting', description: 'Şut gücü ve isabetini geliştirir', duration: 45 },
  { id: '3', name: 'Pas Antrenmanı', type: 'passing', description: 'Pas doğruluğunu artırır', duration: 50 },
  { id: '4', name: 'Savunma Antrenmanı', type: 'defending', description: 'Savunma yeteneklerini geliştirir', duration: 55 },
  { id: '5', name: 'Dribling Antrenmanı', type: 'dribbling', description: 'Top kontrolü ve driblingu iyileştirir', duration: 40 },
  { id: '6', name: 'Fizik Antrenmanı', type: 'physical', description: 'Fiziksel gücü artırır', duration: 70 },
];

export const financeRecords: FinanceRecord[] = [
  { id: '1', type: 'income', category: 'Maç Geliri', amount: 150000, date: '2025-08-15', description: 'Galatasaray maçı bilet gelirleri' },
  { id: '2', type: 'income', category: 'Sponsorluk', amount: 500000, date: '2025-08-10', description: 'Aylık sponsorluk ödemesi' },
  { id: '3', type: 'expense', category: 'Maaşlar', amount: 800000, date: '2025-08-01', description: 'Oyuncu ve teknik kadro maaşları' },
  { id: '4', type: 'expense', category: 'Antrenman', amount: 25000, date: '2025-08-12', description: 'Antrenman ekipmanları' },
];