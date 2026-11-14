// Decode a short prediction group as soon as its bytes arrive. Native
// video remains the compatibility path; this path never waits for a whole MP4.
export async function createStreamedVideoSource(segments,metadata,{fetcher=fetch,cacheStorage=globalThis.caches,Decoder=globalThis.VideoDecoder,Chunk=globalThis.EncodedVideoChunk,width=1920,height=1080,diagnostics=false,clock=()=>performance.now()}={}){
  if(!metadata||typeof Decoder!=='function'||typeof Chunk!=='function')return null;
  const config={codec:metadata.codec,description:Uint8Array.from(metadata.description.match(/../g),hex=>parseInt(hex,16)),codedWidth:width,codedHeight:height,
    colorSpace:{primaries:'bt709',transfer:'bt709',matrix:'bt709',fullRange:false},optimizeForLatency:true};
  try{if(!(await Decoder.isConfigSupported(config)).supported)return null}catch{return null}
  const interval=metadata.keyframeInterval??4;
  // Small windows let forward playback paint before a whole group drains.
  // Preserve the existing pixel budget so 4K retains at most three pictures.
  // Prediction frames before the requested window are closed immediately.
  const maxFrames=Math.max(1,Math.min(interval,4,Math.floor(1920*1080*12/(width*height))));
  // Full 4K prediction prefixes can legitimately take longer than 50 ms on a
  // phone. Give active hardware decoding room before probing a forced drain.
  const lowDelayDeadline=width*height>1920*1080?100:50;
  let keepFirst=0,keepLast=Infinity,decodeCursor=null,decodeWaiter=null,flushRequired=false;
  let compatibilityGroup=null,lowDelayReprobed=false;
  const metrics=diagnostics?{requests:0,cacheHits:0,chunks:0,outputFrames:0,discardedFrames:0,flushes:0,compatibilityFlushes:0,lowDelayReprobes:0,networkWaitMs:[],decodeWaitMs:[]}:null;
  function recordTiming(name,start){
    if(!metrics)return;
    const samples=metrics[name];samples.push(Math.max(0,clock()-start));if(samples.length>64)samples.shift();
  }
  function timingSummary(samples){
    const sorted=[...samples].sort((a,b)=>a-b);
    return {samples:sorted.length,meanMs:sorted.length?sorted.reduce((a,b)=>a+b,0)/sorted.length:null,
      p95Ms:sorted.length?sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))]:null,maxMs:sorted.at(-1)??null};
  }
  const entries=new Map(),frames=new Map();let disposed=false,failure,activePart=0,lastIndex=0,direction=1,prefetchKey='',cacheWrites=Promise.resolve(),networkWaiter=null;
  const storage=cacheStorage?cacheStorage.open('sofacet-entrance-sections-v1').catch(()=>null):Promise.resolve(null);
  const decoder=new Decoder({output:frame=>{
    if(metrics)metrics.outputFrames++;
    if(disposed||failure){frame.close();return}
    if(frame.displayWidth!==width||frame.displayHeight!==height){frame.close();failure=Error('Unexpected decoded video dimensions');finishDecode(failure);return}
    const index=Math.round(frame.timestamp*60/1e6);
    if(index<keepFirst||index>=keepLast){if(metrics)metrics.discardedFrames++;frame.close();return}
    // A reversal can decode a timestamp whose previous output is still queued.
    frames.get(index)?.close();
    frames.set(index,frame);
    finishDecode();
  },error:error=>{failure=error;finishDecode(error)}});
  try{decoder.configure(config)}catch{decoder.close();return null}
  function finishDecode(error){
    const waiter=decodeWaiter;
    // Return as soon as the requested picture exists. A group-end drain may
    // still be running for the later pictures; waiting for it adds ~20 ms to
    // every prediction group on phone hardware decoders.
    if(!waiter||(!error&&!frames.has(waiter.index)))return;
    recordTiming('decodeWaitMs',waiter.startedAt);
    decodeWaiter=null;clearTimeout(waiter.timer);clearTimeout(waiter.flushTimer);
    error?waiter.reject(error):waiter.resolve();
  }
  function flushDecode(compatibility=false,waiter=decodeWaiter){
    if(!waiter)return;
    // A cold decoder or a busy event loop can miss the first low-delay deadline.
    // One independent forward group may retry; a second miss stays compatible
    // for this decoder's lifetime, without recurring deadline probes.
    if(compatibility){flushRequired=true;compatibilityGroup=waiter.group;}
    if(metrics){metrics.flushes++;if(compatibility)metrics.compatibilityFlushes++;}
    decodeCursor=null;waiter.flushing=true;
    // A request that already resolved must not let its late drain settle a newer one.
    decoder.flush().then(()=>{waiter.flushing=false;if(decodeWaiter===waiter)finishDecode(failure||(!frames.has(waiter.index)?Error('The requested video frame was not decoded'):null))},error=>{if(decodeWaiter===waiter)finishDecode(error)});
  }
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
  function cancelPending(){
    const waiter=networkWaiter;
    if(!waiter||!waiter.entry.waiters.delete(waiter))return false;
    // Superseding a seek only cancels its missing-byte wait. Retain received
    // ranges and the decoder's pictures/state for a later reversal or retry.
    pause(waiter.entry);waiter.reject(new DOMException('Video seek superseded','AbortError'));
    return true;
  }
  function download(entry,segment,start,end,priority){
    const job={start,end,priority,controller:new AbortController()};entry.jobs.add(job);
    // A progressing connection may need longer than 20 seconds. Only a stalled
    // read times out; speculative downloads must not disable the streamed path.
    const arm=()=>{clearTimeout(job.timer);job.timer=setTimeout(()=>job.controller.abort(new DOMException('Video download stalled','TimeoutError')),20000)};
    arm();
    job.done=(async()=>{
      const cache=await storage;
      if(disposed||job.controller.signal.aborted)throw new DOMException('Video download cancelled','AbortError');
      let response=await cache?.match(segment.url).catch(()=>null),cached=!!response;
      if(!response)response=await fetcher(segment.url,{signal:job.controller.signal,priority,...(start>0||end<segment.bytes?{headers:{Range:`bytes=${start}-${end-1}`}}:{})});
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
    })().catch(error=>{
      if(job.cancelled)return;
      // A visible jump may preempt another section's low-priority fetch. Keep
      // received bytes reusable; cancellation is not a corrupt-media failure.
      if(priority==='low'&&error?.name==='AbortError'&&!disposed){
        job.cancelled=true;
        for(const waiter of entry.waiters)ensure(entry.part,waiter.start,waiter.end,'high');
      }else notify(entry,error);
    }).finally(()=>{clearTimeout(job.timer);entry.jobs.delete(job)});
    return job.done;
  }
  function ensure(part,start=0,limit=segments[part].bytes,priority='high'){
    const segment=segments[part];let entry=entries.get(part);
    if(!entry){
      entry={part,bytes:new Uint8Array(segment.bytes),ranges:[],jobs:new Set(),waiters:new Set()};entries.set(part,entry);
    }
    // A jump starts at its nearest keyframe. Do not fetch megabytes of skipped
    // pictures before the visible frame. The skipped prefix is fetched only if
    // the visitor reverses into it; a server ignoring Range still works.
    const activeJobs=[...entry.jobs].filter(job=>!job.cancelled);
    const reserved=[...entry.ranges,...activeJobs.map(job=>[job.start,job.end])].sort((a,b)=>a[0]-b[0]);
    for(const range of reserved)if(range[0]<=start&&range[1]>start)start=range[1];
    if(start<limit&&!activeJobs.some(job=>job.start<=start&&job.end>=limit)){
      const tail=entry.ranges.find(range=>range[0]>start);
      const running=activeJobs.find(job=>job.start>start);
      const end=Math.min(limit,tail?.[0]??segment.bytes,running?.start??segment.bytes);
      if(end>start&&!activeJobs.some(job=>job.start<=start&&job.end>=end))entry.done=download(entry,segment,start,end,priority);
    }
    return entry;
  }
  async function frameAt(index){
    if(metrics)metrics.requests++;
    if(disposed)throw new DOMException('Video decoder disposed','AbortError');if(failure)throw failure;
    const frame=334+index,part=segments.findIndex(s=>frame>=s.firstFrame&&frame<=s.lastFrame);
    if(part<0)throw Error('Frame outside video sections');
    direction=index<lastIndex?-1:1;lastIndex=index;activePart=part;
    for(const [key,entry] of entries){
      if(Math.abs(key-part)>2){entries.delete(key);release(entry)}
      else if((key-part)*direction<0)pause(entry);
    }
    const segment=segments[part],local=frame-segment.firstFrame,first=local-local%interval,last=Math.min(segment.frameCount,first+interval);
    const retainFirst=Math.max(first,direction>0?Math.min(local,last-maxFrames):local-maxFrames+1),retainLast=Math.min(last,retainFirst+maxFrames);
    const start=segment.frames[first][0],entry=ensure(part,first===0?0:start);
    const [offset,size]=segment.frames[retainLast-1],end=offset+size;
    if(entry.error)throw entry.error;
    if(!available(entry,start,end)){
      const startedAt=metrics?clock():0,waiter={entry,start,end};
      try{await new Promise((resolve,reject)=>{Object.assign(waiter,{resolve,reject});networkWaiter=waiter;entry.waiters.add(waiter)});}
      finally{if(networkWaiter===waiter)networkWaiter=null;recordTiming('networkWaitMs',startedAt);}
    }
    if(disposed)throw new DOMException('Video decoder disposed','AbortError');
    const key=part+':'+direction;
    if(prefetchKey!==key){
      prefetchKey=key;const next=part+direction,further=part+2*direction;
      // Fetch just the next boundary's prediction group early, covering request
      // latency without letting a whole speculative movie starve visible frames.
      if(segments[next]){
        const neighbour=segments[next],first=direction>0?0:Math.floor((neighbour.frameCount-1)/interval)*interval;
        const last=Math.min(neighbour.frameCount,first+interval),[offset,size]=neighbour.frames[last-1];
        ensure(next,first===0?0:neighbour.frames[first][0],offset+size,'low');
      }
      void entry.done?.then(()=>{
        if(disposed||entry.error||prefetchKey!==key||activePart!==part)return;
        const ahead=segments[next]?ensure(next,0,segments[next].bytes,'low'):null;
        void ahead?.done?.then(()=>{if(!disposed&&!ahead.error&&prefetchKey===key&&activePart===part&&segments[further])ensure(further,0,segments[further].bytes,'low')});
      });
    }
    if(frames.has(index)){if(metrics)metrics.cacheHits++;return frames.get(index);}
    const continuing=direction>0&&decodeCursor?.part===part&&decodeCursor.first===first&&index>=keepFirst;
    const from=continuing?decodeCursor.next:first;
    for(const frame of frames.values())frame.close();frames.clear();
    keepFirst=segment.firstFrame-334+retainFirst;keepLast=segment.firstFrame-334+retainLast;
    // Forward windows share the decoder's prediction state. Flushing every
    // three 4K pictures forces the same keyframe and delta prefix to be decoded
    // repeatedly. A reverse miss or jump starts at its independent keyframe.
    // Hardware decoders can retain two pictures internally even for a low-delay
    // stream. Wait for the requested picture, leaving later submitted pictures
    // queued for the next forward window. Drain at the end of a prediction group
    // or on a reverse miss, where there is no forward input to release its tail.
    const group=part+':'+first;
    if(flushRequired&&!lowDelayReprobed&&group!==compatibilityGroup&&direction>0&&retainLast<last){
      flushRequired=false;lowDelayReprobed=true;if(metrics)metrics.lowDelayReprobes++;
    }
    const mustFlush=flushRequired||direction<0||retainLast===last;
    const decoded=new Promise((resolve,reject)=>{
      decodeWaiter={index,group,resolve,reject,flushing:mustFlush,startedAt:metrics?clock():0,
        timer:setTimeout(()=>finishDecode(Error('Video decoding timed out')),5000)};
      if(!mustFlush)decodeWaiter.flushTimer=setTimeout(()=>flushDecode(true),lowDelayDeadline);
    });
    const request=decodeWaiter;
    decodeCursor={part,first,next:retainLast};
    try{
      for(let i=from;i<retainLast;i++){
        const [start,length,sync]=segment.frames[i],sourceIndex=segment.firstFrame-334+i;
        if(metrics)metrics.chunks++;
        decoder.decode(new Chunk({type:sync?'key':'delta',timestamp:Math.round(sourceIndex*1e6/60),duration:Math.round(1e6/60),data:entry.bytes.subarray(start,start+length)}));
      }
      if(mustFlush)flushDecode(false,request);
    }catch(error){failure=error;decodeCursor=null;finishDecode(error)}
    await decoded;
    if(failure)throw failure;
    if(!frames.has(index))throw Error('The requested video frame was not decoded');
    return frames.get(index);
  }
  return {engine:'webcodecs',frameAt,cancelPending,get metrics(){
    if(!metrics)return null;
    const {networkWaitMs,decodeWaitMs,...counts}=metrics;
    return {...counts,compatibilityProbeDelayMs:lowDelayDeadline,flushRequired,retainedFrames:frames.size,networkWait:timingSummary(networkWaitMs),decodeWait:timingSummary(decodeWaitMs)};
  },dispose(){
    if(disposed)return;disposed=true;
    finishDecode(new DOMException('Video decoder disposed','AbortError'));
    for(const entry of entries.values())release(entry);entries.clear();
    if(decoder.state!=='closed')decoder.close();for(const frame of frames.values())frame.close();frames.clear();
  }};
}
