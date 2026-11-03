const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = process.env.MUVA_TEST_URL || 'http://127.0.0.1:5188';
  const enter = async () => {
    await page.goto(`${base}/experiments/collaboration`);
    await page.getByRole('button', { name: /进入教学模拟模式/ }).click();
    const navigation = page.getByRole('navigation', { name: '实验三六步教学流程' });
    await navigation.getByRole('button', { name: /集群启动/ }).click();
    await page.getByRole('button', { name: '启动集群', exact: true }).click();
    await navigation.getByRole('button', { name: /多任务协同指挥/ }).click();
    await page.getByRole('button', { name: '展开指挥台' }).click();
    const station = page.getByRole('dialog', { name: '独立任务全屏工作区' });
    await station.getByRole('button', { name: '安全攻防演练' }).click();
    return station.getByRole('region', { name: '安全攻防控制面板' });
  };
  try {
    await page.goto(`${base}/login`);
    await page.getByRole('button', { name: '登录学生端' }).click();
    await page.waitForURL('**/dashboard');
    let panel = await enter();
    const config = page.getByRole('dialog', { name: 'GPS 欺骗配置', exact: true });
    const targets = () => config.getByRole('region', { name: '单项演示目标无人机' });
    assert.equal(await panel.getByRole('checkbox').count(), 0);
    assert.equal(await panel.getByRole('button', { name: /^(轻微|中等|严重)$/ }).count(), 0);
    await panel.getByRole('button', { name: /GPS欺骗/ }).click();
    assert.equal(await targets().getByRole('button', { name: /^选择任务 / }).count(), 5);
    assert.match(await targets().innerText(), /尚未编组/);
    assert.equal(await targets().getByRole('checkbox').count(), 0);

    await config.getByRole('button', { name: '取消', exact: true }).click();
    await page.evaluate(() => {
      const account = sessionStorage.getItem('muva-username') ?? 'student01';
      const groups = [
        ['uav101', 'uav102', 'uav103'], ['uav104', 'uav105', 'uav113'],
        ['uav106', 'uav107', 'uav108'], ['uav110', 'uav111', 'uav114'],
        ['uav112', 'uav109', 'uav115'],
      ];
      localStorage.setItem(`muva:collaboration:preferences:v2:account:${encodeURIComponent(account)}`, JSON.stringify({
        version: 2, arrayLayout: { centerX: 0, centerY: 0, columnSpacing: 5, rowSpacing: 5, altitude: 0 }, resources: [],
        groups: groups.map((drones, i) => ({ id: `group-${i + 1}`, drones, roles: {}, mode: 'SYNC' })),
      }));
    });
    panel = await enter();
    await panel.getByRole('button', { name: /GPS欺骗/ }).click();
    const taskTypes = ['区域巡逻', '目标搜索', '定点监测', '物资运输', '应急救援'];
    const chosen = ['uav101', 'uav113', 'uav108', 'uav110', 'uav115'];
    for (let i = 0; i < taskTypes.length; i++) {
      await targets().getByRole('button', { name: `选择任务 ${taskTypes[i]}` }).click();
      assert.equal(await targets().getByRole('checkbox').count(), 3, `${taskTypes[i]} should show its three members`);
      await targets().getByRole('checkbox', { name: `攻击目标 ${chosen[i]}` }).check();
      assert.equal(await targets().getByRole('checkbox', { name: `攻击目标 ${chosen[i]}` }).isChecked(), true);
    }
    assert.match(await targets().innerText(), /已选攻击目标：uav101、uav113、uav108、uav110、uav115/);
    await targets().getByRole('button', { name: '选择任务 区域巡逻' }).click();
    assert.equal(await targets().getByRole('checkbox', { name: '攻击目标 uav101' }).isChecked(), true);
    await targets().getByRole('checkbox', { name: '攻击目标 uav102' }).check();
    assert.match(await targets().innerText(), /已选攻击目标：uav101、uav113、uav108、uav110、uav115、uav102/);
    await config.getByLabel('场景强度', { exact: true }).selectOption('high');
    await config.getByLabel('东向偏移 (m)', { exact: true }).fill('30');
    await config.getByRole('button', { name: '复制当前参数到全部已选' }).click();
    await config.getByLabel('编辑无人机', { exact: true }).selectOption('uav113');
    assert.equal(await config.getByLabel('东向偏移 (m)', { exact: true }).inputValue(), '30');
    await config.getByLabel('东向偏移 (m)', { exact: true }).fill('-45');
    await config.getByLabel('场景强度', { exact: true }).selectOption('low');
    await config.getByLabel('启动延迟 (s)', { exact: true }).fill('4');
    // A hidden target's invalid parameter must select that target and block saving.
    await config.getByLabel('持续时间 (s)', { exact: true }).fill('0');
    await config.getByLabel('编辑无人机', { exact: true }).selectOption('uav101');
    assert.equal(await config.getByLabel('东向偏移 (m)', { exact: true }).inputValue(), '30');
    await config.getByRole('button', { name: '保存配置', exact: true }).click();
    assert.equal(await config.getByLabel('编辑无人机', { exact: true }).inputValue(), 'uav113');
    await config.getByLabel('持续时间 (s)', { exact: true }).fill('20');
    await config.getByLabel('编辑无人机', { exact: true }).selectOption('uav101');
    await config.getByRole('button', { name: '保存配置', exact: true }).click();
    assert.match(await panel.getByRole('region', { name: '基础攻击配置摘要' }).innerText(), /uav101、uav113、uav108、uav110、uav115、uav102[\s\S]*uav101 · 严重/);
    assert.equal(await panel.getByRole('checkbox').count(), 0);
    assert.equal(await panel.getByRole('button', { name: '启动 GPS 欺骗' }).isDisabled(), false);
    await page.screenshot({ path: '/tmp/muva-attack-panel-summary.png' });
    await panel.getByRole('button', { name: /GPS欺骗/ }).click();
    assert.equal(await config.getByLabel('场景强度', { exact: true }).inputValue(), 'high');
    assert.equal(await targets().getByRole('checkbox', { name: '攻击目标 uav101' }).isChecked(), true);
    await config.getByLabel('编辑无人机', { exact: true }).selectOption('uav113');
    assert.equal(await config.getByLabel('东向偏移 (m)', { exact: true }).inputValue(), '-45');
    assert.equal(await config.getByLabel('场景强度', { exact: true }).inputValue(), 'low');
    assert.equal(await config.getByLabel('启动延迟 (s)', { exact: true }).inputValue(), '4');
    assert.equal(await config.getByLabel('持续时间 (s)', { exact: true }).inputValue(), '20');
    await config.getByRole('button', { name: /位置与轨迹/ }).click();
    await page.screenshot({ path: '/tmp/muva-perdrone-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: '/tmp/muva-perdrone-mobile.png' });
    await targets().getByRole('button', { name: '选择任务 应急救援' }).click();
    await targets().getByRole('checkbox', { name: '攻击目标 uav115' }).scrollIntoViewIfNeeded();
    assert.equal(await targets().getByRole('checkbox', { name: '攻击目标 uav115' }).isVisible(), true);
    assert.deepEqual(errors, []);
    console.log('Attack targets browser flow passed: no duplicate panel controls; dialog targets and severity; saved summary; five task groups and persistence.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
