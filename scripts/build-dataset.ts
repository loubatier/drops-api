import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DATASET_ID = '5c3538da9ce2e7459c6d765a';
export const DATASET_PAGE = 'https://www.data.gouv.fr/datasets/adresses-des-bibliotheques-publiques-2';
export const FALLBACK_URL =
  'https://static.data.gouv.fr/resources/adresses-des-bibliotheques-publiques-2/20250827-130724/adresses-des-bibliotheques-publiques.json';
export const SOURCE_NAME =
  'Les bibliothèques des collectivités territoriales : adresses et données d’activité (Ministère de la Culture)';
export const LICENSE = 'Licence Ouverte / Open Licence';
const OUTPUT = new URL('../data/points.json', import.meta.url);

export interface RawPoint {
  id: unknown;
  name: unknown;
  city: unknown;
  postcode: unknown;
  department: unknown;
  lat: unknown;
  lng: unknown;
}

export interface DatasetFile {
  source: { name: string; url: string; license: string; retrievedAt: string; synthetic: boolean };
  points: RawPoint[];
}

export function mapRecord(r: Record<string, unknown>): RawPoint {
  return {
    id: r.code_bib ?? null,
    name: r.nom_de_l_etablissement ?? null,
    city: r.ville ?? null,
    postcode: r.cp ?? null,
    department: r.departement ?? null,
    lat: r.latitude ?? null,
    lng: r.longitude ?? null,
  };
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CITIES: [string, string, string, number, number][] = [
  ['Paris', '75001', 'Paris', 48.8566, 2.3522],
  ['Lyon', '69001', 'Rhône', 45.764, 4.8357],
  ['Marseille', '13001', 'Bouches-du-Rhône', 43.2965, 5.3698],
  ['Toulouse', '31000', 'Haute-Garonne', 43.6047, 1.4442],
  ['Nantes', '44000', 'Loire-Atlantique', 47.2184, -1.5536],
  ['Strasbourg', '67000', 'Bas-Rhin', 48.5734, 7.7521],
  ['Montbéliard', '25200', 'Doubs', 47.5103, 6.7978],
  ['Lille', '59000', 'Nord', 50.6292, 3.0573],
  ['Bordeaux', '33000', 'Gironde', 44.8378, -0.5792],
  ['Rennes', '35000', 'Ille-et-Vilaine', 48.1173, -1.6778],
  ['Dijon', '21000', "Côte-d'Or", 47.322, 5.0415],
  ['Clermont-Ferrand', '63000', 'Puy-de-Dôme', 45.7772, 3.087],
];

export function syntheticPoints(count = 15_000): RawPoint[] {
  const rnd = mulberry32(20261123);
  const points: RawPoint[] = [];
  for (let i = 0; i < count; i++) {
    const [city, postcode, department, lat0, lng0] = CITIES[Math.floor(rnd() * CITIES.length)]!;
    const spread = 0.4 + rnd() * 1.6;
    let lat: unknown = Number((lat0 + (rnd() - 0.5) * spread).toFixed(6));
    let lng: unknown = Number((lng0 + (rnd() - 0.5) * spread * 1.4).toFixed(6));
    const roll = rnd();
    if (roll < 0.005) {
      lat = null;
      lng = null;
    } else if (roll < 0.008) {
      lat = String(lat);
      lng = String(lng);
    } else if (roll < 0.011) {
      [lat, lng] = [lng, lat];
    } else if (roll < 0.014) {
      lat = 0;
      lng = 0;
    } else if (roll < 0.017) {
      lat = Number((Number(lat) + 40).toFixed(6));
    } else if (roll < 0.02) {
      lng = 'N/A';
    }
    points.push({
      id: `SYN${String(i + 1).padStart(5, '0')}`,
      name: `Médiathèque de ${city} ${i + 1}`,
      city,
      postcode,
      department,
      lat,
      lng,
    });
  }
  return points;
}

export function describeAnomalies(points: RawPoint[]) {
  const kinds = { nullCoordinates: 0, stringCoordinates: 0, nonNumeric: 0, outOfWorld: 0, zeroZero: 0 };
  let missingPostcode = 0;
  let missingDepartment = 0;
  for (const p of points) {
    if (!p.postcode) missingPostcode += 1;
    if (!p.department) missingDepartment += 1;
    if (p.lat === null || p.lng === null || p.lat === undefined || p.lng === undefined) {
      kinds.nullCoordinates += 1;
      continue;
    }
    if (typeof p.lat === 'string' || typeof p.lng === 'string') kinds.stringCoordinates += 1;
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) kinds.nonNumeric += 1;
    else if (Math.abs(lat) > 90 || Math.abs(lng) > 180) kinds.outOfWorld += 1;
    else if (lat === 0 && lng === 0) kinds.zeroZero += 1;
  }
  return { total: points.length, ...kinds, missingPostcode, missingDepartment };
}

async function resolveJsonUrl(): Promise<string> {
  try {
    const res = await fetch(`https://www.data.gouv.fr/api/1/datasets/${DATASET_ID}/`, { signal: AbortSignal.timeout(30_000) });
    const meta = (await res.json()) as { resources?: { format: string; type: string; url: string }[] };
    const json = meta.resources?.find((r) => r.format === 'json' && r.type === 'main');
    if (json) return json.url;
  } catch {
    return FALLBACK_URL;
  }
  return FALLBACK_URL;
}

async function download(): Promise<DatasetFile> {
  const url = await resolveJsonUrl();
  const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`Téléchargement impossible : HTTP ${res.status}`);
  const records = (await res.json()) as Record<string, unknown>[];
  if (!Array.isArray(records) || records.length < 1000) throw new Error('Export inattendu : trop peu de lignes.');
  return {
    source: { name: SOURCE_NAME, url: DATASET_PAGE, license: LICENSE, retrievedAt: new Date().toISOString(), synthetic: false },
    points: records.map(mapRecord),
  };
}

export async function buildDataset(forceSynthetic = false): Promise<DatasetFile> {
  if (!forceSynthetic) {
    try {
      return await download();
    } catch (err) {
      console.error(`Source indisponible (${err instanceof Error ? err.message : err}) : jeu synthétique.`);
    }
  }
  return {
    source: {
      name: 'Jeu synthétique déterministe (source indisponible au moment de la construction)',
      url: DATASET_PAGE,
      license: LICENSE,
      retrievedAt: new Date().toISOString(),
      synthetic: true,
    },
    points: syntheticPoints(),
  };
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const file = await buildDataset(process.argv.includes('--synthetic'));
  mkdirSync(dirname(OUTPUT.pathname), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(file) + '\n');
  console.log(`${file.points.length} points écrits dans data/points.json (synthétique : ${file.source.synthetic}).`);
  console.log('Anomalies recensées :', describeAnomalies(file.points));
}
