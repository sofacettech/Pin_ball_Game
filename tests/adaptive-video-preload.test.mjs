import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdaptiveVideoPreload} from '../entrance-source/adaptive-video-preload.mjs';

const turn=()=>new Promise(resolve=>setImmediate(resolve));
function media(width=3840){
  const clips=Object.fromEntries(['opening','journey'].map((kind,i)=>[kind,{
    url:`https://media.example/${width}/${kind}.mp4`,local:`/local/${kind}.mp4`,bytes:width===3840?(i?190000000:10000000):(i?60000000:1882825),
    localBytes:i?60000000:1882825,localWidth:1920,localHeight:1080,
  }]));
  return {manifest:{width,height:width===3840?2160:1080},clips,selectionReason:width===3840?'preferred':'data-saver'};
}
function fixture({initial=media(),failures=[],loadMedia:loader}={}){
  let now=0,intervalId=0;const intervals=new Map(),buffers=[],requests=[];
  const createBuffer=(files,options)=>{
    const total=files.reduce((sum,file)=>sum+file.bytes,0);let resolve,reject,settled=false;
    const pending=new Promise((yes,no)=>{resolve=yes;reject=no});pending.catch(()=>{});
    const buffer={files,options,bytes:total,networkProgress:{bytes:0,startedAt:0,active:1},ready:false,disposed:false,
      load(){if(failures[buffers.indexOf(buffer)])return Promise.reject(Error('Unavailable'));options.onProgress(0,total);return pending},
      progress(bytes,cached=0){buffer.networkProgress.bytes=bytes;options.onProgress(bytes+cached,total)},
      finish(){settled=true;buffer.ready=true;buffer.networkProgress.active=0;resolve()},
      dispose(){buffer.disposed=true;buffer.ready=false;buffer.networkProgress.active=0;if(!settled){settled=true;reject(new DOMException('Disposed','AbortError'))}},
    };buffers.push(buffer);return buffer;
  };
  const preload=createAdaptiveVideoPreload(initial,{createBuffer,clock:()=>now,document:null,
    timers:{setInterval(fn){intervals.set(++intervalId,fn);return intervalId},clearInterval(id){intervals.delete(id)}},
    loadMedia:async(fetcher,options)=>{requests.push(options);assert.equal(buffers.at(-1).disposed,true);return loader?loader(options):media(1920)},
  });
  return {preload,buffers,requests,intervals,tick(time,bytes,cached=0){now=time;if(bytes!==undefined)buffers.at(-1).progress(bytes,cached);for(const fn of [...intervals.values()])fn()}};
}

test('fast unknown-device preload retains 4K without an extra probe or readiness delay',async()=>{
  const f=fixture(),ready=f.preload.load();let done=false;ready.then(()=>done=true);
  for(let now=250;now<=2500;now+=250)f.tick(now,now*12500);
  assert.equal(done,false);assert.equal(f.buffers.length,1);assert.equal(f.requests.length,0);
  assert.equal(f.buffers[0].options.bypassHTTPCache,true);
  f.buffers[0].finish();const selected=await ready;
  assert.equal(selected.manifest.width,3840);assert.equal(selected.selection.switches,0);assert.equal(f.intervals.size,0);
  assert.equal(f.preload.load(),ready);f.preload.dispose();
});

test('slow 4K transfers abort before one HD CDN retry and never upgrade again',async()=>{
  const f=fixture(),ready=f.preload.load();
  for(let now=250;now<=2000;now+=250)f.tick(now,now*100);
  await turn();
  assert.equal(f.buffers[0].disposed,true);assert.equal(f.requests.length,1);assert.equal(f.requests[0].option,'2');
  assert.equal(f.buffers.length,2);assert.equal(f.preload.selection.reason,'slow-network');assert.equal(f.preload.selection.switches,1);
  assert.equal(f.preload.selection.discardedBytes,200000);assert.equal(f.buffers[1].options.bypassHTTPCache,false);
  assert.equal(f.intervals.size,0);f.tick(10000,60000000);assert.equal(f.buffers.length,2);
  f.buffers[1].finish();const selected=await ready;
  assert.equal(selected.manifest.width,1920);assert.match(selected.clips.journey.url,/\/1920\//);f.preload.dispose();
});

test('a fully cached 4K set completes without treating disk reads as a bandwidth sample',async()=>{
  const f=fixture(),ready=f.preload.load();f.buffers[0].networkProgress={bytes:0,startedAt:null,active:0};
  f.buffers[0].progress(0,200000000);f.buffers[0].finish();const selected=await ready;
  assert.equal(selected.manifest.width,3840);assert.equal(f.requests.length,0);assert.equal(f.intervals.size,0);f.preload.dispose();
});

test('Save Data HD preference does not start a 4K speed probe',async()=>{
  const f=fixture({initial:media(1920)}),ready=f.preload.load();
  assert.equal(f.intervals.size,0);assert.equal(f.buffers[0].options.bypassHTTPCache,false);
  f.buffers[0].finish();const selected=await ready;assert.equal(selected.selection.reason,'data-saver');assert.equal(f.requests.length,0);f.preload.dispose();
});

test('4K download failure prefers the complete regular CDN over bundled native media',async()=>{
  const f=fixture({failures:[true]}),ready=f.preload.load();await turn();
  assert.equal(f.buffers.length,2);assert.equal(f.preload.selection.reason,'cdn-fallback');
  f.buffers[1].finish();const selected=await ready;
  assert.match(selected.clips.journey.url,/\/1920\//);assert.equal(selected.selection.switches,1);f.preload.dispose();
});

test('failed HD CDN download retries bundled media once and failures cannot loop',async()=>{
  const f=fixture({failures:[true,true,true]}),ready=f.preload.load();
  await assert.rejects(ready,/Unavailable/);assert.equal(f.buffers.length,3);assert.equal(f.requests.length,1);
  assert.deepEqual(f.buffers[2].files.map(file=>file.url),['/local/opening.mp4','/local/journey.mp4']);
  assert.equal(f.preload.selection.reason,'local-fallback');assert.equal(f.intervals.size,0);f.preload.dispose();
});

test('manifest failure after a 4K transfer failure retains a bounded bundled fallback',async()=>{
  const f=fixture({failures:[true],loadMedia:async()=>{throw Error('Manifest unavailable')}}),ready=f.preload.load();await turn();
  assert.equal(f.buffers.length,2);assert.equal(f.preload.selection.reason,'local-fallback');
  f.buffers[1].finish();const selected=await ready;assert.equal(selected.manifest.width,1920);assert.equal(selected.clips.journey.url,'/local/journey.mp4');f.preload.dispose();
});

test('disposal during measurement clears timers and never starts the HD retry',async()=>{
  const f=fixture(),ready=f.preload.load();f.tick(500,100000);f.preload.dispose();
  await assert.rejects(ready,{name:'AbortError'});assert.equal(f.requests.length,0);assert.equal(f.buffers.length,1);assert.equal(f.intervals.size,0);
});

test('disposal during fallback manifest loading cannot allocate a replacement buffer',async()=>{
  let finish;const f=fixture({failures:[true],loadMedia:()=>new Promise(resolve=>{finish=resolve})}),ready=f.preload.load();await turn();
  assert.equal(f.requests.length,1);f.preload.dispose();assert.equal(f.requests[0].signal.aborted,true);finish(media(1920));
  await assert.rejects(ready,{name:'AbortError'});assert.equal(f.buffers.length,1);assert.equal(f.intervals.size,0);
});
