import osmtogeojson from 'osmtogeojson';
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';
import { cropLine, cropPolygon, overlapArea, polygonArea } from './geometry.ts';
import { nearestOnSegment, projection, regionBounds, terrainHeight } from './coordinates.ts';
import type { Building, CityData, LocalPoint, Polygon, RegionRequest, Road, Terrain } from './types.ts';
import { CITY_VERSION } from './types.ts';
import { laneTags, roadWidth } from './roads.ts';
import { coastlineWater } from './coastline.ts';
import { SpatialIndex } from './spatial.ts';

export function lengthMeters(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const match = value.trim().match(/^(\d+(?:[.,]\d+)?)\s*(m|metres?|meters?|ft|feet|')?$/i);
  if (!match) return undefined;
  const number = Number(match[1].replace(',', '.')) * (/^(ft|feet|')$/i.test(match[2] ?? '') ? 0.3048 : 1);
  return number > 0 ? number : undefined;
}

export function buildingHeight(tags: Record<string, unknown>, source: 'osm' | 'microsoft'): Pick<Building, 'height' | 'heightSource' | 'minHeight'> {
  const explicit = lengthMeters(tags.height);
  const levels = lengthMeters(tags['building:levels']);
  const height = Math.max(2, Math.min(1500, explicit ?? (levels ? levels * 3 : 9)));
  const minHeight = lengthMeters(tags.min_height) ?? (lengthMeters(tags['building:min_level']) ?? 0) * 3;
  return {
    height, minHeight: Math.min(minHeight, Math.max(0, height - 2)),
    heightSource: explicit ? (source === 'osm' ? 'height' : 'ml') : levels ? 'levels' : 'estimated',
  };
}

function collection(value: unknown): FeatureCollection<Geometry, Record<string, unknown>> {
  if (!value || typeof value !== 'object' || !('type' in value) || value.type !== 'FeatureCollection' ||
      !('features' in value) || !Array.isArray(value.features)) throw new Error('GeoJSON invalido.');
  return value as FeatureCollection<Geometry, Record<string, unknown>>;
}

function projected(position: Position, project: ReturnType<typeof projection>['project']): LocalPoint {
  if (!Array.isArray(position) || position.length < 2 || !Number.isFinite(position[0]) || !Number.isFinite(position[1]) ||
      Math.abs(position[0]) > 180 || Math.abs(position[1]) > 90) throw new Error('Geometria com coordenadas invalidas.');
  return project({ lon: position[0], lat: position[1] });
}

function polygons(feature: Feature<Geometry>, project: ReturnType<typeof projection>['project'], size: number): Polygon[] {
  const geometry = feature.geometry;
  const parts = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  return parts.flatMap(part => {
    if (!part.length || part.some(ring => ring.length < 4)) throw new Error('Poligono incompleto na fonte geografica.');
    return cropPolygon(part.map(ring => ring.map(point => projected(point, project))), size);
  });
}

export function normalizeOSM(raw: unknown, request: RegionRequest, terrain: Terrain, id: string): CityData {
  if (!raw || typeof raw !== 'object' || !('elements' in raw) || !Array.isArray(raw.elements)) throw new Error('Resposta Overpass invalida.');
  if ('remark' in raw) throw new Error(`Overpass retornou dados incompletos: ${String(raw.remark)}`);
  const features = collection(osmtogeojson(raw, { flatProperties: true })).features;
  const size = request.sizeKm * 1000;
  const { project } = projection(request.center);
  const city: CityData = {
    version: CITY_VERSION, id, name: request.name, center: request.center, bounds: regionBounds(request.center, size), size,
    roads: [], buildings: [], areas: [], terrain, spawn: { x: 0, z: 0, y: 0, yaw: 0 }, imagery: [],
    attribution: [{ label: 'OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright', license: 'ODbL 1.0' }],
    warnings: [], createdAt: new Date().toISOString(),
  };
  let incomplete = 0;
  let vertices = 0;
  const coasts: LocalPoint[][] = [];
  for (const feature of features) {
    const tags = feature.properties ?? {};
    if (tags.tainted) { incomplete++; continue; }
    const featureId = String(feature.id);
    if (tags.building && tags.building !== 'no') {
      polygons(feature, project, size).forEach((polygon, index) => {
        city.buildings.push({
          id: `${featureId}/${index}`, polygon, ...buildingHeight(tags, 'osm'), source: 'osm',
          name: typeof tags.name === 'string' ? tags.name : undefined,
          color: typeof tags['building:colour'] === 'string' && /^#[\da-f]{6}$/i.test(tags['building:colour']) ? tags['building:colour'] : undefined,
        });
        vertices += polygon.reduce((sum, ring) => sum + ring.length, 0);
      });
    } else if (tags.natural === 'water' || tags.water || tags.waterway === 'riverbank' ||
        ['park', 'garden', 'recreation_ground', 'nature_reserve'].includes(String(tags.leisure)) ||
        ['grass', 'forest', 'meadow', 'recreation_ground', 'village_green'].includes(String(tags.landuse)) ||
        ['wood', 'scrub', 'grassland', 'wetland'].includes(String(tags.natural))) {
      const kind = tags.natural === 'water' || tags.water || tags.waterway === 'riverbank' ? 'water' : 'green';
      polygons(feature, project, size).forEach((polygon, index) => {
        city.areas.push({ id: `${featureId}/${index}`, kind, polygon, name: typeof tags.name === 'string' ? tags.name : undefined });
        vertices += polygon.reduce((sum, ring) => sum + ring.length, 0);
      });
    }
    const geometry = feature.geometry;
    if (tags.highway && tags.area !== 'no' && (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon')) {
      polygons(feature, project, size).forEach((polygon, index) => {
        city.areas.push({ id: `${featureId}/${index}`, kind: 'paved', polygon, name: typeof tags.name === 'string' ? tags.name : undefined });
        vertices += polygon.reduce((sum, ring) => sum + ring.length, 0);
      });
    }
    if (tags.natural === 'coastline') {
      const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.type === 'MultiLineString' ? geometry.coordinates :
        geometry.type === 'Polygon' ? geometry.coordinates : [];
      coasts.push(...lines.map(line => line.map(point => projected(point, project))));
    }
    if ((tags.highway || tags.waterway) && (geometry.type === 'LineString' || geometry.type === 'MultiLineString')) {
      const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
      const kind = String(tags.highway ?? tags.waterway);
      const dimensions = roadWidth(tags, lengthMeters);
      const drive = Boolean(tags.highway) && !['no', 'private'].includes(String(tags.access)) &&
        !['no', 'private'].includes(String(tags.motor_vehicle ?? tags.vehicle)) &&
        ['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'service', 'road'].includes(kind);
      const tunnel = Boolean(tags.tunnel && tags.tunnel !== 'no');
      lines.flatMap(line => cropLine(line.map(point => projected(point, project)), size)).forEach((points, index) => {
        vertices += points.length;
        const road: Road = {
          id: `${featureId}/${index}`, name: typeof tags.name === 'string' ? tags.name : kind,
          kind: tags.waterway ? 'waterway' : kind, points, heights: [], ...dimensions, ...laneTags(tags),
          surface: typeof tags.surface === 'string' ? tags.surface : undefined,
          drive: drive && !tunnel, walk: ['footway', 'path', 'pedestrian'].includes(kind) && !tunnel && tags.foot !== 'no' && !['private', 'no'].includes(String(tags.access)),
          oneway: tags.oneway === '-1' ? -1 : ['yes', '1', 'true'].includes(String(tags.oneway)) || ((tags.junction === 'roundabout' || kind === 'motorway') && tags.oneway !== 'no') ? 1 : 0,
          layer: Number.isFinite(Number(tags.layer)) ? Number(tags.layer) : 0,
          bridge: Boolean(tags.bridge && tags.bridge !== 'no'), tunnel,
        };
        city.roads.push(road);
      });
    }
    if (vertices > 300000 || city.buildings.length > 25000 || city.roads.length > 20000 || city.areas.length > 6000) {
      throw new Error(`Recorte denso demais (${vertices} vertices, ${city.buildings.length} edificios, ${city.roads.length} vias). Limites: 300000 vertices, 25000 edificios, 20000 vias e 6000 areas. Reduza a regiao.`);
    }
  }
  const ocean = coastlineWater(coasts, size);
  ocean.polygons.forEach((polygon, index) => city.areas.push({ id: `coastline/${index}`, name: 'Oceano / costa OSM', kind: 'water', polygon }));
  if (ocean.incomplete) city.warnings.push(`${ocean.incomplete} linhas de costa incompletas: agua nao inferida nesses trechos.`);
  if (!ocean.polygons.length) city.warnings.push('Sem costa fechavel no recorte; oceano nao foi inventado.');
  if (incomplete) city.warnings.push(`${incomplete} geometrias OSM incompletas foram omitidas.`);
  if (city.roads.some(road => road.tunnel)) city.warnings.push('Tuneis identificados, mas nao escavados nem incluidos nas rotas navegaveis.');
  if (city.roads.some(road => road.bridge)) city.warnings.push('Pontes preservam o tracado; altura do tabuleiro e rampas sao aproximadas, nao medidas.');
  city.warnings.push(`${city.roads.filter(road => road.widthSource === 'estimated').length} larguras viarias estimadas por classe e sentido; ${city.roads.filter(road => road.widthSource === 'lanes').length} derivadas de faixas. Somente width e largura declarada na fonte.`);
  city.warnings.push('Fachadas e cores sem tags sao ilustrativas, nao reconstrucoes fotograficas.');
  if (!city.buildings.length) city.warnings.push('OSM nao retornou edificios neste recorte.');
  return city;
}

export function addMicrosoft(city: CityData, features: Feature<Geometry, Record<string, unknown>>[]): number {
  const { project } = projection(city.center);
  const cells = new Map<string, Building[]>();
  const keys = (polygon: Polygon) => {
    const xs = polygon[0].map(point => point.x), zs = polygon[0].map(point => point.z);
    const result: string[] = [];
    for (let x = Math.floor(Math.min(...xs) / 80); x <= Math.floor(Math.max(...xs) / 80); x++) {
      for (let z = Math.floor(Math.min(...zs) / 80); z <= Math.floor(Math.max(...zs) / 80); z++) result.push(`${x}:${z}`);
    }
    return result;
  };
  const insert = (building: Building) => keys(building.polygon).forEach(key => cells.set(key, [...(cells.get(key) ?? []), building]));
  city.buildings.forEach(insert);
  let added = 0;
  features.forEach((feature, index) => polygons(feature, project, city.size).forEach((polygon, part) => {
    const neighbors = new Set(keys(polygon).flatMap(key => cells.get(key) ?? []));
    const area = polygonArea(polygon);
    if ([...neighbors].some(building => overlapArea(building.polygon, polygon) > Math.min(area, polygonArea(building.polygon)) * 0.15)) return;
    const building: Building = { id: `microsoft/${index}/${part}`, polygon, ...buildingHeight(feature.properties ?? {}, 'microsoft'), source: 'microsoft' };
    city.buildings.push(building); insert(building); added++;
    if (city.buildings.length > 25000) throw new Error('Muitos edificios complementares. Reduza o recorte.');
  }));
  return added;
}

export function finishCity(city: CityData): void {
  for (const road of city.roads) {
    const original = road.points;
    const total = original.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - original[index].x, point.z - original[index].z), 0);
    let traveled = 0;
    const startHeight = terrainHeight(city.terrain, original[0].x, original[0].z);
    const end = original.at(-1)!;
    const endHeight = terrainHeight(city.terrain, end.x, end.z);
    road.points = [original[0]];
    for (let i = 1; i < original.length; i++) {
      const a = original[i - 1], b = original[i];
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 8));
      for (let j = 1; j <= steps; j++) road.points.push({ x: a.x + (b.x - a.x) * j / steps, z: a.z + (b.z - a.z) * j / steps });
    }
    road.heights = road.points.map((point, index) => {
      if (index) traveled += Math.hypot(point.x - road.points[index - 1].x, point.z - road.points[index - 1].z);
      const base = terrainHeight(city.terrain, point.x, point.z);
      if (!road.bridge) return base;
      const fraction = total ? traveled / total : 0;
      return Math.max(base, startHeight + (endHeight - startHeight) * fraction + Math.min(5, total * 0.05) * Math.sin(Math.PI * fraction));
    });
  }
  const candidates: (CityData['spawn'] & { distance: number })[] = [];
  for (const road of city.roads.filter(road => road.drive && !road.bridge && road.width >= 5)) {
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1], b = road.points[i];
      const point = nearestOnSegment({ x: 0, z: 0 }, a, b);
      if (Math.max(Math.abs(point.x), Math.abs(point.z)) > city.size / 2 - 20) continue;
      const yaw = Math.atan2(b.x - a.x, b.z - a.z) + (road.oneway === -1 ? Math.PI : 0);
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if (Math.abs(road.heights[i] - road.heights[i - 1]) / length > 0.1) continue;
      candidates.push({ x: point.x, z: point.z, y: road.heights[i - 1] + (road.heights[i] - road.heights[i - 1]) * point.t, yaw, distance: point.distance });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);
  const obstacles = new SpatialIndex<Building>();
  city.buildings.filter(building => building.minHeight < 2).forEach(building => obstacles.add(building, building.polygon[0], 5));
  const selected = candidates.find(point => {
    const footprint = [[-4, -1.4], [-4, 1.4], [3, 1.4], [3, -1.4]].map(([along, across]) => ({
      x: point.x + Math.sin(point.yaw) * along + Math.cos(point.yaw) * across,
      z: point.z + Math.cos(point.yaw) * along - Math.sin(point.yaw) * across,
    }));
    return ![...obstacles.at(point)].some(building => overlapArea([footprint], building.polygon) > 0.001);
  });
  if (!selected) throw new Error('Nao foi encontrada via dirigivel com espaco para iniciar. Escolha outro centro ou aumente o recorte.');
  const { distance: _distance, ...spawn } = selected;
  city.spawn = spawn;
  const estimates = city.buildings.filter(building => building.heightSource === 'estimated').length;
  if (estimates) city.warnings.push(`${estimates} edificios sem altura: estimativa explicita de 9 m (3 pavimentos).`);
}
