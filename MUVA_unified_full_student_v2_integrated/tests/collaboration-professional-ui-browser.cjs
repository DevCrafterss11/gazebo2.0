const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const out = process.env.MUVA_SCREENSHOT_DIR || 'docs/ui-verification/collaboration/professional-ui-2026-10-31';
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [], consoleErrors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('dialog', dialog => dialog.accept());
  const base = process.env.MUVA_TEST_URL || 'http://127.0.0.1:5175';
  const shot = name => page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  let storeUrl;
  const state = () => page.evaluate(async url => { const s = (await import(url)).useCollaborationStore.getState(); return { groups: s.missionState.groups, drones: s.missionState.drones, running: s.isRunning }; }, storeUrl);
  const map = page.getByTestId('fleet-map');
  const closeLayer = async () => { const button = page.getByRole('button', { name: '关闭地图图层' }); if (await button.count()) await button.click(); };
  const mapTool = async title => { if (!await page.getByTitle(title, { exact: true }).count()) await page.getByTitle('地图工具', { exact: true }).click(); await page.getByTitle(title, { exact: true }).click(); };
  const cardCheck = async () => {
    const layout = await page.locator('[data-map-obstruction=left]').evaluate(e => {
      const r = e.getBoundingClientRect(), footer = document.querySelector('[data-command-bottom]').getBoundingClientRect();
      return { height: e.clientHeight, scroll: e.scrollHeight, overflow: getComputedStyle(e).overflowY, bottom: r.bottom, footer: footer.top,
        cards: [...e.querySelectorAll('[data-task-card]')].map(c => { const b = c.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, status: c.querySelector('[data-task-status]').textContent, contentsFit: [...c.children].filter(child => child.getClientRects().length).every(child => { const content = child.getBoundingClientRect(); return content.top >= b.top && content.bottom <= b.bottom; }) }; }),
        detail: e.querySelector('[aria-label="任务调度详情"]').getBoundingClientRect().bottom };
    });
    assert.equal(layout.cards.length, 5);
    assert.ok(layout.scroll <= layout.height + 1, `five cards + dispatch must not scroll: ${JSON.stringify(layout)}`);
    assert.ok(layout.cards.every(c => c.bottom <= layout.bottom + 1 && c.contentsFit), `card content overflow: ${JSON.stringify(layout)}`);
    assert.ok(layout.detail <= layout.bottom + 1);
    assert.ok(layout.bottom <= layout.footer - 2, 'catalogue clears footer');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  };
  try {
    await page.goto(`${base}/login`);
    await page.evaluate(() => { sessionStorage.setItem('muva-mock-user', 'signed-in'); sessionStorage.setItem('muva-user-role', 'student'); });
    await page.goto(`${base}/experiments/collaboration`);
    await page.getByRole('button', { name: /进入教学模拟模式/ }).click();
    storeUrl = await page.evaluate(() => performance.getEntriesByType('resource').find(e => new URL(e.name).pathname === '/src/stores/collaborationStore.ts').name);
    const nav = name => page.getByRole('navigation', { name: '实验三六步教学流程' }).getByRole('button', { name: new RegExp(name) }).click();
    await nav('集群启动'); await page.getByRole('button', { name: '启动集群', exact: true }).click();
    await page.waitForFunction(async url => (await import(url)).useCollaborationStore.getState().clusterRunning, storeUrl);
    await nav('多任务协同指挥'); await page.getByRole('button', { name: '展开指挥台', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid=satellite-basemap]')?.getAttribute('data-status') === 'ready');
    // Round 1: real desktop viewport, full catalogue, dispatch, no horizontal/vertical catalogue overflow.
    for (const [width, height] of [[2048, 1152], [1600, 900], [1366, 768]]) {
      await page.setViewportSize({ width, height }); await page.waitForTimeout(250); await cardCheck();
      assert.equal(await page.locator('[data-task-status]').filter({ hasText: '待配置' }).count(), 5);
      await shot(`01-overview-${width}`);
    }
    await page.setViewportSize({ width: 1600, height: 900 });
    const rail = page.getByRole('complementary', { name: '五类独立任务入口' });
    await rail.locator('[data-task-card]').first().getByRole('button', { name: '查看任务' }).click();
    await page.getByRole('region', { name: '任务参数图层' }).waitFor(); await closeLayer();
    assert.equal(await page.getByRole('navigation', { name: '任务业务工具' }).getByText('任务规划', { exact: true }).count(), 1);
    assert.equal(await page.getByRole('navigation', { name: '任务业务工具' }).getByText('执行监控', { exact: true }).count(), 1);
    await shot('02-task-planning');
    await page.getByRole('button', { name: '任务参数', exact: true }).click();
    await mapTool('地图图层管理');
    assert.equal(await page.getByRole('region', { name: '任务参数图层' }).count(), 0, 'map management closes the task overlay');
    await page.getByRole('button', { name: '任务参数', exact: true }).click();
    assert.equal(await page.getByRole('region', { name: '地图图层管理面板' }).count(), 0, 'task overlay closes map management');
    await closeLayer();
    // Round 2: layer controls do not mutate mission configuration; actual map editing does.
    const beforeTools = await state(); const sizeBefore = await map.boundingBox();
    await mapTool('地图图层管理');
    const layers = page.getByRole('region', { name: '地图图层管理面板' });
    for (const label of ['任务区域填充', '计划航线', '航点与顶点', '实际 / 返航轨迹', 'ENU 米制网格']) { await layers.getByLabel(label, { exact: true }).uncheck(); await layers.getByLabel(label, { exact: true }).check(); }
    await shot('03-map-layers'); await page.getByRole('button', { name: '关闭地图管理面板' }).click();
    await mapTool('底图切换');
    await page.getByRole('button', { name: /米制坐标.*离线可用/ }).click();
    assert.equal(await page.getByLabel('地图底图', { exact: true }).inputValue(), 'coordinates');
    await page.getByRole('button', { name: /高清矢量.*任意缩放清晰/ }).click();
    await page.getByRole('button', { name: '关闭地图管理面板' }).click();
    assert.deepEqual((await state()).groups, beforeTools.groups);
    assert.equal((await map.boundingBox()).width, sizeBefore.width, 'map tools never compress canvas');
    await mapTool('两点测距');
    const box = await map.boundingBox();
    for (const [x, y] of [[.44, .4], [.59, .57]]) await map.click({ position: { x: box.width * x, y: box.height * y } });
    assert.match(await page.getByRole('region', { name: '地图测量结果' }).innerText(), /\d+\.\d{2} m/);
    await shot('04-distance'); await page.keyboard.press('Escape');
    await mapTool('坐标拾取');
    await map.click({ position: { x: box.width * .6, y: box.height * .6 } });
    assert.match(await page.getByRole('region', { name: '地图测量结果' }).innerText(), /108\.\d+°/);
    await shot('05-coordinate-pick'); await page.keyboard.press('Escape');
    assert.deepEqual((await state()).groups, beforeTools.groups, 'survey tools never add points');
    // Draw real draft points using the existing store-backed map tools.
    await page.getByLabel('地图编辑工具').selectOption('point');
    for (const [x, y] of [[.38, .37], [.62, .37], [.62, .61], [.38, .61]]) await map.click({ position: { x: box.width * x, y: box.height * y } });
    await page.getByLabel('地图编辑工具').selectOption('pan');
    assert.equal((await state()).groups[0].points.length, 4);
    assert.ok(Number(await page.locator('[data-region-area]').getAttribute('data-region-area')) > 0);
    const oldPoint = (await state()).groups[0].points[0];
    const vertex = page.getByRole('button', { name: '地图顶点1', exact: true });
    const vb = await vertex.boundingBox();
    await page.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 2); await page.mouse.down();
    await page.mouse.move(vb.x + vb.width / 2 + 25, vb.y + vb.height / 2 + 12, { steps: 6 }); await page.mouse.up();
    assert.notDeepEqual((await state()).groups[0].points[0], oldPoint);
    const dragPoint = (await state()).groups[0].points[0];
    await vertex.focus(); await page.keyboard.press('ArrowRight');
    assert.equal((await state()).groups[0].points[0].x, dragPoint.x + 1);
    await shot('06-area-vertex-edit');
    // Round 3: resource modal still owns all 15 resources, independent from map overlays.
    await page.getByRole('button', { name: '无人机资源管理', exact: true }).click();
    const resources = page.getByRole('dialog', { name: '无人机资源管理', exact: true });
    assert.equal(await resources.locator('tbody tr').count(), 15);
    await shot('07-resource-table-15'); await resources.getByRole('button', { name: '完成配置' }).click();
    await rail.getByRole('tab', { name: '已归档 (0)', exact: true }).click();
    assert.match(await rail.getByRole('tabpanel').innerText(), /暂无归档任务/);
    await rail.getByRole('tab', { name: '当前任务', exact: true }).click();
    for (const [width, height] of [[2048, 1152], [1600, 900], [1366, 768]]) {
      await page.setViewportSize({ width, height }); await page.waitForTimeout(200); await cardCheck();
      await shot(`08-edited-${width}`);
    }
    // Explicit UI notice fixture checks the worst-case catalogue budget, without changing lifecycle.
    await page.evaluate(async url => (await import(url)).useCollaborationStore.setState({ notice: '验收提示：仅教学模拟，不连接真实硬件。' }), storeUrl);
    await cardCheck(); await shot('09-notice-no-catalogue-overflow');
    await page.getByRole('button', { name: '收起任务面板', exact: true }).click();
    assert.equal(await rail.count(), 0);
    await page.getByRole('button', { name: '展开任务面板', exact: true }).click(); await cardCheck();
    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors, []);
    fs.writeFileSync(`${out}/verification.json`, JSON.stringify({ rounds: 3, viewports: ['2048x1152', '1600x900', '1366x768'], pageErrors: errors, consoleErrors, checks: ['5 visible task cards + dispatch without scroll', 'derived empty status', 'grouped planning/monitoring/archive tools', 'canvas size unchanged', '5 independent map layer switches', 'basemap choices', 'two-point horizontal measurement', 'WGS84/ENU pick without task edits', 'filled area + square-metre readout', 'pointer and keyboard vertex editing', '15 resource rows in standalone modal', 'archive empty state', 'notice and drawer overflow'] }, null, 2));
    console.log('Professional UI: three review rounds passed; screenshots and verification.json saved.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
