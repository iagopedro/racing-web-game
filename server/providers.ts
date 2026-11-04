import { fromUrl } from 'geotiff';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import type { Feature, Geometry } from 'geojson';
import { flatTerrain, projection } from '../src/geo/coordinates.ts';
import type { Bounds, GeoPoint, ImageryReference, Terrain } from '../src/geo/types.ts';
import { chunks, HTTPError, httpsLink, json, list, record, remote, text } from './network.ts';

export function overpassQuery(bounds: Bounds): string {
  const [west, south, east, north] = bounds;
  const bbox = `${south},${west},${north},${east}`;
  return `[out:json][timeout:120][maxsize:67108864];(
    way["highway"](${bbox});
    nwr["building"]["building"!="no"](${bbox});
    nwr["natural"~"^(water|wood|scrub|grassland|wetland)$"](${bbox});
    nwr["landuse"~"^(grass|forest|meadow|recreation_ground|village_green)$"](${bbox});
    nwr["leisure"~"^(park|garden|recreation_ground|nature_reserve)$"](${bbox});
    nwr["waterway"](${bbox});
  );out geom;`;
}
export async function osm(bounds: Bounds, signal: AbortSignal): Promise<unknown> {
  const query = {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: overpassQuery(bounds) }).toString(),
  };
  const endpoint = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
  try { return await json(endpoint, signal, query); }
  catch (error) {
    if (process.env.OVERPASS_URL || signal.aborted || !(error instanceof HTTPError) || ![502, 503, 504].includes(error.status)) throw error;
    console.warn(`[geo] ${error.message}; tentando uma vez o espelho Overpass Kumi.`);
    return json('https://overpass.kumi.systems/api/interpreter', signal, query);
  }
}

export function demTile(lat: number, lon: number): string {
  const name = `Copernicus_DSM_COG_10_${lat < 0 ? 'S' : 'N'}${String(Math.abs(lat)).padStart(2, '0')}_00_${lon < 0 ? 'W' : 'E'}${String(Math.abs(lon)).padStart(3, '0')}_00_DEM`;
  return `https://copernicus-dem-30m.s3.amazonaws.com/${name}/${name}.tif`;
}

export async function elevation(center: GeoPoint, size: number, signal: AbortSignal): Promise<Terrain> {
  const terrain = flatTerrain(size);
  const { unproject } = projection(center);
  const samples = new Map<string, { lat: number; lon: number; points: { index: number; point: GeoPoint }[] }>();
  const n = terrain.segments;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const point = unproject({ x: (i / n - 0.5) * size, z: (0.5 - j / n) * size });
    const lat = Math.floor(point.lat), lon = Math.floor(point.lon), key = `${lat}:${lon}`;
    if (!samples.has(key)) samples.set(key, { lat, lon, points: [] });
    samples.get(key)!.points.push({ index: j * (n + 1) + i, point });
  }
  for (const tile of samples.values()) {
    const tiff = await fromUrl(demTile(tile.lat, tile.lon), { allowFullFile: false, blockSize: 65536, cacheSize: 64 }, signal);
    try {
      const image = await tiff.getImage();
      const [originX, originY] = image.getOrigin(), [resX, resY] = image.getResolution();
      const offset = image.getGeoKeys().GTRasterTypeGeoKey === 2 ? 0 : 0.5;
      const pixels = tile.points.map(sample => ({
        ...sample, x: (sample.point.lon - originX) / resX - offset, y: (sample.point.lat - originY) / resY - offset,
      }));
      const x0 = Math.max(0, Math.floor(Math.min(...pixels.map(sample => sample.x))));
      const y0 = Math.max(0, Math.floor(Math.min(...pixels.map(sample => sample.y))));
      const x1 = Math.min(image.getWidth(), Math.ceil(Math.max(...pixels.map(sample => sample.x))) + 2);
      const y1 = Math.min(image.getHeight(), Math.ceil(Math.max(...pixels.map(sample => sample.y))) + 2);
      const data = await image.readRasters({ window: [x0, y0, x1, y1], samples: [0], interleave: true, signal });
      const noData = image.getGDALNoData();
      for (const sample of pixels) {
        const x = Math.max(0, Math.min(x1 - x0 - 1, sample.x - x0));
        const y = Math.max(0, Math.min(y1 - y0 - 1, sample.y - y0));
        const ix = Math.floor(x), iy = Math.floor(y);
        const at = (col: number, row: number) => {
          const value = Number(data[Math.min(y1 - y0 - 1, row) * (x1 - x0) + Math.min(x1 - x0 - 1, col)]);
          if (!Number.isFinite(value) || value === noData || value < -500 || value > 9000) throw new Error('Copernicus DEM possui NoData no recorte. Escolha outra regiao ou o modo plano explicito.');
          return value;
        };
        terrain.heights[sample.index] = (at(ix, iy) * (1 - (x - ix)) + at(ix + 1, iy) * (x - ix)) * (1 - (y - iy)) +
          (at(ix, iy + 1) * (1 - (x - ix)) + at(ix + 1, iy + 1) * (x - ix)) * (y - iy);
      }
    } finally { await tiff.close(); }
  }
  terrain.datum = Math.floor(Math.min(...terrain.heights));
  terrain.heights = terrain.heights.map(height => Math.round((height - terrain.datum) * 100) / 100);
  terrain.source = 'copernicus';
  return terrain;
}

