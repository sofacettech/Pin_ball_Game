import { prepareInlineVideo, waitForVideo } from './video-playback.js?v=frames-82220d500c54';

const abortError=()=>new DOMException('Frame loading cancelled','AbortError');

export async function createFrameSource(video,index,indexURL,captureNativeFrame,onPlaybackReady,{renderer='auto',diagnostics=false}={}){
 prepareInlineVideo(video);
 video.crossOrigin='anonymous';
 let url=new URL(index.source,indexURL);
 const description=Uint8Array.from(index.description?.match(/../g)||[],hex=>parseInt(hex,16));
 if(index.sha256)url.searchParams.set('v',index.sha256);
 const cacheURL=url.href,fallbackURL=index.fallbackSource?new URL(index.fallbackSource,indexURL):null;
 if(fallbackURL&&index.sha256)fallbackURL.searchParams.set('v',index.sha256);
 const config={codec:index.codec,codedWidth:index.width,codedHeight:index.height,description,colorSpace:index.colorSpace,optimizeForLatency:true};
 const touchDevice=globalThis.matchMedia?.('(any-pointer: coarse)')?.matches===true;
 const requestedRenderer=['worker','native'].includes(renderer)?renderer:'auto';
 let preferNative=requestedRenderer==='native'||touchDevice;
 if(requestedRenderer==='auto'&&touchDevice&&index.codec&&globalThis.navigator?.mediaCapabilities?.decodingInfo){
  try{
   const capability=await navigator.mediaCapabilities.decodingInfo({type:'file',video:{contentType:`video/mp4; codecs="${index.codec}"`,width:index.width,height:index.height,bitrate:Math.ceil(index.bytes*8*index.fps/index.frameCount),framerate:index.fps}});
   // Native buffering avoids per-frame round trips on phones. Retain the
   // explicit decoder when this device reports inefficient native decoding.
   preferNative=capability.supported&&capability.smooth&&capability.powerEfficient;
  }catch{/* Older browsers retain the native mobile compatibility path. */}
 }
 let workerDecoder,workerFailure=null,workerSnapshot={};
 let decoder,pending,disposed=false,cache,stored=[],storedKeys=new Set(),writing=false,mode='video',fallbacks=0,fallbackReason=index.codec?'decoder-unavailable':'index-unavailable';
 if(preferNative)fallbackReason='native-touch';
 const nativeSeekTiming=Object.fromEntries(['forward','backward','confirmation'].map(direction=>[direction,{count:0,totalMs:0,maxMs:0,overBudget:0}]));
 const stats={networkBytes:0,networkFrames:0,networkRequests:0,diskHits:0,decodeMs:0,nativeSeeks:0,nativeSeekMs:0,nativeRetainMs:0,nativeCaptures:0,nativePlayAttempts:0,nativePlayRejections:0,nativePresentationWaits:0,nativePresentationWaitMs:0,nativePresentationTimeouts:0,nativePresentationTimeoutStreak:0,deliveryFallbacks:0};
 function useLocal(){
  if(!fallbackURL||url.href===fallbackURL.href)return false;
  url=fallbackURL;stats.deliveryFallbacks++;return true;
 }
 if(requestedRenderer==='worker'){
  try{
   if(!index.codec)throw new DOMException('A frame index is required','NotSupportedError');
   const {createWorkerFrameDecoder}=await import('./worker-frame-decoder.js?v=frames-5740f20ba5e4');
   workerDecoder=await createWorkerFrameDecoder(config,{fps:index.fps,maxPending:4,diagnostics});
   mode='worker';fallbackReason=null;
  }catch(error){workerFailure={name:error.name,message:error.message};fallbackReason='worker-unavailable';preferNative=true}
 }
 if(requestedRenderer!=='worker'&&!preferNative&&index.codec&&typeof VideoDecoder==='function'){
  try{if((await VideoDecoder.isConfigSupported(config)).supported){
   decoder=new VideoDecoder({output:frame=>{if(pending&&!pending.image){pending.image=frame;pending.resolve(frame)}else frame.close()},error:error=>pending?.reject(error)});
   decoder.configure(config);mode='webcodecs';fallbackReason=null;
  }}catch{/* Native video remains available when the codec or hardware is unsupported. */}
 }
 const storage=mode!=='video'?Promise.resolve().then(async()=>{if(!globalThis.caches)return null;cache=await caches.open('sofacet-frames-'+index.sha256.slice(0,16));stored=await cache.keys();storedKeys=new Set(stored.map(request=>request.url));return cache}).catch(()=>null):Promise.resolve(null);
 const key=frame=>cacheURL+(cacheURL.includes('?')?'&':'?')+'frame='+frame;
 async function loadFrames(frames,signal,maxBytes=8*1024*1024,onFrame){
  if(signal.aborted||disposed)throw abortError();
  if(mode==='video')return new Map(frames.map(frame=>[frame,null]));
  const requested=[...new Set(frames)].sort((a,b)=>a-b),result=new Map(),missing=[];
  if(requested.reduce((total,frame)=>total+index.frames[frame][1],0)>maxBytes)throw Error('Frame samples exceed the cache budget');
  await storage;
  await Promise.all(requested.map(async frame=>{
   try{const saved=storedKeys.has(key(frame))?await cache?.match(key(frame)):null;if(saved){const bytes=await saved.arrayBuffer();if(bytes.byteLength===index.frames[frame][1]){stats.diskHits++;const sample=new Uint8Array(bytes);result.set(frame,sample);onFrame?.(frame,sample);return}await cache.delete(key(frame));storedKeys.delete(key(frame))}}catch{}
   missing.push(frame);
  }));
  missing.sort((a,b)=>a-b);
  const downloaded=[];
  // Fetch contiguous sync samples together to pay network latency once per group.
  for(let at=0;at<missing.length;){
   const group=[missing[at++]],offset=index.frames[group[0]][0];
   let size=index.frames[group[0]][1];
   while(at<missing.length&&index.frames[missing[at]][0]===offset+size){const frame=missing[at++];group.push(frame);size+=index.frames[frame][1]}
   const receive=(bytes,received)=>{
    for(const frame of group){
     const [start,length]=index.frames[frame];
     if(result.has(frame)||start-offset+length>received)continue;
     // Publish each complete IDR sample immediately; a visible frame must not
     // wait for all 24 future samples in the same HTTP range to arrive.
     const sample=new Uint8Array(bytes.slice(start-offset,start-offset+length));
     result.set(frame,sample);downloaded.push(frame);onFrame?.(frame,sample);
    }
   };
   const bytes=await download(offset,size,signal,onFrame?receive:undefined);
   receive(bytes,size);
   stats.networkBytes+=size;stats.networkFrames+=group.length;
  }
  if(signal.aborted||disposed)throw abortError();
  if(cache&&!writing&&downloaded.length){
   writing=true;
   void (async()=>{try{
    for(const frame of downloaded){
     if(disposed)break;
     await cache.put(key(frame),new Response(result.get(frame)));
     if(!storedKeys.has(key(frame))){stored.push(new Request(key(frame)));storedKeys.add(key(frame))}
    }
    while(stored.length>256){const oldest=stored.shift();await cache.delete(oldest);storedKeys.delete(oldest.url)}
   }catch{cache=null;stored=[];storedKeys.clear()}finally{writing=false}})();
  }
  return result;
 }
 async function download(offset,size,signal,onProgress){
  try{return await downloadRange(offset,size,signal,onProgress)}
  catch(error){
   if(signal.aborted||disposed||!useLocal())throw error;
   return downloadRange(offset,size,signal,onProgress);
  }
 }
 async function downloadRange(offset,size,signal,onProgress){
  if(signal.aborted||disposed)throw abortError();
  const request=new AbortController(),abort=()=>request.abort(signal.reason);
  const timeout=setTimeout(()=>request.abort(new DOMException('Frame download timed out','TimeoutError')),15000);
  signal.addEventListener('abort',abort,{once:true});let bytes;
  try{
   stats.networkRequests++;
   const response=await fetch(url,{headers:{Range:`bytes=${offset}-${offset+size-1}`},signal:request.signal});
   if(response.status!==206||response.headers.get('Content-Range')!==`bytes ${offset}-${offset+size-1}/${index.bytes}`){await response.body?.cancel();throw Error('Frame ranges are unavailable')}
   if(onProgress&&response.body){
    const reader=response.body.getReader(),buffer=new Uint8Array(size);let received=0;
    try{
     for(;;){
      const {done,value}=await reader.read();if(done)break;
      if(request.signal.aborted)throw request.signal.reason;
      if(received+value.byteLength>size)throw Error('Oversized frame download');
      buffer.set(value,received);received+=value.byteLength;onProgress(buffer.buffer,received);
     }
     if(received!==size)throw Error('Incomplete frame download');
     bytes=buffer.buffer;
    }catch(error){await reader.cancel().catch(()=>{});throw error}finally{reader.releaseLock()}
   }else{bytes=await response.arrayBuffer();if(bytes.byteLength!==size)throw Error('Incomplete frame download')}
  }finally{clearTimeout(timeout);signal.removeEventListener('abort',abort)}
  if(signal.aborted||disposed)throw abortError();
  return bytes;
 }
 async function load(frame,signal,maxBytes){return(await loadFrames([frame],signal,maxBytes)).get(frame)}
 const nativeCompositor=touchDevice||typeof VideoFrame!=='function';
 let nativeEvents=new AbortController(),nativeReady,nativeSeek,nativeActivated=false,nativeBlocked=false,nativePlaying=false,nativeGeneration=0,nativeDirect=nativeCompositor,nativePresentedFrame=null;
 // Version-one indexes are emitted only after every sample is verified as IDR.
 // Check the returned frame as well: fastSeek may choose an earlier sync sample.
 let nativeSnapshot,nativeFastSeekFailure=null,nativePresentationFailure=null;
 let nativeFastSeek=index.version===1&&index.frameCount>0&&index.frames?.length===index.frameCount&&typeof video.fastSeek==='function';
 const gestures=new AbortController();
 function playbackFailure(error){
  if(error.name==='NotAllowedError'){nativeActivated=false;nativeBlocked=true;stats.nativePlayRejections++}
 }
 function primeNative(){
  if(disposed||nativeActivated||nativePlaying||nativeSeek?.confirm||globalThis.document?.hidden)return;
  const generation=nativeGeneration;
  nativePlaying=true;stats.nativePlayAttempts++;
  // Data readiness is separate from permission to play. A decoded video can
  // still need a real tap on iOS; retry synchronously inside that gesture.
  try{Promise.resolve(video.play()).then(()=>{
   if(generation!==nativeGeneration||disposed)return;
   nativeActivated=true;nativeBlocked=false;nativePlaying=false;
   // Do not interrupt an exact-frame confirmation that started meanwhile.
   if(!nativeSeek?.confirm)video.pause();
   onPlaybackReady?.();
  },error=>{if(generation===nativeGeneration&&!disposed){nativePlaying=false;playbackFailure(error)}})}
  catch(error){nativePlaying=false;playbackFailure(error)}
 }
 function ready(){
  if(video.error){nativeReady=undefined;nativeActivated=false}
  if(!nativeReady){
   // A display:none video can stop producing seeked/decoded frames in WebKit.
   video.hidden=false;
   const buffered=video.src===url.href&&video.readyState>=2&&!video.seeking&&!video.error;
   if(buffered){if(!nativePlaying)video.pause()}
   else{video.preload='auto';video.src=url.href;video.load();nativeActivated=false;primeNative()}
   const signal=nativeEvents.signal;
   const request=waitForVideo(video,{readyState:2,signal}).then(()=>{
    if(signal.aborted||disposed)throw abortError();
    if(!nativePlaying&&!nativeSeek?.confirm)video.pause();
   }).catch(error=>{
    if(nativeReady===request){nativeReady=undefined;nativeActivated=false;nativePlaying=false;nativeGeneration++;video.pause()}
    if(error.name!=='AbortError'&&!disposed&&useLocal())return ready();
    throw error;
   });
   nativeReady=request;
  }
  return nativeReady;
 }
 function activateNative(){
  if(mode!=='video'||disposed||globalThis.document?.hidden)return;
  if(!nativeReady)void ready().catch(()=>{});
  primeNative();
 }
 for(const event of ['touchend','click','keydown'])globalThis.document?.addEventListener(event,activateNative,{passive:true,signal:gestures.signal});
 function watchNativePresentation(frame,signal){
  let callback,timer,finished=false,resolve,reject;
  const presented=new Promise((yes,no)=>{resolve=yes;reject=no});
  // Cancellation can arrive while decoded-data readiness is still pending.
  presented.catch(()=>{});
  function finish(error,time){
   if(finished)return;
   finished=true;clearTimeout(timer);
   if(callback!==undefined)video.cancelVideoFrameCallback(callback);
   callback=undefined;signal.removeEventListener('abort',abort);video.removeEventListener('error',failed);
   error?reject(error):resolve(time);
  }
  const abort=()=>finish(signal.reason instanceof Error||signal.reason instanceof DOMException?signal.reason:abortError());
  const failed=()=>{
   const error=new Error('The video could not load');
   error.name=video.error?.code===4?'NotSupportedError':video.error?.code===3?'EncodingError':'NetworkError';
   finish(error);
  };
  function onFrame(_now,metadata){
   if(finished)return;
   callback=undefined;
   // The compositor may acknowledge pixels before seeked is dispatched. Keep
   // that acknowledgment; decoded-data readiness is checked independently.
   if(Math.round(metadata.mediaTime*index.fps)===frame){stats.nativePresentationTimeoutStreak=0;finish(undefined,metadata.mediaTime)}
   else if(!finished)callback=video.requestVideoFrameCallback(onFrame);
  }
  signal.addEventListener('abort',abort,{once:true});video.addEventListener('error',failed);
  if(signal.aborted)abort();
  else if(video.error)failed();
  else callback=video.requestVideoFrameCallback(onFrame);
  return{
   async wait(){
    const start=performance.now();stats.nativePresentationWaits++;
    // Paused WebKit can omit a callback. Bound only the extra presentation
    // wait, after seeking/data readiness, so it cannot stall the journey.
    if(!finished)timer=setTimeout(()=>{
     stats.nativePresentationTimeouts++;stats.nativePresentationTimeoutStreak++;
     // Some paused-video implementations never acknowledge motion frames.
     // Preserve their original seek cadence after three consecutive misses.
     if(stats.nativePresentationTimeoutStreak>=3)nativePresentationFailure='consecutive-timeouts';
     finish();
    },1000/30);
    try{return await presented}finally{stats.nativePresentationWaitMs+=performance.now()-start}
   },
   cancel(){finish()}
  };
 }
 async function nativeDecode(frame,settled){
  if(disposed)throw abortError();
  if(settled&&nativeSnapshot?.frame===frame)return nativeSnapshot.image;
  const generation=nativeGeneration;let snapshot;
  await ready();if(disposed)throw abortError();
  const watchesPixels=settled&&nativeDirect&&typeof video.requestVideoFrameCallback==='function';
  if(watchesPixels&&nativeBlocked)throw new DOMException('Tap to resume the journey','NotAllowedError');
  let time=(frame+.25)/index.fps;
  const confirm=watchesPixels&&nativePresentedFrame!==frame;
  // Approach a settled destination from its preceding frame, matching the
  // reference capture. The target must still be ahead when callbacks start.
  if(confirm&&frame>0)time=(frame-.75)/index.fps;
  if(video.readyState<2||Math.abs(video.currentTime-time)>.001||confirm){
   nativePresentedFrame=null;
   const start=performance.now();
   const timing=nativeSeekTiming[settled?'confirmation':time>=video.currentTime?'forward':'backward'];
   const seek={frame,confirm:watchesPixels,controller:new AbortController()},events=nativeEvents.signal;
   const playbackRate=video.playbackRate;let presentation;
   const abort=()=>seek.controller.abort();
   nativeSeek=seek;events.addEventListener('abort',abort,{once:true});
   try{
    const settle=async()=>{
     await waitForVideo(video,{readyState:2,signal:seek.controller.signal,pollOnPaint:true,pollInterval:4});
     if(!watchesPixels)return undefined;
     // Register after the seek, as WebKit can discard callbacks from the old
     // decoder surface. Brief playback supplies a fresh, timestamped frame.
     const presented=waitForVideo(video,{readyState:2,signal:seek.controller.signal,presentedFrame:true,pauseOnFrame:true,onPresentedFrame:()=>{const start=performance.now();snapshot=captureNativeFrame?.(frame);if(snapshot){stats.nativeCaptures++;stats.nativeRetainMs+=performance.now()-start}},frame,fps:index.fps});
     // A synchronous pause inside the callback can reject a pending play()
     // with AbortError. The presented frame is the readiness signal.
     stats.nativePlayAttempts++;
     try{void Promise.resolve(video.play()).then(()=>{
      if(generation===nativeGeneration&&!disposed){nativeActivated=true;nativeBlocked=false}
     },error=>{if(error.name!=='AbortError'){if(generation===nativeGeneration)playbackFailure(error);seek.controller.abort(error)}})}
     catch(error){playbackFailure(error);seek.controller.abort(error)}
     return await presented;
    };
    if(watchesPixels)video.playbackRate=.0625;
    // The opening still hides frame zero while play() primes the decoder.
    // Playback can advance during that warm-up; it must not be interpreted as
    // an inaccurate fastSeek and permanently disable keyframe motion seeking.
    let usedFastSeek=false;
    if(nativeFastSeek&&!watchesPixels&&frame>0&&!nativePlaying&&video.paused){
     if(!settled&&nativeDirect&&!nativePresentationFailure&&typeof video.requestVideoFrameCallback==='function')presentation=watchNativePresentation(frame,seek.controller.signal);
     try{video.fastSeek(time);usedFastSeek=true}catch(error){presentation?.cancel();nativeFastSeek=false;nativeFastSeekFailure={reason:error.name||'error',frame};video.currentTime=time}
    }else video.currentTime=time;
    let presentedTime=await settle();
    if(usedFastSeek&&Math.floor(video.currentTime*index.fps+1e-6)!==frame){
     presentation?.cancel();
     nativeFastSeek=false;nativeFastSeekFailure={reason:'frame-mismatch',frame,actualFrame:Math.floor(video.currentTime*index.fps+1e-6)};
     video.currentTime=time;
     presentedTime=await settle();
    }else if(usedFastSeek)await presentation?.wait();
    if(presentedTime!==undefined&&Math.round(presentedTime*index.fps)!==frame)throw Error(`The video presented frame ${Math.round(presentedTime*index.fps)} instead of ${frame}`);
    if(settled)nativePresentedFrame=frame;
   }catch(error){if(!['AbortError','NotAllowedError'].includes(error.name))nativeReady=undefined;throw error}
   finally{presentation?.cancel();if(watchesPixels){if(!video.paused)video.pause();video.playbackRate=playbackRate}events.removeEventListener('abort',abort);if(nativeSeek===seek)nativeSeek=undefined}
   const elapsed=performance.now()-start;
   stats.nativeSeeks++;stats.nativeSeekMs+=elapsed;
   timing.count++;timing.totalMs+=elapsed;timing.maxMs=Math.max(timing.maxMs,elapsed);if(elapsed>1000/30)timing.overBudget++;
  }
  if(disposed||generation!==nativeGeneration)throw abortError();
  if(settled&&typeof video.requestVideoFrameCallback!=='function')nativePresentedFrame=frame;
  // Retain the native decoder's surface before the next seek. On older Safari,
  // use the native video compositor rather than making two full-size RGB copies.
  nativeSnapshot=snapshot?{frame,image:snapshot}:undefined;
  if(snapshot)return snapshot;
  const retainStart=performance.now();let image;
  if(!nativeDirect){
   try{image=new VideoFrame(video,{timestamp:Math.round(frame*1e6/index.fps)})}catch{nativeDirect=true}
  }
  if(!image){
   video.transient=true;video.close=()=>{};image=video;
  }
  if(disposed||generation!==nativeGeneration){image.close();throw abortError()}
  stats.nativeRetainMs+=performance.now()-retainStart;
  return image;
 }
 async function decode(frame,bytes,settled=true,signal){
  const start=performance.now();let timeout;
  try{
   if(mode==='video')return await nativeDecode(frame,settled);
   if(mode==='worker'){
    try{return await workerDecoder.decode(frame,bytes,signal)}
    catch(error){if(error.name!=='AbortError')workerFailure={name:error.name,message:error.message};throw error}
   }
   const output=new Promise((resolve,reject)=>{pending={resolve,reject}});
   output.catch(()=>{});
   decoder.decode(new EncodedVideoChunk({type:'key',timestamp:Math.round(frame*1e6/index.fps),duration:Math.round(1e6/index.fps),data:bytes}));
   const [image]=await Promise.race([Promise.all([output,decoder.flush()]),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('The frame decoder stopped responding')),8000)})]);pending=null;
   if(index.colorSpace&&Object.entries(index.colorSpace).some(([key,value])=>image.colorSpace?.[key]!==value)){
    // Preserve native-video colours when a decoder ignores the container's transfer tag.
    image.close();fallback('colour-metadata');return await nativeDecode(frame,settled);
   }
   return image;
  }finally{pending?.image?.close();pending=null;clearTimeout(timeout);stats.decodeMs=performance.now()-start}
 }
 function fallback(reason='decode-or-range'){
  if(mode==='video')return false;fallbacks++;fallbackReason=reason;
  if(workerDecoder){workerSnapshot=workerDecoder.stats;workerDecoder.destroy();workerDecoder=null}
  mode='video';pending?.image?.close();pending?.reject(abortError());pending=null;
  if(decoder?.state!=='closed')decoder?.close();decoder=null;return true;
 }
 function bufferedAheadSeconds(){
  const ranges=video.buffered,time=video.currentTime;
  for(let i=0;i<(ranges?.length||0);i++)if(ranges.start(i)<=time&&ranges.end(i)>=time)return ranges.end(i)-time;
  return 0;
 }
 function bufferedSeconds(){
  const ranges=video.buffered;
  for(let i=0;i<(ranges?.length||0);i++)if(ranges.start(i)<=.05&&ranges.end(i)>0)return ranges.end(i);
  return 0;
 }
 return{load,loadFrames,markDrawn:diagnostics?image=>workerDecoder?.markDrawn(image):undefined,activate:activateNative,get decodeConcurrency(){return mode==='worker'?4:1},get playbackBlocked(){return nativeBlocked},frameBytes:frame=>mode==='video'?0:index.frames[frame][1],decodedFrameBytes:index.width*index.height*4,decode,fallback,
  retarget(frame,presented,desired=frame){
   // Finish useful progress, but cancel a seek that would overshoot the new
   // target after a reversal instead of making the finger wait for it.
   // Pixel confirmation belongs only to a stationary destination. A resumed
   // scroll must not wait for its slow controlled playback, even if the pacer
   // is still requesting that useful intermediate frame.
   if(nativeSeek&&((nativeSeek.confirm&&nativeSeek.frame!==desired)||nativeSeek.frame<Math.min(frame,presented)||nativeSeek.frame>Math.max(frame,presented)))nativeSeek.controller.abort();
  },
  get mode(){return mode},get nativeFastSeek(){return mode==='video'&&nativeFastSeek},get presentedFrame(){return nativePresentedFrame},get transient(){return mode==='video'&&nativeDirect},get stats(){return{...stats,...(workerDecoder?.stats||workerSnapshot),requestedRenderer,workerFailure,nativePresentationGuardEnabled:mode==='video'&&nativeDirect&&nativeFastSeek&&!nativePresentationFailure&&typeof video.requestVideoFrameCallback==='function',nativePresentationFailure,nativeFastSeek:mode==='video'&&nativeFastSeek,nativeFastSeekFailure:nativeFastSeekFailure?{...nativeFastSeekFailure}:null,nativeSeekTiming:Object.fromEntries(Object.entries(nativeSeekTiming).map(([key,value])=>[key,{...value}])),nativePlaybackActivated:nativeActivated,nativePlaybackBlocked:nativeBlocked,bufferedAheadSeconds:mode==='video'?bufferedAheadSeconds():0,mode,presentedFrame:nativePresentedFrame,renderer:mode==='video'?(nativeDirect&&!nativeSnapshot?'native-video':'native-frame'):mode==='worker'?'worker-webcodecs':'webcodecs',fallbacks,fallbackReason,mediaOrigin:url.origin,bufferedSeconds:mode==='video'?bufferedSeconds():0,canPlayThrough:mode==='video'&&video.readyState===4&&!video.seeking&&!video.error}},
  suspend(){workerDecoder?.suspend();nativeGeneration++;nativePlaying=false;nativeActivated=false;nativeReady=undefined;video.pause();nativeEvents.abort();nativeEvents=new AbortController()},
  destroy(){disposed=true;workerDecoder?.destroy();nativeSnapshot=undefined;nativeGeneration++;gestures.abort();nativeEvents.abort();pending?.image?.close();pending?.reject(abortError());pending=null;if(decoder?.state!=='closed')decoder?.close();video.pause();video.removeAttribute('src');video.load()}};
}
