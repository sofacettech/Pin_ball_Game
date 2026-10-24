import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const require=createRequire(import.meta.url);
const engine=process.env.SOFACET_BROWSER||'chromium';
assert.ok(['webkit','chromium'].includes(engine),'Use Chromium or WebKit');
const {[engine]:browserType,devices}=require(process.env.SOFACET_PLAYWRIGHT_PATH||'playwright');
const port=process.env.SOFACET_CADENCE_PORT||'8774',url=`http://127.0.0.1:${port}`;
const ref=process.env.SOFACET_CADENCE_REF,assets=new Map();
if(ref){
 assert.match(ref,/^[a-f0-9]{40}$/,'Pin cadence comparisons to a full commit SHA');
 for(const file of ['index.html','viewer.js','sequence.js','style.css','assets/frame-source.js','assets/frame-cache.js','assets/frame-pacing.js','assets/video-playback.js']){
  assets.set('/'+file,execFileSync('git',['show',`${ref}:${file}`]));
 }
}
const rafRates=process.env.SOFACET_CADENCE_RAF?[Number(process.env.SOFACET_CADENCE_RAF)]:[60,30];
assert.ok(rafRates.every(rate=>[30,60].includes(rate)),'Use a 30 or 60 Hz application RAF gate');
let server,browser,data,page,completed=false,failure;
const results=[];
try{
 data=await mkdtemp(join(tmpdir(),'sofacet-cadence-'));
 server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:port,HOST:'127.0.0.1',DATA_DIR:data},stdio:['ignore','pipe','pipe']});
 let listening=false;
 server.stdout.on('data',chunk=>{process.stdout.write(chunk);if(String(chunk).includes(url))listening=true});
 server.stderr.on('data',chunk=>process.stderr.write(chunk));
 let started=false;
 for(let attempt=0;attempt<100&&!started;attempt++){
  if(server.exitCode!==null)throw Error('The cadence test server exited before startup');
  if(listening)try{started=(await fetch(url+'/health')).ok}catch{}
  if(!started)await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.ok(started&&server.exitCode===null,'The dedicated cadence server did not start');
 browser=await browserType.launch();
 const context=await browser.newContext({...devices[engine==='webkit'?'iPhone 13':'Pixel 7']});
 page=await context.newPage();
 const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 // Keep request interception and HTTP cache policy identical in both arms.
 // Playwright disables HTTP cache whenever routing is enabled.
 await page.route('**/*',async route=>{
  const path=new URL(route.request().url()).pathname,body=assets.get(path==='/'?'/index.html':path);
  if(body)await route.fulfill({status:200,body,contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html'});
  else await route.continue();
 });
 await page.addInitScript(()=>{
  globalThis.VideoDecoder=undefined;
  // Gate application paints, not native video callbacks. This reproduces a
  // phone's 30 Hz RAF scheduling while retaining real decoder/compositor data.
  const nativeRAF=requestAnimationFrame.bind(window),nativeCancel=cancelAnimationFrame.bind(window);
  let serial=0,scheduled,lastPaint=-Infinity;
  const callbacks=new Map();
  window.cadenceRafRate=60;
  function tick(now){
   scheduled=undefined;
   const interval=1000/window.cadenceRafRate;
   if(now-lastPaint>=interval-.5){
    lastPaint=now;
    const queued=[...callbacks.values()];callbacks.clear();
    for(const callback of queued)callback(now);
   }
   if(callbacks.size&&scheduled===undefined)scheduled=nativeRAF(tick);
  }
  window.requestAnimationFrame=callback=>{
   const id=++serial;callbacks.set(id,callback);
   if(scheduled===undefined)scheduled=nativeRAF(tick);
   return id;
  };
  window.cancelAnimationFrame=id=>{
   callbacks.delete(id);
   if(!callbacks.size&&scheduled!==undefined){nativeCancel(scheduled);scheduled=undefined}
  };
  // Capture actual HTMLMediaElement seek requests and dispatched completions.
  // These timings explain cadence; they are never counted as rendered frames.
  window.cadenceSeeks=[];window.cadenceSuperseded=[];window.cadenceSeekRequests=[];
  let activeSeek;
  function requested(video,time,method){
   if(video.id!=='journey')return;
   const now=performance.now();
   if(activeSeek){activeSeek.supersededAt=now;window.cadenceSuperseded.push({...activeSeek,elapsedMs:now-activeSeek.at})}
   activeSeek={at:now,from:video.currentTime,to:time,direction:Math.sign(time-video.currentTime),method,playbackRate:video.playbackRate};
   window.cadenceSeekRequests.push(activeSeek);
  }
  const currentTime=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'currentTime');
  Object.defineProperty(HTMLMediaElement.prototype,'currentTime',{...currentTime,set(time){requested(this,time,'currentTime');currentTime.set.call(this,time)}});
  if(typeof HTMLMediaElement.prototype.fastSeek==='function'){
   const fastSeek=HTMLMediaElement.prototype.fastSeek;
   HTMLMediaElement.prototype.fastSeek=function(time){requested(this,time,'fastSeek');return fastSeek.call(this,time)};
  }
  document.addEventListener('seeked',event=>{
   const video=event.target;
   if(video.id!=='journey'||!activeSeek||video.seeking||Math.abs(video.currentTime-activeSeek.to)>1/60)return;
   const completedAt=performance.now();
   Object.assign(activeSeek,{completedAt,durationMs:completedAt-activeSeek.at});
   window.cadenceSeeks.push({...activeSeek});activeSeek=undefined;
  },true);
 });
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.sofacetPreview&&(document.body.dataset.phase==='idle'||!document.querySelector('#enter').hidden),{},{timeout:60000});
 if(await page.locator('#enter').isVisible())await page.locator('#enter').tap();
 await page.waitForFunction(()=>document.body.dataset.phase==='idle',{},{timeout:30000});
 await page.touchscreen.tap(195,422);
 for(const rafHz of rafRates){
  await page.evaluate(rate=>{window.cadenceRafRate=rate;window.scrollTo(0,300*8)},rafHz);
  await page.waitForFunction(()=>{
   const sequence=window.sofacetPreview.sequence;
   return sequence.displayedFrame===300&&sequence.stats.pending===0;
  },{},{timeout:10000});
  const result=await page.evaluate(async({rafHz})=>{
   const sequence=window.sofacetPreview.sequence,video=document.querySelector('#journey');
   if(typeof video.requestVideoFrameCallback!=='function')throw Error('Native compositor callbacks are required for cadence measurement');
   const duration=12000,half=duration/2,sourceFps=60,velocity=90,startFrame=300;
   const paints=[],selected=[],native=[],lags=[];
   let lastSelected=sequence.displayedFrame,lastNative,videoCallback;
   const start=performance.now(),before=sequence.stats;
   function presented(now,metadata){
    const frame=Math.round(metadata.mediaTime*sourceFps);
    if(frame!==lastNative){native.push({at:now-start,observedAt:performance.now()-start,frame,mediaTime:metadata.mediaTime,presentedFrames:metadata.presentedFrames,seeking:video.seeking,readyState:video.readyState,currentTime:video.currentTime,presentationAt:metadata.presentationTime-start,expectedDisplayAt:metadata.expectedDisplayTime-start});lastNative=frame}
    videoCallback=video.requestVideoFrameCallback(presented);
   }
   videoCallback=video.requestVideoFrameCallback(presented);
   try{
    await new Promise(resolve=>{
     function tick(now){
      const elapsed=now-start,travel=Math.min(duration,elapsed);
      const desired=startFrame+Math.round((travel<half?travel:duration-travel)*velocity/1000);
      window.scrollTo(0,desired*8);
      paints.push({at:elapsed});
      if(sequence.displayedFrame!==lastSelected){selected.push({at:elapsed,frame:sequence.displayedFrame});lastSelected=sequence.displayedFrame}
      lags.push({at:elapsed,selected:Math.abs(desired-sequence.displayedFrame),native:lastNative===undefined?null:Math.abs(desired-lastNative)});
      if(elapsed<duration)requestAnimationFrame(tick);else resolve();
     }
     requestAnimationFrame(tick);
    });
   }finally{video.cancelVideoFrameCallback(videoCallback)}
   const percentile=(values,fraction=.95)=>values.length?[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*fraction))]:null;
   function cadence(events,from,to){
    const rows=events.filter(row=>row.at>=from&&row.at<to),gaps=rows.slice(1).map((row,i)=>row.at-rows[i].at);
    return{updates:rows.length,updatesPerSecond:rows.length/((to-from)/1000),medianGapMs:percentile(gaps,.5),p95GapMs:percentile(gaps),maxGapMs:gaps.length?Math.max(...gaps):null};
   }
   const halves=[{direction:'forward',from:0,to:half},{direction:'reverse',from:half,to:duration}].map(({direction,from,to})=>{
    // Report the complete half and a steady window separately. The half-second
    // acceleration/reversal is visible in fullWindow, never silently discarded.
    const steadyFrom=from+500,steadyLags=lags.filter(row=>row.at>=steadyFrom&&row.at<to);
    const seeks=window.cadenceSeeks.filter(row=>row.at>=start+steadyFrom&&row.completedAt<start+to);
    const steadyNative=cadence(native,steadyFrom,to);
    return{direction,fullWindow:{raf:cadence(paints,from,to),selected:cadence(selected,from,to),native:cadence(native,from,to)},steady:{
     raf:cadence(paints,steadyFrom,to),selected:cadence(selected,steadyFrom,to),native:steadyNative,
     p95SelectedLagFrames:percentile(steadyLags.map(row=>row.selected)),p95NativeLagFrames:percentile(steadyLags.map(row=>row.native).filter(Number.isFinite)),
     seeks:{count:seeks.length,medianMs:percentile(seeks.map(row=>row.durationMs),.5),p95Ms:percentile(seeks.map(row=>row.durationMs)),maxMs:seeks.length?Math.max(...seeks.map(row=>row.durationMs)):null,forward:seeks.filter(row=>row.direction>0).length,reverse:seeks.filter(row=>row.direction<0).length,superseded:window.cadenceSuperseded.filter(row=>row.at>=start+steadyFrom&&row.at<start+to).length},
     target30FpsMet:steadyNative.updatesPerSecond>=27&&steadyNative.p95GapMs<=50&&steadyNative.maxGapMs<150,
    }};
   });
   return{applicationRafGateHz:rafHz,sourceVelocityFramesPerSecond:velocity,durationMs:duration,sourceWidth:before.sourceWidth,sourceHeight:before.sourceHeight,mode:before.mode,halves,
    nativeSeeksCompleted:sequence.stats.nativeSeeks-before.nativeSeeks,nativeSeekMeanMs:(sequence.stats.nativeSeekMs-before.nativeSeekMs)/Math.max(1,sequence.stats.nativeSeeks-before.nativeSeeks),
    nativeFrameCallbacks:native,selectedPaintUpdates:selected,
    preMeasurementSeekRequests:window.cadenceSeekRequests.filter(row=>row.at<start).map(row=>({...row,at:row.at-start,...(row.completedAt===undefined?{}:{completedAt:row.completedAt-start}),...(row.supersededAt===undefined?{}:{supersededAt:row.supersededAt-start})})),
    seekEvents:window.cadenceSeeks.filter(row=>row.at>=start&&row.completedAt<=start+duration).map(row=>({...row,at:row.at-start,completedAt:row.completedAt-start})),lastStats:sequence.stats};
  },{rafHz});
  assert.equal(result.mode,'video','The benchmark must use native video');
  assert.equal(result.sourceWidth,1920);assert.equal(result.sourceHeight,1080);
  results.push(result);
  const {nativeFrameCallbacks,selectedPaintUpdates,preMeasurementSeekRequests,seekEvents,lastStats,...summary}=result;
  console.log('Native cadence',JSON.stringify({engine,ref:ref||'working-tree',...summary}));
 }
 assert.deepEqual(errors,[]);
 completed=true;
 if(process.env.SOFACET_CADENCE_ENFORCE==='1')for(const result of results)for(const half of result.halves)assert.ok(half.steady.target30FpsMet,`${result.applicationRafGateHz} Hz ${half.direction}: native presentation must reach 27 updates/s, p95 gap ≤50 ms, and maximum gap <150 ms`);
 console.log('Native cadence measurement complete; frame rates above come from real compositor callbacks.');
 if(process.env.SOFACET_CADENCE_SCREENSHOT){
  // Capture proof after timing is complete so the debug overlay does not
  // change the baseline/current benchmark's measurement conditions.
  await page.goto(url+'/?perf=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.sofacetPreview&&(document.body.dataset.phase==='idle'||!document.querySelector('#enter').hidden),{},{timeout:60000});
  if(await page.locator('#enter').isVisible())await page.locator('#enter').tap();
  await page.waitForFunction(()=>document.body.dataset.phase==='idle',{},{timeout:30000});
  await page.touchscreen.tap(195,422);
  await page.evaluate(()=>window.scrollTo(0,700*8));
  await page.waitForFunction(()=>window.sofacetPreview.sequence.displayedFrame===700&&window.sofacetPreview.sequence.stats.pending===0,{},{timeout:10000});
  await page.getByRole('button',{name:'Open debug',exact:true}).waitFor({state:'visible'});
  await page.screenshot({path:process.env.SOFACET_CADENCE_SCREENSHOT,type:'jpeg',quality:85,fullPage:false});
 }
 await context.close();
}catch(error){
 failure={name:error.name,message:error.message};
 if(page&&!page.isClosed())console.error('Cadence browser state',await page.evaluate(()=>({phase:document.body.dataset.phase,stats:window.sofacetPreview?.sequence?.stats,video:{ready:document.querySelector('#journey')?.readyState,seeking:document.querySelector('#journey')?.seeking}})));
 throw error;
}finally{
 await browser?.close();
 if(server){server.kill();await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve))}
 if(data)await rm(data,{recursive:true,force:true});
 if(process.env.SOFACET_CADENCE_OUTPUT)await writeFile(process.env.SOFACET_CADENCE_OUTPUT,JSON.stringify({engine,ref:ref||'working-tree',completed,error:failure||null,goal:{targetFramesPerSecond:30,minimumUpdatesPerSecond:27,maximumP95GapMs:50,maximumGapMsExclusive:150,passed:completed&&results.every(result=>result.halves.every(half=>half.steady.target30FpsMet))},results},null,2)+'\n');
}
