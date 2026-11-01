import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createJourneyScrollMap} from '../entrance-source/journey-scroll.mjs';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),engine=process.env.SOFACET_BROWSER||'chromium';
const {[engine]:type,devices}=require(process.env.SOFACET_PLAYWRIGHT_PATH||'playwright');
const deviceName=process.env.SOFACET_DEVICE;
if(deviceName&&!devices[deviceName])throw Error('Unknown emulated device: '+deviceName);
const {defaultBrowserType,...device}=deviceName?devices[deviceName]:{viewport:{width:393,height:852},deviceScaleFactor:1,hasTouch:true,isMobile:true};
const base=process.env.SOFACET_MOTION_URL||process.env.SOFACET_ENTRANCE_URL||'http://127.0.0.1:8766/';
const name=process.env.SOFACET_MOTION_NAME||'continuous';
const options=(process.env.SOFACET_OPTIONS||'2').split(',');
const framing=JSON.parse(await readFile(new URL('../assets/ball-framing.json',import.meta.url)));
const map=createJourneyScrollMap(),out=new URL(`../work/entrance-motion/${name}-${engine}/`,import.meta.url);await mkdir(out,{recursive:true});
const browser=await type.launch({...engine==='chromium'?{args:['--enable-gpu']}:{} });
const report=[];
try{for(const option of options){
 const context=await browser.newContext({...device,reducedMotion:'no-preference'});
 const page=await context.newPage();const errors=[],network=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('requestfinished',async request=>{const response=await request.response();network.push({url:request.url(),range:request.headers().range,status:response?.status(),bytes:response?.headers()['content-length'],timing:request.timing()})});
 if(engine==='chromium'&&(process.env.SOFACET_NETWORK_MBPS||process.env.SOFACET_CPU_RATE)){
  const session=await context.newCDPSession(page);
  if(process.env.SOFACET_CPU_RATE)await session.send('Emulation.setCPUThrottlingRate',{rate:Number(process.env.SOFACET_CPU_RATE)});
  if(process.env.SOFACET_NETWORK_MBPS)await session.send('Network.emulateNetworkConditions',{offline:false,latency:80,downloadThroughput:Number(process.env.SOFACET_NETWORK_MBPS)*1e6/8,uploadThroughput:1e6,connectionType:'cellular4g'});
 }
 await page.addInitScript(()=>{
  const stats=window.motionVideoStats={draws:[],seeks:[]};
  const original=document.createElement.bind(document),videos=new WeakMap();
  document.createElement=function(tag,...args){const el=original(tag,...args);if(tag==='video'){
   const v={start:0,metadataTime:null};videos.set(el,v);
   el.addEventListener('seeking',()=>v.start=performance.now());
   el.addEventListener('seeked',()=>stats.seeks.push({ms:performance.now()-v.start,time:el.currentTime}));
   if(el.requestVideoFrameCallback){const tick=(_,meta)=>{v.metadataTime=meta.mediaTime;el.requestVideoFrameCallback(tick)};el.requestVideoFrameCallback(tick)}
  }return el};
  const draw=CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage=function(source,...args){const result=draw.call(this,source,...args);if(source instanceof HTMLVideoElement)stats.draws.push({at:performance.now(),time:source.currentTime,metadataTime:videos.get(source)?.metadataTime});return result};
 });
 const url=new URL(base);url.searchParams.set('entrance',option);
 await page.goto(url.href);
 await page.waitForFunction(()=>window.entrancePreview?.ready&&window.entrancePreview.phase==='idle',null,{timeout:180000});
 if(process.env.SOFACET_EXPECT_ENTRANCE_STREAMING==='1')assert.equal(await page.evaluate(()=>window.entrancePreview.quality.streaming),true);
 if(process.env.SOFACET_EXPECT_ENTRANCE_PREVIEW==='1')assert.equal(await page.evaluate(()=>window.entrancePreview.quality.preview),true);
 const runs=[];
 const entry=process.env.SOFACET_MOTION_FULL_ENTRY==='1'?[[334,1100,12000],[1100,334,12000]]:[[600,1100,8000],[1100,600,8000]];
 const legs=process.env.SOFACET_MOTION_CHESS==='1'?[[1700,2163,8000],[2163,1700,8000],[1700,2163,2000],[2163,1700,2000]]:[...entry,[1300,1740,6000],[1740,1300,6000]];
 if(process.env.SOFACET_MOTION_FAST_FIRST==='1')legs.unshift(...legs.splice(2,2));
 for(const [from,to,duration] of legs){
  await page.evaluate(y=>scrollTo(0,y),map.scrollAtFrame(from));
  await page.waitForFunction(f=>Math.abs(window.entrancePreview.frame-f)<.3&&window.entrancePreview.settled,from,{timeout:30000});
  const points=Array.from({length:Math.ceil(duration/16)+1},(_,i)=>map.scrollAtFrame(from+(to-from)*Math.min(1,i*16/duration)));
  const samples=await page.evaluate(({points,duration,framing})=>new Promise(resolve=>{
   const rows=[];let started;
   const step=now=>{started??=now;const elapsed=now-started,t=Math.min(duration,elapsed),idx=Math.min(points.length-1,Math.floor(t/16));scrollTo(0,points[idx]);
    const p=window.entrancePreview,r=document.getElementById('scene-viewport').getBoundingClientRect(),stage=document.getElementById('scene-frame');
    const transform=new DOMMatrixReadOnly(getComputedStyle(stage).transform),shown=p.displayedFrame;
    const i=Math.floor(shown),j=Math.min(i+1,framing.points.length-1),focus=framing.points[i].map((v,n)=>v+(framing.points[j][n]-v)*(shown-i));
    const scale=Math.max(r.width/1920,r.height/1080),w=1920*scale,h=1080*scale;
    const x=Math.max(r.width-w,Math.min(0,r.width/2-focus[0]*w)),y=Math.max(r.height-h,Math.min(0,r.height/2-focus[1]*h));
    rows.push({at:now,frame:p.frame,shown,stageX:transform.m41,stageY:transform.m42,expectedX:x,expectedY:y,settled:p.settled,preview:!!p.quality.previewVisible});
    if(elapsed<duration)requestAnimationFrame(step);else resolve(rows);
   };requestAnimationFrame(step);
  }),{points,duration,framing});
  const active=samples.filter(r=>r.at>samples[0].at+300),updates=active.filter((r,i)=>i&&r.shown!==active[i-1].shown);
  const boundaries=[active[0].at,...updates.map(r=>r.at),active.at(-1).at];
  const intervals=boundaries.slice(1).map((at,i)=>at-boundaries[i]).sort((a,b)=>a-b);
  const cropErrors=['2','3'].includes(option)?active.map(r=>Math.hypot(r.stageX-r.expectedX,r.stageY-r.expectedY)).sort((a,b)=>a-b):[];
  const frozenMoving=active.filter((r,i)=>i&&r.shown===active[i-1].shown&&Math.abs(r.stageX-active[i-1].stageX)>.1).length;
  const backwards=updates.filter((r,i)=>i&&(r.shown-updates[i-1].shown)*Math.sign(to-from)<-.5).length;
  const summary={from,to,updatesPerSecond:updates.length/((active.at(-1).at-active[0].at)/1000),p95UpdateGapMs:intervals[Math.floor(intervals.length*.95)],maxUpdateGapMs:Math.max(...intervals),cropErrorP95:cropErrors[Math.floor(cropErrors.length*.95)]??null,maxCropError:cropErrors.at(-1)??null,frozenImageMovingCropFrames:frozenMoving,backwards,previewFraction:active.filter(row=>row.preview).length/active.length};
  console.log(JSON.stringify({option,...summary}));runs.push({...summary,samples});
  await writeFile(new URL(`option-${option}.json`,out),JSON.stringify({option,engine,device:deviceName||null,runs,network,errors}));
  if(['2','3'].includes(option)&&process.env.SOFACET_CHECK_MOTION==='1'){assert.ok(updates.length>0,'The video must present frames while scrolling');assert.ok(summary.maxCropError<1,'The crop must match the displayed frame');assert.equal(summary.frozenImageMovingCropFrames,0,'Frozen video must not slide across the viewport');assert.equal(summary.backwards,0,'Monotonic input must not reverse presented frames');}
  if(process.env.SOFACET_MAX_VIDEO_STALL_MS&&['2','3'].includes(option))assert.ok(summary.maxUpdateGapMs<=Number(process.env.SOFACET_MAX_VIDEO_STALL_MS),`Video stalled for ${summary.maxUpdateGapMs}ms`);
  if(['2','3'].includes(option)){
   await page.waitForFunction(frame=>Math.abs(window.entrancePreview.frame-frame)<.3&&window.entrancePreview.settled,to,{timeout:30000});
   assert.notEqual(await page.evaluate(()=>window.entrancePreview.quality.previewVisible),true,'Every resting pose must refine to full resolution');
   if(process.env.SOFACET_EXPECT_ENTRANCE_WIDTH)assert.equal(await page.evaluate(()=>window.entrancePreview.quality.sourceWidth),Number(process.env.SOFACET_EXPECT_ENTRANCE_WIDTH));
  }
 }
 await page.screenshot({path:new URL(`option-${option}.png`,out).pathname});
 assert.deepEqual(errors,[]);
 if(process.env.SOFACET_EXPECT_ENTRANCE_STREAMING==='1')assert.equal(await page.evaluate(()=>window.entrancePreview.quality.streaming),true,'Motion must stay on the streamed decoder');
 const result={option,engine,device:deviceName||null,runs,network,video:await page.evaluate(()=>window.motionVideoStats),errors};
 report.push(result);await writeFile(new URL(`option-${option}.json`,out),JSON.stringify(result));await context.close();
}}finally{await browser.close()}
await writeFile(new URL('summary.json',out),JSON.stringify(report.map(({option,engine,device,runs,errors})=>({option,engine,device,runs:runs.map(({samples,...r})=>r),errors})),null,2));
