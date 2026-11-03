const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_CORE_PATH||'playwright-core');
const out=process.env.MUVA_SCREENSHOT_DIR||'docs/ui-verification/collaboration/four-task-flow-focused-2026-10-31';fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:2048,height:1152}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const base=process.env.MUVA_TEST_URL||'http://127.0.0.1:5173';let storeUrl;
 const state=()=>page.evaluate(async url=>(await import(url)).useCollaborationStore.getState().missionState,storeUrl);
 const dialog=page.getByRole('dialog',{name:'独立任务全屏工作区'});
 const nav=name=>dialog.getByRole('navigation',{name:'任务业务导航'}).getByRole('button',{name,exact:true});
 const button=name=>dialog.getByRole('button',{name,exact:true});
 const shot=name=>page.screenshot({path:`${out}/${name}.png`});
 try{
  await page.goto(`${base}/login`);await page.evaluate(()=>{sessionStorage.setItem('muva-mock-user','signed-in');sessionStorage.setItem('muva-user-role','student')});
  await page.goto(`${base}/experiments/collaboration`);storeUrl=await page.evaluate(()=>performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/stores/collaborationStore.ts')?.name);assert.ok(storeUrl);
  await page.getByRole('button',{name:/进入教学模拟模式/}).click();await page.getByRole('navigation',{name:'实验三六步教学流程'}).getByRole('button',{name:/集群启动/}).click();await page.getByRole('button',{name:'启动集群',exact:true}).click();await page.waitForTimeout(2300);
  await page.getByRole('navigation',{name:'实验三六步教学流程'}).getByRole('button',{name:/多任务协同指挥/}).click();await page.getByRole('button',{name:'展开指挥台'}).click();
  await nav('目标搜索').click();if(!await dialog.locator('[data-mission-workflow]').count())await button('任务参数').click();assert.ok(await button('地图设置演练目标点').count());
  await button('两点绘制矩形').click();const map=await dialog.getByTestId('fleet-map').boundingBox();await page.mouse.click(map.x+map.width*.40,map.y+map.height*.40);await page.mouse.click(map.x+map.width*.61,map.y+map.height*.62);await button('完成绘制').click();
  await button('地图设置演练目标点').click();await page.mouse.click(map.x+map.width*.74,map.y+map.height*.76);assert.equal((await state()).groups[1].config.targetEast,undefined,'区域外拾取须被拦截');await page.mouse.click(map.x+map.width*.51,map.y+map.height*.51);
  const target=(await state()).groups[1].config;assert.ok(Number.isFinite(target.targetEast)&&Number.isFinite(target.targetNorth));assert.equal(await dialog.locator('[data-search-target]').count(),1);await button('完成绘制').click();await shot('search-target');
  const beforeClear=(await state()).groups[1];assert.equal(beforeClear.areaClosed,true);assert.equal(await button('清除区域').isEnabled(),true);
  page.once('dialog',d=>d.dismiss());await button('清除区域').click();assert.ok((await state()).groups[1].points.some(p=>p.kind==='point'),'取消确认应保留区域');
  page.once('dialog',d=>d.accept());await button('清除区域').click();const afterClear=(await state()).groups[1];assert.equal(afterClear.points.filter(p=>p.kind==='point').length,0);assert.equal(afterClear.areaClosed,false);assert.equal(afterClear.config.targetEast,beforeClear.config.targetEast);assert.equal(afterClear.config.targetNorth,beforeClear.config.targetNorth);assert.deepEqual(afterClear.drones,beforeClear.drones);assert.equal(await button('清除区域').isDisabled(),true);
  await button('两点绘制矩形').click();await page.mouse.click(map.x+map.width*.4,map.y+map.height*.4);await page.mouse.click(map.x+map.width*.6,map.y+map.height*.6);await button('完成绘制').click();assert.equal((await state()).groups[1].areaClosed,true,'清除后应能重画区域');
  await button('区域与航点').click();assert.equal(await button('清除区域').isEnabled(),true);page.once('dialog',d=>d.accept());await button('清除区域').click();assert.equal((await state()).groups[1].points.filter(p=>p.kind==='point').length,0);assert.ok(Number.isFinite((await state()).groups[1].config.targetEast));await button('任务参数').click();await shot('clear-area-2048');
  await button('清除手动目标 / 使用自动目标').click();assert.equal((await state()).groups[1].config.targetEast,undefined);
  await nav('区域巡逻').click();if(!await dialog.locator('[data-mission-workflow]').count())await button('任务参数').click();assert.equal(await button('清除区域').isDisabled(),true);await button('两点绘制矩形').click();const patrolMap=await dialog.getByTestId('fleet-map').boundingBox();await page.mouse.click(patrolMap.x+patrolMap.width*.4,patrolMap.y+patrolMap.height*.4);await page.mouse.click(patrolMap.x+patrolMap.width*.6,patrolMap.y+patrolMap.height*.6);await button('完成绘制').click();assert.equal(await button('清除区域').isEnabled(),true);page.once('dialog',d=>d.accept());await button('清除区域').click();assert.equal((await state()).groups[0].points.filter(p=>p.kind==='point').length,0);
  await page.setViewportSize({width:1366,height:900});await shot('clear-area-1366');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));await page.setViewportSize({width:2048,height:1152});
  await nav('定点监测').click();if(!await dialog.locator('[data-mission-workflow]').count())await button('任务参数').click();const summary=dialog.locator('summary').filter({hasText:'模拟演练与验收场景'});await summary.click();await button('载入本任务模拟示例').click();assert.ok(await dialog.getByText(/计划驻留/).count());await shot('monitor-queue');
  await page.setViewportSize({width:1366,height:900});await shot('monitor-queue-1366');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
  await nav('物资运输').click();if(!await dialog.locator('[data-mission-workflow]').count())await button('任务参数').click();assert.ok(await button('设置装载点').count());assert.ok((await dialog.getByText(/装载点：待设置/).count())>0);await button('设置装载点').click();const tmap=await dialog.getByTestId('fleet-map').boundingBox();await page.mouse.click(tmap.x+tmap.width*.44,tmap.y+tmap.height*.46);await button('完成绘制').click();assert.ok((await state()).groups[3].points.some(p=>p.kind==='start'));await button('设置交付点').click();await page.mouse.click(tmap.x+tmap.width*.55,tmap.y+tmap.height*.54);await button('完成绘制').click();assert.ok((await state()).groups[3].points.some(p=>p.kind==='delivery'));await shot('transport-loading');
  await nav('应急救援').click();if(!await dialog.locator('[data-mission-workflow]').count())await button('任务参数').click();assert.ok(await button('设置响应集结点').count());await button('设置响应集结点').click();const rmap=await dialog.getByTestId('fleet-map').boundingBox();await page.mouse.click(rmap.x+rmap.width*.43,rmap.y+rmap.height*.45);await button('完成绘制').click();assert.ok((await state()).groups[4].points.some(p=>p.kind==='start'));await button('设置事件位置').click();await page.mouse.click(rmap.x+rmap.width*.55,rmap.y+rmap.height*.54);await button('完成绘制').click();assert.ok((await state()).groups[4].points.some(p=>p.kind==='delivery'));await shot('rescue-staging');
  assert.deepEqual(errors,[]);console.log('PASS focused four-task browser test',out);
 }catch(e){await shot('failure').catch(()=>{});console.error(e);process.exitCode=1;}finally{await browser.close();}
})();
