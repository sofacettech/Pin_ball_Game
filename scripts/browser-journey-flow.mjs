import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const require=createRequire(import.meta.url);
const engine=process.env.SOFACET_BROWSER||'chromium';
const profile=process.env.SOFACET_DEVICE||'desktop';
const {[engine]:browserType,devices}=require(process.env.SOFACET_PLAYWRIGHT_PATH||'playwright');
const url='http://127.0.0.1:8769';
let server,browser,data;
try{
 data=await mkdtemp(join(tmpdir(),'sofacet-flow-'));
 server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'8769',HOST:'127.0.0.1',DATA_DIR:data},stdio:'inherit'});
 let started=false;
 for(let i=0;i<100&&!started;i++){
  try{started=(await fetch(url+'/health')).ok}catch{}
  if(!started)await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.ok(started,'Preview server did not start');
 browser=await browserType.launch();
 const context=await browser.newContext(profile==='desktop'?{viewport:{width:1280,height:720}}:devices[engine==='webkit'?'iPhone 13':'Pixel 7']);
 const page=await context.newPage(),errors=[],requests=[];
 // Hosted runners expose few cores even with a desktop viewport. Exercise
 // the normal desktop cache as well as the separate constrained mobile path.
 if(profile==='desktop')await page.addInitScript(()=>{
  Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>8});
  Object.defineProperty(navigator,'deviceMemory',{get:()=>8});
 });
 if(process.env.SOFACET_FORCE_NATIVE==='1')await page.addInitScript(()=>{globalThis.VideoDecoder=undefined});
 page.on('pageerror',error=>errors.push(error.message));
 page.on('response',response=>{
  if(response.url().includes('/videos/'))requests.push({url:response.url(),status:response.status()});
 });
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.sofacetPreview&&(document.body.dataset.phase==='idle'||!document.querySelector('#enter').hidden),{},{timeout:60000});
 if(await page.locator('#enter').isVisible())await page.locator('#enter').click();
 await page.waitForFunction(()=>document.body.dataset.phase==='idle',{},{timeout:30000});
 // No position jumps, reloads, pauses or cache warm-up between sections.
 // Start immediately after the real opening/buffering sequence and traverse
 // the whole journey at one source frame per 8 scroll pixels, 60 frames/sec.
 const result=await page.evaluate(async()=>{
  const sequence=window.sofacetPreview.sequence,end=sequence.frameCount-2;
  const bins=Array.from({length:8},(_,i)=>({fromPercent:i*12.5,toPercent:(i+1)*12.5,gaps:[],lags:[],updates:0,maxBytes:0,maxDecoded:0}));
  const start=performance.now();let lastFrame=0,lastUpdate=start,lastStats=start,maxJump=0,earlyGame=false,limitExceeded=false;
  let stats=sequence.stats;
  await new Promise(resolve=>{
   function tick(now){
    const desired=Math.min(end,Math.floor((now-start)*.06));
    window.scrollTo(0,desired*8);
    const shown=sequence.displayedFrame;
    const bin=bins[Math.min(7,Math.floor(shown/sequence.frameCount*8))];
    if(shown!==lastFrame){
     bin.gaps.push(now-lastUpdate);bin.updates++;
     maxJump=Math.max(maxJump,Math.abs(shown-lastFrame));lastFrame=shown;lastUpdate=now;
    }
    bin.lags.push(Math.max(0,desired-shown));
    if(now-lastStats>=250){
     stats=sequence.stats;lastStats=now;
     bin.maxBytes=Math.max(bin.maxBytes,stats.compressedBytes+stats.reservedBytes);
     bin.maxDecoded=Math.max(bin.maxDecoded,stats.decoded);
     limitExceeded ||= stats.compressedBytes+stats.reservedBytes>stats.settings.compressedBytes||stats.decoded>stats.settings.decoded;
     earlyGame ||= !!document.querySelector('#game-page').getAttribute('src');
    }
    if(shown===end||now-start>45000)resolve();else requestAnimationFrame(tick);
   }
   requestAnimationFrame(tick);
  });
  const percentile=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length*.95)]||0;
  return{elapsedMs:performance.now()-start,displayed:sequence.displayedFrame,end,maxJump,earlyGame,limitExceeded,
   bins:bins.map(({gaps,lags,...bin})=>({...bin,p95GapMs:percentile(gaps),maxGapMs:Math.max(0,...gaps),p95LagFrames:percentile(lags),maxLagFrames:Math.max(0,...lags)})),stats:sequence.stats};
 });
 console.log('Uninterrupted R2 journey',JSON.stringify({engine,profile,forceNative:process.env.SOFACET_FORCE_NATIVE==='1',...result}));
 assert.equal(result.stats.settings.decoded,profile==='desktop'?8:4,'The intended desktop/mobile buffer profile must be exercised');
 assert.equal(result.displayed,result.end,'The uninterrupted journey must reach the ending');
 assert.equal(result.earlyGame,false,'Game startup must not compete with any part of the journey');
 assert.equal(result.limitExceeded,false,'Memory limits must hold throughout the journey');
 if(profile==='mobile'&&result.stats.mode==='video')for(const bin of result.bins)assert.ok(bin.p95LagFrames<120,`Native scroll lag must remain bounded in ${bin.fromPercent}-${bin.toPercent}%`);
 else assert.ok(result.maxJump<=4,'The desktop/WebCodecs journey must retain frame continuity');
 for(const bin of result.bins){
  assert.ok(bin.updates>30,`Missing frame delivery in ${bin.fromPercent}-${bin.toPercent}%`);
  assert.ok(bin.maxGapMs<500,`A half-second stall occurred in ${bin.fromPercent}-${bin.toPercent}%`);
 }
 const firstHalfLag=Math.max(...result.bins.slice(1,4).map(bin=>bin.p95LagFrames));
 for(const bin of result.bins.slice(4))assert.ok(bin.p95LagFrames<=firstHalfLag+30,`Scroll lag accumulated after halfway: ${bin.fromPercent}-${bin.toPercent}%`);
 if(process.env.MEDIA_CDN_BASE_URL)assert.ok(requests.some(request=>request.url.startsWith(process.env.MEDIA_CDN_BASE_URL+'/videos/')&&request.status===206),'The test must exercise the actual R2 video ranges');
 await page.evaluate(()=>window.scrollTo(0,window.sofacetPreview.sequence.travel));
 await page.waitForFunction(()=>document.body.dataset.game==='visible',{},{timeout:30000});
 assert.deepEqual(errors,[]);
 console.log('Opening, all eight journey sections and final game handoff passed.',JSON.stringify({engine,profile,videoResponses:requests.length}));
 await context.close();
}finally{
 await browser?.close();
 if(server){server.kill();await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve))}
 if(data)await rm(data,{recursive:true,force:true});
}
