import type { ZodTypeAny, z } from 'zod';
import { type Fields, validationFailed } from './errors.js';

const KEY_ALIASES: Record<string, string> = { lat: 'location', lng: 'location' };

export function validate<T extends ZodTypeAny>(schema: T, data: unknown, aliasCoordinates = false): z.infer<T> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const fields: Fields = {};
  const add = (key: string, message: string) => {
    const k = aliasCoordinates ? (KEY_ALIASES[key] ?? key) : key;
    const list = (fields[k] ??= []);
    if (!list.includes(message)) list.push(message);
  };
  for (const issue of result.error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) add(key, 'Champ inconnu.');
    } else {
      add(issue.path.length > 0 ? String(issue.path[0]) : 'body', issue.message);
    }
  }
  throw validationFailed(fields);
}
