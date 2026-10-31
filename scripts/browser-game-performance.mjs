import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

// Device emulation checks layout/behavior and redundant work, not physical-phone FPS.
const require=createRequire(import.meta.url);
const {chromium,webkit,devices}=require(process.env.SOFACET_PLAYWRIGHT_PATH||'playwright');
const engine=process.env.SOFACET_BROWSER||'chromium';
const origin=process.env.SOFACET_GAME_URL||'http://127.0.0.1:8879';
const baseline=process.env.SOFACET_GAME_BASELINE;
const baselineHtml=baseline?await readFile(resolve(baseline),'utf8'):null;
const output=resolve(process.env.SOFACET_GAME_OUTPUT||'work/game-performance');
await mkdir(output,{recursive:true});
const browser=await ({chromium,webkit}[engine]).launch({...(engine==='chromium'?{args:['--enable-gpu']}:{} )});
const results=[];
try{
 for(const [name,viewport] of [['phone',{width:390,height:670}],['tall-phone',{width:393,height:852}]]){
  for(const [version,path] of [...(baseline?[['baseline','/play.html']]:[]),['current','/play.html']]){
   const context=await browser.newContext({...devices['iPhone 13'],viewport,reducedMotion:'reduce'});
   const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
   page.on('console',message=>{if(message.type()==='error'&&/THREE\.WebGLProgram|shader.*(?:error|failed)|GL_INVALID_/i.test(message.text()))errors.push(message.text())});
   if(version==='baseline')await page.route(new URL(path,origin).href,route=>route.fulfill({contentType:'text/html',body:baselineHtml}));
   await page.goto(new URL(path,origin).href);
   await page.waitForSelector('#stage[data-ready="true"]',{timeout:60000});
   await page.locator('#start').click();
   const skip=page.getByRole('button',{name:'Skip guide ↗'});
   if(await skip.isVisible())await skip.click();
   await page.waitForFunction(()=>!document.querySelector('#touch-launch').hidden&&!document.querySelector('#touch-launch').disabled);
   await page.waitForTimeout(600);
   const measure=()=>page.evaluate(async()=>{
    const box=id=>{const r=document.getElementById(id).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom}};
    let mutations=0,frames=0,previous=performance.now();const intervals=[];
    const observer=new MutationObserver(records=>mutations+=records.length);observer.observe(document.querySelector('#stage'),{subtree:true,attributes:true,childList:true,characterData:true});
    await new Promise(resolve=>{const start=performance.now();function tick(now){frames++;intervals.push(now-previous);previous=now;if(now-start<1200)requestAnimationFrame(tick);else resolve()}requestAnimationFrame(tick)});
    observer.disconnect();intervals.sort((a,b)=>a-b);const canvas=document.querySelector('#game');
    return{mutations,frames,p95FrameMs:intervals[Math.floor(intervals.length*.95)],board:box('viewport'),panel:box('scorecard-panel'),launch:box('touch-launch'),buffer:[canvas.width,canvas.height]};
   });
   const result={engine,name,version,...await measure(),errors};results.push(result);
   await page.screenshot({path:resolve(output,`${engine}-${name}-${version}.png`)});
   if(version==='current'){
    assert.equal(result.panel.height,80,'portrait launch/score panel remains compact');
    assert.ok(result.board.height<=(viewport.width-20)*1.2+1,'extra height does not expand the WebGL buffer');
    const oldBuffer=results.find(r=>r.name===name&&r.version==='baseline')?.buffer||(name==='phone'?[555,616]:[559,889]);
    assert.ok(result.buffer[0]*result.buffer[1]<=oldBuffer[0]*oldBuffer[1],'compact controls must not increase the former phone render budget');
    assert.ok(result.launch.height>=44&&result.launch.bottom<=viewport.height,'launch control is reachable and onscreen');
    assert.ok(result.mutations<=5,`stationary gameplay must not rewrite unchanged UI (${result.mutations} mutations)`);
    await page.locator('#pause').click();assert.equal(await page.locator('#pause').getAttribute('aria-label'),'Resume game');
    await page.locator('#pause').click();assert.equal(await page.locator('#pause').getAttribute('aria-label'),'Pause game');
    await page.locator('#settings').click();await page.locator('#quality').selectOption('full');
    await page.locator('#menu-close').click();
    const full=await measure();assert.deepEqual(full.buffer,result.buffer,'Full and initial Auto keep the same sharpness on phones');
    const launch=await page.locator('#touch-launch').boundingBox();await page.mouse.move(launch.x+launch.width/2,launch.y+launch.height/2);await page.mouse.down();await page.waitForTimeout(350);
    assert.ok(Number(await page.locator('.charge').getAttribute('aria-valuenow'))>0,'charge remains responsive while other UI is cached');
    await page.mouse.up();await page.waitForFunction(()=>document.querySelector('#scorecard-panel').dataset.scoreVisible==='true');
    assert.equal(await page.locator('#scoreboard').getAttribute('aria-hidden'),'false');
    const number=await page.locator('#card-score').boundingBox(),panel=await page.locator('#scorecard-panel').boundingBox();
    assert.ok(number.y>=panel.y&&number.y+number.height<=panel.y+panel.height,'score fits the compact card');
    await page.locator('#pause').click();
    await page.setViewportSize({width:viewport.height,height:viewport.width});await page.waitForTimeout(300);
    assert.ok((await page.locator('#viewport').boundingBox()).height>100,'landscape board remains visible');
    await page.setViewportSize(viewport);await page.waitForTimeout(300);
    await page.locator('#restart').click();await page.waitForFunction(()=>!document.querySelector('#touch-launch').disabled);
    assert.equal(await page.locator('#pause').getAttribute('aria-label'),'Pause game');
    await page.locator('#settings').click();await page.locator('#how-to-play-toggle').click();await page.locator('#practice-replay').click();
    await page.waitForSelector('#controls-tutorial[open]');
    const practice=await page.locator('.practice-card').boundingBox();assert.ok(practice.y>=0&&practice.y+practice.height<=viewport.height,'practice guide remains onscreen');
    await page.getByRole('button',{name:'Close guide ↗'}).click();await page.waitForFunction(()=>!document.querySelector('#touch-launch').disabled);
    assert.deepEqual(errors,[]);
   }
   await context.close();console.log(JSON.stringify(result));
  }
 }
 if(process.env.SOFACET_GAME_DEV_URL){
  const context=await browser.newContext({...devices['iPhone 13'],viewport:{width:390,height:670},reducedMotion:'reduce'});
  await context.addInitScript(()=>localStorage.setItem('sofacet.controls-practised.v1','done'));
  const page=await context.newPage();await page.goto(process.env.SOFACET_GAME_DEV_URL);
  await page.waitForFunction(()=>window.__facet?.ready(),null,{timeout:60000});await page.locator('#start').click();
  await page.waitForFunction(()=>window.__facet.physics.active);await page.waitForTimeout(300);
  const buffers=await page.evaluate(()=>{
   const view=window.__facet.view;let writes=0;const set=view.renderer.setDrawingBufferSize.bind(view.renderer);
   view.renderer.setDrawingBufferSize=(...args)=>{writes++;return set(...args)};
   for(let i=0;i<30;i++)view.resize();const unchangedWrites=writes;
   const modes=['low','full','auto'].map(mode=>{view.setQuality(mode);view.render();return{mode,canvas:[view.canvas.width,view.canvas.height],targets:[view.composer.renderTarget1,view.composer.renderTarget2].map(t=>[t.width,t.height]),pixelRatio:view.renderer.getPixelRatio()}});
   return{unchangedWrites,writes,modes};
  });
  assert.equal(buffers.unchangedWrites,0,'unchanged viewport notifications must not reallocate buffers');
  assert.equal(buffers.writes,2,'low/full resize once each; auto retains the full-size buffer');
  for(const mode of buffers.modes)for(const target of mode.targets)assert.deepEqual(target,mode.canvas,'composer buffers use the exact canvas resolution');
  results.push({engine,buffers});await context.close();
 }
}finally{await browser.close();await writeFile(resolve(output,`${engine}.json`),JSON.stringify(results,null,2))}
