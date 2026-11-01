// Decode a short prediction group as soon as its bytes arrive. Native
// video remains the compatibility path; this path never waits for a whole MP4.
export async function createStreamedVideoSource(segments,metadata,{fetcher=fetch,Decoder=globalThis.VideoDecoder,Chunk=globalThis.EncodedVideoChunk,width=1920,height=1080}={}){
  if(!metadata||typeof Decoder!=='function'||typeof Chunk!=='function')return null;
  const config={codec:metadata.codec,description:Uint8Array.from(metadata.description.match(/../g),hex=>parseInt(hex,16)),codedWidth:width,codedHeight:height,
    colorSpace:{primaries:'bt709',transfer:'bt709',matrix:'bt709',fullRange:false},optimizeForLatency:true};
  try{if(!(await Decoder.isConfigSupported(config)).supported)return null}catch{return null}
  const interval=metadata.keyframeInterval??4;
  const entries=new Map(),frames=new Map();let disposed=false,failure,activePart=0,lastIndex=0,direction=1,prefetchKey='',cacheWrites=Promise.resolve();
  const storage=globalThis.caches?caches.open('sofacet-entrance-sections-v1').catch(()=>null):Promise.resolve(null);
  const decoder=new Decoder({output:frame=>{
    if(disposed||failure){frame.close();return}
    if(frame.displayWidth!==width||frame.displayHeight!==height){frame.close();failure=Error('Unexpected decoded video dimensions');return}
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
  const available=(entry,start,end)=>entry.ranges.some(range=>range[0]<=start&&range[1]>=end);
  function notify(entry,error){
    if(error)entry.error=error;
    for(const waiter of entry.waiters)if(entry.error||available(entry,waiter.start,waiter.end)){
      entry.waiters.delete(waiter);entry.error?waiter.reject(entry.error):waiter.resolve();
    }
  }
  function received(entry,start,end){
    const ranges=[...entry.ranges,[start,end]].sort((a,b)=>a[0]-b[0]);entry.ranges=[];
    for(const range of ranges){
      const last=entry.ranges.at(-1);
      if(last&&range[0]<=last[1])last[1]=Math.max(last[1],range[1]);else entry.ranges.push(range);
    }
    notify(entry);
  }
  function release(entry){
    notify(entry,new DOMException('Video download cancelled','AbortError'));
    pause(entry);
  }
  function pause(entry){
    for(const job of entry.jobs){job.cancelled=true;job.controller.abort();clearTimeout(job.timer)}
    entry.jobs.clear();
  }
  function download(entry,segment,start,end){
    const job={start,end,controller:new AbortController()};entry.jobs.add(job);
    // A progressing connection may need longer than 20 seconds. Only a stalled
    // read times out; speculative downloads must not disable the streamed path.
    const arm=()=>{clearTimeout(job.timer);job.timer=setTimeout(()=>job.controller.abort(new DOMException('Video download stalled','TimeoutError')),20000)};
    arm();
    job.done=(async()=>{
      const cache=await storage;
      if(disposed||job.controller.signal.aborted)throw new DOMException('Video download cancelled','AbortError');
      let response=await cache?.match(segment.url).catch(()=>null),cached=!!response;
      if(!response)response=await fetcher(segment.url,{signal:job.controller.signal,...(start>0||end<segment.bytes?{headers:{Range:`bytes=${start}-${end-1}`}}:{})});
      if(!response.ok||!response.body)throw Error('Video section unavailable');
      let position=0,limit=segment.bytes;
      if(response.status===206){
        if(response.headers.get('Content-Range')!==`bytes ${start}-${end-1}/${segment.bytes}`)throw Error('Invalid video byte range');
        position=start;limit=end;
      }
      const reader=response.body.getReader();
      try{
        for(;;){
          const {done,value}=await reader.read();if(done)break;
          if(disposed||job.controller.signal.aborted)throw new DOMException('Video download cancelled','AbortError');
          if(position+value.length>limit)throw Error('Oversized video section');
          entry.bytes.set(value,position);received(entry,position,position+value.length);position+=value.length;arm();
        }
        if(position!==limit)throw Error('Incomplete video section');
        if(!cached&&!entry.saved&&available(entry,0,segment.bytes)){entry.saved=true;save(segment,entry.bytes)}
      }catch(error){await reader.cancel().catch(()=>{});throw error}finally{reader.releaseLock()}
    })().catch(error=>{if(!job.cancelled)notify(entry,error)}).finally(()=>{clearTimeout(job.timer);entry.jobs.delete(job)});
    return job.done;
  }
  function ensure(part,start=0,limit=segments[part].bytes){
    const segment=segments[part];let entry=entries.get(part);
    if(!entry){
      entry={bytes:new Uint8Array(segment.bytes),ranges:[],jobs:new Set(),waiters:new Set()};entries.set(part,entry);
    }
    // A jump starts at its nearest keyframe. Do not fetch megabytes of skipped
    // pictures before the visible frame. The skipped prefix is fetched only if
    // the visitor reverses into it; a server ignoring Range still works.
    const reserved=[...entry.ranges,...Array.from(entry.jobs,job=>[job.start,job.end])].sort((a,b)=>a[0]-b[0]);
    for(const range of reserved)if(range[0]<=start&&range[1]>start)start=range[1];
    if(start<limit&&!Array.from(entry.jobs).some(job=>job.start<=start&&job.end>=limit)){
      const tail=entry.ranges.find(range=>range[0]>start);
      const running=Array.from(entry.jobs).find(job=>job.start>start);
      const end=Math.min(limit,tail?.[0]??segment.bytes,running?.start??segment.bytes);
      if(end>start&&!Array.from(entry.jobs).some(job=>job.start<=start&&job.end>=end))entry.done=download(entry,segment,start,end);
    }
    return entry;
  }
  async function frameAt(index){
    if(disposed)throw new DOMException('Video decoder disposed','AbortError');if(failure)throw failure;
    const frame=334+index,part=segments.findIndex(s=>frame>=s.firstFrame&&frame<=s.lastFrame);
    if(part<0)throw Error('Frame outside video sections');
    direction=index<lastIndex?-1:1;lastIndex=index;activePart=part;
    for(const [key,entry] of entries){
      if(Math.abs(key-part)>2){entries.delete(key);release(entry)}
      else if((key-part)*direction<0)pause(entry);
    }
    const segment=segments[part],local=frame-segment.firstFrame,first=local-local%interval,last=Math.min(segment.frameCount,first+interval);
    const start=segment.frames[first][0],entry=ensure(part,first===0?0:start);
    const [offset,size]=segment.frames[last-1],end=offset+size;
    if(entry.error)throw entry.error;
    if(!available(entry,start,end))await new Promise((resolve,reject)=>entry.waiters.add({start,end,resolve,reject}));
    if(disposed)throw new DOMException('Video decoder disposed','AbortError');
    const key=part+':'+direction;
    if(prefetchKey!==key){
      prefetchKey=key;const next=part+direction,further=part+2*direction;
      // Fetch just the next boundary's prediction group early, covering request
      // latency without letting a whole speculative movie starve visible frames.
      if(segments[next]){
        const neighbour=segments[next],first=direction>0?0:Math.floor((neighbour.frameCount-1)/interval)*interval;
        const last=Math.min(neighbour.frameCount,first+interval),[offset,size]=neighbour.frames[last-1];
        ensure(next,first===0?0:neighbour.frames[first][0],offset+size);
      }
      void entry.done?.then(()=>{
        if(disposed||entry.error||prefetchKey!==key||activePart!==part)return;
        const ahead=segments[next]?ensure(next):null;
        void ahead?.done?.then(()=>{if(!disposed&&!ahead.error&&prefetchKey===key&&activePart===part&&segments[further])ensure(further)});
      });
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
