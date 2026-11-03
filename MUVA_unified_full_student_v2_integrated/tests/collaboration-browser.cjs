const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const out = process.env.MUVA_SCREENSHOT_DIR || 'docs/ui-verification/collaboration/map-command-regression-2026-10-31';
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.addInitScript(() => performance.setResourceTimingBufferSize(5000));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  let accept = true; let dialogs = 0;
  page.on('dialog', (dialog) => { dialogs++; return accept ? dialog.accept() : dialog.dismiss(); });
  const base = process.env.MUVA_TEST_URL || 'http://127.0.0.1:5175';
  let storeUrl;
  const read = () => page.evaluate(async (url) => {
    const { useCollaborationStore } = await import(url);
    const s = useCollaborationStore.getState();
    return { step: s.currentStep, cluster: s.clusterRunning, running: s.isRunning, paused: s.isPaused, mission: s.missionState, nodes: s.communicationNodes, selected: s.selectedDrone, records: s.records, active: s.activeGroupId, notice: s.notice, evaluation: s.evaluation, business: s.businessView };
  }, storeUrl);
  const nav = (name) => page.getByRole('navigation', { name: '实验三六步教学流程' }).getByRole('button', { name: new RegExp(name) }).click();
  const hideLayer = async () => { if (await page.getByRole('button', { name: '关闭地图图层' }).count()) await page.getByRole('button', { name: '关闭地图图层' }).click(); };
  const business = async (name) => { await page.getByRole('navigation', { name: '任务业务导航' }).getByRole('button', { name, exact: true }).click(); if (name !== '全局态势') await page.getByRole('button', { name: '无人机编组', exact: true }).click(); };
  const shot = async (name) => { await page.screenshot({ path: `${out}/${name}.png`, fullPage: true }); };
  const overflow = async () => {
    const sizes = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, width: innerWidth }));
    assert.ok(sizes.page <= sizes.width + 2, `horizontal overflow: ${JSON.stringify(sizes)}`);
  };
  const mapPoint = async (x, y) => { await page.getByTestId('fleet-map').scrollIntoViewIfNeeded(); const box = await page.getByTestId('fleet-map').boundingBox(); await page.mouse.click(box.x + box.width * x, box.y + box.height * y); };
  const configureGeometry = async (index) => {
    await hideLayer(); const toggle = page.getByRole('button', { name: '独立任务', exact: true }); if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click();
    if (index !== 2 && index !== 3) {
      await page.getByLabel('地图编辑工具').selectOption('point');
      for (const [x, y] of [[.35, .38], [.65, .38], [.65, .65], [.35, .65]]) await mapPoint(x, y);
    }
    if (index === 2) { await page.getByLabel('地图编辑工具').selectOption('point'); await mapPoint(.56, .55); }
    if (index === 3 || index === 4) {
      await page.getByLabel('地图编辑工具').selectOption('start'); await mapPoint(.35, .65);
      await page.getByLabel('地图编辑工具').selectOption('delivery'); await mapPoint(.72, .45);
    }
    await page.getByLabel('地图编辑工具').selectOption('pan');
  };
  const advanceUntil = async (predicate, label, maxSeconds = 180) => {
    for (let second = 0; second < maxSeconds; second++) {
      if (predicate(await read())) return;
      await page.clock.runFor(1000);
    }
    assert.fail(`Timed out waiting for ${label}: ${JSON.stringify((await read()).mission.groups.map((g) => ({ lifecycle: g.lifecycle, progress: g.progress })))}`);
  };
  const begin = async () => { await page.getByRole('button', { name: /^开始(区域巡逻|目标搜索|定点监测|物资运输|应急救援)$/ }).click(); await page.getByRole('dialog', { name: '当前任务确认' }).waitFor(); await page.getByRole('button', { name: '确认并开始当前任务' }).click(); assert.equal((await read()).running, true); await hideLayer(); };
  try {
    await page.goto(`${base}/login`);
    await page.evaluate(() => { sessionStorage.setItem('muva-mock-user', 'signed-in'); sessionStorage.setItem('muva-user-role', 'student'); });
    await page.goto(`${base}/experiments/collaboration`);
    await page.getByText('运行环境检查', { exact: true }).waitFor();
    storeUrl = await page.evaluate(() => performance.getEntriesByType('resource').find((e) => new URL(e.name).pathname === '/src/stores/collaborationStore.ts')?.name);
    assert.ok(storeUrl, 'store module loaded');
    await page.clock.install(); await page.clock.pauseAt(new Date(Date.now() + 1000));
    assert.equal(await page.getByRole('navigation', { name: '实验三六步教学流程' }).getByRole('button', { name: /实验评价/ }).isDisabled(), true);
    assert.equal((await read()).step, 0);
    await shot('01-readiness');
    await page.getByRole('button', { name: /进入教学模拟模式/ }).click();
    await page.getByRole('navigation', { name: '实验三六步教学流程' }).getByRole('button', { name: /集群启动/ }).click();
    await page.getByRole('button', { name: '启动集群', exact: true }).click();
    await page.clock.runFor(2200);
    let state = await read(); assert.equal(state.cluster, true); assert.equal(state.running, false);
    assert.equal(state.mission.drones.length, 15); assert.ok(state.mission.drones.every((d) => !d.assignedTaskId && !d.armed && d.instanceStatus === 'STANDBY'));
    assert.ok(state.mission.groups.every((g) => !g.drones.length));
    assert.equal(new Set(state.mission.drones.map((d) => d.position.x)).size, 5); assert.equal(new Set(state.mission.drones.map((d) => d.position.y)).size, 3);
    await shot('02-cluster');
    await nav('通信组网'); state = await read(); assert.equal(state.nodes.length, 15);
    state.nodes.forEach((n, i) => { assert.equal(n.droneId, `uav${101 + i}`); assert.equal(n.ip, `192.168.10.${101 + i}`); assert.equal(n.source, 'Mock'); });
    await shot('03-network');
    await nav('集群状态监控'); assert.equal(await page.locator('[data-testid^="marker-uav"]').count(), 15);
    await page.getByRole('button', { name: /uav115.*待命/ }).click(); assert.equal((await read()).selected, 'uav115');
    await page.getByTestId('marker-uav110').click(); assert.equal((await read()).selected, 'uav110');
    await shot('04-fleet');
    await nav('多任务协同指挥'); await business('全局态势');
    await page.getByRole('button', { name: '无人机资源管理' }).click();
    const dialog = page.getByRole('dialog', { name: '无人机资源管理' });
    assert.equal(await dialog.locator('tbody tr').count(), 15);
    for (let n = 101; n <= 103; n++) {
      await dialog.locator('tr').filter({ hasText: `uav${n}` }).locator('summary').click();
      for (const type of ['区域巡逻', '目标搜索', '定点监测', '物资运输', '应急救援']) await page.getByLabel(`uav${n}允许${type}`, { exact: true }).check();
      await dialog.locator('tr').filter({ hasText: `uav${n}` }).locator('summary').click();
    }
    await page.getByLabel('uav104允许参与任务').uncheck();
    await shot('resources');
    await page.getByRole('button', { name: '完成配置' }).click();
    state = await read(); assert.equal(state.mission.drones[0].allowedTaskTypes.length, 5); assert.equal(state.mission.drones[3].enabled, false); assert.equal(state.mission.drones[3].instanceStatus, 'STANDBY');
    await business('区域巡逻');
    await page.getByLabel('选择uav101', { exact: true }).check(); await page.getByLabel('选择uav102', { exact: true }).check(); await page.getByLabel('选择uav103', { exact: true }).check();
    await page.getByLabel('uav103任务角色').selectOption('侦察机');
    await page.getByLabel('uav103工作区地图显示').uncheck();
    assert.equal(await page.getByTestId('marker-uav103').count(), 0); assert.ok((await read()).mission.groups[0].drones.includes('uav103'));
    await page.getByLabel('uav103工作区地图显示').check();
    await configureGeometry(0);
    await page.getByRole('button', { name: '区域与航点', exact: true }).click();
    await page.getByLabel('点1-x', { exact: true }).fill('-42');
    assert.equal((await read()).mission.groups[0].points[0].x, -42);
    await page.getByRole('button', { name: '删除点', exact: true }).last().click(); assert.equal((await read()).mission.groups[0].points.length, 3);
    await hideLayer();
    await page.getByTitle('放大', { exact: true }).click(); await page.getByTitle('缩小', { exact: true }).click(); await page.getByTitle('自动适配视野').click();
    await page.getByTestId('fleet-map').scrollIntoViewIfNeeded();
    const mapBox = await page.getByTestId('fleet-map').boundingBox(); await page.mouse.move(mapBox.x + 120, mapBox.y + mapBox.height - 80); await page.mouse.down(); await page.mouse.move(mapBox.x + 150, mapBox.y + mapBox.height - 70); await page.mouse.up();
    assert.equal((await read()).running, false); await shot('05-patrol-config');
    await begin(); await page.clock.runFor(6000); state = await read(); assert.equal(state.mission.groups.filter((g) => g.status === 'RUNNING').length, 1); assert.equal(state.mission.drones.filter((d) => d.instanceStatus === 'FLYING').length, 3); assert.ok(state.mission.drones[0].trajectory.length > 3);
    await page.getByRole('button', { name: '暂停任务', exact: true }).click(); const progress = (await read()).mission.groups[0].progress; await page.clock.runFor(4000); assert.equal((await read()).mission.groups[0].progress, progress);
    // RTL during pause via hover panel; cancel then confirm exercises the safety confirmation.
    await page.getByTestId('marker-uav103').hover();
    const popup = page.getByRole('region', { name: 'uav103操作面板' }); await popup.waitFor();
    accept = false; await popup.getByRole('button', { name: '单机返航' }).click(); assert.equal((await read()).mission.drones[2].instanceStatus, 'FLYING');
    accept = true; await popup.getByRole('button', { name: '单机返航' }).click(); assert.equal((await read()).mission.drones[2].instanceStatus, 'RETURNING');
    await page.clock.runFor(12000); state = await read(); assert.equal(state.mission.drones[2].instanceStatus, 'STANDBY'); assert.equal(state.mission.groups[0].progress, progress); assert.equal(state.running, true);
    await page.getByRole('button', { name: '继续任务', exact: true }).click(); await page.clock.runFor(2000);
    await nav('集群状态监控'); await nav('多任务协同指挥'); assert.equal((await read()).active, 'group-1');
    await business('目标搜索'); assert.equal((await read()).active, 'group-1'); assert.equal((await read()).mission.groups[1].status, 'WAITING');
    await business('区域巡逻'); await hideLayer(); await shot('05-patrol-running');
    await page.getByRole('button', { name: '模拟异常' }).click(); assert.equal((await read()).mission.groups[0].lifecycle, '异常');
    await page.getByRole('button', { name: '确认降级继续' }).click();
    await advanceUntil((s) => !s.running, 'patrol safe completion'); state = await read(); assert.equal(state.running, false); assert.equal(state.cluster, true); assert.equal(state.records.length, 1); assert.equal(state.records[0].evaluation.anomalyCount, 2, 'battery alarm and key-role exit are two recorded alert events');
    assert.deepEqual(state.records[0].events.filter((event) => ['模拟低电量告警', '任务资源退出告警'].includes(event.title)).map((event) => event.title), ['模拟低电量告警', '任务资源退出告警']);
    assert.equal(state.business, 'group-1');
    await shot('05-patrol-result');
    // Separate task workspaces use independent geometry and selected members, never a five-group launch.
    const types = ['区域巡逻', '目标搜索', '定点监测', '物资运输', '应急救援'];
    // uav101 now has low battery: use healthy uav102 and uav103; grant uav104 through the same resource UI.
    await page.getByRole('button', { name: '无人机资源管理' }).click();
    await page.getByLabel('uav104允许参与任务').check();
    const row104 = page.getByRole('dialog', { name: '无人机资源管理' }).locator('tr').filter({ hasText: 'uav104' }); await row104.locator('summary').click();
    for (const type of types) await page.getByLabel(`uav104允许${type}`, { exact: true }).check();
    await page.getByRole('button', { name: '完成配置' }).click();
    for (let i = 1; i < 5; i++) {
      await business(types[i]);
      await page.getByLabel('选择uav102', { exact: true }).check(); await page.getByLabel('选择uav104', { exact: true }).check();
      await configureGeometry(i); if (i === 3) { await page.getByRole('button', { name: '任务参数', exact: true }).click(); await page.getByLabel('交付确认', { exact: true }).selectOption('人工签收'); await hideLayer(); } await shot(`05-${i + 1}-config`); await begin(); await page.clock.runFor(5000);
      state = await read(); assert.equal(state.active, `group-${i + 1}`); assert.equal(state.mission.groups.filter((g) => g.status === 'RUNNING').length, 1);
      if (i === 1) { await page.getByRole('button', { name: '终止任务', exact: true }).click(); await page.clock.runFor(18000); assert.equal((await read()).records.at(-1).evaluation.status, '已终止'); }
      else {
        if (i === 3) {
          await advanceUntil((s) => s.mission.groups[3].lifecycle === '待结果确认', 'manual delivery acceptance');
          assert.equal((await read()).records.length, 3);
          await page.clock.runFor(3000); assert.equal((await read()).running, true);
          await shot('05-delivery-awaiting-confirmation');
          await page.getByRole('button', { name: '确认模拟人工签收', exact: true }).click();
        }
        await advanceUntil((s) => !s.running, `${types[i]} safe completion`);
      }
      state = await read(); assert.equal(state.running, false); assert.equal(state.cluster, true); assert.equal(state.records.at(-1).type, types[i]); assert.equal(state.mission.drones.filter((d) => d.assignedTaskId).length, 0);
      await shot(`05-${i + 1}-result`);
    }
    await page.getByRole('button', { name: '任务记录', exact: true }).click(); await page.locator('[data-testid^="history-run-"]').first().click(); await shot('history-snapshot');
    await nav('实验评价'); assert.equal((await read()).records.length, 5); await shot('06-evaluation');
    await nav('多任务协同指挥'); await business('全局态势'); assert.equal(await page.locator('[data-testid^="marker-uav"]').count(), 15); await overflow();
    await page.setViewportSize({ width: 1024, height: 900 }); await shot('narrow-1024'); await overflow();
    await page.setViewportSize({ width: 768, height: 1024 }); await shot('narrow-768'); await overflow();
    await page.getByTestId('marker-uav104').click(); await page.getByRole('region', { name: 'uav104操作面板' }).waitFor();
    await page.getByRole('button', { name: '无人机资源管理' }).click(); await shot('narrow-resources'); await page.getByRole('button', { name: '完成配置' }).click();
    await page.setViewportSize({ width: 390, height: 844 }); await overflow(); await shot('narrow-390'); await page.getByTestId('fleet-map').scrollIntoViewIfNeeded(); await shot('narrow-390-map'); await business('物资运输'); await page.getByTestId('fleet-map').scrollIntoViewIfNeeded(); await shot('narrow-390-task');
    await page.setViewportSize({ width: 1600, height: 1000 });
    await nav('集群启动'); accept = false; await page.getByRole('button', { name: '停止集群', exact: true }).click(); assert.equal((await read()).cluster, true);
    accept = true; await page.getByRole('button', { name: '停止集群', exact: true }).click(); assert.equal((await read()).cluster, false);
    assert.ok(dialogs >= 5); assert.deepEqual(errors, []);
    fs.writeFileSync(`${out}/browser-result.json`, JSON.stringify({ passed: true, records: (await read()).records.map((r) => ({ type: r.type, status: r.evaluation.status, metrics: r.evaluation.groups[0].metrics })), errors, dialogs, viewports: [1600, 1024, 768, 390] }, null, 2));
    console.log('PASS: six teaching stages, 15 resources, independent tasks, geometry, hover/click RTL, safety confirmation, controls, history, reports and responsive viewports');
  } catch (e) { await page.screenshot({ path: `${out}/failure.png`, fullPage: true }); console.error('BROWSER ERRORS', errors); throw e; }
  finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
