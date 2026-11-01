import test from 'node:test';import assert from 'node:assert/strict';
import {createStreamedVideoSource} from '../entrance-source/streamed-video.mjs';
const metadata={codec:'avc1.64002a',description:'0164002affe10000'};
const segment={url:'https://media.example/movie.mp4',bytes:8,firstFrame:334,lastFrame:341,frameCount:8,frames:Array.from({length:8},(_,i)=>[i,1,i%4===0?1:0])};
function codec(){
 const images=[],chunks=[];let flushes=0;
 class Decoder{
  static async isConfigSupported(){return {supported:true}}
  constructor(callbacks){this.callbacks=callbacks;this.state='unconfigured';this.needsKey=true}
  configure(){this.state='configured'}
  decode(chunk){if(this.needsKey)assert.equal(chunk.type,'key');this.needsKey=false;chunks.push(chunk);const frame={timestamp:chunk.timestamp,displayWidth:1920,displayHeight:1080,closed:false,close(){this.closed=true}};images.push(frame);this.callbacks.output(frame)}
  async flush(){flushes++;this.needsKey=true}
  close(){this.state='closed'}
 }
 return {Decoder,Chunk:class{constructor(value){Object.assign(this,value)}},images,chunks,get flushes(){return flushes}};
}

test('first pictures decode before a section finishes downloading; reverse groups reuse compressed bytes',async()=>{
 const fake=codec();let finish,downloaded=false,requests=0;
 const fetcher=async()=>{requests++;return new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(4));finish=()=>{controller.enqueue(new Uint8Array(4));downloaded=true;controller.close()}}}))};
 const source=await createStreamedVideoSource([segment],metadata,{...fake,fetcher});
 try{
  const first=await source.frameAt(0);assert.equal(first.timestamp,0);assert.equal(downloaded,false);assert.equal(fake.flushes,1);assert.equal(fake.images.length,4);
  await source.frameAt(2);assert.equal(fake.flushes,1,'reuse the decoded prediction group');
  finish();const next=await source.frameAt(5);assert.equal(Math.round(next.timestamp*60/1e6),5);assert.ok(fake.images.slice(0,4).every(frame=>frame.closed));
  await source.frameAt(0);assert.equal(requests,1,'reverse playback must reuse the compressed section');assert.equal(fake.flushes,3);
 }finally{source.dispose()}
 assert.ok(fake.images.every(frame=>frame.closed));
});

test('disposing rejects an outstanding frame wait and closes decoder resources',async()=>{
 const fake=codec();
 const fetcher=async(_, {signal})=>new Response(new ReadableStream({start(controller){signal.addEventListener('abort',()=>controller.error(signal.reason),{once:true})}}));
 const source=await createStreamedVideoSource([segment],metadata,{...fake,fetcher});
 const pending=assert.rejects(source.frameAt(0),{name:'AbortError'});source.dispose();await pending;
});

test('unsupported decoders and malformed downloads retain the native fallback path',async()=>{
 const fake=codec();fake.Decoder.isConfigSupported=async()=>({supported:false});assert.equal(await createStreamedVideoSource([segment],metadata,fake),null);
 const source=await createStreamedVideoSource([segment],metadata,{...codec(),fetcher:async()=>new Response(new Uint8Array(2))});
 try{await assert.rejects(source.frameAt(0),/Incomplete video section/)}finally{source.dispose()}
});

test('the final partial prediction group presents the last authored frame',async()=>{
 const partial={...segment,bytes:7,lastFrame:340,frameCount:7,frames:segment.frames.slice(0,7)},fake=codec();
 const source=await createStreamedVideoSource([partial],metadata,{...fake,fetcher:async()=>new Response(new Uint8Array(7))});
 try{const frame=await source.frameAt(6);assert.equal(Math.round(frame.timestamp*60/1e6),6);assert.equal(fake.chunks.length,3)}finally{source.dispose()}
});
