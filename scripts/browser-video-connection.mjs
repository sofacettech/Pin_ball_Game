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
const origin=`http://127.0.0.1:${port}`,cdn='https://media.example';
const output=new URL('../work/video-connection/',import.meta.url);
await mkdir(output,{recursive:true});

// Both remote choices are valid manifests. Hold their media before any bytes
// arrive so this checks selection in the actual built startup, without a speed
// test, a large fixture download, or depending on either video decoder.
const hd=JSON.parse(await readFile(new URL('../assets/entrance-video/manifest.json',import.meta.url)));
for(const kind of ['opening','journey'])hd.clips[kind].file=`entrance-${kind}-${hd.clips[kind].sha256}.mp4`;
const ultra={...structuredClone(hd),width:3840,height:2160};
const fast={effectiveType:'4g',downlink:100,saveData:false};
const cases=[
 {name:'fast-cellular',connection:{...fast,type:'cellular'},variant:'hd'},
 {name:'wifi',connection:{...fast,type:'wifi'},variant:'4k'},
 {name:'wifi-save-data',connection:{...fast,type:'wifi',saveData:true},variant:'hd'},
 {name:'slow-wifi',connection:{...fast,type:'wifi',effectiveType:'3g'},variant:'hd'},
 {name:'iphone-unknown',device:'iPhone 13',connection:null,variant:'hd'},
 {name:'android-unknown-4g',device:'Pixel 7',connection:fast,variant:'hd'},
 {name:'desktop-unknown',desktop:true,connection:null,variant:'4k'},
 {name:'option-2-wifi',connection:{...fast,type:'wifi'},query:'?entrance=2',variant:'hd'},
 {name:'option-3-cellular',connection:{...fast,type:'cellular'},query:'?entrance=3',variant:'hd'},
];
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
  const device=scenario.desktop?{viewport:{width:1440,height:900}}:devices[scenario.device||(engine==='webkit'?'iPhone 13':'Pixel 7')];
  const context=await browser.newContext({...device,reducedMotion:'reduce'}),page=await context.newPage();
  const manifests=[],media=[],requests=[],errors=[];
  let releaseMedia,closing=false;
  const mediaGate=new Promise(resolve=>{releaseMedia=resolve});
  page.on('request',request=>requests.push(request.url()));
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(({connection,mobile})=>{
   for(const key of ['connection','mozConnection','webkitConnection'])Object.defineProperty(navigator,key,{configurable:true,value:connection??undefined});
   Object.defineProperty(navigator,'userAgentData',{configurable:true,value:mobile===null?undefined:{mobile}});
  },{connection:scenario.connection,mobile:scenario.desktop?false:scenario.device==='iPhone 13'||engine==='webkit'&&scenario.device!=='Pixel 7'?null:true});
  await page.route('**/api/media-config',route=>route.fulfill({json:{entranceManifestURL:cdn+'/hd/manifest.json',entrance4kManifestURL:cdn+'/4k/manifest.json'}}));
  await page.route(cdn+'/**/manifest.json',route=>{
   const url=route.request().url();manifests.push(url);
   return route.fulfill({json:url===cdn+'/4k/manifest.json'?ultra:hd,headers:{'Access-Control-Allow-Origin':'*'}});
  });
  await page.route(/\.mp4(?:\?|$)/,async route=>{
   if(!closing){media.push(route.request().url());await mediaGate;}
   await route.abort().catch(()=>{});
  });
  try{
   await page.goto(origin+'/'+(scenario.query||'')+'#experience',{waitUntil:'domcontentloaded'});
   for(let attempt=0;attempt<200&&media.length<2&&!errors.length;attempt++)await new Promise(resolve=>setTimeout(resolve,100));
   assert.deepEqual(errors,[],`${scenario.name}: startup must not raise a page error`);
   assert.equal(media.length,2,`${scenario.name}: startup must request opening and journey media`);
   assert.deepEqual(manifests,[`${cdn}/${scenario.variant}/manifest.json`],`${scenario.name}: choose one matching manifest before any media download`);
   for(const kind of ['opening','journey'])assert.ok(media.some(url=>url.startsWith(`${cdn}/${scenario.variant}/entrance-${kind}-`)),`${scenario.name}: ${kind} must use the selected quality`);
   assert.equal(requests.some(url=>/\.glb(?:\?|$)|camera-motion\.json/.test(url)),false,`${scenario.name}: quality selection must keep the video entrance`);
   assert.equal(await page.locator('body').getAttribute('data-error'),null);
   report.push({name:scenario.name,variant:scenario.variant,connection:scenario.connection,manifests,media,videoBytesDownloaded:0,errors});
  }catch(error){
   console.error('Connection selection state',JSON.stringify({engine,name:scenario.name,manifests,media,errors}));
   throw error;
  }finally{
   closing=true;releaseMedia();await context.close();
  }
 }
 await writeFile(new URL(`${engine}-report.json`,output),JSON.stringify({engine,cases:report},null,2));
 console.log(JSON.stringify({engine,passed:report.length,cases:report.map(({name,variant})=>({name,variant})),videoBytesDownloaded:0}));
}finally{
 await browser?.close();
 if(server&&server.exitCode===null&&server.signalCode===null){server.kill();await new Promise(resolve=>server.once('exit',resolve))}
 if(data)await rm(data,{recursive:true,force:true});
}
