import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { flatTerrain, regionBounds } from '../src/geo/coordinates.ts';
import { addMicrosoft, finishCity, normalizeOSM } from '../src/geo/normalize.ts';
import type { CityData, RegionRequest } from '../src/geo/types.ts';
import { COPERNICUS_NOTICE } from '../src/geo/types.ts';
import * as providers from './providers.ts';
import { json, list, record } from './network.ts';

export class Cache {
  readonly directory: string;
  constructor(directory = resolve('.geo-cache')) { this.directory = directory; }
  private path(key: string): string {
    if (!/^[a-z0-9-]{1,100}$/.test(key)) throw new Error('Identificador de cache invalido.');
    return join(this.directory, `${key}.json`);
  }
  async read<T>(key: string, maxAge = Infinity): Promise<T | undefined> {
    const path = this.path(key);
    try {
      if (Date.now() - (await stat(path)).mtimeMs > maxAge) return undefined;
      return JSON.parse(await readFile(path, 'utf8')) as T;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
      throw new Error(`Nao foi possivel ler o cache ${key}.`, { cause: error });
    }
  }
  async write(key: string, value: unknown): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const path = this.path(key), temp = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(value));
      await rename(temp, path);
    } finally { await rm(temp, { force: true }); }
  }
}

export class GeoService {
  private busy = false;
  private geocodeQueue: Promise<void> = Promise.resolve();
  private lastGeocode = 0;
  readonly cache: Cache;
  private sources: typeof providers;
  constructor(cache = new Cache(), sources = providers) { this.cache = cache; this.sources = sources; }

  async generate(request: RegionRequest, signal: AbortSignal, refresh = false): Promise<CityData> {
    const bounds = regionBounds(request.center, request.sizeKm * 1000);
    const id = createHash('sha256').update(JSON.stringify({ pipeline: 1, request })).digest('hex').slice(0, 32);
    if (!refresh) {
      const cached = await this.cache.read<CityData>(id, 24 * 60 * 60 * 1000);
      if (cached) return cached;
    }
    if (this.busy) throw new Error('Uma regiao ja esta sendo gerada. Aguarde antes de tentar novamente.');
    this.busy = true;
    try {
      const osmKey = `osm-${createHash('sha256').update(JSON.stringify([bounds, process.env.OVERPASS_URL ?? 'default'])).digest('hex')}`;
      const stored = refresh ? undefined : await this.cache.read<unknown>(osmKey, 24 * 60 * 60 * 1000);
      const raw = stored ?? await this.sources.osm(bounds, signal);
      if (!stored && raw && typeof raw === 'object' && 'elements' in raw && Array.isArray(raw.elements) && !('remark' in raw)) await this.cache.write(osmKey, raw);
      const terrain = request.elevation ? await this.sources.elevation(request.center, request.sizeKm * 1000, signal) : flatTerrain(request.sizeKm * 1000);
      const city = normalizeOSM(raw, request, terrain, id);
      if (request.elevation) {
        city.attribution.push({ label: 'Copernicus DEM GLO-30 / Sinergise', url: 'https://registry.opendata.aws/copernicus-dem/', license: 'Copernicus DEM license', notice: COPERNICUS_NOTICE });
        city.warnings.push('Copernicus GLO-30 e DSM (~30 m), nao terreno nu. Vegetacao e telhados afetam o relevo; datum vertical EGM2008.');
      } else city.warnings.push('Modo plano escolhido: elevacao real NAO carregada.');
      const optional = async (label: string, work: () => Promise<void>) => {
        try { await work(); }
        catch (error) {
          if (signal.aborted) throw error;
          console.warn(`[geo] ${label}:`, error);
          city.warnings.push(`${label} indisponivel: ${error instanceof Error ? error.message : String(error)}`);
        }
      };
      if (request.microsoft) await optional('Microsoft footprints', async () => {
        const features = await this.sources.microsoft(bounds, signal);
        const staged = { ...city, buildings: [...city.buildings] };
        const added = addMicrosoft(staged, features);
        city.buildings = staged.buildings;
        city.attribution.push({ label: 'Microsoft Global ML Building Footprints', url: 'https://github.com/microsoft/GlobalMLBuildingFootprints', license: 'CDLA Permissive 2.0' });
        if (!added) city.warnings.push('Microsoft consultado: nenhum footprint adicional sem sobreposicao com OSM.');
      });
      if (request.imagery || request.texture) {
        for (const [label, provider] of [['OpenAerialMap', this.sources.aerial], ['Sentinel-2', this.sources.sentinel]] as const) {
          await optional(label, async () => {
            const references = await provider(bounds, signal);
            city.imagery.push(...references);
            if (!references.length) city.warnings.push(`${label}: nenhuma imagem encontrada para os filtros deste recorte.`);
          });
        }
        if (request.texture) await optional('Textura Sentinel-2', async () => {
          const reference = city.imagery.find(image => image.source === 'Sentinel-2');
          if (!reference) throw new Error('Nenhuma cena com nuvens abaixo de 20% foi encontrada.');
          const dataUrl = await this.sources.sentinelTexture(bounds, reference, signal);
          city.surfaceTexture = { dataUrl, source: 'Sentinel-2', date: reference.date, url: reference.url };
          city.attribution.push({ label: `Copernicus Sentinel-2 (${reference.date.slice(0, 10)})`, url: reference.url, license: reference.license, notice: `Contains modified Copernicus Sentinel data ${reference.date.slice(0, 4)}` });
          city.warnings.push('Textura Sentinel-2: RGB a ~10 m, sem classificacao de superficie. Nuvens e lacunas podem existir; imagem nao define a geometria.');
        });
      }
      finishCity(city);
      signal.throwIfAborted();
      await this.cache.write(id, city);
      return city;
    } finally { this.busy = false; }
  }

  async geocode(query: string, signal: AbortSignal): Promise<{ name: string; lat: number; lon: number }[]> {
    const endpoint = process.env.NOMINATIM_URL;
    if (!endpoint) throw new Error('Busca por nome desativada. Use latitude/longitude ou configure NOMINATIM_URL apos ler a politica de uso no README.');
    if (!query.trim() || query.length > 120) throw new Error('Digite uma cidade com ate 120 caracteres.');
    const key = `search-${createHash('sha256').update(query.trim().toLowerCase()).digest('hex')}`;
    const cached = await this.cache.read<{ name: string; lat: number; lon: number }[]>(key, 30 * 24 * 60 * 60 * 1000);
    if (cached) return cached;
    const previous = this.geocodeQueue;
    let release!: () => void;
    this.geocodeQueue = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      await new Promise(resolve => setTimeout(resolve, Math.max(0, 1100 - (Date.now() - this.lastGeocode))));
      signal.throwIfAborted();
      this.lastGeocode = Date.now();
      const url = new URL(endpoint);
      url.search = new URLSearchParams({ q: query.trim(), format: 'jsonv2', limit: '5' }).toString();
      const result = list(await json(url.href, signal)).map(value => {
        const item = record(value);
        const lat = Number(item.lat), lon = Number(item.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('Geocodificador retornou coordenadas invalidas.');
        return { name: String(item.display_name), lat, lon };
      });
      await this.cache.write(key, result);
      return result;
    } finally { release(); }
  }
}
