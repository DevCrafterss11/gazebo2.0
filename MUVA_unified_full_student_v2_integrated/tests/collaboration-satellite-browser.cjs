const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const out = process.env.MUVA_SCREENSHOT_DIR || 'docs/ui-verification/collaboration/satellite-map-2026-10-31';
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [], consoleErrors = [];
  let expectedOffline = false, successfulTiles = 0, successfulVectorTiles = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !expectedOffline) consoleErrors.push(message.text()); });
  page.on('response', response => { if (response.url().includes('World_Imagery') && response.status() === 200) successfulTiles++; if (response.url().includes('tiles.openfreemap.org') && response.url().includes('.pbf') && response.status() === 200) successfulVectorTiles++; });
  page.on('dialog', dialog => dialog.accept());
  const base = process.env.MUVA_TEST_URL || 'http://127.0.0.1:5175';
  const shot = name => page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  const nav = name => page.getByRole('navigation', { name: '实验三六步教学流程' }).getByRole('button', { name: new RegExp(name) }).click();
  let storeUrl;
  const state = () => page.evaluate(async url => (await import(url)).useCollaborationStore.getState().missionState, storeUrl);
  const waitState = async (predicate, timeout = 30000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const current = await state();
      if (predicate(current)) return current;
      await page.waitForTimeout(150);
    }
    throw new Error('Runtime state did not reach the expected condition');
  };
  let map = page.getByTestId('fleet-map');
  let basemap = page.getByTestId('satellite-basemap');
  const ready = async () => { await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="satellite-basemap"]')].at(-1)?.dataset.status === 'ready', null, { timeout: 45000 }); await page.waitForTimeout(800); };
  // Independently reproject WGS84 with Web Mercator, then compare with DOM marker centers.
  const registration = async () => {
    const sample = await map.evaluate(element => {
      const tile = element.querySelector('[data-testid="satellite-basemap"]'), rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height, camera: { lng: +tile.dataset.cameraLongitude, lat: +tile.dataset.cameraLatitude, zoom: +tile.dataset.cameraZoom },
        markers: [...element.querySelectorAll('[data-testid^="marker-uav"]')].map(marker => { const b = marker.getBoundingClientRect(); return { id: marker.dataset.testid, lng: +marker.dataset.longitude, lat: +marker.dataset.latitude, x: b.x + b.width / 2 - rect.x, y: b.y + b.height / 2 - rect.y }; }) };
    });
    const mercator = (lng, lat) => [(lng + 180) / 360, (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2];
    const center = mercator(sample.camera.lng, sample.camera.lat), world = 512 * 2 ** sample.camera.zoom;
    for (const marker of sample.markers) {
      const p = mercator(marker.lng, marker.lat);
      assert.ok(Math.abs(marker.x - (sample.width / 2 + (p[0] - center[0]) * world)) < 1, `${marker.id} longitude registration`);
      assert.ok(Math.abs(marker.y - (sample.height / 2 + (p[1] - center[1]) * world)) < 1, `${marker.id} latitude registration`);
    }
  };
  try {
    await page.goto(`${base}/login`);
    await page.evaluate(() => { sessionStorage.setItem('muva-mock-user', 'signed-in'); sessionStorage.setItem('muva-user-role', 'student'); });
    await page.goto(`${base}/experiments/collaboration`);
    await page.getByRole('button', { name: /进入教学模拟模式/ }).click();
    storeUrl = await page.evaluate(() => performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/stores/collaborationStore.ts')?.name);
    assert.ok(storeUrl);
    await nav('集群启动'); await page.getByRole('button', { name: '启动集群', exact: true }).click();
    await page.waitForFunction(async url => (await import(url)).useCollaborationStore.getState().clusterRunning, storeUrl);
    await nav('多任务协同指挥'); await page.getByRole('button', { name: '展开指挥台' }).click();
    // Round 2: independently copied 2D vector renderer, true 5m array and desktop symbols.
    assert.equal(await page.getByLabel('地图底图').inputValue(), 'vector');
    await ready(); assert.ok(successfulVectorTiles > 0, 'real vector tiles must load');
    const initial = await state();
    assert.equal(initial.drones[1].position.x - initial.drones[0].position.x, 5);
    assert.equal(initial.drones[0].position.y - initial.drones[5].position.y, 5);
    assert.ok(initial.drones.every(d => Math.hypot(d.velocity.x, d.velocity.y, d.velocity.z) === 0));
    assert.equal(await map.getByLabel('选中无人机近邻水平间距').getAttribute('data-distance-metres'), '5');
    for (const [width, height] of [[2048, 1152], [1600, 1000], [1366, 768]]) {
      await page.setViewportSize({width, height}); await page.waitForTimeout(500); await registration();
      const symbol = await page.getByTestId('marker-uav101').evaluate(e => { const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return {width:r.width, height:r.height, background:s.backgroundColor, svg:!!e.querySelector('svg')}; });
      assert.equal(symbol.width, 32); assert.equal(symbol.height, 32); assert.ok(symbol.svg);
      assert.equal(await map.locator('[data-testid^="marker-uav"]').count(), 15);
      await shot(`00-vector-command-${width}`);
    }
    await page.setViewportSize({width:1600,height:1000});
    await page.getByLabel('地图底图').selectOption('satellite');
    await ready(); assert.ok(successfulTiles > 0, 'real satellite tiles must be fetched successfully');
    assert.equal(await map.locator('[data-testid^="marker-uav"]').count(), 15);
    assert.ok((await state()).drones.every(drone => !drone.armed && drone.assignedTaskId === null));
    await registration(); await shot('01-satellite-command-desktop');
    await page.getByRole('button', { name: /收起任务面板|展开任务面板/ }).click();
    await page.getByTestId('marker-uav108').click(); await page.getByRole('button', { name: '关闭无人机面板' }).click(); await registration();
    const bounds = await map.boundingBox();
    await page.mouse.move(bounds.x + bounds.width * .55, bounds.y + bounds.height * .6); await page.mouse.wheel(0, 280); await page.waitForTimeout(300); await registration();
    await page.mouse.move(bounds.x + bounds.width * .55, bounds.y + bounds.height * .6); await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width * .55 + 60, bounds.y + bounds.height * .6 - 45, { steps: 8 }); await page.mouse.up(); await registration();
    await page.getByTitle('放大', { exact: true }).click(); await page.waitForTimeout(400); await registration();
    // Feed a non-array coordinate through the single store (test fixture, not a real connection).
    await page.evaluate(async url => { const store = (await import(url)).useCollaborationStore; const s = store.getState(); store.setState({ missionState: { ...s.missionState, drones: s.missionState.drones.map(d => d.id === 'uav108' ? { ...d, position: { x: 7.3, y: -12.6, z: 0 } } : d) } }); }, storeUrl);
    assert.equal(await page.getByTestId('marker-uav108').getAttribute('data-local-x'), '7.3'); await registration();
    await page.getByTitle('自动适配视野', { exact: true }).click();
    await page.getByRole('navigation', { name: '任务业务导航' }).getByRole('button', { name: '物资运输', exact: true }).click();
    const tool = page.getByLabel('地图编辑工具');
    await tool.selectOption('start'); await map.click({ position: { x: bounds.width * .38, y: bounds.height * .45 } });
    await tool.selectOption('delivery'); await map.click({ position: { x: bounds.width * .66, y: bounds.height * .64 } }); await tool.selectOption('pan');
    assert.deepEqual((await state()).groups[3].points.map(p => p.kind).sort(), ['delivery', 'start']);
    await registration(); await shot('02-transport-geographic-points');
    await page.getByRole('button', { name: '无人机编组', exact: true }).click();
    await page.getByRole('button', { name: '为可用无人机开放本任务资格', exact: true }).click();
    await page.getByLabel('选择uav101', { exact: true }).check(); await page.getByLabel('选择uav102', { exact: true }).check();
    await page.getByRole('button', { name: '关闭地图图层' }).click();
    await page.getByRole('button', { name: '开始物资运输', exact: true }).click();
    await page.getByRole('button', { name: '确认并开始当前任务', exact: true }).click();
    await page.getByRole('button', { name: '关闭地图图层' }).click();
    await waitState(m => m.drones[0].trajectory.length >= 8 && Math.hypot(m.drones[0].position.x - m.drones[0].homePosition.x, m.drones[0].position.y - m.drones[0].homePosition.y) > 1); // wait for real climb, then horizontal transit
    const flying = await state();
    assert.ok(flying.drones[0].armed && flying.drones[1].armed);
    assert.ok(Math.hypot(flying.drones[0].velocity.x, flying.drones[0].velocity.y) > 0);
    assert.ok(flying.drones[0].position.z > 0);
    assert.ok(flying.drones[0].battery < initial.drones[0].battery);
    assert.ok(flying.drones.slice(2).every(d => !d.assignedTaskId && !d.armed));
    assert.ok(await map.getByTestId('trace-uav101').count());
    await registration();
    const credit = await map.locator('.maplibregl-ctrl-attrib').boundingBox();
    const footer = await page.locator('[data-command-bottom]').boundingBox();
    assert.ok(credit.y + credit.height <= footer.y, 'imagery attribution stays above task controls');
    await shot('02b-satellite-flight-tracks');
    await page.getByRole('button', { name: '暂停任务', exact: true }).click();
    const pausedPosition = (await state()).drones[0].position;
    await page.waitForTimeout(1000); assert.deepEqual((await state()).drones[0].position, pausedPosition);
    // Wide/narrow registration and layout must remain identical to the tile camera.
    for (const [width, height] of [[1366, 768], [390, 844]]) {
      await page.setViewportSize({ width, height }); await page.waitForTimeout(600); await registration();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
      await shot(`03-command-${width}`);
    }
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.getByRole('button', { name: '集群实时视图', exact: true }).click(); map = page.getByRole('dialog', { name: '集群实时指挥视图', exact: true }).getByTestId('fleet-map'); basemap = map.getByTestId('satellite-basemap'); await map.getByLabel('地图底图').selectOption('satellite'); await ready();
    const live = page.getByRole('dialog', { name: '集群实时指挥视图', exact: true });
    await live.getByRole('button', { name: '定位遥测uav102', exact: true }).click();
    await live.getByRole('button', { name: '返航', exact: true }).click();
    await waitState(m => m.drones[1].returnTrajectory.length > 1);
    assert.equal((await state()).drones[0].instanceStatus, 'FLYING');
    assert.ok((await state()).drones[1].returnTrajectory.length > 1);
    await registration(); await shot('04-satellite-live-desktop');
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(600); await registration(); await shot('05-satellite-live-narrow');
    await page.getByRole('button', { name: '返回任务工作区', exact: true }).click();
    map = page.getByTestId('fleet-map'); basemap = page.getByTestId('satellite-basemap');
    // Network failure affects imagery only, never aircraft or task planning.
    expectedOffline = true;
    await page.route('**/World_Imagery/**', route => route.abort('failed'));
    await map.getByLabel('地图底图').selectOption('coordinates'); assert.equal(await basemap.getAttribute('data-status'), 'grid');
    await map.getByLabel('地图底图').selectOption('satellite');
    await page.getByText('卫星底图不可用，坐标与任务操作仍可用。', { exact: false }).waitFor();
    assert.equal(await map.locator('[data-testid^="marker-uav"]').count(), 15); await registration(); await shot('06-offline-grid-fallback');
    await map.getByLabel('地图底图').selectOption('coordinates');
    assert.equal(await basemap.getAttribute('data-status'), 'grid');
    // Round 3: a vector outage must also retain the same metric aircraft/planning frame.
    await page.route('https://tiles.openfreemap.org/**', route => route.abort('failed'));
    await map.getByLabel('地图底图').selectOption('vector');
    await page.getByText('矢量底图不可用，已显示米制坐标网格。', {exact:false}).waitFor();
    await map.getByTestId('coordinate-grid').waitFor(); await registration();
    assert.equal(await map.locator('[data-testid^="marker-uav"]').count(), 15);
    await page.setViewportSize({width:1600,height:1000}); await shot('07-vector-offline-desktop');
    await page.getByRole('button', { name: '终止任务', exact: true }).click();
    await waitState(m => m.groups[3].lifecycle === '已终止');
    const finished = await page.evaluate(async url => { const s = (await import(url)).useCollaborationStore.getState(); return { cluster: s.clusterRunning, records: s.records.length }; }, storeUrl);
    assert.equal(finished.cluster, true); assert.equal(finished.records, 1);
    assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []);
    console.log(`PASS: ${successfulVectorTiles} real vector tile responses and ${successfulTiles} real satellite tile responses; ENU/WGS84 registration, arbitrary runtime coordinates, zoom/pan, transport points, flight tracks, pause, independent RTL, desktop/narrow, realtime, offline fallback and safe task termination. No application errors.`);
  } catch (error) { await shot('failure'); throw error; }
  finally { await browser.close(); }
})();
