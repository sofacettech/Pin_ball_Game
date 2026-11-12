import test from 'node:test';
import assert from 'node:assert/strict';
import {createProgressiveVideo} from '../entrance-source/progressive-video.mjs';
import {createStreamedVideoSource} from '../entrance-source/streamed-video.mjs';

const files=Array.from({length:4},(_,i)=>({url:`https://media.example/${i}.mp4`,bytes:i?24:8}));
const warm=[{url:files[0].url,start:0,end:7},{url:files[1].url,start:0,end:3}];
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const rangeHeader=(start,end)=>({headers:{Range:`bytes=${start}-${end}`}});
const data=file=>Uint8Array.from({length:file.bytes},(_,i)=>i);
function network(requests=[],catalog=files){return async(url,options={})=>{
  const file=catalog.find(file=>file.url===url),match=/^bytes=(\d+)-(\d+)$/.exec(new Headers(options.headers).get('Range')||'');
  const start=match?Number(match[1]):0,end=match?Number(match[2]):file.bytes-1;
  requests.push({url,start,end,signal:options.signal});
  return new Response(data(file).slice(start,end+1),{status:match?206:200,headers:match?{'Content-Range':`bytes ${start}-${end}/${file.bytes}`}:{}});
};}
async function bytes(buffer,url,options){return [...new Uint8Array(await (await buffer.fetch(url,options)).arrayBuffer())];}

test('startup waits only for the explicit opening and first prediction range, not far media or disk writes',async()=>{
  const requests=[],progress=[];let puts=0;
  const buffer=createProgressiveVideo(files,{warm,cacheStorage:{open:async()=>({match:async()=>null,put:()=>{puts++;return new Promise(()=>{})}})},
    maxBytes:64,fetcher:network(requests),onProgress:(...args)=>progress.push(args)});
  try{
    await buffer.load();assert.equal(buffer.ready,true);assert.equal(buffer.complete,false);
    assert.equal(buffer.bytes,80);assert.equal(buffer.startupBytes,12);assert.deepEqual(progress.at(-1),[12,12]);
    assert.deepEqual(requests.map(({url,start,end})=>[url,start,end]),warm.map(({url,start,end})=>[url,start,end]));
    assert.equal(puts,1,'the unresolved disk write must not gate readiness');
    const url=buffer.url(files[0].url);assert.equal(buffer.url(files[0].url),url);
    assert.equal((await (await fetch(url)).blob()).size,8);
  }finally{buffer.dispose()}
});

test('a cached first GOP streams immediately while the rest of that section is still downloading',async()=>{
  const requests=[],base=network(requests);let finish;
  const buffer=createProgressiveVideo(files,{warm,cacheStorage:null,maxBytes:64,fetcher:async(url,options)=>{
    if(url===files[1].url&&new Headers(options.headers).get('Range')==='bytes=4-23'){
      requests.push({url,start:4,end:23});return new Response(new ReadableStream({start(controller){
        controller.enqueue(Uint8Array.of(4,5));finish=()=>{controller.enqueue(data(files[1]).slice(6));controller.close()};
        options.signal.addEventListener('abort',()=>controller.error(options.signal.reason),{once:true});
      }}),{status:206,headers:{'Content-Range':'bytes 4-23/24'}});
    }
    return base(url,options);
  }});
  try{
    await buffer.load();const response=await buffer.fetch(files[1].url),reader=response.body.getReader();
    assert.deepEqual([...(await reader.read()).value],[0,1,2,3]);
    assert.deepEqual([...(await reader.read()).value],[4,5],'do not wait for the tail of an active network range');
    finish();assert.deepEqual([...(await reader.read()).value],Array.from({length:18},(_,i)=>i+6));assert.equal((await reader.read()).done,true);
    assert.deepEqual(await bytes(buffer,files[1].url,rangeHeader(0,3)),[0,1,2,3]);
    assert.equal(requests.filter(item=>item.url===files[1].url).length,2,'reverse reuses the cached prefix');
  }finally{buffer.dispose()}
});

