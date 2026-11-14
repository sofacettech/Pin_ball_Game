import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url),engine=process.env.SOFACET_BROWSER||'chromium';
assert.ok(['chromium','webkit'].includes(engine),'Use a supported entrance browser');
const {[engine]:browserType,devices}=require(process.env.SOFACET_PLAYWRIGHT_PATH||'playwright');
const root=fileURLToPath(new URL('../',import.meta.url));
const port=process.env.SOFACET_CONNECTION_PORT||(engine==='webkit'?'8775':'8774');
const origin=`http://127.0.0.1:${port}`,cdn='https://media.example',MiB=1024*1024;
const output=new URL('../work/video-connection/',import.meta.url);
await mkdir(output,{recursive:true});

// Representative budgets make the remaining-download decision realistic. The
// browser receives timed prefixes at the real media URLs; every journey stays
// incomplete, so no fake MP4 reaches a decoder and no large file is downloaded.
const local=JSON.parse(await readFile(new URL('../assets/entrance-video/manifest.json',import.meta.url)));
const hd=structuredClone(local);
hd.clips.opening.bytes=1_823_721;hd.clips.journey.bytes=62_000_000-hd.clips.opening.bytes;
for(const kind of ['opening','journey'])hd.clips[kind].file=`entrance-${kind}-${hd.clips[kind].sha256}.mp4`;
const ultra={...structuredClone(hd),width:3840,height:2160};
ultra.clips.opening.bytes=8_652_215;ultra.clips.journey.bytes=191_246_413;
const mediaFiles=[...Object.entries({hd,'4k':ultra}).flatMap(([variant,manifest])=>['opening','journey'].map(kind=>({variant,kind,url:`${cdn}/${variant}/${manifest.clips[kind].file}`,bytes:manifest.clips[kind].bytes}))),
 ...['opening','journey'].map(kind=>({variant:'local',kind,url:`${origin}/assets/entrance-video/${kind}.mp4`,bytes:local.clips[kind].bytes}))];
const fast={effectiveType:'4g',downlink:100,saveData:false};
const cases=[
 {name:'ipad-unknown-fast',tablet:true,connection:null,profile:'fast',variant:'4k',reason:'preferred',observeMs:2800},
 {name:'ipad-unknown-slow',tablet:true,connection:null,profile:'slow',variant:'hd',reason:'slow-network'},
 {name:'fast-cellular',device:'Pixel 7',connection:{...fast,type:'cellular'},profile:'fast',variant:'4k',reason:'preferred',observeMs:2800},
 {name:'wifi-actual-slow',connection:{...fast,type:'wifi'},profile:'slow',variant:'hd',reason:'slow-network'},
 {name:'wifi-save-data',connection:{...fast,type:'wifi',saveData:true},profile:'fast',variant:'hd',reason:'data-saver'},
 {name:'connection-slow-hint',connection:{...fast,type:'wifi',effectiveType:'3g'},profile:'fast',variant:'hd',reason:'connection-slow'},
 {name:'option-2-wifi',connection:{...fast,type:'wifi'},query:'?entrance=2',profile:'fast',variant:'hd',reason:'option'},
 {name:'slow-then-fast-no-upgrade',connection:null,profile:'slow',hdProfile:'fast',variant:'hd',reason:'slow-network',observeMs:2800},
 {name:'sudden-slowdown',connection:{...fast,type:'wifi'},profile:'sudden',variant:'hd',reason:'slow-network',discardedLimit:80*MiB},
 {name:'4k-failure',connection:null,profile:'fail',variant:'hd',reason:'cdn-fallback'},
 {name:'hd-failure-local-fallback',connection:null,profile:'fail',hdProfile:'fail',variant:'local',reason:'local-fallback'},
 {name:'cached-opening-is-not-bandwidth',tablet:true,connection:null,profile:'slow',seedOpening:true,variant:'hd',reason:'slow-network',discardedLimit:16*MiB},
];

