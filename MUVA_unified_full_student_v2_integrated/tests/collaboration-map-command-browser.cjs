const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const out = process.env.MUVA_SCREENSHOT_DIR || 'docs/ui-verification/collaboration/map-command-2026-10-31';
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  let accept = true;
  page.on('dialog', d => accept ? d.accept() : d.dismiss());
  const base = process.env.MUVA_TEST_URL || 'http://127.0.0.1:5175';
  let storeUrl;
  const read = () => page.evaluate(async url => { const { useCollaborationStore } = await import(url); const s = useCollaborationStore.getState(); return { mission: s.missionState, running: s.isRunning, paused: s.isPaused, cluster: s.clusterRunning, records: s.records, active: s.activeGroupId, business: s.businessView, selected: s.selectedDrone }; }, storeUrl);
  const shot = name => page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  const nav = name => page.getByRole('navigation', { name: '实验三六步教学流程' }).getByRole('button', { name: new RegExp(name) }).click();
  const business = name => page.getByRole('navigation', { name: '任务业务导航' }).getByRole('button', { name, exact: true }).click();
  const layer = name => page.getByRole('button', { name, exact: true }).click();
  const hideLayer = async () => { if (await page.getByRole('button', { name: '关闭地图图层' }).count()) await page.getByRole('button', { name: '关闭地图图层' }).click(); };
  const hideRail = async () => { const toggle = page.getByRole('button', { name: '独立任务', exact: true }); if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click(); };
  const mapPoint = async (x,y) => { const b = await page.getByTestId('fleet-map').boundingBox(); await page.mouse.click(b.x + b.width*x,b.y + b.height*y); };
  const geometry = async i => {
    await hideLayer(); await hideRail();
    const tool = page.getByLabel('地图编辑工具');
    if (i === 0 || i === 1 || i === 4) { await tool.selectOption('point'); for (const [x,y] of [[.38,.35],[.64,.35],[.64,.64],[.38,.64]]) await mapPoint(x,y); }
    if (i === 2) { await tool.selectOption('point'); await mapPoint(.6,.55); }
    if (i === 3 || i === 4) { await tool.selectOption('start'); await mapPoint(.35,.65); await tool.selectOption('delivery'); await mapPoint(.68,.5); }
    await tool.selectOption('pan');
  };
  const advanceUntil = async predicate => { for (let i=0;i<210;i++) { if (predicate(await read())) return; await page.clock.runFor(1000); } assert.fail('runtime timeout'); };
  const begin = async type => { await page.getByRole('button', {name:`开始${type}`,exact:true}).click(); await page.getByRole('dialog',{name:'当前任务确认'}).waitFor(); assert.equal((await read()).running,false); await page.getByRole('button',{name:'确认并开始当前任务'}).click(); };
  try {
    await page.goto(`${base}/login`);
    await page.evaluate(() => { sessionStorage.setItem('muva-mock-user','signed-in'); sessionStorage.setItem('muva-user-role','student'); });
    await page.goto(`${base}/experiments/collaboration`);
    await page.getByRole('button',{name:/进入教学模拟模式/}).waitFor();
    storeUrl = await page.evaluate(() => performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname === '/src/stores/collaborationStore.ts')?.name);
    assert.ok(storeUrl);
    await page.clock.install(); await page.clock.pauseAt(Date.now()+1000);
    await page.getByRole('button',{name:/进入教学模拟模式/}).click(); await page.getByRole('navigation',{name:'实验三六步教学流程'}).getByRole('button',{name:/集群启动/}).click(); await page.getByRole('button',{name:'启动集群',exact:true}).click(); await page.clock.runFor(2200);
    let state = await read(); assert.equal(state.cluster,true); assert.equal(state.running,false); assert.ok(state.mission.drones.every(d=>!d.assignedTaskId && !d.armed));
    await nav('多任务协同指挥'); await page.getByRole('button',{name:'展开指挥台'}).click();
    await page.getByRole('dialog',{name:'独立任务全屏工作区'}).waitFor();
    await shot('01-global-desktop');
    assert.equal(await page.locator('[data-testid^=marker-uav]').count(),15);
    await page.getByRole('complementary',{name:'五类独立任务入口'}).locator('article').filter({hasText:'区域巡逻'}).getByRole('button',{name:'新建任务',exact:true}).click();
    assert.equal((await read()).running,false); assert.equal((await read()).mission.groups[0].drones.length,0); await shot('01b-map-with-task-layer'); await business('全局态势');
    await layer('无人机资源管理'); await page.keyboard.press('Escape'); assert.ok(await page.getByRole('dialog',{name:'独立任务全屏工作区'}).count()); assert.equal(await page.getByRole('dialog',{name:'无人机资源管理'}).count(),0); await layer('无人机资源管理');
    const resources = page.getByRole('dialog',{name:'无人机资源管理'}); assert.equal(await resources.locator('tbody tr').count(),15);
    const types=['区域巡逻','目标搜索','定点监测','物资运输','应急救援'];
    for (let n=101;n<=103;n++) { const row=resources.locator('tr').filter({hasText:`uav${n}`}); await row.locator('summary').click(); for (const type of types) await page.getByLabel(`uav${n}允许${type}`,{exact:true}).check(); await row.locator('summary').click(); }
    await shot('02-resource-layer'); await page.getByRole('button',{name:'完成配置'}).click();
    const positions=[];
    for(let i=0;i<5;i++) {
      await business(types[i]);
      if (i===0) { await page.getByRole('button',{name:'开始区域巡逻',exact:true}).click(); assert.equal((await read()).running,false); assert.ok(await page.getByRole('alert').count()); }
      await layer('无人机编组');
      await page.getByLabel('选择uav101',{exact:true}).check(); await page.getByLabel('选择uav102',{exact:true}).check();
      if(i===0) { await page.getByLabel('选择uav103',{exact:true}).check(); await page.getByLabel('uav103工作区地图显示').uncheck(); assert.ok((await read()).mission.groups[0].drones.includes('uav103')); await page.getByLabel('uav103工作区地图显示').check(); }
      await geometry(i);
      await layer('任务参数');
      const before = await page.getByTestId('fleet-map').boundingBox();
      if(i===0) await page.getByLabel('巡逻方式').selectOption('顺时针巡逻');
      if(i===1) await page.getByLabel('搜索方式').selectOption('扇形搜索');
      if(i===4) await page.getByLabel('救援策略').selectOption('先侦察后救援');
      if(i===2) await page.getByLabel('停留时间（s）').fill('8');
      if(i===3) await page.getByLabel('交付确认',{exact:true}).selectOption('人工签收');
      await shot(`03-${i+1}-parameters`);
      await page.getByRole('button',{name:'收起图层'}).click();
      const after = await page.getByTestId('fleet-map').boundingBox(); assert.deepEqual(before,after,'map must not resize when layer closes');
      await layer('区域与航点');
      assert.ok(await page.getByLabel('点1-x',{exact:true}).count());
      const old = (await read()).mission.groups[i].points[0].x;
      await page.getByLabel('点1-x',{exact:true}).fill(String(old+1));
      assert.equal((await read()).mission.groups[i].points[0].x,old+1);
      await hideLayer();
      assert.equal((await read()).running,false);
      await begin(types[i]); await page.clock.runFor(3000);
      state=await read(); assert.equal(state.active,`group-${i+1}`); assert.equal(state.mission.groups.filter(g=>g.status==='RUNNING').length,1);
      positions.push(state.mission.drones[0].position);
      await hideLayer(); await shot(`04-${i+1}-execution`);
      if(i===0) {
        await page.getByRole('button',{name:'暂停任务',exact:true}).click(); state=await read(); const frozen=state.mission.groups[0].progress; const pos=state.mission.drones[0].position;
        await page.clock.runFor(3000); assert.equal((await read()).mission.groups[0].progress,frozen); assert.deepEqual((await read()).mission.drones[0].position,pos);
        await page.getByRole('button',{name:'继续任务',exact:true}).click(); await page.clock.runFor(1000);
        await page.getByTestId('marker-uav103').click(); await page.getByRole('region',{name:'uav103操作面板'}).getByRole('button',{name:'单机返航'}).click();
        state=await read(); assert.equal(state.mission.drones[2].instanceStatus,'RETURNING'); assert.equal(state.running,true); await shot('04-single-return');
        await page.clock.runFor(2000);
        await business('目标搜索'); assert.ok(await page.getByRole('button',{name:/返回执行任务/}).count());
        assert.equal((await read()).active,'group-1'); await page.getByRole('button',{name:/返回执行任务/}).click();
      }
      if(i===1) { await page.getByRole('button',{name:'终止任务',exact:true}).click(); }
      if(i===3) { await advanceUntil(s=>s.mission.groups[3].lifecycle==='待结果确认'); await page.getByRole('button',{name:'确认模拟人工签收',exact:true}).click(); }
      await advanceUntil(s=>!s.running);
      state=await read(); assert.equal(state.cluster,true); assert.equal(state.records.at(-1).type,types[i]); assert.equal(state.mission.drones.filter(d=>d.assignedTaskId).length,0);
      await page.getByRole('button',{name:'查看执行结果',exact:true}).click(); await shot(`05-${i+1}-result`); await hideLayer();
      assert.ok(await page.getByRole('button',{name:'返回配置 / 再次执行'}).count());
      if(i===0) { await page.getByRole('button',{name:'返回配置 / 再次执行'}).click(); assert.equal((await read()).mission.groups[0].lifecycle,'配置中'); assert.equal((await read()).running,false); await hideLayer(); }
    }
    assert.equal((await read()).records.length,5);
    await layer('任务记录'); await page.locator('[data-testid^=history-run]').first().click(); await shot('06-history'); await page.getByRole('button',{name:'返回当前任务',exact:true}).first().click();
    assert.equal(new Set(positions.map(p=>JSON.stringify(p))).size,5,'task types follow distinct execution routes');
    await business('全局态势'); await hideRail();
    await page.getByTitle('放大',{exact:true}).click(); await page.getByTitle('缩小',{exact:true}).click(); await page.getByTitle('切换网格',{exact:true}).click(); await page.getByTitle('切换轨迹',{exact:true}).click(); await page.getByTitle('切换轨迹',{exact:true}).click();
    const mb=await page.getByTestId('fleet-map').boundingBox(); await page.mouse.move(mb.x+mb.width*.5,mb.y+mb.height*.65); await page.mouse.down(); await page.mouse.move(mb.x+mb.width*.5+25,mb.y+mb.height*.65+20); await page.mouse.up(); await page.getByTitle('自动适配视野').click();
    await page.getByTestId('marker-uav111').click(); await page.getByRole('region',{name:'uav111操作面板'}).getByRole('button',{name:'遥测详情'}).click(); await page.getByRole('region',{name:'选中无人机实时详情'}).waitFor(); assert.equal((await read()).selected,'uav111'); await shot('07-telemetry'); await hideLayer();
    for(const [w,h] of [[1920,1080],[1366,768],[768,1024],[390,844]]) {
      await page.setViewportSize({width:w,height:h}); await shot(`08-responsive-${w}`);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+2));
      const b=await page.getByTestId('fleet-map').boundingBox(); assert.ok(b.width>=w-5,`full width map ${w}`);
    }
    await business('物资运输'); await layer('无人机编组'); await shot('09-narrow-layer'); await hideLayer();
    await page.getByRole('button',{name:'返回教学页面'}).click();
    assert.equal((await read()).records.length,5);
    await nav('集群状态监控'); await nav('多任务协同指挥'); assert.equal((await read()).records.length,5);
    await page.setViewportSize({width:1600,height:1000}); await shot('10-teaching-workspace');
    assert.deepEqual(errors,[]);
    fs.writeFileSync(`${out}/result.json`,JSON.stringify({passed:true,records:(await read()).records.map(r=>({type:r.type,status:r.evaluation.status,metrics:r.evaluation.groups[0].metrics})),positions,errors},null,2));
    console.log('PASS: five independent tasks, floating layers without resizing map, configuration, resources, geometry, runtime, pause/resume/terminate, single RTL, safe results, history and responsive layouts');
  } catch(e) { await shot('failure'); console.error(errors); throw e; } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
