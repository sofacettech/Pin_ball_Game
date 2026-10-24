import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createWorkerFrameDecoder} from '../assets/worker-frame-decoder.js';

const config={codec:'avc1.64002a',codedWidth:1920,codedHeight:1080,colorSpace:{primaries:'bt709',transfer:'bt709',matrix:'bt709',fullRange:false}};
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve()};
const bitmap=(overrides={})=>({width:1920,height:1080,closed:0,close(){this.closed++},...overrides});
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
 const {timestamp=request.timestamp,sourceColorSpace={...config.colorSpace},outputKind='bitmap',...imageOverrides}=overrides;
 const image=bitmap(imageOverrides);worker.emit({type:'frame',id:request.id,frame:request.frame,timestamp,sourceColorSpace,outputKind,image});return image;
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

for(const bad of [{sourceColorSpace:{...config.colorSpace,matrix:'bt601'}},{sourceColorSpace:null},{width:1280},{height:720},{timestamp:-1},{outputKind:'video-frame'}]){
 test('invalid worker pixels reject pending work: '+Object.keys(bad)[0],async t=>{
  const {decoder,worker}=await fixture(t),pending=decoder.decode(5,new Uint8Array([1])),rejected=assert.rejects(pending,{name:'EncodingError'});
  const image=complete(worker,worker.messages.at(-1),bad);await rejected;assert.equal(image.closed,1);assert.equal(worker.terminated,true);
 });
}

const workerSource=await readFile(new URL('../assets/frame-decoder-worker.js',import.meta.url),'utf8');
async function workerFixture({buffered=false,hardware=true,unsupported=false,surfaceLimit=Infinity,canvas=true,copyFailure,transferFailure=false}={}){
 const messages=[],timers=new Map(),decoders=[],probes=[],canvases=[],sourceFrames=[],bitmaps=[],events=[];let listener,timerId=0,clock=0;
 class Decoder {
  static async isConfigSupported(value){probes.push(value);return{supported:!unsupported&&(hardware||value.hardwareAcceleration!=='prefer-hardware')}}
  state='unconfigured';chunks=[];flushes=0;liveSurfaces=0;peakSurfaces=0;flushWaiters=[];draining=false;
  constructor(callbacks){this.callbacks=callbacks;decoders.push(this)}
  configure(value){this.config=value;this.state='configured'}
  decode(chunk){this.chunks.push(chunk);if(!buffered){if(Number.isFinite(surfaceLimit))this.drain();else this.emit(chunk.timestamp)}}
  emit(timestamp,overrides={}){
   let released=false;const image=frame(timestamp,overrides);sourceFrames.push(image);
   if(Number.isFinite(surfaceLimit)){this.liveSurfaces++;this.peakSurfaces=Math.max(this.peakSurfaces,this.liveSurfaces)}
   image.close=()=>{
    image.closed++;events.push({type:'source-close',image});
    if(!released){released=true;if(Number.isFinite(surfaceLimit)){this.liveSurfaces--;this.drain()}}
   };
   this.callbacks.output(image);return image;
  }
  drain(){
   if(this.draining||this.state!=='configured')return;this.draining=true;
   try{while(this.chunks.length&&this.liveSurfaces<surfaceLimit)this.emit(this.chunks.shift().timestamp)}finally{this.draining=false}
   if(!this.chunks.length)for(const resolve of this.flushWaiters.splice(0))resolve();
  }
  async flush(){
   this.flushes++;
   if(Number.isFinite(surfaceLimit)){
    this.drain();if(this.chunks.length)await new Promise(resolve=>this.flushWaiters.push(resolve));
   }else for(const chunk of this.chunks.splice(0))this.emit(chunk.timestamp);
  }
  close(){this.state='closed'}
 }
 class Canvas {
  constructor(width,height){this.width=width;this.height=height;canvases.push(this);if(copyFailure==='construct')throw new Error('Canvas creation failed')}
  getContext(type,options){
   assert.equal(type,'2d');this.options=options;if(copyFailure==='context')return null;
   return{drawImage:(image,...rect)=>{events.push({type:'draw',image,rect});this.source=image;if(copyFailure==='draw')throw new Error('Canvas draw failed')}};
  }
  transferToImageBitmap(){
   events.push({type:'snapshot',image:this.source});if(copyFailure==='snapshot')throw new Error('Canvas snapshot failed');
   const image=bitmap({width:this.width,height:this.height,contentTimestamp:this.source.timestamp});
   image.close=()=>{image.closed++;events.push({type:'bitmap-close',image})};bitmaps.push(image);return image;
  }
 }
 const self={addEventListener(type,fn){assert.equal(type,'message');listener=fn},postMessage(data,transfer=[]){
  events.push({type:'post-'+data.type,image:data.image});
  if(data.type==='frame'&&transferFailure)throw new DOMException('Bitmap transfer failed','DataCloneError');
  messages.push({...data,stats:data.stats?{...data.stats}:undefined,transfer});
 }};
 vm.runInNewContext(workerSource,{self,VideoDecoder:Decoder,OffscreenCanvas:canvas?Canvas:undefined,performance:{now:()=>++clock},EncodedVideoChunk:class{constructor(init){Object.assign(this,init)}},DOMException,setTimeout(fn,delay){timers.set(++timerId,{fn,delay});return timerId},clearTimeout(id){timers.delete(id)}});
 const send=data=>listener({data});
 send({type:'init',config,fps:60,maxPending:4});await flush();
 return{send,messages,timers,decoders,probes,canvases,sourceFrames,bitmaps,events,runTimer:async()=>{const [id,timer]=timers.entries().next().value;timers.delete(id);timer.fn();await flush()}};
}
const request=(id,sourceFrame=id)=>({type:'decode',id,frame:sourceFrame,timestamp:id*16667,duration:16667,bytes:new Uint8Array([1]).buffer});

