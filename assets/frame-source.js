import { prepareInlineVideo, waitForVideo } from './video-playback.js?v=frames-b1954aae3e53';

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
 let decoder,pending,disposed=false,cache,stored=[],storedKeys=new Set(),writing=false,mode='video',fallbacks=0,fallbackReason=index.codec?'decoder-unavailable':'index-unavailable';
 const stats={networkBytes:0,networkFrames:0,networkRequests:0,diskHits:0,decodeMs:0,deliveryFallbacks:0};
 function useLocal(){
  if(!fallbackURL||url.href===fallbackURL.href)return false;
  url=fallbackURL;stats.deliveryFallbacks++;return true;
 }
 if(index.codec&&typeof VideoDecoder==='function'){
  try{if((await VideoDecoder.isConfigSupported(config)).supported){
   decoder=new VideoDecoder({output:frame=>{if(pending&&!pending.image){pending.image=frame;pending.resolve(frame)}else frame.close()},error:error=>pending?.reject(error)});
   decoder.configure(config);mode='webcodecs';fallbackReason=null;
  }}catch{/* Native video remains available when the codec or hardware is unsupported. */}
 }
 const storage=mode==='webcodecs'?Promise.resolve().then(async()=>{if(!globalThis.caches)return null;cache=await caches.open('sofacet-frames-'+index.sha256.slice(0,16));stored=await cache.keys();storedKeys=new Set(stored.map(request=>request.url));return cache}).catch(()=>null):Promise.resolve(null);
 const key=frame=>cacheURL+(cacheURL.includes('?')?'&':'?')+'frame='+frame;
 async function loadFrames(frames,signal,maxBytes=8*1024*1024){
  if(signal.aborted||disposed)throw abortError();
  if(mode==='video')return new Map(frames.map(frame=>[frame,null]));
  const requested=[...new Set(frames)].sort((a,b)=>a-b),result=new Map(),missing=[];
  if(requested.reduce((total,frame)=>total+index.frames[frame][1],0)>maxBytes)throw Error('Frame samples exceed the cache budget');
  await storage;
  await Promise.all(requested.map(async frame=>{
   try{const saved=storedKeys.has(key(frame))?await cache?.match(key(frame)):null;if(saved){const bytes=await saved.arrayBuffer();if(bytes.byteLength===index.frames[frame][1]){stats.diskHits++;result.set(frame,new Uint8Array(bytes));return}await cache.delete(key(frame));storedKeys.delete(key(frame))}}catch{}
   missing.push(frame);
  }));
  missing.sort((a,b)=>a-b);
  const downloaded=[];
  // Fetch contiguous sync samples together to pay network latency once per group.
  for(let at=0;at<missing.length;){
   const group=[missing[at++]],offset=index.frames[group[0]][0];
   let size=index.frames[group[0]][1];
   while(at<missing.length&&index.frames[missing[at]][0]===offset+size){const frame=missing[at++];group.push(frame);size+=index.frames[frame][1]}
   const bytes=await download(offset,size,signal);
   for(const frame of group){
    const [start,length]=index.frames[frame];
    // Own the sample's buffer so evicting one frame releases its bytes.
    const sample=new Uint8Array(bytes.slice(start-offset,start-offset+length));
    result.set(frame,sample);downloaded.push(frame);
   }
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
 async function download(offset,size,signal){
  try{return await downloadRange(offset,size,signal)}
  catch(error){
   if(signal.aborted||disposed||!useLocal())throw error;
   return downloadRange(offset,size,signal);
  }
 }
 async function downloadRange(offset,size,signal){
  if(signal.aborted||disposed)throw abortError();
  const request=new AbortController(),abort=()=>request.abort(signal.reason);
  const timeout=setTimeout(()=>request.abort(new DOMException('Frame download timed out','TimeoutError')),15000);
  signal.addEventListener('abort',abort,{once:true});let bytes;
  try{
   stats.networkRequests++;
   const response=await fetch(url,{headers:{Range:`bytes=${offset}-${offset+size-1}`},signal:request.signal});
   if(response.status!==206||response.headers.get('Content-Range')!==`bytes ${offset}-${offset+size-1}/${index.bytes}`){await response.body?.cancel();throw Error('Frame ranges are unavailable')}
   bytes=await response.arrayBuffer();if(bytes.byteLength!==size)throw Error('Incomplete frame download');
  }finally{clearTimeout(timeout);signal.removeEventListener('abort',abort)}
  if(signal.aborted||disposed)throw abortError();
  return bytes;
 }
 async function load(frame,signal,maxBytes){return(await loadFrames([frame],signal,maxBytes)).get(frame)}
 let nativeEvents=new AbortController(),nativeReady,nativePrimed=false,nativePlaying=false,nativeGeneration=0;
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
   video.preload='auto';video.src=url.href;
   video.load();
   primeNative();
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
 async function nativeDecode(frame){
  await ready();if(disposed)throw abortError();
  const time=(frame+.25)/index.fps;
  if(video.readyState<2||Math.abs(video.currentTime-time)>.001){
   video.currentTime=time;
   await waitForVideo(video,{readyState:2,signal:nativeEvents.signal}).catch(error=>{nativeReady=undefined;throw error});
  }
  // A native video is mutable: the cache may use it only for this completed seek.
  video.transient=true;video.close=()=>{};return video;
 }
 async function decode(frame,bytes){
  const start=performance.now();let timeout;
  try{
   if(mode==='video')return await nativeDecode(frame);
   const output=new Promise((resolve,reject)=>{pending={resolve,reject}});
   output.catch(()=>{});
   decoder.decode(new EncodedVideoChunk({type:'key',timestamp:Math.round(frame*1e6/index.fps),duration:Math.round(1e6/index.fps),data:bytes}));
   const [image]=await Promise.race([Promise.all([output,decoder.flush()]),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('The frame decoder stopped responding')),8000)})]);pending=null;
   if(index.colorSpace&&Object.entries(index.colorSpace).some(([key,value])=>image.colorSpace?.[key]!==value)){
    // Preserve native-video colours when a decoder ignores the container's transfer tag.
    image.close();fallback('colour-metadata');return await nativeDecode(frame);
   }
   return image;
  }finally{pending?.image?.close();pending=null;clearTimeout(timeout);stats.decodeMs=performance.now()-start}
 }
 function fallback(reason='decode-or-range'){
  if(mode==='video')return false;fallbacks++;fallbackReason=reason;
  mode='video';pending?.image?.close();pending?.reject(abortError());pending=null;
  if(decoder?.state!=='closed')decoder?.close();decoder=null;return true;
 }
 return{load,loadFrames,frameBytes:frame=>mode==='video'?0:index.frames[frame][1],decodedFrameBytes:index.width*index.height*4,decode,fallback,get mode(){return mode},get stats(){return{...stats,mode,fallbacks,fallbackReason,mediaOrigin:url.origin}},
  suspend(){nativeGeneration++;nativePlaying=false;nativePrimed=false;nativeReady=undefined;video.pause();nativeEvents.abort();nativeEvents=new AbortController()},
  destroy(){disposed=true;nativeGeneration++;gestures.abort();nativeEvents.abort();pending?.image?.close();pending?.reject(abortError());pending=null;if(decoder?.state!=='closed')decoder?.close();video.pause();video.removeAttribute('src');video.load()}};
}
