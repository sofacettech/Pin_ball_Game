import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {createJourneyScrollMap} from '../entrance-source/journey-scroll.mjs';
const require=createRequire(import.meta.url),{webkit,chromium,devices}=require(process.env.SOFACET_PLAYWRIGHT_PATH||'playwright');
const engine=process.env.SOFACET_BROWSER||'webkit',url=new URL(process.env.SOFACET_ENTRANCE_URL||'http://127.0.0.1:8886/');url.hash='experience';
const browser=await ({webkit,chromium}[engine]).launch(engine==='chromium'?{args:['--enable-gpu']}:{}),scroll=createJourneyScrollMap(),report=[];
await mkdir('work/chess-transition',{recursive:true});
try{
 for(const [name,options] of [['phone',{...devices['iPhone 13'],viewport:{width:393,height:735}}],['desktop',{viewport:{width:1280,height:720}}]]){
  const page=await browser.newPage(options),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url.href);await page.waitForFunction(()=>window.entrancePreview?.ready,null,{timeout:120000});
  for(const [from,to] of [[1440,1720],[1720,1440]]){
   await page.evaluate(y=>scrollTo(0,y),scroll.scrollAtFrame(from));await page.waitForFunction(f=>Math.abs(window.entrancePreview.frame-f)<.15,from);
   const samples=await page.evaluate(({y,target})=>new Promise((resolve,reject)=>{
    const samples=[{frame:window.entrancePreview.frame,time:performance.now()}],started=performance.now();scrollTo(0,y);
    function sample(){
     const frame=window.entrancePreview.frame,time=performance.now();
     if(frame!==samples.at(-1).frame)samples.push({frame,time});
     if(Math.abs(frame-target)<.15){resolve(samples);return;}
     if(time-started>10000){reject(Error('Transition did not settle'));return;}
     requestAnimationFrame(sample);
    }requestAnimationFrame(sample);
   }),{y:scroll.scrollAtFrame(to),target:to});
   const direction=Math.sign(to-from),core=samples.filter(s=>s.frame>=1440&&s.frame<=1640),duration=samples.at(-1).time-samples[0].time;
   assert.ok(core.length>=16,`${name}: show intermediate doorway poses (${core.length})`);
   assert.ok(duration>=750,`${name}: large scroll must not teleport across the doorway (${duration}ms)`);
   for(let i=1;i<samples.length;i++){
    assert.ok((samples[i].frame-samples[i-1].frame)*direction>=-.001,'movement follows the requested direction');
    if(samples[i].frame>=1440&&samples[i].frame<=1640&&samples[i-1].frame>=1440&&samples[i-1].frame<=1640)
     assert.ok(Math.abs(samples[i].frame-samples[i-1].frame)<=12.1,'no jump within the doorway even after a slow frame');
   }
   report.push({name,from,to,duration,samples});
  }
  // A reversal must act on the current pose, without completing the old swipe.
  await page.evaluate(y=>scrollTo(0,y),scroll.scrollAtFrame(1720));await page.waitForFunction(()=>window.entrancePreview.frame>1500&&window.entrancePreview.frame<1600);
  const reversed=await page.evaluate(y=>{const frame=window.entrancePreview.frame;scrollTo(0,y);return frame;},scroll.scrollAtFrame(1440));
  await page.waitForFunction(previous=>window.entrancePreview.frame<previous,reversed,{timeout:1500});
  await page.waitForFunction(()=>Math.abs(window.entrancePreview.frame-1440)<.15);
  await page.screenshot({path:`work/chess-transition/${engine}-${name}.png`});
  assert.deepEqual(errors,[]);await page.close();
 }
 await writeFile(`work/chess-transition/${engine}.json`,JSON.stringify(report,null,2));
 console.log(JSON.stringify({engine,result:'Gradual hallway/chess crossing and immediate reversal on phone and desktop',cases:report.map(({samples,...rest})=>({...rest,poses:samples.length}))}));
}finally{await browser.close()}