// Test-only transport fixture: real startup fetch calls still select and read
// actual opening/journey URLs. Timed response chunks control throughput without
// an unrelated bandwidth resource or depending on CI's internet connection.
function installMediaFixture({scenario,files}){
 const realFetch=globalThis.fetch.bind(globalThis),chunks=new Map();
 const state={requests:[],first4kAt:null,sources:[],decoderCalls:[],videoPaints:0};
 window.__videoConnectionTest=state;
 const source=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'src');
 if(source?.set)Object.defineProperty(HTMLMediaElement.prototype,'src',{...source,set(value){if(this instanceof HTMLVideoElement&&value)state.sources.push(String(value));return source.set.call(this,value)}});
 if(globalThis.VideoDecoder?.prototype?.configure){
  const configure=VideoDecoder.prototype.configure;
  VideoDecoder.prototype.configure=function(...args){state.decoderCalls.push('configure');return configure.apply(this,args)};
 }
 const draw=CanvasRenderingContext2D.prototype.drawImage;
 CanvasRenderingContext2D.prototype.drawImage=function(image,...args){
  if(image instanceof HTMLMediaElement||typeof VideoFrame==='function'&&image instanceof VideoFrame)state.videoPaints++;
  return draw.call(this,image,...args);
 };
 globalThis.fetch=async(input,options={})=>{
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url,location.href);
  const file=files.find(candidate=>{const expected=new URL(candidate.url);return url.origin===expected.origin&&url.pathname===expected.pathname});
  if(!file)return realFetch(input,options);
  const signal=options.signal??input?.signal;
  const request={url:url.href,variant:file.variant,kind:file.kind,bytes:file.bytes,sent:0,startedAt:performance.now(),aborted:false,cancelled:false,complete:false,failed:false};
  state.requests.push(request);if(file.variant==='4k')state.first4kAt??=request.startedAt;
  const profile=file.variant==='4k'?scenario.profile:file.variant==='hd'?(scenario.hdProfile||'hold'):'hold';
  if(profile==='fail'){request.failed=true;throw new TypeError('Fixture media connection failed')}
  let timer,controller,stopped=false;
  const stop=()=>{stopped=true;clearTimeout(timer);signal?.removeEventListener('abort',abort)};
  const abort=()=>{request.aborted=true;stop();try{controller?.error(signal.reason||new DOMException('Fixture transfer aborted','AbortError'))}catch{}};
  const body=new ReadableStream({
   start(value){
    controller=value;signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted){abort();return;}
    const tick=()=>{
     if(stopped)return;
     const slow=profile==='slow'||profile==='sudden'&&performance.now()-state.first4kAt>=2000;
     const size=profile==='hold'?64*1024:slow?16*1024:1024*1024;
     const cap=file.variant==='4k'?128*1024*1024:file.variant==='hd'?48*1024*1024:64*1024;
     const length=Math.min(size,file.bytes-request.sent,cap-request.sent);
     if(length<=0)return;
     // Reusing immutable zero chunks bounds fixture allocation while the
     // reader still consumes the declared number of timed response bytes.
     if(!chunks.has(length))chunks.set(length,new Uint8Array(length));
     try{controller.enqueue(chunks.get(length));request.sent+=length;request.lastChunkAt=performance.now();}catch{stop();return;}
     if(request.sent===file.bytes){request.complete=true;stop();controller.close();return;}
     if(request.sent<cap)timer=setTimeout(tick,profile==='hold'?50:slow?200:50);
    };
    timer=setTimeout(tick,profile==='slow'?200:50);
   },
   cancel(){request.cancelled=true;stop()},
  });
  return new Response(body,{status:200,headers:{'Content-Type':'video/mp4','Content-Length':String(file.bytes)}});
 };
}