test('worker immediate output closes decoder frames before transferring independent bitmaps with no per-frame flush',async()=>{
 const f=await workerFixture();for(let i=1;i<=4;i++)f.send(request(i));
 const outputs=f.messages.filter(row=>row.type==='frame');assert.equal(outputs.length,4);assert.equal(f.decoders[0].flushes,0);assert.equal(f.timers.size,0);
 for(const row of outputs){
  assert.equal(row.transfer[0],row.image);assert.equal(row.image.closed,0);assert.equal(row.outputKind,'bitmap');
  assert.equal(row.timestamp,row.image.contentTimestamp);assert.equal(row.timestamp,row.id*16667);
  assert.deepEqual({...row.sourceColorSpace},config.colorSpace);
  assert.ok(f.events.findIndex(event=>event.type==='source-close'&&event.image.timestamp===row.timestamp)<f.events.findIndex(event=>event.type==='post-frame'&&event.image===row.image));
  row.image.close();
 }
 assert.ok(f.sourceFrames.every(image=>image.closed===1));assert.equal(f.canvases.length,1);
 assert.deepEqual({...f.canvases[0].options},{alpha:false,colorSpace:'srgb'});
 assert.equal(outputs.at(-1).stats.workerBitmapCopies,4);assert.equal(outputs.at(-1).stats.workerBitmapCopyMs,4);assert.equal(outputs.at(-1).stats.workerBitmapCopyMaxMs,1);
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


test('adapter colour rejection reports expected and actual metadata before closing the frame',async t=>{
 const {decoder,worker}=await fixture(t),pending=decoder.decode(5,new Uint8Array([1]));
 const rejected=assert.rejects(pending,error=>{
  const detail=JSON.parse(error.message.slice(error.message.indexOf(': ')+2));
  assert.deepEqual(detail.expected,config.colorSpace);
  assert.deepEqual(detail.actual,{primaries:'bt709',transfer:null,matrix:'bt709',fullRange:false});return error.name==='EncodingError';
 });
 const image=complete(worker,worker.messages.at(-1),{sourceColorSpace:{...config.colorSpace,transfer:null}});
 await rejected;assert.equal(image.closed,1);assert.equal(worker.terminated,true);
});

test('worker colour rejection preserves raw metadata evidence without releasing invalid pixels',async()=>{
 const f=await workerFixture({buffered:true});f.send(request(1));
 const image=f.decoders[0].emit(16667,{colorSpace:{primaries:'bt709',transfer:'iec61966-2-1',matrix:'bt709',fullRange:false}});
 const fatal=f.messages.find(row=>row.type==='fatal'),detail=JSON.parse(fatal.message.slice(fatal.message.indexOf(': ')+2));
 assert.equal(detail.expected.transfer,'bt709');assert.equal(detail.actual.transfer,'iec61966-2-1');
 assert.equal(image.closed,1);assert.equal(f.messages.filter(row=>row.type==='frame').length,0);
});


for(const surfaceLimit of [2,3]){
 test('finite '+surfaceLimit+'-surface decoder control stalls until an output is closed',async()=>{
  const f=await workerFixture({surfaceLimit}),outputs=[],Decoder=f.decoders[0].constructor;
  const decoder=new Decoder({output:image=>outputs.push(image)});decoder.configure(config);
  for(let id=1;id<=4;id++)decoder.decode(request(id));
  let flushed=false;const pending=decoder.flush().then(()=>{flushed=true});await flush();
  assert.equal(outputs.length,surfaceLimit);assert.equal(decoder.liveSurfaces,surfaceLimit);
  assert.equal(flushed,false,'Flush cannot reclaim output surfaces retained by the caller');
  outputs[0].close();await flush();assert.equal(outputs.length,surfaceLimit+1,'Closing one output releases exactly one blocked frame');
  if(surfaceLimit===2)outputs[1].close();await pending;
  assert.equal(outputs.length,4);assert.equal(decoder.peakSurfaces,surfaceLimit);
  outputs.forEach(image=>{if(!image.closed)image.close()});assert.equal(decoder.liveSurfaces,0);
 });

 test('worker completes four retained outputs with only '+surfaceLimit+' decoder surfaces',async t=>{
  const f=await workerFixture({surfaceLimit}),outputs=()=>f.messages.filter(row=>row.type==='frame');
  t.after(()=>{for(const row of outputs())if(!row.image.closed)row.image.close()});
  for(let id=1;id<=4;id++)f.send(request(id));
  if(f.timers.size)await f.runTimer();await flush();
  assert.equal(outputs().length,4,'Retained cache images must not prevent the decoder from completing the four-frame warm batch');
  assert.equal(f.decoders[0].liveSurfaces,0,'Transferred cache images must be independent of decoder output surfaces');
  assert.equal(f.messages.some(row=>row.type==='fatal'),false);
 });
}


test('worker rejects startup when independent bitmap storage is unavailable',async()=>{
 const f=await workerFixture({canvas:false});assert.equal(f.decoders.length,0);
 assert.equal(f.messages[0].type,'unsupported');assert.equal(f.messages[0].name,'NotSupportedError');
});

for(const copyFailure of ['construct','context','draw','snapshot']){
 test('worker releases its decoder surface when bitmap '+copyFailure+' fails',async()=>{
  const f=await workerFixture({surfaceLimit:2,copyFailure});f.send(request(1));await flush();
  assert.equal(f.sourceFrames.length,1);assert.equal(f.sourceFrames[0].closed,1);
  assert.equal(f.decoders[0].liveSurfaces,0);assert.equal(f.decoders[0].state,'closed');
  assert.equal(f.messages.filter(row=>row.type==='frame').length,0);assert.ok(f.messages.some(row=>row.type==='fatal'));
  assert.equal(f.bitmaps.length,0);assert.equal(f.timers.size,0);
 });
}

test('worker closes both resources when transferring a copied bitmap fails',async()=>{
 const f=await workerFixture({surfaceLimit:2,transferFailure:true});f.send(request(1));await flush();
 assert.equal(f.sourceFrames[0].closed,1);assert.equal(f.bitmaps[0].closed,1);assert.equal(f.decoders[0].liveSurfaces,0);
 assert.equal(f.messages.filter(row=>row.type==='frame').length,0);assert.equal(f.messages.find(row=>row.type==='fatal').name,'DataCloneError');
 assert.ok(f.events.findIndex(row=>row.type==='source-close')<f.events.findIndex(row=>row.type==='post-frame'));
 assert.ok(f.events.findIndex(row=>row.type==='bitmap-close')<f.events.findIndex(row=>row.type==='post-fatal'));
});

test('worker validates source metadata before making a bitmap copy',async()=>{
 const f=await workerFixture({buffered:true,surfaceLimit:2});f.send(request(1));
 const source=f.decoders[0].emit(16667,{colorSpace:{...config.colorSpace,fullRange:true}});
 assert.equal(source.closed,1);assert.equal(f.canvases.length,0);assert.equal(f.bitmaps.length,0);
 assert.equal(f.messages.filter(row=>row.type==='frame').length,0);assert.ok(f.messages.some(row=>row.type==='fatal'));
});

test('cancelled and stale outputs release codec surfaces without allocating bitmaps',async()=>{
 const f=await workerFixture({buffered:true});f.send(request(1));f.send(request(2));f.send({type:'cancel',id:1});
 const old=f.decoders[0],cancelled=old.emit(16667);assert.equal(cancelled.closed,1);assert.equal(f.bitmaps.length,0);
 assert.ok(f.events.findIndex(row=>row.type==='source-close'&&row.image===cancelled)<f.events.findIndex(row=>row.type==='post-released'));
 f.send({type:'reset'});const stale=old.emit(33334);assert.equal(stale.closed,1);assert.equal(f.bitmaps.length,0);
 f.send(request(3));await f.runTimer();assert.equal(f.bitmaps.length,1);assert.equal(f.sourceFrames.at(-1).closed,1);
});
