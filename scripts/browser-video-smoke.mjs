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
const pacingOnly=process.env.SOFACET_VIDEO_PACING_ONLY==='1';
const baseline=process.env.SOFACET_VIDEO_BASELINE,previousAssets=new Map(),measurements=new Map(),swipeMeasurements=new Map();
const comparisonFailures=[];
if(baseline){
 assert.match(baseline,/^[a-f0-9]{40}$/,'Use an exact baseline commit');
 for(const file of ['index.html','viewer.js','sequence.js','assets/frame-source.js','assets/frame-cache.js']){
  previousAssets.set('/'+file,execFileSync('git',['show',`${baseline}:${file}`]));
 }
 // Older comparisons predate the separate pacer. When present, its own
 // baseline implementation must be routed along with the entry modules.
 try{previousAssets.set('/assets/frame-pacing.js',execFileSync('git',['show',`${baseline}:assets/frame-pacing.js`],{stdio:['ignore','pipe','ignore']}))}catch{}
}
let server,browser,data;
async function measureScroll(page,speed,duration,startFrame=200){
 await page.evaluate(frame=>window.scrollTo(0,frame*8),startFrame);
 await page.waitForFunction(frame=>window.sofacetPreview.sequence.displayedFrame===frame,startFrame);
 await page.waitForFunction(()=>window.sofacetPreview.sequence.stats.pending===0);
 return page.evaluate(async({speed,duration,startFrame})=>{
  const sequence=window.sofacetPreview.sequence,times=[],lags=[],steps=[],paints=[];
  let presented=sequence.displayedFrame;
  try{
   const start=performance.now();
   await new Promise(resolve=>{
    function step(now){
     paints.push(now);
     if(sequence.displayedFrame!==presented){times.push(now);steps.push(Math.abs(sequence.displayedFrame-presented));presented=sequence.displayedFrame}
     lags.push(Math.abs(Math.round(window.scrollY/8)-sequence.displayedFrame));
     const elapsed=now-start;
     window.scrollTo(0,startFrame*8+(elapsed<duration/2?elapsed:Math.max(0,duration-elapsed))*speed);
     if(elapsed<duration)requestAnimationFrame(step);else resolve();
    }
    requestAnimationFrame(step);
   });
   const gaps=times.slice(1).map((time,i)=>time-times[i]);
   const percentile=values=>values.sort((a,b)=>a-b)[Math.floor(values.length*.95)]||0;
   return{updates:times.length,updatesPerSecond:times.length/(duration/1000),
    p95GapMs:percentile(gaps),maxGapMs:Math.max(0,...gaps),
    maxPaintGapMs:Math.max(0,...paints.slice(1).map((time,i)=>time-paints[i])),
    p95FrameLag:percentile(lags),maxFrameJump:Math.max(0,...steps),stats:sequence.stats};
  }finally{window.scrollTo(0,startFrame*8)}
 },{speed,duration,startFrame});
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
 const nativeCases=process.env.SOFACET_VIDEO_NATIVE_ONLY==='1'?[true]:(engine==='webkit'?[false,true,'legacy']:[false,true]);
 const cases=nativeCases.flatMap(native=>baseline
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
  // the same runner. Renderer entry modules and the pacer come from the baseline.
  if(baseline)await page.route('**/*',async route=>{
   const path=new URL(route.request().url()).pathname;
   const body=previous?previousAssets.get(path==='/'?'/index.html':path):undefined;
   if(body)await route.fulfill({status:200,body,contentType:path.endsWith('.js')?'text/javascript':'text/html'});
   else await route.continue();
  });
  try{
   const pageURL=new URL(url);if(native)pageURL.searchParams.set('renderer','native');
   await page.goto(pageURL.href,{waitUntil:'domcontentloaded'});
   // Autoplay denial must offer an actionable control, including reduced-power browsers.
   await page.waitForFunction(()=>window.sofacetPreview&&(
    document.body.dataset.phase==='idle'||!document.querySelector('#enter').hidden),{},{timeout:60000});
   if(await page.locator('#enter').isVisible())await page.locator('#enter').tap();
   await page.waitForFunction(()=>document.body.dataset.phase==='idle',{},{timeout:30000});
   await page.touchscreen.tap(195,422);
   if(!previous){
    const selected=await page.evaluate(()=>window.sofacetPreview.sequence.stats);
    assert.equal(selected.requestedRenderer,native?'native':'worker','Current cases must exercise the main-URL default or explicit native override');
    if(native)assert.equal(selected.mode,'video');
    else if(engine==='chromium')assert.equal(selected.mode,'worker','The default Chromium case must actually exercise the worker');
   }
   // Compare steady scrolling before large jumps: the old renderer skips those
   // frames while the paced renderer decodes their full intervening journey.
   // Measure sustained scrolling as well as jumps: arriving eventually does not
   // prove that intermediate frames are being presented evenly.
   // Shared runners vary between adjacent six-second windows. Compare medians
   // from three independent runs, retaining every sample's absolute safety gates.
   const samples=[];
   for(let sample=0;sample<(baseline?3:1);sample++){
    const value=await measureScroll(page,.48,6000);
    // Keep timing evidence even when an absolute gate rejects this sample.
    console.log('Continuous scroll sample',JSON.stringify({native,previous,sample,updates:value.updates,p95GapMs:value.p95GapMs,maxGapMs:value.maxGapMs,maxPaintGapMs:value.maxPaintGapMs}));
    assert.ok(value.updates>30,'Continuous scrolling must keep producing frames');
    if(!previous)assert.ok(value.maxGapMs<500,'Continuous scrolling must not stall for half a second');
    assert.ok(value.stats.decoded<=value.stats.settings.decoded,'Decoded frame memory must stay bounded');
    samples.push(value);
   }
   const median=key=>samples.map(sample=>sample[key]).sort((a,b)=>a-b)[Math.floor(samples.length/2)];
   const motion={...samples.at(-1),updates:median('updates'),updatesPerSecond:median('updatesPerSecond'),p95GapMs:median('p95GapMs'),maxGapMs:Math.max(...samples.map(sample=>sample.maxGapMs))};
   console.log('Continuous scroll samples',JSON.stringify({native,previous,samples:samples.map(sample=>({updates:sample.updates,p95GapMs:sample.p95GapMs,maxGapMs:sample.maxGapMs}))}));
   console.log('Continuous scroll',JSON.stringify({native,previous,...motion}));
   if(previous)measurements.set(String(native),motion);
   else if(baseline){
    // Compare identical capabilities: disabling VideoFrame adds a different
    // presentation path and must also be disabled in its historical baseline.
    const before=measurements.get(String(native));
    // The verified fastSeek scheduler intentionally targets 30 updates/second.
    // Preserve raw before/after evidence, but do not reject that target merely
    // because the historical renderer decoded 50 frames/second on this runner.
    const capped=motion.stats.mode==='video'&&motion.stats.nativeFastSeek===true&&motion.stats.nativeScheduleStarts>0;
    const referenceRate=capped?Math.min(before.updatesPerSecond,30):before.updatesPerSecond;
    const referenceGap=capped?Math.max(before.p95GapMs,1000/30):before.p95GapMs;
    const comparison={native,capped,targetFramesPerSecond:capped?30:null,
     beforeUpdatesPerSecond:before.updatesPerSecond,updatesPerSecond:motion.updatesPerSecond,
     beforeP95GapMs:before.p95GapMs,p95GapMs:motion.p95GapMs,
     updatesRatio:motion.updates/before.updates,p95GapRatio:motion.p95GapMs/before.p95GapMs,
     referenceUpdatesPerSecond:referenceRate,referenceP95GapMs:referenceGap,
     targetAdjustedUpdatesRatio:motion.updatesPerSecond/referenceRate,targetAdjustedP95GapRatio:motion.p95GapMs/referenceGap};
    console.log('Same-runner comparison',JSON.stringify(comparison));
    // Retain comparison failures while running the current build's recovery
    // and pixel checks; every failed threshold still rejects the final run.
    const compare=check=>{
     try{check()}catch(error){
      if(!(error instanceof assert.AssertionError))throw error;
      comparisonFailures.push(error);
      console.error('Same-runner comparison failure',JSON.stringify({native,message:error.message}));
     }
    };
    if(capped){
     compare(()=>assert.ok(motion.updatesPerSecond>=27,'The native 30 fps scheduler must deliver at least 27 updates/second'));
     compare(()=>assert.ok(comparison.targetAdjustedUpdatesRatio>=.9,'Native frame delivery missed its target-adjusted baseline'));
     compare(()=>assert.ok(comparison.targetAdjustedP95GapRatio<=1.5,'Native frame pacing regressed against its target-adjusted baseline'));
    }else{
     compare(()=>assert.ok(comparison.updatesRatio>=.75,'Frame delivery regressed against the previous renderer on this runner'));
     compare(()=>assert.ok(comparison.p95GapRatio<=1.5,'Frame pacing regressed against the previous renderer on this runner'));
    }
   }
   const swipe=await measureScroll(page,2.4,4000);
   console.log('Fast swipe and reversal',JSON.stringify({engine,native,previous,...swipe}));
   if(previous)swipeMeasurements.set(String(native),swipe);
   else{
    if(native)assert.equal(swipe.stats.renderer,'native-video','Native touch playback must avoid full-size canvas copies');
    // Native phone seeks must shed an old destination when the finger moves
    // faster than decoding. A four-frame ceiling hid the reported 33-second
    // backlog; bound target lag and recovery for native and worker pacing.
    // The legacy main-thread WebCodecs path keeps its continuity guarantee.
    if(swipe.stats.mode==='webcodecs')assert.ok(swipe.maxFrameJump<=4,'Legacy WebCodecs swipes must not jump over more than four source frames per paint');
    else assert.ok(swipe.p95FrameLag<120,'Responsive fast swipes must stay within 120 source frames of the finger');
    assert.ok(swipe.maxGapMs<300,'Fast swipes must not stall for 300 ms');
    if(baseline&&swipe.stats.mode==='webcodecs'){
     const before=swipeMeasurements.get(String(native));
     assert.ok(swipe.maxFrameJump<=Math.max(4,before.maxFrameJump),'Frame continuity must not regress against the deployed renderer');
    }
   }
   // The historical renderer supplies the steady/fast-scroll pacing reference.
   // Its known recovery bugs must not prevent the current build's full jump,
   // late-journey, recovery and exact-pixel checks from running below.
   if(previous){assert.deepEqual(errors,[]);continue}
   const swipeStoppedAt=Date.now();
   await page.waitForFunction(()=>window.sofacetPreview.sequence.displayedFrame===200&&window.sofacetPreview.sequence.stats.pending===0,{},{timeout:5000});
   if(!previous&&swipe.stats.mode==='video')assert.ok(Date.now()-swipeStoppedAt<2000,'Native fast-swipe reversal must settle within two seconds after scrolling stops');
   if(pacingOnly){assert.deepEqual(errors,[]);continue}
   const frames=[];
   for(const y of [160,1600,8000,12800,14400,800,0]){
    const jumpStartedAt=Date.now();
    await page.evaluate(y=>window.scrollTo(0,y),y);
    await page.waitForFunction(frame=>{
     const sequence=window.sofacetPreview.sequence;
     const stats=sequence.stats;
     return sequence.desiredFrame===frame&&sequence.displayedFrame===frame&&
      (frame===0||stats.renderer!=='native-video'||stats.presentedFrame===undefined||stats.presentedFrame===frame);
    },y/8,{timeout:30000});
    if(!previous&&swipe.stats.mode==='video')assert.ok(Date.now()-jumpStartedAt<2500,'Native large forward/reverse jumps must reach their target within 2.5 seconds');
    const state=await page.evaluate(()=>{
     const sequence=window.sofacetPreview.sequence;
     const active=document.querySelector(sequence.stats.renderer==='native-video'?'#journey':'#journey-frame');
     const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;
     if(sequence.displayedFrame)canvas.getContext('2d',{alpha:false}).drawImage(active,0,0);
     return{frame:sequence.displayedFrame,phase:sequence.phase,stats:sequence.stats,gameSource:document.querySelector('#game-page').getAttribute('src'),
      image:sequence.displayedFrame?canvas.toDataURL():null};
    });
    assert.equal(state.stats.sourceWidth,1920);assert.equal(state.stats.sourceHeight,1080);
    if(!previous)assert.equal(state.gameSource,null,'The game must not start competing with video before its final frame');
    if(native)assert.equal(state.stats.mode,'video');
    if(state.image)frames.push(state.image);
    console.log(JSON.stringify({native,frame:state.frame,phase:state.phase,mode:state.stats.mode,fallback:state.stats.fallbackReason}));
   }
   assert.equal(new Set(frames).size,frames.length,'Scrolling must change the canvas pixels');
   if(!previous)for(const startFrame of [1000,1700]){
    const late=await measureScroll(page,.48,4000,startFrame);
    console.log('Late journey scroll',JSON.stringify({native,startFrame,...late}));
    assert.ok(late.updates>30,'The second half and final quarter must keep delivering frames');
    assert.ok(late.maxGapMs<500,'Late journey scrolling must not stall for half a second');
    assert.ok(late.stats.compressedBytes+late.stats.reservedBytes<=late.stats.settings.compressedBytes,'Late buffering must retain its memory limit');
    assert.equal(await page.locator('#game-page').getAttribute('src'),null,'Game initialization must wait until the cinematic handoff');
   }
   // Large-jump recovery still has its own absolute continuity/memory gates.
   const recovery=await measureScroll(page,.48,6000);
   console.log('Post-jump scroll recovery',JSON.stringify({native,previous,updates:recovery.updates,p95GapMs:recovery.p95GapMs,maxGapMs:recovery.maxGapMs,maxPaintGapMs:recovery.maxPaintGapMs}));
   assert.ok(recovery.updates>30,'Scrolling must recover after large forward/reverse jumps');
   if(!previous)assert.ok(recovery.maxGapMs<500,'Post-jump scrolling must not stall for half a second');
   assert.ok(recovery.stats.decoded<=recovery.stats.settings.decoded,'Post-jump decoded memory must stay bounded');
   await page.waitForFunction(()=>window.sofacetPreview.sequence.displayedFrame===200&&window.sofacetPreview.sequence.stats.pending===0,{},{timeout:5000});
   if(native&&!previous){
    const surface=await page.evaluate(()=>{
     const video=document.querySelector('#journey'),canvas=document.querySelector('#journey-frame');
     return{width:video.getBoundingClientRect().width,canvasWidth:canvas.getBoundingClientRect().width,
      videoLayer:Number(getComputedStyle(video).zIndex),canvasLayer:Number(getComputedStyle(canvas).zIndex),canvasVisible:!canvas.hidden};
    });
    assert.ok(surface.canvasVisible&&surface.width===surface.canvasWidth,'Settled native video must keep its full-size compositor behind the captured frame');
    assert.ok(surface.videoLayer<surface.canvasLayer,'The captured frame must cover the paused native video');
   }
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
 if(comparisonFailures.length)throw new AggregateError(comparisonFailures,'Same-runner performance comparison failed after completing functional checks');
 console.log(engine+(pacingOnly?' mobile continuous scroll and fast/reverse pacing checks passed.':' mobile opening, fast/reverse scroll and original Full HD checks passed.'));
}finally{
 await browser?.close();
 if(server){server.kill();await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve))}
 if(data)await rm(data,{recursive:true,force:true});
}
