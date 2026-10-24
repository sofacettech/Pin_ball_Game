import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createWorkerFrameDecoder} from '../assets/worker-frame-decoder.js';

const config={codec:'avc1.64002a',codedWidth:1920,codedHeight:1080,colorSpace:{primaries:'bt709',transfer:'bt709',matrix:'bt709',fullRange:false}};
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve()};
const frame=(timestamp,overrides={})=>({timestamp,displayWidth:1920,displayHeight:1080,colorSpace:{...config.colorSpace},closed:0,close(){this.closed++},...overrides});
function fakeWorker({ready=true,unsupported=false}={}){
 return class extends EventTarget {
  static instances=[];
  messages=[];terminated=false;
  constructor(url,options){super();this.url=url;this.options=options;this.constructor.instances.push(this)}
  postMessage(data,transfer=[]){
   this.messages.push(structuredClone(data,{transfer}));
   if(data.type==='init'&&ready)queueMicrotask(()=>this.emit(unsupported?{type:'unsupported',name:'NotSupportedError',message:'Unsupported codec'}:{type:'ready',stats:{workerHardwarePreference:'prefer-hardware'}}));
  }
  emit(data){this.dispatchEvent(new MessageEvent('message',{data}))}
  terminate(){this.terminated=true}
 };
}
async function fixture(t,options={}){
 const WorkerClass=fakeWorker(options),decoder=await createWorkerFrameDecoder(config,{WorkerClass,...options});
 t.after(()=>decoder.destroy());return{decoder,worker:WorkerClass.instances[0]};
}
function complete(worker,request,overrides={}){
 const image=frame(request.timestamp,overrides);worker.emit({type:'frame',id:request.id,frame:request.frame,image});return image;
}

test('out-of-order and duplicate source-frame requests route by unique IDs without detaching cached samples',async t=>{
 const {decoder,worker}=await fixture(t),sample=new Uint8Array([1,2,3,4]);
 const pending=[5,5,2,20].map(index=>decoder.decode(index,sample.subarray(1,3)));
 const requests=worker.messages.filter(row=>row.type==='decode');
 assert.equal(requests.length,4);assert.equal(new Set(requests.map(row=>row.timestamp)).size,4);
 assert.deepEqual([...sample],[1,2,3,4]);assert.deepEqual([...new Uint8Array(requests[0].bytes)],[2,3]);
 assert.equal(worker.options.type,'module');assert.ok(worker.url.pathname.endsWith('/assets/frame-decoder-worker.js'));
 const images=[];for(const i of [2,0,3,1])images[i]=complete(worker,requests[i]);
 assert.deepEqual(await Promise.all(pending),images);assert.equal(decoder.stats.workerPending,0);assert.equal(decoder.stats.workerPeakPending,4);
 const duplicate=complete(worker,requests[0]);assert.equal(duplicate.closed,1);assert.equal(images[0].closed,0,'Accepted images belong to the caller');
 images.forEach(image=>image.close());
});

test('queue bounds include cancelled work until the worker acknowledges release',async t=>{
 const {decoder,worker}=await fixture(t,{maxPending:1}),controller=new AbortController();let settled=false;
 const pending=decoder.decode(5,new Uint8Array([1]),controller.signal).finally(()=>{settled=true});
 const rejected=assert.rejects(pending,{name:'AbortError'});controller.abort();await flush();
 assert.equal(settled,false,'The caller must retain decode capacity until worker release');assert.equal(decoder.stats.workerPending,1);
 await assert.rejects(decoder.decode(6,new Uint8Array([1])),{name:'QuotaExceededError'});
 const request=worker.messages.find(row=>row.type==='decode');worker.emit({type:'released',id:request.id});await rejected;
 assert.equal(decoder.stats.workerPending,0);
 const replacement=decoder.decode(6,new Uint8Array([1]));const last=worker.messages.at(-1);complete(worker,last);(await replacement).close();
 const stale=complete(worker,request);assert.equal(stale.closed,1);
});

test('a cancelled output closes its transferred frame before releasing queue credit',async t=>{
 const {decoder,worker}=await fixture(t),controller=new AbortController(),pending=decoder.decode(5,new Uint8Array([1]),controller.signal);
 const rejected=assert.rejects(pending,{name:'AbortError'});controller.abort();
 const stale=complete(worker,worker.messages.find(row=>row.type==='decode'));await rejected;
 assert.equal(stale.closed,1);assert.equal(decoder.stats.workerPending,0);
 const aborted=new AbortController();aborted.abort();await assert.rejects(decoder.decode(6,new Uint8Array([1]),aborted.signal),{name:'AbortError'});
});

