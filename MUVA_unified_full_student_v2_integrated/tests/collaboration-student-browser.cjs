const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const out = process.env.MUVA_SCREENSHOT_DIR || 'docs/ui-verification/collaboration/student-review-2026-10-31/workflow';
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  let accept = true; page.on('dialog', d => accept ? d.accept() : d.dismiss());
  const base = process.env.MUVA_TEST_URL || 'http://127.0.0.1:5175';
  let storeUrl;
  const read = () => page.evaluate(async url => { const { useCollaborationStore } = await import(url); const s = useCollaborationStore.getState(); return { mission: s.missionState, running: s.isRunning, cluster: s.clusterRunning, records: s.records, nodes: s.communicationNodes, notice: s.notice, selected: s.selectedDrone }; }, storeUrl);
  const shot = name => page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  const button = name => page.getByRole('button', { name, exact: true });
  const nav = name => page.getByRole('navigation', { name: '实验三六步教学流程' }).getByRole('button', { name: new RegExp(name) }).click();
  const business = name => page.getByRole('navigation', { name: '任务业务导航' }).getByRole('button', { name, exact: true }).click();
  const hideLayer = async () => { if (await button('关闭地图图层').count()) await button('关闭地图图层').click(); };
  const hideRail = async () => { if (await button('独立任务').getAttribute('aria-expanded') === 'true') await button('独立任务').click(); };
  const mapPoint = async (x,y) => { const b = await page.getByTestId('fleet-map').boundingBox(); await page.mouse.click(b.x + b.width*x, b.y + b.height*y); };
  const draw = async () => { await button('区域与航点').click(); await button('开始绘制区域').click(); await hideRail(); for (const [x,y] of [[.37,.36],[.67,.36],[.67,.67],[.37,.67]]) await mapPoint(x,y); await button('完成绘制').click(); };
  const advanceUntil = async predicate => { for (let i=0;i<230;i++) { if (predicate(await read())) return; await page.clock.runFor(1000); } assert.fail('runtime timeout'); };
  const launch = async type => { await button(`开始${type}`).click(); assert.equal((await read()).running,false); await button('确认并开始当前任务').click(); };
  const returnDrone = async id => { await hideLayer(); await page.getByTestId(`marker-${id}`).click(); await page.getByRole('region',{name:`${id}操作面板`}).getByRole('button',{name:'单机返航'}).click(); await button('关闭无人机面板').click(); };
  try {
    await page.goto(`${base}/login`); await page.evaluate(() => { sessionStorage.setItem('muva-mock-user','signed-in'); sessionStorage.setItem('muva-user-role','student'); });
    await page.goto(`${base}/experiments/collaboration`); await button('进入教学模拟模式').waitFor();
    storeUrl = await page.evaluate(() => performance.getEntriesByType('resource').map(r=>r.name).find(n=>n.includes('/src/stores/collaborationStore.ts'))); assert.ok(storeUrl);
    await page.clock.install(); await page.clock.pauseAt(Date.now()+1000);
    await button('进入教学模拟模式').click(); await nav('集群启动'); await button('启动集群').click(); await page.clock.runFor(2200);
    let state = await read(); assert.ok(state.cluster); assert.ok(!state.running); assert.ok(state.mission.drones.every(d=>!d.assignedTaskId && !d.armed));
    await nav('通信组网'); assert.equal(state.nodes.length,15); state.nodes.forEach((n,i)=>assert.equal(n.ip,`192.168.10.${101+i}`)); await shot('01-communication');
    await nav('集群状态监控'); await page.getByRole('button',{name:/uav105.*%/}).click(); assert.equal((await read()).selected,'uav105');
    await nav('多任务协同指挥'); await business('区域巡逻');
    for (const [width,height] of [[1600,1000],[1366,768]]) {
      await page.setViewportSize({width,height}); await page.clock.runFor(100);
      const b = await button('开始区域巡逻').boundingBox(); assert.ok(b.y>=0 && b.y+b.height<=height, `start visible at ${width}`);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)); await shot(`02-command-${width}`);
    }
    await page.setViewportSize({width:1600,height:1000});
    await button('开始区域巡逻').click(); await page.getByRole('region',{name:'区域与航点图层'}).waitFor(); assert.ok(!(await read()).running);
    await button('开始绘制区域').click(); await hideRail(); for (const [x,y] of [[.37,.36],[.67,.36],[.67,.67],[.37,.67]]) await mapPoint(x,y); await button('完成绘制').click();
    await button('无人机编组 (0)').click(); assert.ok(await page.getByLabel('选择uav101',{exact:true}).isDisabled());
    await button('为可用无人机开放本任务资格').click(); assert.equal((await read()).mission.groups[0].drones.length,0);
    for (const id of ['uav101','uav102','uav103']) await page.getByLabel(`选择${id}`,{exact:true}).check();
    await page.getByLabel('uav103任务角色').selectOption('侦察机'); await page.getByLabel('uav103工作区地图显示').uncheck();
    assert.ok((await read()).mission.groups[0].drones.includes('uav103')); assert.equal(await page.getByTestId('marker-uav103').count(),0); await page.getByLabel('uav103工作区地图显示').check();
    await shot('03-qualification-members'); await hideLayer();
    await button('开始区域巡逻').click(); await button('继续配置').click(); assert.equal((await read()).mission.groups[0].lifecycle,'配置中'); assert.ok(!(await read()).running);
    await launch('区域巡逻'); await page.clock.runFor(4000); state=await read(); assert.equal(state.mission.drones.filter(d=>d.assignedTaskId).length,3); assert.ok(state.mission.groups.slice(1).every(g=>g.lifecycle==='配置中'));
    await business('目标搜索'); await page.getByRole('button',{name:/返回执行任务/}).click(); await page.getByRole('region',{name:'执行事件图层'}).waitFor();
    await button('暂停任务').click(); const progress=(await read()).mission.groups[0].progress; await page.clock.runFor(4000); assert.equal((await read()).mission.groups[0].progress,progress);
    await returnDrone('uav103'); await page.clock.runFor(24000); state=await read(); assert.equal(state.mission.drones[2].instanceStatus,'STANDBY'); assert.equal(state.mission.groups[0].progress,progress); assert.ok(state.running); assert.equal(await page.getByTestId('trace-uav103').count(),1);
    await shot('04-return-trace-paused'); await button('继续任务').click(); await advanceUntil(s=>!s.running);
    state=await read(); assert.equal(state.records.length,1); assert.ok(state.cluster); const patrolRecord=state.records[0];
    await business('区域巡逻'); await page.getByRole('region',{name:'执行结果图层'}).waitFor(); await shot('05-result');
    await button('任务记录').click(); await page.getByTestId(`history-${patrolRecord.id}`).click(); await button('实时遥测').click(); await page.getByRole('region',{name:'历史无人机详情'}).waitFor(); assert.equal(await button('单机模拟返航').count(),0); await shot('06-historical-telemetry');
    await button('返回当前任务').first().click(); await button('返回配置 / 再次执行').click(); assert.ok(!(await read()).running); assert.equal((await read()).records.length,1); assert.equal((await read()).mission.groups[0].drones.length,3);
    await business('目标搜索'); await button('选择无人机').click(); await button('为可用无人机开放本任务资格').click(); for (const id of ['uav101','uav102']) await page.getByLabel(`选择${id}`,{exact:true}).check(); await hideLayer();
    await draw(); await launch('目标搜索'); await page.clock.runFor(3000); await returnDrone('uav102'); assert.equal((await read()).mission.groups[1].lifecycle,'异常');
    await button('确认降级继续').click(); assert.match((await read()).notice,/至少需要 2 架/); await shot('07-insufficient-resources');
    await button('终止任务').click(); await advanceUntil(s=>!s.running); assert.equal((await read()).records.length,2); assert.ok((await read()).cluster);
    await nav('实验评价'); await shot('08-evaluation'); await nav('多任务协同指挥');
    for (const [width,height] of [[768,1024],[390,844]]) { await page.setViewportSize({width,height}); await page.clock.runFor(100); await business('区域巡逻'); await shot(`09-narrow-${width}`); assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)); await button('开始区域巡逻').scrollIntoViewIfNeeded(); assert.ok(await button('开始区域巡逻').isVisible()); const action = await button('开始区域巡逻').boundingBox(); assert.ok(action.y >= 0 && action.y+action.height<=height); await shot(`10-narrow-operations-${width}`); }
    await page.setViewportSize({width:1600,height:1000}); await nav('集群启动'); accept=false; await button('停止集群').click(); assert.ok((await read()).cluster); accept=true; await button('停止集群').click(); await page.clock.runFor(1000); assert.ok(!(await read()).cluster);
    assert.deepEqual(errors,[]); fs.writeFileSync(`${out}/result.json`, JSON.stringify({passed:true,checks:['six-step navigation','15 unassigned standby resources','contextual eligibility','map drawing','role and visibility separation','explicit start cancellation','pause/resume','individual RTL trace retention','history read-only telemetry','minimum-resource anomaly','safe termination','desktop controls visible','narrow overflow','stop confirmation'],errors},null,2));
    console.log('PASS: student workflow, contextual guidance, lifecycle guards, retained traces, historical telemetry, desktop and narrow layouts');
  } catch(e) { await shot('failure'); throw e; } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
