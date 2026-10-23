import { prepareInlineVideo, waitForVideo } from './video-playback.js?v=frames-bb6b5d3883b3';

const abortError=()=>new DOMException('Frame loading cancelled','AbortError');

export async function createFrameSource(video,index,indexURL){
 prepareInlineVideo(video);
 video.crossOrigin='anonymous';
 let url=new URL(index.source,indexURL);
 const description=Uint8Array.from(index.description?.match(/../g)||[],hex=>parseInt(hex,16));
 if(index.sha256)url.searchParams.set('v',index.sha256);
 const cacheURL=url.href,fallbackURL=index.fallbackSource?new URL(index.fallbackSource,indexURL):null;
 if(fallbackURL&&index.sha256)fallbackURL.searchParams.set('v',index.sha256);
 const config={codec:index.codec,codedWidth:index.width,codedHeight:index.height,description,colorSpace:index.colorSpace,optimizeForLatency:true};
 const touchDevice=globalThis.matchMedia?.('(any-pointer: coarse)')?.matches===true;
 let preferNative=touchDevice;
 if(touchDevice&&index.codec&&globalThis.navigator?.mediaCapabilities?.decodingInfo){
  try{
   const capability=await navigator.mediaCapabilities.decodingInfo({type:'file',video:{contentType:`video/mp4; codecs="${index.codec}"`,width:index.width,height:index.height,bitrate:Math.ceil(index.bytes*8*index.fps/index.frameCount),framerate:index.fps}});
   // Native buffering avoids per-frame round trips on phones. Retain the
   // explicit decoder when this device reports inefficient native decoding.
   preferNative=capability.supported&&capability.smooth&&capability.powerEfficient;
  }catch{/* Older browsers retain the native mobile compatibility path. */}
 }
 let decoder,pending,disposed=false,cache,stored=[],storedKeys=new Set(),writing=false,mode='video',fallbacks=0,fallbackReason=index.codec?'decoder-unavailable':'index-unavailable';
 if(preferNative)fallbackReason='native-touch';
 const stats={networkBytes:0,networkFrames:0,networkRequests:0,diskHits:0,decodeMs:0,nativeSeeks:0,nativeSeekMs:0,nativeRetainMs:0,deliveryFallbacks:0};
 function useLocal(){
  if(!fallbackURL||url.href===fallbackURL.href)return false;
  url=fallbackURL;stats.deliveryFallbacks++;return true;
 }
 if(!preferNative&&index.codec&&typeof VideoDecoder==='function'){
  try{if((await VideoDecoder.isConfigSupported(config)).supported){
   decoder=new VideoDecoder({output:frame=>{if(pending&&!pending.image){pending.image=frame;pending.resolve(frame)}else frame.close()},error:error=>pending?.reject(error)});
   decoder.configure(config);mode='webcodecs';fallbackReason=null;
  }}catch{/* Native video remains available when the codec or hardware is unsupported. */}
 }
 const storage=mode==='webcodecs'?Promise.resolve().then(async()=>{if(!globalThis.caches)return null;cache=await caches.open('sofacet-frames-'+index.sha256.slice(0,16));stored=await cache.keys();storedKeys=new Set(stored.map(request=>request.url));return cache}).catch(()=>null):Promise.resolve(null);
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
 let nativeEvents=new AbortController(),nativeReady,nativeSeek,nativePrimed=false,nativePlaying=false,nativeGeneration=0,nativeDirect=nativeCompositor,nativePresentedFrame=null;
 // Version-one indexes are emitted only after every sample is verified as IDR.
 // Check the returned frame as well: fastSeek may choose an earlier sync sample.
 let nativeFastSeek=index.version===1&&index.frameCount>0&&index.frames?.length===index.frameCount&&typeof video.fastSeek==='function';
 const gestures=new AbortController();
 function primeNative(){
  if(disposed||nativePrimed||nativePlaying||globalThis.document?.hidden)return;
  const generation=nativeGeneration;
  nativePlaying=true;
  // Call play synchronously from touchend/click when iOS requires activation.
  // This only warms the decoder; the journey remains controlled by seeks.
  try{Promise.resolve(video.play()).then(()=>{
   if(generation===nativeGeneration){video.pause();nativePlaying=false}
  },()=>{if(generation===nativeGeneration)nativePlaying=false})}
  catch{nativePlaying=false}
 }
 function ready(){
  if(video.error){nativeReady=undefined;nativePrimed=false}
  if(!nativeReady){
   // A display:none video can stop producing seeked/decoded frames in WebKit.
   video.hidden=false;
   const buffered=video.src===url.href&&video.readyState>=2&&!video.seeking&&!video.error;
   if(buffered){nativePrimed=true;video.pause()}
   else{video.preload='auto';video.src=url.href;video.load();primeNative()}
   const signal=nativeEvents.signal;
   const request=waitForVideo(video,{readyState:2,signal}).then(()=>{
    if(signal.aborted||disposed)throw abortError();
    nativePrimed=true;video.pause();
   }).catch(error=>{
    if(nativeReady===request){nativeReady=undefined;nativePrimed=false;nativePlaying=false;nativeGeneration++;video.pause()}
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
  else primeNative();
 }
 for(const event of ['touchend','click','keydown'])globalThis.document?.addEventListener(event,activateNative,{passive:true,signal:gestures.signal});
 async function nativeDecode(frame,settled){
  const generation=nativeGeneration;
  await ready();if(disposed)throw abortError();
  let time=(frame+.25)/index.fps;
  const confirm=settled&&nativeDirect&&typeof video.requestVideoFrameCallback==='function'&&nativePresentedFrame!==frame;
  if(confirm&&Math.abs(video.currentTime-time)<.001)time=(frame+.5)/index.fps;
  if(video.readyState<2||Math.abs(video.currentTime-time)>.001||confirm){
   nativePresentedFrame=null;
   const start=performance.now();
   const seek={frame,controller:new AbortController()},events=nativeEvents.signal;
   const abort=()=>seek.controller.abort();
   nativeSeek=seek;events.addEventListener('abort',abort,{once:true});
   try{
    // Subscribe before seeking: readyState/currentTime can advance before
    // WebKit replaces the compositor's pixels, even after seeked fires.
    const wait=()=>waitForVideo(video,{readyState:2,signal:seek.controller.signal,pollOnPaint:true,pollInterval:4,presentedFrame:settled&&nativeDirect,frame:nativeFastSeek?undefined:frame,fps:index.fps});
    const watchesPixels=settled&&nativeDirect&&typeof video.requestVideoFrameCallback==='function';
    const settle=async presented=>{
     // WebKit may suppress frame callbacks for paused seeks. Brief muted
     // playback produces a real compositor frame; pause before advancing again.
     const [mediaTime]=await Promise.all([presented??wait(),watchesPixels?video.play():undefined]);
     if(watchesPixels)video.pause();
     return mediaTime;
    };
    if(watchesPixels)video.playbackRate=.0625;
    let presented=watchesPixels?wait():undefined;
    if(nativeFastSeek){
     try{video.fastSeek(time)}catch{nativeFastSeek=false;video.currentTime=time}
    }else video.currentTime=time;
    let presentedTime=await settle(presented);
    if(nativeFastSeek&&(presentedTime===undefined?Math.floor(video.currentTime*index.fps+1e-6):Math.round(presentedTime*index.fps))!==frame){
     nativeFastSeek=false;
     presented=watchesPixels?wait():undefined;
     video.currentTime=time;
     presentedTime=await settle(presented);
    }
    if(presentedTime!==undefined&&Math.round(presentedTime*index.fps)!==frame)throw Error(`The video presented frame ${Math.round(presentedTime*index.fps)} instead of ${frame}`);
    if(settled)nativePresentedFrame=frame;
   }catch(error){if(error.name!=='AbortError')nativeReady=undefined;throw error}
   finally{video.pause();events.removeEventListener('abort',abort);if(nativeSeek===seek)nativeSeek=undefined}
   stats.nativeSeeks++;stats.nativeSeekMs+=performance.now()-start;
  }
  if(disposed||generation!==nativeGeneration)throw abortError();
  if(settled&&typeof video.requestVideoFrameCallback!=='function')nativePresentedFrame=frame;
  // Retain the native decoder's surface before the next seek. On older Safari,
  // use the native video compositor rather than making two full-size RGB copies.
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
 async function decode(frame,bytes,settled=true){
  const start=performance.now();let timeout;
  try{
   if(mode==='video')return await nativeDecode(frame,settled);
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
  mode='video';pending?.image?.close();pending?.reject(abortError());pending=null;
  if(decoder?.state!=='closed')decoder?.close();decoder=null;return true;
 }
 function bufferedSeconds(){
  const ranges=video.buffered;
  for(let i=0;i<(ranges?.length||0);i++)if(ranges.start(i)<=.05&&ranges.end(i)>0)return ranges.end(i);
  return 0;
 }
 return{load,loadFrames,frameBytes:frame=>mode==='video'?0:index.frames[frame][1],decodedFrameBytes:index.width*index.height*4,decode,fallback,
  retarget(frame,presented){
   // Finish useful progress, but cancel a seek that would overshoot the new
   // target after a reversal instead of making the finger wait for it.
   if(nativeSeek&&(nativeSeek.frame<Math.min(frame,presented)||nativeSeek.frame>Math.max(frame,presented)))nativeSeek.controller.abort();
  },
  get mode(){return mode},get presentedFrame(){return nativePresentedFrame},get transient(){return mode==='video'&&nativeDirect},get stats(){return{...stats,mode,presentedFrame:nativePresentedFrame,renderer:mode==='video'?(nativeDirect?'native-video':'native-frame'):'webcodecs',fallbacks,fallbackReason,mediaOrigin:url.origin,bufferedSeconds:mode==='video'?bufferedSeconds():0,canPlayThrough:mode==='video'&&video.readyState===4&&!video.seeking&&!video.error}},
  suspend(){nativeGeneration++;nativePlaying=false;nativePrimed=false;nativeReady=undefined;video.pause();nativeEvents.abort();nativeEvents=new AbortController()},
  destroy(){disposed=true;nativeGeneration++;gestures.abort();nativeEvents.abort();pending?.image?.close();pending?.reject(abortError());pending=null;if(decoder?.state!=='closed')decoder?.close();video.pause();video.removeAttribute('src');video.load()}};
}
