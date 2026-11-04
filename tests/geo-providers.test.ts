import { afterEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { microsoft, osm, quadkeys, sentinelTexture } from '../server/providers';
import { regionBounds, projection } from '../src/geo/coordinates';
import { region, ring } from './geo-fixture';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe('bounded provider adapters', () => {
  it('uses calibrated WGS84 lengths rather than a self-consistent arbitrary scale', () => {
    const p = projection({ lat: 0, lon: 0 });
    expect(p.project({ lon: 0.008983152841195214, lat: 0 }).x).toBeCloseTo(1000, 5);
    expect(p.project({ lon: 0, lat: 0.00904369477050382 }).z).toBeCloseTo(-1000, 3);
  });
  it('streams Microsoft gzip GeoJSONL and retains only footprints intersecting the region', async () => {
    const bounds = regionBounds(region.center, 400), key = [...quadkeys(bounds)][0];
    const features = [
      { type: 'Feature', properties: { height: 15 }, geometry: { type: 'Polygon', coordinates: [ring(10, 10, 30, 30)] } },
      { type: 'Feature', properties: { height: -1 }, geometry: { type: 'Polygon', coordinates: [ring(1000, 1000, 1100, 1100)] } },
    ];
    const compressed = gzipSync(features.map(feature => JSON.stringify(feature)).join('\n'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(compressed)));
    const index = `Location,QuadKey,Url,Size\nBrazil,${key},https://bfppub.blob.core.windows.net/test.gz,1KB`;
    const result = await microsoft(bounds, AbortSignal.timeout(2000), index);
    expect(result).toHaveLength(1);
    expect(result[0].properties.height).toBe(15);
  });
  it('reports corrupt compressed files and disallows arbitrary catalog download hosts', async () => {
    const bounds = regionBounds(region.center, 400), key = [...quadkeys(bounds)][0];
    const fetch = vi.fn(async () => new Response('not gzip'));
    vi.stubGlobal('fetch', fetch);
    await expect(microsoft(bounds, AbortSignal.timeout(2000), `Location,QuadKey,Url\nBrazil,${key},https://bfppub.blob.core.windows.net/test.gz`)).rejects.toThrow();
    fetch.mockClear();
    await expect(microsoft(bounds, AbortSignal.timeout(2000), `Location,QuadKey,Url\nBrazil,${key},http://127.0.0.1/private`)).rejects.toThrow(/Host/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('retries one Overpass service failure but never bypasses HTTP 429', async () => {
    vi.stubEnv('OVERPASS_URL', '');
    const fetch = vi.fn().mockResolvedValueOnce(new Response('', { status: 502 })).mockResolvedValueOnce(new Response('{"elements":[]}'));
    vi.stubGlobal('fetch', fetch); vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(osm([-35, -9, -34, -8], AbortSignal.timeout(2000))).resolves.toEqual({ elements: [] });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toBe('https://overpass.kumi.systems/api/interpreter');
    fetch.mockReset().mockResolvedValue(new Response('', { status: 429 }));
    await expect(osm([-35, -9, -34, -8], AbortSignal.timeout(2000))).rejects.toThrow(/429/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('requests texture reprojection to the same bounds and refuses malformed image data', async () => {
    const reference = { source: 'Sentinel-2' as const, title: 'scene', date: '2026-01-01', license: 'terms', url: 'https://planetarycomputer.microsoft.com/api/data/v1/item/map?item=test' };
    const png = Buffer.alloc(24);
    Buffer.from('89504e470d0a1a0a', 'hex').copy(png); png.writeUInt32BE(1024, 16); png.writeUInt32BE(1024, 20);
    const fetch = vi.fn(async () => new Response(png, { headers: { 'Content-Type': 'image/png' } }));
    vi.stubGlobal('fetch', fetch);
    expect(await sentinelTexture([-35, -9, -34, -8], reference, AbortSignal.timeout(2000))).toMatch(/^data:image\/png;base64,/);
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.pathname).toContain('-35,-9,-34,-8/1024x1024.png');
    expect(url.searchParams.get('dst_crs')).toBe('EPSG:4326');
    expect(url.searchParams.get('assets')).toBe('visual');
    fetch.mockImplementation(async () => new Response('bad', { headers: { 'Content-Type': 'image/png' } }));
    await expect(sentinelTexture([-35, -9, -34, -8], reference, AbortSignal.timeout(2000))).rejects.toThrow(/invalida/);
  });
});
