import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
const require=createRequire(import.meta.url),engine=process.env.SOFACET_BROWSER||'chromium';
assert.ok(['chromium','webkit'].includes(engine),'Use Chromium or WebKit');
const profile=process.env.SOFACET_DEVICE||'mobile';
assert.ok(['desktop','mobile'].includes(profile),'SOFACET_DEVICE must be desktop or mobile');
const {[engine]:browserType,devices}=require(process.env.SOFACET_PLAYWRIGHT_PATH||'playwright');
const port=process.env.SOFACET_WORKER_PORT||'8775',url=process.env.SOFACET_WORKER_URL||'http://127.0.0.1:'+port;
const output=resolve(process.env.SOFACET_WORKER_OUTPUT||join(tmpdir(),'sofacet-worker-cadence-'+Date.now()+'.json')),prefix=output.replace(/\.json$/,'');
const allArms=[{name:'native',renderer:'native'},{name:'worker',renderer:'worker'},{name:'worker-unavailable',renderer:'worker',disableWorker:true}];
const selectedArms=(process.env.SOFACET_WORKER_ARMS||allArms.map(arm=>arm.name).join(',')).split(',').map(name=>name.trim());
assert.ok(selectedArms.length>0&&new Set(selectedArms).size===selectedArms.length&&selectedArms.every(name=>allArms.some(arm=>arm.name===name)),'SOFACET_WORKER_ARMS must select unique native, worker, or worker-unavailable arms');
const fullComparison=allArms.every(arm=>selectedArms.includes(arm.name));
const useDefaultWorker=process.env.SOFACET_WORKER_DEFAULT==='1';
const results=[],pictures=new Map();
let browser,server,data,page,completed=false,failure;

