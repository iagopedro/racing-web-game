import { realMap, SANTA_BRISA } from '../world/map';
import type { MapDefinition } from '../world/map';
import type { CityData } from './types';
import { CITY_VERSION } from './types';
import { roadWarnings } from './roads';

export async function geoRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(`/api/geo${path}`, init); }
  catch (error) {
    if (init?.signal?.aborted) throw new Error('Operacao cancelada.');
    throw new Error('Servico geografico inacessivel. Execute npm run geo:serve.', { cause: error });
  }
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Servico geografico indisponivel. Execute npm run geo:serve.');
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `Servico geografico: HTTP ${response.status}`);
  return data as T;
}

export async function selectedMap(): Promise<MapDefinition> {
  const id = new URLSearchParams(location.search).get('city');
  if (!id) return SANTA_BRISA;
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Identificador de cidade invalido.');
  const data = await geoRequest<CityData>(`/maps/${id}`, { signal: AbortSignal.timeout(30000) });
  if (data.version !== CITY_VERSION) throw new Error('Recorte de uma versao antiga. Volte a demonstracao e gere a cidade novamente para aplicar as correcoes.');
  if (data.id !== id || !Array.isArray(data.roads) || !Array.isArray(data.buildings) ||
      !data.terrain || data.terrain.heights.length !== (data.terrain.segments + 1) ** 2 ||
      !data.terrain.heights.every(Number.isFinite) || !Number.isFinite(data.spawn?.y)) throw new Error('Recorte salvo invalido. Gere a regiao novamente.');
  for (const warning of roadWarnings(data.roads)) if (!data.warnings.includes(warning)) data.warnings.push(warning);
  return realMap(data);
}
