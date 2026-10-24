// Diagnostic only: decode representative samples outside the application renderer.
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
const frames=[200,700,1400,1875];
const result={engine,frames,diagnosticOnly:true,productionGuardBypassed:false,samples:[]};
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
   decoder.configure(config);decoder.decode(new EncodedVideoChunk({type:'key',timestamp:data.timestamp,duration:data.duration,data:data.bytes}));await decoder.flush();
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
 for(const frame of frames){
 await page.evaluate(frame=>window.scrollTo(0,frame*8),frame);
 await page.waitForFunction(frame=>{const s=window.sofacetPreview.sequence;return s.desiredFrame===frame&&s.displayedFrame===frame&&s.stats.canvasPresentedFrame===frame&&s.stats.pending===0},frame,{timeout:30000});
 const evidence=await page.evaluate(async({workerSource,frame})=>{
  const metadata=image=>({format:image.format,codedWidth:image.codedWidth,codedHeight:image.codedHeight,displayWidth:image.displayWidth,displayHeight:image.displayHeight,
   colorSpace:Object.fromEntries(['primaries','transfer','matrix','fullRange'].map(key=>[key,image.colorSpace?.[key]??null]))});
  const compare=(reference,candidate)=>{
   let max=0,total=0,changed=0,referenceRGB=0,candidateRGB=0;
   const signed=[0,0,0],absolute=[0,0,0],histogram=new Uint32Array(256),count=reference.length/4;
   for(let i=0;i<reference.length;i+=4)for(let channel=0;channel<3;channel++){
    const delta=candidate[i+channel]-reference[i+channel],difference=Math.abs(delta);
    max=Math.max(max,difference);total+=difference;if(difference)changed++;
    signed[channel]+=delta;absolute[channel]+=difference;histogram[difference]++;
    referenceRGB+=reference[i+channel];candidateRGB+=candidate[i+channel];
   }
   let cumulative=0,p95=0;for(;p95<255;p95++){cumulative+=histogram[p95];if(cumulative>=count*3*.95)break}
   return{rgbChannels:count*3,maxChannelDifference:max,p95ChannelDifference:p95,meanRGBDifference:total/(count*3),changedRGBChannels:changed,
    signedMeanByChannel:signed.map(value=>value/count),meanAbsoluteByChannel:absolute.map(value=>value/count),
    referenceRGB:referenceRGB/(count*3),candidateRGB:candidateRGB/(count*3)};
  };
  const indexResponse=await fetch('/assets/journey-index.json');if(!indexResponse.ok)throw Error('Probe index unavailable');
  const index=await indexResponse.json(),[offset,length]=index.frames[frame],videoURL=new URL(index.source,indexResponse.url);videoURL.searchParams.set('v',index.sha256);
  const response=await fetch(videoURL,{headers:{Range:'bytes='+offset+'-'+(offset+length-1)}});
  if(response.status!==206||response.headers.get('Content-Range')!=='bytes '+offset+'-'+(offset+length-1)+'/'+index.bytes)throw Error('Probe exact sample range unavailable');
  const bytes=await response.arrayBuffer();if(bytes.byteLength!==length)throw Error('Probe sample incomplete');
  const config={codec:index.codec,codedWidth:index.width,codedHeight:index.height,description:Uint8Array.from(index.description.match(/../g),hex=>parseInt(hex,16)),colorSpace:index.colorSpace};
  const blobURL=URL.createObjectURL(new Blob(['('+workerSource+')()'],{type:'text/javascript'})),worker=new Worker(blobURL,{type:'module'});
  let decoded,timer;
  try{decoded=await new Promise((resolve,reject)=>{
   timer=setTimeout(()=>reject(Error('Raw colour probe timed out')),10000);
   worker.onmessage=({data})=>data.type==='frame'?resolve(data):reject(Object.assign(Error(data.message),{name:data.name}));worker.onerror=event=>reject(Error(event.message));
   worker.postMessage({config,bytes,timestamp:Math.round(frame*1e6/index.fps),duration:Math.round(1e6/index.fps)},[bytes]);
  })}finally{clearTimeout(timer);worker.terminate();URL.revokeObjectURL(blobURL)}
  const image=decoded.image;let corrected,reconstructed;
  try{
   const afterTransfer=metadata(image);
   if(!['NV12','I420'].includes(image.format)||Object.values(afterTransfer.colorSpace).some(value=>value===null))throw Error('Probe cannot reconstruct an unknown pixel format or colour space');
   // Preserve the actual planes, range, matrix and primaries. Only change the
   // transfer tag. VideoFrame(existingFrame, init) cannot override colour space.
   const copyOptions={rect:{x:0,y:0,width:image.codedWidth,height:image.codedHeight}};
   const copied=new Uint8Array(image.allocationSize(copyOptions)),copyStart=performance.now();
   const layout=await image.copyTo(copied,copyOptions),copyMs=performance.now()-copyStart;
   const frameInit={format:image.format,codedWidth:image.codedWidth,codedHeight:image.codedHeight,
    displayWidth:image.displayWidth,displayHeight:image.displayHeight,visibleRect:image.visibleRect,
    timestamp:image.timestamp,...(image.duration===null?{}:{duration:image.duration}),layout};
   const controlStart=performance.now();reconstructed=new VideoFrame(copied,{...frameInit,colorSpace:afterTransfer.colorSpace});
   const controlConstructMs=performance.now()-controlStart;
   const correctedColorSpace={...afterTransfer.colorSpace,transfer:index.colorSpace.transfer},constructStart=performance.now();
   corrected=new VideoFrame(copied,{...frameInit,colorSpace:correctedColorSpace});
   const constructMs=performance.now()-constructStart,correctedMetadata=metadata(corrected);
   if(Object.entries(correctedColorSpace).some(([key,value])=>correctedMetadata.colorSpace[key]!==value))throw Error('Probe reconstructed frame did not preserve the requested colour space');
   const nativeStats=window.sofacetPreview.sequence.stats;
   if(nativeStats.presentedFrame!==frame||nativeStats.canvasPresentedFrame!==frame||nativeStats.pending!==0)throw Error('Native reference changed before pixel capture');
   const canvases=Array.from({length:4},()=>{const canvas=document.createElement('canvas');canvas.width=index.width;canvas.height=index.height;return canvas});
   const contexts=canvases.map(canvas=>canvas.getContext('2d',{alpha:false,colorSpace:'srgb'}));
   contexts[0].drawImage(document.querySelector('#journey-frame'),0,0);contexts[1].drawImage(image,0,0);contexts[2].drawImage(corrected,0,0);contexts[3].drawImage(reconstructed,0,0);
   const [nativePixels,rawPixels,correctedPixels,reconstructedPixels]=contexts.map(context=>context.getImageData(0,0,index.width,index.height).data);
   return{frame,expectedColorSpace:index.colorSpace,beforeTransfer:decoded.beforeTransfer,afterTransfer,hardwareAcceleration:decoded.hardwareAcceleration,
    source:{codec:index.codec,width:index.width,height:index.height},nativeMode:nativeStats.mode,nativeReference:{presentedFrame:nativeStats.presentedFrame,canvasPresentedFrame:nativeStats.canvasPresentedFrame,pending:nativeStats.pending},
    canvasColorSpaces:Object.fromEntries(['native','raw','corrected','reconstructed'].map((name,i)=>[name,contexts[i].getContextAttributes?.().colorSpace??null])),
    correction:{kind:'transfer-only',executionContext:'window',bytes:copied.byteLength,layout,copyMs,constructMs,metadata:correctedMetadata},
    reconstructionControl:{constructMs:controlConstructMs,metadata:metadata(reconstructed)},
    pixels:{rawVsNative:compare(nativePixels,rawPixels),correctedVsNative:compare(nativePixels,correctedPixels),correctedVsRaw:compare(rawPixels,correctedPixels),
     reconstructedVsRaw:compare(rawPixels,reconstructedPixels),reconstructedVsNative:compare(nativePixels,reconstructedPixels)}};
  }finally{reconstructed?.close();corrected?.close();image.close()}
 },{workerSource:probeWorker.toString(),frame});result.samples.push(evidence);
 }
 const aggregate=key=>{
  const samples=result.samples.map(sample=>sample.pixels[key]),channels=samples.reduce((sum,sample)=>sum+sample.rgbChannels,0);
  return{rgbChannels:channels,maxChannelDifference:Math.max(...samples.map(sample=>sample.maxChannelDifference)),
   meanRGBDifference:samples.reduce((sum,sample)=>sum+sample.meanRGBDifference*sample.rgbChannels,0)/channels,
   changedRGBChannels:samples.reduce((sum,sample)=>sum+sample.changedRGBChannels,0),
   signedMeanByChannel:[0,1,2].map(channel=>samples.reduce((sum,sample)=>sum+sample.signedMeanByChannel[channel]*sample.rgbChannels,0)/channels)};
 };
 Object.assign(result,{completed:true,aggregate:{rawVsNative:aggregate('rawVsNative'),correctedVsNative:aggregate('correctedVsNative'),correctedVsRaw:aggregate('correctedVsRaw'),reconstructedVsRaw:aggregate('reconstructedVsRaw'),reconstructedVsNative:aggregate('reconstructedVsNative'),
  correction:{bytes:result.samples.reduce((sum,sample)=>sum+sample.correction.bytes,0),copyMs:result.samples.reduce((sum,sample)=>sum+sample.correction.copyMs,0),
   constructMs:result.samples.reduce((sum,sample)=>sum+sample.correction.constructMs,0)}}});
}catch(error){Object.assign(result,{completed:false,error:{name:error.name,message:error.message}});process.exitCode=1}
finally{
 await browser?.close();if(server){server.kill();await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve))}if(data)await rm(data,{recursive:true,force:true});
 await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log('Raw worker colour probe',JSON.stringify(result));
}
