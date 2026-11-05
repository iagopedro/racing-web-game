import type { MapDefinition } from '../world/map';
import { geoRequest } from './client';
import { COPERNICUS_NOTICE, parseRegion } from './types';

export class GeoPanel {
  readonly dialog: HTMLDialogElement;
  private controller?: AbortController;
  private pause: (value: boolean) => void;

  constructor(root: HTMLElement, map: MapDefinition, pause: (value: boolean) => void) {
    this.pause = pause;
    const button = document.createElement('button');
    button.className = 'text-tool geo-open'; button.textContent = 'Cidades reais';
    root.querySelector('.top-actions')!.prepend(button);
    root.insertAdjacentHTML('beforeend', `
      <dialog id="geo-dialog" aria-labelledby="geo-title">
        <div class="dialog-header"><div><span class="eyebrow">DADOS ABERTOS / ESCALA REAL</span><h2 id="geo-title">Escolha uma regiao.</h2></div><button type="button" class="icon-button" id="geo-close" aria-label="Fechar cidades reais">X</button></div>
        <p class="geo-description">Um recorte navegavel, nao uma replica fotografica. 1 unidade = 1 metro. Gerar outra cidade reinicia a partida.</p>
        <form id="geo-form" class="settings-fields">
          <label for="geo-name">Cidade / nome do recorte</label><div class="geo-search"><input id="geo-name" value="Recife Antigo" maxlength="120" required><button type="button" class="secondary-button" id="geo-search">Buscar cidade</button></div>
          <p class="geo-description">Busca por nome exige configurar NOMINATIM_URL no servidor. As coordenadas abaixo funcionam sem geocodificador.</p>
          <select id="geo-results" aria-label="Resultados da busca" hidden></select>
          <div class="geo-coordinates"><label>Latitude<input id="geo-lat" type="number" step="any" min="-75" max="75" value="-8.0631" required></label><label>Longitude<input id="geo-lon" type="number" step="any" min="-180" max="180" value="-34.8712" required></label></div>
          <label for="geo-size">Lado do recorte (km, quadrado)</label><input id="geo-size" type="number" min="0.2" max="5" step="0.1" value="1" required>
          <label class="toggle-label">Relevo urbano filtrado / Copernicus (~30 m)<input type="checkbox" id="geo-elevation" checked></label>
          <label class="toggle-label">Complementar edificios com Microsoft ML<input type="checkbox" id="geo-microsoft"></label>
          <label class="toggle-label">Consultar imagens OAM / Sentinel-2<input type="checkbox" id="geo-imagery" checked></label>
          <label class="toggle-label">Textura de superficie Sentinel-2 (~10 m)<input type="checkbox" id="geo-texture"></label>
          <label class="toggle-label">Atualizar fontes (ignorar cache de 24 h)<input type="checkbox" id="geo-refresh"></label>
          <p class="geo-description">O relevo e uma aproximacao filtrada para reduzir telhados no piso, nao um levantamento de terreno. Microsoft pode baixar tiles de ate 128 MB. Sentinel-2 fornece textura de baixa resolucao, nao fachadas. Sem relevo selecionado, o terreno sera plano.</p>
          <div class="dialog-actions"><button type="submit" class="start-button" id="geo-generate">Gerar e abrir cidade</button><button type="button" class="secondary-button" id="geo-cancel" hidden>Cancelar</button></div>
        </form>
        <p id="geo-status" role="status" aria-live="polite"></p>
        <section id="geo-report" aria-label="Fontes e qualidade do mapa"></section>
        <button type="button" class="secondary-button" id="geo-offline">Abrir Santa Brisa offline</button>
      </dialog>`);
    this.dialog = root.querySelector<HTMLDialogElement>('#geo-dialog')!;
    const element = <T extends HTMLElement>(id: string) => this.dialog.querySelector<T>(`#${id}`)!;
    const input = (id: string) => element<HTMLInputElement>(id);
    const status = element<HTMLParagraphElement>('geo-status');
    button.addEventListener('click', () => { pause(true); this.dialog.showModal(); });
    element('geo-close').addEventListener('click', () => this.close());
    this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    element('geo-offline').addEventListener('click', () => location.assign(location.pathname));
    element('geo-cancel').addEventListener('click', () => this.controller?.abort());
    element('geo-search').addEventListener('click', async () => {
      status.textContent = 'Buscando cidade...';
      const search = element<HTMLButtonElement>('geo-search');
      search.disabled = true;
      try {
        const results = await geoRequest<{ name: string; lat: number; lon: number }[]>(`/search?q=${encodeURIComponent(input('geo-name').value)}`, { signal: AbortSignal.timeout(30000) });
        const select = element<HTMLSelectElement>('geo-results');
        select.replaceChildren(...results.map((result, index) => new Option(result.name, String(index))));
        select.hidden = !results.length;
        const choose = () => {
          const result = results[Number(select.value)];
          if (result) { input('geo-lat').value = String(result.lat); input('geo-lon').value = String(result.lon); }
        };
        select.onchange = choose; choose();
        status.textContent = results.length ? 'Selecione o resultado e ajuste o centro do recorte.' : 'Nenhuma cidade encontrada.';
      } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
      finally { search.disabled = false; }
    });
    element<HTMLFormElement>('geo-form').addEventListener('submit', async event => {
      event.preventDefault();
      const generate = element<HTMLButtonElement>('geo-generate');
      if (generate.disabled) return;
      this.controller = new AbortController();
      generate.disabled = true; element('geo-cancel').hidden = false;
      status.textContent = 'Consultando fontes e construindo o recorte. A primeira geracao pode levar varios minutos...';
      try {
        const request = parseRegion({
          name: input('geo-name').value, center: { lat: Number(input('geo-lat').value), lon: Number(input('geo-lon').value) },
          sizeKm: Number(input('geo-size').value), elevation: input('geo-elevation').checked,
          microsoft: input('geo-microsoft').checked, imagery: input('geo-imagery').checked, texture: input('geo-texture').checked,
        });
        const response = await geoRequest<{ id: string }>(`/maps${input('geo-refresh').checked ? '?refresh=1' : ''}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
          signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(550000)]),
        });
        location.assign(`${location.pathname}?city=${encodeURIComponent(response.id)}`);
      } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
      finally { generate.disabled = false; element('geo-cancel').hidden = true; this.controller = undefined; }
    });
    if (map.kind === 'real') {
      input('geo-name').value = map.name;
      input('geo-lat').value = String(map.data.center.lat); input('geo-lon').value = String(map.data.center.lon);
      input('geo-size').value = String(map.data.size / 1000);
      input('geo-elevation').checked = map.data.terrain.source === 'copernicus';
      input('geo-texture').checked = Boolean(map.data.surfaceTexture);
      const report = element('geo-report');
      const summary = document.createElement('p');
      summary.textContent = `${map.name}: ${map.data.roads.length} trechos, ${map.data.buildings.length} edificios, ${map.data.areas.length} areas. Gerado em ${new Date(map.data.createdAt).toLocaleString()}.`;
      report.append(summary);
      const warnings = document.createElement('ul');
      for (const warning of [...map.data.warnings, 'Trafego usa ciclos conectados do OSM; sem ciclos, nao ha carros. Pedestres apenas em vias pedonais mapeadas. Semaforos e regras de preferencia reais nao sao simulados.']) {
        const item = document.createElement('li'); item.textContent = warning; warnings.append(item);
      }
      report.append(warnings);
      if (map.data.terrain.source === 'copernicus') {
        const notice = document.createElement('p'); notice.textContent = COPERNICUS_NOTICE; report.append(notice);
      }
      for (const credit of map.data.attribution.filter(credit => credit.notice && credit.notice !== COPERNICUS_NOTICE)) {
        const notice = document.createElement('p'); notice.textContent = credit.notice!; report.append(notice);
      }
      for (const image of map.data.imagery) {
        const p = document.createElement('p'), link = document.createElement('a');
        link.textContent = `${image.source}: ${image.date.slice(0, 10)} / ${image.license}`;
        if (image.url.startsWith('https://')) link.href = image.url;
        link.target = '_blank'; link.rel = 'noopener noreferrer'; link.title = image.title;
        p.append(link); report.append(p);
      }
      const credits = document.createElement('div'); credits.className = 'geo-credits';
      for (const credit of map.data.attribution) {
        const link = document.createElement('a'); link.textContent = `${credit.label} (${credit.license})`;
        if (credit.url.startsWith('https://')) link.href = credit.url;
        link.target = '_blank'; link.rel = 'noopener noreferrer'; credits.append(link);
      }
      root.append(credits);
    }
  }
  close(): void {
    this.controller?.abort();
    this.dialog.close();
    this.pause(false);
  }
}
