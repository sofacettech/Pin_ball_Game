import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreloadedVideo} from '../entrance-source/preloaded-video.mjs';
const files=Array.from({length:5},(_,i)=>({url:`https://media.example/${i}.mp4`,bytes:8}));

test('the complete compressed journey loads before readiness, with real progress and offline byte ranges',async()=>{
  let finish;const progress=[],requests=[];
  const buffer=createPreloadedVideo(files,{cacheStorage:null,onProgress:(...args)=>progress.push(args),fetcher:async url=>{
    requests.push(url);
    return url===files[4].url?new Response(new ReadableStream({start(c){c.enqueue(Uint8Array.of(0,1,2,3));finish=()=>{c.enqueue(Uint8Array.of(4,5,6,7));c.close()}}})):new Response(Uint8Array.of(0,1,2,3,4,5,6,7));
  }});
  try{
    const loading=buffer.load();await new Promise(r=>setImmediate(r));
    assert.equal(buffer.ready,false);assert.deepEqual(progress.at(-1),[36,40]);
    await assert.rejects(buffer.fetch(files[0].url),/not preloaded/);
    finish();await loading;assert.equal(buffer.ready,true);assert.deepEqual(progress.at(-1),[40,40]);
    for(const file of files.slice().reverse()){
      const response=await buffer.fetch(file.url,{headers:{Range:'bytes=4-7'}});
      assert.equal(response.status,206);assert.equal(response.headers.get('Content-Range'),'bytes 4-7/8');
      assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[4,5,6,7]);
    }
    const url=buffer.url(files[0].url);assert.equal(buffer.url(files[0].url),url);
    assert.equal((await (await fetch(url)).blob()).size,8);
    assert.equal(requests.length,files.length,'seeking back to the start must never refetch media');
    await assert.rejects(buffer.fetch(files[0].url,{headers:{Range:'bytes=2-8'}}),/Invalid preloaded/);
    buffer.dispose();assert.equal(buffer.ready,false);await assert.rejects(fetch(url));
  }finally{buffer.dispose()}
});

test('preload rejects truncated/oversized media and bounds memory before downloading',async()=>{
  for(const size of [7,9]){
    const buffer=createPreloadedVideo([files[0]],{cacheStorage:null,clock:()=>13,fetcher:async()=>new Response(new Uint8Array(size))});
    try{
      await assert.rejects(buffer.load(),/Incomplete|Oversized/);assert.equal(buffer.ready,false);
      assert.deepEqual(buffer.networkProgress,{bytes:size,startedAt:13,active:0},'count actual network bytes even when the payload is rejected');
    }finally{buffer.dispose()}
  }
  assert.throws(()=>createPreloadedVideo([{url:'x',bytes:300*1024*1024}]),/Invalid video preload size/);
});

test('leaving during preload cancels all downloads without declaring readiness',async()=>{
  const signals=[];
  const buffer=createPreloadedVideo(files,{cacheStorage:null,clock:()=>7,fetcher:async(_url,{signal})=>{
    signals.push(signal);return new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(1))}}));
  }});
  const cancelled=assert.rejects(buffer.load(),{name:'AbortError'});
  await new Promise(r=>setImmediate(r));
  assert.deepEqual(buffer.networkProgress,{bytes:3,startedAt:7,active:3});
  buffer.dispose();assert.equal(buffer.networkProgress.active,0,'abort removes activity synchronously');await cancelled;
  buffer.dispose();await new Promise(r=>setImmediate(r));
  assert.deepEqual(buffer.networkProgress,{bytes:3,startedAt:7,active:0},'late worker cleanup and repeated disposal cannot underflow activity');
  assert.equal(signals.length,3);assert.ok(signals.every(s=>s.aborted));assert.equal(buffer.ready,false);
});

test('network metrics start at the actual fetch before headers and count streamed body bytes without changing progress',async()=>{
  let openCache,headers,body,now=0,clockCalls=0;const progress=[];
  const buffer=createPreloadedVideo([files[0]],{
    cacheStorage:{open:()=>new Promise(resolve=>{openCache=resolve})},
    clock:()=>{clockCalls++;return now},onProgress:(...args)=>progress.push(args),
    fetcher:(_url,{signal})=>new Promise((resolve,reject)=>{
      signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
      headers=()=>resolve(new Response(new ReadableStream({start(controller){body=controller}})));
    }),
  });
  try{
    assert.deepEqual(buffer.networkProgress,{bytes:0,startedAt:null,active:0});
    const loading=buffer.load();await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(buffer.networkProgress,{bytes:0,startedAt:null,active:0},'opening CacheStorage is not network transfer time');
    assert.equal(clockCalls,0);
    now=100;openCache(null);await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(buffer.networkProgress,{bytes:0,startedAt:100,active:1},'TTFB counts as active transfer before any response headers arrive');
    now=400;headers();await new Promise(resolve=>setImmediate(resolve));
    body.enqueue(Uint8Array.of(0,1,2));await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(buffer.networkProgress,{bytes:3,startedAt:100,active:1});
    body.enqueue(Uint8Array.of(3,4,5,6,7));body.close();await loading;
    assert.deepEqual(buffer.networkProgress,{bytes:8,startedAt:100,active:0});
    assert.equal(clockCalls,1,'only the first actual network request needs a timestamp');
    assert.deepEqual(progress,[[0,8],[3,8],[8,8]],'preserve the existing two-argument progress callback');
  }finally{buffer.dispose()}
});

