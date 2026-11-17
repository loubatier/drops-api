type Json = Record<string, any>;

const LOCKED_OPERATIONS: [string, string][] = [
  ['/drops/{id}/like', 'post'],
  ['/drops/{id}/like', 'delete'],
  ['/drops/{id}/comments', 'get'],
  ['/drops/{id}/comments', 'post'],
];

const GEO_DESCRIPTION =
  '\n\n**Bloc 2.** `near=lat,lng` (avec `radius` en mètres, 1000 par défaut) filtre les drops proches et ajoute `distanceM` ; `sort=distance` (défaut avec `near`) trie du plus proche au plus loin. ' +
  '`bbox=minLng,minLat,maxLng,maxLat` filtre par rectangle (**longitude d\'abord**, ordre GeoJSON ; Leaflet utilise `[lat, lng]`) et autorise `pageSize` jusqu\'à 200. `near` et `bbox` s\'excluent. ' +
  'Pour un drop verrouillé, filtres et `distanceM` utilisent sa position approchée, et `q` ne cherche jamais dans son contenu caché.';

export function applyBlock2Additions(document: Json): Json {
  const schemas = document.components?.schemas ?? {};
  const error = schemas.ErrorResponse?.properties?.error;
  if (error?.properties) {
    error.properties.meta = {
      type: 'object',
      additionalProperties: true,
      description: 'Informations complémentaires sur certaines erreurs (`too_far`). Absent dans les autres cas.',
    };
  }
  const drop = schemas.Drop;
  if (drop?.properties) {
    drop.properties.distanceM = {
      type: 'integer',
      description: 'Distance en mètres. Présent uniquement quand la requête utilise `near`.',
    };
  }
  for (const [path, method] of LOCKED_OPERATIONS) {
    const responses = document.paths?.[path]?.[method]?.responses;
    if (!responses || responses['403']) continue;
    responses['403'] = {
      description: 'Drop verrouillé : ouvrez-le avant de voir ou de réagir (`drop_locked`, quand `lockMode` vaut `on`).',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/ErrorResponse' },
          example: {
            error: {
              status: 403,
              code: 'drop_locked',
              message: 'Ouvrez ce drop pour voir et réagir.',
              fields: {},
              requestId: 'req_8f2c1a3b',
              simulated: false,
            },
          },
        },
      },
    };
  }
  const list = document.paths?.['/drops']?.get;
  if (list) list.description = `${list.description ?? ''}${GEO_DESCRIPTION}`;
  const detail = document.paths?.['/drops/{id}']?.get;
  if (detail) {
    detail.description = `${detail.description ?? ''}\n\n**Bloc 2.** Quand \`lockMode\` vaut \`on\`, un drop que l'appelant n'a ni écrit ni ouvert est renvoyé verrouillé : \`locked: true\`, \`content\` et \`imageUrl\` à \`null\`, position arrondie à 3 décimales (\`precision: "approx"\`).`;
  }
  return document;
}
