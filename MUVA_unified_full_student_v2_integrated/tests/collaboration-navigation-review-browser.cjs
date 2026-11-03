const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const out = process.env.MUVA_SCREENSHOT_DIR || 'docs/ui-verification/collaboration/navigation-review-2026-10-31';
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 2048, height: 1152 } });
  const errors = [], consoleErrors = [], zoomSamples = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('dialog', d => d.accept());
  const base = process.env.MUVA_TEST_URL || 'http://127.0.0.1:5175';
  const shot = name => page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  let scope = page, storeUrl;
  const map = () => scope.getByTestId('fleet-map');
  const camera = () => map().getByTestId('satellite-basemap').getAttribute('data-camera-zoom').then(Number);
  const mission = () => page.evaluate(async url => { const s = (await import(url)).useCollaborationStore.getState(); return { groups: s.missionState.groups, positions: s.missionState.drones.map(d => d.position), running: s.isRunning }; }, storeUrl);
  const tools = async title => { if (!await scope.getByTitle(title, { exact: true }).count()) await scope.getByTitle('地图工具', { exact: true }).click(); await scope.getByTitle(title, { exact: true }).click(); };
  const nativeStep = async (direction, expected) => {
    const start = await camera();
    await scope.getByTitle(direction > 0 ? '放大' : '缩小', { exact: true }).click();
    const samples = [];
    for (let i = 0; i < 12; i++) { await page.waitForTimeout(45); samples.push(await camera()); }
    const end = await camera();
    const target = expected ?? Math.max(0, Math.min(24, start + direction));
    assert.ok(Math.abs(end - target) < .002, `native step ${start} → ${end}, expected ${target}`);
    zoomSamples.push({ start, end, intermediateFrames: samples.filter(z => Math.abs(z - start) > .001 && Math.abs(z - end) > .001).length });
    return samples;
  };
  const markerCheck = async () => {
    const result = await map().locator('[data-testid^="marker-uav"]').evaluateAll(es => es.map(e => { const svg = e.querySelector('svg'), r = svg.getBoundingClientRect(), b = e.getBoundingClientRect(); return { w: r.width, h: r.height, stroke: getComputedStyle(svg).stroke, left: b.left, top: b.top, width: b.width, height: b.height }; }));
    assert.equal(result.length, 15);
    assert.ok(result.every(x => x.w === 30 && x.h === 30 && x.stroke !== 'none' && x.width === 32 && x.height === 32), 'all aircraft must retain visible 30px quadrotor SVG and stable geographic anchor');
  };
  const registration = async () => {
    const error = await map().evaluate(e => {
      const base = e.querySelector('[data-testid=satellite-basemap]'), r = e.getBoundingClientRect();
      const world = 512 * 2 ** Number(base.dataset.cameraZoom);
      const project = (lng, lat) => [(lng + 180) / 360, (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2];
      const center = project(+base.dataset.cameraLongitude, +base.dataset.cameraLatitude);
      return Math.max(...[...e.querySelectorAll('[data-testid^="marker-uav"]')].map(m => { const p = project(+m.dataset.longitude, +m.dataset.latitude), b = m.getBoundingClientRect(); return Math.max(Math.abs(b.x + b.width / 2 - r.x - (r.width / 2 + (p[0] - center[0]) * world)), Math.abs(b.y + b.height / 2 - r.y - (r.height / 2 + (p[1] - center[1]) * world))); }));
    });
    assert.ok(error < 1, `ENU/WGS84 registration error ${error}px`);
  };
  const fit = async () => { await scope.getByTitle('自动适配视野', { exact: true }).click(); await page.waitForTimeout(200); };
  const layout = async () => {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const native = map().locator('[data-native-navigation]');
    assert.equal(await native.locator('.maplibregl-ctrl-zoom-in').count(), 1);
    assert.equal(await native.locator('.maplibregl-ctrl-zoom-out').count(), 1);
    assert.equal(await native.locator('.maplibregl-ctrl-compass').count(), 1);
    assert.equal(await native.locator('svg').count(), 0, 'use original MapLibre icons, not application SVG copies');
    assert.notEqual(await native.locator('.maplibregl-ctrl-zoom-in .maplibregl-ctrl-icon').evaluate(e => getComputedStyle(e).backgroundImage), 'none');
    const box = await scope.getByRole('navigation', { name: '地图导航工具' }).boundingBox();
    const mb = await map().boundingBox();
    assert.ok(box.x >= mb.x && box.x + box.width <= mb.x + mb.width + 1 && box.y + box.height <= mb.y + mb.height, 'native navigation within viewport');
    await markerCheck(); await registration();
  };
  try {
    await page.goto(`${base}/login`); await page.evaluate(() => { sessionStorage.setItem('muva-mock-user', 'signed-in'); sessionStorage.setItem('muva-user-role', 'student'); });
    await page.goto(`${base}/experiments/collaboration`); await page.getByRole('button', { name: /进入教学模拟模式/ }).click();
    storeUrl = await page.evaluate(() => performance.getEntriesByType('resource').find(e => new URL(e.name).pathname === '/src/stores/collaborationStore.ts').name);
    const nav = name => page.getByRole('navigation', { name: '实验三六步教学流程' }).getByRole('button', { name: new RegExp(name) }).click();
    await nav('集群启动'); await page.getByRole('button', { name: '启动集群', exact: true }).click();
    await page.waitForFunction(async url => (await import(url)).useCollaborationStore.getState().clusterRunning, storeUrl);
    await nav('多任务协同指挥'); await page.getByRole('button', { name: '展开指挥台' }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid=satellite-basemap]')?.dataset.status === 'ready');
    const before = await mission();
    const compass = await scope.locator('.maplibregl-ctrl-compass').boundingBox();
    await page.mouse.move(compass.x + 18, compass.y + 16); await page.mouse.down(); await page.mouse.move(compass.x + 70, compass.y + 50, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(400);
    const bearing = await scope.locator('.maplibregl-ctrl-compass .maplibregl-ctrl-icon').evaluate(e => { const m = new DOMMatrixReadOnly(getComputedStyle(e).transform); return Math.atan2(m.b, m.a); });
    assert.ok(Math.abs(bearing) < 1e-7, '2D north-up camera cannot rotate away from ENU overlays');

    // Round 1: actual native navigation, animated one-level steps and no artificial 0.1–5 multiplier cap.
    await layout(); await shot('02-final-command-2048');
    const animation = await nativeStep(1); assert.ok(animation.some(z => z > zoomSamples[0].start + .001 && z < zoomSamples[0].end - .001), 'zoom must animate, not jump');
    await registration(); await nativeStep(-1);
    await map().getByLabel('地图底图').selectOption('coordinates'); await page.waitForTimeout(200);
    while (await camera() < 23.99) await nativeStep(1);
    assert.ok(await scope.getByTitle('放大', { exact: true }).isDisabled(), 'engine disables only at maximum zoom');
    await shot('03-zoom-24');
    for (let i = 0; i < 17; i++) await nativeStep(-1);
    assert.ok(await camera() < 8, 'zoom out far beyond old multiplier floor');
    await registration(); await shot('04-regional-zoom');
    // Continue to the engine/viewport minimum and assert its honest disabled boundary.
    for (let i = 0; i < 10 && !await scope.getByTitle('缩小', { exact: true }).isDisabled(); i++) {
      const z = await camera();
      await scope.getByTitle('缩小', { exact: true }).click(); await page.waitForTimeout(550);
      assert.ok(await camera() < z, 'still zooms out until engine minimum');
    }
    assert.ok(await scope.getByTitle('缩小', { exact: true }).isDisabled());
    await fit(); await map().getByLabel('地图底图').selectOption('vector'); await page.waitForTimeout(700);
    const rect = await map().boundingBox(), pointer = { x: rect.x + rect.width * .58, y: rect.y + rect.height * .55 };
    const localAtPointer = () => map().evaluate((e, p) => { const t = e.querySelector('[data-testid=satellite-basemap]'), r = e.getBoundingClientRect(), world = 512 * 2 ** Number(t.dataset.cameraZoom); return { x: (+t.dataset.cameraLongitude + 180) / 360 + (p.x - r.x - r.width / 2) / world, y: (1 - Math.log(Math.tan(Math.PI / 4 + +t.dataset.cameraLatitude * Math.PI / 360)) / Math.PI) / 2 + (p.y - r.y - r.height / 2) / world }; }, pointer);
    const anchor = await localAtPointer(); await page.mouse.move(pointer.x, pointer.y); await page.mouse.wheel(0, -240); await page.waitForTimeout(650);
    const anchorAfter = await localAtPointer(); assert.ok(Math.hypot(anchorAfter.x - anchor.x, anchorAfter.y - anchor.y) < 1e-9, 'wheel zoom keeps cursor geography fixed'); await registration();
    // Round 2: satellite warning cannot reset user zoom; all map business tools retained, canvas unchanged.
    await map().getByLabel('地图底图').selectOption('satellite'); await page.waitForFunction(() => document.querySelector('[data-testid=satellite-basemap]')?.dataset.status === 'ready');
    await fit(); await nativeStep(1); await nativeStep(1); const satelliteZoom = await camera(); await page.waitForTimeout(500); assert.ok(Math.abs(await camera() - satelliteZoom) < .001, 'HUD changes must not reset user zoom');
    await shot('05-satellite-detail');
    const dimensions = await map().boundingBox(); await tools('地图图层管理'); assert.equal(await scope.getByRole('region', { name: '地图图层管理面板' }).getByRole('checkbox').count(), 5);
    assert.equal((await map().boundingBox()).width, dimensions.width); await scope.getByRole('button', { name: '关闭地图管理面板' }).click();
    await tools('两点测距'); await map().click({ position: { x: rect.width * .45, y: rect.height * .4 } }); await map().click({ position: { x: rect.width * .55, y: rect.height * .6 } }); assert.match(await scope.getByRole('region', { name: '地图测量结果' }).innerText(), /\d+\.\d{2} m/); await page.keyboard.press('Escape');
    assert.deepEqual(await mission(), before, 'map presentation must not mutate mission or drone positions');
    await map().getByLabel('地图底图').selectOption('vector');
    for (const [width, height] of [[2048, 1152], [1600, 900], [1366, 768]]) {
      await page.setViewportSize({ width, height }); await page.waitForTimeout(250); await fit(); await layout();
      const rail = await scope.locator('[data-map-obstruction=left]').evaluate(e => ({ h: e.clientHeight, scroll: e.scrollHeight, cards: e.querySelectorAll('[data-task-card]').length })); assert.equal(rail.cards, 5); assert.ok(rail.scroll <= rail.h + 1);
      await shot(`06-command-${width}`);
    }
    await page.setViewportSize({ width: 2048, height: 1152 }); await page.getByRole('button', { name: '集群实时视图', exact: true }).click(); scope = page.getByRole('dialog', { name: '集群实时指挥视图', exact: true });
    await page.waitForTimeout(900); await fit(); await layout(); await shot('07-final-live-2048');
    assert.equal(await scope.locator('[data-testid^="telemetry-uav"]').count(), 15);
    const unsupported = scope.locator('details').filter({ hasText: '扩展飞控指令' }); assert.equal(await unsupported.getAttribute('open'), null); await unsupported.locator('summary').click(); assert.ok(await scope.getByRole('button', { name: '前进', exact: true }).isDisabled()); await unsupported.locator('summary').click();
    await nativeStep(1); await registration(); await fit();
    await tools('底图切换'); assert.equal(await scope.getByRole('complementary', { name: '飞行操作面板' }).count(), 0, 'map management does not overlap live flight panel'); await shot('08-live-map-tools'); await scope.getByRole('button', { name: '关闭地图管理面板' }).click();
    for (const [width, height] of [[1600, 900], [1366, 768], [390, 844]]) { await page.setViewportSize({ width, height }); await page.waitForTimeout(200); await fit(); await layout(); await shot(`09-live-${width}`); }
    assert.deepEqual(await mission(), before);
    assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []);
    fs.writeFileSync(`${out}/verification.json`, JSON.stringify({ rounds: 2, pageErrors: errors, consoleErrors, zoomSamples, checks: ['MapLibre native navigation icons', 'animated one-level zoom', 'engine max and viewport min', 'wheel anchor', 'satellite no zoom reset', 'ENU registration <1px', 'all 15 quadrotors visible', '5 task cards without scroll', 'unchanged mission/runtime state', 'map tools preserve canvas', 'real-time panel exclusivity', 'unsupported controls remain disabled', '2048/1600/1366 and mobile overflow'] }, null, 2));
    console.log('PASS: two review rounds; native navigation, animated wide-range zoom, aircraft visibility, registration, unchanged runtime, desktop/mobile layout and console checks.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
