import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {loadEntranceMedia} from '../entrance-source/video-delivery.mjs';
const source=readFileSync(new URL('../entrance-source/segmented-video.mjs',import.meta.url),'utf8');
const parts=Array.from({length:6},(_,i)=>({firstFrame:334+i*120,lastFrame:453+i*120,frameCount:120,bytes:100+i,url:`https://media.example/${i}.mp4`}));
function fixture({blocked=false}={}){
  const fetched=[],revoked=[],videos=[],urls=new Map();let next=0;
  class Video extends EventTarget{
    videoWidth=1920;videoHeight=1080;duration=2;seeking=false;time=0;
    constructor(){super();videos.push(this)}
    setAttribute(){}removeAttribute(){this.src=''}pause(){}load(){if(this.src)queueMicrotask(()=>this.dispatchEvent(new Event('loadeddata')))}
    set currentTime(t){this.time=t;this.seeking=true;queueMicrotask(()=>{this.seeking=false;this.dispatchEvent(new Event('seeked'))})}get currentTime(){return this.time}
  }
  const context={document:{createElement:()=>new Video()},URL:{createObjectURL:blob=>{const url='blob:'+next++;urls.set(url,blob);return url},revokeObjectURL:url=>{revoked.push(url);urls.delete(url)}},Blob,AbortController,DOMException,setTimeout,clearTimeout,
    fetch:async(url,{signal})=>{fetched.push(url);if(blocked)await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));return {ok:true,blob:async()=>new Blob([new Uint8Array(parts.find(p=>p.url===url).bytes)])}}};
  vm.runInNewContext(source.replace('export function','function')+';this.create=createSegmentedVideoSource',context);
  return {decoder:context.create(parts),fetched,revoked,videos,urls};
}

test('sections preserve exact boundary frames and reverse seeks reuse buffered movies',async()=>{
 const f=fixture();try{
  const first=await f.decoder.frameAt(119);assert.equal(Math.floor(first.currentTime*60),119);
  const second=await f.decoder.frameAt(120);assert.notEqual(first,second);assert.equal(Math.floor(second.currentTime*60),0);
  const count=f.fetched.length,reverse=await f.decoder.frameAt(118);assert.equal(Math.floor(reverse.currentTime*60),118);assert.equal(f.fetched.length,count);
 }finally{f.decoder.dispose()}
 assert.equal(f.urls.size,0);assert.ok(f.videos.every(v=>!v.src));
});

test('section buffering bounds compressed movies and retains only one video decoder',async()=>{
 const f=fixture();try{
  await f.decoder.frameAt(0);await f.decoder.frameAt(240);await f.decoder.frameAt(600);
  await new Promise(r=>setImmediate(r));assert.ok(f.revoked.length>=2);assert.ok(f.urls.size<=5);assert.equal(f.videos.filter(v=>v.src).length,1);
  await f.decoder.frameAt(0);assert.equal(f.fetched.filter(url=>url===parts[0].url).length,2);
 }finally{f.decoder.dispose()}
});

test('disposing cancels an in-flight section download',async()=>{
 const f=fixture({blocked:true}),pending=assert.rejects(f.decoder.frameAt(0),{name:'AbortError'});f.decoder.dispose();await pending;assert.equal(f.urls.size,0);
});

test('section manifests must be contiguous, bounded and immutable before any CDN is selected',async()=>{
 const local={version:1,width:1920,height:1080,fps:60,firstFrame:334,lastFrame:2164,clips:{opening:{frameCount:240,sha256:'a'.repeat(64)},journey:{frameCount:1831,sha256:'b'.repeat(64)}}};
 const remote=structuredClone(local);for(const kind of ['opening','journey'])Object.assign(remote.clips[kind],{file:`entrance-${kind}-${remote.clips[kind].sha256}.mp4`,bytes:100});
 const segments=Array.from({length:16},(_,i)=>{const firstFrame=334+i*120,lastFrame=Math.min(2164,firstFrame+119),sha256=i.toString(16).repeat(64);return {file:`entrance-journey-${sha256}.mp4`,sha256,bytes:100,firstFrame,lastFrame,frameCount:lastFrame-firstFrame+1}});
 remote.clips.journey.segments=segments;
 const fetcher=async url=>({ok:true,json:async()=>url==='/api/media-config'?{entranceManifestURL:'https://media.example/manifest.json'}:String(url).startsWith('https:')?remote:local});
 const good=await loadEntranceMedia(fetcher);assert.equal(good.clips.journey.segments.length,16);assert.equal(good.clips.journey.segments[0].url,'https://media.example/'+segments[0].file);
 for(const change of [s=>s[4].firstFrame++,s=>s[4].bytes=25*1024*1024,s=>s[4].file='https://other.example/file',s=>s.pop()]){
  remote.clips.journey.segments=structuredClone(segments);change(remote.clips.journey.segments);
  const bad=await loadEntranceMedia(fetcher);assert.equal(bad.clips.journey.url,bad.clips.journey.local);assert.equal(bad.clips.journey.segments,undefined);
 }
 remote.clips.journey.decoder={codec:'avc1.64002a',description:'0164002affe10000'};
 const indexed=segments.map(part=>({...part,bytes:200,frames:Array.from({length:part.frameCount},(_,i)=>[i,1,Number(i%4===0)])}));
 remote.clips.journey.segments=indexed;
 assert.equal((await loadEntranceMedia(fetcher)).clips.journey.decoder.codec,'avc1.64002a');
 for(const change of [s=>s[0].frames[0][0]=201,s=>s[0].frames[1][2]=1,s=>s[0].frames.pop()]){
  remote.clips.journey.segments=structuredClone(indexed);change(remote.clips.journey.segments);
  const bad=await loadEntranceMedia(fetcher);assert.equal(bad.clips.journey.url,bad.clips.journey.local);
 }
 remote.clips.journey.decoder.keyframeInterval=12;
 remote.clips.journey.segments=indexed.map(part=>({...part,frames:part.frames.map(([offset,bytes],i)=>[offset,bytes,Number(i%12===0)])}));
 assert.equal((await loadEntranceMedia(fetcher)).clips.journey.decoder.keyframeInterval,12);
 remote.clips.journey.decoder.keyframeInterval=120;
 assert.equal((await loadEntranceMedia(fetcher)).clips.journey.segments,undefined,'unbounded prediction chains must be rejected');
 remote.clips.journey.decoder.keyframeInterval=12;
 const proxy={...remote.clips.journey,width:512,height:288,firstFrame:334,lastFrame:2164,bytes:2000,frames:Array.from({length:1831},(_,i)=>[i,1,Number(i%12===0)])};
 delete proxy.segments;remote.clips.journey.preview=proxy;
 assert.equal((await loadEntranceMedia(fetcher)).clips.journey.preview.width,512);
 for(const change of [p=>p.width=1920,p=>p.frameCount=1800,p=>p.bytes=13*1024*1024,p=>p.frames.pop()]){
  remote.clips.journey.preview=structuredClone(proxy);change(remote.clips.journey.preview);
  assert.equal((await loadEntranceMedia(fetcher)).clips.journey.preview,undefined);
 }
});
