import type { Config } from '../../config.js';
import { haversineMeters } from '../../geo.js';
import { z } from '../../openapi/zod.js';
import { CATEGORIES, httpsUrl } from '../../schemas.js';

export const titleField = z.string().trim().min(3, 'Le titre doit faire au moins 3 caractères.').max(80, 'Le titre doit faire au plus 80 caractères.');
export const contentField = z.string().trim().min(1, 'Entre 1 et 1000 caractères.').max(1000, 'Entre 1 et 1000 caractères.');
export const categoryField = z.enum(CATEGORIES, { errorMap: () => ({ message: 'Catégorie inconnue.' }) });
export const latField = z
  .number()
  .min(-90, 'La latitude doit être comprise entre -90 et 90.')
  .max(90, 'La latitude doit être comprise entre -90 et 90.');
export const lngField = z
  .number()
  .min(-180, 'La longitude doit être comprise entre -180 et 180.')
  .max(180, 'La longitude doit être comprise entre -180 et 180.');

export function zoneMessage(config: Config): string {
  const km = config.zone.radiusM / 1000;
  return `Ce point est en dehors de la zone autorisée (${String(km).replace('.', ',')} km autour du département MMI).`;
}

export function isInZone(config: Config, lat: number, lng: number): boolean {
  return haversineMeters(config.zone.lat, config.zone.lng, lat, lng) <= config.zone.radiusM;
}

const coordinatesInRange = (lat: unknown, lng: unknown): boolean =>
  typeof lat === 'number' && typeof lng === 'number' && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

export function dropSchemas(config: Config) {
  const message = zoneMessage(config);

  const createBody = z
    .object({
      title: titleField,
      content: contentField,
      category: categoryField,
      imageUrl: httpsUrl.nullable().optional(),
      lat: latField,
      lng: lngField,
    })
    .strict()
    .superRefine((value, ctx) => {
      if (value.category === 'photo' && !value.imageUrl) {
        ctx.addIssue({ code: 'custom', path: ['imageUrl'], message: 'Une photo a besoin d’une image.' });
      }
      if (coordinatesInRange(value.lat, value.lng) && !isInZone(config, value.lat as number, value.lng as number)) {
        ctx.addIssue({ code: 'custom', path: ['location'], message });
      }
    });

  const patchBody = z
    .object({
      title: titleField.optional(),
      content: contentField.optional(),
      category: categoryField.optional(),
      imageUrl: httpsUrl.nullable().optional(),
      lat: latField.optional(),
      lng: lngField.optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
      if (Object.keys(value).length === 0) {
        ctx.addIssue({ code: 'custom', path: [], message: 'Renseignez au moins un champ à modifier.' });
      }
      if ((value.lat === undefined) !== (value.lng === undefined)) {
        ctx.addIssue({
          code: 'custom',
          path: ['location'],
          message: 'La latitude et la longitude doivent être envoyées ensemble.',
        });
      } else if (coordinatesInRange(value.lat, value.lng) && !isInZone(config, value.lat as number, value.lng as number)) {
        ctx.addIssue({ code: 'custom', path: ['location'], message });
      }
    });

  return { createBody, patchBody };
}
