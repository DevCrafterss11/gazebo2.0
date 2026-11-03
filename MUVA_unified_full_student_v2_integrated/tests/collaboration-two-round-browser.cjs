const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const out = process.env.MUVA_SCREENSHOT_DIR || 'docs/ui-verification/collaboration/two-round-review-2026-10-31/round2/lifecycle';
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(10000);
  const errors = []; const checks = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  let accept = true; page.on('dialog', d => accept ? d.accept() : d.dismiss());
  const base = process.env.MUVA_TEST_URL || 'http://127.0.0.1:5175';
  let storeUrl;
  const read = () => page.evaluate(async url => {
    const { useCollaborationStore } = await import(url); const s = useCollaborationStore.getState();
    return { mission: s.missionState, running: s.isRunning, paused: s.isPaused, cluster: s.clusterRunning, records: s.records, nodes: s.communicationNodes, step: s.currentStep, active: s.activeGroupId };
  }, storeUrl);
  const button = name => page.getByRole('button', { name, exact: true });
  const navButton = name => page.getByRole('navigation', { name: '实验三六步教学流程' }).getByRole('button', { name: new RegExp(name) });
  const nav = name => navButton(name).click();
  const business = name => page.getByRole('navigation', { name: '任务业务导航' }).getByRole('button', { name, exact: true }).click();
  const shot = name => page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  const until = async predicate => { for (let i = 0; i < 240; i++) { if (predicate(await read())) return; await page.clock.runFor(850); } assert.fail('runtime timeout'); };
  const closeLayer = async () => { if (await button('关闭地图图层').count()) await button('关闭地图图层').click(); };
  const begin = async () => { await button('开始定点监测').click(); await button('确认并开始当前任务').click(); };
  try {
    await page.goto(`${base}/login`);
    await page.evaluate(() => { sessionStorage.setItem('muva-mock-user', 'signed-in'); sessionStorage.setItem('muva-user-role', 'student'); });
    await page.goto(`${base}/experiments/collaboration`); await button('进入教学模拟模式').waitFor();
    storeUrl = await page.evaluate(() => performance.getEntriesByType('resource').find(e => new URL(e.name).pathname === '/src/stores/collaborationStore.ts')?.name);
    assert.ok(storeUrl); await page.clock.install(); await page.clock.pauseAt(Date.now() + 1000);
    assert.ok(await navButton('集群启动').isDisabled()); assert.ok(await navButton('多任务协同指挥').isDisabled());
    await shot('01-readiness-desktop'); await button('进入教学模拟模式').click(); await nav('集群启动');
    await shot('02-startup-before'); await button('启动集群').click(); await page.clock.runFor(2200);
    let state = await read(); assert.equal(state.cluster, true); assert.equal(state.running, false);
    assert.ok(state.mission.drones.every(d => d.instanceStatus === 'STANDBY' && !d.assignedTaskId && !d.armed && !d.allowedTaskTypes.length));
    assert.equal(new Set(state.mission.drones.map(d => d.homePosition.x)).size, 5); assert.equal(new Set(state.mission.drones.map(d => d.homePosition.y)).size, 3);
    await shot('02-startup-ready'); await nav('通信组网');
    state = await read(); assert.equal(state.nodes.length, 15);
    state.nodes.forEach((n, i) => { assert.equal(n.droneId, `uav${101 + i}`); assert.equal(n.ip, `192.168.10.${101 + i}`); assert.equal(n.source, 'Mock'); });
    await shot('03-network'); await nav('集群状态监控');
    assert.equal(await page.locator('[data-testid^="marker-uav"]').count(), 15);
    await page.getByRole('button', { name: /uav115.*%/ }).click(); assert.equal((await read()).mission.drones.length, 15);
    await shot('04-fleet-standby'); checks.push('six-step prerequisites, 15 standby resources, mapping and 3x5 array');
    await nav('多任务协同指挥'); await business('定点监测');
    await page.getByLabel('停留时间（s）', { exact: true }).fill('20');
    await button('选择无人机').click(); await button('为可用无人机开放本任务资格').click();
    for (const id of ['uav101', 'uav102', 'uav103']) await page.getByLabel(`选择${id}`, { exact: true }).check();
    await closeLayer(); if (await button('独立任务').getAttribute('aria-expanded') === 'true') await button('独立任务').click();
    await page.getByLabel('地图编辑工具').selectOption('point');
    const map = await page.getByTestId('fleet-map').boundingBox(); await page.mouse.click(map.x + map.width * .62, map.y + map.height * .5);
    await page.getByLabel('地图编辑工具').selectOption('pan');
    await button('开始定点监测').click(); assert.equal((await read()).running, false);
    await page.keyboard.press('Escape'); assert.equal((await read()).mission.groups[2].lifecycle, '配置中');
    await begin(); await until(s => s.mission.groups[2].dwellTicks > 0);
    await button('暂停任务').click(); const paused = await read(); await page.clock.runFor(3000);
    assert.deepEqual((await read()).mission.drones.map(d => d.position), paused.mission.drones.map(d => d.position));
    await business('物资运输'); assert.equal(await button('开始物资运输').count(), 0);
    await page.getByRole('button', { name: /返回执行任务：/ }).click();
    await button('继续任务').click(); await page.clock.runFor(850);
    await button('终止任务').click(); await until(s => !s.running);
    state = await read(); assert.equal(state.records.length, 1); assert.equal(state.cluster, true);
    assert.equal(state.records[0].evaluation.groups[0].metrics.find(m => m.label === '监测点完成率').value, '0%');
    assert.notEqual(state.records[0].evaluation.groups[0].metrics.find(m => m.label === '有效监测时长').value, '0 s');
    await shot('05-partial-monitoring-result'); checks.push('confirmation cancellation, task isolation, pause/resume and truthful partial monitoring evaluation');
    await button('返回配置 / 再次执行').click(); await begin(); await until(s => s.mission.groups[2].progress > 0);
    assert.ok(await navButton('实验评价').isEnabled()); await nav('实验评价');
    assert.equal((await read()).running, true); assert.equal(await page.getByRole('heading', { name: '实验评价 / 独立任务记录' }).count(), 1);
    await shot('06-old-evaluation-during-new-flight'); await nav('集群状态监控');
    assert.match(await page.getByLabel('集群监控统计').innerText(), /模拟任务运行中/);
    // The public store fault action exercises the supported communication failure;
    // all normal configuration, execution and stop actions above/below use the UI.
    await page.evaluate(async url => { const { useCollaborationStore } = await import(url); useCollaborationStore.getState().injectFailure('DISCONNECT', 'uav103'); }, storeUrl);
    const disconnected = page.getByRole('button', { name: /uav103.*%/ });
    assert.match(await disconnected.innerText(), /通信中断/);
    const stats = page.getByLabel('集群监控统计'); assert.match(await stats.innerText(), /异常\s*1/);
    await shot('07-disconnected-fleet'); await nav('多任务协同指挥');
    await button('集群实时视图').click(); const view = page.getByRole('dialog', { name: '集群实时指挥视图', exact: true });
    assert.match(await view.getByTestId('telemetry-uav103').innerText(), /通信中断/);
    await shot('08-disconnected-live'); await view.getByRole('button', { name: '返回任务工作区', exact: true }).click();
    await until(s => s.mission.groups[2].lifecycle === '安全收尾');
    assert.equal((await read()).mission.groups[2].status, 'COMPLETE');
    await nav('集群启动'); accept = false; await button('停止集群').click(); assert.equal((await read()).cluster, true);
    accept = true; await button('停止集群').click(); await until(s => !s.cluster);
    state = await read(); assert.equal(state.records.length, 2); assert.equal(state.records[1].group.lifecycle, '已完成');
    assert.equal(state.records[1].evaluation.anomalyCount, 1); assert.equal(state.records[1].events.some(e => e.title === '任务终止'), false);
    assert.equal(state.records[1].evaluation.groups[0].metrics.find(m => m.label === '监测点完成率').value, '100%');
    assert.ok(state.mission.drones.every(d => !d.armed && !d.assignedTaskId && d.instanceStatus === 'STOPPED'));
    await shot('09-safe-cluster-stop'); await nav('实验评价'); await shot('10-retained-evaluations');
    await nav('集群启动'); await button('启动集群').click(); await page.clock.runFor(2200);
    state = await read(); assert.equal(state.records.length, 2); assert.equal(state.running, false);
    assert.ok(state.mission.drones.every(d => !d.armed && !d.assignedTaskId && d.connectionStatus === 'CONNECTED'));
    checks.push('old evaluations accessible during execution; communication fault visible in fleet/live view; stop confirmation preserves completed result; safe stop/restart keeps records');
    // Search termination is covered by other suites; also complete its manual
    // confirmation branch to verify discovery and successful resource release.
    await nav('多任务协同指挥'); await business('目标搜索');
    await button('选择无人机').click(); await button('为可用无人机开放本任务资格').click();
    for (const id of ['uav101', 'uav102']) await page.getByLabel(`选择${id}`, { exact: true }).check();
    await closeLayer(); await button('任务参数').click();
    await page.getByLabel('目标确认条件', { exact: true }).selectOption('人工复核'); await closeLayer();
    if (await button('独立任务').getAttribute('aria-expanded') === 'true') await button('独立任务').click();
    await page.getByLabel('地图编辑工具').selectOption('point');
    const searchMap = await page.getByTestId('fleet-map').boundingBox();
    for (const [x, y] of [[.4, .4], [.6, .4], [.6, .6], [.4, .6]]) await page.mouse.click(searchMap.x + searchMap.width * x, searchMap.y + searchMap.height * y);
    await page.getByLabel('地图编辑工具').selectOption('pan');
    await button('开始目标搜索').click(); await button('确认并开始当前任务').click();
    await until(s => s.mission.groups[1].lifecycle === '待结果确认');
    assert.equal((await read()).records.length, 2, 'manual verification must precede a completed archive');
    await button('确认模拟人工复核').click(); await until(s => !s.running);
    state = await read(); const search = state.records.at(-1);
    assert.equal(search.type, '目标搜索'); assert.equal(search.evaluation.status, '已完成');
    assert.ok(Number(search.evaluation.groups[0].metrics.find(m => m.label === '目标发现数量').value) > 0);
    assert.ok(search.events.some(e => e.title === '模拟人工结果确认'));
    assert.ok(state.mission.drones.every(d => !d.armed && !d.assignedTaskId)); assert.equal(state.cluster, true);
    await shot('10b-successful-search'); checks.push('search discovery, explicit manual verification, successful archive and safe resource release');

    for (const [width, height] of [[1366, 768], [390, 844]]) {
      await page.setViewportSize({ width, height }); await page.clock.runFor(100);
      for (const [step, name] of ['系统感知', '集群启动', '通信组网', '集群状态监控', '多任务协同指挥', '实验评价'].entries()) {
        const target = navButton(name); await target.scrollIntoViewIfNeeded(); await target.click(); await page.clock.runFor(100);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), `${name} ${width}: page overflow`);
        if (width === 390) {
          const navigation = page.getByRole('navigation', { name: '实验三六步教学流程' });
          const bounds = await navigation.boundingBox();
          for (const item of await navigation.getByRole('button').all()) {
            const box = await item.boundingBox();
            assert.ok(box && box.x >= bounds.x && box.x + box.width <= bounds.x + bounds.width + 1, `${name}: every teaching step fits without horizontal scrolling`);
          }
          assert.equal(await target.getAttribute('aria-current'), 'step');
          const link = page.getByRole('link', { name: '实验中心', exact: true });
          assert.ok((await link.boundingBox()).height < 30, `${name}: back link stays on one line`);
        }
        await shot(`11-${width}-step${step + 1}`);
      }
    }
    assert.deepEqual(errors, []); checks.push('all six pages at 1366x768 and 390x844; no document overflow or console errors');
    fs.writeFileSync(`${out}/result.json`, JSON.stringify({ passed: true, checks, errors }, null, 2));
    console.log('PASS: second-round lifecycle, truthful evaluations, communication alerts, safe stop/restart and six-page responsive flow');
  } catch (error) { await shot('failure'); throw error; } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