test('frontier jumps and reverse requests work before global readiness and validate requested ranges',async()=>{
  const requests=[],buffer=createProgressiveVideo(files,{warm,cacheStorage:null,maxBytes:64,fetcher:network(requests)});
  try{
    assert.equal(buffer.ready,false);
    assert.deepEqual(await bytes(buffer,files[3].url,rangeHeader(12,15)),[12,13,14,15]);
    assert.deepEqual(await bytes(buffer,files[1].url,rangeHeader(0,3)),[0,1,2,3]);
    assert.deepEqual(await bytes(buffer,files[3].url,rangeHeader(12,15)),[12,13,14,15]);
    assert.equal(requests.length,2);
    for(const value of ['bytes=0-24','bytes=2-1','bytes=0-','bytes=-1-2'])await assert.rejects(buffer.fetch(files[1].url,{headers:{Range:value}}),/Invalid video byte range/);
    await assert.rejects(buffer.fetch('https://unrelated.example/movie.mp4'),/Unknown video file/);
  }finally{buffer.dispose()}
});

test('cancelling one shared demand does not abort another consumer of the same range',async()=>{
  let finish,signal,calls=0;
  const buffer=createProgressiveVideo(files,{warm,cacheStorage:null,maxBytes:64,fetcher:async(_url,options)=>{
    calls++;signal=options.signal;return new Response(new ReadableStream({start(controller){
      finish=()=>{controller.enqueue(Uint8Array.of(0,1,2,3));controller.close()};
      signal.addEventListener('abort',()=>controller.error(signal.reason),{once:true});
    }}),{status:206,headers:{'Content-Range':'bytes 0-3/24'}});
  }});
  try{
    const first=new AbortController(),second=new AbortController();
    const cancelled=assert.rejects(bytes(buffer,files[1].url,{...rangeHeader(0,3),signal:first.signal}),{name:'AbortError'});
    const healthy=bytes(buffer,files[1].url,{...rangeHeader(0,3),signal:second.signal});await tick();
    first.abort();await cancelled;assert.equal(signal.aborted,false);finish();assert.deepEqual(await healthy,[0,1,2,3]);assert.equal(calls,1);
  }finally{buffer.dispose()}
});

test('visible demand preempts obsolete background work without cancelling unrelated visible requests',async()=>{
  const requests=[],base=network(requests);let backgroundSignal;
  const buffer=createProgressiveVideo(files,{warm,cacheStorage:null,maxBytes:64,concurrency:1,fetcher:async(url,options)=>{
    if(url===files[3].url){backgroundSignal=options.signal;return new Response(new ReadableStream({start(controller){
      options.signal.addEventListener('abort',()=>controller.error(options.signal.reason),{once:true});
    }}),{status:206,headers:{'Content-Range':'bytes 0-3/24'}})}
    return base(url,options);
  }});
  try{
    const cancelled=assert.rejects(buffer.prefetch(files[3].url,rangeHeader(0,3)),{name:'AbortError'});await tick();
    assert.deepEqual(await bytes(buffer,files[1].url,rangeHeader(8,11)),[8,9,10,11]);await cancelled;
    assert.equal(backgroundSignal.aborted,true);
    assert.equal(requests[0].signal.aborted,false);
  }finally{buffer.dispose()}
});

test('the LRU byte budget evicts compressed ranges, and a later reverse refetch stays exact',async()=>{
  const requests=[],buffer=createProgressiveVideo(files,{warm,cacheStorage:null,maxBytes:16,fetcher:network(requests)});
  try{
    await buffer.load();buffer.url(files[0].url);
    for(const file of [files[1],files[2],files[3],files[1]]){
      assert.deepEqual(await bytes(buffer,file.url,rangeHeader(8,15)),[8,9,10,11,12,13,14,15]);
      assert.ok(buffer.residentBytes<=16);
    }
    assert.equal(requests.filter(item=>item.url===files[1].url&&item.start===8).length,2,'evicted reversal history may refetch without losing exact bytes');
    assert.equal(buffer.complete,false);
  }finally{buffer.dispose()}
});

test('invalid ranges, truncated bodies and oversized bodies fail without poisoning other demands',async()=>{
  for(const [body,contentRange,message] of [[new Uint8Array(3),'bytes 0-3/24',/Incomplete/],[new Uint8Array(5),'bytes 0-3/24',/Oversized/],[new Uint8Array(4),'bytes 1-4/24',/Invalid video byte range response/]]){
    const base=network(),buffer=createProgressiveVideo(files,{warm,cacheStorage:null,maxBytes:64,fetcher:(url,options)=>url===files[1].url?new Response(body,{status:206,headers:{'Content-Range':contentRange}}):base(url,options)});
    try{await assert.rejects(bytes(buffer,files[1].url,rangeHeader(0,3)),message);assert.deepEqual(await bytes(buffer,files[2].url,rangeHeader(4,7)),[4,5,6,7]);}
    finally{buffer.dispose()}
  }
  const buffer=createProgressiveVideo(files,{warm,cacheStorage:null,maxBytes:64,fetcher:async url=>new Response(data(files.find(file=>file.url===url)))});
  try{assert.deepEqual(await bytes(buffer,files[1].url,rangeHeader(8,11)),[8,9,10,11],'a server ignoring Range remains compatible');}finally{buffer.dispose()}
});

