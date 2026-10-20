import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const require=createRequire(import.meta.url);
const {webkit,devices}=require(process.env.SOFACET_PLAYWRIGHT_PATH||'playwright');
const url=process.env.SOFACET_VIDEO_URL||'http://127.0.0.1:8768';
let server,browser,data;
try{
 if(!process.env.SOFACET_VIDEO_URL){
  data=await mkdtemp(join(tmpdir(),'sofacet-browser-'));
  server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'8768',HOST:'127.0.0.1',DATA_DIR:data},stdio:'inherit'});
  let started=false;
  for(let i=0;i<100&&!started;i++){
   try{started=(await fetch(url)).ok}catch{}
   if(!started)await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(started,'Preview server did not start');
 }
 browser=await webkit.launch();
 for(const native of [false,true]){
  const context=await browser.newContext({...devices['iPhone 13']});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  if(native)await page.addInitScript(()=>{globalThis.VideoDecoder=undefined});
  try{
   await page.goto(url,{waitUntil:'domcontentloaded'});
   // Autoplay denial must offer an actionable control, including reduced-power browsers.
   await page.waitForFunction(()=>window.sofacetPreview&&(
    document.body.dataset.phase==='idle'||!document.querySelector('#enter').hidden),{},{timeout:60000});
   if(await page.locator('#enter').isVisible())await page.locator('#enter').tap();
   await page.waitForFunction(()=>document.body.dataset.phase==='idle',{},{timeout:30000});
   await page.touchscreen.tap(195,422);
   const frames=[];
   for(const y of [160,1600,8000,800,0]){
    await page.evaluate(y=>window.scrollTo(0,y),y);
    await page.waitForFunction(frame=>{
     const sequence=window.sofacetPreview.sequence;
     return sequence.desiredFrame===frame&&sequence.displayedFrame===frame;
    },y/8,{timeout:30000});
    const state=await page.evaluate(()=>{
     const sequence=window.sofacetPreview.sequence,canvas=document.querySelector('#journey-frame');
     return{frame:sequence.displayedFrame,phase:sequence.phase,stats:sequence.stats,
      image:sequence.displayedFrame?canvas.toDataURL():null};
    });
    assert.equal(state.stats.sourceWidth,1920);assert.equal(state.stats.sourceHeight,1080);
    if(native)assert.equal(state.stats.mode,'video');
    if(state.image)frames.push(state.image);
    console.log(JSON.stringify({native,frame:state.frame,phase:state.phase,mode:state.stats.mode,fallback:state.stats.fallbackReason}));
   }
   assert.equal(new Set(frames).size,frames.length,'Scrolling must change the canvas pixels');
   // Measure sustained scrolling as well as jumps: arriving eventually does not
   // prove that intermediate frames are being presented evenly.
   await page.evaluate(()=>window.scrollTo(0,1600));
   await page.waitForFunction(()=>window.sofacetPreview.sequence.displayedFrame===200);
   await page.waitForFunction(()=>window.sofacetPreview.sequence.stats.pending===0);
   const quality=await page.evaluate(async()=>{
    const {waitForVideo}=await import('./assets/video-playback.js');
    const reference=document.createElement('video');
    reference.muted=true;reference.playsInline=true;reference.crossOrigin='anonymous';
    reference.style.cssText='position:fixed;width:1px;height:1px;opacity:.001;pointer-events:none';
    document.body.append(reference);
    try{
     reference.src=document.querySelector('#journey').currentSrc;reference.preload='auto';reference.load();
     await reference.play();reference.pause();await waitForVideo(reference,{readyState:2});
     reference.currentTime=200.25/60;await waitForVideo(reference,{readyState:2});
     const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;
     const context=canvas.getContext('2d',{alpha:false});context.drawImage(reference,0,0);
     const expected=context.getImageData(0,0,1920,1080).data;
     const actual=document.querySelector('#journey-frame').getContext('2d').getImageData(0,0,1920,1080).data;
     let max=0,total=0;for(let i=0;i<actual.length;i++){const delta=Math.abs(actual[i]-expected[i]);max=Math.max(max,delta);total+=delta}
     return{maxChannelDifference:max,meanChannelDifference:total/actual.length};
    }finally{reference.pause();reference.removeAttribute('src');reference.load();reference.remove()}
   });
   console.log('Original Full HD pixel comparison',JSON.stringify({native,...quality}));
   assert.ok(quality.maxChannelDifference<=2&&quality.meanChannelDifference<=.05,'Cached frames must preserve original native-video pixels');
   const motion=await page.evaluate(async()=>{
    const sequence=window.sofacetPreview.sequence,draw=CanvasRenderingContext2D.prototype.drawImage;
    const times=[];
    CanvasRenderingContext2D.prototype.drawImage=function(...args){
     if(this.canvas.id==='journey-frame')times.push(performance.now());
     return draw.apply(this,args);
    };
    try{
     const start=performance.now();
     await new Promise(resolve=>{
      function step(now){
       const elapsed=now-start;
       window.scrollTo(0,1600+(elapsed<3000?elapsed:6000-elapsed)*.48);
       if(elapsed<6000)requestAnimationFrame(step);else resolve();
      }
      requestAnimationFrame(step);
     });
     const gaps=times.slice(1).map((time,i)=>time-times[i]).sort((a,b)=>a-b);
     return{updates:times.length,updatesPerSecond:times.length/6,
      p95GapMs:gaps[Math.floor(gaps.length*.95)]||0,maxGapMs:gaps.at(-1)||0,stats:sequence.stats};
    }finally{CanvasRenderingContext2D.prototype.drawImage=draw;window.scrollTo(0,1600)}
   });
   console.log('Continuous scroll',JSON.stringify({native,...motion}));
   assert.ok(motion.updates>30,'Continuous scrolling must keep producing frames');
   assert.ok(motion.stats.decoded<=motion.stats.settings.decoded,'Decoded frame memory must stay bounded');
   await page.waitForFunction(()=>window.sofacetPreview.sequence.displayedFrame===200);
   assert.deepEqual(errors,[]);
  }catch(error){
   console.error('Browser state',await page.evaluate(()=>({
    phase:document.body.dataset.phase,status:document.querySelector('#status')?.textContent,
    sequence:window.sofacetPreview?.sequence?.stats,
    videos:[...document.querySelectorAll('video')].map(v=>({id:v.id,time:v.currentTime,ready:v.readyState,seeking:v.seeking,paused:v.paused,error:v.error?.message}))
   })));
   throw error;
  }finally{await context.close()}
 }
 console.log('WebKit mobile opening, forward/reverse scroll and original Full HD checks passed.');
}finally{
 await browser?.close();
 if(server){server.kill();await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve))}
 if(data)await rm(data,{recursive:true,force:true});
}
