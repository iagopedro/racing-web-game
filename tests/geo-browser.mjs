import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { cityFixture } from './geo-fixture.ts';

const browser = await chromium.launch({ channel: 'chromium', args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
const baseURL = process.env.TEST_URL || 'http://127.0.0.1:5173';
const fixture = cityFixture();
const errors = [];
await mkdir('test-results', { recursive: true });
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    let submitted;
    await page.route('**/api/geo/maps**', async route => {
      if (route.request().method() === 'POST') {
        submitted = route.request().postDataJSON();
        await route.fulfill({ json: { id: fixture.id } });
      } else await route.fulfill({ json: fixture });
    });
    await page.goto(baseURL);
    await page.waitForFunction(() => Boolean(window.__game));
    await page.getByRole('button', { name: 'Cidades reais', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__game.snapshot().paused), true);
    await page.locator('#geo-name').fill('Recife test fixture');
    await page.locator('#geo-size').fill('0.4');
    await page.locator('#geo-elevation').uncheck();
    await page.locator('#geo-imagery').uncheck();
    await page.getByRole('button', { name: 'Gerar e abrir cidade' }).click();
    await page.waitForURL(`**?city=${fixture.id}`);
    await page.waitForFunction(() => window.__game?.map.kind === 'real');
    assert.equal(submitted.name, 'Recife test fixture');
    assert.equal(submitted.sizeKm, 0.4); assert.equal(submitted.elevation, false);
    assert.equal(await page.locator('.geo-credits a').count(), 1);
    await page.getByRole('button', { name: 'Explorar a cidade' }).click();
    await page.locator('#interact-button').click();
    await page.waitForFunction(() => window.__game.player.driving && window.__game.player.transitioning === 0);
    const result = await page.evaluate(() => {
      const g = window.__game;
      const origin = g.player.car.body.position.clone();
      g.advance(120, { throttle: 1, brake: 0, steer: 0, handbrake: false });
      const pixels = g.pixels();
      return { speed: g.player.car.speed, moved: g.player.car.body.position.distanceTo(origin), colors: new Set(pixels.map((_, i) => i % 4 === 0 ? pixels.slice(i, i + 3).join(',') : '').filter(Boolean)).size };
    });
    assert.ok(result.speed > 2, JSON.stringify(result)); assert.ok(result.moved > 3); assert.ok(result.colors > 50);
    await page.getByRole('button', { name: 'Cidades reais', exact: true }).click();
    await page.getByText('Modo plano escolhido:', { exact: false }).waitFor();
    assert.equal(await page.evaluate(() => window.__game.snapshot().paused), true);
    await page.screenshot({ path: `test-results/geo-${mobile ? 'mobile' : 'desktop'}-sources.png` });
    await page.getByRole('button', { name: 'Fechar cidades reais' }).click();
    const overflow = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth > innerWidth,
      buttons: [...document.querySelectorAll('.topbar button')].some(button => button.getBoundingClientRect().right > innerWidth),
    }));
    assert.deepEqual(overflow, { document: false, buttons: false });
    await page.screenshot({ path: `test-results/geo-${mobile ? 'mobile' : 'desktop'}.png` });
    await context.close();
  }
  if (process.env.REAL_CITY_ID) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`${baseURL}/?city=${process.env.REAL_CITY_ID}`);
    await page.waitForFunction(() => window.__game?.map.kind === 'real', { timeout: 60000 });
    await page.getByRole('button', { name: 'Explorar a cidade' }).click();
    await page.locator('#interact-button').click();
    await page.waitForFunction(() => window.__game.player.driving);
    const real = await page.evaluate(() => {
      const g = window.__game;
      g.day.hours = 12;
      g.advance(120, { throttle: 1, brake: 0, steer: 0, handbrake: false });
      return { name: g.map.name, buildings: g.map.data.buildings.length, source: g.map.data.terrain.source, speed: g.player.car.speed, height: g.player.car.body.position.y, ...g.snapshot() };
    });
    assert.ok(real.buildings > 0); assert.equal(real.source, 'copernicus'); assert.ok(real.speed > 1, JSON.stringify(real)); assert.ok(Number.isFinite(real.height));
    console.log(JSON.stringify({ realCity: real }, null, 2));
    await page.screenshot({ path: 'test-results/recife-real-driving.png' });
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log('PASS: geographic selection, source provenance, real geometry driving, responsive UI and optional live city.');
} finally { await browser.close(); }