const report=[];
let server,browser,data,serverLog='';
try{
 data=await mkdtemp(join(tmpdir(),'sofacet-video-connection-'));
 server=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:port,HOST:'127.0.0.1',DATA_DIR:data},stdio:['ignore','pipe','pipe']});
 const log=chunk=>{serverLog=(serverLog+chunk).slice(-8000)};
 server.stdout.on('data',log);server.stderr.on('data',log);
 let started=false;
 for(let attempt=0;attempt<100&&!started;attempt++){
  try{started=(await fetch(origin+'/health')).ok}catch{}
  if(server.exitCode!==null)throw Error('Connection test server exited before startup: '+serverLog);
  if(!started)await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.ok(started,'Connection test server did not start: '+serverLog);
 browser=await browserType.launch();
 for(const scenario of cases){
  const device=scenario.tablet?{viewport:{width:1024,height:1366},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'}:devices[scenario.device||(engine==='webkit'?'iPhone 13':'Pixel 7')];
  const context=await browser.newContext({...device,reducedMotion:'reduce'}),page=await context.newPage(),manifests=[],requests=[],errors=[];
  page.on('request',request=>requests.push(request.url()));page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(({connection,tablet,mobile})=>{
   for(const key of ['connection','mozConnection','webkitConnection'])Object.defineProperty(navigator,key,{configurable:true,value:connection??undefined});
   Object.defineProperty(navigator,'userAgentData',{configurable:true,value:mobile===null?undefined:{mobile}});
   if(tablet){Object.defineProperty(navigator,'platform',{configurable:true,value:'MacIntel'});Object.defineProperty(navigator,'maxTouchPoints',{configurable:true,value:5});}
  },{connection:scenario.connection,tablet:!!scenario.tablet,mobile:scenario.tablet||engine==='webkit'&&scenario.device!=='Pixel 7'?null:true});
  await page.addInitScript(installMediaFixture,{scenario,files:mediaFiles});
  await page.route('**/api/media-config',route=>route.fulfill({json:{entranceManifestURL:cdn+'/hd/manifest.json',entrance4kManifestURL:cdn+'/4k/manifest.json'}}));
  await page.route(cdn+'/**/manifest.json',async route=>{
   const url=route.request().url();manifests.push(url);
   if(scenario.seedOpening&&url===cdn+'/4k/manifest.json'){
    // Seed in the app document while its manifest is held. WebKit does not
    // reliably retain a CacheStorage seed made from the prior JSON document.
    // Fulfill metadata only after the same-origin cache can read the entry.
    const opening=mediaFiles.find(file=>file.variant==='4k'&&file.kind==='opening');
    await page.evaluate(async({url,bytes})=>{
     const cache=await caches.open('sofacet-entrance-preloaded-v1');
     await cache.put(url,new Response(new Uint8Array(bytes),{headers:{'Content-Type':'video/mp4','Content-Length':String(bytes)}}));
     const stored=await cache.match(url);
     window.__videoConnectionTest.cacheSeed={stored:!!stored,bytes:Number(stored?.headers.get('Content-Length'))};
    },opening);
   }
   return route.fulfill({json:url===cdn+'/4k/manifest.json'?ultra:hd,headers:{'Access-Control-Allow-Origin':'*'}});
  });
  try{
   await page.goto(origin+'/'+(scenario.query||'')+'#experience',{waitUntil:'domcontentloaded'});
   await page.waitForFunction(({width,reason,variant})=>{
    const selection=window.entrancePreview?.quality?.networkSelection;
    return selection?.width===width&&selection.reason===reason&&window.__videoConnectionTest?.requests.some(request=>request.variant===variant);
   },{width:scenario.variant==='4k'?3840:1920,reason:scenario.reason,variant:scenario.variant},{timeout:20000});
   await page.waitForTimeout(scenario.observeMs??350);
   const snapshot=await page.evaluate(()=>({selection:window.entrancePreview?.quality?.networkSelection,ready:window.entrancePreview?.ready,preloaded:window.entrancePreview?.quality?.preloaded,...window.__videoConnectionTest}));
   const selection=snapshot.selection;
   assert.deepEqual(errors,[],`${scenario.name}: startup must not raise a page error`);
   assert.equal(selection.width,scenario.variant==='4k'?3840:1920,`${scenario.name}: selected quality remains stable`);
   assert.equal(selection.reason,scenario.reason);
   const initialHD=['data-saver','connection-slow','option'].includes(scenario.reason),expectedManifests=initialHD?['hd']:scenario.variant==='4k'?['4k']:['4k','hd'];
   assert.deepEqual(manifests,expectedManifests.map(variant=>`${cdn}/${variant}/manifest.json`),`${scenario.name}: no repeated download or quality upgrade`);
   assert.ok(snapshot.requests.some(request=>request.variant===scenario.variant&&request.kind==='journey'));
   const hdAt=snapshot.requests.find(request=>request.variant==='hd')?.startedAt;
   if(hdAt!==undefined)assert.ok(!snapshot.requests.some(request=>request.variant==='4k'&&request.startedAt>hdAt),`${scenario.name}: HD never upgrades back to 4K`);
   const discarded=snapshot.requests.filter(request=>request.variant==='4k');
   if(scenario.variant!=='4k'){
    assert.ok(discarded.filter(request=>!request.complete&&!request.failed).every(request=>request.aborted||request.cancelled),`${scenario.name}: dispose all unfinished 4K transfers`);
    const sent=discarded.reduce((sum,request)=>sum+request.sent,0),cached=scenario.seedOpening?ultra.clips.opening.bytes:0;
    assert.ok(selection.discardedBytes<=sent+cached+2*MiB,`${scenario.name}: discarded bytes reflect bounded consumed data`);
    assert.ok(selection.discardedBytes<=(scenario.discardedLimit??8*MiB),`${scenario.name}: bounded discarded prefix`);
   }
   if(scenario.reason==='slow-network'){
    assert.equal(selection.switches,1);
    assert.ok(Number.isFinite(selection.mbps)&&selection.mbps>=0,`${scenario.name}: slowdown uses measured network throughput`);
    assert.ok(selection.estimatedRemainingMs>20_000,`${scenario.name}: remaining 4K download exceeds the time budget`);
    assert.ok(selection.remainingBytes>61_882_825*1.2,`${scenario.name}: restarting HD saves enough remaining bytes`);
   }
   else if(['preferred','data-saver','connection-slow','option'].includes(scenario.reason))assert.equal(selection.switches,0);
   if(scenario.seedOpening){
    assert.deepEqual(snapshot.cacheSeed,{stored:true,bytes:ultra.clips.opening.bytes},'Fixture must seed a readable opening before startup begins');
    assert.equal(discarded.some(request=>request.kind==='opening'),false,'Cached opening bytes must not become network transfer samples');
   }
   assert.notEqual(snapshot.ready,true);assert.notEqual(snapshot.preloaded,true);
   assert.deepEqual(snapshot.sources,[],`${scenario.name}: no native video source before the complete selected variant is buffered`);
   assert.deepEqual(snapshot.decoderCalls,[]);assert.equal(snapshot.videoPaints,0);
   assert.equal(requests.some(url=>/\.glb(?:\?|$)|camera-motion\.json/.test(url)),false);
   assert.equal(await page.locator('body').getAttribute('data-error'),null);
   report.push({name:scenario.name,manifests,selection,transfers:snapshot.requests,cacheSeed:snapshot.cacheSeed,ready:snapshot.ready??false,nativeSources:snapshot.sources.length,decoderCalls:snapshot.decoderCalls.length,videoPaints:snapshot.videoPaints,transport:'Timed actual-media response fixture; no external speed-test request',errors});
  }catch(error){
   console.error('Connection selection state',JSON.stringify({engine,name:scenario.name,manifests,errors,state:await page.evaluate(()=>({selection:window.entrancePreview?.quality?.networkSelection,...window.__videoConnectionTest})).catch(()=>null)}));
   throw error;
  }finally{await context.close()}
 }
 await writeFile(new URL(`${engine}-report.json`,output),JSON.stringify({engine,cases:report},null,2));
 console.log(JSON.stringify({engine,passed:report.length,cases:report.map(({name,selection})=>({name,width:selection.width,reason:selection.reason,switches:selection.switches,discardedBytes:selection.discardedBytes})),externalVideoBytesDownloaded:0}));
}finally{
 await browser?.close();
 if(server&&server.exitCode===null&&server.signalCode===null){server.kill();await new Promise(resolve=>server.once('exit',resolve))}
 if(data)await rm(data,{recursive:true,force:true});
}
