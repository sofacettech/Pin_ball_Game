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
    const buffer=createPreloadedVideo([files[0]],{cacheStorage:null,fetcher:async()=>new Response(new Uint8Array(size))});
    try{await assert.rejects(buffer.load(),/Incomplete|Oversized/);assert.equal(buffer.ready,false)}finally{buffer.dispose()}
  }
  assert.throws(()=>createPreloadedVideo([{url:'x',bytes:300*1024*1024}]),/Invalid video preload size/);
});

test('leaving during preload cancels all downloads without declaring readiness',async()=>{
  const signals=[];
  const buffer=createPreloadedVideo(files,{cacheStorage:null,fetcher:async(_url,{signal})=>{
    signals.push(signal);return new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(1))}}));
  }});
  const cancelled=assert.rejects(buffer.load(),{name:'AbortError'});
  await new Promise(r=>setImmediate(r));buffer.dispose();await cancelled;
  assert.equal(signals.length,3);assert.ok(signals.every(s=>s.aborted));assert.equal(buffer.ready,false);
});

test('a repeat visit can preload from disk offline, and a full disk does not break playback',async()=>{
  const saved=new Map();let downloads=0;
  const cache={match:async url=>saved.get(url)?.clone(),put:async(url,response)=>{saved.set(url,response)},keys:async()=>[]};
  const options={cacheStorage:{open:async()=>cache},fetcher:async()=>{downloads++;return new Response(new Uint8Array(8))}};
  const first=createPreloadedVideo(files,options);await first.load();first.dispose();assert.equal(downloads,5);
  const again=createPreloadedVideo(files,{...options,fetcher:async()=>{throw Error('offline')}});
  try{await again.load();assert.equal(again.ready,true);assert.equal((await (await again.fetch(files[4].url)).blob()).size,8)}finally{again.dispose()}
  const full=createPreloadedVideo(files,{...options,cacheStorage:{open:async()=>({...cache,match:async()=>null,put:async()=>{throw Error('quota')}})}});
  try{await full.load();assert.equal(full.ready,true)}finally{full.dispose()}
});