test('successful disk writes support offline warmup while quota errors retain network playback',async()=>{
  const saved=new Map(),small=files.slice(0,2).map(file=>({...file,bytes:8}));
  const cache={match:async key=>saved.get(key)?.clone(),put:async(key,response)=>saved.set(key,response),keys:async()=>[],delete:async key=>saved.delete(key)};
  const opts={warm:[{url:small[0].url,start:0,end:7},{url:small[1].url,start:0,end:3}],maxBytes:32,cacheStorage:{open:async()=>cache},fetcher:network([],small)};
  const first=createProgressiveVideo(small,opts);
  try{await first.load();await tick();assert.equal(saved.size,2);}finally{first.dispose()}
  const again=createProgressiveVideo(small,{...opts,fetcher:async()=>{throw Error('offline')}});
  try{await again.load();assert.equal(again.ready,true);assert.deepEqual(await bytes(again,small[1].url,rangeHeader(0,3)),[0,1,2,3]);}finally{again.dispose()}
  const full=createProgressiveVideo(small,{...opts,cacheStorage:{open:async()=>({...cache,match:async()=>null,put:async()=>{throw Error('quota')}})}});
  try{await full.load();assert.equal(full.ready,true);}finally{full.dispose()}
});

test('dispose aborts startup, demand and background streams and revokes opening URLs',async()=>{
  const healthy=createProgressiveVideo(files,{warm,cacheStorage:null,maxBytes:64,fetcher:network()});
  await healthy.load();const url=healthy.url(files[0].url);healthy.dispose();await assert.rejects(fetch(url));
  const signals=[],buffer=createProgressiveVideo(files,{warm,cacheStorage:null,maxBytes:64,fetcher:async(_url,{signal})=>{
    signals.push(signal);return new Response(new ReadableStream({start(controller){signal.addEventListener('abort',()=>controller.error(signal.reason),{once:true})}}));
  }});
  const pending=assert.rejects(buffer.load(),{name:'AbortError'});await tick();buffer.dispose();await pending;
  assert.equal(buffer.ready,false);assert.ok(signals.length>0);assert.ok(signals.every(signal=>signal.aborted));
  await assert.rejects(buffer.fetch(files[0].url),{name:'AbortError'});
});

test('streamed decoding can present the warm GOP before the complete first section arrives',async()=>{
  let finish;const base=network();
  const buffer=createProgressiveVideo(files,{warm,cacheStorage:null,maxBytes:64,fetcher:(url,options)=>{
    if(url===files[1].url&&new Headers(options.headers).get('Range')==='bytes=4-23')return Promise.resolve(new Response(new ReadableStream({start(controller){
      finish=()=>{controller.enqueue(data(files[1]).slice(4));controller.close()};
      options.signal.addEventListener('abort',()=>controller.error(options.signal.reason),{once:true});
    }}),{status:206,headers:{'Content-Range':'bytes 4-23/24'}}));
    return base(url,options);
  }});
  class Decoder{
    static async isConfigSupported(){return {supported:true}}
    constructor(callbacks){this.callbacks=callbacks;this.state='configured'}
    configure(){}
    decode(chunk){this.callbacks.output({timestamp:chunk.timestamp,displayWidth:1920,displayHeight:1080,close(){}})}
    async flush(){}
    close(){this.state='closed'}
  }
  const part={url:files[1].url,bytes:24,firstFrame:334,lastFrame:357,frameCount:24,frames:Array.from({length:24},(_,i)=>[i,1,Number(i%4===0)])};
  let source;
  try{
    await buffer.load();source=await createStreamedVideoSource([part],{codec:'avc1.64002a',description:'0164002affe10000'},
      {cacheStorage:null,fetcher:buffer.fetch,Decoder,Chunk:class{constructor(value){Object.assign(this,value)}}});
    assert.equal((await source.frameAt(0)).timestamp,0,'the original streamed reader must decode from the cached startup prefix');
    await tick();assert.equal(typeof finish,'function');finish();
    assert.equal(Math.round((await source.frameAt(23)).timestamp*60/1e6),23);
    assert.equal((await source.frameAt(0)).timestamp,0);
  }finally{source?.dispose();buffer.dispose()}
});

