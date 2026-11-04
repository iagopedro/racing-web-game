import { createIcons, Sun, Moon, Volume2, VolumeX, Settings2, Camera, ArrowRight, ArrowLeft, Radio, SkipForward, X, Play, RotateCcw, Maximize, HelpCircle, CarFront, Footprints, Pause, ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide';
import type { Input } from './core/input';
import type { Player } from './systems/player';
import type { Daylight } from './systems/daylight';
import type { AudioSystem } from './systems/audio';
import { district, SANTA_BRISA } from './world/map';
import type { MapDefinition } from './world/map';
import { GeoPanel } from './geo/panel';

export interface UIActions { start: () => void; pause: (paused: boolean) => void; quality: (level: string) => void; recover: () => void; camera: () => void }

export class UI {
  private root: HTMLElement;
  private audio: AudioSystem;
  private input: Input;
  private actions: UIActions;
  private speed: HTMLElement;
  private clock: HTMLElement;
  private location: HTMLElement;
  private interact: HTMLButtonElement;
  private radioElement: HTMLElement;
  private mapCanvas: HTMLCanvasElement;
  private settings: HTMLDialogElement;
  private help: HTMLDialogElement;
  private toastTimer?: ReturnType<typeof setTimeout>;
  private radioTimer?: ReturnType<typeof setTimeout>;
  private started = false;
  private previousMode = false;
  private wasNight = false;
  private map: MapDefinition;
  private geo: GeoPanel;
  private geographicMinimap?: HTMLCanvasElement;

  constructor(root: HTMLElement, audio: AudioSystem, input: Input, actions: UIActions, map: MapDefinition = SANTA_BRISA) {
    this.root = root;
    this.audio = audio;
    this.input = input;
    this.actions = actions;
    this.map = map;
    root.insertAdjacentHTML('beforeend', `
      <div class="hud" id="hud">
        <header class="topbar">
          <div class="wordmark"><span class="brand-symbol">sb.</span><div>SANTA BRISA<span class="brand-sub">CIDADE ABERTA</span></div></div>
          <div class="top-actions"><div class="time"><i data-lucide="sun" aria-hidden="true"></i><time id="clock">16:24</time></div><span class="divider"></span>
            <button class="icon-button" id="camera-button" aria-label="Trocar camera" title="Trocar camera (C)"><i data-lucide="camera"></i></button>
            <button class="icon-button" id="mute-button" aria-label="Silenciar audio" title="Silenciar audio (M)" aria-pressed="false"><i data-lucide="volume-2"></i></button>
            <button class="icon-button" id="settings-button" aria-label="Abrir ajustes" title="Ajustes (Esc)"><i data-lucide="settings-2"></i></button>
          </div>
        </header>
        <section class="welcome" id="welcome" aria-labelledby="welcome-title"><span class="eyebrow"><span class="live-dot"></span> LITORAL &middot; BRASIL FICT&Iacute;CIO</span><h1 id="welcome-title">Santa<br>Brisa<span>.</span></h1><p>Sem destino. No seu tempo.</p><button class="start-button" id="start-button">Explorar a cidade <i data-lucide="arrow-right"></i></button><div class="welcome-caption">25 QUARTEIR&Otilde;ES &nbsp; / &nbsp; UM HORIZONTE ABERTO</div></section>
        <div class="edition" id="edition">VOL. 01 <span>ORLA DO SOL</span><span class="edition-line"></span> 23&deg; S &nbsp; 45&deg; W</div>
        <section class="navigation in-game" aria-label="Localizacao"><div class="map-wrap"><canvas id="minimap" width="300" height="300" aria-label="Mapa de ruas proximas"></canvas><span class="north">N</span></div><div class="district"><span class="eyebrow">SANTA BRISA</span><strong id="location">Orla do Sol</strong></div></section>
        <section class="speedometer in-game" aria-label="Velocidade"><div class="vehicle-label" id="vehicle-label">A P&Eacute; <i data-lucide="footprints"></i></div><div class="speed-row"><span id="speed">000</span><span class="speed-unit">km/h</span></div><div class="speed-track"><span id="speed-bar"></span></div><div class="gear-row"><span id="gear">N</span><span id="car-name">BRISA GT &middot; 1986</span></div></section>
        <div class="interaction in-game"><button id="interact-button" class="interaction-button"><kbd>E</kbd><span>Entrar no carro</span><i data-lucide="car-front"></i></button></div>
        <section class="radio-strip" id="radio-strip" aria-label="Radio do carro"><button id="radio-power" class="icon-button radio-badge" aria-label="Desligar radio" title="Ligar ou desligar radio"><i data-lucide="radio"></i></button><div class="radio-copy"><span id="station-name"></span><strong id="track-name"></strong><span id="station-genre"></span></div><div class="radio-controls"><button id="previous-station" class="icon-button" aria-label="Estacao anterior" title="Estacao anterior"><i data-lucide="arrow-left"></i></button><button id="next-station" class="icon-button" aria-label="Proxima estacao" title="Proxima estacao (R)"><i data-lucide="arrow-right"></i></button><button id="next-track" class="icon-button" aria-label="Proxima musica" title="Proxima musica (N)"><i data-lucide="skip-forward"></i></button></div></section>
        <footer class="bottom-tools in-game"><button class="text-tool" id="help-button"><i data-lucide="help-circle"></i> Controles</button><button class="icon-button" id="fullscreen-button" aria-label="Tela cheia" title="Tela cheia"><i data-lucide="maximize"></i></button><button class="text-tool radio-reopen" id="radio-button"><i data-lucide="radio"></i><span id="radio-small">Mar&eacute; FM</span></button></footer>
        <div id="toast" class="toast" role="status" aria-live="polite"></div>
        <div id="transition" class="transition"></div>
        <div class="touch-controls in-game"><div class="touch-steering"><button data-hold="KeyA" aria-label="Virar a esquerda"><i data-lucide="chevron-left"></i></button><button data-hold="KeyD" aria-label="Virar a direita"><i data-lucide="chevron-right"></i></button></div><div class="touch-pedals"><button data-hold="KeyS" aria-label="Frear e marcha a re"><i data-lucide="chevron-down"></i></button><button data-hold="KeyW" aria-label="Acelerar"><i data-lucide="chevron-up"></i></button></div></div>
      </div>
      <dialog id="settings-dialog" aria-labelledby="settings-title"><div class="dialog-header"><div><span class="eyebrow">SANTA BRISA</span><h2 id="settings-title">Uma pausa.</h2></div><button class="icon-button close-dialog" aria-label="Fechar ajustes"><i data-lucide="x"></i></button></div><div class="settings-fields"><label for="volume">Volume do r&aacute;dio <output id="volume-value">38%</output></label><input id="volume" type="range" min="0" max="100" value="38"><label for="quality">Qualidade visual</label><select id="quality"><option value="low">Leve</option><option value="medium" selected>Equilibrada</option><option value="high">Alta</option></select><label for="time-rate">Passagem do tempo</label><select id="time-rate"><option value="120">Um dia em 12 minutos</option><option value="300">Um dia em 4 min 48 s</option><option value="600">Um dia em 2 min 24 s</option></select><label class="toggle-label" for="radio-toggle">R&aacute;dio ligado<input type="checkbox" id="radio-toggle" checked></label></div><div class="dialog-actions"><button class="secondary-button" id="recover-button"><i data-lucide="rotate-ccw"></i> Reposicionar carro</button><button class="start-button close-dialog"><i data-lucide="play"></i> Continuar</button></div></dialog>
      <dialog id="help-dialog" aria-labelledby="help-title"><div class="dialog-header"><div><span class="eyebrow">AO SEU RITMO</span><h2 id="help-title">Ao volante.</h2></div><button class="icon-button close-dialog" aria-label="Fechar controles"><i data-lucide="x"></i></button></div><dl class="bindings"><div><dt><kbd>W</kbd><kbd>S</kbd> / <kbd>&uarr;</kbd><kbd>&darr;</kbd></dt><dd>Acelerar &amp; frear / r&eacute;</dd></div><div><dt><kbd>A</kbd><kbd>D</kbd> / <kbd>&larr;</kbd><kbd>&rarr;</kbd></dt><dd>Virar / andar</dd></div><div><dt><kbd>Espa&ccedil;o</kbd></dt><dd>Freio de m&atilde;o</dd></div><div><dt><kbd>E</kbd></dt><dd>Entrar / sair do carro</dd></div><div><dt><kbd>C</kbd> / arrastar</dt><dd>C&acirc;mera / olhar ao redor</dd></div><div><dt><kbd>R</kbd><kbd>N</kbd><kbd>M</kbd></dt><dd>Esta&ccedil;&atilde;o / faixa / silenciar</dd></div><div><dt><kbd>Esc</kbd> / <kbd>H</kbd></dt><dd>Pausa / controles</dd></div></dl><div class="gamepad-note">GAMEPAD PADR&Atilde;O<span>RT / LT: acelerar e frear &middot; Anal&oacute;gico: dire&ccedil;&atilde;o<br>A: entrar/sair &middot; B: freio de m&atilde;o &middot; X: c&acirc;mera &middot; Y: r&aacute;dio</span></div></dialog>
    `);
    this.speed = this.element('speed');
    this.clock = this.element('clock');
    this.location = this.element('location');
    this.interact = this.element('interact-button');
    this.radioElement = this.element('radio-strip');
    this.mapCanvas = this.element('minimap');
    this.settings = this.element('settings-dialog');
    this.help = this.element('help-dialog');
    this.geo = new GeoPanel(root, map, value => { input.clear(); actions.pause(value); });
    if (map.kind === 'real') {
      this.element('welcome-title').textContent = map.name;
      this.element('welcome').querySelector('.eyebrow')!.textContent = 'CIDADE REAL / DADOS ABERTOS';
      this.element('welcome').querySelector('.welcome-caption')!.textContent = `${map.data.size / 1000} x ${map.data.size / 1000} KM / ESCALA 1:1`;
      this.element('edition').textContent = `${map.data.center.lat.toFixed(5)}, ${map.data.center.lon.toFixed(5)}`;
      root.querySelector('.district .eyebrow')!.textContent = map.name;
      root.querySelector('.brand-sub')!.textContent = 'CIDADES REAIS';
      this.geographicMinimap = document.createElement('canvas');
      this.geographicMinimap.width = this.geographicMinimap.height = 2048;
      const context = this.geographicMinimap.getContext('2d')!;
      context.scale(2048 / map.data.size, 2048 / map.data.size);
      context.translate(map.extent, map.extent);
      for (const area of map.data.areas) {
        context.fillStyle = area.kind === 'water' ? '#487f80' : '#56794e'; context.beginPath();
        for (const ring of area.polygon) { ring.forEach((point, index) => index ? context.lineTo(point.x, point.z) : context.moveTo(point.x, point.z)); context.closePath(); }
        context.fill('evenodd');
      }
      for (const road of map.data.roads) {
        if (road.tunnel) continue;
        context.strokeStyle = road.kind === 'waterway' ? '#487f80' : '#a9b5a2'; context.lineWidth = road.width;
        context.beginPath();
        road.points.forEach((point, index) => index ? context.lineTo(point.x, point.z) : context.moveTo(point.x, point.z));
        context.stroke();
      }
    }
    this.icons();
    this.click('start-button', () => { this.started = true; root.classList.add('started'); actions.start(); if (!matchMedia('(pointer: coarse)').matches) this.toast('WASD para andar. E para entrar no carro.'); });
    this.click('interact-button', () => input.action('KeyE'));
    this.click('camera-button', () => actions.camera());
    this.click('mute-button', () => this.mute());
    this.click('settings-button', () => this.openSettings());
    this.click('help-button', () => this.openHelp());
    this.click('recover-button', () => { actions.recover(); this.closeDialogs(); this.toast('Carro reposicionado na via.'); });
    this.click('fullscreen-button', () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen().catch(() => this.toast('Tela cheia indisponivel.'));
    });
    this.click('previous-station', () => audio.changeStation(-1));
    this.click('next-station', () => audio.changeStation(1));
    this.click('next-track', () => audio.nextTrack());
    this.click('radio-button', () => this.showRadio());
    this.click('radio-power', () => { audio.enabled = !audio.enabled; this.updateRadio(); });
    root.querySelectorAll<HTMLButtonElement>('.close-dialog').forEach(button => button.addEventListener('click', () => this.closeDialogs()));
    for (const dialog of [this.settings, this.help]) {
      dialog.addEventListener('cancel', event => { event.preventDefault(); this.closeDialogs(); });
      dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) this.closeDialogs(); } });
    }
    this.element<HTMLInputElement>('volume').addEventListener('input', event => {
      audio.volume = Number((event.target as HTMLInputElement).value) / 100;
      this.element('volume-value').textContent = `${Math.round(audio.volume * 100)}%`;
      this.save();
    });
    this.element<HTMLSelectElement>('quality').addEventListener('change', event => { actions.quality((event.target as HTMLSelectElement).value); this.save(); });
    this.element<HTMLInputElement>('radio-toggle').addEventListener('change', event => { audio.enabled = (event.target as HTMLInputElement).checked; this.updateRadio(); });
    root.querySelectorAll<HTMLButtonElement>('[data-hold]').forEach(button => {
      button.addEventListener('pointerdown', event => { event.preventDefault(); button.setPointerCapture(event.pointerId); input.setTouch(button.dataset.hold!, true); });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, () => input.setTouch(button.dataset.hold!, false));
    });
    audio.onChange = () => { this.updateRadio(); this.showRadio(); if (audio.error) this.toast(audio.error); };
    this.load();
    this.updateRadio();
  }

  element<T extends HTMLElement = HTMLElement>(id: string): T { return this.root.querySelector<T>(`#${id}`)!; }
  private click(id: string, handler: () => void): void { this.element<HTMLButtonElement>(id).addEventListener('click', event => { (event.currentTarget as HTMLButtonElement).blur(); handler(); }); }
  private icons(): void { createIcons({ icons: { Sun, Moon, Volume2, VolumeX, Settings2, Camera, ArrowRight, ArrowLeft, Radio, SkipForward, X, Play, RotateCcw, Maximize, HelpCircle, CarFront, Footprints, Pause, ChevronUp, ChevronDown, ChevronLeft, ChevronRight }, attrs: { 'aria-hidden': 'true', 'stroke-width': 1.7 } }); }

  bindTime(day: Daylight): void {
    this.element<HTMLSelectElement>('time-rate').addEventListener('change', event => { day.rate = Number((event.target as HTMLSelectElement).value); });
  }

  mute(): void {
    this.audio.muted = !this.audio.muted;
    const button = this.element('mute-button');
    button.setAttribute('aria-pressed', String(this.audio.muted));
    button.setAttribute('aria-label', this.audio.muted ? 'Ativar audio' : 'Silenciar audio');
    button.innerHTML = `<i data-lucide="${this.audio.muted ? 'volume-x' : 'volume-2'}"></i>`;
    this.icons();
  }

  openSettings(): void { this.input.clear(); this.actions.pause(true); this.settings.showModal(); }
  openHelp(): void { this.input.clear(); this.actions.pause(true); this.help.showModal(); }
  get dialogOpen(): boolean { return this.settings.open || this.help.open || this.geo.dialog.open; }
  closeDialogs(): void { this.settings.close(); this.help.close(); this.geo.close(); this.actions.pause(false); this.input.clear(); (document.activeElement as HTMLElement)?.blur(); }

  toast(message: string): void {
    const toast = this.element('toast');
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => toast.classList.remove('visible'), 4200);
  }

  showRadio(): void {
    this.radioElement.classList.add('expanded');
    clearTimeout(this.radioTimer);
    this.radioTimer = setTimeout(() => this.radioElement.classList.remove('expanded'), 7000);
  }

  updateRadio(): void {
    this.element('station-name').textContent = `${this.audio.station.frequency} FM / ${this.audio.station.name}`;
    this.element('track-name').textContent = this.audio.enabled ? this.audio.track.name : 'Radio desligado';
    this.element('station-genre').textContent = this.audio.station.genre;
    this.element('radio-small').textContent = this.audio.enabled ? this.audio.station.name : 'Radio desligado';
    this.element<HTMLInputElement>('radio-toggle').checked = this.audio.enabled;
    this.element('radio-power').setAttribute('aria-label', this.audio.enabled ? 'Desligar radio' : 'Ligar radio');
    this.save();
  }

  private save(): void {
    try { localStorage.setItem('santa-brisa-settings', JSON.stringify({ volume: this.audio.volume, enabled: this.audio.enabled, quality: this.element<HTMLSelectElement>('quality').value })); } catch {}
  }

  private load(): void {
    try {
      const saved = JSON.parse(localStorage.getItem('santa-brisa-settings') || '{}');
      if (typeof saved.volume === 'number' && Number.isFinite(saved.volume)) this.audio.volume = Math.max(0, Math.min(1, saved.volume));
      if (typeof saved.enabled === 'boolean') this.audio.enabled = saved.enabled;
      if (['low', 'medium', 'high'].includes(saved.quality)) { this.element<HTMLSelectElement>('quality').value = saved.quality; this.actions.quality(saved.quality); }
      this.element<HTMLInputElement>('volume').value = String(Math.round(this.audio.volume * 100));
      this.element('volume-value').textContent = `${Math.round(this.audio.volume * 100)}%`;
    } catch {}
  }

  update(player: Player, day: Daylight, yaw: number): void {
    this.clock.textContent = day.formattedTime;
    const isNight = day.night > 0.6;
    if (isNight !== this.wasNight) {
      this.clock.previousElementSibling!.outerHTML = `<i data-lucide="${isNight ? 'moon' : 'sun'}" aria-hidden="true"></i>`;
      this.icons();
      this.wasNight = isNight;
    }
    if (!this.started) return;
    const speed = Math.round(Math.abs(player.car.speed) * 3.6);
    this.speed.textContent = String(player.driving ? speed : 0).padStart(3, '0');
    this.location.textContent = this.map.kind === 'real' ? this.map.name : district(player.focus);
    this.element('speed-bar').style.width = `${Math.min(100, speed / 1.3)}%`;
    this.element('gear').textContent = !player.driving || speed < 1 ? 'N' : player.car.speed < 0 ? 'R' : String(Math.min(5, 1 + Math.floor(speed / 27)));
    this.element('vehicle-label').textContent = player.driving ? 'BRISA GT / 1986' : 'A PE';
    this.element('car-name').textContent = player.driving ? 'TRACAO TRASEIRA' : this.map.kind === 'real' ? 'ESCALA REAL' : 'ORLA DO SOL';
    this.root.classList.toggle('driving', player.driving);
    this.interact.hidden = !player.driving && !player.nearby;
    this.interact.querySelector('span')!.textContent = player.driving ? 'Sair do carro' : 'Entrar no carro';
    this.element('transition').style.opacity = String(Math.sin(player.transitioning / 0.45 * Math.PI) * 0.75);
    if (player.driving && !this.previousMode) this.showRadio();
    this.previousMode = player.driving;
    const context = this.mapCanvas.getContext('2d')!;
    context.fillStyle = '#243e3c';
    context.fillRect(0, 0, 300, 300);
    context.save();
    context.translate(150, 150);
    context.scale(1.7, 1.7);
    context.translate(-player.focus.x, -player.focus.z);
    context.fillStyle = '#7a9584';
    if (this.map.kind === 'grid') {
      for (const road of this.map.roads) {
        context.fillRect(road - 7, -289, 14, 578);
        context.fillRect(-289, road - 7, 578, 14);
      }
      context.fillStyle = '#487f80';
      context.fillRect(-1000, 318, 2000, 1000);
    } else if (this.geographicMinimap) {
      context.drawImage(this.geographicMinimap, -this.map.extent, -this.map.extent, this.map.data.size, this.map.data.size);
    }
    context.restore();
    context.save();
    context.translate(150, 150);
    context.rotate(Math.PI - yaw);
    context.fillStyle = '#f4d28d';
    context.beginPath(); context.moveTo(0, -13); context.lineTo(9, 9); context.lineTo(0, 5); context.lineTo(-9, 9); context.closePath(); context.fill();
    context.restore();
  }
}