const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const out = process.env.MUVA_SCREENSHOT_DIR || 'docs/ui-verification/collaboration/live-reference-2026-10-31';
fs.mkdirSync(out, {recursive:true});
(async () => {
  const browser = await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
  const page = await browser.newPage({viewport:{width:1600,height:1000}});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error') errors.push(m.text());});
  let accept=true; page.on('dialog',d=>accept?d.accept():d.dismiss());
  const button = name=>page.getByRole('button',{name,exact:true});
  const view=page.getByRole('dialog',{name:'集群实时指挥视图',exact:true});
  const nav=name=>page.getByRole('navigation',{name:'实验三六步教学流程'}).getByRole('button',{name:new RegExp(name)}).click();
  const business=name=>page.getByRole('navigation',{name:'任务业务导航'}).getByRole('button',{name,exact:true}).click();
  const shot=name=>page.screenshot({path:`${out}/${name}.png`,fullPage:true});
  let storeUrl;
  const read=()=>page.evaluate(async url=>{const {useCollaborationStore}=await import(url);const s=useCollaborationStore.getState();return {mission:s.missionState,selected:s.selectedDrone,running:s.isRunning,paused:s.isPaused,cluster:s.clusterRunning,step:s.currentStep,records:s.records,nodes:s.communicationNodes};},storeUrl);
  const until=async predicate=>{for(let i=0;i<220;i++){if(predicate(await read())) return;await page.clock.runFor(1000);}assert.fail('runtime timeout');};
  const open=async()=>{await button('集群实时视图').click();await view.waitFor();};
  const close=async()=>{await view.getByRole('button',{name:'返回任务工作区',exact:true}).click();await page.clock.runFor(20);};
  const fit=()=>view.getByTitle('自动适配视野',{exact:true}).click();
  const mapTransform=()=>view.getByTestId('marker-uav101').evaluate(el=>`${el.style.left};${el.style.top}`);
  try {
    const base=process.env.MUVA_TEST_URL||'http://127.0.0.1:5175';
    await page.goto(`${base}/login`);await page.evaluate(()=>{sessionStorage.setItem('muva-mock-user','signed-in');sessionStorage.setItem('muva-user-role','student');});
    await page.goto(`${base}/experiments/collaboration`);await button('进入教学模拟模式').waitFor();
    storeUrl=await page.evaluate(()=>performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/stores/collaborationStore.ts')?.name);assert.ok(storeUrl);
    await page.clock.install();await page.clock.pauseAt(Date.now()+1000);
    await button('进入教学模拟模式').click();await nav('集群启动');await button('启动集群').click();await page.clock.runFor(2200);await nav('多任务协同指挥');
    // Step 5 is the teaching entry; live view belongs to the independent ground station.
    await button('展开指挥台').click();
    await open();let state=await read();assert.equal(state.mission.drones.length,15);assert.equal(state.nodes.length,15);assert.ok(state.mission.drones.every(d=>!d.armed&&!d.assignedTaskId&&d.instanceStatus==='STANDBY'));assert.equal(state.running,false);
    assert.equal(await view.getByRole('navigation',{name:'任务业务导航'}).count(),0);assert.equal(await view.getByRole('navigation',{name:'地图导航工具'}).count(),1);assert.equal(await view.getByRole('complementary',{name:'五类独立任务入口'}).count(),0);
    assert.equal(await view.locator('[data-testid^="telemetry-uav"]').count(),15);assert.equal(await view.locator('[data-testid^="marker-uav"]').count(),15);
    await view.locator('summary').filter({hasText:'扩展飞控指令'}).click();
    for(const label of ['解锁','锁定','起飞','前进','左转']) assert.ok(await view.getByRole('button',{name:label,exact:true}).isDisabled());
    assert.ok(await view.getByRole('button',{name:'返航',exact:true}).isDisabled());
    const before=state.mission.drones[0];await page.clock.runFor(3000);state=await read();assert.ok(state.mission.drones[0].updatedAt>before.updatedAt);assert.deepEqual(state.mission.drones[0].position,before.position);
    await view.getByRole('button',{name:'定位遥测uav115'}).click();assert.equal((await read()).selected,'uav115');
    await fit();await view.getByTestId('marker-uav103').click();assert.equal((await read()).selected,'uav103');await view.getByRole('button',{name:'关闭无人机面板'}).click();
    await view.getByRole('button',{name:'定位选中机'}).click();await fit();
    const initial=await mapTransform();await view.getByTitle('放大',{exact:true}).click();await page.clock.runFor(600);assert.notEqual(await mapTransform(),initial);await fit();
    const map=await view.getByTestId('fleet-map').boundingBox();await page.mouse.move(map.x+130,map.y+150);await page.mouse.down();await page.mouse.move(map.x+180,map.y+180,{steps:4});await page.mouse.up();assert.notEqual(await mapTransform(),initial);await view.getByRole('button',{name:'定位遥测uav103'}).click();assert.equal((await read()).selected,'uav103');assert.notEqual(await mapTransform(),initial);await fit();
    await view.getByTitle('地图工具',{exact:true}).click();
    for(const title of ['切换网格','切换轨迹']){const toggle=view.getByTitle(title,{exact:true});const was=await toggle.getAttribute('aria-pressed');await toggle.click();assert.notEqual(await toggle.getAttribute('aria-pressed'),was);await toggle.click();}
    await view.getByRole('button',{name:'关闭地图管理面板'}).click();
    await view.getByRole('button',{name:'飞行操作',exact:true}).click();
    await view.getByRole('button',{name:'无人机资源管理',exact:true}).click();const resources=page.getByRole('dialog',{name:'无人机资源管理',exact:true});await resources.waitFor();assert.equal(await resources.locator('tbody tr').count(),15);await resources.getByRole('button',{name:'定位 / 详情',exact:true}).nth(7).click();assert.equal((await read()).selected,'uav108');assert.equal((await read()).step,4);assert.ok(await view.isVisible());
    await fit();await shot('01-desktop-standby-1600');
    const panel=await view.getByRole('complementary',{name:'飞行操作面板'}).boundingBox();for(let i=101;i<=115;i++){const pin=await view.getByTestId(`marker-uav${i}`).boundingBox();assert.ok(pin.x>=map.x&&pin.x+pin.width<panel.x,`uav${i} unobscured`);}
    await view.getByRole('button',{name:'收起操作',exact:true}).click();assert.equal(await view.getByRole('complementary',{name:'飞行操作面板'}).count(),0);await shot('02-full-map');await view.getByRole('button',{name:'飞行操作',exact:true}).click();
    await view.getByRole('button',{name:'无人机资源管理',exact:true}).click();await page.keyboard.press('Escape');assert.ok(await view.isVisible());assert.equal(await resources.count(),0);
    await close();assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'集群实时视图');
    // Configure and explicitly start outside the telemetry view.
    await business('区域巡逻');await button('选择无人机').click();await button('为可用无人机开放本任务资格').click();for(const id of ['uav101','uav102','uav103'])await page.getByLabel(`选择${id}`,{exact:true}).check();await button('关闭地图图层').click();
    const rail=page.getByRole('button',{name:/收起任务面板|展开任务面板/});if(await rail.getAttribute('aria-expanded')==='true')await rail.click();await page.getByLabel('地图编辑工具').selectOption('point');
    const workMap=await page.getByTestId('fleet-map').boundingBox();for(const [x,y]of [[.35,.35],[.65,.35],[.65,.65],[.35,.65]])await page.mouse.click(workMap.x+workMap.width*x,workMap.y+workMap.height*y);await page.getByLabel('地图编辑工具').selectOption('pan');
    await button('开始区域巡逻').click();assert.equal((await read()).running,false);await button('确认并开始当前任务').click();await page.clock.runFor(3000);await open();await fit();
    await view.getByRole('button',{name:'暂停',exact:true}).click();state=await read();const paused=state.mission.groups[0].progress;const locations=state.mission.drones.map(d=>d.position);await page.clock.runFor(3000);assert.equal((await read()).mission.groups[0].progress,paused);assert.deepEqual((await read()).mission.drones.map(d=>d.position),locations);
    await view.getByRole('button',{name:'定位遥测uav103'}).click();accept=false;await view.getByRole('button',{name:'返航',exact:true}).click();assert.equal((await read()).mission.drones[2].instanceStatus,'FLYING');accept=true;await view.getByRole('button',{name:'返航',exact:true}).click();assert.equal((await read()).mission.drones[2].instanceStatus,'RETURNING');await page.clock.runFor(3000);assert.equal((await read()).mission.groups[0].progress,paused);assert.ok((await read()).mission.drones[2].returnTrajectory.length>1);assert.ok((await read()).running);await shot('03-independent-return-paused');
    await view.getByRole('button',{name:'继续',exact:true}).click();assert.equal((await read()).paused,false);await until(s=>s.mission.groups[0].progress>paused);await shot('04-executing');
    await close();assert.ok((await read()).running);await page.clock.runFor(1000);await open();assert.ok((await read()).running);
    accept=false;await view.getByRole('button',{name:'终止并返航',exact:true}).click();assert.equal((await read()).mission.groups[0].lifecycle,'执行中');accept=true;await view.getByRole('button',{name:'终止并返航',exact:true}).click();await until(s=>!s.running);state=await read();assert.ok(state.cluster);assert.equal(state.records.length,1);assert.equal(state.records[0].group.lifecycle,'已终止');assert.notEqual(await view.getByLabel('实时视图计划航点').inputValue(),'暂无执行航线');assert.ok(await view.getByTestId('trace-uav103').count());await fit();await shot('05-retained-flight');
    for(const [width,height]of [[2048,1152],[1366,768],[768,1024],[390,844]]){await page.setViewportSize({width,height});await page.clock.runFor(100);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));if(width<=900){assert.equal(await view.getByRole('complementary',{name:'飞行操作面板'}).count(),0);await view.getByRole('button',{name:'飞行操作',exact:true}).click();await shot(`06-controls-${width}`);await view.getByRole('button',{name:'收起操作',exact:true}).click();}await fit();await shot(`07-map-${width}`);assert.equal(await view.locator('[data-testid^="marker-uav"]').count(),15);const symbol=await view.getByTestId('marker-uav101').locator('svg').evaluate(el=>{const style=getComputedStyle(el);return {width:parseFloat(style.width),height:parseFloat(style.height),stroke:style.stroke};});assert.equal(symbol.width,30,'quadrotor keeps its layout size independently of heading rotation');assert.equal(symbol.height,30);assert.notEqual(symbol.stroke,'none','quadrotor outline remains visible after flight');}
    await page.keyboard.press('Escape');assert.equal(await view.count(),0);assert.ok((await read()).cluster);assert.equal((await read()).step,4);assert.deepEqual(errors,[]);
    fs.writeFileSync(`${out}/result.json`,JSON.stringify({passed:true,checks:['reference layout without task navigation','15 linked live telemetry cards and markers','heartbeat without automatic task start','resource inspection stays in view','unobscured 3x5 array','pan zoom fit grid trails','nested modal Escape','pause resume','confirmed independent RTL','termination safe cleanup','retained plan and tracks','close/reopen state and focus','2048 1366 768 390 layouts'],errors},null,2));console.log('PASS: reference realtime view, telemetry, controls, independent RTL, retained routes, desktop and narrow layouts');
  } catch(e){await shot('failure');throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
