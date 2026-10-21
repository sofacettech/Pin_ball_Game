import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const require=createRequire(import.meta.url);
const engine=process.env.SOFACET_BROWSER||'webkit';
assert.ok(['webkit','chromium'].includes(engine),'Use a supported mobile browser');
const {[engine]:browserType,devices}=require(process.env.SOFACET_PLAYWRIGHT_PATH||'playwright');
const url=process.env.SOFACET_VIDEO_URL||'http://127.0.0.1:8768';
const baseline=process.env.SOFACET_VIDEO_BASELINE,previousAssets=new Map(),measurements=new Map(),swipeMeasurements=new Map();
if(baseline){
 assert.match(baseline,/^[a-f0-9]{40}$/,'Use an exact baseline commit');
 for(const file of ['index.html','viewer.js','sequence.js','assets/frame-source.js','assets/frame-cache.js']){
  previousAssets.set('/'+file,execFileSync('git',['show',`${baseline}:${file}`]));
 }
}
let server,browser,data;
async function measureScroll(page,speed,duration){
 await page.evaluate(()=>window.scrollTo(0,1600));
 await page.waitForFunction(()=>window.sofacetPreview.sequence.displayedFrame===200);
 await page.waitForFunction(()=>window.sofacetPreview.sequence.stats.pending===0);
 return page.evaluate(async({speed,duration})=>{
  const sequence=window.sofacetPreview.sequence,times=[],lags=[],steps=[];
  let presented=sequence.displayedFrame;
  try{
   const start=performance.now();
   await new Promise(resolve=>{
    function step(now){
     if(sequence.displayedFrame!==presented){times.push(now);steps.push(Math.abs(sequence.displayedFrame-presented));presented=sequence.displayedFrame}
     lags.push(Math.abs(Math.round(window.scrollY/8)-sequence.displayedFrame));
     const elapsed=now-start;
     window.scrollTo(0,1600+(elapsed<duration/2?elapsed:Math.max(0,duration-elapsed))*speed);
     if(elapsed<duration)requestAnimationFrame(step);else resolve();
    }
    requestAnimationFrame(step);
   });
   const gaps=times.slice(1).map((time,i)=>time-times[i]);
   const percentile=values=>values.sort((a,b)=>a-b)[Math.floor(values.length*.95)]||0;
   return{updates:times.length,updatesPerSecond:times.length/(duration/1000),
    p95GapMs:percentile(gaps),maxGapMs:Math.max(0,...gaps),
    p95FrameLag:percentile(lags),maxFrameJump:Math.max(0,...steps),stats:sequence.stats};
  }finally{window.scrollTo(0,1600)}
 },{speed,duration});
}
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
 const cases=(engine==='webkit'?[false,true,'legacy']:[false,true]).flatMap(native=>baseline&&native!=='legacy'
  ?[{native,previous:true},{native,previous:false}]:[{native,previous:false}]);
 for(const {native,previous} of cases){
  // Release decoder/GPU resources between cases so the last renderer is not
  // measured under memory pressure left by earlier 249 MB video instances.
  browser=await browserType.launch();
  const context=await browser.newContext({...devices[engine==='webkit'?'iPhone 13':'Pixel 7']});
  const page=await context.newPage(),errors=[];
  if(engine==='chromium'&&process.env.SOFACET_CPU_THROTTLE)await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate',{rate:Number(process.env.SOFACET_CPU_THROTTLE)});
  page.on('pageerror',error=>errors.push(error.message));
  if(native)await page.addInitScript(()=>{globalThis.VideoDecoder=undefined});
  if(native==='legacy')await page.addInitScript(()=>{globalThis.VideoFrame=undefined});
  // Both versions use identical local videos and routing/cache conditions on
  // the same runner. Only the five renderer entry files come from the baseline.
  if(baseline)await page.route('**/*',async route=>{
   const path=new URL(route.request().url()).pathname;
   const body=previous?previousAssets.get(path==='/'?'/index.html':path):undefined;
   if(body)await route.fulfill({status:200,body,contentType:path.endsWith('.js')?'text/javascript':'text/html'});
   else await route.continue();
  });
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
     const sequence=window.sofacetPreview.sequence;
     const active=document.querySelector(sequence.stats.renderer==='native-video'?'#journey':'#journey-frame');
     const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;
     if(sequence.displayedFrame)canvas.getContext('2d',{alpha:false}).drawImage(active,0,0);
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
   const motion=await measureScroll(page,.48,6000);
   console.log('Continuous scroll',JSON.stringify({native,previous,...motion}));
   assert.ok(motion.updates>30,'Continuous scrolling must keep producing frames');
   if(!previous)assert.ok(motion.maxGapMs<500,'Continuous scrolling must not stall for half a second');
   assert.ok(motion.stats.decoded<=motion.stats.settings.decoded,'Decoded frame memory must stay bounded');
   if(previous)measurements.set(String(native),motion);
   else if(baseline){
    const before=measurements.get(String(native==='legacy'?true:native));
    const comparison={native,updatesRatio:motion.updates/before.updates,p95GapRatio:motion.p95GapMs/before.p95GapMs};
    console.log('Same-runner comparison',JSON.stringify(comparison));
    assert.ok(comparison.updatesRatio>=.75,'Frame delivery regressed against the previous renderer on this runner');
    assert.ok(comparison.p95GapRatio<=1.5,'Frame pacing regressed against the previous renderer on this runner');
   }
   const swipe=await measureScroll(page,2.4,4000);
   console.log('Fast swipe and reversal',JSON.stringify({engine,native,previous,...swipe}));
   if(previous)swipeMeasurements.set(String(native),swipe);
   else{
    if(native)assert.equal(swipe.stats.renderer,'native-video','Native touch playback must avoid full-size canvas copies');
    assert.ok(swipe.p95FrameLag<=24,'Fast scrolling must stay within 80 ms of the gesture at 300 source frames per second');
    assert.ok(swipe.maxGapMs<300,'Fast swipes must not stall for 300 ms');
    if(baseline){
     const before=swipeMeasurements.get(String(native==='legacy'?true:native));
     assert.ok(swipe.p95FrameLag<=Math.max(3,before.p95FrameLag*.8),'Scroll response must improve over the deployed renderer');
    }
   }
   await page.waitForFunction(()=>window.sofacetPreview.sequence.displayedFrame===200);
   // The historical mutable-video renderer is a pacing reference, not the
   // implementation under test for the new immutable-frame pixel guarantee.
   if(previous){assert.deepEqual(errors,[]);continue}
   const quality=await page.evaluate(async()=>{
    const {waitForVideo}=await import('./assets/video-playback.js');
    const reference=document.createElement('video');
    reference.muted=true;reference.playsInline=true;reference.crossOrigin='anonymous';
    // WebKit may report HAVE_CURRENT_DATA before a tiny, nearly transparent
    // reference video has a drawable compositor surface. Give the reference a
    // visible test-only surface and wait for paints before reading its pixels.
    reference.style.cssText='position:fixed;width:192px;height:108px;bottom:0;right:0;z-index:2147483647;pointer-events:none';
    document.body.append(reference);
    try{
     // WebCodecs never sets the hidden video's src; compare that path with the
     // same original asset served by the test server.
     reference.src=document.querySelector('#journey').currentSrc||new URL('./assets/sofacet-experience.mp4',location.href).href;reference.preload='auto';reference.load();
     await reference.play();reference.pause();await waitForVideo(reference,{readyState:2});
     const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;
     const context=canvas.getContext('2d',{alpha:false});
     // WebKit can keep the old surface after a paused seek, even after seeked.
     // Play through the target slowly and capture its pixels inside the frame
     // callback, where the presented media timestamp identifies the exact frame.
     reference.currentTime=199.25/60;await waitForVideo(reference,{readyState:2});
     reference.playbackRate=.25;
     const presented=new Promise((resolve,reject)=>{
      let callback;const observed=[];
      const timer=setTimeout(()=>{reference.cancelVideoFrameCallback(callback);reject(Error('Reference did not present frame 200: '+JSON.stringify(observed)))},10000);
      function check(_now,metadata){
       observed.push(metadata.mediaTime);if(observed.length>10)observed.shift();
       if(Math.round(metadata.mediaTime*60)===200){
        reference.pause();clearTimeout(timer);context.drawImage(reference,0,0);
        resolve({referenceMediaTime:metadata.mediaTime,expected:context.getImageData(0,0,1920,1080).data});
       }
       else callback=reference.requestVideoFrameCallback(check);
      }
      callback=reference.requestVideoFrameCallback(check);
     });
     const [{referenceMediaTime,expected}]=await Promise.all([presented,reference.play()]);
     const sequence=window.sofacetPreview.sequence;
     const active=document.querySelector(sequence.stats.renderer==='native-video'?'#journey':'#journey-frame');
     const bounds=active.getBoundingClientRect();
     if(active.hidden||bounds.width<100||bounds.height<100||getComputedStyle(active).opacity!=='1')throw Error('The journey renderer must be visible at full stage size');
     let result;
     for(let attempt=1;attempt<=3;attempt++){
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      context.drawImage(active,0,0);const actual=context.getImageData(0,0,1920,1080).data;
      let max=0,total=0,referenceRGB=0,actualRGB=0;
      for(let i=0;i<actual.length;i++){const delta=Math.abs(actual[i]-expected[i]);max=Math.max(max,delta);total+=delta;if(i%4!==3){referenceRGB+=expected[i];actualRGB+=actual[i]}}
      result={maxChannelDifference:max,meanChannelDifference:total/actual.length,referenceRGB:referenceRGB/(1920*1080*3),actualRGB:actualRGB/(1920*1080*3),referenceMediaTime,activeMediaTime:active.currentTime,paintAttempts:attempt};
      if(result.referenceRGB>1&&max<=2&&result.meanChannelDifference<=.05)break;
     }
     return result;
    }finally{reference.pause();reference.removeAttribute('src');reference.load();reference.remove()}
   });
   console.log('Original Full HD pixel comparison',JSON.stringify({native,...quality}));
   assert.ok(quality.referenceRGB>1&&quality.maxChannelDifference<=2&&quality.meanChannelDifference<=.05,'Rendered frames must preserve original native-video pixels');
   assert.deepEqual(errors,[]);
  }catch(error){
   console.error('Browser state',await page.evaluate(()=>({
    phase:document.body.dataset.phase,status:document.querySelector('#status')?.textContent,
    sequence:window.sofacetPreview?.sequence?.stats,
    videos:[...document.querySelectorAll('video')].map(v=>({id:v.id,time:v.currentTime,ready:v.readyState,seeking:v.seeking,paused:v.paused,error:v.error?.message}))
   })));
   throw error;
  }finally{await context.close();await browser.close();browser=undefined}
 }
 console.log(engine+' mobile opening, fast/reverse scroll and original Full HD checks passed.');
}finally{
 await browser?.close();
 if(server){server.kill();await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve))}
 if(data)await rm(data,{recursive:true,force:true});
}
