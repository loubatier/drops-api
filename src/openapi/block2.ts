type Json = Record<string, any>;

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
  return document;
}
