// Keep compressed media, not thousands of decoded 4K pictures. Every section is
// ready before scrolling starts; decoder eviction can no longer cause a download.
export function createPreloadedVideo(files,{fetcher=fetch,onProgress=()=>{},cacheStorage=globalThis.caches}={}){
  const limit=256*1024*1024,total=files.reduce((sum,file)=>sum+file.bytes,0);
  if(!files.length||files.some(file=>!Number.isSafeInteger(file.bytes)||file.bytes<1)||total>limit)throw Error('Invalid video preload size');
  const entries=new Map(),controller=new AbortController();let loaded=0,ready=false,loading;
  const storage=cacheStorage?.open('sofacet-entrance-preloaded-v1').catch(()=>null)??Promise.resolve(null);
  const abort=()=>{if(controller.signal.aborted)throw controller.signal.reason};
  async function download(file){
    abort();const cache=await storage;abort();
    let response=await cache?.match(file.url).catch(()=>null),cached=!!response,timer;
    const arm=()=>{clearTimeout(timer);timer=setTimeout(()=>controller.abort(new DOMException('Video download stalled','TimeoutError')),20000)};
    arm();
    try{
      if(!response)response=await fetcher(file.url,{signal:controller.signal});
      if(!response.ok||!response.body)throw Error('Video download unavailable');
      const reader=response.body.getReader(),chunks=[];let received=0;
      const cancelled=()=>{void reader.cancel(controller.signal.reason).catch(()=>{})};
      controller.signal.addEventListener('abort',cancelled,{once:true});
      try{for(;;){
        abort();const {done,value}=await reader.read();abort();if(done)break;
        received+=value.byteLength;if(received>file.bytes)throw Error('Oversized video download');
        chunks.push(value);loaded+=value.byteLength;onProgress(loaded,total);arm();
      }}finally{controller.signal.removeEventListener('abort',cancelled);await reader.cancel().catch(()=>{});reader.releaseLock()}
      if(received!==file.bytes)throw Error('Incomplete video download');
      const blob=new Blob(chunks,{type:'video/mp4'});entries.set(file.url,{blob});
      clearTimeout(timer);
      if(cache&&!cached)await cache.put(file.url,new Response(blob,{headers:{'Content-Length':String(blob.size)}})).catch(()=>{});
    }finally{clearTimeout(timer)}
  }
  async function trimCache(){
    const cache=await storage;if(!cache||controller.signal.aborted)return;
    const keys=await cache.keys(),current=new Set(files.map(file=>new URL(file.url,globalThis.location?.href).href));
    // Keep the current variant and evict older variants once the budget is full.
    const old=keys.filter(key=>!current.has(key.url));let bytes=total;
    for(const key of old){const size=Number((await cache.match(key))?.headers.get('Content-Length'))||0;if(bytes+size>limit)await cache.delete(key);else bytes+=size}
  }
  return {
    load(){return loading??=(async()=>{
      onProgress(0,total);let next=0;
      try{await Promise.all(Array.from({length:Math.min(3,files.length)},async()=>{while(next<files.length){abort();await download(files[next++])}}));abort();ready=true;void trimCache().catch(()=>{});}
      catch(error){controller.abort(error);throw error}
    })()},
    async fetch(url,options={}){
      abort();options.signal?.throwIfAborted();const entry=entries.get(url);
      if(!ready||!entry)throw Error('Video was not preloaded');
      const match=/^bytes=(\d+)-(\d+)$/.exec(new Headers(options.headers).get('Range')||'');
      if(!match)return new Response(entry.blob);
      const start=Number(match[1]),end=Number(match[2]);
      if(start>end||end>=entry.blob.size)throw Error('Invalid preloaded byte range');
      return new Response(entry.blob.slice(start,end+1),{status:206,headers:{'Content-Range':`bytes ${start}-${end}/${entry.blob.size}`}});
    },
    url(url){abort();const entry=entries.get(url);if(!ready||!entry)throw Error('Video was not preloaded');return entry.url??=URL.createObjectURL(entry.blob)},
    get ready(){return ready},get bytes(){return total},
    dispose(){controller.abort(new DOMException('Video preload disposed','AbortError'));for(const entry of entries.values())if(entry.url)URL.revokeObjectURL(entry.url);entries.clear();ready=false},
  };
}
