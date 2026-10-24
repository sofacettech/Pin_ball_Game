// Diagnostic only: decode one authored sample outside the application renderer.
// Production colour guards remain enabled. Only metadata and numeric differences
// are exported; decoded pixels remain in the ephemeral browser and are closed.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
const require=createRequire(import.meta.url),engine=process.env.SOFACET_BROWSER||'chromium';
const {[engine]:browserType,devices}=require(process.env.SOFACET_PLAYWRIGHT_PATH||'playwright');
const output=resolve(process.env.SOFACET_COLOUR_OUTPUT||join(tmpdir(),'worker-colour-probe.json'));
const port=process.env.SOFACET_COLOUR_PORT||'8776',url='http://127.0.0.1:'+port;
let server,browser,data;
const result={engine,frame:700,diagnosticOnly:true,productionGuardBypassed:false};
function probeWorker(){
 const metadata=image=>({format:image.format,codedWidth:image.codedWidth,codedHeight:image.codedHeight,displayWidth:image.displayWidth,displayHeight:image.displayHeight,
  colorSpace:Object.fromEntries(['primaries','transfer','matrix','fullRange'].map(key=>[key,image.colorSpace?.[key]??null]))});
 self.onmessage=async({data})=>{
  let decoder,posted=false;
  try{
   let config={...data.config,optimizeForLatency:true,hardwareAcceleration:'prefer-hardware'},support=await VideoDecoder.isConfigSupported(config);
   if(!support.supported){config={...config,hardwareAcceleration:'no-preference'};support=await VideoDecoder.isConfigSupported(config)}
   if(!support.supported)throw new DOMException('Probe codec is unsupported','NotSupportedError');
   decoder=new VideoDecoder({output(image){
    if(posted){image.close();return}posted=true;
    const beforeTransfer=metadata(image);self.postMessage({type:'frame',image,beforeTransfer,hardwareAcceleration:config.hardwareAcceleration},[image]);
   },error(error){self.postMessage({type:'error',name:error.name,message:error.message})}});
   decoder.configure(config);decoder.decode(new EncodedVideoChunk({type:'key',timestamp:Math.round(700*1e6/60),duration:16667,data:data.bytes}));await decoder.flush();
   if(!posted)throw Error('Probe decoder returned no frame');
  }catch(error){self.postMessage({type:'error',name:error.name,message:error.message})}
  finally{try{decoder?.close()}catch{}}
 };
}
try{
 await mkdir(dirname(output),{recursive:true});data=await mkdtemp(join(tmpdir(),'sofacet-colour-probe-'));
 server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:port,HOST:'127.0.0.1',DATA_DIR:data},stdio:['ignore','pipe','pipe']});
 let listening=false;server.stdout.on('data',chunk=>{if(String(chunk).includes(url))listening=true});server.stderr.on('data',chunk=>process.stderr.write(chunk));
 let ready=false;for(let i=0;i<100&&!ready;i++){
  if(server.exitCode!==null)throw Error('Probe server exited before startup');
  if(listening)try{ready=(await fetch(url+'/health')).ok}catch{}
  if(!ready)await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.ok(ready,'Probe server must start');browser=await browserType.launch();
 const context=await browser.newContext({...devices[engine==='webkit'?'iPhone 13':'Pixel 7']}),page=await context.newPage();
 await page.goto(url+'/?renderer=native',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.sofacetPreview&&(document.body.dataset.phase==='idle'||!document.querySelector('#enter').hidden),{},{timeout:60000});
 if(await page.locator('#enter').isVisible())await page.locator('#enter').tap();
 await page.waitForFunction(()=>document.body.dataset.phase==='idle',{},{timeout:60000});await page.touchscreen.tap(195,422);
 await page.evaluate(()=>window.scrollTo(0,700*8));
 await page.waitForFunction(()=>{const s=window.sofacetPreview.sequence;return s.desiredFrame===700&&s.displayedFrame===700&&s.stats.canvasPresentedFrame===700&&s.stats.pending===0},{},{timeout:30000});
 const evidence=await page.evaluate(async workerSource=>{
  const indexResponse=await fetch('/assets/journey-index.json');if(!indexResponse.ok)throw Error('Probe index unavailable');
  const index=await indexResponse.json(),[offset,length]=index.frames[700],videoURL=new URL(index.source,indexResponse.url);videoURL.searchParams.set('v',index.sha256);
  const response=await fetch(videoURL,{headers:{Range:'bytes='+offset+'-'+(offset+length-1)}});
  if(response.status!==206||response.headers.get('Content-Range')!=='bytes '+offset+'-'+(offset+length-1)+'/'+index.bytes)throw Error('Probe exact sample range unavailable');
  const bytes=await response.arrayBuffer();if(bytes.byteLength!==length)throw Error('Probe sample incomplete');
  const config={codec:index.codec,codedWidth:index.width,codedHeight:index.height,description:Uint8Array.from(index.description.match(/../g),hex=>parseInt(hex,16)),colorSpace:index.colorSpace};
  const blobURL=URL.createObjectURL(new Blob(['('+workerSource+')()'],{type:'text/javascript'})),worker=new Worker(blobURL,{type:'module'});
  let decoded,timer;
  try{decoded=await new Promise((resolve,reject)=>{
   timer=setTimeout(()=>reject(Error('Raw colour probe timed out')),10000);
   worker.onmessage=({data})=>data.type==='frame'?resolve(data):reject(Object.assign(Error(data.message),{name:data.name}));worker.onerror=event=>reject(Error(event.message));worker.postMessage({config,bytes},[bytes]);
  })}finally{clearTimeout(timer);worker.terminate();URL.revokeObjectURL(blobURL)}
  const image=decoded.image;
  try{
   const afterTransfer={format:image.format,codedWidth:image.codedWidth,codedHeight:image.codedHeight,displayWidth:image.displayWidth,displayHeight:image.displayHeight,
    colorSpace:Object.fromEntries(['primaries','transfer','matrix','fullRange'].map(key=>[key,image.colorSpace?.[key]??null]))};
   const native=document.createElement('canvas'),raw=document.createElement('canvas');native.width=raw.width=index.width;native.height=raw.height=index.height;
   const nativeContext=native.getContext('2d',{alpha:false,colorSpace:'srgb'}),rawContext=raw.getContext('2d',{alpha:false,colorSpace:'srgb'});
   nativeContext.drawImage(document.querySelector('#journey-frame'),0,0);rawContext.drawImage(image,0,0);
   const a=nativeContext.getImageData(0,0,index.width,index.height).data,b=rawContext.getImageData(0,0,index.width,index.height).data;
   let max=0,total=0,changed=0,nativeRGB=0,rawRGB=0;
   for(let i=0;i<a.length;i++){const difference=Math.abs(a[i]-b[i]);max=Math.max(max,difference);total+=difference;if(difference)changed++;if(i%4!==3){nativeRGB+=a[i];rawRGB+=b[i]}}
   return{expectedColorSpace:index.colorSpace,beforeTransfer:decoded.beforeTransfer,afterTransfer,hardwareAcceleration:decoded.hardwareAcceleration,
    source:{codec:index.codec,width:index.width,height:index.height},nativeMode:window.sofacetPreview.sequence.stats.mode,
    canvasColorSpaces:{native:nativeContext.getContextAttributes?.().colorSpace??null,raw:rawContext.getContextAttributes?.().colorSpace??null},
    pixels:{maxChannelDifference:max,meanChannelDifference:total/a.length,changedChannels:changed,nativeRGB:nativeRGB/(index.width*index.height*3),rawRGB:rawRGB/(index.width*index.height*3)}};
  }finally{image.close()}
 },probeWorker.toString());Object.assign(result,{completed:true,...evidence});
}catch(error){Object.assign(result,{completed:false,error:{name:error.name,message:error.message}});process.exitCode=1}
finally{
 await browser?.close();if(server){server.kill();await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve))}if(data)await rm(data,{recursive:true,force:true});
 await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log('Raw worker colour probe',JSON.stringify(result));
}
