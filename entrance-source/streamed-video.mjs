// Decode each four-frame prediction group as soon as its bytes arrive. Native
// video remains the compatibility path; this path never waits for a whole MP4.
export async function createStreamedVideoSource(segments,metadata,{fetcher=fetch,Decoder=globalThis.VideoDecoder,Chunk=globalThis.EncodedVideoChunk}={}){
  if(!metadata||typeof Decoder!=='function'||typeof Chunk!=='function')return null;
  const config={codec:metadata.codec,description:Uint8Array.from(metadata.description.match(/../g),hex=>parseInt(hex,16)),codedWidth:1920,codedHeight:1080,
    colorSpace:{primaries:'bt709',transfer:'bt709',matrix:'bt709',fullRange:false},optimizeForLatency:true};
  try{if(!(await Decoder.isConfigSupported(config)).supported)return null}catch{return null}
  const entries=new Map(),frames=new Map();let disposed=false,failure,activePart=0,lastIndex=0,direction=1,prefetchKey='',cacheWrites=Promise.resolve();
  const storage=globalThis.caches?caches.open('sofacet-entrance-sections-v1').catch(()=>null):Promise.resolve(null);
  const decoder=new Decoder({output:frame=>{
    if(disposed||failure){frame.close();return}
    if(frame.displayWidth!==1920||frame.displayHeight!==1080){frame.close();failure=Error('Unexpected decoded video dimensions');return}
    frames.set(Math.round(frame.timestamp*60/1e6),frame);
  },error:error=>{failure=error}});
  try{decoder.configure(config)}catch{decoder.close();return null}
  function save(segment,bytes){
    cacheWrites=cacheWrites.then(async()=>{
      const cache=await storage;if(!cache||disposed)return;
      await cache.put(segment.url,new Response(bytes,{headers:{'Content-Type':'video/mp4','Content-Length':String(bytes.length)}}));
      const keys=await cache.keys(),sizes=await Promise.all(keys.map(async key=>Number((await cache.match(key))?.headers.get('Content-Length'))||0));
      let total=sizes.reduce((a,b)=>a+b,0);
      for(let i=0;total>128*1024*1024&&i<keys.length;i++){await cache.delete(keys[i]);total-=sizes[i]}
    }).catch(()=>{});
  }
  function notify(entry,error){
    if(error)entry.error=error;
    for(const waiter of entry.waiters)if(entry.error||entry.received>=waiter.end){entry.waiters.delete(waiter);entry.error?waiter.reject(entry.error):waiter.resolve()}
  }
  function release(entry){entry.controller.abort();clearTimeout(entry.timer);notify(entry,new DOMException('Video download cancelled','AbortError'))}
  function ensure(part){
    if(entries.has(part))return entries.get(part);
    const segment=segments[part],entry={controller:new AbortController(),bytes:new Uint8Array(segment.bytes),received:0,waiters:new Set()};entries.set(part,entry);
    entry.timer=setTimeout(()=>entry.controller.abort(new DOMException('Video section timed out','TimeoutError')),20000);
    entry.done=(async()=>{
      const cache=await storage;
      if(disposed||entry.controller.signal.aborted)throw new DOMException('Video download cancelled','AbortError');
      let response=await cache?.match(segment.url).catch(()=>null),cached=!!response;
      if(!response)response=await fetcher(segment.url,{signal:entry.controller.signal});
      if(!response.ok||!response.body)throw Error('Video section unavailable');
      const reader=response.body.getReader();
      try{
        for(;;){
          const {done,value}=await reader.read();if(done)break;
          if(disposed||entry.controller.signal.aborted)throw new DOMException('Video download cancelled','AbortError');
          if(entry.received+value.length>entry.bytes.length)throw Error('Oversized video section');
          entry.bytes.set(value,entry.received);entry.received+=value.length;notify(entry);
        }
        if(entry.received!==entry.bytes.length)throw Error('Incomplete video section');
        if(!cached)save(segment,entry.bytes);
      }catch(error){await reader.cancel().catch(()=>{});throw error}finally{reader.releaseLock()}
    })().catch(error=>{notify(entry,error)}).finally(()=>clearTimeout(entry.timer));
    return entry;
  }
  async function frameAt(index){
    if(disposed)throw new DOMException('Video decoder disposed','AbortError');if(failure)throw failure;
    const frame=334+index,part=segments.findIndex(s=>frame>=s.firstFrame&&frame<=s.lastFrame);
    if(part<0)throw Error('Frame outside video sections');
    direction=index<lastIndex?-1:1;lastIndex=index;activePart=part;
    for(const [key,entry] of entries)if(Math.abs(key-part)>2){entries.delete(key);release(entry)}
    const segment=segments[part],entry=ensure(part),local=frame-segment.firstFrame,first=local-local%4,last=Math.min(segment.frameCount,first+4);
    const [offset,size]=segment.frames[last-1],end=offset+size;
    if(entry.error)throw entry.error;
    if(entry.received<end)await new Promise((resolve,reject)=>entry.waiters.add({end,resolve,reject}));
    if(disposed)throw new DOMException('Video decoder disposed','AbortError');
    const key=part+':'+direction;
    if(prefetchKey!==key){
      prefetchKey=key;const next=part+direction,further=part+2*direction;
      if(segments[next])ensure(next);
      // Keep the visible download ahead of speculative work on cold networks.
      void entry.done.then(()=>{if(!disposed&&!entry.error&&prefetchKey===key&&segments[further]&&Math.abs(further-activePart)<=2)ensure(further)});
    }
    if(frames.has(index))return frames.get(index);
    for(const frame of frames.values())frame.close();frames.clear();
    for(let i=first;i<last;i++){
      const [start,length,sync]=segment.frames[i],sourceIndex=segment.firstFrame-334+i;
      decoder.decode(new Chunk({type:sync?'key':'delta',timestamp:Math.round(sourceIndex*1e6/60),duration:Math.round(1e6/60),data:entry.bytes.subarray(start,start+length)}));
    }
    let timer;
    try{await Promise.race([decoder.flush(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Video decoding timed out')),5000)})])}finally{clearTimeout(timer)}
    if(failure)throw failure;
    if(!frames.has(index))throw Error('The requested video frame was not decoded');
    return frames.get(index);
  }
  return {engine:'webcodecs',frameAt,dispose(){
    if(disposed)return;disposed=true;
    for(const entry of entries.values())release(entry);entries.clear();
    if(decoder.state!=='closed')decoder.close();for(const frame of frames.values())frame.close();frames.clear();
  }};
}
