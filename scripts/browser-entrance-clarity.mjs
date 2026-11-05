import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {createJourneyScrollMap} from '../entrance-source/journey-scroll.mjs';
const require=createRequire(import.meta.url),{webkit,chromium,devices}=require(process.env.SOFACET_PLAYWRIGHT_PATH||'playwright');
const engine=process.env.SOFACET_BROWSER||'webkit',url=new URL(process.env.SOFACET_ENTRANCE_URL||'http://127.0.0.1:8887/');url.searchParams.set('entrance','1');url.hash='experience';
const browser=await ({webkit,chromium}[engine]).launch(engine==='chromium'?{args:['--enable-gpu']}:{}),map=createJourneyScrollMap();
await mkdir('work/entrance-clarity',{recursive:true});
try{
 const page=await browser.newPage({...devices['iPhone 13'],viewport:{width:393,height:735}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/THREE\.WebGLProgram|GL_INVALID_|shader.*error/i.test(m.text()))errors.push(m.text());});
 await page.addInitScript(()=>{window.clarityAllocations=0;for(const name of ['texStorage2D','renderbufferStorage','renderbufferStorageMultisample']){const original=WebGL2RenderingContext.prototype[name];WebGL2RenderingContext.prototype[name]=function(...args){window.clarityAllocations++;return original.apply(this,args);};}});
 await page.goto(url.href);await page.waitForFunction(()=>window.entrancePreview?.ready,null,{timeout:120000});
 const state=()=>page.evaluate(()=>{const r=window.entrancePreview.renderer;return {...window.entrancePreview.resolution,buffer:[r.domElement.width,r.domElement.height],frame:window.entrancePreview.frame,renderCount:r.info.render.frame,allocations:window.clarityAllocations};});
 const initial=await state();assert.equal(initial.pixelRatio,3);assert.deepEqual(initial.buffer,[1179,2205]);
 for(const frame of [1000,1380,1700]){
  await page.evaluate(y=>scrollTo(0,y),map.scrollAtFrame(frame));await page.waitForFunction(f=>Math.abs(window.entrancePreview.frame-f)<.15,frame);
  await page.waitForFunction(()=>window.entrancePreview.resolution.pixelRatio===window.entrancePreview.resolution.activePixelRatio);
  await page.screenshot({path:`work/entrance-clarity/${engine}-${frame}.png`});
 }
 await page.evaluate(()=>{
  const renderer=window.entrancePreview.renderer,draw=renderer.render.bind(renderer);window.claritySlowDraw=0;
  renderer.render=(scene,camera)=>{
   if(scene.type==='Scene'&&scene.children.length>4&&Math.floor(renderer.getRenderTarget()?.height)===renderer.domElement.height){
    const until=performance.now()+window.claritySlowDraw;while(performance.now()<until){}
   }
   return draw(scene,camera);
  };
 });
 const move=async(duration,slow,untilReduced=false)=>page.evaluate(({duration,slow,base,untilReduced})=>new Promise(resolve=>{
  window.claritySlowDraw=slow;const started=performance.now();
  function step(now){scrollTo(0,base+220*Math.sin((now-started)/320));if(now-started>=duration||(untilReduced&&window.entrancePreview.resolution.activePixelRatio<3)){window.claritySlowDraw=0;resolve();return;}requestAnimationFrame(step);}
  requestAnimationFrame(step);
 }),{duration,slow,untilReduced,base:map.scrollAtFrame(1000)});
 // Deliberately stall actual scene draws; this tests the safeguard, not device FPS.
 await move(12000,65,true);assert.ok((await state()).activePixelRatio<3,'sustained slow rendering must activate the movement budget');
 const slow=await state();assert.ok(slow.activePixelRatio>=slow.minPixelRatio);assert.ok(slow.buffer[0]>=1080&&slow.buffer[1]>=1920);
 // A slow runner can still be traversing the protected doorway after input
 // stops. Wait for that final pose before asserting that rendering is idle.
 const finalFrame=map.frameAtScroll(await page.evaluate(()=>scrollY));
 await page.waitForFunction(frame=>Math.abs(window.entrancePreview.frame-frame)<.15,finalFrame);
 await page.waitForFunction(()=>window.entrancePreview.resolution.pixelRatio===window.entrancePreview.resolution.activePixelRatio);await page.waitForTimeout(250);
 const settled=await state();await page.waitForTimeout(450);assert.equal((await state()).renderCount,settled.renderCount,'the settled Full HD frame must not create an idle render loop');
 assert.equal(settled.pixelRatio,slow.pixelRatio,'pausing must not resize the render buffers');
 assert.equal(settled.allocations,slow.allocations,'pausing must reuse the prepared render targets');
 await move(300,0);const resumed=await state();
 assert.ok(resumed.activePixelRatio<3&&resumed.activePixelRatio>=resumed.minPixelRatio,'reuse the measured movement budget');
 assert.ok(resumed.buffer[0]>=1080&&resumed.buffer[1]>=1920);
 assert.equal(resumed.allocations,settled.allocations,'resuming a swipe must not allocate render targets');
 await page.waitForFunction(()=>window.entrancePreview.resolution.pixelRatio===window.entrancePreview.resolution.activePixelRatio);
 await page.setViewportSize({width:852,height:393});await page.waitForFunction(()=>{const c=window.entrancePreview.renderer.domElement;return c.width>c.height&&c.width>=1920&&c.height>=1080});
 const landscape=await state();assert.ok(Math.abs(landscape.buffer[0]/landscape.buffer[1]-852/393)<.002,'rotation preserves the viewport aspect at Full HD or better');assert.deepEqual(errors,[]);
 const result={engine,initial,slow,settled,resumed,landscape,result:'Full HD floor, gradual slow-frame fallback, no idle/resume buffer allocations and retained movement budget passed'};
 await writeFile(`work/entrance-clarity/${engine}.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close()}