test('suspension resets pending jobs and destruction rejects later work and closes late frames',async t=>{
 const {decoder,worker}=await fixture(t),pending=decoder.decode(5,new Uint8Array([1]));
 const first=worker.messages.at(-1),rejected=assert.rejects(pending,{name:'AbortError'});decoder.suspend();await flush();
 assert.equal(decoder.stats.workerPending,1,'Suspended resources stay reserved until acknowledgment');
 assert.equal(worker.messages.at(-1).type,'reset');assert.equal(complete(worker,first).closed,1);await rejected;
 const resumed=decoder.decode(5,new Uint8Array([1])),second=worker.messages.at(-1);assert.notEqual(first.timestamp,second.timestamp);complete(worker,second);(await resumed).close();
 const disposed=decoder.decode(6,new Uint8Array([1])),last=worker.messages.at(-1),cancelled=assert.rejects(disposed,{name:'AbortError'});decoder.destroy();await cancelled;
 assert.equal(worker.terminated,true);assert.equal(complete(worker,last).closed,1);await assert.rejects(decoder.decode(7,new Uint8Array([1])),{name:'AbortError'});
});

test('unsupported or stalled startup terminates the worker with a bounded rejection',async t=>{
 const Unsupported=fakeWorker({unsupported:true});await assert.rejects(createWorkerFrameDecoder(config,{WorkerClass:Unsupported}),{name:'NotSupportedError'});assert.equal(Unsupported.instances[0].terminated,true);
 t.mock.timers.enable({apis:['setTimeout']});const Silent=fakeWorker({ready:false});
 const pending=createWorkerFrameDecoder(config,{WorkerClass:Silent,startupTimeout:20}),rejected=assert.rejects(pending,{name:'TimeoutError'});
 t.mock.timers.tick(20);await rejected;assert.equal(Silent.instances[0].terminated,true);
 await assert.rejects(createWorkerFrameDecoder(config,{WorkerClass:null}),{name:'NotSupportedError'});
});

test('decode timeout rejects the complete queue and closes late outputs',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const {decoder,worker}=await fixture(t,{decodeTimeout:20});
 const jobs=[decoder.decode(5,new Uint8Array([1])),decoder.decode(6,new Uint8Array([1]))];
 const rejected=jobs.map(job=>assert.rejects(job,{name:'TimeoutError'}));t.mock.timers.tick(20);await Promise.all(rejected);
 assert.equal(worker.terminated,true);assert.equal(decoder.stats.workerPending,0);assert.equal(decoder.stats.workerTimeouts,1);
 assert.equal(complete(worker,worker.messages.find(row=>row.type==='decode')).closed,1);
});

for(const bad of [{colorSpace:{...config.colorSpace,matrix:'bt601'}},{displayWidth:1280},{timestamp:-1}]){
 test('invalid worker pixels reject pending work: '+Object.keys(bad)[0],async t=>{
  const {decoder,worker}=await fixture(t),pending=decoder.decode(5,new Uint8Array([1])),rejected=assert.rejects(pending,{name:'EncodingError'});
  const image=complete(worker,worker.messages.at(-1),bad);await rejected;assert.equal(image.closed,1);assert.equal(worker.terminated,true);
 });
}

const workerSource=await readFile(new URL('../assets/frame-decoder-worker.js',import.meta.url),'utf8');
async function workerFixture({buffered=false,hardware=true,unsupported=false}={}){
 const messages=[],timers=new Map(),decoders=[],probes=[];let listener,timerId=0;
 class Decoder {
  static async isConfigSupported(value){probes.push(value);return{supported:!unsupported&&(hardware||value.hardwareAcceleration!=='prefer-hardware')}}
  state='unconfigured';chunks=[];flushes=0;
  constructor(callbacks){this.callbacks=callbacks;decoders.push(this)}
  configure(value){this.config=value;this.state='configured'}
  decode(chunk){this.chunks.push(chunk);if(!buffered)this.emit(chunk.timestamp)}
  emit(timestamp,overrides={}){const image=frame(timestamp,overrides);this.callbacks.output(image);return image}
  async flush(){this.flushes++;for(const chunk of this.chunks.splice(0))this.emit(chunk.timestamp)}
  close(){this.state='closed'}
 }
 const self={addEventListener(type,fn){assert.equal(type,'message');listener=fn},postMessage(data,transfer=[]){messages.push({...data,stats:data.stats?{...data.stats}:undefined,transfer})}};
 vm.runInNewContext(workerSource,{self,VideoDecoder:Decoder,EncodedVideoChunk:class{constructor(init){Object.assign(this,init)}},DOMException,setTimeout(fn,delay){timers.set(++timerId,{fn,delay});return timerId},clearTimeout(id){timers.delete(id)}});
 const send=data=>listener({data});
 send({type:'init',config,fps:60,maxPending:4});await flush();
 return{send,messages,timers,decoders,probes,runTimer:async()=>{const [id,timer]=timers.entries().next().value;timers.delete(id);timer.fn();await flush()}};
}
const request=(id,sourceFrame=id)=>({type:'decode',id,frame:sourceFrame,timestamp:id*16667,duration:16667,bytes:new Uint8Array([1]).buffer});