test('corrupt disk entries and unavailable cache APIs fall back to fresh verified network ranges',async()=>{
  const requests=[],deleted=[];
  const buffer=createProgressiveVideo(files,{warm,maxBytes:64,fetcher:network(requests),cacheStorage:{open:async()=>({
    match:async()=>new Response(new Uint8Array(1)),delete:async key=>deleted.push(key),put:async()=>{},keys:async()=>[],
  })}});
  try{await buffer.load();assert.equal(buffer.ready,true);assert.equal(requests.length,2);assert.ok(deleted.length>=2);}finally{buffer.dispose()}
  const unavailable=createProgressiveVideo(files,{warm,maxBytes:64,fetcher:network(),cacheStorage:{open:async()=>{throw Error('private browsing')}}});
  try{await unavailable.load();assert.equal(unavailable.ready,true);}finally{unavailable.dispose()}
});

test('a stalled demand times out locally and a later request can retry the same exact range',async()=>{
  let calls=0;const base=network(),buffer=createProgressiveVideo(files,{warm,cacheStorage:null,maxBytes:64,stallMs:5,fetcher:(url,options)=>{
    if(++calls===1)return Promise.resolve(new Response(new ReadableStream({start(controller){
      options.signal.addEventListener('abort',()=>controller.error(options.signal.reason),{once:true});
    }}),{status:206,headers:{'Content-Range':'bytes 4-7/24'}}));
    return base(url,options);
  }});
  try{
    await assert.rejects(bytes(buffer,files[1].url,rangeHeader(4,7)),{name:'TimeoutError'});
    assert.deepEqual(await bytes(buffer,files[1].url,rangeHeader(4,7)),[4,5,6,7]);
  }finally{buffer.dispose()}
});

test('a large pinned opening can persist without consuming the next section memory reserve',async()=>{
  const saved=new Map(),catalog=[{...files[0],bytes:20},{...files[1],bytes:8}];
  const cache={match:async key=>saved.get(key)?.clone(),put:async(key,response)=>saved.set(key,response),keys:async()=>[]};
  const buffer=createProgressiveVideo(catalog,{warm:[{url:catalog[0].url,start:0,end:19},{url:catalog[1].url,start:0,end:1}],
    maxBytes:32,cacheStorage:{open:async()=>cache},fetcher:network([],catalog)});
  try{
    await buffer.load();buffer.url(catalog[0].url);await tick();
    assert.equal(saved.has(catalog[0].url),true,'the startup opening is already included in the pinned-window budget');
    assert.deepEqual(await bytes(buffer,catalog[1].url),[0,1,2,3,4,5,6,7]);assert.ok(buffer.residentBytes<=32);
  }finally{buffer.dispose()}
});

test('disk budget eviction removes older variants before current reversal history',async()=>{
  const old='https://media.example/old.mp4',saved=new Map([[old,new Response(new Uint8Array(16),{headers:{'Content-Length':'16'}})]]);
  const cache={match:async key=>saved.get(key.url??key)?.clone(),put:async(key,response)=>saved.set(key,response),
    keys:async()=>[...saved.keys()].map(url=>new Request(url)),delete:async key=>saved.delete(key.url??key)};
  const catalog=files.slice(0,2).map(file=>({...file,bytes:8}));
  const buffer=createProgressiveVideo(catalog,{warm:[{url:catalog[0].url,start:0,end:7},{url:catalog[1].url,start:0,end:7}],
    maxBytes:32,diskBytes:16,cacheStorage:{open:async()=>cache},fetcher:network([],catalog)});
  try{
    await buffer.load();await tick();await tick();
    assert.equal(saved.has(old),false);assert.equal(saved.has(catalog[0].url),true);assert.equal(saved.has(catalog[1].url),true);
    assert.equal(buffer.complete,true);
  }finally{buffer.dispose()}
});

