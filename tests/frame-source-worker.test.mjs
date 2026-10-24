import test from 'node:test';
import assert from 'node:assert/strict';
import {createFrameSource} from '../assets/frame-source.js';

const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve()};
const colour={primaries:'bt709',transfer:'bt709',matrix:'bt709',fullRange:false};
const index={source:'./journey.mp4',codec:'avc1.64002a',sha256:'a'.repeat(64),width:1920,height:1080,fps:60,bytes:300,version:1,frameCount:30,frames:Array(30).fill([0,10]),colorSpace:colour};
class Video extends EventTarget {
 readyState=2;paused=true;seeking=false;time=0;error=null;playbackRate=1;
 setAttribute(){} removeAttribute(){} load(){} pause(){this.paused=true}
 play(){this.paused=false;return Promise.resolve()}
 get currentTime(){return this.time}
 set currentTime(value){this.time=value;this.seeking=true}
 complete(){this.seeking=false;this.dispatchEvent(new Event('seeked'))}
}
async function fixture(t,{unsupported=false}={}){
 const previous={Worker:globalThis.Worker,matchMedia:globalThis.matchMedia,VideoFrame:globalThis.VideoFrame};
 let worker;
 globalThis.matchMedia=()=>({matches:true});globalThis.VideoFrame=undefined;
 globalThis.Worker=class extends EventTarget {
  messages=[];terminated=false;
  constructor(){super();worker=this}
  postMessage(data,transfer=[]){this.messages.push(structuredClone(data,{transfer}));if(data.type==='init')queueMicrotask(()=>this.emit(unsupported?{type:'unsupported',name:'NotSupportedError',message:'Worker codec unavailable'}:{type:'ready'}))}
  emit(data){this.dispatchEvent(new MessageEvent('message',{data}))}
  terminate(){this.terminated=true}
 };
 const video=new Video(),source=await createFrameSource(video,index,new URL('https://example.test/index.json'),undefined,undefined,{renderer:'worker'});
 t.after(()=>{source.destroy();Object.assign(globalThis,previous)});
 return{video,source,worker};
}
function output(worker,request,overrides={}){
 const image={timestamp:request.timestamp,displayWidth:1920,displayHeight:1080,colorSpace:{...colour},closed:0,close(){this.closed++},...overrides};
 worker.emit({type:'frame',id:request.id,frame:request.frame,image});return image;
}

test('unsupported worker startup preserves a usable native source',async t=>{
 const {video,source,worker}=await fixture(t,{unsupported:true});
 assert.equal(source.mode,'video');assert.equal(source.decodeConcurrency,1);assert.equal(worker.terminated,true);
 assert.equal(source.stats.fallbackReason,'worker-unavailable');assert.equal(source.stats.workerFailure.name,'NotSupportedError');
 const pending=source.decode(20,undefined,false);await flush();assert.equal(video.currentTime,20.25/60);
 video.complete();assert.equal(await pending,video);
});

test('source worker concurrency routes reversed frames and keeps Full HD surfaces',async t=>{
 const {source,worker}=await fixture(t);assert.equal(source.mode,'worker');assert.equal(source.decodeConcurrency,4);assert.equal(source.transient,false);
 const pending=[20,10,20,5].map(frame=>source.decode(frame,new Uint8Array([1]),false));
 const requests=worker.messages.filter(row=>row.type==='decode'),images=[];
 for(const i of [3,0,2,1])images[i]=output(worker,requests[i]);
 assert.deepEqual(await Promise.all(pending),images);assert.equal(source.stats.workerCompleted,4);assert.equal(source.stats.renderer,'worker-webcodecs');
 images.forEach(image=>image.close());
});

test('a failed worker frame can fall back to native decoding without retaining worker jobs',async t=>{
 const {source,worker,video}=await fixture(t);
 const pending=[20,21,22,23].map(frame=>source.decode(frame,new Uint8Array([1]),false));
 const rejected=pending.map(job=>assert.rejects(job,{name:'EncodingError'}));
 const bad=output(worker,worker.messages.find(row=>row.type==='decode'),{displayHeight:720});
 await Promise.all(rejected);assert.equal(bad.closed,1);assert.equal(worker.terminated,true);
 assert.equal(source.stats.workerFailure.name,'EncodingError');assert.equal(source.stats.workerPending,0);
 assert.equal(source.fallback('decode-or-range'),true);assert.equal(source.mode,'video');assert.equal(source.decodeConcurrency,1);
 const native=source.decode(20,undefined,false);await flush();video.complete();assert.equal(await native,video);
 assert.equal(source.stats.fallbacks,1);assert.equal(source.stats.renderer,'native-video');
});

test('source passes cancellation through without releasing decoder credit before acknowledgment',async t=>{
 const {source,worker}=await fixture(t),controller=new AbortController();let settled=false;
 const pending=source.decode(20,new Uint8Array([1]),false,controller.signal).finally(()=>{settled=true});
 const rejected=assert.rejects(pending,{name:'AbortError'}),request=worker.messages.at(-1);
 controller.abort();await flush();assert.equal(settled,false);assert.equal(source.stats.workerPending,1);
 worker.emit({type:'released',id:request.id});await rejected;assert.equal(source.stats.workerPending,0);assert.equal(source.stats.workerFailure,null);
 const next=source.decode(10,new Uint8Array([1]),false);output(worker,worker.messages.at(-1));(await next).close();assert.equal(source.mode,'worker');
});
