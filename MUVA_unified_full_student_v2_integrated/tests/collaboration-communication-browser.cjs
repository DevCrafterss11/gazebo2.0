const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const base = process.env.MUVA_BASE_URL || 'http://127.0.0.1:5175';
const out = process.env.MUVA_SCREENSHOT_DIR || 'docs/ui-verification/collaboration/communication-2026-10-31';
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1860, height: 900 } });
  const errors = [], measurements = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const previous = page.getByRole('button', { name: '上一步：集群启动', exact: true });
  const next = page.getByRole('button', { name: '下一步：集群状态监控', exact: true });
  const details = page.getByRole('region', { name: '选中节点链路详情' });
  const inspect = async (name, desktop) => {
    await page.clock.runFor(32);
    const result = await page.evaluate(() => {
      const root = document.querySelector('.collaborationWorkspace');
      const content = root.querySelector('main');
      const footer = content.querySelector('footer');
      const panels = [...content.querySelectorAll('section')];
      const overlap = [...content.querySelectorAll('article button')].some(card => {
        const children = [...card.children].map(el => el.getBoundingClientRect());
        return children.some((rect, i) => i && rect.top < children[i - 1].bottom - 1);
      });
      return {
        width: innerWidth, height: innerHeight, pageWidth: document.documentElement.scrollWidth,
        rootHeight: root.clientHeight, rootScroll: root.scrollHeight, rootWidth: root.clientWidth, rootScrollWidth: root.scrollWidth,
        bottomGap: root.getBoundingClientRect().bottom - footer.getBoundingClientRect().bottom,
        panelClipping: panels.filter(el => el.scrollHeight > el.clientHeight + 2).map(el => el.className),
        scrollPanels: [...content.querySelectorAll('*')].filter(el => /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 2).map(el => el.className),
        overlap,
      };
    });
    assert.ok(result.pageWidth <= result.width + 2, JSON.stringify(result));
    assert.ok(result.rootScrollWidth <= result.rootWidth + 2, 'No horizontally clipped content: ' + JSON.stringify(result));
    assert.deepEqual(result.scrollPanels, [], 'No nested panel scrollbars');
    assert.deepEqual(result.panelClipping, [], 'No clipped panel content');
    assert.equal(result.overlap, false, 'No overlapping node fields');
    if (desktop) {
      assert.ok(result.rootScroll <= result.rootHeight + 2, JSON.stringify(result));
      assert.ok(Math.abs(result.bottomGap) <= 5, JSON.stringify(result));
      const box = await next.boundingBox();
      assert.ok(box.y + box.height <= result.height, 'Next button visible without scrolling');
    }
    measurements.push({ name, ...result });
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  };
  try {
    await page.goto(`${base}/login`);
    await page.evaluate(() => { sessionStorage.setItem('muva-mock-user', 'signed-in'); sessionStorage.setItem('muva-user-role', 'student'); });
    await page.goto(`${base}/experiments/collaboration`);
    await page.getByRole('heading', { name: '运行环境检查' }).waitFor();
    const url = await page.evaluate(() => performance.getEntriesByType('resource').find(e => new URL(e.name).pathname === '/src/stores/collaborationStore.ts').name);
    const read = () => page.evaluate(async url => {
      const s = (await import(url)).useCollaborationStore.getState();
      return { step: s.currentStep, running: s.isRunning, cluster: s.clusterRunning, selected: s.selectedDrone, drones: s.missionState.drones, nodes: s.communicationNodes };
    }, url);
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 500));
    await page.getByRole('button', { name: '进入教学模拟模式', exact: true }).click();
    await page.getByRole('button', { name: '下一步：集群启动', exact: true }).click();
    await page.getByRole('button', { name: '启动集群', exact: true }).click();
    await page.clock.runFor(2300);
    await page.getByRole('button', { name: '下一步：通信组网', exact: true }).click();
    assert.equal(await page.getByRole('article').count(), 15);
    for (let id = 101; id <= 115; id++) {
      const card = page.getByRole('article').filter({ has: page.getByText(`uav${id}`, { exact: true }) });
      assert.equal(await card.count(), 1);
      assert.ok(await card.getByText(`192.168.10.${id}`, { exact: true }).isVisible());
      assert.ok(await card.getByText('Mock', { exact: true }).isVisible());
    }
    let state = await read();
    assert.ok(state.cluster && !state.running);
    assert.equal(new Set(state.nodes.map(n => n.ip)).size, 15);
    assert.ok(state.drones.every(d => !d.armed && !d.assignedTaskId && d.instanceStatus === 'STANDBY'));
    const heartbeat = state.nodes[0].heartbeatAt;
    await page.clock.runFor(1300);
    assert.ok((await read()).nodes[0].heartbeatAt > heartbeat, 'Unified runtime continues heartbeat updates');
    await page.getByRole('button', { name: '查看uav115通信链路' }).click();
    assert.ok(await details.getByText('192.168.10.115', { exact: true }).isVisible());
    assert.equal((await read()).selected, 'uav115');
    const keyboardNode = page.getByRole('button', { name: '查看uav114通信链路' });
    await keyboardNode.focus(); await keyboardNode.press('Enter');
    assert.equal((await read()).selected, 'uav114');
    assert.ok(await details.getByText('192.168.10.114', { exact: true }).isVisible());
    await page.getByRole('button', { name: '需关注 0', exact: true }).click();
    assert.equal(await page.getByRole('article').count(), 0);
    assert.ok(await page.getByText('当前没有需要关注的链路', { exact: true }).isVisible());
    await page.getByRole('button', { name: '显示全部节点', exact: true }).click();
    assert.equal(await page.getByRole('article').count(), 15);
    await previous.click();
    assert.equal((await read()).step, 1);
    await page.getByRole('button', { name: '下一步：通信组网', exact: true }).click();
    await next.click();
    assert.equal((await read()).step, 3);
    assert.equal((await read()).selected, 'uav114', 'Selected node carries into fleet monitoring');
    await page.getByRole('navigation', { name: '实验三六步教学流程' }).getByRole('button', { name: /通信组网/ }).click();
    assert.ok((await read()).cluster && !(await read()).running);

    // Controlled UI fixtures only; production runtime and service data generation stay untouched.
    const snapshot = (await read()).nodes;
    await page.evaluate(async url => {
      const store = (await import(url)).useCollaborationStore;
      store.setState(s => ({ communicationNodes: s.communicationNodes.map((n, i) => i === 0 ? { ...n, network: '中断', heartbeatAt: null, mavlink: '模拟转发中断' } : i === 1 ? { ...n, heartbeatAt: Date.now() - 10000 } : n) }));
    }, url);
    await page.getByRole('button', { name: '需关注 2', exact: true }).click();
    assert.equal(await page.getByRole('article').count(), 2);
    await page.getByRole('button', { name: '查看uav101通信链路' }).click();
    assert.ok(await details.getByText('通信中断', { exact: true }).isVisible());
    assert.ok(await details.getByText('未收到', { exact: true }).isVisible());
    await page.getByRole('button', { name: '查看uav102通信链路' }).click();
    assert.ok(await details.getByText('数据过期', { exact: true }).isVisible());
    assert.ok(await next.isEnabled(), 'Anomalies do not prevent entering fleet monitoring');
    await page.screenshot({ path: `${out}/03-attention.png`, fullPage: true });
    await page.evaluate(async ({ url, nodes }) => { (await import(url)).useCollaborationStore.setState({ communicationNodes: nodes }); }, { url, nodes: snapshot });
    await page.getByRole('button', { name: '全部节点 15', exact: true }).click();
    await page.evaluate(async url => {
      const store = (await import(url)).useCollaborationStore;
      store.setState(s => ({ communicationNodes: s.communicationNodes.map((n, i) => i === 0 ? { ...n, ip: '192.168.10.102' } : n) }));
    }, url);
    assert.ok(await page.getByText('资源映射 13 / 15 · 请检查', { exact: true }).isVisible());
    await page.evaluate(async ({ url, nodes }) => { (await import(url)).useCollaborationStore.setState({ communicationNodes: nodes }); }, { url, nodes: snapshot });
    await page.evaluate(async url => {
      const store = (await import(url)).useCollaborationStore;
      store.setState(s => ({ communicationNodes: s.communicationNodes.filter(n => n.droneId !== 'uav115') }));
    }, url);
    await page.getByRole('button', { name: '查看uav115通信链路' }).click();
    assert.ok(await details.getByText('缺少通信节点', { exact: true }).isVisible());
    assert.equal(await page.getByRole('article').count(), 15, 'Missing node still leaves its drone visible');
    await page.evaluate(async ({ url, nodes }) => { (await import(url)).useCollaborationStore.setState({ communicationNodes: nodes, stopRequested: true }); }, { url, nodes: snapshot });
    assert.ok(await next.isDisabled(), 'Safe shutdown blocks next step');
    await page.evaluate(async url => { (await import(url)).useCollaborationStore.setState({ stopRequested: false }); }, url);
    const resources = (await read()).drones;
    await page.evaluate(async url => {
      const store = (await import(url)).useCollaborationStore;
      store.setState(s => ({ missionState: { ...s.missionState, drones: [] } }));
    }, url);
    assert.ok(await page.getByText('尚无无人机资源', { exact: true }).isVisible());
    await page.evaluate(async ({ url, drones }) => {
      const store = (await import(url)).useCollaborationStore;
      store.setState(s => ({ missionState: { ...s.missionState, drones } }));
    }, { url, drones: resources });
    await page.getByRole('button', { name: '查看uav115通信链路' }).click();
    for (const [width, height] of [[1860, 900], [1600, 900], [1366, 768], [768, 1024], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await inspect(`03-network-${width}`, width > 1100);
    }
    await page.locator('footer[aria-label="通信组网步骤操作"]').evaluate(el => el.scrollIntoView({ block: 'end', behavior: 'instant' }));
    await page.clock.runFor(32);
    await page.screenshot({ path: `${out}/03-network-mobile-footer.png`, fullPage: false });
    const footerBox = await next.boundingBox();
    assert.ok(footerBox.y >= 0 && footerBox.y + footerBox.height <= 844);
    await previous.click();
    page.once('dialog', d => d.accept());
    await page.getByRole('button', { name: '停止集群', exact: true }).click();
    assert.equal((await read()).cluster, false);
    assert.equal((await read()).running, false);
    assert.deepEqual(errors, []);
    fs.writeFileSync(`${out}/result.json`, JSON.stringify({ passed: true, measurements, errors }, null, 2));
    console.log('PASS: step 3 navigation, 15 mappings, selection/keyboard, heartbeat updates, attention/stale/mapping states, no auto tasks, 5 responsive sizes, no nested scrollbars');
  } catch (error) { await page.screenshot({ path: `${out}/failure.png`, fullPage: true }); throw error; }
  finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
