import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFrameCache} from '../assets/frame-cache.js';
import {createPerformanceOverlay} from '../assets/performance-overlay.js';

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){for(let i=0;i<100;i++){if(check())return;await wait(5)}assert.fail('Cache did not settle')}
function fixture(){
 let active=0,peak=0,alive=0;const loads=[],closed=[];
 const source={mode:'webcodecs',stats:{},fallback:()=>false,destroy(){},
  async load(frame,signal){loads.push(frame);peak=Math.max(peak,++active);try{await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,3);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('cancelled','AbortError'))},{once:true})});return new Uint8Array(100)}finally{active--}},
  async decode(frame){await wait(2);alive++;return{frame,close(){alive--;closed.push(frame)}}}};
 return{source,loads,closed,get alive(){return alive},get peak(){return peak}};
}
test('desktop loader waits for six seconds including the last opening sample',async()=>{
 let release;
 const gate=new Promise(resolve=>{release=resolve});
 const source={mode:'webcodecs',stats:{},frameBytes:()=>100,
  async loadFrames(frames,_signal,_budget,onFrame){
   const samples=new Map();
   for(const frame of frames){
    if(frame===359)await gate;
    const data=new Uint8Array(100);samples.set(frame,data);onFrame(frame,data);
   }
   return samples;
  },
  async decode(frame){return{frame,close(){}}},fallback:()=>false,destroy(){}};
 const cache=createFrameCache({count:2000,source,onReady(){},onError:error=>{throw error}});
 try{
  await until(()=>cache.get(0)&&cache.stats.compressed>=480);
  assert.equal(cache.preparation.ready,false,'A missing sample inside the opening six seconds must keep the loader visible');
  assert.equal(cache.preparation.progress,359/360);
  release();await until(()=>cache.preparation.ready&&cache.stats.pending===0);
  assert.equal(cache.stats.compressed,512);
  assert.ok(cache.stats.decoded<=8);
 }finally{release();cache.destroy()}
});
test('desktop retains a three-second scroll reversal without reloading its frames',async()=>{
 const loads=new Map();
 const source={mode:'webcodecs',stats:{},frameBytes:()=>100,
  async loadFrames(frames){return new Map(frames.map(frame=>{loads.set(frame,(loads.get(frame)||0)+1);return[frame,new Uint8Array(100)]}))},
  async decode(frame){return{frame,close(){}}},fallback:()=>false,destroy(){}};
 const cache=createFrameCache({count:2000,source,onReady(){},onError:error=>{throw error},config:{idleMs:1}});
 try{
  await until(()=>cache.preparation.ready&&cache.stats.pending===0);
  for(const frame of [200,260,320,380,320,260,200]){
   cache.request(frame);await until(()=>cache.get(frame)&&cache.stats.pending===0);
   assert.ok(cache.stats.compressed<=512);
   assert.ok(cache.stats.compressedBytes+cache.stats.reservedBytes<=48*1024*1024);
   assert.ok(cache.stats.decoded<=8);
  }
  for(let frame=200;frame<=380;frame++)assert.equal(loads.get(frame),1,`Frame ${frame} was downloaded again on reversal`);
  assert.ok(cache.stats.peakNetwork<=3);
 }finally{cache.destroy()}
});
test('a cold reverse target does not wait for the tail of an ascending byte range',async()=>{
 const batches=[];
 const source={mode:'webcodecs',stats:{},frameBytes:()=>100,
  async loadFrames(frames){batches.push([...frames]);return new Map(frames.map(frame=>[frame,new Uint8Array(100)]))},
  async decode(frame){return{frame,close(){}}},fallback:()=>false,destroy(){}};
 const cache=createFrameCache({count:2000,source,onReady(){},onError:error=>{throw error},config:{idleMs:1}});
 try{
  await until(()=>cache.stats.pending===0);
  cache.request(800);await until(()=>cache.get(800)&&cache.stats.pending===0);
  batches.length=0;
  cache.request(100,100,800);await until(()=>cache.get(100));
  assert.deepEqual(batches[0],[100]);
  assert.ok(batches.some(frames=>frames.length===32),'Background lookahead should still use efficient ranges');
 }finally{cache.destroy()}
});
test('preparation waits for a contiguous byte-bounded opening buffer and a decoded first frame',async()=>{
 const pending=new Map();let resolveDecode;
 const source={mode:'webcodecs',stats:{},frameBytes:()=>100,
  load:frame=>new Promise(resolve=>pending.set(frame,resolve)),
  decode:()=>new Promise(resolve=>{resolveDecode=resolve}),fallback:()=>false,destroy(){}};
 const cache=createFrameCache({count:100,source,onReady(){},onError(){},config:{network:8,compressedBytes:800,prefetch:8,ahead:7,decoded:2}});
 try{
  for(let frame=0;frame<6;frame++)pending.get(frame)(new Uint8Array(100));
  await until(()=>resolveDecode);
  assert.equal(cache.preparation.ready,false,'Downloaded bytes alone are insufficient');
  resolveDecode({close(){}});
  await until(()=>cache.preparation.ready);
  assert.equal(cache.preparation.progress,1);
  assert.ok(cache.stats.compressedBytes+cache.stats.reservedBytes<=800);
 }finally{cache.destroy()}
});
test('the final scene does not refill unused lookahead slots with discarded history',async()=>{
 const batches=[];
 const source={mode:'webcodecs',stats:{},frameBytes:()=>100,
  async loadFrames(frames){batches.push([...frames]);return new Map(frames.map(frame=>[frame,new Uint8Array(100)]))},
  async decode(frame){return{frame,close(){}}},fallback:()=>false,destroy(){}};
 const cache=createFrameCache({count:1925,source,onReady(){},onError:error=>{throw error},config:{idleMs:1}});
 try{
  await until(()=>cache.stats.pending===0);
  batches.length=0;cache.request(1800);
  await until(()=>cache.get(1800)&&cache.stats.pending===0&&cache.stats.queued===0);
  assert.ok(batches.flat().every(frame=>frame>=1800-224),'Spare slots must not pull old frames back across the network');
  assert.ok(batches.length<=14,`History must use grouped ranges, not ${batches.length} tiny requests`);
  assert.ok(cache.stats.compressed<=349);
  batches.length=0;cache.request(1924);
  await until(()=>cache.get(1924)&&cache.stats.pending===0);
  assert.equal(batches.length,0,'The already-buffered ending must not trigger history backfill');
  assert.ok(cache.stats.compressed<=225);
 }finally{cache.destroy()}
});
test('a distant swipe destination waits behind the immediate playback ranges',async()=>{
 const batches=[],jobs=[];
 const source={mode:'webcodecs',stats:{},frameBytes:()=>100,
  loadFrames(frames,signal){batches.push([...frames]);return new Promise((resolve,reject)=>{
   jobs.push(()=>resolve(new Map(frames.map(frame=>[frame,new Uint8Array(100)]))));
   signal.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true});
  })},
  async decode(frame){return{frame,close(){}}},fallback:()=>false,destroy(){}};
 const cache=createFrameCache({count:1925,source,onReady(){},onError:error=>{throw error}});
 try{
  cache.request(1000,1800,1000);
  await until(()=>batches.some(frames=>frames.includes(1000)));
  const afterJump=batches.filter(frames=>frames[0]>=1000);
  assert.deepEqual(afterJump.slice(0,3).map(frames=>frames[0]),[1000,1032,1064]);
  assert.ok(!afterJump.flat().includes(1800),'A distant destination must not occupy a slot needed for the next visible frames');
 }finally{cache.destroy();jobs.forEach(resolve=>resolve())}
});
test('native preparation requires decoded pixels and a contiguous playable opening buffer',async()=>{
 let bufferedSeconds=0;
 const source={mode:'video',transient:true,get stats(){return{bufferedSeconds}},
  async decode(){return{transient:true,close(){}}},fallback:()=>false,destroy(){}};
 const cache=createFrameCache({count:100,source,onReady(){},onError(){}});
 try{
  await until(()=>cache.get(0));
  assert.equal(cache.preparation.ready,false);
  bufferedSeconds=1.5;assert.equal(cache.preparation.progress,.5);
  bufferedSeconds=3;assert.equal(cache.preparation.ready,true);
  cache.suspend();assert.equal(cache.preparation.ready,false);
 }finally{cache.destroy()}
});
test('Safari can release preparation when it reports enough data but limits paused prefetch',async()=>{
 let enough=false,finish;
 const source={mode:'video',transient:true,get stats(){return{bufferedSeconds:.767,canPlayThrough:enough}},
  decode:()=>new Promise(resolve=>{finish=resolve}),fallback:()=>false,destroy(){}};
 const cache=createFrameCache({count:100,source,onReady(){},onError(){}});
 try{
  enough=true;assert.equal(cache.preparation.ready,false,'Native readiness alone must not replace decoded pixels');
  finish({transient:true,close(){}});await until(()=>cache.get(0));
  assert.equal(cache.preparation.ready,true);
  enough=false;assert.equal(cache.preparation.ready,false,'A merely partial buffer must still wait');
 }finally{cache.destroy()}
});
test('cache reverses, bounds resources, and only makes the latest target ready',async()=>{
 const f=fixture(),ready=[],cache=createFrameCache({count:2000,source:f.source,onReady:()=>ready.push(cache.stats.target),onError:error=>{throw error},config:{decoded:4,network:2,compressedBytes:1200,prefetch:12,ahead:7,behind:4,idleMs:5}});
 try{
  cache.request(100);cache.request(1800);cache.request(50);
  await until(()=>cache.get(50));assert.equal(cache.get(50).frame,50);assert.ok(!ready.includes(1800));
  await wait(50);assert.ok(cache.stats.decoded<=4);assert.ok(cache.stats.compressed<=12);assert.ok(cache.stats.compressedBytes<=1200);assert.ok(f.peak<=2);
  cache.request(49);await until(()=>cache.get(49));assert.equal(cache.stats.direction,-1);
  const before=f.loads.filter(n=>n===50).length;cache.request(50);await until(()=>cache.get(50));assert.equal(f.loads.filter(n=>n===50).length,before);
  cache.suspend();const count=f.loads.length;await wait(20);assert.equal(f.loads.length,count);cache.resume();
  assert.throws(()=>cache.request(-1),RangeError);assert.throws(()=>cache.request(2000),RangeError);
  assert.throws(()=>createFrameCache({count:2,source:f.source,config:{network:0}}),RangeError);
 }finally{cache.destroy();await wait(10)}
 assert.equal(f.alive,0);assert.ok(f.closed.length>0);
});
test('the opt-in overlay never touches normal-page DOM on production or localhost',()=>{
 const old=globalThis.location;
 try{for(const location of [{hostname:'sofacet.example',search:''},{hostname:'127.0.0.1',search:''}]){globalThis.location=location;assert.equal(typeof createPerformanceOverlay(),'function')}}finally{if(old===undefined)delete globalThis.location;else globalThis.location=old}
});
test('disposing during decode closes its late resource',async()=>{
 let resolve,closed=0;const source={mode:'webcodecs',stats:{},load:async()=>new Uint8Array(1),decode:()=>new Promise(r=>resolve=r),fallback:()=>false,destroy(){}};
 const cache=createFrameCache({count:2,source,onReady(){assert.fail('Disposed cache notified')},onError(){},config:{network:1}});
 await until(()=>resolve);cache.destroy();resolve({close(){closed++}});await wait(10);assert.equal(closed,1);assert.equal(cache.stats.decoded,0);
});
test('native snapshots buffer in travel order, reuse reversals and settle within the memory limit',async()=>{
 let alive=0,total=0,peak=0;
 const source={mode:'video',stats:{},frameBytes:()=>0,load:async()=>null,decode:async frame=>{
  await wait(2);total++;peak=Math.max(peak,++alive);return{frame,close(){alive--}};
 },fallback:()=>false,destroy(){}};
 const cache=createFrameCache({count:100,source,onReady(){},onError:error=>{throw error},config:{decoded:4,idleMs:5}});
 try{
  cache.request(10);await until(()=>cache.get(10)&&cache.get(11)&&cache.get(12)&&cache.stats.pending===0);
  const retained=cache.get(10),settled=total;await wait(30);assert.equal(total,settled);
  cache.request(11);assert.equal(cache.get(11).frame,11);
  cache.request(10);assert.equal(cache.get(10),retained);
  await until(()=>cache.get(9)&&cache.get(8)&&cache.stats.pending===0);
  assert.equal(cache.stats.direction,-1);assert.ok(peak<=5,'At most four retained frames and one in-flight snapshot');
  cache.suspend();assert.equal(alive,0);cache.resume();await until(()=>cache.get(10));
 }finally{cache.destroy();await wait(10)}
 assert.equal(alive,0);
});
test('native seeking starts the latest target without waiting behind synthetic downloads',async()=>{
 const calls=[];
 const source={mode:'video',stats:{},load(){assert.fail('Native video has no per-frame download')},
  async decode(frame){calls.push(frame);return{frame,close(){}}},fallback:()=>false,destroy(){}};
 const cache=createFrameCache({count:100,source,onReady(){},onError:error=>{throw error},config:{decoded:4}});
 try{
  await until(()=>cache.stats.pending===0);
  cache.request(50,50,0);assert.equal(calls.at(-1),50);
  await until(()=>cache.stats.pending===0);
  cache.request(60,60,50);assert.equal(calls.at(-1),60);
  assert.equal(cache.stats.peakNetwork,0);
 }finally{cache.destroy();await wait(10)}
});
test('direct native video never pre-seeks a future frame or reuses a mutable old position',async()=>{
 const frames=[];
 const source={mode:'video',transient:true,stats:{},async decode(frame){frames.push(frame);return{frame,transient:true,close(){}}},fallback:()=>false,destroy(){}};
 const cache=createFrameCache({count:100,source,onReady(){},onError:error=>{throw error}});
 try{
  await until(()=>cache.get(0));await wait(20);assert.deepEqual(frames,[0]);
  cache.request(20);assert.equal(cache.get(0),undefined);await until(()=>cache.get(20));
  await wait(20);assert.deepEqual(frames,[0,20]);
  cache.request(5);assert.equal(cache.get(20),undefined);await until(()=>cache.get(5));
 }finally{cache.destroy()}
});
test('a byte-limited prefetch window settles instead of refetching its evictions',async()=>{
 let loads=0;const source={mode:'webcodecs',stats:{},load:async()=>{loads++;return new Uint8Array(100000)},decode:async()=>({close(){}}),fallback:()=>false,destroy(){}};
 const cache=createFrameCache({count:100,source,onReady(){},onError:error=>{throw error},config:{compressedBytes:600000,idleMs:5}});
 try{await wait(50);const settled=loads;await wait(50);assert.equal(loads,settled);assert.ok(cache.stats.compressedBytes<=600000)}finally{cache.destroy()}
});

