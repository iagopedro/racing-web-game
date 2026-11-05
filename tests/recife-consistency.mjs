import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { projection, terrainHeight } from '../src/geo/coordinates.ts';
import { insidePolygon } from '../src/geo/geometry.ts';

const base = process.env.TEST_URL || 'http://127.0.0.1:5174';
const id = process.env.REAL_CITY_ID;
assert.ok(id, 'Defina REAL_CITY_ID com um recorte revisado de 5 km centrado no Recife Antigo.');
const response = await fetch(`${base}/api/geo/maps/${id}`);
assert.ok(response.ok, 'O recorte precisa existir no servico local.');
const city = await response.json();
assert.equal(city.version, 2);
assert.equal(city.size, 5000);
assert.equal(city.terrain.processing, 'urban-ground');
assert.ok(Math.abs(city.center.lat + 8.0631) < 0.0001 && Math.abs(city.center.lon + 34.8712) < 0.0001);
assert.equal(new Set(city.warnings).size, city.warnings.length);
const project = projection(city.center).project;
const anchors = [
  { name: 'Marco Zero', lat: -8.06316, lon: -34.87113, water: false },
  { name: 'Continente / Boa Vista', lat: -8.0631, lon: -34.89, water: false },
  { name: 'Recife Antigo', lat: -8.0631, lon: -34.872, water: false },
  { name: 'Atlantico', lat: -8.06316, lon: -34.86, water: true },
];
for (const anchor of anchors) {
  const water = city.areas.some(area => area.kind === 'water' && insidePolygon(project(anchor), area.polygon));
  assert.equal(water, anchor.water, `${anchor.name}: erro no contorno de terra/agua`);
}
assert.ok(city.areas.some(area => area.kind === 'paved' && area.name === 'Pátio de São Pedro'));
const roadsToDrive = ['Avenida Alfredo Lisboa', 'Rua do Riachuelo', 'Avenida Dantas Barreto'].map(name => {
  const candidates = city.roads.filter(road => road.name === name && road.drive && !road.bridge && !road.tunnel).map(road => ({
    ...road, length: road.points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - road.points[index].x, point.z - road.points[index].z), 0),
  })).sort((a, b) => b.length - a.length);
  assert.ok(candidates[0]?.length > 70, `Via de referencia ausente ou curta: ${name}`);
  return candidates[0];
});
let maxGrade = 0, rawMaxGrade = 0;
const raw = { ...city.terrain, heights: city.terrain.rawHeights };
for (const road of city.roads.filter(road => road.drive && !road.bridge)) {
  for (let i = 1; i < road.points.length; i++) {
    const a = road.points[i - 1], b = road.points[i], length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < 0.1) continue;
    maxGrade = Math.max(maxGrade, Math.abs(terrainHeight(city.terrain, a.x, a.z) - terrainHeight(city.terrain, b.x, b.z)) / length);
    rawMaxGrade = Math.max(rawMaxGrade, Math.abs(terrainHeight(raw, a.x, a.z) - terrainHeight(raw, b.x, b.z)) / length);
  }
}
assert.ok(maxGrade < 0.1, `Piso urbano com inclinacao excessiva: ${maxGrade}`);
assert.ok(rawMaxGrade > maxGrade * 2, 'O filtro nao reduziu os picos do DSM deste recorte.');
await mkdir('test-results', { recursive: true });
const browser = await chromium.launch({ channel: 'chromium', args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${base}/?city=${id}`);
  await page.waitForFunction(() => window.__game?.map.kind === 'real', null, { timeout: 90000 });
  const origin = await page.evaluate(() => ({ ...window.__game.player.car.body.position }));
  await page.waitForTimeout(1000);
  const after = await page.evaluate(() => ({ ...window.__game.player.car.body.position }));
  assert.deepEqual(after, origin, 'O carro deslizou antes de iniciar a partida.');
  await page.getByRole('button', { name: 'Explorar a cidade' }).click();
  await page.locator('#interact-button').click();
  await page.waitForFunction(() => window.__game.player.driving && window.__game.player.transitioning === 0);
  const drives = [];
  for (const road of roadsToDrive) {
    console.log(`Checking street clearance: ${road.name}`);
    const result = await page.evaluate(({ road }) => {
      const g = window.__game;
      // Isolate static street clearance; NPC interactions have separate regressions.
      for (const npc of [...g.population.cars, ...g.population.pedestrians]) npc.body.collisionFilterMask = 0;
      const points = road.oneway === -1 ? [...road.points].reverse() : road.points;
      const heights = road.oneway === -1 ? [...road.heights].reverse() : road.heights;
      const start = 2, origin = points[start], next = points[start + 1];
      g.player.car.reset(origin.x, origin.z, Math.atan2(next.x - origin.x, next.z - origin.z), heights[start]);
      g.advance(90, { throttle: 0, brake: 1, steer: 0, handbrake: false });
      let index = start, traveled = 0, previous = g.player.car.body.position.clone(), slowFrames = 0, maxSpeed = 0;
      const targetDistance = Math.min(150, road.length - 35);
      for (let step = 0; step < 800 && traveled < targetDistance; step++) {
        const body = g.player.car.body;
        while (index < points.length - 2 && Math.hypot(points[index].x - body.position.x, points[index].z - body.position.z) < 9) index++;
        const target = points[index];
        const forward = g.player.model.getWorldDirection(g.player.focus.clone());
        const yaw = Math.atan2(forward.x, forward.z), desired = Math.atan2(target.x - body.position.x, target.z - body.position.z);
        const difference = Math.atan2(Math.sin(desired - yaw), Math.cos(desired - yaw));
        const speed = g.player.car.speed;
        g.advance(6, { throttle: speed < 7 ? 0.65 : 0, brake: speed > 8 ? 0.25 : 0, steer: Math.max(-1, Math.min(1, difference * 2.5)), handbrake: false }, false);
        traveled += body.position.distanceTo(previous); previous.copy(body.position);
        maxSpeed = Math.max(maxSpeed, Math.abs(speed));
        slowFrames = Math.abs(speed) < 0.3 && step > 30 ? slowFrames + 1 : 0;
        if (slowFrames > 40) break;
      }
      const body = g.player.car.body;
      g.advance(0);
      const displacement = Math.hypot(body.position.x - origin.x, body.position.z - origin.z);
      const up = g.player.model.up.clone().applyQuaternion(g.player.model.quaternion);
      return {
        name: road.name, traveled, targetDistance, displacement, maxSpeed, upright: up.y,
        position: { x: body.position.x, y: body.position.y, z: body.position.z }, index, points: points.length,
        target: points[index],
        wheels: g.player.car.vehicle.wheelInfos.map(wheel => ({ contact: wheel.isInContact, suspension: wheel.suspensionLength, hit: { x: wheel.raycastResult.hitPointWorld.x, y: wheel.raycastResult.hitPointWorld.y, z: wheel.raycastResult.hitPointWorld.z }, body: g.city.colliderLabels.get(wheel.raycastResult.body?.id) })),
        engine: g.player.car.engine,
        contacts: g.physics.contacts.filter(contact => contact.bi === body || contact.bj === body).map(contact => {
          const other = contact.bi === body ? contact.bj : contact.bi;
          return { source: g.city.colliderLabels.get(other.id), normal: { x: contact.ni.x, y: contact.ni.y, z: contact.ni.z }, position: { x: other.position.x, y: other.position.y, z: other.position.z } };
        }),
      };
    }, { road });
    drives.push(result);
    if (result.traveled < result.targetDistance) await page.screenshot({ path: 'test-results/recife-driving-failure.png' });
    assert.ok(result.traveled >= result.targetDistance && result.displacement > result.targetDistance * 0.65 && result.upright > 0.8, JSON.stringify(result));
  }
  await page.evaluate(() => {
    const g = window.__game; g.player.recover(); g.day.hours = 12; g.advance(180, { throttle: 0, brake: 1, steer: 0, handbrake: false });
  });
  await page.getByRole('button', { name: 'Sair do carro' }).click();
  await page.waitForFunction(() => !window.__game.player.driving);
  const pedestrianRoad = city.roads.find(road => road.name === 'Rua do Bom Jesus' && road.walk);
  assert.ok(pedestrianRoad && !pedestrianRoad.drive, 'Trecho pedonal da Rua do Bom Jesus deve permanecer exclusivo para pedestres.');
  const walk = await page.evaluate(({ road }) => {
    const g = window.__game, origin = road.points[2];
    g.player.walker.position.set(origin.x, road.heights[2] + 0.55, origin.z);
    g.player.walker.velocity.setZero(); g.player.walker.aabbNeedsUpdate = true;
    g.camera.orbit = 0;
    let index = 3;
    for (let step = 0; step < 120; step++) {
      const body = g.player.walker;
      while (index < road.points.length - 1 && Math.hypot(road.points[index].x - body.position.x, road.points[index].z - body.position.z) < 3) index++;
      const target = road.points[index];
      g.camera.yaw = Math.atan2(target.x - body.position.x, target.z - body.position.z);
      g.advance(6, { throttle: 1, brake: 0, steer: 0, handbrake: false }, false);
    }
    g.advance(0);
    return { distance: Math.hypot(g.player.walker.position.x - origin.x, g.player.walker.position.z - origin.z), street: g.ui.element('location').textContent };
  }, { road: pedestrianRoad });
  assert.ok(walk.distance > 55, `Caminhada bloqueada na Rua do Bom Jesus: ${JSON.stringify(walk)}`);
  assert.equal(walk.street, 'Rua do Bom Jesus');
  await page.getByRole('button', { name: 'Cidades reais', exact: true }).click();
  await page.getByText('Piso urbano aproximado:', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Fechar cidades reais' }).click();
  await page.screenshot({ path: 'test-results/recife-revised-street.png' });
  await page.evaluate(() => {
    const g = window.__game;
    g.ui.openSettings(); g.ui.element('settings-dialog').close();
    g.scene.fog = null;
    g.camera.camera.position.set(0, 1700, 500);
    g.camera.camera.lookAt(0, 0, 0); g.camera.camera.updateMatrixWorld();
    g.scene.traverse(object => { if (object.type === 'Group') object.visible = true; });
  });
  await page.waitForTimeout(100);
  await page.screenshot({ path: 'test-results/recife-revised-overview.png' });
  assert.deepEqual(errors, []);
  await rm('test-results/recife-driving-failure.png', { force: true });
  console.log(JSON.stringify({
    result: 'PASS', maxGrade, rawMaxGrade, anchors,
    drives: drives.map(({ name, traveled, displacement, maxSpeed, upright }) => ({ name, traveled, displacement, maxSpeed, upright })), walk,
  }, null, 2));
} finally { await browser.close(); }
