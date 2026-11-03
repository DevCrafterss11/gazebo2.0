/* End-to-end UI acceptance for five independently launched Mock tasks. Store access is read-only. */
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const base = process.env.MUVA_TEST_URL || 'http://127.0.0.1:5175';
  try {
    await page.goto(`${base}/login`);
    await page.evaluate(() => { sessionStorage.setItem('muva-mock-user', 'signed-in'); sessionStorage.setItem('muva-user-role', 'student'); });
    await page.goto(`${base}/experiments/collaboration`);
    const storeUrl = await page.evaluate(() => performance.getEntriesByType('resource').find(e => new URL(e.name).pathname === '/src/stores/collaborationStore.ts')?.name);
    assert.ok(storeUrl);
    const read = () => page.evaluate(async url => { const s = (await import(url)).useCollaborationStore.getState(); return { groups: s.missionState.groups, records: s.records, runs: s.schedulerState.activeRuns, leases: s.schedulerState.activeLeases, notice: s.notice, mode: s.concurrentMode }; }, storeUrl);
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
    }
    const started = await read();
    assert.equal(new Set(started.leases.map(l => l.droneId)).size, 15);
    assert.equal(started.runs.length, 5);
    assert.equal(await view.locator('[aria-label="并发任务控制"] button').count() >= 5, true);
    const dispatch = id => view.locator(`[data-run-group="group-${id}"]`);
    assert.equal(await view.locator('[data-run-group]').count(), 5);
    for (let i = 1; i <= 5; i++) {
      assert.match(await dispatch(i).textContent(), /%.*uav/);
      assert.equal(await dispatch(i).locator('progress').count(), 1);
    }
    await dispatch(1).getByRole('button', { name: '暂停' }).click();
    await dispatch(2).getByRole('button', { name: '暂停' }).click();
    assert.equal((await read()).groups[0].lifecycle, '暂停');
    assert.equal((await read()).groups[1].lifecycle, '暂停');
    await dispatch(1).getByRole('button', { name: '继续' }).click();
    assert.equal((await read()).groups[0].lifecycle, '执行中');
    assert.equal((await read()).groups[1].lifecycle, '暂停');
    await dispatch(2).getByRole('button', { name: '继续' }).click();
    await nav(names[0]).click();
    await view.getByRole('button', { name: '暂停任务' }).click();
    await view.getByRole('button', { name: '继续任务' }).click();

    // Complete all five via the UI; the independent task simulation is clocked by real 200 ms ticks.
    for (let n = 0; n < 900 && (await read()).runs.length; n++) {
      const snapshot = await read();
      for (let i = 0; i < 5; i++) if (snapshot.groups[i].lifecycle === '待结果确认') {
        await nav(names[i]).click();
        const label = snapshot.groups[i].execution?.awaiting === 'recon' ? '通过模拟侦察确认' : i === 3 ? '确认模拟交付' : i === 1 ? '通过搜索结果复核' : '确认模拟处置结果';
        await view.getByRole('button', { name: label, exact: true }).click();
      }
      await page.waitForTimeout(200);
    }
    const result = await read();
    assert.equal(result.runs.length, 0, result.groups.map(g => `${g.name}: ${g.lifecycle} ${g.failureReason || ''}`).join(' / '));
    assert.equal(result.records.length, 5);
    await view.getByRole('tab', { name: /已归档/ }).click();
    const archive = view.getByRole('region', { name: '全部任务归档' });
    assert.equal(await archive.getByRole('button').count(), 5);
    for (const name of names) {
      await archive.getByRole('button', { name: new RegExp(name) }).click();
      assert.match(await view.locator('[aria-label="五类独立任务入口"]').textContent(), new RegExp(name));
    }

    assert.ok(result.records.every(r => r.group.outcome === 'success'));
    assert.equal(result.leases.filter(l => l.status !== 'released').length, 0);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, records: result.records.map(r => r.type), leased: result.leases.filter(l => l.status !== 'released').length }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
