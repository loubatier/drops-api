type Json = Record<string, any>;

const GEO_DESCRIPTION =
  '\n\n**Bloc 2.** `near=lat,lng` (avec `radius` en mètres, 1000 par défaut) filtre les drops proches et ajoute `distanceM` ; `sort=distance` (défaut avec `near`) trie du plus proche au plus loin. ' +
  '`bbox=minLng,minLat,maxLng,maxLat` filtre par rectangle (**longitude d\'abord**, ordre GeoJSON ; Leaflet utilise `[lat, lng]`) et autorise `pageSize` jusqu\'à 200. `near` et `bbox` s\'excluent.';

export function applyBlock2Additions(document: Json): Json {
  const schemas = document.components?.schemas ?? {};
  const drop = schemas.Drop;
  if (drop?.properties) {
    drop.properties.distanceM = {
      type: 'integer',
      description: 'Distance en mètres. Présent uniquement quand la requête utilise `near`.',
    };
  }
  const list = document.paths?.['/drops']?.get;
  if (list) list.description = `${list.description ?? ''}${GEO_DESCRIPTION}`;
  return document;
}