test('native motion confirms pixels only at the destination and rechecks an unconfirmed cached frame',async()=>{
 const calls=[],destinations=[];let current=true;
 const source={mode:'video',transient:true,presentedFrame:null,stats:{},retarget(...args){destinations.push(args)},async decode(frame,_bytes,settled){calls.push([frame,settled]);this.presentedFrame=settled?frame:null;return{frame,transient:true,close(){}}},fallback:()=>false,destroy(){}};
 const cache=createFrameCache({count:100,source,canConfirm:()=>current,onReady(){},onError:error=>{throw error}});
 try{
  await until(()=>cache.get(0));assert.deepEqual(calls.at(-1),[0,false],'The hidden preparation video must not wait for a compositor callback');
  cache.request(0,0,0);await wait(20);assert.equal(calls.length,1,'Keep the decoded preparation frame without a confirmation loop');
  cache.request(20,40,0);assert.deepEqual(destinations.at(-1),[20,0,40],'Forward the true scroll destination while the pacer catches up');await until(()=>cache.get(20));assert.deepEqual(calls.at(-1),[20,false]);
  current=false;cache.request(20,20,20);assert.equal(cache.settled,false);
  await wait(150);assert.equal(source.presentedFrame,null,'Do not capture while the actual scroll destination is newer than the frame queue');current=true;
  await until(()=>source.presentedFrame===20);assert.deepEqual(calls.at(-1),[20,true]);assert.equal(cache.settled,true);
  await until(()=>cache.stats.pending===0);const count=calls.length;
  cache.request(20,20,20);await wait(20);assert.equal(calls.length,count,'A confirmed stationary frame must not loop');
 }finally{cache.destroy()}
});
test('a transient download retries even after the last scroll replaces its timer',async()=>{
 let online=false;
 const source={mode:'webcodecs',stats:{},load:async()=>{if(!online)throw new TypeError('Offline');return new Uint8Array(1)},decode:async()=>({close(){}}),fallback(){assert.fail('Network failure discarded the decoder')},destroy(){}};
 const cache=createFrameCache({count:5,source,onReady(){},onError(){},config:{idleMs:5,network:1}});
 try{await wait(10);cache.request(2);await wait(20);online=true;await wait(1050);await until(()=>cache.get(2))}finally{cache.destroy()}
});
test('decoder failure releases accelerated images and resumes at the latest frame',async()=>{
 let fast=true,closed=0;
 const source={get mode(){return fast?'webcodecs':'video'},stats:{},load:async()=>new Uint8Array(1),decode:async frame=>{if(fast&&frame===20)throw Error('Corrupt sample');return{frame,close(){closed++}}},fallback(){if(!fast)return false;fast=false;return true},destroy(){}};
 const cache=createFrameCache({count:50,source,onReady(){},onError(){assert.fail('Native fallback failed')},config:{idleMs:5,network:1}});
 try{await until(()=>cache.get(0));cache.request(20);await until(()=>cache.get(20));assert.equal(fast,false);assert.ok(closed>0);assert.equal(cache.get(0),undefined);assert.equal(cache.get(20).frame,20)}finally{cache.destroy()}
});
test('the decoded window stops work at a stationary middle frame',async()=>{
 let decodes=0;
 const source={mode:'webcodecs',stats:{},load:async()=>new Uint8Array(100),decode:async()=>{decodes++;await wait(1);return{close(){}}},fallback:()=>false,destroy(){}};
 const cache=createFrameCache({count:100,source,onReady(){},onError:error=>{throw error},config:{decoded:4,idleMs:5,network:2}});
 try{cache.request(50);await wait(50);const settled=decodes;await wait(50);assert.equal(decodes,settled);assert.equal(cache.stats.decoded,4);assert.equal(cache.stats.pending,0)}finally{cache.destroy()}
});
test('lookahead downloads and decodes before scrolling becomes idle',async()=>{
 const f=fixture(),cache=createFrameCache({count:100,source:f.source,onReady(){},onError:error=>{throw error},config:{idleMs:60000}});
 try{
  cache.request(40,45);
  await until(()=>cache.get(41)&&cache.get(42));
  assert.equal(cache.closest(42,40),42);
  assert.equal(cache.closest(40,42),40);
  assert.equal(cache.closest(10,0),undefined);
  cache.request(42,35);
  await until(()=>cache.get(41)&&cache.get(40));
  assert.equal(cache.stats.direction,-1);
 }finally{cache.destroy()}
});
test('adjacent frames share bounded requests and release every decoded resource',async()=>{
 const batches=[];let alive=0;
 const source={mode:'webcodecs',stats:{},frameBytes:()=>100,
  async loadFrames(frames){batches.push([...frames]);await wait(3);return new Map(frames.map(frame=>[frame,new Uint8Array(100)]))},
  async decode(frame){alive++;return{frame,close(){alive--}}},
  fallback:()=>false,destroy(){}};
 const cache=createFrameCache({count:200,source,onReady(){},onError:error=>{throw error},config:{compressedBytes:2400,prefetch:24,decoded:4,network:2,batch:6,idleMs:5}});
 try{
  cache.request(40);
  await until(()=>cache.get(41)&&cache.stats.pending===0);
  assert.ok(batches.some(frames=>frames.length===6));
  assert.ok(batches.every(frames=>frames.length<=6&&frames.every((n,i)=>!i||Math.abs(n-frames[i-1])===1)));
  assert.ok(cache.stats.compressedBytes+cache.stats.reservedBytes<=2400);
  cache.request(39,30);
  await until(()=>cache.get(38));
  assert.equal(cache.stats.direction,-1);
  cache.suspend();const count=batches.length;await wait(20);assert.equal(batches.length,count);
  cache.resume();await until(()=>cache.stats.pending===0);
  assert.ok(cache.stats.peakNetwork<=2);
 }finally{cache.destroy();await wait(10)}
 assert.equal(alive,0);
});
test('a full small cache gives the next target priority over older nearby frames',async()=>{
 const source={mode:'webcodecs',stats:{},frameBytes:()=>100,
  load:async()=>new Uint8Array(100),decode:async frame=>({frame,close(){}}),fallback:()=>false,destroy(){}};
 const cache=createFrameCache({count:100,source,onReady(){},onError:error=>{throw error},config:{compressedBytes:400,decoded:2,network:1,idleMs:5}});
 try{
  await until(()=>cache.stats.pending===0&&cache.get(0));
  for(let frame=1;frame<=8;frame++){
   cache.request(frame);
   await until(()=>cache.get(frame));
   assert.ok(cache.stats.compressedBytes<=400);
  }
 }finally{cache.destroy()}
});
test('concurrent batch completions settle within a smaller mobile byte budget',async()=>{
 let loads=0;
 const source={mode:'webcodecs',stats:{},frameBytes:()=>130000,
  async loadFrames(frames){loads++;await wait(1);return new Map(frames.map(frame=>[frame,new Uint8Array(130000)]))},
  async decode(frame){await wait(1);return{frame,close(){}}},fallback:()=>false,destroy(){}};
 const cache=createFrameCache({count:200,source,onReady(){},onError:error=>{throw error},config:{compressedBytes:6*1024*1024,decoded:4,network:2,idleMs:5}});
 try{
  await until(()=>cache.get(0)&&cache.stats.pending===0);
  const settled=loads;await wait(30);
  assert.equal(loads,settled);
  assert.ok(loads<=8,`Unexpected repeated batch loads: ${loads}`);
  assert.ok(cache.stats.compressedBytes+cache.stats.reservedBytes<=6*1024*1024);
 }finally{cache.destroy()}
});
test('variable sample sizes do not repeatedly reload a small distant frame',async()=>{
 const sizes=[100,100,100,100,100,100,110,110,110,90];let loads=0;
 const source={mode:'webcodecs',stats:{},frameBytes:frame=>sizes[frame],
  async loadFrames(frames){loads++;await wait(1);return new Map(frames.map(frame=>[frame,new Uint8Array(sizes[frame])]))},
  async decode(frame){return{frame,close(){}}},fallback:()=>false,destroy(){}};
 const cache=createFrameCache({count:sizes.length,source,onReady(){},onError:error=>{throw error},config:{compressedBytes:700,prefetch:10,ahead:9,behind:0,decoded:2,network:2,batch:3,idleMs:5}});
 try{
  await wait(40);const settled=loads;await wait(30);
  assert.equal(loads,settled);assert.ok(loads<=3);
  assert.equal(cache.stats.pending,0);
  cache.request(6);await until(()=>cache.get(6));
 }finally{cache.destroy()}
});
test('a moving target retains slow downloads that can still advance the displayed frame',async()=>{
 const jobs=[];
 const source={mode:'webcodecs',stats:{},frameBytes:()=>100,
  loadFrames(frames,signal){if(frames[0]<40)return Promise.resolve(new Map(frames.map(frame=>[frame,new Uint8Array(100)])));return new Promise((resolve,reject)=>{
   jobs.push({frames,signal,resolve:()=>resolve(new Map(frames.map(frame=>[frame,new Uint8Array(100)])))});
   signal.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true});
  })},
  async decode(frame){return{frame,close(){}}},fallback:()=>false,destroy(){}};
 const cache=createFrameCache({count:300,source,onReady(){},onError:error=>{throw error},config:{network:1,decoded:4,prefetch:16,ahead:10,behind:4,batch:4,compressedBytes:1600}});
 try{
  cache.request(40,40,0);
  await until(()=>jobs.some(job=>job.frames.includes(40)));
  const slow=jobs.find(job=>job.frames.includes(40));
  // The target has travelled beyond the entire prefetch window before arrival.
  for(let target=50;target<=100;target+=10)cache.request(target,target,0);
  assert.equal(slow.signal.aborted,false);
  slow.resolve();
  await until(()=>cache.get(43));
  assert.equal(cache.closest(100,0),43);
  assert.ok(cache.stats.compressedBytes+cache.stats.reservedBytes<=1600);
  const forward=jobs.at(-1);
  cache.request(10,10,43);
  assert.equal(forward.signal.aborted,true);
  assert.equal(cache.closest(10,43),43);
 }finally{cache.destroy()}
});

