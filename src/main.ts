import * as THREE from 'three';
import { createPhysics, FIXED_STEP } from './core/physics';
import { Input } from './core/input';
import { selectedMap } from './geo/client';
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
  const map = await selectedMap();
  let texture: THREE.Texture | undefined;
  if (map.kind === 'real' && map.data.surfaceTexture) {
    texture = await new THREE.TextureLoader().loadAsync(map.data.surfaceTexture.dataUrl);
    texture.colorSpace = THREE.SRGBColorSpace;
  }
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.domElement.className = 'world-canvas';
  renderer.domElement.setAttribute('aria-label', `${map.name}: mundo 3D de direcao e exploracao urbana`);
  document.title = `${map.name} | Cidade aberta`;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  root.querySelector('.loading')?.remove();
  root.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const physics = createPhysics(map.kind === 'grid');
  const city = createCity(scene, physics, map, texture);
  const day = new Daylight(scene);
  const player = new Player(scene, physics, map);
  const parkedCar = new THREE.Vector3();
  const population = new Population(scene, physics, map);
  const camera = new CameraRig(physics, renderer.domElement);
  camera.orbit = 0.45;
  camera.yaw = map.spawn.yaw;
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
    start: () => { if (map.kind === 'real') player.recover(); started = true; camera.orbit = 0; void audio.start(); },
    pause: value => { paused = value; audio.setPaused(value); },
    quality: setQuality,
    drive: type => { player.car.driveType = type; },
    recover: () => player.recover(),
    camera: () => { camera.mode = (camera.mode + 1) % 2; ui.toast(camera.mode ? 'Camera proxima' : 'Camera de acompanhamento'); },
  }, map);
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
    if (!started && map.kind === 'real') { day.update(FIXED_STEP, player.focus); return; }
    player.focus.copy(player.driving ? player.car.body.position : player.walker.position);
    parkedCar.copy(player.car.body.position);
    city.update(seconds, day.night, player.focus, parkedCar);
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
      // Drop backlog after a long frame instead of spiralling into catch-up steps.
      accumulator = Math.min(accumulator, FIXED_STEP);
      const alpha = accumulator / FIXED_STEP;
      player.sync(day.night, alpha);
      population.render(player.focus, player.car.body.position, alpha);
      city.update(seconds, day.night, player.focus, parkedCar.copy(player.car.body.position));
      camera.update(player, delta, started);
      audio.update(player.driving, player.car.speed, drive.throttle);
    }
    if (now - lastUI > 100) { ui.update(player, day, camera.yaw); lastUI = now; }
    renderer.render(scene, camera.camera);
  };
  for (let step = 0; step < 90; step++) fixedUpdate({ throttle: 0, brake: 1, steer: 0, handbrake: false });
  player.sync(day.night);
  population.render(player.focus, player.car.body.position);
  city.update(seconds, day.night, player.focus);
  camera.update(player, 1, false);
  renderer.setAnimationLoop(frame);

  if (import.meta.env.DEV) {
    Object.assign(window, { __game: {
      player, population, day, audio, camera, physics, ui, map, city, scene,
      snapshot: () => ({ started, paused, quality, driving: player.driving, driveType: player.car.driveType, speed: player.car.speed, position: player.car.body.position.clone(), hours: day.hours, night: day.night, seconds, fps: Math.round(fps), draws: renderer.info.render.calls, triangles: renderer.info.render.triangles, station: audio.station.name, track: audio.track.name, audioState: audio.context?.state, audioLevel: audio.level, traffic: population.cars.filter(car => car.active).length, pedestrians: population.pedestrians.length }),
      advance: (steps: number, drive = { throttle: 0, brake: 0, steer: 0, handbrake: false }, renderFrame = true) => {
        for (let step = 0; step < Math.min(steps, 36000); step++) fixedUpdate(drive);
        player.sync(day.night); population.render(player.focus, player.car.body.position); city.update(seconds, day.night, player.focus, parkedCar.copy(player.car.body.position));
        if (renderFrame) { camera.update(player, 1, started); ui.update(player, day, camera.yaw); renderer.render(scene, camera.camera); }
      },
      pixels: (size = 64) => {
        const target = new THREE.WebGLRenderTarget(size, size);
        renderer.setRenderTarget(target); renderer.render(scene, camera.camera);
        const pixels = new Uint8Array(size * size * 4);
        renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
        renderer.setRenderTarget(null); target.dispose();
        return Array.from(pixels);
      },
    } });
  }
}

initialize().catch(error => {
  console.error(error);
  root.innerHTML = '<div class="fatal"><div><h1>Santa Brisa</h1><p id="startup-error"></p><p>O mundo 3D requer WebGL 2. Cidades reais requerem o servico geografico local.</p><button class="start-button" onclick="location.reload()">Tentar novamente</button> <a class="secondary-button" href="/">Abrir demonstracao offline</a></div></div>';
  root.querySelector('#startup-error')!.textContent = error instanceof Error ? error.message : String(error);
});