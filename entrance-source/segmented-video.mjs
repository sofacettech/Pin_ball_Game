// Keep only the current two-second movie and two neighbours in each direction. Blob
// URLs prevent WebKit from making a fresh network range request on each reverse
// seek, while bounding compressed media memory instead of buffering the movie.
export function createSegmentedVideoSource(segments,{fetcher=fetch}={}){
  const entries=new Map();let disposed=false,lastIndex=0,cacheWrites=Promise.resolve();
  const storage=globalThis.caches?caches.open('sofacet-entrance-sections-v1').catch(()=>null):Promise.resolve(null);
  function save(segment,blob){
    cacheWrites=cacheWrites.then(async()=>{
      const cache=await storage;if(!cache||disposed)return;
      await cache.put(segment.url,new Response(blob,{headers:{'Content-Type':'video/mp4','Content-Length':String(blob.size)}}));
      const keys=await cache.keys(),sizes=await Promise.all(keys.map(async key=>Number((await cache.match(key))?.headers.get('Content-Length'))||0));
      let total=sizes.reduce((a,b)=>a+b,0);
      for(let i=0;total>128*1024*1024&&i<keys.length;i++){await cache.delete(keys[i]);total-=sizes[i]}
    }).catch(()=>{});
  }
  function releaseVideo(entry){
    if(entry.video){entry.video.pause();entry.video.removeAttribute('src');entry.video.load();entry.video=null;}
  }
  function release(entry){
    entry.controller.abort();clearTimeout(entry.timer);
    releaseVideo(entry);
    if(entry.url)URL.revokeObjectURL(entry.url);
  }
  function ensure(index){
    if(entries.has(index))return entries.get(index).ready;
    const segment=segments[index],entry={controller:new AbortController()};entries.set(index,entry);
    entry.timer=setTimeout(()=>entry.controller.abort(new DOMException('Video section timed out','TimeoutError')),20000);
    entry.ready=(async()=>{
      const cache=await storage;
      if(disposed||entry.controller.signal.aborted)throw new DOMException('Video section cancelled','AbortError');
      let response=await cache?.match(segment.url).catch(()=>null),cached=!!response;
      if(!response)response=await fetcher(segment.url,{signal:entry.controller.signal});
      if(!response.ok)throw Error('Video section unavailable');
      const blob=await response.blob();
      if(blob.size!==segment.bytes)throw Error('Incomplete video section');
      if(disposed||entry.controller.signal.aborted)throw new DOMException('Video section cancelled','AbortError');
      entry.url=URL.createObjectURL(new Blob([blob],{type:'video/mp4'}));
      if(!cached)save(segment,blob);
      clearTimeout(entry.timer);return entry;
    })().catch(error=>{if(entries.get(index)===entry)entries.delete(index);release(entry);throw error});
    return entry.ready;
  }
  async function prepare(entry,segment){
    if(disposed||entry.controller.signal.aborted)throw new DOMException('Video section cancelled','AbortError');
    if(entry.video)return entry.video;
    const video=entry.video=document.createElement('video');
    video.muted=true;video.playsInline=true;video.preload='auto';video.setAttribute('webkit-playsinline','');
    entry.timer=setTimeout(()=>entry.controller.abort(new DOMException('Video section decode timed out','TimeoutError')),15000);
    await new Promise((resolve,reject)=>{
      const signal=entry.controller.signal;
      const clean=()=>{video.removeEventListener('loadeddata',loaded);video.removeEventListener('error',failed);signal.removeEventListener('abort',aborted)};
      const loaded=()=>{clean();resolve()},failed=()=>{clean();reject(Error('Video section failed'))},aborted=()=>{clean();reject(signal.reason)};
      video.addEventListener('loadeddata',loaded,{once:true});video.addEventListener('error',failed,{once:true});signal.addEventListener('abort',aborted,{once:true});
      video.src=entry.url;video.load();
    });
    if(video.videoWidth!==1920||video.videoHeight!==1080||Math.abs(video.duration-segment.frameCount/60)>.02)throw Error('Video section timeline mismatch');
    clearTimeout(entry.timer);return video;
  }
  async function frameAt(index){
    if(disposed)throw new DOMException('Video sections disposed','AbortError');
    const frame=334+index,part=segments.findIndex(s=>frame>=s.firstFrame&&frame<=s.lastFrame);
    const direction=index<lastIndex?-1:1;lastIndex=index;
    if(part<0)throw Error('Frame outside video sections');
    // The renderer serializes requests, so no evicted entry is still being drawn.
    for(const [key,entry] of entries){
      if(Math.abs(key-part)>2){entries.delete(key);release(entry)}
      else if(key!==part)releaseVideo(entry);
    }
    const entry=await ensure(part);
    // Fetch ahead in the direction of travel. Downloading four distant movies
    // simultaneously starves the next visible section on a cold connection.
    for(const neighbour of [part+direction,part+2*direction])if(segments[neighbour])void ensure(neighbour).catch(()=>{});
    const video=await prepare(entry,segments[part]);
    const time=(frame-segments[part].firstFrame+.25)/60;
    if(video.seeking||Math.abs(video.currentTime-time)>=.25/60){
      await new Promise((resolve,reject)=>{
        const signal=entry.controller.signal;
        const clean=()=>{clearTimeout(timer);video.removeEventListener('seeked',done);video.removeEventListener('error',failed);signal.removeEventListener('abort',aborted)};
        const done=()=>{clean();resolve()},failed=()=>{clean();reject(Error('Video section seek failed'))},aborted=()=>{clean();reject(signal.reason)};
        const timer=setTimeout(()=>{clean();reject(Error('Video section seek timed out'))},15000);
        video.addEventListener('seeked',done,{once:true});video.addEventListener('error',failed,{once:true});signal.addEventListener('abort',aborted,{once:true});
        if(signal.aborted){aborted();return}
        try{video.currentTime=time}catch(error){clean();reject(error)}
      });
    }
    return video;
  }
  return {frameAt,dispose(){if(disposed)return;disposed=true;for(const entry of entries.values())release(entry);entries.clear()}};
}
