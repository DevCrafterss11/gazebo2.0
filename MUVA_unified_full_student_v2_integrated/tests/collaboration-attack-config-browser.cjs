const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const key = 'muva:experiment3:basic-attack-configs:v1';
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = process.env.MUVA_TEST_URL || 'http://127.0.0.1:5188';
  const panel = page.getByRole('region', { name: '安全攻防控制面板' });
  const config = page.getByRole('dialog', { name: 'GPS 欺骗配置', exact: true });
  const saved = () => page.evaluate(k => JSON.parse(localStorage.getItem(k) || '[]'), key);
  const enter = async () => {
    const nav = page.getByRole('navigation', { name: '实验三六步教学流程' });
    if (await nav.getByRole('button', { name: /多任务协同指挥/ }).isDisabled()) {
      if (await nav.getByRole('button', { name: /集群启动/ }).isDisabled()) await page.getByRole('button', { name: /进入教学模拟模式/ }).click();
      await nav.getByRole('button', { name: /集群启动/ }).click();
      await page.getByRole('button', { name: '启动集群', exact: true }).click();
    }
    await nav.getByRole('button', { name: /多任务协同指挥/ }).click();
    await page.getByRole('button', { name: '展开指挥台' }).click();
    await page.getByRole('button', { name: '安全攻防演练' }).click();
  };
  const openGPS = () => panel.getByRole('button', { name: /GPS欺骗/ }).click();
  const near = (a, b) => assert.ok(Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1, `size mismatch ${JSON.stringify({ a, b })}`);
  try {
    await page.goto(`${base}/login`);
    await page.getByRole('button', { name: '登录学生端' }).click();
    await page.waitForURL('**/dashboard');
    await page.evaluate(() => {
      const account = sessionStorage.getItem('muva-username') ?? 'student01';
      localStorage.setItem(`muva:collaboration:preferences:v2:account:${encodeURIComponent(account)}`, JSON.stringify({
        version: 2, arrayLayout: { centerX: 0, centerY: 0, columnSpacing: 5, rowSpacing: 5, altitude: 0 }, resources: [],
        groups: [['uav101', 'uav102', 'uav103'], ['uav104', 'uav105', 'uav113'], ['uav106', 'uav107', 'uav108'], ['uav110', 'uav111', 'uav114'], ['uav112', 'uav109', 'uav115']].map((drones, i) => ({ id: `group-${i + 1}`, drones, roles: {}, mode: 'SYNC' })),
      }));
    });
    await page.goto(`${base}/experiments/collaboration`);
    await enter();
    assert.equal(await panel.getByRole('checkbox').count(), 0);
    assert.equal(await panel.getByRole('combobox').count(), 0);
    assert.equal(await panel.getByRole('button', { name: /^(轻微|中等|严重)$/ }).count(), 0);
    await panel.getByRole('button', { name: /攻击库/ }).click();
    const library = page.getByRole('dialog', { name: '攻击库', exact: true });
    const libraryBounds = await library.boundingBox();
    await library.getByRole('button', { name: '配置此模板' }).click();
    await library.getByRole('textbox', { name: '名称', exact: true }).fill('攻击库回归配置');
    await library.getByRole('checkbox', { name: '步骤 1 选择 uav101' }).check();
    await library.getByRole('button', { name: '保存到攻击库' }).click();
    await library.getByRole('button', { name: '选择此配置' }).click();
    assert.match(await panel.innerText(), /已选择配置：攻击库回归配置/);
    await openGPS();
    near(libraryBounds, await config.boundingBox());
    assert.match(await config.innerText(), /GPS 欺骗已接入任务模拟/);
    assert.equal((await saved()).length, 0);
    await config.getByLabel('配置名称', { exact: true }).fill('GPS 课堂轨迹');
    await config.getByLabel('攻击目标 uav101', { exact: true }).check();
    await config.getByLabel('东向偏移 (m)', { exact: true }).fill('25');
    await config.getByLabel('位置变化模式', { exact: true }).selectOption('path');
    await config.getByLabel('路径点', { exact: true }).fill('0,0,0\n25,10,5\n40,20,10');
    assert.equal(await config.getByLabel('东向偏移 (m)', { exact: true }).count(), 0);
    await config.getByLabel('参考纬度 (°)', { exact: true }).fill('91');
    await config.getByRole('button', { name: '保存配置', exact: true }).click();
    assert.match(await config.getByRole('alert').innerText(), /需要修正/);
    assert.equal((await saved()).length, 0);
    await config.getByLabel('参考纬度 (°)', { exact: true }).fill('31.23');
    await config.getByRole('button', { name: '保存配置', exact: true }).click();
    await config.waitFor({ state: 'detached' });
    const firstSaved = await saved();
    assert.equal(firstSaved[0].droneConfigs.uav101.values.offsetX, 25);
    assert.deepEqual(firstSaved[0].targetDroneIds, ['uav101']);
    assert.equal(await panel.getByRole('button', { name: '启动 GPS 欺骗' }).isDisabled(), false);
    await openGPS();
    await config.getByLabel('位置变化模式', { exact: true }).selectOption('static');
    assert.equal(await config.getByLabel('东向偏移 (m)', { exact: true }).inputValue(), '25');
    await config.getByLabel('东向偏移 (m)', { exact: true }).fill('99');
    await config.getByRole('button', { name: '取消', exact: true }).click();
    assert.deepEqual(await saved(), firstSaved);
    await openGPS();
    await config.getByRole('button', { name: '恢复默认值', exact: true }).click();
    assert.equal(await config.getByLabel('东向偏移 (m)', { exact: true }).inputValue(), '10');
    await page.keyboard.press('Escape');
    assert.deepEqual(await saved(), firstSaved);
    assert.equal(await page.getByRole('dialog', { name: '独立任务全屏工作区' }).count(), 1);
    const cases = [['命令注入', '命令注入配置', '模拟指令'], ['通信劫持', '通信劫持配置', '丢包率'], ['电量攻击', '电量攻击配置', '额外耗电倍率'], ['传感器干扰', '传感器干扰配置', '横滚噪声幅度 (°)']];
    for (const [button, title, field] of cases) {
      await panel.getByRole('button', { name: new RegExp(button) }).click();
      const dialog = page.getByRole('dialog', { name: title, exact: true });
      await dialog.getByLabel(field, { exact: true }).waitFor();
      assert.equal(await dialog.getByLabel('东向偏移 (m)', { exact: true }).count(), 0);
      await dialog.getByRole('button', { name: '保存配置', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
    }
    assert.equal((await saved()).length, 5);
    assert.deepEqual((await saved()).find(c => c.attackType === 'GPS_SPOOFING'), firstSaved[0]);
    await page.reload(); await enter(); await openGPS();
    assert.equal(await config.getByLabel('配置名称', { exact: true }).inputValue(), 'GPS 课堂轨迹');
    assert.equal(await config.getByLabel('位置变化模式', { exact: true }).inputValue(), 'path');
    assert.equal(await config.getByLabel('攻击目标 uav101', { exact: true }).isChecked(), true);
    await config.getByRole('button', { name: /位置与轨迹/ }).click();
    await page.screenshot({ path: '/tmp/muva-attack-config-desktop.png' });
    // Storage failure keeps the draft and the dialog intact.
    await page.evaluate(() => { window.originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(k, v) { if (k.includes('basic-attack-configs')) throw new Error('quota'); return window.originalSetItem.call(this, k, v); }; });
    await config.getByLabel('配置名称', { exact: true }).fill('未丢失的草稿');
    await config.getByRole('button', { name: '保存配置', exact: true }).click();
    assert.match(await config.getByRole('alert').innerText(), /本地保存失败/);
    assert.equal(await config.getByLabel('配置名称', { exact: true }).inputValue(), '未丢失的草稿');
    await page.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; });
    await config.getByRole('button', { name: '取消', exact: true }).click();
    await openGPS();
    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = await config.boundingBox();
    assert.ok(mobile.x >= 0 && mobile.width <= 390 && mobile.y >= 0 && mobile.y + mobile.height <= 844);
    const saveBounds = await config.getByRole('button', { name: '保存配置', exact: true }).boundingBox();
    assert.ok(saveBounds.y + saveBounds.height <= 844);
    assert.equal(await config.evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await config.getByRole('button', { name: /位置与轨迹/ }).click();
    await page.screenshot({ path: '/tmp/muva-attack-config-mobile.png' });
    await page.keyboard.press('Escape');
    // Compare both windows at exactly the same mobile viewport.
    await page.setViewportSize({ width: 1366, height: 768 });
    await panel.getByRole('button', { name: /攻击库/ }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    near(mobile, await library.boundingBox());
    assert.deepEqual(errors, []);
    console.log('PASS: five independent configs; exact library dimensions; validation; cancel/reset; persistence; storage failure; responsive layout; saving does not execute.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