test('worker immediate output transfers VideoFrames directly with no per-frame flush',async()=>{
 const f=await workerFixture();for(let i=1;i<=4;i++)f.send(request(i));
 const outputs=f.messages.filter(row=>row.type==='frame');assert.equal(outputs.length,4);assert.equal(f.decoders[0].flushes,0);assert.equal(f.timers.size,0);
 for(const row of outputs){assert.equal(row.transfer[0],row.image);assert.equal(row.image.closed,0);row.image.close()}
 assert.equal(f.probes[0].hardwareAcceleration,'prefer-hardware');
});

test('worker drains buffered batches once and routes out-of-order timestamps',async()=>{
 const f=await workerFixture({buffered:true});for(let i=1;i<=4;i++)f.send(request(i,5));
 assert.equal(f.timers.size,1);assert.equal([...f.timers.values()][0].delay,0);
 f.decoders[0].chunks.reverse();await f.runTimer();
 assert.deepEqual(f.messages.filter(row=>row.type==='frame').map(row=>row.id),[4,3,2,1]);assert.equal(f.decoders[0].flushes,1);assert.equal(f.timers.size,0);
 f.send(request(5));assert.equal([...f.timers.values()][0].delay,8);await f.runTimer();assert.equal(f.decoders[0].flushes,2);
});

test('worker cancellation releases resources and rejects stale generations after reset',async()=>{
 const f=await workerFixture({buffered:true});f.send(request(1));f.send(request(2));f.send({type:'cancel',id:1});
 const stale=f.decoders[0].emit(16667);assert.equal(stale.closed,1);assert.ok(f.messages.some(row=>row.type==='released'&&row.id===1));
 const old=f.decoders[0];f.send({type:'cancel',id:2});assert.equal(old.state,'closed');assert.equal(f.decoders.length,2);assert.equal(f.timers.size,0);
 assert.equal(old.emit(33334).closed,1);
 f.send(request(3));await f.runTimer();assert.ok(f.messages.some(row=>row.type==='frame'&&row.id===3));
});

test('worker rejects unsupported configurations and falls back from a hardware preference',async()=>{
 const fallback=await workerFixture({hardware:false});assert.equal(fallback.probes.length,2);assert.equal(fallback.messages.find(row=>row.type==='ready').stats.workerHardwarePreference,'no-preference');
 const unsupported=await workerFixture({unsupported:true});assert.equal(unsupported.decoders.length,0);assert.equal(unsupported.messages[0].type,'unsupported');
});

test('worker closes dimension mismatches and detects a decoder that omits flushed outputs',async()=>{
 const bad=await workerFixture({buffered:true});bad.send(request(1));const image=bad.decoders[0].emit(16667,{displayHeight:720});assert.equal(image.closed,1);assert.ok(bad.messages.some(row=>row.type==='fatal'));
 const missing=await workerFixture({buffered:true});missing.decoders[0].flush=async()=>{};missing.send(request(1));await missing.runTimer();assert.ok(missing.messages.some(row=>row.type==='fatal'&&row.message.includes('omitted')));
});


test('quick suspend and resume retain all queue slots until reset releases them',async t=>{
 const {decoder,worker}=await fixture(t),jobs=[1,2,3,4].map(id=>decoder.decode(id,new Uint8Array([1])));
 const rejected=jobs.map(job=>assert.rejects(job,{name:'AbortError'})),requests=worker.messages.filter(row=>row.type==='decode');
 decoder.suspend();await flush();assert.equal(decoder.stats.workerPending,4);
 await assert.rejects(decoder.decode(5,new Uint8Array([1])),{name:'QuotaExceededError'});
 worker.emit({type:'released',id:requests[0].id});await rejected[0];
 const resumed=decoder.decode(5,new Uint8Array([1])),replacement=worker.messages.at(-1);
 for(const request of requests.slice(1))worker.emit({type:'released',id:request.id});
 await Promise.all(rejected);complete(worker,replacement);(await resumed).close();assert.equal(decoder.stats.workerPending,0);
});
