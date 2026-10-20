import { prepareInlineVideo, waitForVideo } from './video-playback.js?v=frames-b1954aae3e53';

const abortError=()=>new DOMException('Frame loading cancelled','AbortError');

export async function createFrameSource(video,index,indexURL){
 prepareInlineVideo(video);
 const url=new URL(index.source,indexURL),description=Uint8Array.from(index.description?.match(/../g)||[],hex=>parseInt(hex,16));
 if(index.sha256)url.searchParams.set('v',index.sha256);
 const config={codec:index.codec,codedWidth:index.width,codedHeight:index.height,description,colorSpace:index.colorSpace,optimizeForLatency:true};
 let decoder,pending,disposed=false,cache,stored=[],storedKeys=new Set(),writing=false,mode='video',fallbacks=0,fallbackReason=index.codec?'decoder-unavailable':'index-unavailable';
 const stats={networkBytes:0,networkFrames:0,diskHits:0,decodeMs:0};
 if(index.codec&&typeof VideoDecoder==='function'){
  try{if((await VideoDecoder.isConfigSupported(config)).supported){
   decoder=new VideoDecoder({output:frame=>{if(pending&&!pending.image){pending.image=frame;pending.resolve(frame)}else frame.close()},error:error=>pending?.reject(error)});
   decoder.configure(config);mode='webcodecs';fallbackReason=null;
  }}catch{/* Native video remains available when the codec or hardware is unsupported. */}
 }
 const storage=mode==='webcodecs'?Promise.resolve().then(async()=>{if(!globalThis.caches)return null;cache=await caches.open('sofacet-frames-'+index.sha256.slice(0,16));stored=await cache.keys();storedKeys=new Set(stored.map(request=>request.url));return cache}).catch(()=>null):Promise.resolve(null);
 const key=frame=>url.href+(url.search?'&':'?')+'frame='+frame;
 async function load(frame,signal,maxBytes=8*1024*1024){
  if(signal.aborted||disposed)throw abortError();
  if(mode==='video')return null;
  if(index.frames[frame][1]>maxBytes)throw Error('Frame sample exceeds the cache budget');
  await storage;
  try{const saved=storedKeys.has(key(frame))?await cache?.match(key(frame)):null;if(saved){const bytes=await saved.arrayBuffer();if(bytes.byteLength===index.frames[frame][1]){stats.diskHits++;return new Uint8Array(bytes)}await cache.delete(key(frame));storedKeys.delete(key(frame))}}catch{}
  const [offset,size]=index.frames[frame];
  if(signal.aborted||disposed)throw abortError();
  const request=new AbortController(),abort=()=>request.abort(signal.reason);
  const timeout=setTimeout(()=>request.abort(new DOMException('Frame download timed out','TimeoutError')),15000);
  signal.addEventListener('abort',abort,{once:true});let bytes;
  try{
   const response=await fetch(url,{headers:{Range:`bytes=${offset}-${offset+size-1}`},signal:request.signal});
   if(response.status!==206||response.headers.get('Content-Range')!==`bytes ${offset}-${offset+size-1}/${index.bytes}`){await response.body?.cancel();throw Error('Frame ranges are unavailable')}
   bytes=await response.arrayBuffer();if(bytes.byteLength!==size)throw Error('Incomplete frame download');
  }finally{clearTimeout(timeout);signal.removeEventListener('abort',abort)}
  if(signal.aborted||disposed)throw abortError();
  stats.networkBytes+=size;stats.networkFrames++;
  if(cache&&!writing){
   // CacheStorage accepts complete responses; store each compressed sample as a 200 entry.
   writing=true;
   void (async()=>{try{await cache.put(key(frame),new Response(bytes));stored.push(new Request(key(frame)));storedKeys.add(key(frame));while(stored.length>256){const oldest=stored.shift();await cache.delete(oldest);storedKeys.delete(oldest.url)}}catch{cache=null;stored=[];storedKeys.clear()}finally{writing=false}})();
  }
  return new Uint8Array(bytes);
 }
 let nativeEvents=new AbortController(),nativeReady;
 function ready(){
  if(video.error||video.readyState===0)nativeReady=undefined;
  if(!nativeReady){
   video.preload='metadata';video.src=url.href;
   video.load();
   nativeReady=waitForVideo(video,{signal:nativeEvents.signal}).catch(error=>{nativeReady=undefined;throw error});
  }
  return nativeReady;
 }
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
 return{load,decode,fallback,get mode(){return mode},get stats(){return{...stats,mode,fallbacks,fallbackReason}},
  suspend(){nativeEvents.abort();nativeEvents=new AbortController()},
  destroy(){disposed=true;nativeEvents.abort();pending?.image?.close();pending?.reject(abortError());pending=null;if(decoder?.state!=='closed')decoder?.close();video.pause();video.removeAttribute('src');video.load()}};
}
