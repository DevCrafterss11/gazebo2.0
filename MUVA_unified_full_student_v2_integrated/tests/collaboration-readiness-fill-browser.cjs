const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const out = process.env.MUVA_SCREENSHOT_DIR || 'docs/ui-verification/collaboration/readiness-fill-2026-10-31';
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1860, height: 980 } });
  const errors = [];
  const measurements = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const nav = label => page.getByRole('navigation', { name: '实验三六步教学流程' }).getByRole('button', { name: new RegExp(label) });
  const next = page.getByRole('button', { name: '下一步：集群启动', exact: true });
  const mapping = page.locator('dl[aria-label="所选无人机资源详情"]');
  const inspect = async (name, desktop = true) => {
    const metrics = await page.evaluate(() => {
      const root = document.querySelector('.collaborationWorkspace');
      const content = root.querySelector('main');
      const step = content.firstElementChild;
      const panels = [...step.querySelectorAll('section')];
      const footer = step.querySelector('footer[aria-label="系统感知步骤操作"]');
      const scrollPanels = [...content.querySelectorAll('*')].filter(element => {
        const style = getComputedStyle(element);
        return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 2;
      }).map(element => element.className);
      return {
        width: innerWidth, height: innerHeight, pageWidth: document.documentElement.scrollWidth,
        scrollHeight: root.scrollHeight, clientHeight: root.clientHeight,
        contentOverflow: getComputedStyle(content).overflowY,
        bottomGap: root.getBoundingClientRect().bottom - footer.getBoundingClientRect().bottom,
        panelBottoms: panels.map(panel => panel.getBoundingClientRect().bottom), scrollPanels,
      };
    });
    assert.ok(metrics.pageWidth <= metrics.width + 1, JSON.stringify(metrics));
    assert.equal(metrics.contentOverflow, 'visible');
    assert.deepEqual(metrics.scrollPanels, [], 'No independently scrolling panels');
    if (desktop) {
      assert.ok(metrics.scrollHeight <= metrics.clientHeight + 1, `Desktop requires scrolling: ${JSON.stringify(metrics)}`);
      assert.ok(Math.abs(metrics.panelBottoms[0] - metrics.panelBottoms[1]) < 1, 'Equal-height panels');
      assert.ok(metrics.bottomGap >= -1 && metrics.bottomGap <= 4, `Unused workspace: ${JSON.stringify(metrics)}`);
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
    await page.getByRole('heading', { name: '运行环境检查' }).waitFor();
    const storeUrl = await page.evaluate(() => performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/stores/collaborationStore.ts')?.name);
    assert.ok(storeUrl);
    const read = () => page.evaluate(async url => {
      const s = (await import(url)).useCollaborationStore.getState();
      return { step: s.currentStep, enabled: s.simulationEnabled, starting: s.clusterStarting, cluster: s.clusterRunning, running: s.isRunning, drones: s.missionState.drones, nodes: s.communicationNodes };
    }, storeUrl);
    assert.equal(await next.count(), 1);
    assert.equal(await next.isDisabled(), true);
    assert.equal(await nav('集群启动').isDisabled(), true);
    assert.ok(await page.getByText('请先点击「进入教学模拟模式」。', { exact: false }).isVisible());
    assert.equal(await page.getByRole('button', { name: /^查看uav\d+资源映射$/ }).count(), 15);
    assert.ok(await mapping.getByText('已停止', { exact: true }).isVisible());
    assert.ok(await mapping.getByText('未分配任务', { exact: true }).isVisible());

    for (const [width, height] of [[2048, 1152], [1860, 980], [1860, 900], [1600, 900], [1366, 768]]) {
      await page.setViewportSize({ width, height });
      for (const label of ['Gazebo 仿真服务', 'World 场景文件', '15 架无人机配置', 'SITL 运行依赖', '主机运行资源', '树莓派网络', 'MAVLink 转发']) {
        await page.getByRole('button', { name: `查看${label}说明`, exact: true }).click();
        // Every detail must fit; not only the shorter default text.
        const overflow = await page.evaluate(() => {
          const root = document.querySelector('.collaborationWorkspace');
          return root.scrollHeight - root.clientHeight;
        });
        assert.ok(overflow <= 1, `${width}×${height}, ${label}: ${overflow}px overflow`);
      }
      await page.getByRole('button', { name: '查看15 架无人机配置说明', exact: true }).click();
      await inspect(`01-readiness-${width}x${height}`);
    }
    await page.getByRole('button', { name: '重新检查', exact: true }).click();
    assert.ok(await page.getByRole('status').getByText('本地配置已重新校验 · 真实检测仍待接入').isVisible());
    await page.getByRole('button', { name: '查看uav115资源映射' }).click();
    assert.ok(await page.getByText(/树莓派 192\.168\.10\.115/).isVisible());
    assert.ok(await mapping.getByText('48.0 / -28.0', { exact: true }).isVisible());
    await page.getByRole('button', { name: '进入教学模拟模式', exact: true }).click();
    assert.equal(await next.isEnabled(), true);
    assert.equal((await read()).cluster, false);
    assert.equal((await read()).starting, false);
    assert.equal((await read()).running, false);
    await inspect('02-simulation-selected-1366x768');

    // assignedTaskId is a run ID, not a group ID: resource details must show the group name.
    await page.evaluate(async url => {
      const store = (await import(url)).useCollaborationStore;
      store.setState(s => ({ missionState: { ...s.missionState, drones: s.missionState.drones.map(drone => drone.id === 'uav115' ? { ...drone, assignedTaskId: 'readiness-test-run', taskGroupId: 'group-1', instanceStatus: 'FLYING' } : drone) } }));
    }, storeUrl);
    assert.ok(await mapping.getByText('区域巡逻组', { exact: true }).isVisible());
    assert.ok(await mapping.getByText('执行任务', { exact: true }).isVisible());
    await page.evaluate(async url => {
      const store = (await import(url)).useCollaborationStore;
      store.setState(s => ({ missionState: { ...s.missionState, drones: s.missionState.drones.map(drone => drone.id === 'uav115' ? { ...drone, assignedTaskId: null, taskGroupId: '', instanceStatus: 'STOPPED' } : drone) } }));
    }, storeUrl);

    // An invalid mapping must block the new CTA even after simulation was selected.
    await page.evaluate(async url => {
      const store = (await import(url)).useCollaborationStore;
      store.setState(s => ({ communicationNodes: s.communicationNodes.map((node, index) => index === 0 ? { ...node, ip: '192.168.10.115' } : node) }));
    }, storeUrl);
    assert.equal(await next.isDisabled(), true);
    assert.ok(await page.getByText('资源配置不完整，请检查编号与 IP 映射。', { exact: false }).isVisible());
    await inspect('03-invalid-mapping-1366x768');
    await page.evaluate(async url => {
      const store = (await import(url)).useCollaborationStore;
      store.setState(s => ({ communicationNodes: s.communicationNodes.map((node, index) => index === 0 ? { ...node, ip: '192.168.10.101' } : node) }));
    }, storeUrl);
    await next.click();
    let state = await read();
    assert.equal(state.step, 1);
    assert.equal(state.starting, false, 'Next must not start cluster');
    assert.equal(state.running, false, 'Next must not start tasks');
    await page.getByRole('button', { name: '启动集群', exact: true }).waitFor();
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 500));
    await page.getByRole('button', { name: '启动集群', exact: true }).click();
    await page.clock.runFor(3000);
    state = await read();
    assert.equal(state.cluster, true);
    assert.ok(state.drones.every(drone => drone.instanceStatus === 'STANDBY' && !drone.armed && !drone.assignedTaskId));
    await nav('系统感知').click();
    assert.ok(await mapping.getByText('待命', { exact: true }).isVisible());
    assert.ok(await page.getByText('集群正在运行，可返回步骤2查看启动状态。', { exact: false }).isVisible());
    assert.ok((await read()).nodes.every(node => node.network === '模拟在线' && node.source === 'Mock'));
    await inspect('04-revisit-running-1366x768');
    const before = await read();
    await next.click();
    const after = await read();
    assert.equal(after.step, 1);
    assert.equal(after.cluster, true);
    assert.deepEqual(after.drones, before.drones);
    assert.equal(after.running, false);
    await nav('系统感知').click();

    for (const [width, height] of [[1024, 768], [768, 1024], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await inspect(`05-readiness-${width}x${height}`, false);
      await next.scrollIntoViewIfNeeded();
      assert.ok(await next.isVisible());
      await page.screenshot({ path: `${out}/06-next-action-${width}.png` });
      await next.click();
      assert.equal((await read()).step, 1);
      await nav('系统感知').click();
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(`${out}/result.json`, JSON.stringify({ passed: true, measurements, errors }, null, 2));
    console.log('PASS: step1 fill, 7 check details, 15 mappings, live resource facts, next-step gate, no auto-start, revisit, 5 desktop and 3 narrow sizes');
  } catch (error) {
    await page.screenshot({ path: `${out}/failure.png`, fullPage: true });
    throw error;
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