test('progressive ranges make the target drawable before the whole batch completes',async()=>{
 let finish;
 const source={mode:'webcodecs',stats:{},frameBytes:()=>100,
  loadFrames(frames,signal,budget,onFrame){return new Promise(resolve=>{
   const samples=new Map(frames.map(frame=>[frame,new Uint8Array(100)]));
   finish=()=>resolve(samples);
   queueMicrotask(()=>onFrame?.(frames[0],samples.get(frames[0])));
  })},
  async decode(frame){return{frame,close(){}}},fallback:()=>false,destroy(){}};
 const cache=createFrameCache({count:4,source,onReady(){},onError:error=>{throw error},config:{network:1,batch:4,compressedBytes:400,prefetch:4,decoded:2}});
 try{
  await until(()=>finish);
  await until(()=>cache.get(0));
  assert.equal(cache.stats.network,1,'The remainder of the range is still downloading');
  assert.equal(cache.stats.compressedBytes+cache.stats.reservedBytes,400);
  finish();await until(()=>cache.stats.pending===0);
  assert.equal(cache.get(0).frame,0);
 }finally{cache.destroy();finish?.()}
});

test('blocked native confirmation waits for activation while scrolling stays available', async () => {
 const calls=[],errors=[];
 const image={transient:true,close(){}};
 const source={mode:'video',transient:true,presentedFrame:null,playbackBlocked:true,stats:{},frameBytes:()=>0,
  async decode(frame,_bytes,settled){calls.push({frame,settled});if(settled)source.presentedFrame=frame;return image},
  fallback:()=>false,destroy(){}};
 const cache=createFrameCache({count:100,source,onReady(){},onError:error=>errors.push(error),config:{idleMs:5}});
 try{
  await until(()=>cache.get(0));
  cache.request(20,20,0);await until(()=>errors.length===1);
  assert.equal(errors[0].name,'NotAllowedError');assert.equal(cache.settled,false);
  const attempts=calls.length;await wait(30);assert.equal(calls.length,attempts,'Permission denial must not spin the decoder');
  cache.request(25,40,20);await until(()=>cache.get(25));
  assert.equal(calls.at(-1).settled,false,'A blocked final capture must not prevent resumed scrolling');
  cache.request(40,40,25);await until(()=>errors.length===2);
  source.playbackBlocked=false;cache.retry();await until(()=>cache.settled&&cache.get(40));
  assert.equal(source.presentedFrame,40);assert.equal(cache.stats.lastError,null);
 }finally{cache.destroy()}
});

