const assert = require('node:assert/strict');
const { mkdirSync, writeFileSync } = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');

(async () => {
  const output = process.env.MUVA_SCREENSHOT_DIR || '/tmp/muva-swarm-parallel';
  const base = process.env.MUVA_TEST_URL || 'http://127.0.0.1:5181';
  mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'] });
  const errors = [];
  const consoleErrors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('dialog', dialog => dialog.accept());
    await page.goto(`${base}/login`);
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.setItem('muva-mock-user', 'signed-in');
      sessionStorage.setItem('muva-user-role', 'student');
      sessionStorage.setItem('muva-username', 'swarm-parallel-test');
      sessionStorage.setItem('muva-auth-token', 'mock-token-student');
    });
    await page.goto(`${base}/experiments/swarm`);
    await page.getByRole('button', { name: /开始新实验/ }).click();
    await page.getByRole('button', { name: /确认配置并进入下一步/ }).click();
    await page.getByRole('button', { name: '初始化机群', exact: true }).click();
    await page.evaluate(async () => {
      const resources = performance.getEntriesByType('resource');
      const { useSwarmStore } = await import(resources.find(item => new URL(item.name).pathname === '/src/stores/swarmStore.ts').name);
      const { swarmFrame } = await import(resources.find(item => new URL(item.name).pathname === '/src/domain/swarmGeometry.ts').name);
      const store = useSwarmStore.getState();
      store.updateConfig({ altitude: 20, speed: 10, spacing: 10 });
      store.initialize();
      const { toGeo } = swarmFrame(useSwarmStore.getState().run.config.sceneOrigin);
      store.setArea([[-185, 0], [-90, -10], [-64, -110], [-175, -110]].map(toGeo));
      store.setHome(toGeo([-37.8, -30.5]));
    });
    await page.getByRole('button', { name: '确认规划并进入下一步', exact: true }).click();
    await page.getByRole('button', { name: '生成航线', exact: true }).click();
    await page.getByRole('button', { name: '检查航线', exact: true }).click();
    await page.locator('[data-delivery-status="CHECKED"]').waitFor();
    await page.getByRole('button', { name: '下发航线', exact: true }).click();
    await page.locator('[data-delivery-status="UPLOADED"]').waitFor();
    await page.screenshot({ path: `${output}/parallel-uploaded.png`, fullPage: true });
    await page.getByRole('button', { name: '确认航线并进入下一步', exact: true }).click();
    await page.getByRole('button', { name: /执行自动检查/ }).click();
    await page.getByRole('button', { name: '进入飞行控制', exact: true }).click();
    await page.getByRole('button', { name: /集群起飞/ }).click();
    await page.evaluate(async () => {
      const item = performance.getEntriesByType('resource').find(item => new URL(item.name).pathname === '/src/services/serviceRegistry.ts');
      const { services } = await import(item.name);
      services.swarm.stop();
      services.swarm.tick(16);
    });
    await page.getByRole('button', { name: /开始任务/ }).click();
    const advance = stopAt => page.evaluate(async stopAt => {
      const resources = performance.getEntriesByType('resource');
      const { services } = await import(resources.find(item => new URL(item.name).pathname === '/src/services/serviceRegistry.ts').name);
      const { swarmFrame } = await import(resources.find(item => new URL(item.name).pathname === '/src/domain/swarmGeometry.ts').name);
      const run = JSON.parse(localStorage.getItem('muva-swarm-draft-v1'));
      const { toLocal } = swarmFrame(run.config.sceneOrigin);
      let maxMoving = 0;
      let minimum = Infinity;
      let independentReturn = false;
      let independentLanding = false;
      for (let step = 0; step < 4000; step += 1) {
        const before = services.swarm.getFleet();
        services.swarm.tick(.2);
        const status = services.swarm.getStatus();
        const after = status.drones;
        maxMoving = Math.max(maxMoving, after.filter(drone => drone.speed > .1).length);
        independentReturn ||= after.some(drone => drone.state === 'RETURNING') && after.some(drone => drone.state === 'RUNNING');
        independentLanding ||= after.some(drone => drone.state === 'LANDED') && after.some(drone => drone.state === 'RUNNING');
        before.forEach((first, index) => before.slice(index + 1).forEach((other, offset) => {
          const secondIndex = index + offset + 1;
          const a = toLocal(first.position), b = toLocal(other.position);
          const c = toLocal(after[index].position), d = toLocal(after[secondIndex].position);
          const relative = [a[0] - b[0], a[1] - b[1], first.altitude - other.altitude];
          const velocity = [c[0] - d[0] - relative[0], c[1] - d[1] - relative[1], after[index].altitude - after[secondIndex].altitude - relative[2]];
          const squared = velocity.reduce((sum, value) => sum + value * value, 0);
          const ratio = squared ? Math.max(0, Math.min(1, -relative.reduce((sum, value, axis) => sum + value * velocity[axis], 0) / squared)) : 0;
          minimum = Math.min(minimum, Math.hypot(...relative.map((value, axis) => value + ratio * velocity[axis])));
        }));
        if (status.status === 'COMPLETED' || stopAt === 'parallel' && maxMoving >= 2 || stopAt === 'landing' && independentLanding) break;
      }
      return { maxMoving, minimum, independentReturn, independentLanding, snapshot: services.swarm.getStatus() };
    }, stopAt);
    const parallel = await advance('parallel');
    assert.ok(parallel.maxMoving >= 2, '至少两机同时飞行');
    await page.screenshot({ path: `${output}/parallel-flight.png`, fullPage: true });
    await page.getByRole('button', { name: /暂停任务/ }).click();
    const paused = await page.evaluate(() => JSON.parse(localStorage.getItem('muva-swarm-draft-v1')).snapshot);
    await page.evaluate(async () => {
      const item = performance.getEntriesByType('resource').find(item => new URL(item.name).pathname === '/src/services/serviceRegistry.ts');
      const { services } = await import(item.name);
      services.swarm.tick(10);
    });
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('muva-swarm-draft-v1')).snapshot), paused);
    await page.getByRole('button', { name: /继续任务/ }).click();
    const landing = await advance('landing');
    assert.ok(landing.independentReturn, '完成覆盖的飞机独立返航，其余飞机继续覆盖');
    assert.ok(landing.independentLanding, '已完成航线的飞机独立落地，其余飞机继续覆盖');
    await page.screenshot({ path: `${output}/independent-landing.png`, fullPage: true });
    const completed = await advance('complete');
    assert.equal(completed.snapshot.status, 'COMPLETED');
    assert.equal(completed.snapshot.coverage, 100);
    assert.ok(completed.snapshot.events.some(event => event.includes('局部避让等待')), '交叉航段应局部等待');
    assert.ok(completed.snapshot.events.some(event => event.includes('自动继续')), '等待航段释放后应自动继续');
    completed.snapshot.drones.forEach(drone => {
      assert.equal(drone.state, 'LANDED');
      assert.deepEqual(drone.position, drone.homePosition);
      assert.ok(drone.trajectory.length > 20);
    });
    const minimum = Math.min(parallel.minimum, landing.minimum, completed.minimum);
    assert.ok(minimum >= 3 - .01, `连续轨迹安全间距 ${minimum}`);
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: `${output}/completed-${viewport.width}.png`, fullPage: true });
    }
    const result = { mode: 'mock', receipts: completed.snapshot.missionReceipts.length,
      maxMoving: Math.max(parallel.maxMoving, landing.maxMoving, completed.maxMoving), minimum,
      independentReturn: landing.independentReturn, independentLanding: landing.independentLanding,
      status: completed.snapshot.status, coverage: completed.snapshot.coverage, localYieldAndResume: true, errors, consoleErrors };
    writeFileSync(`${output}/parallel-browser-result.json`, JSON.stringify(result, null, 2));
    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors, []);
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
