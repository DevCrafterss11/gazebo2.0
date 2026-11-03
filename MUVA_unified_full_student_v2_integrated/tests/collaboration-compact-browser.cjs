const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const out = process.env.MUVA_SCREENSHOT_DIR || 'docs/ui-verification/collaboration/compact-steps-2026-10-31';
fs.mkdirSync(out, {recursive:true});
(async () => {
  const browser = await chromium.launch({executablePath:'/usr/bin/google-chrome', headless:true, args:['--no-sandbox']});
  const page = await browser.newPage({viewport:{width:1829,height:916}});
  const errors=[]; const measurements=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error') errors.push(m.text());});
  const nav=label=>page.getByRole('navigation',{name:'实验三六步教学流程'}).getByRole('button',{name:new RegExp(label)});
  const base=process.env.MUVA_TEST_URL||'http://127.0.0.1:5175';
  const inspect=async(name)=>{
    const metrics=await page.evaluate(()=>{
      const root=document.querySelector('.collaborationWorkspace');
      const content=root.querySelector('main');
      return {width:innerWidth,height:innerHeight,pageWidth:document.documentElement.scrollWidth,scrollHeight:root.scrollHeight,clientHeight:root.clientHeight,contentOverflow:getComputedStyle(content).overflowY,rootOverflow:getComputedStyle(root).overflowY};
    });
    assert.ok(metrics.pageWidth<=metrics.width+2,JSON.stringify(metrics));
    assert.equal(metrics.contentOverflow,'visible','No independently scrolling content panel');
    assert.equal(metrics.rootOverflow,'auto');
    assert.equal(await page.getByRole('button',{name:/^(前往集群启动|前往集群监控|进入集群监控|进入通信组网|上一步)$/}).count(),0);
    assert.equal(await page.getByText('SYSTEM READINESS · 01',{exact:true}).count(),0);
    measurements.push({name,...metrics});
    await page.screenshot({path:`${out}/${name}.png`,fullPage:true});
  };
  try {
    await page.goto(`${base}/login`);
    await page.evaluate(()=>{sessionStorage.setItem('muva-mock-user','signed-in');sessionStorage.setItem('muva-user-role','student');});
    await page.goto(`${base}/experiments/collaboration`);
    await page.getByRole('heading',{name:'运行环境检查'}).waitFor();
    const storeUrl=await page.evaluate(()=>performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/stores/collaborationStore.ts')?.name);
    const read=()=>page.evaluate(async(url)=>{const s=(await import(url)).useCollaborationStore.getState();return {enabled:s.simulationEnabled,cluster:s.clusterRunning,starting:s.clusterStarting,running:s.isRunning,step:s.currentStep,drones:s.missionState.drones,nodes:s.communicationNodes};},storeUrl);
    assert.equal(await nav('集群启动').isDisabled(),true);
    assert.equal(await nav('通信组网').isDisabled(),true);
    await inspect('01-system-desktop');
    await page.getByRole('button',{name:'重新检查',exact:true}).click();
    await page.getByRole('button',{name:'查看uav115资源映射'}).click();
    assert.ok(await page.getByText(/树莓派 192\.168\.10\.115/).isVisible());
    await page.getByRole('button',{name:'进入教学模拟模式',exact:true}).click();
    assert.equal((await read()).starting,false);
    assert.equal(await nav('集群启动').isEnabled(),true);
    await nav('集群启动').click();
    await inspect('02-startup-idle');
    assert.equal(await page.getByRole('button',{name:/^查看uav\d+启动状态$/}).count(),15);
    await page.getByRole('spinbutton',{name:'中心 X',exact:true}).fill('12');
    assert.equal((await read()).drones[0].homePosition.x,-36);
    await page.clock.install(); await page.clock.pauseAt(new Date(Date.now()+500));
    await page.getByRole('button',{name:'启动集群',exact:true}).click();
    await page.clock.runFor(500);
    assert.equal(await page.getByRole('button',{name:'正在启动集群',exact:true}).isDisabled(),true);
    await inspect('02-startup-progress');
    await page.clock.runFor(2200);
    let state=await read(); assert.equal(state.cluster,true); assert.equal(state.running,false);
    assert.ok(state.drones.every(d=>d.instanceStatus==='STANDBY'&&!d.armed&&!d.assignedTaskId));
    assert.equal(await page.getByText('运行记录',{exact:false}).count(),1);
    assert.equal(await page.getByRole('log').isVisible(),false);
    await page.locator('summary').filter({hasText:'运行记录'}).click();
    assert.ok(await page.getByRole('log').isVisible());
    await page.locator('summary').filter({hasText:'运行记录'}).click();
    await inspect('02-startup-ready');
    await nav('通信组网').click();
    assert.equal(await page.getByRole('article').count(),15);
    for(let i=101;i<=115;i++) {
      const card=page.getByRole('article').filter({has:page.getByText(`uav${i}`,{exact:true})});
      assert.ok(await card.getByText(`192.168.10.${i}`,{exact:true}).isVisible());
    }
    await inspect('03-communication-desktop');
    for(const [width,height] of [[1600,900],[1366,768],[768,1024],[390,844]]) {
      await page.setViewportSize({width,height});
      for(const [step,label] of [['系统感知','01-system'],['集群启动','02-startup'],['通信组网','03-communication']]){
        await nav(step).click(); await inspect(`${label}-${width}`);
      }
    }
    await page.setViewportSize({width:1829,height:916}); await nav('集群启动').click();
    page.once('dialog',d=>d.dismiss()); await page.getByRole('button',{name:'停止集群',exact:true}).click(); assert.equal((await read()).cluster,true);
    page.once('dialog',d=>d.accept()); await page.getByRole('button',{name:'停止集群',exact:true}).click(); assert.equal((await read()).cluster,false);
    assert.equal(await nav('通信组网').isDisabled(),true);
    assert.equal((await read()).running,false);
    assert.deepEqual(errors,[]);
    fs.writeFileSync(`${out}/result.json`,JSON.stringify({passed:true,measurements,errors},null,2));
    console.log('PASS: compact steps 1–3, single navigation and scroll surface, readiness gate, startup, 15 mappings, collapsible logs, safe stop and 5 responsive sizes');
  } catch(e) {await page.screenshot({path:`${out}/failure.png`,fullPage:true});throw e;}
  finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