test('desktop worker lookahead bridges a delivery interruption without increasing decoded capacity',async t=>{
 const phone={network:2,batch:24,decoded:4,ahead:80,behind:40,prefetch:128,preparationFrames:57,compressedBytes:16*1024*1024};
 const desktop={decoded:4,preparationFrames:57};
 let now=0;t.mock.method(performance,'now',()=>now);
 const drain=async()=>{for(let i=0;i<24;i++)await Promise.resolve()};
 const results=[];
 // Shared delivery is 25 MiB/s: enough for 200 source frames/s, with varying
 // request latency and a 500ms interruption. This checks burst protection;
 // a larger buffer cannot fix sustained delivery below source consumption.
 for(const config of [phone,desktop]){
  t.mock.timers.enable({apis:['setTimeout']});now=0;
  const downloads=new Set();let cache,alive=0,pending=0,peakResources=0,paused=false;
  const frameBytes=frame=>(80+frame%17)*1024;
  const source={mode:'worker',decodeConcurrency:4,stats:{},frameBytes,fallback:()=>false,destroy(){},
   loadFrames(frames,signal,_budget,onFrame){return new Promise((resolve,reject)=>{
    const job={frames:[...frames].sort((a,b)=>a-b),at:now+30+(frames[0]%3)*20,cursor:0,bytes:0,result:new Map(),onFrame,resolve,signal};
    job.abort=()=>{downloads.delete(job);reject(new DOMException('Cancelled','AbortError'))};signal.addEventListener('abort',job.abort,{once:true});downloads.add(job);
   })},
   decode(frame){pending++;peakResources=Math.max(peakResources,alive+pending);return new Promise(resolve=>setTimeout(()=>{
    pending--;alive++;let closed=false;resolve({frame,close(){assert.equal(closed,false);closed=true;alive--}});
   },4))},
  };
  const bounds=()=>{
   const stats=cache.stats;
   assert.ok(stats.compressedBytes+stats.reservedBytes<=stats.settings.compressedBytes);
   assert.ok(stats.decoded+stats.decoding<=4);assert.ok(alive+pending<=4);
   assert.ok(stats.network<=stats.settings.network);
  };
  async function advance(ms){
   for(let elapsed=0;elapsed<ms;elapsed+=5){
    now+=5;t.mock.timers.tick(5);await drain();let budget=paused?0:128*1024;
    while(budget>0){
     const job=[...downloads].filter(job=>job.at<=now).sort((a,b)=>a.at-b.at)[0];if(!job)break;
     const frame=job.frames[job.cursor],remaining=frameBytes(frame)-job.bytes,amount=Math.min(remaining,budget);job.bytes+=amount;budget-=amount;
     if(job.bytes===frameBytes(frame)){
      const sample={byteLength:job.bytes};job.result.set(frame,sample);job.bytes=0;job.cursor++;job.onFrame(frame,sample);
      if(downloads.has(job)&&job.cursor===job.frames.length){downloads.delete(job);job.signal.removeEventListener('abort',job.abort);job.resolve(job.result)}
     }
     await drain();bounds();
    }
    await drain();bounds();
   }
  }
  cache=createFrameCache({count:1500,source,onReady(){},onError:error=>{throw error},config});
  try{
   for(let elapsed=0;elapsed<5000&&!cache.preparation.ready;elapsed+=5)await advance(5);
   assert.equal(cache.preparation.ready,true);
   assert.equal(cache.stats.settings.preparationFrames,57,'Desktop opening keeps the phone readiness requirement');
   await advance(2000); // Background delivery during the opening, not an additional readiness gate.
   let displayed=0,lastDraw=0,maxGap=0,misses=0;
   for(let elapsed=20;elapsed<=2500;elapsed+=20){
    paused=elapsed>1000&&elapsed<=1500;await advance(15);
    const desired=elapsed/5;cache.request(desired,desired,displayed);await advance(5);
    const available=cache.get(desired)?desired:cache.closest(desired,displayed);
    if(available!==undefined&&available>displayed){displayed=available;maxGap=Math.max(maxGap,elapsed-lastDraw);lastDraw=elapsed}else misses++;
    bounds();
   }
   paused=false;await advance(500);
   cache.request(500,500,displayed);await advance(100);assert.ok(cache.get(500),'The stationary destination recovers after delivery resumes');
   results.push({maxGap,misses,peakResources});
  }finally{cache.destroy();await advance(20);t.mock.timers.reset()}
  assert.equal(downloads.size,0);assert.equal(alive,0);assert.equal(pending,0);
 }
 assert.ok(results[0].maxGap>=100,'The small-window control must encounter the interruption');
 assert.ok(results[1].maxGap<results[0].maxGap/2,'Desktop lookahead must shorten the longest wait for an advancing frame');
 assert.ok(results[1].misses<results[0].misses,'Desktop lookahead must produce fewer unavailable-frame requests');
 assert.ok(results.every(result=>result.peakResources<=4),'Background lookahead must not expand the decoded window');
});
