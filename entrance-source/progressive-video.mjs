// Retain compressed ranges, not decoded pictures. Startup waits only for an
// explicit warm window; subsequent seeks can fetch before the variant is full.
export function createProgressiveVideo(files,{warm=[],fetcher=fetch,onProgress=()=>{},cacheStorage=globalThis.caches,
  maxBytes=64*1024*1024,diskBytes=256*1024*1024,concurrency=2,stallMs=20000}={}){
  const catalog=new Map(files.map(file=>[file.url,file])),entries=new Map(),jobs=new Map(),diskEntries=new Map();
  const total=files.reduce((sum,file)=>sum+file.bytes,0);
  if(!files.length||catalog.size!==files.length||files.some(file=>!file.url||!Number.isSafeInteger(file.bytes)||file.bytes<1)||
    !Number.isSafeInteger(maxBytes)||maxBytes<1||!Number.isSafeInteger(diskBytes)||diskBytes<0||!Number.isSafeInteger(concurrency)||concurrency<1)throw Error('Invalid progressive video budget');
  const ranges=warm.map(item=>range(item.url,item.start??0,item.end??catalog.get(item.url)?.bytes-1));
  const startupBytes=ranges.reduce((sum,item)=>sum+item.end-item.start+1,0);
  if(!ranges.length||startupBytes>maxBytes)throw Error('Invalid video startup window');
  const fullWarm=new Set(ranges.filter(item=>item.start===0&&item.end===catalog.get(item.url).bytes-1).map(item=>item.url));
  const warmFullBytes=[...fullWarm].reduce((sum,url)=>sum+catalog.get(url).bytes,0);
  const largestFile=Math.max(...files.filter(file=>!fullWarm.has(file.url)&&file.bytes<=maxBytes).map(file=>file.bytes),0);
  // One asynchronous disk write may retain its Blob. Reserve enough room for a
  // visible full section and pinned opening even if that disk write never ends.
  const writeAllowance=Math.max(0,maxBytes-warmFullBytes-largestFile);
  const storage=cacheStorage?.open('sofacet-entrance-preloaded-v1').catch(()=>null)??Promise.resolve(null);
  let disposed=false,ready=false,loading,clock=0,reservedBytes=0,storedBytes=0,running=0,writing=false;
  const abortError=message=>new DOMException(message,'AbortError');
  function check(signal){if(disposed)throw abortError('Video buffer disposed');signal?.throwIfAborted();}
  function range(url,start,end){
    const file=catalog.get(url);
    if(!file||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>end||end>=file.bytes)throw Error('Invalid video byte range');
    return {url,start,end};
  }
  const keyOf=({url,start,end})=>`${url}\n${start}-${end}`;
  const forget=job=>{if(jobs.get(job.key)===job)jobs.delete(job.key)};
  function cacheKey({url,start,end}){
    if(start===0&&end===catalog.get(url).bytes-1)return url;
    const key=new URL(url,globalThis.location?.href);key.searchParams.set('__sofacet_range',`${start}-${end}`);return key.href;
  }
  function drop(entry){
    if(entry.objectURL)URL.revokeObjectURL(entry.objectURL);
    entries.delete(entry.key);storedBytes-=entry.blob.size;
  }
  function makeRoom(bytes){
    for(const entry of [...entries.values()].filter(entry=>!entry.pins&&!entry.objectURL).sort((a,b)=>a.used-b.used)){
      if(storedBytes+reservedBytes+bytes<=maxBytes)break;drop(entry);
    }
    return storedBytes+reservedBytes+bytes<=maxBytes;
  }
  function covering(url,start){
    let found;
    for(const entry of entries.values())if(entry.url===url&&entry.start<=start&&entry.end>=start&&(!found||entry.end>found.end))found=entry;
    if(found)found.used=++clock;return found;
  }
  function coveringJob(url,start,end=start){
    return [...jobs.values()].filter(job=>!job.error&&job.url===url&&job.start<=start&&job.end>=end)
      .sort((a,b)=>Number(b.running)-Number(a.running)||a.start-b.start||b.end-a.end)[0];
  }
  function notify(job){for(const wake of job.waiters)wake();job.waiters.clear();}
  async function quickCache(item){
    let timer;
    try{return await Promise.race([
      (async()=>{const cache=await storage;if(!cache)return null;
        const read=async(key,start,end)=>{
          const response=await cache.match(key).catch(()=>null);if(!response)return null;
          const blob=await response.blob().catch(()=>null);
          if(!blob||blob.size!==end-start+1){void cache.delete(key).catch(()=>{});diskEntries.delete(key);return null;}
          return {response:new Response(blob),cache,key,start,end};
        };
        return await read(item.url,0,catalog.get(item.url).bytes-1)??await read(cacheKey(item),item.start,item.end);
      })(),
      new Promise(resolve=>{timer=setTimeout(()=>resolve(null),100)}),
    ])}finally{clearTimeout(timer)}
  }
  async function trimDisk(cache){
    const keys=await cache.keys(),retained=[];
    // A verified complete file replaces every cached range for that exact URL.
    // Remove overlaps before applying the byte budget, otherwise duplicate GOP
    // ranges can evict a different complete section needed for a later seek.
    const complete=new Set([...diskEntries.values()].filter(item=>item.start===0&&item.end===catalog.get(item.url)?.bytes-1)
      .map(item=>new URL(item.url,globalThis.location?.href).href));
    for(const key of keys){
      if(disposed)return;
      const url=new URL(key.url??key,globalThis.location?.href),partial=url.searchParams.has('__sofacet_range');
      url.searchParams.delete('__sofacet_range');
      if(partial&&complete.has(url.href)){await cache.delete(key);diskEntries.delete(key.url??key);}
      else retained.push(key);
    }
    const records=await Promise.all(retained.map(async key=>({key,size:Number((await cache.match(key))?.headers.get('Content-Length'))||0})));
    const current=new Set(files.map(file=>new URL(file.url,globalThis.location?.href).href));
    const currentKey=key=>{const url=new URL(key.url??key,globalThis.location?.href);url.searchParams.delete('__sofacet_range');return current.has(url.href)};
    records.sort((a,b)=>Number(currentKey(a.key))-Number(currentKey(b.key)));
    let bytes=records.reduce((sum,item)=>sum+item.size,0);
    for(const item of records){if(bytes<=diskBytes||disposed)break;await cache.delete(item.key);diskEntries.delete(item.key.url??item.key);bytes-=item.size;}
  }
  function save(entry){entry.needsWrite=true;writeNext();}
  function writeNext(){
    if(writing||disposed||!diskBytes)return;
    const entry=[...entries.values()].find(entry=>entry.needsWrite&&(entry.blob.size<=writeAllowance||fullWarm.has(entry.url)&&entry.start===0&&entry.end===catalog.get(entry.url).bytes-1));
    if(!entry)return;entry.needsWrite=false;
    writing=true;entry.pins++;
    void (async()=>{
      const cache=await storage;if(!cache||disposed)return;
      const key=cacheKey(entry);
      await cache.put(key,new Response(entry.blob,{headers:{'Content-Type':'video/mp4','Content-Length':String(entry.blob.size)}}));
      if(disposed)return;diskEntries.set(key,{url:entry.url,start:entry.start,end:entry.end});await trimDisk(cache);
    })().catch(()=>{}).finally(()=>{writing=false;entry.pins--;drain();writeNext();});
  }
  function cancel(job,error=abortError('Video prefetch superseded')){
    if(job.done||job.error)return;
    job.error=error;job.controller.abort(error);notify(job);
    if(!job.running){forget(job);job.done=true;}
  }
  function drain(){
    if(disposed)return;
    const queue=[...jobs.values()].filter(job=>!job.running&&!job.done&&!job.error).sort((a,b)=>a.priority-b.priority||a.order-b.order);
    for(const job of queue){
      if(running>=concurrency){
        if(job.priority===0)for(const other of jobs.values())if(other.running&&!other.error&&[...other.users].every(user=>user.priority>0)){cancel(other);break;}
        break;
      }
      const size=job.end-job.start+1;
      if(!makeRoom(size)){
        const pinned=[...entries.values()].filter(entry=>entry.objectURL).reduce((sum,entry)=>sum+entry.blob.size,0);
        if(pinned+size>maxBytes)cancel(job,Error('Video compressed-memory budget exceeded'));
        continue;
      }
      job.running=true;job.reserved=size;reservedBytes+=size;running++;
      void download(job).finally(()=>{
        running--;reservedBytes-=job.reserved;job.reserved=0;job.running=false;
        if(!job.users.size)forget(job);drain();
      });
    }
  }
  async function download(job){
    let reader,timer,response;
    const signal=job.controller.signal,arm=()=>{clearTimeout(timer);timer=setTimeout(()=>cancel(job,new DOMException('Video download stalled','TimeoutError')),stallMs)};
    try{
      check(signal);arm();const cached=await quickCache(job);check(signal);
      const file=catalog.get(job.url),partial=job.start!==0||job.end!==file.bytes-1;
      response=cached?.response??await fetcher(job.url,{signal,...partial?{headers:{Range:`bytes=${job.start}-${job.end}`}}:{}});check(signal);
      if(!response.ok||!response.body)throw Error('Video download unavailable');
      let bodyStart=0,bodyEnd=file.bytes-1;
      if(cached){bodyStart=cached.start;bodyEnd=cached.end;}
      else if(response.status===206){
        if(response.headers.get('Content-Range')!==`bytes ${job.start}-${job.end}/${file.bytes}`)throw Error('Invalid video byte range response');
        bodyStart=job.start;bodyEnd=job.end;
      }else if(response.status!==200)throw Error('Invalid video response status');
      let received=0;reader=response.body.getReader();
      const cancelled=()=>{void reader.cancel(signal.reason).catch(()=>{})};signal.addEventListener('abort',cancelled,{once:true});
      try{for(;;){
        check(signal);const {done,value}=await reader.read();check(signal);if(done)break;
        const absolute=bodyStart+received;received+=value.byteLength;
        if(bodyStart+received>bodyEnd+1)throw Error('Oversized video download');
        const from=Math.max(job.start,absolute),to=Math.min(job.end+1,absolute+value.byteLength);
        if(to>from){const chunk=value.slice(from-absolute,to-absolute);job.chunks.push(chunk);job.received+=chunk.byteLength;notify(job);}
        arm();
      }}finally{signal.removeEventListener('abort',cancelled)}
      if(received!==bodyEnd-bodyStart+1||job.received!==job.end-job.start+1)throw Error('Incomplete video download');
      const blob=new Blob(job.chunks,{type:'video/mp4'});
      const entry={url:job.url,start:job.start,end:job.end,key:job.key,blob,used:++clock,pins:job.users.size};
      job.entry=entry;entries.set(entry.key,entry);storedBytes+=blob.size;
      reservedBytes-=job.reserved;job.reserved=0;
      if(cached)diskEntries.set(cached.key,{url:job.url,start:cached.start,end:cached.end});else save(entry);
      job.done=true;notify(job);
    }catch(error){job.error=job.error??error;job.done=true;notify(job);}
    finally{clearTimeout(timer);if(reader){await reader.cancel().catch(()=>{});reader.releaseLock();}else await response?.body?.cancel().catch(()=>{});}
  }
  function acquire(item,signal,priority){
    check(signal);const key=keyOf(item);let job=jobs.get(key);
    if(!job||job.error)job=coveringJob(item.url,item.start,item.end);
    if(!job||job.error){
      job={...item,key,order:++clock,priority,running:false,done:false,reserved:0,received:0,chunks:[],users:new Set(),waiters:new Set(),controller:new AbortController()};jobs.set(key,job);
    }
    job.priority=Math.min(job.priority,priority);
    const user={priority,originalPriority:priority};job.users.add(user);if(job.entry)job.entry.pins++;
    const aborted=()=>{notify(job);if([...job.users].every(item=>item===user))cancel(job,signal.reason)};
    signal.addEventListener('abort',aborted,{once:true});
    if(!priority&&running>=concurrency)for(const other of jobs.values())if(other!==job&&other.running&&[...other.users].every(user=>user.priority>0)){cancel(other);break;}
    drain();
    return {job,release(){signal.removeEventListener('abort',aborted);job.users.delete(user);job.priority=Math.min(...[...job.users].map(user=>user.priority));if(job.entry)job.entry.pins--;if(!job.users.size){if(!job.done)cancel(job);else{forget(job);job.chunks=[];}}drain();}};
  }
  async function* readRange(item,signal,priority){
    let position=item.start;
    while(position<=item.end){
      check(signal);const entry=covering(item.url,position);
      if(entry){
        entry.pins++;const end=Math.min(item.end,entry.end),reader=entry.blob.slice(position-entry.start,end-entry.start+1).stream().getReader();
        try{for(;;){check(signal);const {done,value}=await reader.read();if(done)break;yield value;}}
        finally{await reader.cancel().catch(()=>{});reader.releaseLock();entry.pins--;drain();}
        position=end+1;continue;
      }
      const pending=coveringJob(item.url,position);
      const following=[...entries.values(),...[...jobs.values()].filter(job=>!job.error)].filter(entry=>entry.url===item.url&&entry.start>position).map(entry=>entry.start);
      const end=Math.min(item.end,pending?.end??item.end,...following.map(start=>start-1));
      if(end-position+1>maxBytes)throw Error('Video range exceeds compressed-memory budget');
      const {job,release}=acquire({url:item.url,start:position,end},signal,priority);let next=0,offset=job.start,through=position;
      try{for(;;){
        check(signal);if(job.error)throw job.error;
        while(next<job.chunks.length){
          check(signal);const chunk=job.chunks[next++],start=Math.max(position,offset),stop=Math.min(end+1,offset+chunk.byteLength);
          if(stop>start){through=stop;yield chunk.subarray(start-offset,stop-offset);}
          offset+=chunk.byteLength;
          // A visible subrange need not wait for a longer background response's
          // tail. Other consumers keep that shared download alive and pinned.
          if(through>end&&end<job.end)break;
        }
        if(job.error)throw job.error;
        if(through>end&&end<job.end)break;
        if(job.done)break;
        await new Promise(resolve=>job.waiters.add(resolve));
      }}finally{release();}
      position=end+1;
    }
  }
  function response(url,options={},priority=0){
    check(options.signal);const file=catalog.get(url);if(!file)throw Error('Unknown video file');
    const header=new Headers(options.headers).get('Range');
    const match=header&&/^bytes=(\d+)-(\d+)$/.exec(header);
    if(header&&!match)throw Error('Invalid video byte range');
    const item=range(url,match?Number(match[1]):0,match?Number(match[2]):file.bytes-1);
    const controller=new AbortController(),signal=controller.signal,aborted=()=>controller.abort(options.signal.reason);
    options.signal?.addEventListener('abort',aborted,{once:true});
    const iterator=readRange(item,signal,priority),clean=()=>options.signal?.removeEventListener('abort',aborted);
    const body=new ReadableStream({
      async pull(stream){try{const {done,value}=await iterator.next();if(done){clean();stream.close();}else stream.enqueue(value);}catch(error){clean();stream.error(error);}},
      cancel(reason){clean();controller.abort(reason??abortError('Video response cancelled'));void iterator.return().catch(()=>{});},
    });
    return new Response(body,{status:match?206:200,headers:{'Content-Type':'video/mp4','Content-Length':String(item.end-item.start+1),...match?{'Content-Range':`bytes ${item.start}-${item.end}/${file.bytes}`}:{}}});
  }
  function isBuffered(url,start=0,end=catalog.get(url)?.bytes-1){
    const requested=range(url,start,end),ranges=[...entries.values(),...diskEntries.values()].filter(item=>item.url===url).sort((a,b)=>a.start-b.start);
    let through=requested.start;
    for(const item of ranges){if(item.start>through)break;if(item.end>=through)through=item.end+1;}
    return through>requested.end;
  }
  function coverage(){
    let bufferedBytes=0,bufferedFiles=0;const missing=[];
    for(const file of files){
      const ranges=[...entries.values(),...diskEntries.values()].filter(item=>item.url===file.url).sort((a,b)=>a.start-b.start);
      let through=0,bytes=0;
      for(const item of ranges){through=Math.max(through,item.start);if(item.end>=through){bytes+=item.end-through+1;through=item.end+1;}}
      bufferedBytes+=bytes;
      if(bytes===file.bytes)bufferedFiles++;else missing.push({url:file.url,bytes:file.bytes,bufferedBytes:bytes});
    }
    return {bufferedBytes,totalBytes:total,bufferedFiles,totalFiles:files.length,missing};
  }
  return {
    load(){return loading??=(async()=>{
      const controller=new AbortController();let loaded=0;onProgress(0,startupBytes);
      try{await Promise.all(ranges.map(async item=>{
        const reader=response(item.url,{signal:controller.signal,headers:{Range:`bytes=${item.start}-${item.end}`}}).body.getReader();
        try{for(;;){const {done,value}=await reader.read();if(done)break;loaded+=value.byteLength;onProgress(loaded,startupBytes);}}
        finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
      }));check();ready=true;}catch(error){controller.abort(error);throw error;}
    })()},
    async fetch(url,options={}){return response(url,options,options.priority==='low'?1:0)},
    async prefetch(url,options={}){const reader=response(url,options,1).body.getReader();try{while(!(await reader.read()).done){}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}},
    startBackground(requests=[]){return Promise.allSettled(requests.map(item=>this.prefetch(item.url,{headers:{Range:`bytes=${item.start??0}-${item.end??catalog.get(item.url)?.bytes-1}`}})));},
    prioritize(url){
      // Cached section changes need no network slot. Preserve useful fill work;
      // acquire/drain preempt demoted jobs only for an actual visible miss.
      for(const job of jobs.values()){
        if(job.url===url){job.priority=0;for(const user of job.users)user.priority=0;}
        else{
          for(const user of job.users)user.priority=user.originalPriority;
          job.priority=Math.min(...[...job.users].map(user=>user.priority));
        }
      }
      drain();
    },
    isBuffered,
    url(url){check();const entry=covering(url,0);if(!entry||entry.end!==catalog.get(url)?.bytes-1)throw Error('Video file is not ready');return entry.objectURL??=URL.createObjectURL(entry.blob)},
    get ready(){return ready},get complete(){return files.every(file=>isBuffered(file.url))},get coverage(){return coverage()},get bytes(){return total},get startupBytes(){return startupBytes},
    get residentBytes(){return storedBytes+[...jobs.values()].filter(job=>!job.entry).reduce((sum,job)=>sum+job.received,0)},
    get budgetBytes(){return maxBytes},
    dispose(){if(disposed)return;disposed=true;ready=false;for(const job of jobs.values())cancel(job,abortError('Video buffer disposed'));for(const entry of [...entries.values()])drop(entry);diskEntries.clear();},
  };
}