export function quadkeys(bounds: Bounds, zoom = 9): Set<string> {
  const tile = (lon: number, lat: number) => ({
    x: Math.floor((lon + 180) / 360 * 2 ** zoom),
    y: Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** zoom),
  });
  const a = tile(bounds[0], bounds[3]), b = tile(bounds[2], bounds[1]);
  const keys = new Set<string>();
  for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) {
    let key = '';
    for (let level = zoom; level > 0; level--) {
      const mask = 1 << (level - 1);
      key += String((x & mask ? 1 : 0) + (y & mask ? 2 : 0));
    }
    keys.add(key);
  }
  return keys;
}
export async function microsoft(bounds: Bounds, signal: AbortSignal, indexText?: string): Promise<Feature<Geometry, Record<string, unknown>>[]> {
  const index = indexText ?? await text(await remote(
    process.env.MS_BUILDINGS_INDEX_URL || 'https://bfppub.blob.core.windows.net/%24web/2026-08-13/dataset-links.csv', signal), 16 * 1024 * 1024);
  const wanted = quadkeys(bounds);
  const urls = index.split(/\r?\n/).slice(1).map(line => line.split(',')).filter(row => wanted.has(row[1]?.replaceAll('"', ''))).map(row => row[2]?.replaceAll('"', ''));
  if (!urls.length) throw new Error('Microsoft nao possui tiles para este recorte.');
  const result: Feature<Geometry, Record<string, unknown>>[] = [];
  for (const url of new Set(urls)) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !['bfppub.blob.core.windows.net', 'bfppub.z5.web.core.windows.net', 'minedbuildings.z5.web.core.windows.net'].includes(parsed.hostname)) throw new Error('Host inesperado no catalogo Microsoft.');
    const response = await remote(url, signal);
    let decodedBytes = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        decodedBytes += chunk.length;
        callback(decodedBytes > 768 * 1024 * 1024 ? new Error('Tile Microsoft excede 768 MB descompactado.') : null, chunk);
      },
    });
    const stream = Readable.from(chunks(response, 128 * 1024 * 1024));
    const completion = pipeline(stream, createGunzip(), limiter, { signal });
    // Observe pipeline failures immediately, then rethrow on await below.
    void completion.catch(() => {});
    const lines = createInterface({ input: limiter, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (!line.trim()) continue;
        if (line.length > 2000000) throw new Error('Footprint Microsoft excessivamente complexo.');
        const value = record(JSON.parse(line));
        const geometry = record(value.geometry);
        if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') throw new Error('Geometria Microsoft inesperada.');
        const coordinates = geometry.coordinates as number[][][] | number[][][][];
        const positions = geometry.type === 'Polygon' ? (coordinates as number[][][]).flat() : (coordinates as number[][][][]).flat(2);
        if (!positions.length || positions.some(point => !Number.isFinite(point[0]) || !Number.isFinite(point[1]))) throw new Error('Coordenadas Microsoft invalidas.');
        const xs = positions.map(point => point[0]), ys = positions.map(point => point[1]);
        if (Math.max(...xs) < bounds[0] || Math.min(...xs) > bounds[2] || Math.max(...ys) < bounds[1] || Math.min(...ys) > bounds[3]) continue;
        result.push({
          type: 'Feature', properties: record(value.properties ?? {}),
          geometry: geometry.type === 'Polygon' ? { type: 'Polygon', coordinates: coordinates as number[][][] } : { type: 'MultiPolygon', coordinates: coordinates as number[][][][] },
        });
        if (result.length > 18000) throw new Error('Muitos footprints Microsoft. Reduza a regiao.');
      }
      await completion;
    } finally { lines.close(); stream.destroy(); limiter.destroy(); }
  }
  return result;
}

