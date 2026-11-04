import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ channel: 'chromium', args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
const output = 'test-results';
await mkdir(output, { recursive: true });
const errors = [];
const url = process.env.TEST_URL || 'http://127.0.0.1:5173';
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

const snapshot = () => page.evaluate(() => window.__game.snapshot());
const pixelCheck = async (targetPage = page) => {
  const statistics = await targetPage.evaluate(() => {
    const pixels = window.__game.pixels();
    const center = window.__game.player.model.position.clone();
    center.y += 0.5;
    center.project(window.__game.camera.camera);
    const centerX = Math.round((center.x + 1) * 32);
    const centerY = Math.round((center.y + 1) * 32);
    const colors = new Set();
    let total = 0;
    let carLuminance = 0;
    let carSamples = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      colors.add(pixels.slice(index, index + 3).join(','));
      total += pixels[index] + pixels[index + 1] + pixels[index + 2];
      const column = (index / 4) % 64;
      const row = Math.floor(index / 4 / 64);
      if (Math.abs(column - centerX) <= 2 && Math.abs(row - centerY) <= 2) {
        carLuminance += 0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2];
        carSamples++;
      }
    }
    return { colors: colors.size, mean: total / (pixels.length / 4 * 3), carLuminance: carSamples ? carLuminance / carSamples : 0 };
  });
  assert.ok(statistics.colors > 80, `Canvas has only ${statistics.colors} colors`);
  assert.ok(statistics.mean > 3, 'Canvas is blank or black');
  return statistics;
};

const layoutCheck = async () => {
  const issues = await page.evaluate(() => {
    const problems = [];
    if (document.documentElement.scrollWidth > innerWidth) problems.push('horizontal overflow');
    for (const element of document.querySelectorAll('button, h1, .speedometer, .radio-strip, .topbar')) {
      const style = getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none' || !element.getClientRects().length) continue;
      if (element.closest('dialog:not([open])') || element.closest('.in-game') && !document.querySelector('#app.started')) continue;
      const rect = element.getBoundingClientRect();
      if (rect.left < -1 || rect.right > innerWidth + 1 || rect.top < -1 || rect.bottom > innerHeight + 1) problems.push(`${element.id || element.className} outside viewport`);
    }
    return problems;
  });
  assert.deepEqual(issues, []);
};

