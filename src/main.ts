import * as THREE from 'three';
import { createPhysics, FIXED_STEP } from './core/physics';
import { Input } from './core/input';
import { SANTA_BRISA } from './world/map';
import { createCity } from './world/city';
import { Daylight } from './systems/daylight';
import { Population } from './systems/population';
import { Player } from './systems/player';
import { CameraRig } from './systems/camera';
import { AudioSystem } from './systems/audio';
import { UI } from './ui';
import './style.css';

const root = document.querySelector<HTMLElement>('#app')!;
root.innerHTML = '<div class="loading" role="status"><span>Santa Brisa / preparando a cidade...</span></div>';

async function initialize(): Promise<void> {
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.domElement.className = 'world-canvas';
  renderer.domElement.setAttribute('aria-label', 'Santa Brisa: mundo 3D de direcao e exploracao urbana');
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  root.querySelector('.loading')?.remove();
  root.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const physics = createPhysics();
  const city = createCity(scene, physics, SANTA_BRISA);
  const day = new Daylight(scene);
  const player = new Player(scene, physics, SANTA_BRISA);
  const population = new Population(scene, physics, SANTA_BRISA);
  const camera = new CameraRig(physics, renderer.domElement);
  camera.orbit = 0.45;
  const input = new Input();
  const audio = new AudioSystem();
  let started = false;
  let paused = false;
  let seconds = 0;
  let accumulator = 0;
  let lastTime = performance.now();
  let lastUI = 0;
  let fps = 60;
  let quality = 'medium';

  const setQuality = (level: string) => {
    quality = level;
    renderer.setPixelRatio(Math.min(devicePixelRatio, level === 'high' ? 2 : level === 'low' ? 1 : 1.5));
    renderer.shadowMap.enabled = level !== 'low';
    renderer.setSize(innerWidth, innerHeight);
  };
  const ui = new UI(root, audio, input, {
    start: () => { started = true; camera.orbit = 0; void audio.start(); },
    pause: value => { paused = value; audio.setPaused(value); },
    quality: setQuality,
    recover: () => player.recover(),
    camera: () => { camera.mode = (camera.mode + 1) % 2; ui.toast(camera.mode ? 'Camera proxima' : 'Camera de acompanhamento'); },
  });
  ui.bindTime(day);
  renderer.domElement.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    paused = true;
    audio.setPaused(true);
    ui.toast('Contexto grafico perdido. Recarregue a pagina para continuar.');
  });
  document.addEventListener('visibilitychange', () => {
    input.clear();
    if (document.hidden && started && !ui.dialogOpen) ui.openSettings();
    lastTime = performance.now();
    accumulator = 0;
  });
  window.addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.resize(); });

  const fixedUpdate = (drive: ReturnType<Input['sample']>) => {
    seconds += FIXED_STEP;
    player.update(started ? drive : { throttle: 0, brake: 1, steer: 0, handbrake: false }, FIXED_STEP, camera.yaw + camera.orbit);
    population.update(FIXED_STEP, seconds, player.car.body, player.focus, day.night, player.driving ? undefined : player.walker);
    physics.step(FIXED_STEP);
    day.update(FIXED_STEP, player.focus);
    if (player.car.body.position.y < -10 || player.walker.position.y < -10) player.recover();
  };

  const frame = (now: number) => {
    const delta = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    fps = THREE.MathUtils.damp(fps, 1 / Math.max(delta, 0.001), 2, delta);
    const drive = input.sample();
    if (input.consume('Escape')) { if (ui.dialogOpen) ui.closeDialogs(); else ui.openSettings(); }
    if (!paused && started) {
      if (input.consume('KeyE')) { const message = player.interact(); if (message) ui.toast(message); }
      if (input.consume('KeyC')) { camera.mode = (camera.mode + 1) % 2; ui.toast(camera.mode ? 'Camera proxima' : 'Camera de acompanhamento'); }
      if (input.consume('KeyR')) audio.changeStation(1);
      if (input.consume('KeyN')) audio.nextTrack();
      if (input.consume('KeyM')) ui.mute();
      if (input.consume('KeyH')) ui.openHelp();
    }
    if (!paused && !document.hidden) {
      accumulator += delta;
      let steps = 0;
      while (accumulator >= FIXED_STEP && steps < 6) { fixedUpdate(drive); accumulator -= FIXED_STEP; steps++; }
      player.sync(day.night);
      population.render(player.focus);
      city.update(seconds, day.night, player.focus);
      camera.update(player, delta, started);
      audio.update(player.driving, player.car.speed, drive.throttle);
    }
    if (now - lastUI > 100) { ui.update(player, day, camera.yaw); lastUI = now; }
    renderer.render(scene, camera.camera);
  };
  for (let step = 0; step < 90; step++) fixedUpdate({ throttle: 0, brake: 1, steer: 0, handbrake: false });
  player.sync(day.night);
  population.render(player.focus);
  city.update(seconds, day.night, player.focus);
  camera.update(player, 1, false);
  renderer.setAnimationLoop(frame);

  if (import.meta.env.DEV) {
    Object.assign(window, { __game: {
      player, population, day, audio, camera, physics, ui,
      snapshot: () => ({ started, paused, quality, driving: player.driving, speed: player.car.speed, position: player.car.body.position.clone(), hours: day.hours, night: day.night, seconds, fps: Math.round(fps), draws: renderer.info.render.calls, triangles: renderer.info.render.triangles, station: audio.station.name, track: audio.track.name, audioState: audio.context?.state, audioLevel: audio.level, traffic: population.cars.filter(car => car.active).length, pedestrians: population.pedestrians.length }),
      advance: (steps: number, drive = { throttle: 0, brake: 0, steer: 0, handbrake: false }) => {
        for (let step = 0; step < Math.min(steps, 36000); step++) fixedUpdate(drive);
        player.sync(day.night); population.render(player.focus); city.update(seconds, day.night, player.focus); camera.update(player, 1, started); ui.update(player, day, camera.yaw); renderer.render(scene, camera.camera);
      },
      pixels: () => {
        const target = new THREE.WebGLRenderTarget(64, 64);
        renderer.setRenderTarget(target); renderer.render(scene, camera.camera);
        const pixels = new Uint8Array(64 * 64 * 4);
        renderer.readRenderTargetPixels(target, 0, 0, 64, 64, pixels);
        renderer.setRenderTarget(null); target.dispose();
        return Array.from(pixels);
      },
    } });
  }
}

initialize().catch(error => {
  console.error(error);
  root.innerHTML = '<div class="fatal"><div><h1>Santa Brisa</h1><p>Nao foi possivel iniciar o mundo 3D.<br>Use um navegador atualizado com WebGL 2 e aceleracao grafica habilitada.</p><button class="start-button" onclick="location.reload()">Tentar novamente</button></div></div>';
});