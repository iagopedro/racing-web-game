export interface GeoPoint { lon: number; lat: number }
export const CITY_VERSION = 2;
export interface LocalPoint { x: number; z: number }
export type Bounds = [west: number, south: number, east: number, north: number];
export type Ring = LocalPoint[];
export type Polygon = Ring[];
export interface RegionRequest {
  name: string;
  center: GeoPoint;
  sizeKm: number;
  elevation: boolean;
  microsoft: boolean;
  imagery: boolean;
  texture?: boolean;
}
export interface Road {
  id: string;
  name: string;
  kind: string;
  points: LocalPoint[];
  heights: number[];
  width: number;
  widthSource: 'tag' | 'lanes' | 'estimated';
  lanes?: number;
  lanesForward?: number;
  laneMarkings?: boolean;
  surface?: string;
  oneway: -1 | 0 | 1;
  layer: number;
  bridge: boolean;
  tunnel: boolean;
  drive: boolean;
  walk: boolean;
}
export interface Building {
  id: string;
  polygon: Polygon;
  height: number;
  minHeight: number;
  heightSource: 'height' | 'levels' | 'estimated' | 'ml';
  source: 'osm' | 'microsoft';
  name?: string;
  color?: string;
}
export interface LandArea { id: string; name?: string; kind: 'green' | 'water' | 'paved'; polygon: Polygon }
export interface Terrain {
  segments: number;
  size: number;
  heights: number[];
  datum: number;
  source: 'copernicus' | 'flat';
  processing?: 'urban-ground';
  rawHeights?: number[];
}
export interface ImageryReference {
  source: 'OpenAerialMap' | 'Sentinel-2';
  title: string;
  date: string;
  url: string;
  preview?: string;
  license: string;
}
export const COPERNICUS_NOTICE = 'produced using Copernicus WorldDEM-30 \u00a9 DLR e.V. 2010-2014 and \u00a9 Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved';
export interface Attribution { label: string; url: string; license: string; notice?: string }
export interface CityData {
  version: typeof CITY_VERSION;
  id: string;
  name: string;
  center: GeoPoint;
  bounds: Bounds;
  size: number;
  roads: Road[];
  buildings: Building[];
  areas: LandArea[];
  terrain: Terrain;
  spawn: LocalPoint & { yaw: number; y: number };
  imagery: ImageryReference[];
  surfaceTexture?: { dataUrl: string; source: 'Sentinel-2'; date: string; url: string };
  attribution: Attribution[];
  warnings: string[];
  createdAt: string;
}

export function parseRegion(value: unknown): RegionRequest {
  if (!value || typeof value !== 'object') throw new Error('Regiao invalida.');
  const input = value as Record<string, unknown>;
  const center = input.center as Record<string, unknown> | undefined;
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120) throw new Error('Informe um nome de cidade com ate 120 caracteres.');
  if (!center || typeof center.lat !== 'number' || typeof center.lon !== 'number' ||
      !Number.isFinite(center.lat) || !Number.isFinite(center.lon) ||
      Math.abs(center.lat) > 75 || Math.abs(center.lon) > 180) throw new Error('Coordenadas invalidas. Latitude suportada: -75 a 75.');
  if (typeof input.sizeKm !== 'number' || !Number.isFinite(input.sizeKm) || input.sizeKm < 0.2 || input.sizeKm > 5) throw new Error('O lado do recorte deve estar entre 0.2 e 5 km.');
  for (const key of ['elevation', 'microsoft', 'imagery']) {
    if (typeof input[key] !== 'boolean') throw new Error(`Opcao ${key} invalida.`);
  }
  if (input.texture !== undefined && typeof input.texture !== 'boolean') throw new Error('Opcao texture invalida.');
  return {
    name: input.name.trim(), center: { lat: center.lat, lon: center.lon }, sizeKm: input.sizeKm,
    elevation: input.elevation as boolean, microsoft: input.microsoft as boolean, imagery: input.imagery as boolean,
    ...(input.texture === undefined ? {} : { texture: input.texture }),
  };
}
