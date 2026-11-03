const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const out = process.env.MUVA_SCREENSHOT_DIR || 'docs/ui-verification/collaboration/compact-readiness-2026-10-31';
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1829, height: 1050 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const base = process.env.MUVA_TEST_URL || 'http://127.0.0.1:5175';
  const nav = (text) => page.getByRole('navigation', { name: '实验三六步教学流程' }).getByRole('button', { name: new RegExp(text) });
  const shot = async (name) => page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  const noOverflow = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no page horizontal overflow');
  try {
    await page.goto(`${base}/login`);
    await page.evaluate(() => { sessionStorage.setItem('muva-mock-user', 'signed-in'); sessionStorage.setItem('muva-user-role', 'student'); });
    await page.goto(`${base}/experiments/collaboration`);
    await page.getByRole('heading', { name: '运行环境检查' }).waitFor();
    const storeUrl = await page.evaluate(() => performance.getEntriesByType('resource').find((e) => new URL(e.name).pathname === '/src/stores/collaborationStore.ts')?.name);
    assert.ok(storeUrl);
    const read = () => page.evaluate(async (url) => {
      const s = (await import(url)).useCollaborationStore.getState();
      return { step: s.currentStep, cluster: s.clusterRunning, starting: s.clusterStarting, running: s.isRunning, enabled: s.simulationEnabled, checkTime: s.lastCheckAt, assigned: s.missionState.drones.filter((d) => d.assignedTaskId).length, events: s.events.length };
    }, storeUrl);
    assert.equal(await page.getByRole('button', { name: /资源映射$/ }).count(), 15);
    assert.equal(await page.getByRole('navigation', { name: '实验三六步教学流程' }).getByRole('button', { name: /集群启动/ }).isDisabled(), true);
    const before = await read();
    await page.getByRole('button', { name: '查看uav115资源映射' }).click();
    assert.ok(await page.getByText(/树莓派 192\.168\.10\.115/).isVisible());
    await page.getByRole('button', { name: '查看Gazebo 仿真服务说明' }).click();
    assert.ok(await page.getByText(/当前页面不会启动或探测本机 Gazebo/).isVisible());
    await page.getByRole('button', { name: '重新检查', exact: true }).click();
    assert.ok((await read()).checkTime >= before.checkTime);
    assert.ok(await page.getByRole('status').getByText(/本地配置已重新校验/).isVisible());
    assert.equal((await read()).events, before.events);
    await page.getByRole('button', { name: '查看15 架无人机配置说明' }).click();
    await page.getByRole('button', { name: '查看uav101资源映射' }).click();
    for (const [width, height] of [[1829, 1050], [1600, 1000], [1280, 900], [768, 1024], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await noOverflow();
      await page.getByRole('heading', { name: '运行环境检查' }).scrollIntoViewIfNeeded();
      await shot(`readiness-${width}`);
      await page.getByRole('button', { name: '进入教学模拟模式', exact: true }).scrollIntoViewIfNeeded();
      await shot(`readiness-${width}-conditions`);
      assert.ok(await page.getByRole('button', { name: '进入教学模拟模式', exact: true }).isVisible());
      assert.equal(await page.getByRole('button', { name: /资源映射$/ }).count(), 15);
    }
    await page.setViewportSize({ width: 1829, height: 1050 });
    await page.getByRole('button', { name: '进入教学模拟模式', exact: true }).click();
    let state = await read();
    assert.equal(state.enabled, true); assert.equal(state.starting, false); assert.equal(state.cluster, false); assert.equal(state.running, false); assert.equal(state.assigned, 0);
    await page.getByRole('button', { name: '已进入教学模拟模式' }).isDisabled().then((v) => assert.equal(v, true));
    assert.ok(await page.getByText('教学模拟已选择', {exact:true}).isVisible());
    await shot('readiness-ready');
    await page.getByRole('navigation', { name: '实验三六步教学流程' }).getByRole('button', { name: /集群启动/ }).click();
    assert.equal((await read()).step, 1);
    assert.ok(await page.getByRole('heading', { name: '启动配置' }).isVisible());
    await nav('系统感知').click();
    assert.equal((await read()).enabled, true);
    assert.ok(await page.getByText('教学模拟已选择', {exact:true}).isVisible());
    // The step-1 view is a passive observer even after the cluster is started.
    await nav('集群启动').click();
    await page.getByRole('button', { name: '启动集群', exact: true }).click();
    await page.getByRole('button', {name: '停止集群', exact: true}).waitFor();
    await nav('系统感知').click();
    await page.getByRole('button', { name: '查看uav115资源映射' }).click();
    assert.ok(await page.getByText('模拟在线', { exact: true }).isVisible());
    assert.equal((await read()).running, false); assert.equal((await read()).assigned, 0);
    assert.ok(await page.getByText('模拟在线', {exact:true}).isVisible());
    await shot('readiness-cluster-running');
    assert.deepEqual(errors, []);
    fs.writeFileSync(`${out}/result.json`, JSON.stringify({ passed: true, checks: ['15 independent mapping buttons', 'check detail selection', 'configuration recheck', 'gate before mode selection', 'mode selection does not start cluster or task', 'six-step navigation preserved', 'return state preserved', 'runtime communication state observed without mutation', 'no page overflow at 1829/1600/1280/768/390', 'no browser console errors'], errors }, null, 2));
    console.log('PASS: step 1 controls, mode gate, resources, navigation, runtime observation and 5 responsive viewports');
  } catch (e) { await shot('failure'); throw e; }
  finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
