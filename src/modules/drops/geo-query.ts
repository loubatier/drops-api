import { validationFailed } from '../../errors.js';
import type { Bbox, Near } from './repo.js';

const NUMBER = /^[+-]?\d+(\.\d+)?$/;

function parseNumbers(raw: string, count: number): number[] | null {
  const parts = raw.split(',').map((p) => p.trim());
  if (parts.length !== count || !parts.every((p) => NUMBER.test(p))) return null;
  return parts.map(Number);
}

export function parseNear(raw: string): Near & { radius: number } | { error: string } {
  const numbers = parseNumbers(raw, 2);
  if (!numbers) return { error: 'Format attendu : lat,lng (deux nombres séparés par une virgule).' };
  const [lat, lng] = numbers as [number, number];
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { error: 'Latitude entre -90 et 90, longitude entre -180 et 180.' };
  }
  return { lat, lng, radius: 0 };
}

export function parseBbox(raw: string): Bbox | { error: string } {
  const numbers = parseNumbers(raw, 4);
  if (!numbers) return { error: 'Format attendu : minLng,minLat,maxLng,maxLat (quatre nombres, longitude d’abord).' };
  const [minLng, minLat, maxLng, maxLat] = numbers as [number, number, number, number];
  if (Math.abs(minLng) > 180 || Math.abs(maxLng) > 180 || Math.abs(minLat) > 90 || Math.abs(maxLat) > 90) {
    return { error: 'Valeurs hors bornes : longitude entre -180 et 180, latitude entre -90 et 90.' };
  }
  if (minLng > maxLng || minLat > maxLat) {
    return { error: 'Les valeurs minimales doivent être inférieures ou égales aux maximales.' };
  }
  return { minLng, minLat, maxLng, maxLat };
}

export interface GeoParams {
  near?: string | undefined;
  radius?: number | undefined;
  bbox?: string | undefined;
  sortGiven: boolean;
  sort: string;
  pageSize: number;
}

export function resolveGeo(p: GeoParams, bboxMaxPageSize: number) {
  const fields: Record<string, string[]> = {};
  const add = (key: string, message: string) => (fields[key] ??= []).push(message);

  if (p.near !== undefined && p.bbox !== undefined) {
    add('near', 'near et bbox ne se combinent pas.');
    add('bbox', 'near et bbox ne se combinent pas.');
  }
  let near: Near | undefined;
  let bbox: Bbox | undefined;
  if (p.near !== undefined && p.bbox === undefined) {
    const parsed = parseNear(p.near);
    if ('error' in parsed) add('near', parsed.error);
    else near = { lat: parsed.lat, lng: parsed.lng, radius: p.radius ?? 1000 };
  }
  if (p.bbox !== undefined && p.near === undefined) {
    const parsed = parseBbox(p.bbox);
    if ('error' in parsed) add('bbox', parsed.error);
    else bbox = parsed;
  }
  if (p.radius !== undefined && p.near === undefined) add('radius', 'radius ne s’utilise qu’avec near.');
  if (p.sort === 'distance' && p.sortGiven && p.near === undefined) add('sort', 'sort=distance exige near.');
  const maxPageSize = p.bbox !== undefined ? Math.max(50, bboxMaxPageSize) : 50;
  if (p.pageSize > maxPageSize) {
    add('pageSize', `Doit être un entier entre 1 et ${maxPageSize}.`);
  }
  if (Object.keys(fields).length > 0) throw validationFailed(fields);
  const sort = p.sortGiven ? p.sort : near ? 'distance' : 'recent';
  return { near, bbox, sort: sort as 'recent' | 'popular' | 'distance' };
}