test('low-priority fetches can be promoted with their consumers and cannot be preempted as background afterward',async()=>{
  let activeSignal,visibleSignal,finishVisible;const requests=[],base=network(requests);
  const buffer=createProgressiveVideo(files,{warm,cacheStorage:null,maxBytes:64,concurrency:1,fetcher:async(url,options)=>{
    if(url===files[2].url||url===files[1].url){
      if(url===files[2].url)activeSignal=options.signal;else visibleSignal=options.signal;
      return new Response(new ReadableStream({start(controller){
        if(url===files[1].url)finishVisible=()=>{controller.enqueue(Uint8Array.of(4,5,6,7));controller.close()};
        options.signal.addEventListener('abort',()=>controller.error(options.signal.reason),{once:true});
      }}),{status:206,headers:{'Content-Range':'bytes 4-7/24'}});
    }
    return base(url,options);
  }});
  try{
    const background=assert.rejects(bytes(buffer,files[2].url,{...rangeHeader(4,7),priority:'low'}),{name:'AbortError'});await tick();
    const promoted=bytes(buffer,files[1].url,{...rangeHeader(4,7),priority:'low'});await tick();
    assert.equal(activeSignal.aborted,false);assert.equal(visibleSignal,undefined,'a low-priority fetch must queue behind existing background work');
    buffer.prioritize(files[1].url);await background;await tick();assert.equal(activeSignal.aborted,true);
    assert.ok(visibleSignal);const nextDemand=bytes(buffer,files[3].url,rangeHeader(8,11));await tick();
    assert.equal(visibleSignal.aborted,false,'promotion protects the existing consumers as well as the queued job');
    assert.equal(requests.length,0,'the later visible demand waits rather than cancelling promoted work');
    finishVisible();assert.deepEqual(await promoted,[4,5,6,7]);assert.deepEqual(await nextDemand,[8,9,10,11]);
  }finally{buffer.dispose()}
});

test('visible subranges join a complete-section download and finish before its background tail',async()=>{
  let controller,signal,finished=false;const requests=[];
  const buffer=createProgressiveVideo(files,{warm,cacheStorage:null,maxBytes:64,fetcher:async(url,options)=>{
    requests.push({url,range:new Headers(options.headers).get('Range')});signal=options.signal;
    return new Response(new ReadableStream({start(stream){controller=stream;stream.enqueue(Uint8Array.of(0,1,2,3));signal.addEventListener('abort',()=>stream.error(signal.reason),{once:true});}}));
  }});
  try{
    const background=buffer.prefetch(files[1].url).then(()=>{finished=true});await tick();
    const response=await buffer.fetch(files[1].url,rangeHeader(2,5)),picture=response.arrayBuffer();
    controller.enqueue(Uint8Array.from({length:8},(_,i)=>i+4));
    assert.deepEqual([...new Uint8Array(await picture)],[2,3,4,5]);
    assert.equal(response.status,206);assert.equal(response.headers.get('Content-Range'),'bytes 2-5/24');assert.equal(response.headers.get('Content-Length'),'4');
    assert.equal(finished,false,'a completed visible range must not await the background response tail');assert.equal(signal.aborted,false);
    assert.equal(requests.length,1,'do not redownload bytes already carried by an in-flight covering request');
    assert.equal(buffer.isBuffered(files[1].url),false,'an unvalidated in-flight tail is not a complete buffered section');
    controller.enqueue(Uint8Array.from({length:12},(_,i)=>i+12));controller.close();await background;
    assert.equal(buffer.isBuffered(files[1].url),true);assert.ok(buffer.residentBytes<=64);
  }finally{buffer.dispose()}
});

test('extending a pending prefix requests only its missing suffix',async()=>{
  let controller;const requests=[],base=network(requests);
  const buffer=createProgressiveVideo(files,{warm,cacheStorage:null,maxBytes:64,fetcher:async(url,options)=>{
    if(new Headers(options.headers).get('Range')==='bytes=0-7'){
      requests.push({url,start:0,end:7});return new Response(new ReadableStream({start(stream){controller=stream;stream.enqueue(Uint8Array.of(0,1,2,3));
        options.signal.addEventListener('abort',()=>stream.error(options.signal.reason),{once:true});
      }}),{status:206,headers:{'Content-Range':'bytes 0-7/24'}});
    }
    return base(url,options);
  }});
  try{
    const background=buffer.prefetch(files[1].url,rangeHeader(0,7));await tick();
    const visible=bytes(buffer,files[1].url,rangeHeader(4,11));await tick();assert.equal(requests.length,1);
    controller.enqueue(Uint8Array.of(4,5,6,7));controller.close();
    assert.deepEqual(await visible,[4,5,6,7,8,9,10,11]);await background;
    assert.deepEqual(requests.map(({start,end})=>[start,end]),[[0,7],[8,11]],'overlapping in-flight prefix bytes must not download twice');
  }finally{buffer.dispose()}
});

