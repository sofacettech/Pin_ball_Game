import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Worker as NodeWorker} from 'node:worker_threads';
import {EXRLoader} from 'three/addons/loaders/EXRLoader.js';
import {loadFloorTexture} from '../game-source/src/floor-texture.ts';

const floorURL='/assets/table-floor-reference.exr';
const compressed=readFileSync(new URL('../assets/table-floor-reference.exr',import.meta.url));
const input=()=>compressed.buffer.slice(compressed.byteOffset,compressed.byteOffset+compressed.byteLength);
const expected=new EXRLoader().createDataTexture(input());
const textureProperties=['type','format','colorSpace','minFilter','magFilter','generateMipmaps','flipY','wrapS','wrapT','anisotropy','unpackAlignment','premultiplyAlpha','mapping','version'];
function sameTexture(actual){
 assert.deepEqual(textureProperties.map(key=>actual[key]),textureProperties.map(key=>expected[key]));
 assert.equal(actual.image.width,expected.image.width);assert.equal(actual.image.height,expected.image.height);
 assert.equal(actual.image.data.constructor,Uint16Array);
 const bytes=array=>Buffer.from(array.buffer,array.byteOffset,array.byteLength);
 assert.equal(Buffer.compare(bytes(actual.image.data),bytes(expected.image.data)),0,'every half-float channel is unchanged');
 actual.dispose();
}
function platform(t,WorkerClass,{bytes=input,status=200}={}){
 const original=Object.getOwnPropertyDescriptor(globalThis,'Worker');
 Object.defineProperty(globalThis,'Worker',{configurable:true,writable:true,value:WorkerClass});
 t.after(()=>{if(original)Object.defineProperty(globalThis,'Worker',original);else delete globalThis.Worker});
 const requests=[];
 t.mock.method(globalThis,'fetch',async url=>{requests.push(url);return new Response(bytes(),{status})});
 return requests;
}
class WorkerLifecycle{
 static instances=[];
 constructor(){WorkerLifecycle.instances.push(this);this.terminations=0;this.onmessage=this.onerror=this.onmessageerror=null}
 terminate(){this.terminations++}
 transfer(message,transfer){const copied=structuredClone(message,{transfer});this.detached=message.buffer.byteLength===0;return copied}
}
function cleaned(worker){assert.equal(worker.terminations,1);assert.equal(worker.onmessage,null);assert.equal(worker.onerror,null);assert.equal(worker.onmessageerror,null)}

// Run the actual browser worker module in a Node worker with only its transport
// adapted. This exercises the installed EXR parser and transferred pixel payload.
class BrowserWorker extends WorkerLifecycle{
 constructor(url,options){
  super();assert.equal(options.type,'module');assert.match(url.pathname,/floor-texture\.worker\.ts$/);
  this.worker=new NodeWorker(`
   const {parentPort,workerData}=require('node:worker_threads');
   const pending=[];
   globalThis.self={onmessage:null,postMessage:(message,transfer)=>parentPort.postMessage(message,transfer)};
   parentPort.on('message',message=>self.onmessage?self.onmessage({data:message}):pending.push(message));
   import(workerData).then(()=>{for(const message of pending)self.onmessage({data:message})});
  `,{eval:true,workerData:url.href});
  this.worker.on('message',data=>this.onmessage?.({data}));
  this.worker.on('error',error=>this.onerror?.({message:error.message,preventDefault(){}}));
  this.worker.on('messageerror',()=>this.onmessageerror?.());
 }
 postMessage(message,transfer){this.worker.postMessage(message,transfer);this.detached=message.buffer.byteLength===0}
 terminate(){super.terminate();void this.worker.terminate()}
}

test('real floor EXR decoded by the worker exactly matches normal EXRLoader texture pixels and settings',async t=>{
 const requests=platform(t,BrowserWorker);
 sameTexture(await loadFloorTexture(floorURL));
 assert.deepEqual(requests,[floorURL]);const worker=WorkerLifecycle.instances.at(-1);assert.equal(worker.detached,true);cleaned(worker);
});
test('unsupported workers and constructor failures use the same downloaded bytes for compatibility',async t=>{
 for(const WorkerClass of [undefined,class{constructor(){throw new Error('Worker blocked')}}]){
  await t.test(WorkerClass?'constructor failure':'unsupported',async t=>{
   const requests=platform(t,WorkerClass);sameTexture(await loadFloorTexture(floorURL));assert.deepEqual(requests,[floorURL]);
  });
 }
});
test('postMessage failure closes the worker and retains intact input for fallback',async t=>{
 const requests=platform(t,class extends WorkerLifecycle{postMessage(){throw new Error('Transfer blocked')}});
 sameTexture(await loadFloorTexture(floorURL));assert.equal(requests.length,1);cleaned(WorkerLifecycle.instances.at(-1));
});
test('startup or message failure after transfer refetches detached input and closes the worker',async t=>{
 for(const failure of ['error','messageerror','invalid'])await t.test(failure,async t=>{
  const requests=platform(t,class extends WorkerLifecycle{
   postMessage(message,transfer){this.transfer(message,transfer);queueMicrotask(()=>{
    if(failure==='error')this.onerror?.({preventDefault(){}});
    else if(failure==='messageerror')this.onmessageerror?.();
    else this.onmessage?.({data:{type:'decoded',texture:{}}});
   })}
  });
  sameTexture(await loadFloorTexture(floorURL));assert.equal(requests.length,2);const worker=WorkerLifecycle.instances.at(-1);assert.equal(worker.detached,true);cleaned(worker);
 });
});
test('a silent worker has a bounded lifetime and cannot leave texture loading pending',async t=>{
 const requests=platform(t,class extends WorkerLifecycle{postMessage(message,transfer){this.transfer(message,transfer)}});
 let cleared=false;
 t.mock.method(globalThis,'setTimeout',(callback,delay)=>{assert.equal(delay,30000);queueMicrotask(callback);return 123});
 t.mock.method(globalThis,'clearTimeout',id=>{assert.equal(id,123);cleared=true});
 sameTexture(await loadFloorTexture(floorURL));assert.equal(requests.length,2);assert.equal(cleared,true);cleaned(WorkerLifecycle.instances.at(-1));
});
test('invalid EXR input rejects after terminating the worker; HTTP failure starts no worker',async t=>{
 await t.test('invalid input',async t=>{
  const requests=platform(t,BrowserWorker,{bytes:()=>new ArrayBuffer(16)});
  await assert.rejects(loadFloorTexture(floorURL));assert.equal(requests.length,2);cleaned(WorkerLifecycle.instances.at(-1));
 });
 await t.test('HTTP failure',async t=>{
  const count=WorkerLifecycle.instances.length;platform(t,BrowserWorker,{bytes:()=>new ArrayBuffer(0),status:503});
  await assert.rejects(loadFloorTexture(floorURL),/Missing floor texture: 503/);assert.equal(WorkerLifecycle.instances.length,count);
 });
});
