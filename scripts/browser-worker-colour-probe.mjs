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
 const metadata=image=>({timestamp:image.timestamp,duration:image.duration,visibleRect:image.visibleRect?{x:image.visibleRect.x,y:image.visibleRect.y,width:image.visibleRect.width,height:image.visibleRect.height}:null,format:image.format,codedWidth:image.codedWidth,codedHeight:image.codedHeight,displayWidth:image.displayWidth,displayHeight:image.displayHeight,
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
  const metadata=image=>({timestamp:image.timestamp,duration:image.duration,visibleRect:image.visibleRect?{x:image.visibleRect.x,y:image.visibleRect.y,width:image.visibleRect.width,height:image.visibleRect.height}:null,format:image.format,codedWidth:image.codedWidth,codedHeight:image.codedHeight,displayWidth:image.displayWidth,displayHeight:image.displayHeight,
   colorSpace:Object.fromEntries(['primaries','transfer','matrix','fullRange'].map(key=>[key,image.colorSpace?.[key]??null]))});
  const compare=(reference,candidate)=>{
   let max=0,total=0,squared=0,changed=0,referenceRGB=0,candidateRGB=0;
   const signed=[0,0,0],absolute=[0,0,0],histogram=new Uint32Array(256),pixelHistogram=new Uint32Array(256),count=reference.length/4;
   for(let i=0;i<reference.length;i+=4){
    let pixelMax=0;
    for(let channel=0;channel<3;channel++){
     const delta=candidate[i+channel]-reference[i+channel],difference=Math.abs(delta);
     max=Math.max(max,difference);pixelMax=Math.max(pixelMax,difference);total+=difference;squared+=delta*delta;if(difference)changed++;
     signed[channel]+=delta;absolute[channel]+=difference;histogram[difference]++;
     referenceRGB+=reference[i+channel];candidateRGB+=candidate[i+channel];
    }
    pixelHistogram[pixelMax]++;
   }
   let cumulative=0,p95=0;for(;p95<255;p95++){cumulative+=histogram[p95];if(cumulative>=count*3*.95)break}
   const mse=squared/(count*3),exceeds=Object.fromEntries([2,8,16,32].map(threshold=>{
    let channels=0,pixels=0;for(let value=threshold+1;value<256;value++){channels+=histogram[value];pixels+=pixelHistogram[value]}
    return[threshold,{rgbChannels:channels,rgbChannelFraction:channels/(count*3),pixels,pixelFraction:pixels/count}];
   }));
   return{rgbChannels:count*3,pixels:count,maxChannelDifference:max,p95ChannelDifference:p95,meanRGBDifference:total/(count*3),changedRGBChannels:changed,
    meanSquaredRGBError:mse,psnrDb:mse===0?null:10*Math.log10(255*255/mse),infinitePSNR:mse===0,exceeds,
    signedMeanByChannel:signed.map(value=>value/count),meanAbsoluteByChannel:absolute.map(value=>value/count),
    referenceRGB:referenceRGB/(count*3),candidateRGB:candidateRGB/(count*3)};
  };
  const indexResponse=await fetch('/assets/journey-index.json');if(!indexResponse.ok)throw Error('Probe index unavailable');
  const index=await indexResponse.json(),videoURL=new URL(index.source,indexResponse.url);videoURL.searchParams.set('v',index.sha256);
  async function readSample(sourceFrame){
   const [offset,length]=index.frames[sourceFrame],response=await fetch(videoURL,{headers:{Range:'bytes='+offset+'-'+(offset+length-1)}});
   if(response.status!==206||response.headers.get('Content-Range')!=='bytes '+offset+'-'+(offset+length-1)+'/'+index.bytes)throw Error('Probe exact sample range unavailable');
   const bytes=await response.arrayBuffer();if(bytes.byteLength!==length)throw Error('Probe sample incomplete');return bytes;
  }
  const bytes=await readSample(frame);
  const config={codec:index.codec,codedWidth:index.width,codedHeight:index.height,description:Uint8Array.from(index.description.match(/../g),hex=>parseInt(hex,16)),colorSpace:index.colorSpace};
  async function decodeSample(decoderConfig,sourceFrame=frame){
   const sourceBytes=sourceFrame===frame?bytes:await readSample(sourceFrame);
   const blobURL=URL.createObjectURL(new Blob(['('+workerSource+')()'],{type:'text/javascript'})),worker=new Worker(blobURL,{type:'module'}),sample=sourceBytes.slice(0);
   let timer;
   try{return await new Promise((resolve,reject)=>{
    timer=setTimeout(()=>reject(Error('Raw colour probe timed out')),10000);
    worker.onmessage=({data})=>data.type==='frame'?resolve(data):reject(Object.assign(Error(data.message),{name:data.name}));worker.onerror=event=>reject(Error(event.message));
    worker.postMessage({config:decoderConfig,bytes:sample,timestamp:Math.round(sourceFrame*1e6/index.fps),duration:Math.round(1e6/index.fps)},[sample]);
   })}finally{clearTimeout(timer);worker.terminate();URL.revokeObjectURL(blobURL)}
  }
  const decoded=await decodeSample(config);
  const image=decoded.image;let corrected,reconstructed,nativeVideoFrame,alternateImage,alternateNormalized;const rangeFrames=[],rangeBuffers=[];
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
   // Numeric-only hypotheses. Apple 420f documents chroma1..255 around128;
   // generic full-range conventions can use a255-span. Neither documents VT's
   // exact integer rounding, so both inverses are labeled and tested separately.
   const rangeRestorations=[];
   if(image.format==='NV12'&&afterTransfer.colorSpace.fullRange===true&&index.colorSpace.fullRange===false){
    for(const [kind,chromaDenominator] of [['apple-endpoint-inverse',254],['generic-255-span-inverse',255]]){
     const restored=copied.slice(),started=performance.now();let zeroChromaSamples=0,clampedY=0,clampedUV=0;
     for(let row=0;row<image.codedHeight;row++)for(let column=0;column<image.codedWidth;column++){
      const at=layout[0].offset+row*layout[0].stride+column,value=Math.round(16+restored[at]*219/255);
      if(value<16||value>235)clampedY++;restored[at]=Math.max(16,Math.min(235,value));
     }
     for(let row=0;row<Math.ceil(image.codedHeight/2);row++)for(let column=0;column<Math.ceil(image.codedWidth/2)*2;column++){
      const at=layout[1].offset+row*layout[1].stride+column;if(restored[at]===0)zeroChromaSamples++;
      const value=Math.round(128+(restored[at]-128)*224/chromaDenominator);
      if(value<16||value>240)clampedUV++;restored[at]=Math.max(16,Math.min(240,value));
     }
     const remapMs=performance.now()-started,constructionStarted=performance.now();
     const restoredFrame=new VideoFrame(restored,{...frameInit,colorSpace:index.colorSpace});rangeFrames.push(restoredFrame);rangeBuffers.push(restored);
     const restoreMetadata=metadata(restoredFrame);
     if(Object.entries(index.colorSpace).some(([key,value])=>restoreMetadata.colorSpace[key]!==value))throw Error('Range-restoration probe did not preserve requested tags');
     rangeRestorations.push({kind,inferredMapping:true,chromaDenominator,bytes:restored.byteLength,remapMs,constructMs:performance.now()-constructionStarted,
      zeroChromaSamples,clampedY,clampedUV,metadata:restoreMetadata});
    }
   }
   // This single-source hypothesis uses ffmpeg h264_metadata output verified
   // outside this probe. Never apply a hard-coded SPS offset to another stream.
   const knownSHA='b68fb0f2edd851e63ea4cb66708af840316cc7e91ea56beb15e790b4db3e4ff2';
   const knownDescription='0164102affe1001a6764102aacb80f0044fcb350101014000003000400000301e01001000668ee02b2c8b0fdf8f800';
   const alternateConfiguration={eligible:index.sha256===knownSHA&&index.description===knownDescription,kind:'exact-source-SPS-full-range-flag',productionUse:false};
   if(alternateConfiguration.eligible)try{
    const alternateDescription=config.description.slice();
    if(alternateDescription[19]!==0x50)throw Error('Unexpected verified SPS byte');alternateDescription[19]=0x70;
    const alternateOutput=await decodeSample({...config,description:alternateDescription});alternateImage=alternateOutput.image;
    const alternateMetadata=metadata(alternateImage),alternateOptions={rect:{x:0,y:0,width:alternateImage.codedWidth,height:alternateImage.codedHeight}};
    const alternateBytes=new Uint8Array(alternateImage.allocationSize(alternateOptions)),alternateCopyStart=performance.now();
    const alternateLayout=await alternateImage.copyTo(alternateBytes,alternateOptions),alternateCopyMs=performance.now()-alternateCopyStart,alternateConstructStart=performance.now();
    alternateNormalized=new VideoFrame(alternateBytes,{format:alternateImage.format,codedWidth:alternateImage.codedWidth,codedHeight:alternateImage.codedHeight,
     visibleRect:alternateImage.visibleRect,displayWidth:alternateImage.displayWidth,displayHeight:alternateImage.displayHeight,timestamp:alternateImage.timestamp,layout:alternateLayout,colorSpace:index.colorSpace});
    const normalizedMetadata=metadata(alternateNormalized);
    if(Object.entries(index.colorSpace).some(([key,value])=>normalizedMetadata.colorSpace[key]!==value))throw Error('Alternate SPS normalization did not preserve original tags');
    Object.assign(alternateConfiguration,{completed:true,beforeTransfer:alternateOutput.beforeTransfer,afterTransfer:alternateMetadata,hardwareAcceleration:alternateOutput.hardwareAcceleration,
     configColorSpace:index.colorSpace,normalizedMetadata,bytes:alternateBytes.byteLength,layout:alternateLayout,copyMs:alternateCopyMs,constructMs:performance.now()-alternateConstructStart});
   }catch(error){alternateNormalized?.close();alternateNormalized=undefined;alternateImage?.close();alternateImage=undefined;Object.assign(alternateConfiguration,{completed:false,error:{name:error.name,message:error.message}})}
   const nativeStats=window.sofacetPreview.sequence.stats;
   if(nativeStats.presentedFrame!==frame||nativeStats.canvasPresentedFrame!==frame||nativeStats.pending!==0)throw Error('Native reference changed before pixel capture');
   const video=document.querySelector('#journey');
   const nativeVideoState={paused:video.paused,seeking:video.seeking,readyState:video.readyState,currentTime:video.currentTime,videoWidth:video.videoWidth,videoHeight:video.videoHeight};
   if(!video.paused||video.seeking||video.readyState<2)throw Error('Native video must be paused and ready for the frame constructor control');
   nativeVideoFrame=new VideoFrame(video);
   const nativeVideoMetadata=metadata(nativeVideoFrame),nativeVideoFrameIndex=Math.round(nativeVideoFrame.timestamp*index.fps/1e6);
   const nativeVideoFrameAligned=nativeVideoFrameIndex===frame;
   const nativePlaneComparison={eligible:false};
   if(nativeVideoFrameAligned&&nativeVideoFrame.format==='NV12'&&image.format==='NV12'&&
    nativeVideoFrame.codedWidth===image.codedWidth&&nativeVideoFrame.codedHeight===image.codedHeight&&
    JSON.stringify(metadata(nativeVideoFrame).visibleRect)===JSON.stringify(afterTransfer.visibleRect)){
    const nativePlaneBytes=new Uint8Array(nativeVideoFrame.allocationSize(copyOptions)),nativeLayout=await nativeVideoFrame.copyTo(nativePlaneBytes,copyOptions);
    const comparePlanes=(candidate,name)=>({name,planes:[0,1].map(plane=>{
     const rows=plane===0?image.codedHeight:Math.ceil(image.codedHeight/2),columns=plane===0?image.codedWidth:Math.ceil(image.codedWidth/2)*2;
     let maximum=0,total=0,squared=0,changed=0,belowNominal=0,aboveNominal=0;
     for(let row=0;row<rows;row++)for(let column=0;column<columns;column++){
      const expected=nativePlaneBytes[nativeLayout[plane].offset+row*nativeLayout[plane].stride+column],actual=candidate[layout[plane].offset+row*layout[plane].stride+column],difference=Math.abs(actual-expected);
      maximum=Math.max(maximum,difference);total+=difference;squared+=difference*difference;if(difference)changed++;
      if(expected<16)belowNominal++;if(expected>(plane===0?235:240))aboveNominal++;
     }
     return{plane:plane===0?'Y':'UV',samples:rows*columns,maxDifference:maximum,meanDifference:total/(rows*columns),meanSquaredError:squared/(rows*columns),changedSamples:changed,nativeBelowNominal:belowNominal,nativeAboveNominal:aboveNominal};
    })});
    Object.assign(nativePlaneComparison,{eligible:true,nativeLayout,comparisonLayout:layout,bytes:nativePlaneBytes.byteLength,
     variants:[comparePlanes(copied,'raw-full-range'),...rangeBuffers.map((buffer,i)=>comparePlanes(buffer,rangeRestorations[i].kind))]});
   }else nativePlaneComparison.reason='Requires aligned native and worker NV12 with identical coded dimensions and visible crop';

   const canvases=Array.from({length:6+rangeFrames.length+(alternateNormalized?2:0)},()=>{const canvas=document.createElement('canvas');canvas.width=index.width;canvas.height=index.height;return canvas});
   const contexts=canvases.map(canvas=>canvas.getContext('2d',{alpha:false,colorSpace:'srgb'}));
   contexts[0].drawImage(document.querySelector('#journey-frame'),0,0);contexts[1].drawImage(image,0,0);contexts[2].drawImage(corrected,0,0);contexts[3].drawImage(reconstructed,0,0);contexts[4].drawImage(nativeVideoFrame,0,0);contexts[5].drawImage(video,0,0);rangeFrames.forEach((frame,i)=>contexts[6+i].drawImage(frame,0,0));
   if(alternateNormalized){contexts[6+rangeFrames.length].drawImage(alternateImage,0,0);contexts[7+rangeFrames.length].drawImage(alternateNormalized,0,0)}
   const [nativePixels,rawPixels,correctedPixels,reconstructedPixels,nativeVideoFramePixels,pausedVideoPixels,...rangePixels]=contexts.map(context=>context.getImageData(0,0,index.width,index.height).data);
   if(alternateNormalized)alternateConfiguration.pixels={rawVsNative:compare(nativePixels,rangePixels[rangeFrames.length]),normalizedVsNative:compare(nativePixels,rangePixels[rangeFrames.length+1]),normalizedVsNativeVideoFrame:{...compare(nativeVideoFramePixels,rangePixels[rangeFrames.length+1]),sourceFrameAligned:nativeVideoFrameAligned}};
   const adjacentFrames={reference:'same frozen RVFC-captured native canvas',samples:[]};
   if(alternateConfiguration.eligible&&alternateNormalized){
    const description=config.description.slice();description[19]=0x70;
    for(const sourceFrame of [frame-1,frame,frame+1]){
     if(sourceFrame===frame){adjacentFrames.samples.push({sourceFrame,metadata:metadata(alternateNormalized),pixels:compare(nativePixels,rangePixels[rangeFrames.length+1])});continue}
     let adjacentImage,adjacentNormalized;
     try{
      const output=await decodeSample({...config,description},sourceFrame);adjacentImage=output.image;
      const options={rect:{x:0,y:0,width:adjacentImage.codedWidth,height:adjacentImage.codedHeight}},buffer=new Uint8Array(adjacentImage.allocationSize(options));
      const adjacentLayout=await adjacentImage.copyTo(buffer,options);
      adjacentNormalized=new VideoFrame(buffer,{format:adjacentImage.format,codedWidth:adjacentImage.codedWidth,codedHeight:adjacentImage.codedHeight,
       visibleRect:adjacentImage.visibleRect,displayWidth:adjacentImage.displayWidth,displayHeight:adjacentImage.displayHeight,timestamp:adjacentImage.timestamp,layout:adjacentLayout,colorSpace:index.colorSpace});
      if(Object.entries(index.colorSpace).some(([key,value])=>adjacentNormalized.colorSpace[key]!==value))throw Error('Adjacent sample normalization changed expected metadata');
      const canvas=document.createElement('canvas');canvas.width=index.width;canvas.height=index.height;const context=canvas.getContext('2d',{alpha:false,colorSpace:'srgb'});
      context.drawImage(adjacentNormalized,0,0);const candidate=context.getImageData(0,0,index.width,index.height).data;
      adjacentFrames.samples.push({sourceFrame,metadata:metadata(adjacentNormalized),pixels:compare(nativePixels,candidate)});
     }finally{adjacentNormalized?.close();adjacentImage?.close()}
    }
    adjacentFrames.exactMatches=adjacentFrames.samples.filter(sample=>sample.pixels.maxChannelDifference===0).map(sample=>sample.sourceFrame);
   }else adjacentFrames.skipped='The exact-source SPS diagnostic is unavailable';
   // Independent reference: seek while paused, never play, and allow two paints
   // after seeked before sampling. Keep the earlier nativePixels snapshot fixed.
   const requestedTime=(frame+.25)/index.fps;
   video.pause();
   if(Math.abs(video.currentTime-requestedTime)>.000001||video.seeking)await new Promise((resolve,reject)=>{
    let timeout;
    const cleanup=()=>{clearTimeout(timeout);video.removeEventListener('seeked',done);video.removeEventListener('error',failed)};
    const done=()=>{cleanup();resolve()},failed=()=>{cleanup();reject(Error('Paused reference seek failed'))};
    video.addEventListener('seeked',done);video.addEventListener('error',failed);timeout=setTimeout(()=>{cleanup();reject(Error('Paused reference seek timed out'))},10000);
    try{video.currentTime=requestedTime}catch(error){cleanup();reject(error)}
   });
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   if(!video.paused||video.seeking||video.readyState<2)throw Error('Direct paused reference is not ready');
   let directFrame;
   const pausedSeekReference={requestedTime,actualTime:video.currentTime,paused:video.paused,seeking:video.seeking,readyState:video.readyState};
   try{
    directFrame=new VideoFrame(video);const frameIndex=Math.round(directFrame.timestamp*index.fps/1e6);
    Object.assign(pausedSeekReference,{metadata:metadata(directFrame),sourceFrame:frameIndex,sourceFrameAligned:frameIndex===frame});
    const canvas=document.createElement('canvas');canvas.width=index.width;canvas.height=index.height;const context=canvas.getContext('2d',{alpha:false,colorSpace:'srgb'});
    context.drawImage(directFrame,0,0);const directPixels=context.getImageData(0,0,index.width,index.height).data;
    context.drawImage(video,0,0);const directVideoPixels=context.getImageData(0,0,index.width,index.height).data;
    pausedSeekReference.pixels={vsOriginalCapture:compare(nativePixels,directPixels),videoVsVideoFrame:compare(directPixels,directVideoPixels),
     correctedWorkerVsPausedSeek:compare(directPixels,correctedPixels),...(alternateNormalized?{normalizedSPSVsPausedSeek:compare(directPixels,rangePixels[rangeFrames.length+1])}:{})};
   }finally{directFrame?.close()}
   return{frame,expectedColorSpace:index.colorSpace,beforeTransfer:decoded.beforeTransfer,afterTransfer,hardwareAcceleration:decoded.hardwareAcceleration,
    source:{codec:index.codec,width:index.width,height:index.height},nativeMode:nativeStats.mode,nativeReference:{presentedFrame:nativeStats.presentedFrame,canvasPresentedFrame:nativeStats.canvasPresentedFrame,pending:nativeStats.pending},
    nativeVideoFrame:{element:nativeVideoState,metadata:nativeVideoMetadata,sourceFrame:nativeVideoFrameIndex,sourceFrameAligned:nativeVideoFrameAligned,planeComparison:nativePlaneComparison},
    canvasColorSpaces:Object.fromEntries(['native','raw','corrected','reconstructed','nativeVideoFrame','pausedVideo'].map((name,i)=>[name,contexts[i].getContextAttributes?.().colorSpace??null])),
    alternateConfiguration,adjacentFrames,pausedSeekReference,
    rangeRestoration:{eligible:rangeRestorations.length>0,executionContext:'window',sources:['https://developer.apple.com/documentation/corevideo/kcvpixelformattype_420ypcbcr8biplanarfullrange','https://developer.apple.com/documentation/accelerate/vimage_ypcbcrpixelrange'],variants:rangeRestorations.map((variant,i)=>({...variant,pixels:{vsNative:compare(nativePixels,rangePixels[i]),vsCorrected:compare(correctedPixels,rangePixels[i]),vsNativeVideoFrame:{...compare(nativeVideoFramePixels,rangePixels[i]),sourceFrameAligned:nativeVideoFrameAligned}}}))},
    correction:{kind:'transfer-only',executionContext:'window',bytes:copied.byteLength,layout,copyMs,constructMs,metadata:correctedMetadata},
    reconstructionControl:{constructMs:controlConstructMs,metadata:metadata(reconstructed)},
    pixels:{rawVsNative:compare(nativePixels,rawPixels),correctedVsNative:compare(nativePixels,correctedPixels),correctedVsRaw:compare(rawPixels,correctedPixels),
     reconstructedVsRaw:compare(rawPixels,reconstructedPixels),reconstructedVsNative:compare(nativePixels,reconstructedPixels),
     nativeVideoFrameVsNative:{...compare(nativePixels,nativeVideoFramePixels),sourceFrameAligned:nativeVideoFrameAligned},
     correctedVsNativeVideoFrame:{...compare(nativeVideoFramePixels,correctedPixels),sourceFrameAligned:nativeVideoFrameAligned},
     pausedVideoVsNative:compare(nativePixels,pausedVideoPixels),nativeVideoFrameVsPausedVideo:compare(pausedVideoPixels,nativeVideoFramePixels)}};
  }finally{alternateNormalized?.close();alternateImage?.close();rangeFrames.forEach(frame=>frame.close());nativeVideoFrame?.close();reconstructed?.close();corrected?.close();image.close()}
 },{workerSource:probeWorker.toString(),frame});result.samples.push(evidence);
 }
 const aggregate=key=>{
  const samples=result.samples.map(sample=>sample.pixels[key]),channels=samples.reduce((sum,sample)=>sum+sample.rgbChannels,0),pixels=samples.reduce((sum,sample)=>sum+sample.pixels,0);
  const mse=samples.reduce((sum,sample)=>sum+sample.meanSquaredRGBError*sample.rgbChannels,0)/channels;
  return{rgbChannels:channels,pixels,maxChannelDifference:Math.max(...samples.map(sample=>sample.maxChannelDifference)),
   meanRGBDifference:samples.reduce((sum,sample)=>sum+sample.meanRGBDifference*sample.rgbChannels,0)/channels,
   meanSquaredRGBError:mse,psnrDb:mse===0?null:10*Math.log10(255*255/mse),infinitePSNR:mse===0,
   exceeds:Object.fromEntries([2,8,16,32].map(threshold=>{
    const countChannels=samples.reduce((sum,sample)=>sum+sample.exceeds[threshold].rgbChannels,0),countPixels=samples.reduce((sum,sample)=>sum+sample.exceeds[threshold].pixels,0);
    return[threshold,{rgbChannels:countChannels,rgbChannelFraction:countChannels/channels,pixels:countPixels,pixelFraction:countPixels/pixels}];
   })),
   sourceFramesAligned:samples.every(sample=>sample.sourceFrameAligned!==false),
   changedRGBChannels:samples.reduce((sum,sample)=>sum+sample.changedRGBChannels,0),
   signedMeanByChannel:[0,1,2].map(channel=>samples.reduce((sum,sample)=>sum+sample.signedMeanByChannel[channel]*sample.rgbChannels,0)/channels)};
 };
 const aggregatePixels=Object.fromEntries(Object.keys(result.samples[0].pixels).map(key=>[key,aggregate(key)]));
 Object.assign(result,{completed:true,allNativeVideoFrameSourcesAligned:result.samples.every(sample=>sample.nativeVideoFrame.sourceFrameAligned),aggregate:{...aggregatePixels,
  correction:{bytes:result.samples.reduce((sum,sample)=>sum+sample.correction.bytes,0),copyMs:result.samples.reduce((sum,sample)=>sum+sample.correction.copyMs,0),
   constructMs:result.samples.reduce((sum,sample)=>sum+sample.correction.constructMs,0)}}});
}catch(error){Object.assign(result,{completed:false,error:{name:error.name,message:error.message}});process.exitCode=1}
finally{
 await browser?.close();if(server){server.kill();await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve))}if(data)await rm(data,{recursive:true,force:true});
 await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log('Raw worker colour probe',JSON.stringify(result));
}
