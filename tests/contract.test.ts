import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildTestApp } from './helpers.js';

const reference = JSON.parse(readFileSync(new URL('./contract/openapi-block1.json', import.meta.url), 'utf8'));
const referenceContract = readFileSync(new URL('./contract/contract-block1.md', import.meta.url), 'utf8');

const IGNORED_KEYS = new Set(['description', 'summary', 'example', 'examples']);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const keyOf = (item: Record<string, unknown>) => `${String(item.in ?? '')}:${String(item.name)}`;

function compatible(ref: unknown, cur: unknown, path: string, errors: string[]): void {
  const key = path.split('.').pop() ?? '';
  if (Array.isArray(ref)) {
    if (!Array.isArray(cur)) return void errors.push(`${path} : tableau attendu`);
    if (key === 'enum') {
      for (const v of ref) if (!cur.includes(v)) errors.push(`${path} : valeur ${String(v)} retirée`);
      return;
    }
    if (key === 'required') {
      if ([...ref].sort().join() !== [...cur].sort().join()) errors.push(`${path} : champs requis modifiés`);
      return;
    }
    if (ref.length > 0 && ref.every((i) => isObject(i) && 'name' in i)) {
      const byKey = new Map((cur as Record<string, unknown>[]).map((i) => [keyOf(i), i]));
      for (const item of ref as Record<string, unknown>[]) {
        const match = byKey.get(keyOf(item));
        if (!match) errors.push(`${path} : ${keyOf(item)} retiré`);
        else compatible(item, match, `${path}[${keyOf(item)}]`, errors);
      }
      const known = new Set((ref as Record<string, unknown>[]).map(keyOf));
      for (const item of cur as Record<string, unknown>[]) {
        if (!known.has(keyOf(item)) && item.required === true) errors.push(`${path} : ${keyOf(item)} ajouté et obligatoire`);
      }
      return;
    }
    if (ref.length !== cur.length) return void errors.push(`${path} : longueur ${ref.length} devenue ${cur.length}`);
    ref.forEach((item, i) => compatible(item, cur[i], `${path}[${i}]`, errors));
    return;
  }
  if (isObject(ref)) {
    if (!isObject(cur)) return void errors.push(`${path} : objet attendu`);
    for (const k of Object.keys(ref)) {
      if (IGNORED_KEYS.has(k)) continue;
      if (!(k in cur)) errors.push(`${path}.${k} : retiré`);
      else compatible(ref[k], cur[k], `${path}.${k}`, errors);
    }
    return;
  }
  if (key === 'maximum' && typeof ref === 'number' && typeof cur === 'number') {
    if (cur < ref) errors.push(`${path} : borne réduite`);
    return;
  }
  if (ref !== cur) errors.push(`${path} : ${JSON.stringify(ref)} devenu ${JSON.stringify(cur)}`);
}

describe('contrat du bloc 1', () => {
  it('tout le bloc 1 est présent et inchangé, seuls des ajouts facultatifs sont tolérés', async () => {
    const { api } = buildTestApp();
    const res = await api.get('/openapi.json');
    expect(res.status).toBe(200);
    const errors: string[] = [];
    compatible(reference, res.body, 'openapi', errors);
    expect(errors).toEqual([]);
  });

  it('contract.md garde le contenu du bloc 1 et gagne une section « Bloc 2 »', async () => {
    const { api } = buildTestApp();
    const res = await api.get('/contract.md');
    expect(res.text).toContain('## Bloc 2');
    for (const line of referenceContract.split('\n').filter((l) => /^(GET|POST|PATCH|DELETE)\s/.test(l))) {
      expect(res.text).toContain(line);
    }
  });

  it('le vérificateur détecte une rupture de contrat', () => {
    const broken = JSON.parse(JSON.stringify(reference));
    delete broken.paths['/drops'].get.responses['200'];
    broken.components.schemas.Drop.required.push('distanceM');
    const errors: string[] = [];
    compatible(reference, broken, 'openapi', errors);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});
