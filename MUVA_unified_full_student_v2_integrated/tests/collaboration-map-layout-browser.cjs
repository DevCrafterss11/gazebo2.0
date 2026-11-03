const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const out = process.env.MUVA_SCREENSHOT_DIR || 'docs/ui-verification/collaboration/map-layout-2026-10-31';
fs.mkdirSync(out, { recursive: true });
(async () => {
 const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
 const page = await browser.newPage({ viewport: { width:1600,height:1000 } });
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 // Offline fixture deliberately exercises the fallback, not a fake successful basemap.
 await page.route('**/World_Imagery/**',r=>r.abort());
 const base=process.env.MUVA_TEST_URL || 'http://127.0.0.1:5175';
 const shot = name => page.screenshot({path:`${out}/${name}.png`,fullPage:true});
 const nav = name => page.getByRole('navigation',{name:'实验三六步教学流程'}).getByRole('button',{name:new RegExp(name)}).click();
 const business=name=>page.getByRole('navigation',{name:'任务业务导航'}).getByRole('button',{name,exact:true}).click();
 const closeLayer=async()=>{const b=page.getByRole('button',{name:'关闭地图图层'});if(await b.count())await b.click();};
 const settle=()=>page.waitForTimeout(180);
 const bounds = async (selector) => page.locator('[data-command-stage]').last().locator(selector).evaluateAll(es=>es.filter(e=>e.getClientRects().length).map(e=>({label:e.getAttribute('aria-label')||e.getAttribute('data-map-obstruction')||e.tagName,r:e.getBoundingClientRect().toJSON(),scroll:e.scrollWidth,client:e.clientWidth})));
 const check = async name => {
   await settle();
   const boxes=await bounds('[data-map-hud], [data-map-controls], [data-map-obstruction], [data-command-bottom]');
   for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
    const a=boxes[i],b=boxes[j];const w=Math.min(a.r.right,b.r.right)-Math.max(a.r.left,b.r.left),h=Math.min(a.r.bottom,b.r.bottom)-Math.max(a.r.top,b.r.top);
    assert.ok(w<=1||h<=1,`${name}: ${a.label}/${b.label} overlap ${w}×${h} ${JSON.stringify(boxes)}`);
   }
   const tool=boxes.find(b=>b.label==='地图导航工具');assert.ok(tool.r.height>tool.r.width*3,`${name}: tools must be vertical`);
   assert.ok(boxes.every(b=>b.scroll<=b.client+1),`${name}: clipped horizontal content`);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${name}: page overflow`);
   const stage=await page.locator('[data-command-stage]').last().boundingBox();
   assert.ok(tool.r.right<=stage.x+stage.width+1,`${name}: toolbar clipped`);
   await shot(name);
 };
 try {
  await page.goto(`${base}/login`); await page.evaluate(()=>{sessionStorage.setItem('muva-mock-user','signed-in');sessionStorage.setItem('muva-user-role','student');});
  await page.goto(`${base}/experiments/collaboration`);await page.getByRole('button',{name:/进入教学模拟模式/}).click();await nav('集群启动');await page.getByRole('button',{name:'启动集群',exact:true}).click();await page.waitForTimeout(2400);await nav('多任务协同指挥');
  // Step 5 is a desktop teaching entry, not a compressed embedded map.
  assert.equal(await page.getByTestId('fleet-map').count(),0);
  await shot('round1-01-teaching-entry');
  await page.getByRole('button',{name:'展开指挥台'}).click();await check('round1-02-expanded');
  for(const name of ['区域巡逻','目标搜索','定点监测','物资运输','应急救援']){await business(name);await check(`round1-${name}`);}
  await closeLayer();
  // Round 2: all navigation and layer controls act on one coordinate camera.
  await page.getByLabel('地图底图').selectOption('coordinates');
  await page.getByTestId('coordinate-grid').waitFor();
  assert.equal(await page.getByTestId('satellite-basemap').getAttribute('data-status'),'grid');
  const camera=()=>page.getByTestId('satellite-basemap').getAttribute('data-camera-zoom').then(Number);
  let z=await camera();await page.getByTitle('放大',{exact:true}).click();await page.waitForTimeout(400);assert.ok(await camera()>z);z=await camera();await page.getByTitle('缩小',{exact:true}).click();await page.waitForTimeout(400);assert.ok(await camera()<z);
  let map=page.getByTestId('fleet-map'); const b=await map.boundingBox();
  const lng=await page.getByTestId('satellite-basemap').getAttribute('data-camera-longitude');
  await page.mouse.move(b.x+b.width*.55,b.y+b.height*.55);await page.mouse.down();await page.mouse.move(b.x+b.width*.55+60,b.y+b.height*.55+30,{steps:6});await page.mouse.up();
  assert.notEqual(await page.getByTestId('satellite-basemap').getAttribute('data-camera-longitude'),lng);
  await page.getByTitle('自动适配视野',{exact:true}).click();
  await check('round2-01-coordinate-map');
  await business('区域巡逻');await closeLayer();
  if(await page.getByRole('button',{name:/收起任务面板|展开任务面板/}).getAttribute('aria-expanded')==='true')await page.getByRole('button',{name:/收起任务面板|展开任务面板/}).click();
  const tool=page.getByLabel('地图编辑工具');await tool.selectOption('point');for(const [x,y] of [[.4,.4],[.6,.4],[.6,.6],[.4,.6]])await map.click({position:{x:b.width*x,y:b.height*y}});await tool.selectOption('pan');
  await page.getByRole('button',{name:'编辑点位',exact:true}).click();await check('round2-02-patrol-area');await closeLayer();
  await page.getByTitle('自动适配视野',{exact:true}).click();await page.getByTestId('marker-uav108').click();
  const pop=page.getByRole('region',{name:'uav108操作面板'});await pop.waitFor();const pb=await pop.boundingBox(),hb=await page.locator('[data-map-hud]').boundingBox();assert.ok(pb.y+pb.height<=hb.y+1,'popup cannot cover HUD');await shot('round2-03-drone-popup');await page.getByRole('button',{name:'关闭无人机面板'}).click();
  await business('物资运输');await closeLayer();const bb=await map.boundingBox();for(const [t,x,y] of [['start',.4,.42],['delivery',.65,.58]]){await tool.selectOption(t);await map.click({position:{x:bb.width*x,y:bb.height*y}});}await tool.selectOption('pan');await check('round2-04-transport-points');
  // Round 3: compare desktop, short desktop, tablet and phone, including expanded/live views.
  for(const [w,h] of [[2048,1152],[1366,768],[1024,768],[768,1024],[390,844]]){
   await page.setViewportSize({width:w,height:h});await check(`round3-task-${w}`);
   await page.getByRole('button',{name:'任务参数',exact:true}).click();await check(`round3-panel-${w}`);await closeLayer();
   await page.getByRole('button',{name:'集群实时视图',exact:true}).click();await page.getByRole('dialog',{name:'集群实时指挥视图'}).waitFor();await check(`round3-live-${w}`);
   const open=page.getByRole('button',{name:'飞行操作',exact:true});if(await open.count()){await open.click();await check(`round3-live-panel-${w}`);}
   await page.getByRole('button',{name:'返回任务工作区',exact:true}).click();
  }
  await page.setViewportSize({width:1600,height:1000});
  await page.getByRole('button',{name:'返回教学页面',exact:true}).click();
  assert.equal(await page.getByTestId('fleet-map').count(),0,'returning to teaching never embeds the map');
  for(const [w,h] of [[1366,768],[390,844]]) {
    await page.setViewportSize({width:w,height:h});
    assert.equal(await page.getByTestId('fleet-map').count(),0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`teaching entry ${w}: horizontal overflow`);
    await shot(`round3-entry-${w}`);
    await page.getByRole('button',{name:'展开指挥台'}).click();
    await check(`round3-reopened-${w}`);
    await page.getByRole('button',{name:'返回教学页面',exact:true}).click();
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(`${out}/result.json`,JSON.stringify({rounds:3,pageErrors:errors,passed:true},null,2));console.log('PASS: independent teaching entry and three rounds of command map layout verification');
 } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
