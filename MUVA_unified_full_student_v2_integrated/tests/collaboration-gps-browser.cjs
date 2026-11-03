/* End-to-end UI acceptance for five independently launched Mock tasks. Store access is read-only. */
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const base = process.env.MUVA_TEST_URL || 'http://127.0.0.1:5188';
  try {
    await page.goto(`${base}/login`);
    await page.getByRole('button', { name: '登录学生端' }).click();
    await page.waitForURL('**/dashboard');
    await page.goto(`${base}/experiments/collaboration`);
    const storeUrl = await page.evaluate(() => performance.getEntriesByType('resource').find(e => new URL(e.name).pathname === '/src/stores/collaborationStore.ts')?.name);
    assert.ok(storeUrl);
    const read = () => page.evaluate(async url => { const s = (await import(url)).useCollaborationStore.getState(); return { drones: s.missionState.drones, groups: s.missionState.groups, records: s.records, runs: s.schedulerState.activeRuns, leases: s.schedulerState.activeLeases, notice: s.notice, mode: s.concurrentMode }; }, storeUrl);
    await page.getByRole('button', { name: /进入教学模拟模式/ }).click();
    const steps = page.getByRole('navigation', { name: '实验三六步教学流程' });
    await steps.getByRole('button', { name: /集群启动/ }).click();
    await page.getByRole('button', { name: '启动集群', exact: true }).click();
    await page.waitForTimeout(2400);
    await steps.getByRole('button', { name: /多任务协同指挥/ }).click();
    await page.getByRole('button', { name: '展开指挥台' }).click();
    const view = page.getByRole('dialog', { name: '独立任务全屏工作区' });
    await view.waitFor();
    await view.getByRole('button', { name: '无人机资源管理' }).click();
    const resource = page.getByRole('dialog', { name: '无人机资源管理' });
    assert.match(await resource.textContent(), /共 15 架/);
    await resource.getByRole('button', { name: '完成配置' }).click();
    await view.getByRole('checkbox', { name: '并发调度模式' }).check();
    assert.ok((await read()).mode);
    const names = ['区域巡逻', '目标搜索', '定点监测', '物资运输', '应急救援'];
    const nav = name => view.getByRole('navigation', { name: '任务业务导航' }).getByRole('button', { name, exact: true });
    for (let i = 0; i < 5; i++) {
      await nav(names[i]).click();
      if (!await view.locator('[data-mission-workflow]').count()) await view.getByRole('button', { name: '任务参数', exact: true }).click();
      const examples = view.locator('summary').filter({ hasText: '模拟演练与验收场景' });
      if (!await examples.evaluate(e => e.parentElement.open)) await examples.click();
      await view.getByRole('button', { name: '载入本任务模拟示例' }).click();
      await view.getByRole('button', { name: ['生成巡逻航线', '生成搜索航线', '生成接力方案', '生成运输航线', '生成救援航线'][i] }).click();
      assert.ok((await read()).groups[i].plan, (await read()).notice);
    }
    assert.equal(new Set((await read()).groups.flatMap(g => g.drones)).size, 15);
    for (let i = 4; i >= 0; i--) {
      await nav(names[i]).click();
      await view.getByRole('button', { name: '检查并部署' }).click();
      const deploy = page.getByRole('dialog', { name: '当前任务确认' });
      await deploy.waitFor();
      await deploy.getByRole('button', { name: '下发模拟航线' }).click();
      await deploy.getByRole('button', { name: '模拟解锁' }).click();
      await deploy.getByRole('button', { name: '保留部署，稍后启动' }).click();
      assert.equal((await read()).groups[i].plan.stage, 'armed');
    }
    assert.equal((await read()).runs.length, 0);
    for (let i = 4; i >= 0; i--) {
      await nav(names[i]).click();
      await view.getByRole('button', { name: '检查并部署' }).click();
      const deploy = page.getByRole('dialog', { name: '当前任务确认' });
      await deploy.waitFor();
      if (await deploy.getByRole('checkbox').count()) await deploy.getByRole('checkbox').check();
      await deploy.getByRole('button', { name: '调度并立即模拟起飞' }).click();
      assert.equal((await read()).runs.length, 5 - i, (await read()).notice);
      await view.locator(`[data-run-group="group-${i+1}"]`).getByRole('button', { name: '暂停' }).click();
    }
    await view.getByRole('button', { name: '安全攻防演练' }).click();
    const panel = page.getByRole('region', { name: '安全攻防控制面板' });
    await panel.getByRole('button', { name: /GPS欺骗/ }).click();
    const config = page.getByRole('dialog', { name: 'GPS 欺骗配置', exact: true });
    await config.getByRole('button', { name: '全选所有任务无人机' }).click();
    await config.getByLabel('场景强度', { exact: true }).selectOption('high');
    await config.getByLabel('东向偏移 (m)', { exact: true }).fill('20');
    await config.getByRole('button', { name: '复制当前参数到全部已选' }).click();
    await config.getByLabel('编辑无人机', { exact: true }).selectOption('uav104');
    await config.getByLabel('东向偏移 (m)', { exact: true }).fill('-30');
    await config.getByLabel('启动延迟 (s)', { exact: true }).fill('2');
    await config.getByRole('button', { name: '保存配置', exact: true }).click();
    assert.equal((await read()).drones.filter(d => d.gpsAttack).length, 0);
    await panel.getByRole('button', { name: '启动 GPS 欺骗' }).click();
    assert.equal((await read()).drones.filter(d => d.gpsAttack).length, 15);
    const active = (await read()).drones;
    assert.equal(active.find(d => d.id === 'uav101').gpsAttack.config.values.offsetX, 20);
    assert.equal(active.find(d => d.id === 'uav104').gpsAttack.config.values.offsetX, -30);
    assert.equal(active.find(d => d.id === 'uav104').gpsAttack.config.values.delay, 2);
    await panel.getByRole('button', { name: '关闭攻击面板' }).click();
    for (let i = 1; i <= 5; i++) await view.locator(`[data-run-group="group-${i}"]`).getByRole('button', { name: '继续' }).click();
    await page.waitForFunction(async url => (await import(url)).useCollaborationStore.getState().missionState.drones.some(d => d.trajectory.some(p => p.gpsAttackId)), storeUrl);
    await view.getByRole('button', { name: '安全攻防演练' }).click();
    await page.waitForTimeout(8000);
    assert.ok(await view.locator('[data-gps-actual-trace] polyline[stroke="#ff4545"]').count() > 0);
    assert.ok(await view.locator('[data-gps-marker]').count() > 0);
    await panel.getByRole('button', { name: '停止GPS攻击 uav101', exact: true }).click();
    assert.equal((await read()).drones.find(d => d.id === 'uav101').gpsAttack, undefined);
    assert.ok((await read()).drones.some(d => d.gpsAttack));
    await page.screenshot({ path: '/tmp/muva-gps-live.png' });
    await panel.getByRole('button', { name: '停止全部 GPS 攻击' }).click();
    assert.ok((await read()).drones.every(d => !d.gpsAttack));
    assert.ok(await view.locator('[data-gps-actual-trace] polyline[stroke="#ff4545"]').count() > 0);
    assert.equal(await view.locator('[data-gps-marker]').count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: five concurrent tasks, all 15 targets selected via UI, live GPS markers and red actual trails, independent stop and history retained.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