test('an in-flight tail can combine with a new prefix without waiting for the tail to finish',async()=>{
  let controller,signal,finished=false;const requests=[],base=network(requests);
  const buffer=createProgressiveVideo(files,{warm,cacheStorage:null,maxBytes:64,fetcher:async(url,options)=>{
    if(new Headers(options.headers).get('Range')==='bytes=8-23'){
      signal=options.signal;requests.push({url,start:8,end:23});return new Response(new ReadableStream({start(stream){controller=stream;stream.enqueue(Uint8Array.from({length:8},(_,i)=>i+8));
        signal.addEventListener('abort',()=>stream.error(signal.reason),{once:true});
      }}),{status:206,headers:{'Content-Range':'bytes 8-23/24'}});
    }
    return base(url,options);
  }});
  try{
    const background=buffer.prefetch(files[1].url,rangeHeader(8,23)).then(()=>{finished=true});await tick();
    assert.deepEqual(await bytes(buffer,files[1].url,rangeHeader(0,11)),Array.from({length:12},(_,i)=>i));
    assert.equal(finished,false);assert.equal(signal.aborted,false);
    assert.deepEqual(requests.map(({start,end})=>[start,end]),[[8,23],[0,7]]);
    controller.enqueue(Uint8Array.from({length:8},(_,i)=>i+16));controller.close();await background;
    assert.equal(buffer.isBuffered(files[1].url),true);
  }finally{buffer.dispose()}
});

test('aborting a joined visible subrange leaves its background full-section consumer running',async()=>{
  let controller,signal;let requests=0;
  const buffer=createProgressiveVideo(files,{warm,cacheStorage:null,maxBytes:64,fetcher:async(_url,options)=>{
    requests++;signal=options.signal;return new Response(new ReadableStream({start(stream){controller=stream;stream.enqueue(Uint8Array.of(0,1,2,3));signal.addEventListener('abort',()=>stream.error(signal.reason),{once:true});}}));
  }});
  try{
    const background=buffer.prefetch(files[1].url);await tick();const abort=new AbortController();
    const cancelled=assert.rejects(bytes(buffer,files[1].url,{...rangeHeader(8,11),signal:abort.signal}),{name:'AbortError'});await tick();abort.abort();await cancelled;
    assert.equal(signal.aborted,false);assert.equal(requests,1);
    controller.enqueue(Uint8Array.from({length:20},(_,i)=>i+4));controller.close();await background;
    assert.equal(buffer.isBuffered(files[1].url),true);
  }finally{buffer.dispose()}
});

test('a queued covering prefetch is promoted once and can be demoted when another section becomes current',async()=>{
  let oldSignal,currentSignal,currentController;const requests=[],base=network(requests);
  const buffer=createProgressiveVideo(files,{warm,cacheStorage:null,maxBytes:64,concurrency:1,fetcher:async(url,options)=>{
    if(url===files[2].url||url===files[1].url){
      if(url===files[2].url)oldSignal=options.signal;else currentSignal=options.signal;
      requests.push({url});return new Response(new ReadableStream({start(stream){if(url===files[1].url)currentController=stream;options.signal.addEventListener('abort',()=>stream.error(options.signal.reason),{once:true});}}));
    }
    return base(url,options);
  }});
  try{
    const old=assert.rejects(buffer.prefetch(files[2].url),{name:'AbortError'});await tick();
    const current=assert.rejects(buffer.prefetch(files[1].url),{name:'AbortError'});await tick();
    const picture=bytes(buffer,files[1].url,rangeHeader(8,11));buffer.prioritize(files[1].url);await old;await tick();
    assert.equal(oldSignal.aborted,true);assert.ok(currentSignal);assert.equal(requests.filter(item=>item.url===files[1].url).length,1);
    currentController.enqueue(Uint8Array.from({length:12},(_,i)=>i));assert.deepEqual(await picture,[8,9,10,11]);
    assert.equal(currentSignal.aborted,false,'finishing the visible subrange must keep current background work alive');
    buffer.prioritize(files[3].url);await tick();
    assert.equal(currentSignal.aborted,false,'changing to another cached/current section alone must preserve useful background progress');
    const demand=bytes(buffer,files[3].url,rangeHeader(0,3));await current;
    assert.equal(currentSignal.aborted,true,'a real visible miss can preempt the demoted background job');
    assert.deepEqual(await demand,[0,1,2,3]);
  }finally{buffer.dispose()}
});

