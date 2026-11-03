const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  const base = process.env.MUVA_TEST_URL || 'http://127.0.0.1:5188';
  const enterStation = async () => {
    const nav = page.getByRole('navigation', { name: '实验三六步教学流程' });
    if (await nav.getByRole('button', { name: /多任务协同指挥/ }).isDisabled()) {
      if (await nav.getByRole('button', { name: /集群启动/ }).isDisabled()) await page.getByRole('button', { name: /进入教学模拟模式/ }).click();
      await nav.getByRole('button', { name: /集群启动/ }).click();
      await page.getByRole('button', { name: '启动集群', exact: true }).click();
      await nav.getByRole('button', { name: /多任务协同指挥/ }).waitFor({ state: 'visible' });
      await page.getByRole('button', { name: '关闭集群' }).waitFor({ state: 'visible', timeout: 12000 }).catch(() => {});
    }
    await nav.getByRole('button', { name: /多任务协同指挥/ }).click();
    await page.getByRole('button', { name: '展开指挥台' }).click();
  };
  try {
    await page.goto(`${base}/login`);
    await page.getByRole('button', { name: '登录学生端' }).click();
    await page.waitForURL('**/dashboard');
    await page.goto(`${base}/experiments/collaboration`);
    await page.getByRole('button', { name: /进入教学模拟模式/ }).click();
    await enterStation();
    const station = page.getByRole('dialog', { name: '独立任务全屏工作区' });
    await station.getByRole('button', { name: '安全攻防演练' }).click();
    const panel = station.getByRole('region', { name: '安全攻防控制面板' });
    await panel.getByRole('button', { name: /攻击库/ }).click();
    const library = page.getByRole('dialog', { name: '攻击库' });
    await library.waitFor();
    const rect = await library.boundingBox();
    assert.ok(rect.x > 100 && rect.y >= 0 && rect.width < 950 && rect.height <= 768, `dialog bounds ${JSON.stringify(rect)}`);
    await page.screenshot({ path: '/tmp/muva-attack-library-desktop.png' });
    assert.equal(await library.getByRole('button', { name: '配置此模板' }).count(), 1);
    await library.getByRole('button', { name: '配置此模板' }).click();
    await library.getByRole('textbox', { name: '名称' }).fill('课程漂移模板');
    await library.getByRole('spinbutton', { name: '东向偏移 (m)' }).fill('13');
    await library.getByRole('checkbox', { name: '步骤 1 选择 uav101' }).check();
    await library.getByRole('button', { name: '通信劫持', exact: true }).click();
    await library.getByRole('checkbox', { name: '步骤 2 选择 uav115' }).check();
    await library.getByRole('button', { name: '保存到攻击库' }).click();
    assert.match(await library.getByRole('region', { name: '配置详情' }).innerText(), /GPS 欺骗[\s\S]*uav101[\s\S]*通信劫持[\s\S]*uav115/);
    await library.getByRole('button', { name: '选择此配置' }).click();
    assert.match(await panel.innerText(), /已选择配置：课程漂移模板[\s\S]*uav101[\s\S]*uav115/);
    assert.equal(await panel.getByRole('button', { name: '攻击执行待接入' }).isDisabled(), true);
    await panel.getByRole('button', { name: /攻击库/ }).click();
    await library.getByRole('button', { name: '新建组合攻击' }).click();
    await library.getByRole('textbox', { name: '名称' }).fill('跨机协同组合');
    await library.getByRole('button', { name: '命令注入', exact: true }).click();
    await library.getByRole('button', { name: '电量攻击', exact: true }).click();
    await library.getByRole('button', { name: '保存到攻击库' }).click();
    assert.match(await library.getByRole('alert').innerText(), /每个攻击步骤指定至少一架无人机/);
    await library.getByRole('checkbox', { name: '步骤 1 选择 uav101' }).check();
    await library.getByRole('checkbox', { name: '步骤 1 选择 uav102' }).check();
    await library.getByRole('checkbox', { name: '步骤 2 选择 uav115' }).check();
    await library.getByRole('button', { name: '上移步骤 2' }).click();
    assert.equal(await library.getByRole('region', { name: '步骤 1 电量攻击' }).count(), 1);
    assert.equal(await library.getByRole('region', { name: '步骤 2 命令注入' }).count(), 1);
    await library.getByRole('button', { name: '保存到攻击库' }).click();
    const combined = library.getByRole('region', { name: '配置详情' });
    assert.match(await combined.innerText(), /电量攻击[\s\S]*uav115[\s\S]*命令注入[\s\S]*uav101、uav102/);
    await library.getByRole('button', { name: '基于此配置创建' }).click();
    assert.equal(await library.getByRole('checkbox', { name: '步骤 1 选择 uav115' }).isChecked(), true);
    assert.equal(await library.getByRole('checkbox', { name: '步骤 2 选择 uav102' }).isChecked(), true);
    await library.getByRole('textbox', { name: '名称' }).fill('复制的协同组合');
    await library.getByRole('button', { name: '保存到攻击库' }).click();
    assert.match(await combined.innerText(), /复制的协同组合[\s\S]*uav115[\s\S]*uav102/);
    await library.locator('input[type=file]').setInputFiles({
      name: 'custom.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ name: '上传的链路测试', attackType: 'COMM_HIJACK', severity: 'high',
        description: '导入配置', parameters: [{ key: 'packetLoss', label: '丢包率', type: 'number', defaultValue: 0.5 }],
        steps: [{ attackType: 'COMM_HIJACK', severity: 'high', targetDroneIds: ['uav103'], parameters: [{ key: 'packetLoss', label: '丢包率', type: 'number', defaultValue: 0.5 }] },
          { attackType: 'BATTERY_DRAIN', severity: 'low', targetDroneIds: ['uav114'], parameters: [] }],
        executeCode: 'window.__untrustedRan = true' })),
    });
    await library.getByText('已导入配置', { exact: false }).waitFor();
    assert.equal(await page.evaluate(() => window.__untrustedRan === true), false);
    const saved = await page.evaluate(() => localStorage.getItem('muva:experiment3:attack-scripts:v1'));
    assert.ok(saved.includes('课程漂移模板') && saved.includes('上传的链路测试'));
    assert.ok(!saved.includes('__untrustedRan'));
    assert.deepEqual(JSON.parse(saved).find(item => item.name === '课程漂移模板').steps.map(item => [item.attackType, item.targetDroneIds]),
      [['GPS_SPOOFING', ['uav101']], ['COMM_HIJACK', ['uav115']]]);
    await library.locator('input[type=file]').setInputFiles({
      name: 'old.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ name: '旧版待修正', attackType: 'GPS_SPOOFING', severity: 'low', parameters: [], targetDroneIds: ['uav999'] })),
    });
    assert.equal(await library.getByRole('button', { name: '选择此配置' }).isDisabled(), true);
    assert.match(await combined.getByRole('alert').innerText(), /uav999 不在当前机队/);
    await library.getByRole('button', { name: '基于此配置创建' }).click();
    await library.getByRole('button', { name: '步骤 1 移除无效目标 uav999' }).click();
    await library.getByRole('checkbox', { name: '步骤 1 选择 uav114' }).check();
    await library.getByRole('button', { name: '保存到攻击库' }).click();
    assert.match(await combined.innerText(), /uav114/);
    assert.equal(await library.getByRole('button', { name: '选择此配置' }).isEnabled(), true);
    await library.getByRole('button', { name: '关闭攻击库' }).click();
    await page.reload();
    await enterStation();
    await page.getByRole('button', { name: '安全攻防演练' }).click();
    await page.getByRole('region', { name: '安全攻防控制面板' }).getByRole('button', { name: /攻击库/ }).click();
    await library.getByRole('button', { name: /课程漂移模板/ }).click();
    assert.match(await library.getByRole('region', { name: '配置详情' }).innerText(), /13[\s\S]*uav115/);
    await library.getByRole('button', { name: '删除自定义配置' }).click();
    assert.equal(await library.getByRole('button', { name: /课程漂移模板/ }).count(), 0);
    await library.getByRole('button', { name: /上传的链路测试/ }).click();
    assert.match(await library.getByRole('region', { name: '配置详情' }).innerText(), /uav103[\s\S]*uav114/);
    await library.getByRole('button', { name: /跨机协同组合/ }).click();
    assert.match(await combined.innerText(), /uav115[\s\S]*uav101、uav102/);
    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = await library.boundingBox();
    assert.ok(mobile.x >= 0 && mobile.width <= 390 && mobile.y >= 0 && mobile.height <= 844, `mobile bounds ${JSON.stringify(mobile)}`);
    await library.getByRole('button', { name: '选择此配置' }).scrollIntoViewIfNeeded();
    assert.equal(await library.getByRole('button', { name: '选择此配置' }).isVisible(), true);
    await page.screenshot({ path: '/tmp/muva-attack-library-mobile.png' });
    await page.keyboard.press('Escape');
    assert.equal(await library.count(), 0);
    assert.equal(await page.getByRole('dialog', { name: '独立任务全屏工作区' }).count(), 1);
    assert.deepEqual(errors, []);
    console.log('Attack library browser flow passed: select, derive, upload, persistence, delete, Escape.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
