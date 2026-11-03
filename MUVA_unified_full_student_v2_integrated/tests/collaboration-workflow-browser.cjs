/* Browser acceptance uses UI for edits/deployment; store import is read-only verification. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_CORE_PATH||'playwright-core');
const out=process.env.MUVA_SCREENSHOT_DIR||'docs/ui-verification/collaboration/task-workflows-2026-10-31';
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:2048,height:1152}});
 const exceptions=[],consoleErrors=[],networkFailures=[],checks=[];
 page.on('pageerror',e=>exceptions.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())});
 page.on('requestfailed',r=>networkFailures.push({url:r.url(),error:r.failure()?.errorText}));page.on('dialog',d=>d.accept());
 let storeUrl;const base=process.env.MUVA_TEST_URL||'http://127.0.0.1:5175';
 const view=page.getByRole('dialog',{name:'独立任务全屏工作区',exact:true});
 const read=()=>page.evaluate(async url=>{const s=(await import(url)).useCollaborationStore.getState();return {mission:s.missionState,running:s.isRunning,records:s.records,notice:s.notice};},storeUrl);
 const shot=name=>page.screenshot({path:`${out}/${name}.png`,fullPage:true});
 const nav=name=>view.getByRole('navigation',{name:'任务业务导航'}).getByRole('button',{name,exact:true});
 const toolbar=name=>view.getByRole('button',{name,exact:true});
 async function layout(label){
  const measured=await view.evaluate(d=>{const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};return {page:document.documentElement.scrollWidth,window:innerWidth,cards:[...d.querySelectorAll('[data-task-card]')].map(box),left:box(d.querySelector('[data-map-obstruction=left]')),dock:box(d.querySelector('footer[data-task-phase]')),map:box(d.querySelector('[data-testid=fleet-map]'))};});
  assert.ok(measured.page<=measured.window+1,`${label}: page overflow`);assert.equal(measured.cards.length,5);
  assert.ok(measured.cards.every(r=>r.y>=0&&r.bottom<measured.left.bottom),`${label}: all five cards visible`);
  assert.ok(measured.dock.x>=measured.left.right+4,`${label}: centered dock never squeezes task list`);
  assert.ok(measured.map.width>measured.window-50,`${label}: overlays do not shrink map`);
  checks.push({label,layout:measured});
 }
 async function example(index,scenario='success'){
  const names=['区域巡逻','目标搜索','定点监测','物资运输','应急救援'];await nav(names[index]).click();
  if((await read()).mission.groups[index].runId)await toolbar('返回配置 / 再次执行').click();
  if(!await view.locator('[data-mission-workflow]').count())await toolbar('任务参数').click();const summary=view.locator('summary').filter({hasText:'模拟演练与验收场景'});if(!await summary.evaluate(e=>e.parentElement.open))await summary.click();
  await toolbar('载入本任务模拟示例').click();await view.getByLabel('模拟验收场景',{exact:true}).selectOption(scenario);
 }
 async function generate(index){
  await toolbar(['生成巡逻航线','生成搜索航线','生成接力方案','生成运输航线','生成救援航线'][index]).click();
  const planned=(await read()).mission.groups[index].plan;
  assert.ok(planned,(await read()).notice);assert.equal(await view.locator('[data-planned-route]').count(),(await read()).mission.groups[index].drones.length);
  if(index<2){assert.equal(planned.regions.length,planned.routes.length);assert.equal(await view.locator('[data-coverage-region]').count(),planned.regions.length);assert.deepEqual(new Set(planned.regions.map(r=>r.droneId)),new Set(planned.routes.map(r=>r.droneId)));assert.ok(planned.regions.every(r=>r.area>0&&r.polygon.length>=3));assert.equal(await view.locator('[data-generated-waypoint]').count(),planned.routes.reduce((sum,r)=>sum+r.waypoints.length-r.workStart,0));}
  const panel=view.getByRole('region',{name:'任务参数图层',exact:true});
  assert.ok((await panel.textContent()).includes('· 已规划'),'overlay status agrees with generated plan');
  assert.equal(await panel.locator('[data-mission-workflow]').evaluate(e=>e.parentElement.scrollTop),0,'new plan starts at top of workflow, not previous scroll offset');
 }
 async function deploy(index,fail=false){
  await toolbar('检查并部署').click();const dialog=page.getByRole('dialog',{name:'当前任务确认',exact:true});await dialog.waitFor();
  assert.equal(await dialog.locator('tbody tr').count(),3);assert.equal((await read()).running,false);
  await dialog.getByRole('button',{name:'下发模拟航线',exact:true}).click();
  if(fail){assert.equal((await read()).mission.groups[index].plan.stage,'planned');assert.ok((await read()).mission.drones.every(d=>!d.armed));await shot('10-upload-rejected');await dialog.getByRole('button',{name:'取消部署 / 返回配置',exact:true}).click();return;}
  assert.equal((await read()).mission.groups[index].plan.stage,'uploaded');assert.ok((await read()).mission.drones.every(d=>!d.armed));
  await dialog.getByRole('button',{name:'模拟解锁',exact:true}).click();assert.equal((await read()).running,false);
  if(index===0)await shot('03-staged-deployment');
  if(await dialog.getByRole('checkbox').count()){assert.equal(await dialog.getByRole('button',{name:'确认模拟起飞',exact:true}).isEnabled(),false);await dialog.getByRole('checkbox').check();}
  await dialog.getByRole('button',{name:'确认模拟起飞',exact:true}).click();assert.equal((await read()).running,true);
 }
 async function complete(index,outcome='success'){
  let recon=false,manual=false,relayCaptured=false;
  for(let n=0;n<100&&(await read()).running;n++){
   const g=(await read()).mission.groups[index];
   if(index===2&&outcome==='success'&&!relayCaptured&&g.execution.aircraft.some(a=>a.phase==='working')){
    relayCaptured=true;await toolbar('任务参数').click();
    await view.getByRole('heading',{name:/接力队列/}).scrollIntoViewIfNeeded();await shot('06a-monitor-running-queue-2048');
    await page.setViewportSize({width:1366,height:768});await view.getByRole('heading',{name:/接力队列/}).scrollIntoViewIfNeeded();await layout('monitor-running-1366');await shot('06b-monitor-running-queue-1366');await page.setViewportSize({width:2048,height:1152});
   }
   if(g.lifecycle==='待结果确认'){
    if(g.execution.awaiting==='recon'){recon=true;assert.ok(g.plan.routes.filter(r=>r.dependsOn).every(r=>g.execution.aircraft.find(a=>a.droneId===r.droneId).launchedAt===undefined));await shot('08-rescue-recon-gate');await toolbar('通过模拟侦察确认').click();}
    else{manual=true;await toolbar(index===3?'确认模拟交付':index===1?'通过搜索结果复核':'确认模拟处置结果').click();}
   }
   await page.clock.runFor(5000);
  }
  const state=await read(),record=state.records.at(-1);assert.equal(state.running,false);assert.equal(record.group.outcome,outcome,record.group.failureReason);assert.ok(state.mission.drones.every(d=>!d.armed&&!d.assignedTaskId));
  assert.ok(record.group.execution.aircraft.every(a=>a.phase==='done'));
  checks.push({task:record.type,outcome,manual,recon,metrics:record.evaluation.groups[0].metrics});return record;
 }
 try{
  await page.goto(`${base}/login`);await page.evaluate(()=>{sessionStorage.setItem('muva-mock-user','signed-in');sessionStorage.setItem('muva-user-role','student')});await page.goto(`${base}/experiments/collaboration`);
  await page.getByRole('button',{name:/进入教学模拟模式/}).waitFor();storeUrl=await page.evaluate(()=>performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/stores/collaborationStore.ts')?.name);assert.ok(storeUrl);await page.clock.install();
  await page.getByRole('button',{name:/进入教学模拟模式/}).click();await page.getByRole('navigation',{name:'实验三六步教学流程'}).getByRole('button',{name:/集群启动/}).click();await page.getByRole('button',{name:'启动集群',exact:true}).click();await page.waitForTimeout(2400);
  await page.getByRole('navigation',{name:'实验三六步教学流程'}).getByRole('button',{name:/多任务协同指挥/}).click();await page.getByRole('button',{name:'展开指挥台'}).click();await view.waitFor();
  await page.waitForFunction(()=>document.querySelector('[data-testid=satellite-basemap]')?.getAttribute('data-status')==='ready',{},{timeout:30000});
  await page.clock.pauseAt(new Date(Date.now()+1000));
  await toolbar('无人机资源管理').click();const resources=page.getByRole('dialog',{name:'无人机资源管理',exact:true});assert.ok((await resources.textContent()).includes('共 15 架'));await resources.getByRole('button',{name:'完成配置'}).click();
  await example(0);await toolbar('区域与航点').click();await toolbar('清除区域').click();await toolbar('开始绘制区域').click();
  const map=await view.getByTestId('fleet-map').boundingBox();
  for(const [x,y]of [[.33,.34],[.65,.34],[.65,.68],[.33,.68]])await page.mouse.click(map.x+map.width*x,map.y+map.height*y);
  assert.equal((await read()).mission.groups[0].points.length,4);
  const vertex=view.getByRole('button',{name:'地图顶点1',exact:true});const before=(await read()).mission.groups[0].points[0];const vb=await vertex.boundingBox();await page.mouse.move(vb.x+vb.width/2,vb.y+vb.height/2);await page.mouse.down();await page.mouse.move(vb.x+vb.width/2+18,vb.y+vb.height/2-12,{steps:5});await page.mouse.up();assert.notDeepEqual((await read()).mission.groups[0].points[0],before);
  await toolbar('完成绘制').click();assert.equal((await read()).mission.groups[0].areaClosed,true);await generate(0);
  await toolbar('无人机编组').click();await toolbar('无人机资源管理').click();await page.getByRole('dialog',{name:'无人机资源管理',exact:true}).getByRole('button',{name:'将 uav103 移出区域巡逻'}).click();await page.getByRole('dialog',{name:'无人机资源管理',exact:true}).getByRole('button',{name:'完成配置'}).click();assert.equal((await read()).mission.groups[0].plan,undefined);
  await toolbar('任务参数').click();await generate(0);assert.equal((await read()).mission.groups[0].plan.regions.length,2);await shot('01b-two-aircraft-two-regions');
  await toolbar('无人机编组').click();await toolbar('无人机资源管理').click();await page.getByRole('dialog',{name:'无人机资源管理',exact:true}).getByRole('button',{name:/加入 uav103 为/}).click();await page.getByRole('dialog',{name:'无人机资源管理',exact:true}).getByRole('button',{name:'完成配置'}).click();await toolbar('任务参数').click();await generate(0);assert.equal((await read()).mission.groups[0].plan.regions.length,3);
  await page.clock.runFor(16000);await layout('patrol-2048');await shot('01-patrol-drawn-plan-2048');
  await page.setViewportSize({width:1366,height:768});await layout('patrol-1366');await shot('02-patrol-plan-1366');await page.setViewportSize({width:2048,height:1152});
  await deploy(0);await page.clock.runFor(3000);await toolbar('暂停任务').click();const paused=(await read()).mission.drones.map(d=>d.position);await page.clock.runFor(2000);assert.deepEqual((await read()).mission.drones.map(d=>d.position),paused);await toolbar('继续任务').click();await complete(0);await toolbar('查看执行结果').click();await shot('04-patrol-success');
  const download=page.waitForEvent('download');await toolbar('导出模拟执行记录 JSON').click();const file=await download;await file.saveAs(`${out}/patrol-export.json`);assert.equal(JSON.parse(fs.readFileSync(`${out}/patrol-export.json`)).group.outcome,'success');
  for(const index of [1,2,3,4]){
   await example(index);await generate(index);if(index===1)await shot('05-search-partitions');
   if(index===2){await shot('05-monitor-relay-2048');await page.setViewportSize({width:1366,height:768});await layout('monitor-1366');await shot('06-monitor-relay-1366');await page.setViewportSize({width:2048,height:1152});}
   if(index===3)await shot('07-transport-plan');
   await deploy(index);await complete(index);
  }
  await toolbar('查看执行结果').click();await shot('09-rescue-success');
  await example(0,'upload-failure');await generate(0);await deploy(0,true);
  for(let index=0;index<5;index++){await example(index,'execution-failure');await generate(index);await deploy(index);await complete(index,'failure');}
  await toolbar('查看执行结果').click();await shot('11-execution-failure-record');
  await toolbar('返回教学页面').click();assert.equal(await view.count(),0);await page.getByRole('button',{name:'展开指挥台'}).click();await view.waitFor();await layout('reopen-command');
  assert.deepEqual(exceptions,[]);assert.deepEqual(consoleErrors,[]);const nonMap=networkFailures.filter(r=>new URL(r.url).origin===new URL(base).origin);assert.deepEqual(nonMap,[]);
  for(const stale of ['FAILED.png','failure.json'])fs.rmSync(`${out}/${stale}`,{force:true});
  fs.writeFileSync(`${out}/acceptance.json`,JSON.stringify({checks,exceptions,consoleErrors,networkFailures},null,2));console.log(JSON.stringify({passed:true,checks:checks.length,exceptions,consoleErrors,networkFailures:networkFailures.length,out},null,2));
 }catch(error){await shot('FAILED');fs.writeFileSync(`${out}/failure.json`,JSON.stringify({message:error.stack,state:await read().catch(()=>null),exceptions,consoleErrors,networkFailures},null,2));throw error;}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