test('buffered coverage queries distinguish partial data and an evicted section',async()=>{
  const buffer=createProgressiveVideo(files,{warm,cacheStorage:null,maxBytes:24,fetcher:network()});
  try{
    await bytes(buffer,files[1].url,rangeHeader(0,7));assert.equal(buffer.isBuffered(files[1].url),false);assert.equal(buffer.isBuffered(files[1].url,0,7),true);
    await bytes(buffer,files[1].url,rangeHeader(8,23));assert.equal(buffer.isBuffered(files[1].url),true);
    await bytes(buffer,files[2].url);assert.equal(buffer.isBuffered(files[1].url),false);assert.equal(buffer.isBuffered(files[2].url),true);assert.ok(buffer.residentBytes<=24);
  }finally{buffer.dispose()}
});

test('persisting a verified full section removes overlapping ranges before disk-budget eviction',async()=>{
  const catalog=files.slice(1,3).map(file=>({...file,url:file.url+'?v=active'}));
  const partial=(url,start,end)=>{const key=new URL(url);key.searchParams.set('__sofacet_range',`${start}-${end}`);return key.href};
  const response=length=>new Response(new Uint8Array(length),{headers:{'Content-Length':String(length)}});
  const first=partial(catalog[0].url,0,15),second=partial(catalog[0].url,8,23);
  const saved=new Map([[catalog[1].url,response(24)],[first,response(16)],[second,response(16)]]);
  const cache={match:async key=>saved.get(key.url??key)?.clone(),put:async(key,value)=>saved.set(key,value),
    keys:async()=>[...saved.keys()].map(url=>new Request(url)),delete:async key=>saved.delete(key.url??key)};
  const options={warm:catalog.map(file=>({url:file.url,start:0,end:23})),maxBytes:64,diskBytes:48,cacheStorage:{open:async()=>cache}};
  const buffer=createProgressiveVideo(catalog,{...options,fetcher:network([],catalog)});
  try{
    assert.deepEqual(await bytes(buffer,catalog[0].url),Array.from({length:24},(_,i)=>i));
    await tick();await tick();
    assert.equal(saved.has(first),false);assert.equal(saved.has(second),false);
    assert.equal(saved.has(catalog[1].url),true,'redundant ranges must not evict another complete current section');
    assert.equal(saved.has(catalog[0].url),true);
    assert.equal([...saved.values()].reduce((sum,item)=>sum+Number(item.headers.get('Content-Length')),0),48);
  }finally{buffer.dispose()}
  const offline=createProgressiveVideo(catalog,{...options,fetcher:async()=>{throw Error('offline')}});
  try{await offline.load();assert.equal(offline.complete,true);}finally{offline.dispose()}
});

test('a failed full-section disk write preserves useful cached partial ranges',async()=>{
  const file=files[1],partial=new URL(file.url);partial.searchParams.set('__sofacet_range','0-3');
  const saved=new Map([[partial.href,new Response(data(file).slice(0,4),{headers:{'Content-Length':'4'}})]]);
  const cache={match:async key=>saved.get(key.url??key)?.clone(),put:async()=>{throw Error('quota')},
    keys:async()=>[...saved.keys()].map(url=>new Request(url)),delete:async key=>saved.delete(key.url??key)};
  const options={warm:[{url:file.url,start:0,end:3}],maxBytes:64,cacheStorage:{open:async()=>cache}};
  const buffer=createProgressiveVideo([file],{...options,fetcher:network()});
  try{
    assert.equal((await bytes(buffer,file.url)).length,24);await tick();
    assert.equal(saved.has(partial.href),true);assert.equal(saved.has(file.url),false);
  }finally{buffer.dispose()}
  const offline=createProgressiveVideo([file],{...options,fetcher:async()=>{throw Error('offline')}});
  try{await offline.load();assert.deepEqual(await bytes(offline,file.url,rangeHeader(0,3)),[0,1,2,3]);}finally{offline.dispose()}
});