async function activateJourney(){
 if(profile==='desktop')await page.mouse.click(195,422);else await page.touchscreen.tap(195,422);
}
function assertCacheProfile(stats){
 const desktop=profile==='desktop',workerCache=stats.mode==='worker'||stats.workerRequests>0||Number.isFinite(stats.workerStartupMs);
 const expected=workerCache
  ? {decoded:4,network:desktop?3:2,batch:24,ahead:desktop?192:80,behind:40,
    prefetch:desktop?256:128,compressedBytes:(desktop?24:16)*1024*1024,preparationFrames:57}
  : {decoded:desktop?8:4,network:desktop?3:2,batch:desktop?32:24,ahead:desktop?256:56,behind:desktop?224:8,
    prefetch:desktop?512:80,compressedBytes:(desktop?48:10)*1024*1024,preparationFrames:desktop?360:57};
 for(const [key,value] of Object.entries(expected))assert.equal(stats.settings[key],value,profile+' '+(workerCache?'worker':'native')+' cache '+key);
 assert.ok(stats.decoded+stats.decoding<=stats.settings.decoded,'Retained and in-flight frames must share the configured budget');
 assert.ok(stats.network<=stats.settings.network,'Network requests must stay within the configured limit');
 assert.ok(stats.compressedBytes+stats.reservedBytes<=stats.settings.compressedBytes,'Compressed cache and reservations must stay bounded');
}
async function settle(target,timeout=30000){
 await page.evaluate(frame=>window.scrollTo(0,frame*8),target);
 await page.waitForFunction(frame=>{
  const sequence=window.sofacetPreview?.sequence;
  return sequence?.desiredFrame===frame&&sequence.displayedFrame===frame&&sequence.stats.pending===0&&sequence.stats.canvasPresentedFrame===frame;
 },target,{timeout});
}
function installInstrumentation({disableWorker}){
 if(disableWorker)globalThis.Worker=undefined;
 const state=window.workerBenchmark={draws:[],readbacks:0,rafAt:null},nativeRAF=requestAnimationFrame.bind(window);
 // Scheduling stays native. The wrapper only identifies draws inside RAF.
 window.requestAnimationFrame=callback=>nativeRAF(now=>{
  const previous=state.rafAt;state.rafAt=now;
  try{callback(now)}finally{state.rafAt=previous}
 });
 const drawImage=CanvasRenderingContext2D.prototype.drawImage;
 CanvasRenderingContext2D.prototype.drawImage=function(...args){
  if(this.canvas.id!=='journey-frame')return drawImage.apply(this,args);
  const beganAt=performance.now(),result=drawImage.apply(this,args);
  const row={at:performance.now(),durationMs:performance.now()-beganAt,rafAt:state.rafAt,frame:null,mode:null,
   sourceType:args[0]?.constructor?.name||null,sourceWidth:args[0]?.displayWidth||args[0]?.videoWidth||args[0]?.width||null,
   sourceHeight:args[0]?.displayHeight||args[0]?.videoHeight||args[0]?.height||null};
  state.draws.push(row);
  // Decoder timestamps identify requests. Use display's source index after
  // drawImage has returned and canvasPresentedFrame has been assigned.
  queueMicrotask(()=>{const stats=window.sofacetPreview?.sequence?.stats;row.frame=stats?.canvasPresentedFrame??null;row.mode=stats?.mode??null});
  return result;
 };
 const getImageData=CanvasRenderingContext2D.prototype.getImageData;
 CanvasRenderingContext2D.prototype.getImageData=function(...args){if(this.canvas.id==='journey-frame')state.readbacks++;return getImageData.apply(this,args)};
}
async function measure(){
 await settle(300);
 return page.evaluate(async()=>{
  const sequence=window.sofacetPreview.sequence,video=document.querySelector('#journey'),trace=window.workerBenchmark;
  const durationMs=12000,half=6000,sourceVelocity=90,startFrame=300;
  const before=sequence.stats,drawStart=trace.draws.length,readbacksBefore=trace.readbacks;
  const paints=[],selected=[],native=[],rawNative=[],lag=[],statsSamples=[];
  let lastSelected=sequence.displayedFrame,lastNative,callback,nextStatsAt=0;
  const start=performance.now();
  if(typeof video.requestVideoFrameCallback==='function'){
   function presented(now,metadata){
    const frame=Math.round(metadata.mediaTime*60),row={at:now-start,observedAt:performance.now()-start,frame,mediaTime:metadata.mediaTime,presentedFrames:metadata.presentedFrames};
    rawNative.push(row);if(frame!==lastNative){native.push(row);lastNative=frame}
    callback=video.requestVideoFrameCallback(presented);
   }
   callback=video.requestVideoFrameCallback(presented);
  }else if(before.mode==='video')throw Error('Native comparison requires real compositor callbacks');
  try{await new Promise(resolve=>{
   function tick(now){
    const elapsed=now-start,travel=Math.min(durationMs,elapsed);
    const desired=startFrame+Math.round((travel<half?travel:durationMs-travel)*sourceVelocity/1000);
    window.scrollTo(0,desired*8);paints.push({at:elapsed});
    if(sequence.displayedFrame!==lastSelected){selected.push({at:elapsed,frame:sequence.displayedFrame});lastSelected=sequence.displayedFrame}
    const latest=trace.draws.at(-1);
    lag.push({at:elapsed,selected:Math.abs(desired-sequence.displayedFrame),canvas:latest?.frame==null?null:Math.abs(desired-latest.frame),native:lastNative===undefined?null:Math.abs(desired-lastNative)});
    if(elapsed>=nextStatsAt){statsSamples.push({at:elapsed,...sequence.stats});nextStatsAt=elapsed+250}
    if(elapsed<durationMs)requestAnimationFrame(tick);else resolve();
   }
   requestAnimationFrame(tick);
  })}finally{if(callback!==undefined)video.cancelVideoFrameCallback(callback)}
  await Promise.resolve();
  const rawDraws=trace.draws.slice(drawStart).filter(row=>row.at<=start+durationMs).map(row=>({...row,at:row.at-start,rafAt:row.rafAt===null?null:row.rafAt-start}));
  const canvas=[],allCanvas=[];let lastCanvas,lastAnyCanvas;
  for(const row of rawDraws){
   if(row.frame==null)continue;
   if(row.frame!==lastAnyCanvas){allCanvas.push(row);lastAnyCanvas=row.frame}
   if(row.mode==='worker'&&row.rafAt!==null&&row.frame!==lastCanvas){canvas.push(row);lastCanvas=row.frame}
  }
  const primary=before.mode==='worker'?canvas:native;
  const percentile=(values,fraction=.95)=>values.length?[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*fraction))]:null;
  function cadence(events,from,to){
   const rows=events.filter(row=>row.at>=from&&row.at<to),gaps=rows.slice(1).map((row,i)=>row.at-rows[i].at);
   return{updates:rows.length,updatesPerSecond:rows.length/((to-from)/1000),medianGapMs:percentile(gaps,.5),p95GapMs:percentile(gaps),maxGapMs:gaps.length?Math.max(...gaps):null};
  }
  const halves=[{direction:'forward',from:0,to:half},{direction:'reverse',from:half,to:durationMs}].map(({direction,from,to})=>{
   const steadyFrom=from+500,steadyLag=lag.filter(row=>row.at>=steadyFrom&&row.at<to),rate=cadence(primary,steadyFrom,to);
   return{direction,fullWindow:{raf:cadence(paints,from,to),selected:cadence(selected,from,to),canvasSubmissions:cadence(canvas,from,to),nativeCompositor:cadence(native,from,to),primary:cadence(primary,from,to)},
    steady:{raf:cadence(paints,steadyFrom,to),selected:cadence(selected,steadyFrom,to),canvasSubmissions:cadence(canvas,steadyFrom,to),nativeCompositor:cadence(native,steadyFrom,to),primary:rate,
     p95SelectedLagFrames:percentile(steadyLag.map(row=>row.selected)),p95CanvasLagFrames:percentile(steadyLag.map(row=>row.canvas).filter(Number.isFinite)),p95NativeLagFrames:percentile(steadyLag.map(row=>row.native).filter(Number.isFinite)),
     atLeast45UpdatesPerSecond:rate.updatesPerSecond>=45,atLeast60UpdatesPerSecond:rate.updatesPerSecond>=60}};
  });
  const after=sequence.stats;
  const memoryFields=['decoded','decodedBytes','compressedBytes','reservedBytes','pending','queued','network','peakDecoded','peakNetwork',...Object.keys(after).filter(key=>/worker.*(?:queue|pending|bytes|frames|peak)/i.test(key))];
  const memoryMaxima=Object.fromEntries([...new Set(memoryFields)].filter(key=>statsSamples.some(row=>Number.isFinite(row[key]))).map(key=>[key,Math.max(...statsSamples.map(row=>row[key]).filter(Number.isFinite))]));
  return{durationMs,sourceVelocityFramesPerSecond:sourceVelocity,rafGate:null,sourceWidth:before.sourceWidth,sourceHeight:before.sourceHeight,initialMode:before.mode,finalMode:after.mode,
   primaryMetric:before.mode==='worker'?'distinct-successful-canvas-draw-submissions-inside-native-RAF':'distinct-native-video-compositor-callbacks',
   compositorCaveat:'Canvas drawImage success records submission, not proof that a new frame reached the display compositor.',
   halves,rawDraws,canvasSubmissions:canvas,allCanvasSubmissions:allCanvas,nativeFrameCallbacks:native,rawNativeFrameCallbacks:rawNative,selectedUpdates:selected,rafPaints:paints,lagSamples:lag,statsSamples,memoryMaxima,
   canvasReadbacksDuringMotion:trace.readbacks-readbacksBefore,drawsOutsideRaf:rawDraws.filter(row=>row.rafAt===null).length,
   canvasDrawCountDelta:after.canvasDrawCount-before.canvasDrawCount,canvasDrawMsDelta:after.canvasDrawMs-before.canvasDrawMs,lastStats:after};
 });
}
async function functionalChecks(){
 const jumps=[];
 for(const target of [1400,200,700]){const began=Date.now();await settle(target);jumps.push({target,settledMs:Date.now()-began})}
 const reversalAt=Date.now();await page.evaluate(()=>window.scrollTo(0,1500*8));await page.waitForTimeout(200);await settle(400);
 const reversalMs=Date.now()-reversalAt;
 // Test application visibility handling explicitly; this does not emulate
 // operating-system backgrounding or browser background timer policy.
 await page.evaluate(()=>{
  window.workerBenchmark.visibilityDescriptors={hidden:Object.getOwnPropertyDescriptor(document,'hidden'),visibilityState:Object.getOwnPropertyDescriptor(document,'visibilityState')};
  window.scrollTo(0,1400*8);
  Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
  Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});
  document.dispatchEvent(new Event('visibilitychange'));
 });
 await page.waitForTimeout(50);
 const before=await page.evaluate(()=>({draws:window.workerBenchmark.draws.length,stats:window.sofacetPreview.sequence.stats}));
 await page.waitForTimeout(200);
 const hidden=await page.evaluate(()=>({draws:window.workerBenchmark.draws.length,stats:window.sofacetPreview.sequence.stats}));
 assert.equal(hidden.draws,before.draws,'Hidden journey must stop canvas submissions');
 await page.evaluate(()=>{
  for(const key of ['hidden','visibilityState']){const descriptor=window.workerBenchmark.visibilityDescriptors[key];if(descriptor)Object.defineProperty(document,key,descriptor);else delete document[key]}
  document.dispatchEvent(new Event('visibilitychange'));
 });
 await activateJourney();await settle(700);
 assert.equal(await page.locator('#game-page').getAttribute('src'),null,'Game must not load during mid-journey recovery');
 return{jumps,reversalMs,visibility:{kind:'synthetic-document-visibility-event',hiddenDraws:hidden.draws-before.draws,hiddenStats:hidden.stats,resumeFrame:700}};
}
async function capture(name){
 await settle(700);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const image=await page.evaluate(()=>{
  const canvas=document.querySelector('#journey-frame'),bounds=canvas.getBoundingClientRect(),stats=window.sofacetPreview.sequence.stats;
  return{frame:window.sofacetPreview.sequence.displayedFrame,canvasPresentedFrame:stats.canvasPresentedFrame,width:canvas.width,height:canvas.height,
   bounds:{x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height},hidden:canvas.hidden,opacity:getComputedStyle(canvas).opacity,dataURL:canvas.toDataURL('image/png')};
 });
 assert.equal(image.frame,700);assert.equal(image.canvasPresentedFrame,700);assert.equal(image.width,1920);assert.equal(image.height,1080);
 assert.equal(image.hidden,false);assert.equal(image.opacity,'1');
 assert.ok(image.bounds.width>=100&&image.bounds.height>=100,'Full HD canvas must occupy the stage');
 assert.ok(Math.abs(image.bounds.width/image.bounds.height-1920/1080)<.002,'Stage must preserve the Full HD aspect ratio and ball geometry');
 const framePath=prefix+'-'+name+'-frame700.png',viewportPath=prefix+'-'+name+'-'+(profile==='desktop'?'desktop':'phone')+'.png';
 await writeFile(framePath,Buffer.from(image.dataURL.split(',')[1],'base64'));await page.screenshot({path:viewportPath,type:'png',fullPage:false});
 pictures.set(name,image.dataURL);const {dataURL,...geometry}=image;return{...geometry,framePath,viewportPath,...(profile==='desktop'?{desktopPath:viewportPath}:{phonePath:viewportPath})};
}
async function comparePixels(reference,actual){
 return page.evaluate(async({reference,actual})=>{
  const images=await Promise.all([reference,actual].map(async src=>{const image=new Image();image.src=src;await image.decode();return image}));
  const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;const context=canvas.getContext('2d',{alpha:false});
  context.drawImage(images[0],0,0);const expected=context.getImageData(0,0,1920,1080).data;
  context.drawImage(images[1],0,0);const received=context.getImageData(0,0,1920,1080).data;
  let max=0,total=0,referenceRGB=0,actualRGB=0;
  for(let i=0;i<received.length;i++){const difference=Math.abs(received[i]-expected[i]);max=Math.max(max,difference);total+=difference;if(i%4!==3){referenceRGB+=expected[i];actualRGB+=received[i]}}
  return{frame:700,maxChannelDifference:max,meanChannelDifference:total/received.length,referenceRGB:referenceRGB/(1920*1080*3),actualRGB:actualRGB/(1920*1080*3),readbackOutsideTiming:true};
 },{reference,actual});
}
try{
 await mkdir(dirname(output),{recursive:true});
 if(!process.env.SOFACET_WORKER_URL){
  data=await mkdtemp(join(tmpdir(),'sofacet-worker-benchmark-'));
  server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:port,HOST:'127.0.0.1',DATA_DIR:data},stdio:['ignore','pipe','pipe']});
  let listening=false;
  server.stdout.on('data',chunk=>{process.stdout.write(chunk);if(String(chunk).includes(url))listening=true});server.stderr.on('data',chunk=>process.stderr.write(chunk));
  let ready=false;
  for(let attempt=0;attempt<100&&!ready;attempt++){
   if(server.exitCode!==null)throw Error('Dedicated worker benchmark server exited before startup');
   if(listening)try{ready=(await fetch(url+'/health')).ok}catch{}
   if(!ready)await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(ready&&server.exitCode===null,'Dedicated worker benchmark server must start');
 }
 for(const spec of allArms.filter(arm=>selectedArms.includes(arm.name))){
  const defaultSelection=useDefaultWorker&&spec.renderer==='worker';
  const result={name:spec.name,profile,requestedRenderer:spec.renderer,defaultSelection,workerUnavailableInjected:Boolean(spec.disableWorker),completed:false};results.push(result);
  // Fresh browser/context per arm releases prior decoder/GPU/cache state.
  // Both arms use the same server and normal HTTP cache with no routing.
  browser=await browserType.launch();const context=await browser.newContext(profile==='desktop'?{viewport:{width:1280,height:720},deviceScaleFactor:1}:devices[engine==='webkit'?'iPhone 13':'Pixel 7']);page=await context.newPage();
  // Exercise desktop cache policy on low-core CI hosts; this does not emulate
  // desktop decoder performance or change browser scheduling.
  if(profile==='desktop')await page.addInitScript(()=>{
   Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>8});
   Object.defineProperty(navigator,'deviceMemory',{get:()=>8});
  });
  const errors=[],networkFailures=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('requestfailed',request=>networkFailures.push({url:request.url(),error:request.failure()?.errorText}));
  await page.addInitScript(installInstrumentation,{disableWorker:Boolean(spec.disableWorker)});
  try{
   const pageURL=new URL(url);if(pageURL.pathname==='/')pageURL.pathname='/video';pageURL.searchParams.set('perf','1');
   if(defaultSelection)pageURL.searchParams.delete('renderer');else pageURL.searchParams.set('renderer',spec.renderer);
   await page.goto(pageURL.href,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>window.sofacetPreview&&(document.body.dataset.phase==='idle'||!document.querySelector('#enter').hidden),{},{timeout:60000});
   if(await page.locator('#enter').isVisible()){if(profile==='desktop')await page.locator('#enter').click();else await page.locator('#enter').tap()}
   await page.waitForFunction(()=>document.body.dataset.phase==='idle',{},{timeout:60000});await activateJourney();
   result.startStats=await page.evaluate(()=>window.sofacetPreview.sequence.stats);assertCacheProfile(result.startStats);
   assert.equal(result.startStats.requestedRenderer,spec.renderer,'Renderer query or main-URL default must reach the frame source');
   assert.equal(result.startStats.sourceWidth,1920);assert.equal(result.startStats.sourceHeight,1080);
   if(spec.name==='native'||spec.disableWorker)assert.equal(result.startStats.mode,'video','Explicit native and unsupported-worker cases must use native video');
   result.fallbackDetected=spec.renderer==='worker'&&result.startStats.mode!=='worker';
   if(!spec.disableWorker){
    result.motion=await measure();result.fallbackDetected||=spec.renderer==='worker'&&result.motion.finalMode!=='worker';
    for(const stats of result.motion.statsSamples){assertCacheProfile(stats);assert.ok(stats.decoded<=stats.settings.decoded,'Decoded frame cache must stay bounded');assert.ok(stats.decoded+stats.decoding<=stats.settings.decoded,'Retained and in-flight frames must share the decoded budget');if(stats.mode==='worker')assert.ok(stats.workerPending<=4,'Worker submissions must stay bounded');assert.ok(stats.compressedBytes+stats.reservedBytes<=stats.settings.compressedBytes,'Compressed cache and reservations must stay bounded')}
    if(result.motion.initialMode==='worker'){
     assert.equal(result.motion.finalMode,'worker','Worker errors during scrolling must not silently pass through native fallback');
     assert.equal(result.motion.canvasReadbacksDuringMotion,0,'Worker motion must not perform canvas RGBA readback');
     assert.ok(result.motion.canvasSubmissions.length>0,'Worker mode must submit actual source frames to canvas inside RAF');
     for(const draw of result.motion.canvasSubmissions){assert.equal(draw.sourceWidth,1920);assert.equal(draw.sourceHeight,1080)}
    }
    console.log('Worker/native cadence',JSON.stringify({name:spec.name,initialMode:result.motion.initialMode,finalMode:result.motion.finalMode,fallbackDetected:result.fallbackDetected,primaryMetric:result.motion.primaryMetric,halves:result.motion.halves,memoryMaxima:result.motion.memoryMaxima,canvasReadbacksDuringMotion:result.motion.canvasReadbacksDuringMotion,drawsOutsideRaf:result.motion.drawsOutsideRaf}));
   }
   result.functional=await functionalChecks();result.image=await capture(spec.name);
   if(result.motion?.initialMode==='worker'&&!result.fallbackDetected){
    result.functional.catchupLimitMs=5000;
    console.log('Worker catchup',JSON.stringify(result.functional));
    for(const jump of result.functional.jumps)assert.ok(jump.settledMs<=5000,'Worker jump to '+jump.target+' must settle within 5000 ms; observed '+jump.settledMs+' ms');
    assert.ok(result.functional.reversalMs<=5000,'Worker rapid reversal must settle within 5000 ms; observed '+result.functional.reversalMs+' ms');
   }
   if(spec.name!=='native'&&pictures.has('native')){
    result.quality=await comparePixels(pictures.get('native'),pictures.get(spec.name));console.log('Settled Full HD canvas pixel comparison',JSON.stringify({name:spec.name,...result.quality}));
    assert.ok(result.quality.referenceRGB>1&&result.quality.actualRGB>1&&result.quality.maxChannelDifference<=2&&result.quality.meanChannelDifference<=.05,'Settled worker/fallback canvas must preserve native frame pixels');
   }else if(spec.name!=='native'){
    result.quality={skipped:true,reason:'Native arm omitted for focused measurement. Full comparison is required before final validation.'};
   }
   result.endStats=await page.evaluate(()=>window.sofacetPreview.sequence.stats);assertCacheProfile(result.endStats);
   if(spec.renderer==='worker'&&result.endStats.mode!=='worker')result.fallbackDetected=true;
   if(spec.disableWorker)assert.equal(result.endStats.mode,'video','Unavailable Worker must keep native fallback operational');
   if(result.motion?.initialMode==='worker')assert.equal(result.endStats.mode,'worker','Worker must remain operational through recovery and pixel checks');
   result.networkFailures=networkFailures;result.pageErrors=errors;assert.deepEqual(errors,[]);result.completed=true;
  }catch(error){
   result.error={name:error.name,message:error.message};result.networkFailures=networkFailures;result.pageErrors=errors;
   console.error('Worker benchmark state',await page.evaluate(()=>({phase:document.body.dataset.phase,stats:window.sofacetPreview?.sequence?.stats})));throw error;
  }finally{await context.close();await browser.close();browser=undefined;page=undefined}
 }
 completed=true;
 const worker=results.find(result=>result.name==='worker'),exercised=worker?.motion?.initialMode==='worker'&&!worker.fallbackDetected;
 console.log('Worker experiment outcome',JSON.stringify({functionalChecksPassed:true,fullComparison,settledPixelComparisonPassed:fullComparison,experimentExercised:exercised,atLeast45CanvasSubmissionsPerSecondBothDirections:Boolean(exercised&&worker.motion.halves.every(half=>half.steady.atLeast45UpdatesPerSecond)),atLeast60CanvasSubmissionsPerSecondBothDirections:Boolean(exercised&&worker.motion.halves.every(half=>half.steady.atLeast60UpdatesPerSecond)),compositorRateProven:false}));
 if(process.env.SOFACET_WORKER_REQUIRE==='1')assert.ok(exercised,'Experimental worker path must actually run');
}catch(error){completed=false;failure={name:error.name,message:error.message};throw error}
finally{
 await browser?.close();if(server){server.kill();await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve))}if(data)await rm(data,{recursive:true,force:true});
 const worker=results.find(result=>result.name==='worker'),exercised=Boolean(worker?.motion?.initialMode==='worker'&&!worker.fallbackDetected);
 await writeFile(output,JSON.stringify({engine,profile,desktopCapabilityOverride:profile==='desktop'?{hardwareConcurrency:8,deviceMemory:8}:null,url,selectedArms,useDefaultWorker,fullComparison,completed,error:failure||null,networkPolicy:'fresh browser/context per arm; no routing; normal HTTP cache',
  measurementNote:'Worker counts successful canvas drawImage submissions inside native RAF. Native counts distinct real requestVideoFrameCallback frames. These are different presentation boundaries; worker compositor delivery is not proven. No RAF rate gate is applied. Pixel readback and screenshots occur after timing.',
  goal:{experimentExercised:exercised,atLeast45CanvasSubmissionsPerSecondBothDirections:Boolean(completed&&exercised&&worker.motion.halves.every(half=>half.steady.atLeast45UpdatesPerSecond)),atLeast60CanvasSubmissionsPerSecondBothDirections:Boolean(completed&&exercised&&worker.motion.halves.every(half=>half.steady.atLeast60UpdatesPerSecond)),compositorRateProven:false},results},null,2)+'\n');
}