try {
  await page.goto(url);
  await page.waitForFunction(() => Boolean(window.__game), { timeout: 30000 });
  const daylightPixels = await pixelCheck();
  await layoutCheck();
  await page.screenshot({ path: `${output}/desktop-welcome.png` });
  await page.getByRole('button', { name: 'Explorar a cidade' }).click();
  const walkingOrigin = await page.evaluate(() => {
    const game = window.__game;
    const origin = { x: game.player.walker.position.x, y: game.player.walker.position.y, z: game.player.walker.position.z };
    game.player.walker.position.set(25, 0.5, 302);
    game.player.walker.velocity.setZero();
    game.player.walker.aabbNeedsUpdate = true;
    game.camera.yaw = Math.PI / 2;
    game.camera.orbit = 0;
    game.advance(1);
    return origin;
  });
  for (const [key, axis, sign] of [['w', 'x', 1], ['a', 'z', -1], ['d', 'z', 1], ['s', 'x', -1]]) {
    const walkingBefore = await page.evaluate(axis => ({ position: window.__game.player.walker.position[axis], seconds: window.__game.snapshot().seconds }), axis);
    await page.keyboard.down(key);
    try {
      await page.waitForFunction(({ axis, sign, origin }) => (window.__game.player.walker.position[axis] - origin) * sign > 1.8, { axis, sign, origin: walkingBefore.position }, { timeout: 5000 });
    } finally {
      await page.keyboard.up(key);
    }
    const walkingAfter = await page.evaluate(axis => ({ position: window.__game.player.walker.position[axis], seconds: window.__game.snapshot().seconds }), axis);
    const walkingSpeed = (walkingAfter.position - walkingBefore.position) * sign / (walkingAfter.seconds - walkingBefore.seconds);
    assert.ok(walkingSpeed > 5 && walkingSpeed <= 6.01, `Unexpected walking speed for ${key}: ${walkingSpeed}`);
  }
  await page.screenshot({ path: `${output}/desktop-walking.png` });
  await page.evaluate(origin => {
    const game = window.__game;
    game.player.walker.position.set(origin.x, origin.y, origin.z);
    game.player.walker.velocity.setZero();
    game.player.walker.aabbNeedsUpdate = true;
    game.advance(1);
  }, walkingOrigin);
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__game.player.driving && window.__game.player.transitioning === 0);
  const before = await snapshot();
  await page.keyboard.down('w');
  await page.waitForFunction(() => window.__game.player.car.speed > 5, { timeout: 15000 });
  await page.keyboard.up('w');
  const moving = await snapshot();
  assert.ok(moving.position.x > before.position.x + 2, 'Throttle did not move the car');
  await page.keyboard.press('e');
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Pare'));
  assert.equal((await snapshot()).driving, true);
  await page.keyboard.down('a');
  await page.waitForFunction(() => Math.abs(window.__game.player.car.steering) > 0.15);
  await page.keyboard.up('a');
  await page.keyboard.down('Space');
  await page.waitForFunction(() => Math.abs(window.__game.player.car.speed) < 0.7, { timeout: 15000 });
  await page.keyboard.up('Space');
  await page.keyboard.press('e');
  await page.waitForFunction(() => !window.__game.player.driving && window.__game.player.transitioning === 0);
  assert.equal(await page.evaluate(() => window.__game.player.nearby), true);
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__game.player.driving);
  const radioBefore = await snapshot();
  await page.keyboard.press('r');
  await page.waitForFunction(name => window.__game.audio.station.name !== name, radioBefore.station);
  const trackBefore = (await snapshot()).track;
  await page.keyboard.press('n');
  await page.waitForFunction(name => window.__game.audio.track.name !== name, trackBefore);
  await page.waitForFunction(() => window.__game.audio.level > 0.0001);
  assert.equal((await snapshot()).audioState, 'running');
  await page.keyboard.press('c');
  await page.waitForFunction(() => window.__game.camera.mode === 1);
  await page.keyboard.press('c');
  await page.getByRole('button', { name: 'Abrir ajustes' }).click();
  assert.equal((await snapshot()).paused, true);
  const pausedTime = (await snapshot()).seconds;
  await page.waitForTimeout(300);
  assert.equal((await snapshot()).seconds, pausedTime);
  await page.locator('#quality').selectOption('low');
  await page.locator('#time-rate').selectOption('300');
  assert.equal(await page.evaluate(() => window.__game.day.rate), 300);
  await page.locator('#volume').focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => window.__game.audio.volume), 0.01);
  await page.locator('#volume').press('End');
  await page.locator('#quality').selectOption('medium');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.evaluate(() => { window.__game.player.recover(); window.__game.day.hours = 12; window.__game.advance(1); });
  await pixelCheck();
  await page.screenshot({ path: `${output}/desktop-driving.png` });
  await page.evaluate(() => { window.__game.day.hours = 23; window.__game.advance(1); });
  const nightPixels = await pixelCheck();
  assert.ok((await snapshot()).night > 0.9);
  assert.ok(daylightPixels.mean - nightPixels.mean > 10, 'Night should remain darker than day');
  assert.ok(nightPixels.mean > 18, 'Night scenery is too dark');
  assert.ok(nightPixels.carLuminance > 3, 'Car body is too dark at night');
  await page.screenshot({ path: `${output}/desktop-night.png` });
  await page.evaluate(() => {
    window.__game.day.hours = 12;
    window.__game.player.car.reset(-260, 284.2, Math.PI / 2);
    window.__game.advance(1800, { throttle: 1, brake: 0, steer: 0, handbrake: false });
  });
  const collision = await snapshot();
  assert.ok(collision.position.x < 315 && collision.position.y > -1, 'Car escaped the city bounds');
  await page.evaluate(() => { window.__game.player.recover(); window.__game.advance(9000); });
  assert.ok((await snapshot()).seconds > 180);
  assert.equal(await page.evaluate(() => window.__game.population.cars.every(car => Number.isFinite(car.body.position.x))), true);

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const mobile = await mobileContext.newPage();
  mobile.on('pageerror', error => errors.push(error.message));
  await mobile.goto(url);
  await mobile.waitForFunction(() => Boolean(window.__game));
  await mobile.screenshot({ path: `${output}/mobile-welcome.png` });
  await mobile.getByRole('button', { name: 'Explorar a cidade' }).click();
  await mobile.getByRole('button', { name: /Entrar no carro/ }).click();
  await mobile.waitForFunction(() => window.__game.player.driving);
  assert.equal(await mobile.getByRole('button', { name: 'Acelerar', exact: true }).isVisible(), true);
  const accelerator = await mobile.getByRole('button', { name: 'Acelerar', exact: true }).boundingBox();
  const touchSession = await mobileContext.newCDPSession(mobile);
  await touchSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: accelerator.x + accelerator.width / 2, y: accelerator.y + accelerator.height / 2 }] });
  await mobile.waitForFunction(() => window.__game.player.car.speed > 2);
  await touchSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const mobilePixels = await mobile.evaluate(() => new Set(window.__game.pixels().filter((_, index) => index % 4 !== 3)).size);
  assert.ok(mobilePixels > 40);
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const overlapping = await mobile.evaluate(() => {
    const selectors = ['.topbar', '.navigation', '.speedometer', '.interaction', '.touch-controls', '.bottom-tools', '.radio-strip'];
    const bounds = selectors.map(selector => [selector, document.querySelector(selector).getBoundingClientRect()]);
    const result = [];
    for (let first = 0; first < bounds.length; first++) for (let second = first + 1; second < bounds.length; second++) {
      const [firstName, firstRect] = bounds[first]; const [secondName, secondRect] = bounds[second];
      if (firstRect.width && secondRect.width && Math.min(firstRect.right, secondRect.right) - Math.max(firstRect.left, secondRect.left) > 1 && Math.min(firstRect.bottom, secondRect.bottom) - Math.max(firstRect.top, secondRect.top) > 1) result.push(`${firstName} / ${secondName}`);
    }
    return result;
  });
  assert.deepEqual(overlapping, []);
  await mobile.screenshot({ path: `${output}/mobile-driving.png` });
  await mobile.evaluate(() => { window.__game.day.hours = 23; window.__game.advance(1); });
  const mobileNightPixels = await pixelCheck(mobile);
  assert.ok(mobileNightPixels.carLuminance > 3, 'Car body is too dark at night on mobile');
  await mobile.screenshot({ path: `${output}/mobile-night.png` });
  await mobile.setViewportSize({ width: 844, height: 390 });
  await mobile.screenshot({ path: `${output}/mobile-landscape.png` });
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await mobileContext.close();
  assert.deepEqual(errors, [], 'Browser errors');
  console.log(JSON.stringify({ result: 'PASS', checks: ['nonblank 3D canvas', 'keyboard driving and braking', 'safe entry and exit', 'station and track switching', 'real audio signal', 'camera switch', 'pause and settings', 'day and night pixels', 'world boundary collision', 'three-minute simulation', 'mobile touch driving', 'mobile HUD overlap'], daylightPixels, nightPixels, runtime: await snapshot(), screenshots: output }, null, 2));
} finally {
  await browser.close();
}