test('aborting before headers clears all three network workers without counting nonexistent bytes',async()=>{
  const signals=[];let clockCalls=0;
  const buffer=createPreloadedVideo(files,{cacheStorage:null,clock:()=>clockCalls++,fetcher:(_url,{signal})=>new Promise((_resolve,reject)=>{
    signals.push(signal);signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
  })});
  const cancelled=assert.rejects(buffer.load(),{name:'AbortError'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(signals.length,3);assert.deepEqual(buffer.networkProgress,{bytes:0,startedAt:0,active:3});
  assert.equal(clockCalls,1,'a first timestamp of zero must not be overwritten by later workers');
  buffer.dispose();assert.equal(buffer.networkProgress.active,0);await cancelled;
  buffer.dispose();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(buffer.networkProgress,{bytes:0,startedAt:0,active:0});
  assert.ok(signals.every(signal=>signal.aborted));assert.equal(buffer.ready,false);
});

test('disposing during a pending cache lookup cannot start a late network transfer',async()=>{
  let miss;const cache={match:()=>new Promise(resolve=>{miss=resolve})};
  const buffer=createPreloadedVideo([files[0]],{cacheStorage:{open:async()=>cache},clock:()=>{throw Error('network must not start')},fetcher:()=>{throw Error('late fetch')}});
  const cancelled=assert.rejects(buffer.load(),{name:'AbortError'});
  await new Promise(resolve=>setImmediate(resolve));buffer.dispose();miss(null);await cancelled;
  assert.deepEqual(buffer.networkProgress,{bytes:0,startedAt:null,active:0});assert.equal(buffer.ready,false);
});

test('a repeat visit can preload from disk offline, and a full disk does not break playback',async()=>{
  const saved=new Map();let downloads=0;
  const cache={match:async url=>saved.get(url)?.clone(),put:async(url,response)=>{saved.set(url,response)},keys:async()=>[]};
  const options={cacheStorage:{open:async()=>cache},fetcher:async()=>{downloads++;return new Response(new Uint8Array(8))}};
  const first=createPreloadedVideo(files,options);await first.load();await first.whenPersisted();first.dispose();assert.equal(downloads,5);
  const again=createPreloadedVideo(files,{...options,bypassHTTPCache:true,clock:()=>{throw Error('cached reads must not start the network clock')},fetcher:async()=>{throw Error('offline')}});
  try{
    await again.load();assert.equal(again.ready,true);assert.equal((await (await again.fetch(files[4].url)).blob()).size,8);
    assert.deepEqual(again.networkProgress,{bytes:0,startedAt:null,active:0});
  }finally{again.dispose()}
  const full=createPreloadedVideo(files,{...options,cacheStorage:{open:async()=>({...cache,match:async()=>null,put:async()=>{throw Error('quota')}})}});
  try{await full.load();assert.equal(full.ready,true)}finally{full.dispose()}
});

test('optional HTTP cache bypass affects network requests while validated CacheStorage hits stay usable',async()=>{
  for(const bypassHTTPCache of [false,true]){
    const requests=[];
    const cache={match:async url=>url===files[0].url?new Response(new Uint8Array(8)):null,put:async()=>{},keys:async()=>[]};
    const buffer=createPreloadedVideo(files.slice(0,2),{bypassHTTPCache,cacheStorage:{open:async()=>cache},clock:()=>10,fetcher:async(url,options)=>{
      requests.push({url,options});return new Response(new Uint8Array(8));
    }});
    try{
      await buffer.load();await buffer.whenPersisted();
      assert.equal(requests.length,1,'a validated CacheStorage hit must not be refetched');
      assert.equal(requests[0].url,files[1].url);
      assert.deepEqual(Object.keys(requests[0].options).sort(),bypassHTTPCache?['cache','signal']:['signal']);
      assert.equal(requests[0].options.cache,bypassHTTPCache?'no-store':undefined);
      assert.equal(requests[0].options.signal.aborted,false);
      assert.equal((await (await buffer.fetch(files[0].url)).blob()).size,8);
      assert.deepEqual(buffer.networkProgress,{bytes:8,startedAt:10,active:0});
    }finally{buffer.dispose()}
  }
});

test('slow disk writes do not serialize network downloads or complete RAM readiness, and trimming waits for persistence',async()=>{
  const downloads=[],writes=[],finish=[],deleted=[];let active=0,peak=0,trims=0;
  const old='https://media.example/old.mp4';
  const cache={
    match:async key=>key.url===old?new Response(null,{headers:{'Content-Length':String(256*1024*1024)}}):null,
    put:(url,response)=>new Promise(resolve=>{
      active++;peak=Math.max(peak,active);writes.push({url,response});finish.push(()=>{active--;resolve()});
    }),
    keys:async()=>{trims++;assert.equal(writes.length,5);assert.equal(active,0);return [{url:old}]},
    delete:async key=>{deleted.push(key.url);return true},
  };
  const buffer=createPreloadedVideo(files,{cacheStorage:{open:async()=>cache},fetcher:async url=>{downloads.push(url);return new Response(new Uint8Array(8))}});
  try{
    await buffer.load();
    assert.equal(downloads.length,5,'all downloads finish while the first disk write is still blocked');
    assert.equal(buffer.ready,true);assert.equal(trims,0);assert.equal(writes.length,1);
    assert.equal((await (await buffer.fetch(files[4].url)).blob()).size,8,'last section is immediately usable from RAM');
    let persisted=false;const persistence=buffer.whenPersisted().then(()=>{persisted=true});
    for(let index=0;index<files.length;index++){
      assert.equal(persisted,false);assert.equal(active,1);finish[index]();await new Promise(resolve=>setImmediate(resolve));
    }
    await persistence;assert.equal(peak,1);assert.equal(trims,1);assert.deepEqual(deleted,[old]);
    assert.deepEqual(writes.map(write=>write.url),downloads);
    for(const write of writes)assert.equal(write.response.headers.get('Content-Length'),'8');
  }finally{buffer.dispose()}
});

test('disposing clears queued disk writes and skips cache trimming after the unavoidable active write settles',async()=>{
  let finish,writes=0,trims=0;
  const cache={match:async()=>null,put:()=>{writes++;return new Promise(resolve=>{finish=resolve})},keys:async()=>{trims++;return []}};
  const buffer=createPreloadedVideo(files,{cacheStorage:{open:async()=>cache},fetcher:async()=>new Response(new Uint8Array(8))});
  await buffer.load();assert.equal(writes,1);buffer.dispose();finish();await buffer.whenPersisted();
  assert.equal(writes,1,'Cache.put cannot be cancelled, but no queued write may start after disposal');
  assert.equal(trims,0);assert.equal(buffer.ready,false);
});

test('every mixture of cache hits and new writes trims old variants once after full readiness and persistence',async()=>{
  for(let mask=0;mask<1<<files.length;mask++){
    const old='https://media.example/old.mp4',saved=new Map([[old,new Response(null,{headers:{'Content-Length':String(256*1024*1024)}})]]);
    for(let index=0;index<files.length;index++)if(mask&(1<<index))saved.set(files[index].url,new Response(new Uint8Array(8)));
    let trims=0,writes=0,downloads=0,clockCalls=0,buffer;const progress=[];
    const cache={
      match:async key=>saved.get(typeof key==='string'?key:key.url)?.clone(),
      put:async(url,response)=>{writes++;saved.set(url,response)},
      keys:async()=>{trims++;assert.equal(buffer.ready,true);assert.ok(files.every(file=>saved.has(file.url)));return [...saved.keys()].map(url=>({url}))},
      delete:async key=>saved.delete(key.url),
    };
    buffer=createPreloadedVideo(files,{cacheStorage:{open:async()=>cache},clock:()=>{clockCalls++;return 50},onProgress:(...args)=>progress.push(args),fetcher:async()=>{downloads++;return new Response(new Uint8Array(8))}});
    try{
      await buffer.load();await buffer.whenPersisted();
      assert.equal(trims,1,`cache-hit mask ${mask}: trim once even when a previous persistence pass finishes before readiness`);
      assert.equal(saved.has(old),false,`cache-hit mask ${mask}: evict the old variant that exceeds the disk budget`);
      assert.ok(files.every(file=>saved.has(file.url)),`cache-hit mask ${mask}: retain the complete current variant`);
      assert.equal(writes,downloads);
      assert.deepEqual(progress.at(-1),[40,40],'cache hits still contribute to ordinary preload progress');
      assert.deepEqual(buffer.networkProgress,{bytes:downloads*8,startedAt:downloads?50:null,active:0},`cache-hit mask ${mask}: cache bytes must not inflate network throughput`);
      assert.equal(clockCalls,downloads?1:0);
    }finally{buffer.dispose()}
  }
});

test('a native video object URL can be revoked without losing locally replayable compressed bytes',async()=>{
  const buffer=createPreloadedVideo([files[0]],{cacheStorage:null,fetcher:async()=>new Response(new Uint8Array(8))});
  try{
    await buffer.load();const first=buffer.url(files[0].url);buffer.revokeURL(files[0].url);
    await assert.rejects(fetch(first));assert.equal(buffer.ready,true);
    const replay=buffer.url(files[0].url);assert.notEqual(replay,first);
    assert.equal((await (await fetch(replay)).blob()).size,8);
    assert.equal((await (await buffer.fetch(files[0].url)).blob()).size,8);
  }finally{buffer.dispose()}
});