export async function aerial(bounds: Bounds, signal: AbortSignal): Promise<ImageryReference[]> {
  const data = record(await json(`https://api.openaerialmap.org/meta?bbox=${bounds.join(',')}&limit=6`, signal));
  return list(data.results).map(value => {
    const item = record(value), properties = record(item.properties ?? {});
    const url = httpsLink(item.uuid);
    if (!url) throw new Error('OpenAerialMap retornou URL de imagem invalida.');
    return { source: 'OpenAerialMap', title: String(item.title), date: String(item.acquisition_start), url, preview: httpsLink(properties.thumbnail), license: 'CC BY 4.0 / Open Imagery Network' };
  });
}
export async function sentinel(bounds: Bounds, signal: AbortSignal): Promise<ImageryReference[]> {
  const data = record(await json('https://planetarycomputer.microsoft.com/api/stac/v1/search', signal, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ collections: ['sentinel-2-l2a'], bbox: bounds, limit: 3, query: { 'eo:cloud_cover': { lt: 20 } }, sortby: [{ field: 'datetime', direction: 'desc' }] }),
  }));
  return list(data.features).map(value => {
    const item = record(value), props = record(item.properties), assets = record(item.assets);
    const rendered = assets.rendered_preview ? record(assets.rendered_preview) : {};
    return {
      source: 'Sentinel-2', title: `${String(item.id)} / nuvens ${String(props['eo:cloud_cover'])}%`, date: String(props.datetime),
      url: `https://planetarycomputer.microsoft.com/api/data/v1/item/map?collection=sentinel-2-l2a&item=${encodeURIComponent(String(item.id))}`,
      preview: httpsLink(rendered.href), license: 'Copernicus Sentinel data terms',
    };
  });
}

export async function sentinelTexture(bounds: Bounds, reference: ImageryReference, signal: AbortSignal): Promise<string> {
  const item = new URL(reference.url).searchParams.get('item');
  if (reference.source !== 'Sentinel-2' || !item) throw new Error('Cena Sentinel-2 invalida para textura.');
  const url = new URL(`https://planetarycomputer.microsoft.com/api/data/v1/item/bbox/${bounds.join(',')}/1024x1024.png`);
  url.search = new URLSearchParams({
    collection: 'sentinel-2-l2a', item, assets: 'visual', asset_bidx: 'visual|1,2,3',
    dst_crs: 'EPSG:4326', coord_crs: 'EPSG:4326',
  }).toString();
  const response = await remote(url.href, signal);
  if (!response.headers.get('content-type')?.includes('image/png')) throw new Error('A fonte nao retornou uma textura PNG.');
  const bytes: Uint8Array[] = [];
  for await (const chunk of chunks(response, 4 * 1024 * 1024)) bytes.push(chunk);
  const png = Buffer.concat(bytes);
  if (png.length < 24 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
      png.readUInt32BE(16) !== 1024 || png.readUInt32BE(20) !== 1024) throw new Error('Textura Sentinel-2 invalida.');
  return `data:image/png;base64,${png.toString('base64')}`;
}
