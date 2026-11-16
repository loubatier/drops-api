import { readFileSync } from 'node:fs';
import { ApiError } from '../../errors.js';
import { defineRoute } from '../../http/route.js';
import { z } from '../../openapi/zod.js';

export interface DatasetPoint {
  id: unknown;
  name: unknown;
  city: unknown;
  postcode: unknown;
  department: unknown;
  lat: unknown;
  lng: unknown;
}

interface DatasetFile {
  source: { name: string; url: string; license: string; retrievedAt: string; synthetic: boolean };
  points: DatasetPoint[];
}

const DATASET_URL = new URL('../../../data/points.json', import.meta.url);

let cached: { file: DatasetFile; json: string } | null | undefined;

export function loadDataset(): { file: DatasetFile; json: string } | null {
  if (cached !== undefined) return cached;
  try {
    const file = JSON.parse(readFileSync(DATASET_URL, 'utf8')) as DatasetFile;
    const json = JSON.stringify({ source: file.source, count: file.points.length, points: file.points });
    cached = { file, json };
  } catch {
    cached = null;
  }
  return cached;
}

export function validCoordinates(p: DatasetPoint): [number, number] | null {
  if (p.lat === null || p.lng === null || p.lat === undefined || p.lng === undefined) return null;
  if (typeof p.lat === 'boolean' || typeof p.lng === 'boolean' || p.lat === '' || p.lng === '') return null;
  const lat = Number(p.lat);
  const lng = Number(p.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return [lat, lng];
}

let geojsonCache: string | null = null;
function geojson(file: DatasetFile): string {
  if (geojsonCache) return geojsonCache;
  const features: unknown[] = [];
  let skipped = 0;
  for (const p of file.points) {
    const coords = validCoordinates(p);
    if (!coords) {
      skipped += 1;
      continue;
    }
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [coords[1], coords[0]] },
      properties: { id: p.id, name: p.name, city: p.city, postcode: p.postcode, department: p.department },
    });
  }
  geojsonCache = JSON.stringify({ type: 'FeatureCollection', features, skipped, source: file.source });
  return geojsonCache;
}

const PointSchema = z
  .object({
    id: z.string(),
    name: z.string().nullable(),
    city: z.string().nullable(),
    postcode: z.string().nullable(),
    department: z.string().nullable(),
    lat: z.union([z.number(), z.string()]).nullable(),
    lng: z.union([z.number(), z.string()]).nullable(),
  })
  .openapi('DatasetPoint');

const DatasetSchema = z
  .object({
    source: z.object({
      name: z.string(),
      url: z.string(),
      license: z.string(),
      retrievedAt: z.string(),
      synthetic: z.boolean(),
    }),
    count: z.number().int(),
    points: z.array(PointSchema),
  })
  .openapi('Dataset');

const GeoJsonSchema = z
  .object({
    type: z.literal('FeatureCollection'),
    features: z.array(z.object({ type: z.literal('Feature'), geometry: z.object({ type: z.literal('Point'), coordinates: z.array(z.number()) }), properties: z.record(z.unknown()) })),
    skipped: z.number().int(),
    source: z.object({ name: z.string(), url: z.string(), license: z.string(), retrievedAt: z.string(), synthetic: z.boolean() }),
  })
  .openapi('DatasetGeoJson');

const formatQuery = z.object({
  format: z
    .enum(['json', 'geojson'], { errorMap: () => ({ message: 'Doit valoir json ou geojson.' }) })
    .optional()
    .openapi({ description: '`geojson` : `FeatureCollection` (ordre `[lng, lat]`) des seuls points valides, avec le nombre de points écartés dans `skipped`.' }),
});

function anomalyText(): string {
  const data = loadDataset();
  if (!data) return '';
  const { points, source } = data.file;
  let nulls = 0;
  let strings = 0;
  let invalid = 0;
  let missingPostcode = 0;
  let missingDepartment = 0;
  for (const p of points) {
    if (p.lat === null || p.lng === null) nulls += 1;
    else if (typeof p.lat === 'string' || typeof p.lng === 'string') strings += 1;
    if (validCoordinates(p) === null) invalid += 1;
    if (!p.postcode) missingPostcode += 1;
    if (!p.department) missingDepartment += 1;
  }
  const origin = source.synthetic
    ? '**Ce jeu est synthétique** : la source était indisponible au moment de sa construction. Il compte environ 2 % d\'anomalies ajoutées volontairement (coordonnées nulles, en chaîne, inversées, à (0, 0), hors de France, illisibles).'
    : `Source réelle : ${source.name}, ${source.license}. **Aucune anomalie n'a été ajoutée** : les valeurs sont celles de la source, non corrigées.`;
  return (
    `\n\n${origin}\n\n**Anomalies réelles de ce jeu** (${points.length} points) : ${nulls} points sans coordonnées (\`lat\` et \`lng\` valent \`null\`), ` +
    `${strings} points dont les coordonnées sont des **chaînes** de caractères (\`"46.77"\`) au lieu de nombres, ${invalid} points inutilisables au total, ` +
    `${missingPostcode} sans code postal, ${missingDepartment} sans département. Certains points sont en outre-mer (Nouvelle-Calédonie…) : ils sont valides mais loin de la métropole.`
  );
}

export function datasetRoutes() {
  const example = {
    source: {
      name: 'Les bibliothèques des collectivités territoriales : adresses et données d’activité (Ministère de la Culture)',
      url: 'https://www.data.gouv.fr/datasets/adresses-des-bibliotheques-publiques-2',
      license: 'Licence Ouverte / Open Licence',
      retrievedAt: '2026-11-16T01:17:11.010Z',
      synthetic: false,
    },
    count: 15704,
    points: [{ id: 'LI3873', name: 'Médiathèque Le Poire Sur Vie', city: 'Le Poiré-sur-Vie', postcode: '85170', department: 'Vendée', lat: '46.769255', lng: '-1.505685' }],
  };
  return [
    defineRoute({
      method: 'get',
      path: '/dataset/points',
      tags: ['Jeu de données'],
      block2: true,
      summary: 'Jeu de données des bibliothèques',
      description:
        "Jeu de données ouvert (environ 15 000 bibliothèques de France) pour travailler dans un Web Worker : filtrer, regrouper et afficher des milliers de points sans bloquer l'interface. **Pas de pagination** : recevoir le jeu complet fait partie de l'exercice. Réponse compressée en gzip, mise en cache 24 h (`Cache-Control: public, max-age=86400`).\n\n" +
        "Les valeurs sont **volontairement brutes** : le serveur ne corrige rien, c'est le travail du Worker." +
        anomalyText(),
      access: 'public',
      query: formatQuery,
      responses: {
        200: { description: 'Jeu de données complet (`FeatureCollection` avec `?format=geojson`).', schema: z.union([DatasetSchema, GeoJsonSchema]), example, headers: { 'Cache-Control': '`public, max-age=86400`' } },
      },
      handler: ({ query }) => {
        const data = loadDataset();
        if (!data) throw new ApiError(503, 'service_unavailable', 'Le jeu de données est indisponible.');
        const raw = query.format === 'geojson' ? geojson(data.file) : data.json;
        return { raw, contentType: 'application/json; charset=utf-8', headers: { 'Cache-Control': 'public, max-age=86400' } };
      },
    }),
  ];
}

