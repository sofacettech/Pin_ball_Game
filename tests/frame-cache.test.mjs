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
test('the development overlay never touches production or normal-page DOM',()=>{
 const old=globalThis.location;
 try{for(const location of [{hostname:'sofacet.example',search:'?perf'},{hostname:'127.0.0.1',search:''}]){globalThis.location=location;assert.equal(typeof createPerformanceOverlay(),'function')}}finally{if(old===undefined)delete globalThis.location;else globalThis.location=old}
});
test('disposing during decode closes its late resource',async()=>{
 let resolve,closed=0;const source={mode:'webcodecs',stats:{},load:async()=>new Uint8Array(1),decode:()=>new Promise(r=>resolve=r),fallback:()=>false,destroy(){}};
 const cache=createFrameCache({count:2,source,onReady(){assert.fail('Disposed cache notified')},onError(){},config:{network:1}});
 await until(()=>resolve);cache.destroy();resolve({close(){closed++}});await wait(10);assert.equal(closed,1);assert.equal(cache.stats.decoded,0);
});
test('native video frames are never reused after their source seeks elsewhere',async()=>{
 const source={mode:'video',stats:{},load:async()=>null,decode:async frame=>{await wait(8);return{frame,transient:true,close(){}}},fallback:()=>false,destroy(){}};
 const cache=createFrameCache({count:100,source,onReady(){},onError:error=>{throw error}});
 try{cache.request(10);await until(()=>cache.get(10));cache.request(20);assert.equal(cache.get(10),undefined);cache.request(30);await until(()=>cache.get(30));assert.equal(cache.get(20),undefined);assert.equal(cache.get(30).frame,30)}finally{cache.destroy()}
});
test('a byte-limited prefetch window settles instead of refetching its evictions',async()=>{
 let loads=0;const source={mode:'webcodecs',stats:{},load:async()=>{loads++;return new Uint8Array(100000)},decode:async()=>({close(){}}),fallback:()=>false,destroy(){}};
 const cache=createFrameCache({count:100,source,onReady(){},onError:error=>{throw error},config:{compressedBytes:600000,idleMs:5}});
 try{await wait(50);const settled=loads;await wait(50);assert.equal(loads,settled);assert.ok(cache.stats.compressedBytes<=600000)}finally{cache.destroy()}
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
