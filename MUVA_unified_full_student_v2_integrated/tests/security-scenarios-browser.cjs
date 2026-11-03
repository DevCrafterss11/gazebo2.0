const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const out = process.env.MUVA_SCREENSHOT_DIR || 'docs/ui-verification/security-scenarios-2026-11-02';
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    const base = process.env.MUVA_TEST_URL || 'http://127.0.0.1:5173';
    await page.goto(`${base}/login`);
    await page.evaluate(() => { sessionStorage.setItem('muva-mock-user', 'signed-in'); sessionStorage.setItem('muva-user-role', 'student'); });
    await page.goto(`${base}/experiments/security`);
    await page.getByRole('heading', { name: '任务安全攻防实验' }).waitFor();
    await page.screenshot({ path: `${out}/01-introduction.png`, fullPage: true });
    await page.getByRole('link', { name: /简易靶场/ }).click();
    await page.waitForURL('**/experiments/security/range');
    await page.getByRole('heading', { name: '安全攻防对抗' }).waitFor();
    await page.screenshot({ path: `${out}/07-simple-range.png`, fullPage: true });
    await page.getByRole('link', { name: '返回实验四介绍' }).click();
    await page.waitForURL('**/experiments/security');
    await page.getByRole('button', { name: '进入实验' }).click();
    const workspace = page.getByRole('dialog', { name: '任务安全攻防实验工作区' });
    await workspace.waitFor();
    await page.screenshot({ path: `${out}/02-workspace.png`, fullPage: true });
    const checkLayout = async () => {
      const bounds = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        const scene = dialog.querySelector('[role="img"]').getBoundingClientRect();
        const actions = dialog.querySelector('aside[aria-label="实验操作与效果对照"]').getBoundingClientRect();
        return { scroll: document.documentElement.scrollWidth, width: innerWidth, scene: [scene.left, scene.top, scene.right, scene.bottom], actions: [actions.left, actions.top, actions.right] };
      });
      assert.ok(bounds.scroll <= bounds.width + 2, JSON.stringify(bounds));
      assert.ok(bounds.scene[2] > bounds.scene[0] + 300 && bounds.scene[3] > bounds.scene[1] + 200, JSON.stringify(bounds));
      assert.ok(bounds.actions[0] >= bounds.scene[2], JSON.stringify(bounds));
    };
    await checkLayout();
    const names = ['巡逻分区篡改', '虚假目标注入', '监测数据冻结', '交付点替换', '救援优先级欺骗'];
    for (const name of names) {
      await workspace.getByRole('button', { name: new RegExp(name) }).click();
      await workspace.getByRole('heading', { name }).waitFor();
      const status = workspace.locator('[class*="phaseBadge"]');
      assert.equal(await status.innerText(), '正常基线');
      assert.equal(await workspace.getByRole('button', { name: '启用防护复测', exact: true }).isDisabled(), true);
      if (name === '交付点替换') {
        assert.equal(await workspace.locator('[class*="metricRow"]').first().locator('strong').last().innerText(), '3');
        await page.screenshot({ path: `${out}/03-delivery-baseline.png`, fullPage: true });
      }
      await workspace.getByRole('button', { name: '开始攻击', exact: true }).click();
      assert.equal(await status.innerText(), '攻击影响');
      assert.equal(await workspace.getByRole('button', { name: '开始攻击', exact: true }).isDisabled(), true);
      if (name === '交付点替换') {
        assert.ok((await workspace.locator('[role="img"] svg').textContent()).includes('错误交付点 B′'));
        assert.equal(await workspace.locator('[class*="metricRow"]').first().locator('strong').last().innerText(), '2');
        assert.equal(await workspace.locator('[class*="metricRow"]').last().locator('strong').last().innerText(), '420');
        await page.screenshot({ path: `${out}/04-delivery-attacked.png`, fullPage: true });
      }
      await workspace.getByRole('button', { name: '启用防护复测', exact: true }).click();
      assert.equal(await status.innerText(), '防护复测');
      if (name === '交付点替换') {
        assert.ok((await workspace.locator('[role="img"] svg').textContent()).includes('B′ 已拦截'));
        assert.equal(await workspace.locator('[class*="metricRow"]').first().locator('strong').last().innerText(), '3');
        await page.screenshot({ path: `${out}/05-delivery-protected.png`, fullPage: true });
      }
      await workspace.getByRole('button', { name: '恢复正常基线', exact: true }).click();
      assert.equal(await status.innerText(), '正常基线');
    }
    await workspace.getByRole('button', { name: /交付点替换/ }).click();
    await workspace.getByRole('button', { name: '开始攻击', exact: true }).click();
    await workspace.getByRole('button', { name: /巡逻分区篡改/ }).click();
    await workspace.getByRole('button', { name: /交付点替换/ }).click();
    assert.equal(await workspace.locator('[class*="phaseBadge"]').innerText(), '攻击影响', 'scenario phase retained when switching');
    await workspace.getByRole('button', { name: /关键事件/ }).click();
    assert.ok(await workspace.getByText(/交付点签名不匹配/).count());
    await workspace.getByRole('button', { name: '返回实验介绍' }).click();
    await workspace.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '进入实验' }).click();
    assert.equal(await workspace.locator('[class*="phaseBadge"]').innerText(), '攻击影响', 'phase retained on return');
    await page.setViewportSize({ width: 1366, height: 768 });
    await workspace.getByRole('button', { name: /交付点替换/ }).click();
    await checkLayout();
    await page.screenshot({ path: `${out}/06-delivery-1366.png`, fullPage: true });
    await workspace.getByRole('link', { name: '简易靶场' }).click();
    await page.waitForURL('**/experiments/security/range');
    await page.getByRole('heading', { name: '安全攻防对抗' }).waitFor();
    assert.deepEqual(errors, []);
    console.log(`PASS security scenarios: five attack/protect/restore flows, session switching and layouts; screenshots ${out}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