test('disk trimming also deduplicates verified cache hits while retaining other version URLs',async()=>{
  const current=files[1].url+'?v=current',old=files[1].url+'?v=old';
  const partial=url=>{const key=new URL(url);key.searchParams.set('__sofacet_range','0-15');return key.href};
  const response=length=>new Response(new Uint8Array(length),{headers:{'Content-Length':String(length)}});
  const saved=new Map([[current,response(24)],[partial(current),response(16)],[partial(old),response(16)]]);
  const cache={match:async key=>saved.get(key.url??key)?.clone(),put:async(key,value)=>saved.set(key,value),
    keys:async()=>[...saved.keys()].map(url=>new Request(url)),delete:async key=>saved.delete(key.url??key)};
  const catalog=[{...files[1],url:current},files[2]],requests=[];
  const buffer=createProgressiveVideo(catalog,{warm:[{url:current,start:0,end:3}],maxBytes:64,diskBytes:100,
    cacheStorage:{open:async()=>cache},fetcher:network(requests,catalog)});
  try{
    await bytes(buffer,current);await bytes(buffer,files[2].url);await tick();await tick();
    assert.equal(requests.length,1,'a previously persisted full section should remain a verified cache hit');
    assert.equal(saved.has(partial(current)),false);assert.equal(saved.has(partial(old)),true);
    assert.equal(saved.has(current),true);assert.equal(saved.has(files[2].url),true);
  }finally{buffer.dispose()}
});

test('a variant-sized memory budget retains complete progressively loaded coverage without disk or reversal refetches',async()=>{
  const requests=[],total=files.reduce((sum,file)=>sum+file.bytes,0);
  const buffer=createProgressiveVideo(files,{warm,maxBytes:total,cacheStorage:null,fetcher:network(requests)});
  try{
    await buffer.load();buffer.url(files[0].url);
    for(const file of files.slice(1))await buffer.prefetch(file.url);
    const loaded=requests.length;assert.equal(buffer.complete,true);assert.equal(buffer.residentBytes,total);
    for(const file of files.slice(1).reverse())assert.deepEqual(await bytes(buffer,file.url,rangeHeader(12,23)),Array.from({length:12},(_,i)=>i+12));
    assert.equal(requests.length,loaded,'all section bytes remain available after the background fill');
    assert.equal(buffer.complete,true);assert.equal(buffer.residentBytes,total);
  }finally{buffer.dispose()}
});

test('changing visible priority across cached sections preserves unrelated background fill',{timeout:1500},async()=>{
  const requests=[],base=network(requests);let controller,signal;
  const buffer=createProgressiveVideo(files,{warm,cacheStorage:null,maxBytes:80,concurrency:1,fetcher:async(url,options)=>{
    if(url!==files[3].url)return base(url,options);
    signal=options.signal;return new Response(new ReadableStream({start(stream){controller=stream;
      stream.enqueue(Uint8Array.from({length:12},(_,i)=>i));signal.addEventListener('abort',()=>stream.error(signal.reason),{once:true});
    }}));
  }});
  try{
    await buffer.load();const background=buffer.prefetch(files[3].url);await tick();
    for(const file of [files[1],files[0],files[1]]){
      buffer.prioritize(file.url);assert.deepEqual(await bytes(buffer,file.url,rangeHeader(0,3)),[0,1,2,3]);
      assert.equal(signal.aborted,false,'cached visible movement does not need to preempt the far-section download');
    }
    controller.enqueue(Uint8Array.from({length:12},(_,i)=>i+12));controller.close();await background;
    assert.equal(buffer.isBuffered(files[3].url),true);
  }finally{buffer.dispose()}
});

test('coverage diagnostics count unique verified bytes and identify incomplete files',async()=>{
  const buffer=createProgressiveVideo(files,{warm,maxBytes:80,cacheStorage:null,fetcher:network()});
  try{
    await buffer.load();await bytes(buffer,files[1].url,rangeHeader(12,15));
    assert.deepEqual(buffer.coverage,{bufferedBytes:16,totalBytes:80,bufferedFiles:1,totalFiles:4,missing:[
      {url:files[1].url,bytes:24,bufferedBytes:8},{url:files[2].url,bytes:24,bufferedBytes:0},{url:files[3].url,bytes:24,bufferedBytes:0},
    ]});
    for(const file of files.slice(1))await buffer.prefetch(file.url);
    assert.deepEqual(buffer.coverage,{bufferedBytes:80,totalBytes:80,bufferedFiles:4,totalFiles:4,missing:[]});
  }finally{buffer.dispose()}
});
