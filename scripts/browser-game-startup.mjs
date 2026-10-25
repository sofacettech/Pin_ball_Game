// Functional startup gates plus measured, non-gating timing comparisons.
// The iframe exercises the real loader's parent visibility contract; the full
// browser-journey-flow test separately covers the video-to-game handoff.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {createHash} from 'node:crypto';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.SOFACET_PLAYWRIGHT_PATH||'playwright');
const root=process.cwd(),port=Number(process.env.SOFACET_GAME_STARTUP_PORT||8774),url=`http://127.0.0.1:${port}`;
const outputPath=resolve(process.env.SOFACET_GAME_STARTUP_OUTPUT||join(tmpdir(),'game-startup.json'));
const baseline=process.env.SOFACET_GAME_BASELINE_REF||'533fb037ae6ce0eaabd4f873d2a83e015370f72b';
const report={scope:'Fresh Chromium per arm, shader disk cache disabled, identical JS/CSS routing, real native RAF, local assets. Timings are measurements, not performance pass thresholds.',baseline,arms:[]};
let server,browser,data,deadline,aborted=false;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function save(){await mkdir(dirname(outputPath),{recursive:true});await writeFile(outputPath,JSON.stringify(report,null,2))}
async function snapshot(ref){
 const read=path=>ref?Promise.resolve(execFileSync('git',['show',`${ref}:${path.slice(1)}`],{cwd:root,maxBuffer:32*1024*1024})):readFile(join(root,path));
 const files=new Map(),html=await read('/play.html');
 const names=new Set(['/play.html',...Array.from(html.toString().matchAll(/(?:href|src|data-game-entry)="([^"]+)"/g),m=>new URL(m[1],url+'/play.html').pathname).filter(p=>p.startsWith('/assets/')&&/\.(js|css)$/.test(p))]);
 for(const path of names){
  const bytes=await read(path);files.set(path,bytes);
  // Vite's shared entry and dedicated texture worker must be frozen too.
  if(path.endsWith('.js'))for(const m of bytes.toString().matchAll(/(?:sofacet-game(?:-chunk)?|floor-texture\.worker)-[a-zA-Z0-9_-]+\.js/g))names.add('/assets/'+m[0]);
 }
 const entry=new URL(/data-game-entry="([^"]+)"/.exec(html.toString())[1],url+'/play.html').pathname;
 return {files,entry,ref:ref||execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),hashes:Object.fromEntries([...files].map(([p,b])=>[p,{bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')}]))};
}
function probe(){
 if(location.pathname!=='/play.html')return;
 const u=new URL(location.href);u.searchParams.set('review','1');history.replaceState(null,'',u);
 const p=window.__gameStartup={events:[],longTasks:[],loaf:[],shaderWait:{calls:0,totalMs:0,maxMs:0,slow:[]},workers:[]};
 const mark=(name,detail)=>p.events.push({name,detail,at:performance.now()});window.__gameStartupMark=mark;
 try{new PerformanceObserver(list=>{for(const e of list.getEntries())p.longTasks.push({start:e.startTime,duration:e.duration})}).observe({type:'longtask',buffered:true})}catch{}
 try{new PerformanceObserver(list=>{for(const e of list.getEntries())p.loaf.push({start:e.startTime,duration:e.duration,blockingDuration:e.blockingDuration,scripts:e.scripts.map(s=>({duration:s.duration,invoker:s.invoker,sourceURL:s.sourceURL,sourceFunctionName:s.sourceFunctionName,sourceCharPosition:s.sourceCharPosition}))})}).observe({type:'long-animation-frame',buffered:true})}catch{}
 const proto=window.WebGL2RenderingContext?.prototype,original=proto?.getProgramInfoLog;
 if(original)proto.getProgramInfoLog=function(...args){const at=performance.now();try{return original.apply(this,args)}finally{const ms=performance.now()-at,s=p.shaderWait;s.calls++;s.totalMs+=ms;s.maxMs=Math.max(s.maxMs,ms);if(ms>=10)s.slow.push({at,ms})}};
 if(window.Worker){const NativeWorker=window.Worker;window.Worker=class extends NativeWorker{
  constructor(...args){super(...args);this.record={url:String(args[0]),createdAt:performance.now(),messages:[]};p.workers.push(this.record);this.addEventListener('message',e=>this.record.messages.push({at:performance.now(),type:e.data?.type,width:e.data?.texture?.width,height:e.data?.texture?.height}));this.addEventListener('error',e=>{this.record.error=e.message})}
  terminate(){this.record.terminatedAt=performance.now();return super.terminate()}
 }}
 document.addEventListener('click',e=>{const id=e.target.closest?.('button')?.id;if(['start','restart','nav-toggle'].includes(id))mark('click:'+id,{trusted:e.isTrusted})},true);
 let ready=false,hidden=false,phrase='';
 new MutationObserver(()=>{
  if(!ready&&document.querySelector('#stage')?.dataset.ready==='true'){ready=true;p.shaderWaitAtReady=structuredClone(p.shaderWait);mark('ready')}
  if(!hidden&&document.querySelector('#game-loading-screen')?.hidden){hidden=true;mark('loader-hidden')}
  const text=document.querySelector('.loading-phrase')?.textContent||'';if(text&&text!==phrase){phrase=text;mark('phrase',text)}
 }).observe(document,{subtree:true,attributes:true,childList:true,characterData:true});
 function shellFrame(){const el=document.querySelector('#game-loading-screen'),parentVisible=window.parent===window||window.parent.getComputedStyle(window.frameElement).visibility!=='hidden';const visible=!!el&&!el.hidden&&el.getBoundingClientRect().width>0&&getComputedStyle(el).visibility!=='hidden'&&parentVisible;if(visible)mark('shell-raf',{visible});else requestAnimationFrame(shellFrame)}requestAnimationFrame(shellFrame);
}
function summarize(p){
 const ready=p.events.find(e=>e.name==='ready')?.at,hidden=p.events.find(e=>e.name==='loader-hidden')?.at;
 const startup=p.longTasks.filter(e=>e.start<=ready),click=p.events.find(e=>e.name==='click:start'),active=p.events.find(e=>e.name==='play-ready');
 return{timeToReadyMs:ready,loaderHiddenMs:hidden,clickToActiveMs:active?.at-click?.at,startupMaxTaskMs:Math.max(0,...startup.map(t=>t.duration)),startupTotalBlockingMs:startup.reduce((s,t)=>s+Math.max(0,t.duration-50),0),startupShaderWait:p.shaderWaitAtReady||null,totalShaderWait:p.shaderWait,workers:p.workers,events:p.events,longTasks:p.longTasks,loaf:p.loaf};
}
async function arm(label,frozen,embedded){
 const result={label,embedded,ref:frozen.ref,assets:frozen.hashes,errors:[],httpErrors:[],shellAtEntry:null,functional:{}};report.arms.push(result);
 assert.equal(aborted,false,'Startup benchmark was cancelled');
 browser=await chromium.launch({args:['--disable-gpu-shader-disk-cache']});
 if(aborted){await browser.close();browser=null;throw Error('Startup benchmark was cancelled during browser launch')}
 const context=await browser.newContext({viewport:{width:1280,height:720}});await context.addInitScript(probe);
 const page=await context.newPage();page.setDefaultTimeout(20000);
 page.on('pageerror',e=>result.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')result.errors.push(m.text())});
 page.on('response',r=>{if(r.status()>=400)result.httpErrors.push({url:r.url(),status:r.status()})});
 let entryRequests=0;
 for(const [path,body] of frozen.files)await context.route(url+path+'*',async route=>{
  if(path===frozen.entry){entryRequests++;result.shellAtEntry=await route.request().frame().evaluate(()=>{const shell=document.querySelector('#game-loading-screen');return{at:performance.now(),visible:!!shell&&!shell.hidden&&shell.getBoundingClientRect().width>0&&getComputedStyle(shell).visibility!=='hidden'&&(window.parent===window||window.parent.getComputedStyle(window.frameElement).visibility!=='hidden'),stageReady:document.querySelector('#stage')?.dataset.ready==='true',shellRaf:window.__gameStartup.events.find(e=>e.name==='shell-raf')}})}
  await route.fulfill({status:200,body,contentType:path.endsWith('.html')?'text/html':path.endsWith('.css')?'text/css':'text/javascript'});
 });
 await context.route(url+'/__game-startup-host',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body style="margin:0"><iframe id="game-frame" title="Game" style="position:absolute;inset:0;width:100%;height:100%;border:0;visibility:hidden" src="/play.html?from=chess&review=1"></iframe></body></html>'}));
 let game;
 try{
  if(embedded){
   await page.goto(url+'/__game-startup-host',{waitUntil:'load'});game=page.frames().find(f=>new URL(f.url()).pathname==='/play.html');assert.ok(game);
   await delay(200);result.hiddenEntryRequests=entryRequests;
   if(label==='current')assert.equal(entryRequests,0,'An inactive embedded game must not import the game bundle');
   await page.evaluate(()=>{const f=document.querySelector('#game-frame');f.style.visibility='visible';f.contentWindow.postMessage({type:'sofacet:experience-visibility',visible:true},location.origin)});
  }else{await page.goto(url+'/play.html?review=1',{waitUntil:'domcontentloaded'});game=page.mainFrame()}
  await game.waitForFunction(()=>window.__facet?.ready()&&document.querySelector('#stage')?.dataset.ready==='true',null,{timeout:60000});
  result.functional.ready=true;
  if(label==='current'||!embedded){
   assert.ok(result.shellAtEntry?.visible,'Loading shell must be visible before entry module executes');
   assert.ok(result.shellAtEntry?.shellRaf?.detail.visible,'The shell must get a RAF before the game entry request');
  }
  await game.waitForFunction(()=>document.querySelector('#game-loading-screen')?.hidden,null,{timeout:40000});
  result.functional.loaderHidden=true;
  await game.locator('#start').click();
  await game.waitForFunction(()=>!document.querySelector('#stage').classList.contains('showing-play')&&window.__facet.pose().state==='launcher'&&!window.__facet.pose().paused,null,{timeout:20000});
  await game.evaluate(()=>window.__gameStartupMark('play-ready'));result.functional.firstPlay=true;
  // Focus the actual control, then let the intentional release latch see an
  // unpressed physics tick before sending trusted key events.
  await game.evaluate(()=>document.querySelector('#game').focus());
  await game.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.keyboard.down('Space');
  try{await game.waitForFunction(()=>window.__facet.pose().state==='charging',null,{timeout:10000});await delay(250)}finally{await page.keyboard.up('Space')}
  await game.waitForFunction(()=>window.__facet.pose().launches>0,null,{timeout:10000});result.functional.launch=true;
  await page.keyboard.press('Escape');await game.waitForFunction(()=>window.__facet.pose().paused,null,{timeout:10000});result.functional.pause=true;
  await game.locator('#nav-toggle').click();await game.locator('#restart').click();
  await game.waitForFunction(()=>window.__facet.pose().state==='launcher'&&window.__facet.pose().launches===0&&!window.__facet.pose().paused,null,{timeout:20000});result.functional.restart=true;
  await game.evaluate(()=>window.__gameStartupMark('restart-ready'));
  const p=await game.evaluate(()=>structuredClone(window.__gameStartup));result.measurement=summarize(p);
  assert.deepEqual(result.errors,[],'No page or shader console errors');assert.deepEqual(result.httpErrors,[],'All game assets and local API calls must succeed');
  if(label==='current'){
   const workers=p.workers.filter(w=>w.url.includes('floor-texture.worker-'));
   assert.equal(workers.length,1,'The floor texture must decode in one real worker');
   assert.ok(workers[0].messages.some(m=>m.type==='decoded'&&m.width>0&&m.height>0),'The worker must return decoded texture data');
   assert.ok(Number.isFinite(workers[0].terminatedAt),'The floor worker must terminate after decoding');
   assert.equal(workers[0].error,undefined,'The worker must not silently fall back');
  }
  if(embedded){
   assert.deepEqual(p.events.filter(e=>e.name==='phrase').map(e=>e.detail),['Your points could become something precious','Every 10 points gets you ₹1 closer to your first diamond.','Play well. Save your points. Shine later.'],'The three reward statements must remain in order');
   const last=p.events.filter(e=>e.name==='phrase').at(-1);assert.ok(last.at<result.measurement.loaderHiddenMs,'The final reward statement must precede the game reveal');
  }
  result.passed=true;
 }catch(error){result.failure=error.message;if(game)result.measurement=await game.evaluate(()=>window.__gameStartup).then(summarize).catch(()=>null);throw error}
 finally{await save();await browser.close();browser=null}
 console.log(JSON.stringify({label,embedded,passed:result.passed,functional:result.functional,...Object.fromEntries(Object.entries(result.measurement).filter(([k])=>!['events','longTasks','loaf'].includes(k)))}));
}
async function run(){
 const before=await snapshot(baseline),current=await snapshot(null);await save();assert.equal(aborted,false,'Startup benchmark was cancelled');
 data=await mkdtemp(join(tmpdir(),'sofacet-game-startup-'));
 server=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DATA_DIR:data,MEDIA_CDN_BASE_URL:''},stdio:['ignore','pipe','pipe']});
 let log='';server.stdout.on('data',b=>log+=b);server.stderr.on('data',b=>log+=b);
 let ready=false;for(let i=0;i<100&&!ready;i++){assert.equal(server.exitCode,null,'Owned server exited: '+log);try{ready=(await fetch(url+'/health')).ok}catch{}if(!ready)await delay(100)}
 assert.ok(ready,'Local server starts');await delay(100);assert.equal(server.exitCode,null,'Use our own temporary-data server');
 // No simultaneous browsers and no shared shader cache between arms.
 const failures=[];
 arms: for(const embedded of [false,true])for(const [label,snap] of [['baseline',before],['current',current]]){
  if(aborted)break arms;
  try{await arm(label,snap,embedded)}catch(error){failures.push(`${label}/${embedded?'embedded':'standalone'}: ${error.message}`);if(aborted)break arms}
 }
 assert.equal(aborted,false,'Startup benchmark was cancelled');assert.deepEqual(failures,[],'Startup functional gates');report.passed=true;
}
try{await Promise.race([run(),new Promise((_,reject)=>{deadline=setTimeout(()=>{aborted=true;reject(Error('Startup benchmark exceeded its eight-minute bound'))},480000)})])}
catch(error){report.failure=error.message;throw error}
finally{clearTimeout(deadline);await save();await browser?.close();if(server){server.kill();await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve))}if(data)await rm(data,{recursive:true,force:true})}
