import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

z.setErrorMap((issue, ctx) => {
  switch (issue.code) {
    case 'invalid_type':
      if (issue.received === 'undefined') return { message: 'Champ requis.' };
      if (issue.expected === 'number' || issue.expected === 'integer') return { message: 'Doit être un nombre.' };
      if (issue.expected === 'string') return { message: 'Doit être une chaîne de caractères.' };
      if (issue.expected === 'boolean') return { message: 'Doit être un booléen.' };
      if (issue.expected === 'object') return { message: 'Doit être un objet.' };
      return { message: 'Type invalide.' };
    case 'too_small':
      if (issue.type === 'string') return { message: `Au moins ${issue.minimum} caractères.` };
      return { message: `Doit être supérieur ou égal à ${issue.minimum}.` };
    case 'too_big':
      if (issue.type === 'string') return { message: `Au plus ${issue.maximum} caractères.` };
      return { message: `Doit être inférieur ou égal à ${issue.maximum}.` };
    case 'invalid_enum_value':
      return { message: 'Valeur non autorisée.' };
    case 'invalid_string':
      return { message: 'Format invalide.' };
    case 'unrecognized_keys':
      return { message: 'Champ inconnu.' };
    default:
      return { message: ctx.defaultError };
  }
});

export { z };
