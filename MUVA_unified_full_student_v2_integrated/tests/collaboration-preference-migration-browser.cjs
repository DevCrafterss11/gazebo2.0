/* Existing unscoped student configuration must survive account isolation, without leaking to teachers. */
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const base = process.env.MUVA_TEST_URL || 'http://127.0.0.1:5173';
  const oldKey = 'muva:collaboration:preferences:v2';
  const scoped = `${oldKey}:account:student01`;
  const configure = async (role, username) => {
    await page.evaluate(({ role, username }) => {
      sessionStorage.setItem('muva-mock-user', 'signed-in');
      sessionStorage.setItem('muva-user-role', role);
      sessionStorage.setItem('muva-username', username);
    }, { role, username });
    await page.goto(`${base}/experiments/collaboration`);
    const url = await page.evaluate(() => performance.getEntriesByType('resource').find(e => new URL(e.name).pathname === '/src/stores/collaborationStore.ts')?.name);
    assert.ok(url);
    return page.evaluate(async url => (await import(url)).useCollaborationStore.getState().arrayLayout.centerX, url);
  };
  try {
    await page.goto(`${base}/login`);
    await page.evaluate(oldKey => localStorage.setItem(oldKey, JSON.stringify({
      version: 2, arrayLayout: { centerX: 137, centerY: 0, columnSpacing: 5, rowSpacing: 5, altitude: 0 },
      resources: [], groups: [],
    })), oldKey);
    assert.equal(await configure('teacher', 'teacher01'), 0);
    assert.equal(await page.evaluate(key => localStorage.getItem(key) !== null, oldKey), true, 'teacher cannot claim legacy student data');
    assert.equal(await configure('student', 'student01'), 137, 'student configuration restored');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), oldKey), null);
    assert.equal(await page.evaluate(key => localStorage.getItem(key) !== null, scoped), true);
    await page.reload();
    const url = await page.evaluate(() => performance.getEntriesByType('resource').find(e => new URL(e.name).pathname === '/src/stores/collaborationStore.ts')?.name);
    assert.equal(await page.evaluate(async url => (await import(url)).useCollaborationStore.getState().arrayLayout.centerX, url), 137);
    // v1 configurations must be upgraded to v2 without losing the old data before a successful save.
    const legacy = await browser.newPage();
    try {
      await legacy.goto(`${base}/login`);
      await legacy.evaluate(() => {
        sessionStorage.setItem('muva-mock-user', 'signed-in');
        sessionStorage.setItem('muva-user-role', 'student');
        sessionStorage.setItem('muva-username', 'student01');
        localStorage.setItem('muva:collaboration:preferences:v1', JSON.stringify({
          version: 1, arrayLayout: { centerX: 88, centerY: 0, columnSpacing: 5, rowSpacing: 5, altitude: 0 },
          resources: [], groups: [],
        }));
      });
      await legacy.goto(`${base}/experiments/collaboration`);
      const legacyUrl = await legacy.evaluate(() => performance.getEntriesByType('resource').find(e => new URL(e.name).pathname === '/src/stores/collaborationStore.ts')?.name);
      assert.equal(await legacy.evaluate(async url => (await import(url)).useCollaborationStore.getState().arrayLayout.centerX, legacyUrl), 88);
      assert.equal(await legacy.evaluate(() => localStorage.getItem('muva:collaboration:preferences:v1')), null);
      assert.equal(await legacy.evaluate(() => localStorage.getItem('muva:collaboration:preferences:v2:account:student01') !== null), true);
    } finally { await legacy.close(); }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, legacyMigrated: true, v1Migrated: true, teacherIsolated: true, reloadPreserved: true }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
