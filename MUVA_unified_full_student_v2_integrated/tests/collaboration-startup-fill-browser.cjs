const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const out = process.env.MUVA_SCREENSHOT_DIR || 'docs/ui-verification/collaboration/startup-fill-2026-10-31';
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1860, height: 900 } });
  const errors = [];
  const measurements = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const next = page.getByRole('button', { name: '下一步：通信组网', exact: true });
  const previous = page.getByRole('button', { name: '上一步：系统感知', exact: true });
  const nav = label => page.getByRole('navigation', { name: '实验三六步教学流程' }).getByRole('button', { name: new RegExp(label) });
  const inspect = async (name, desktop = true) => {
    const metrics = await page.evaluate(() => {
      const root = document.querySelector('.collaborationWorkspace');
      const content = root.querySelector('main');
      const step = content.firstElementChild;
      const footer = step.querySelector('footer[aria-label="集群启动步骤操作"]');
      const panels = [...step.querySelectorAll('section')];
      const stages = step.querySelector('ol[aria-label="模拟集群启动阶段"]').parentElement;
      const logStatus = stages.parentElement.querySelector('[class*="logStatus"]');
      const scrollPanels = [...content.querySelectorAll('*')].filter(element => {
        const style = getComputedStyle(element);
        return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 2;
      }).map(element => element.className);
      return {
        width: innerWidth, height: innerHeight, pageWidth: document.documentElement.scrollWidth,
        rootHeight: root.clientHeight, rootScroll: root.scrollHeight,
        bottomGap: root.getBoundingClientRect().bottom - footer.getBoundingClientRect().bottom,
        panelClipping: panels.filter(element => element.scrollHeight > element.clientHeight + 2).map(element => element.className),
        scrollPanels,
        progressStatusGap: logStatus.getBoundingClientRect().top - stages.getBoundingClientRect().bottom,
      };
    });
    assert.ok(metrics.pageWidth <= metrics.width + 1, JSON.stringify(metrics));
    assert.deepEqual(metrics.scrollPanels, [], 'No independently scrolling panels');
    assert.ok(metrics.progressStatusGap >= -1, 'Progress stages and heartbeat/status must not overlap');
    assert.deepEqual(metrics.panelClipping, [], 'No hidden/clipped panel content');
    if (desktop) {
      assert.ok(metrics.rootScroll <= metrics.rootHeight + 1, `Desktop requires scrolling: ${JSON.stringify(metrics)}`);
      assert.ok(metrics.bottomGap >= -1 && metrics.bottomGap <= 4, `Footer not filling workspace: ${JSON.stringify(metrics)}`);
    }
    measurements.push({ name, ...metrics });
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  };
  try {
    const base = process.env.MUVA_TEST_URL || 'http://127.0.0.1:5175';
    await page.goto(`${base}/login`);
    await page.evaluate(() => {
      sessionStorage.setItem('muva-mock-user', 'signed-in');
      sessionStorage.setItem('muva-user-role', 'student');
    });
    await page.goto(`${base}/experiments/collaboration`);
    await page.getByRole('button', { name: '进入教学模拟模式', exact: true }).click();
    await page.getByRole('button', { name: '下一步：集群启动', exact: true }).click();
    const storeUrl = await page.evaluate(() => performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/stores/collaborationStore.ts')?.name);
    assert.ok(storeUrl);
    const read = () => page.evaluate(async url => {
      const s = (await import(url)).useCollaborationStore.getState();
      return { step: s.currentStep, cluster: s.clusterRunning, starting: s.clusterStarting, running: s.isRunning, drones: s.missionState.drones, nodes: s.communicationNodes, layout: s.arrayLayout };
    }, storeUrl);
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    assert.equal(await next.isDisabled(), true);
    assert.equal(await previous.isEnabled(), true);
    assert.equal(await page.getByRole('button', { name: /^查看uav\d+启动状态$/ }).count(), 15);
    assert.equal(await page.getByRole('button', { name: /^在阵列中选择uav/ }).count(), 15);
    await previous.click();
    assert.equal((await read()).step, 0);
    await page.getByRole('button', { name: '下一步：集群启动', exact: true }).click();
    assert.equal((await read()).cluster, false, 'Navigation must not start the cluster');

    for (const [width, height] of [[2048, 1152], [1860, 900], [1600, 900], [1366, 768], [1280, 800]]) {
      await page.setViewportSize({ width, height });
      await inspect(`idle-${width}x${height}`);
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.getByRole('spinbutton', { name: '中心 X', exact: true }).fill('12');
    await page.getByRole('button', { name: '查看uav115启动状态', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '在阵列中选择uav115', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: '启动集群', exact: true }).click();
    assert.equal(await next.isDisabled(), true);
    await page.clock.runFor(500);
    await inspect('starting-1366x768');
    await previous.click();
    assert.equal((await read()).starting, true, 'Going back must not stop the runtime');
    await page.getByRole('button', { name: '下一步：集群启动', exact: true }).click();
    await page.clock.runFor(1800);
    let state = await read();
    assert.equal(state.cluster, true);
    assert.equal(state.running, false, 'Cluster startup must not launch a task');
    assert.equal(state.layout.centerX, 12);
    assert.ok(state.drones.every((d, i) => d.id === `uav${101 + i}` && d.raspberryPiIp === `192.168.10.${101 + i}` && d.instanceStatus === 'STANDBY' && !d.armed && !d.assignedTaskId));
    assert.ok(state.nodes.every((n, i) => n.droneId === `uav${101 + i}` && n.ip === `192.168.10.${101 + i}` && n.source === 'Mock' && n.network === '模拟在线'));
    assert.equal(await next.isEnabled(), true);
    for (const [width, height] of [[2048, 1152], [1860, 900], [1600, 900], [1366, 768], [1280, 800], [1024, 768], [768, 1024], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await inspect(`ready-${width}x${height}`, width > 1100);
      if (width === 390) {
        await page.locator('svg[aria-label="3 行 5 列无人机 Home 位置预览"]').scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${out}/ready-390x844-array.png` });
        await page.locator('footer[aria-label="集群启动步骤操作"]').evaluate(element => element.scrollIntoView({ block: 'end', behavior: 'instant' }));
        await page.clock.runFor(32);
        const buttonBounds = await next.boundingBox();
        assert.ok(buttonBounds && buttonBounds.y >= 0 && buttonBounds.y + buttonBounds.height <= 844, 'Next operation must be reachable within the narrow viewport');
        assert.equal(await previous.isVisible(), true);
        assert.equal(await next.isVisible(), true);
        await page.screenshot({ path: `${out}/ready-390x844-navigation.png` });
        await next.click();
        assert.equal((await read()).step, 2);
        await nav('集群启动').click();
        assert.equal((await read()).cluster, true);
      }
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await next.click();
    assert.equal((await read()).step, 2);
    assert.equal((await read()).running, false);
    await nav('集群启动').click();
    assert.equal((await read()).layout.centerX, 12);
    await previous.click();
    assert.equal((await read()).cluster, true);
    await page.getByRole('button', { name: '下一步：集群启动', exact: true }).click();
    assert.equal(await next.isEnabled(), true);

    await page.locator('summary').click();
    assert.equal(await page.getByRole('log', { name: '集群运行日志' }).isVisible(), true);
    await inspect('expanded-log-1366x768', false);
    await page.locator('summary').click();
    const stop = page.getByRole('button', { name: '停止集群', exact: true });
    page.once('dialog', dialog => dialog.dismiss());
    await stop.click();
    assert.equal((await read()).cluster, true);
    page.once('dialog', dialog => dialog.accept());
    await stop.click();
    await page.clock.runFor(700);
    assert.equal((await read()).cluster, false);
    assert.equal(await next.isDisabled(), true);
    await inspect('stopped-1366x768');
    assert.deepEqual(errors, []);
    fs.writeFileSync(`${out}/results.json`, JSON.stringify({ status: 'PASS', errors, measurements }, null, 2));
    console.log(JSON.stringify({ status: 'PASS', screenshots: out, measurements }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
