import test from 'node:test';import assert from 'node:assert/strict';
import {createStreamedVideoSource} from '../entrance-source/streamed-video.mjs';
const metadata={codec:'avc1.64002a',description:'0164002affe10000'};
const segment={url:'https://media.example/movie.mp4',bytes:8,firstFrame:334,lastFrame:341,frameCount:8,frames:Array.from({length:8},(_,i)=>[i,1,i%4===0?1:0])};
function codec(){
 const images=[],chunks=[];let flushes=0;
 class Decoder{
  static async isConfigSupported(){return {supported:true}}
  constructor(callbacks){this.callbacks=callbacks;this.state='unconfigured';this.needsKey=true}
  configure(config){this.config=config;this.state='configured'}
  decode(chunk){if(this.needsKey)assert.equal(chunk.type,'key');this.needsKey=false;chunks.push(chunk);const frame={timestamp:chunk.timestamp,displayWidth:this.config.codedWidth,displayHeight:this.config.codedHeight,closed:false,close(){this.closed=true}};images.push(frame);this.callbacks.output(frame)}
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

test('cold jumps fetch the keyframe tail first and reverse fills only the missing prefix',async()=>{
 const fake=codec(),requests=[];
 const fetcher=async(_,options)=>{
  const range=options.headers?.Range;requests.push(range);
  const [,from,to]=/bytes=(\d+)-(\d+)/.exec(range);
  return new Response(new Uint8Array(Number(to)-Number(from)+1),{status:206,headers:{'Content-Range':`bytes ${from}-${to}/8`}});
 };
 const source=await createStreamedVideoSource([segment],metadata,{...fake,fetcher});
 try{
  assert.equal(Math.round((await source.frameAt(7)).timestamp*60/1e6),7);
  assert.deepEqual(requests,['bytes=4-7'],'skipped pictures must not block a cold jump');
  await source.frameAt(0);assert.deepEqual(requests,['bytes=4-7','bytes=0-3']);
  await source.frameAt(7);assert.equal(requests.length,2);
 }finally{source.dispose()}
});

test('range responses must match the requested offsets; servers ignoring Range remain compatible',async()=>{
 const source=await createStreamedVideoSource([segment],metadata,{...codec(),fetcher:async()=>new Response(new Uint8Array(4),{status:206,headers:{'Content-Range':'bytes 0-3/8'}})});
 try{await assert.rejects(source.frameAt(7),/Invalid video byte range/)}finally{source.dispose()}
 const fallback=await createStreamedVideoSource([segment],metadata,{...codec(),fetcher:async()=>new Response(new Uint8Array(8))});
 try{assert.equal(Math.round((await fallback.frameAt(7)).timestamp*60/1e6),7)}finally{fallback.dispose()}
});

test('twelve-frame prediction groups reuse decoded pictures and handle the final short group',async()=>{
 const part={...segment,bytes:15,lastFrame:348,frameCount:15,frames:Array.from({length:15},(_,i)=>[i,1,Number(i%12===0)])},fake=codec();
 const source=await createStreamedVideoSource([part],{...metadata,keyframeInterval:12},{...fake,fetcher:async()=>new Response(new Uint8Array(15))});
 try{
  await source.frameAt(0);await source.frameAt(11);assert.equal(fake.flushes,1);assert.equal(fake.chunks.length,12);
  assert.equal(Math.round((await source.frameAt(14)).timestamp*60/1e6),14);assert.equal(fake.chunks.length,15);
 }finally{source.dispose()}
});

test('prefetch reserves only the next boundary before continuing without overlapping downloads',async()=>{
 const next={...segment,url:segment.url+'?next',firstFrame:342,lastFrame:349},requests=[];
 let finish;
 const fetcher=async(url,options)=>{
  if(url===segment.url)return new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(4));finish=()=>{controller.enqueue(new Uint8Array(4));controller.close()}}}));
  const range=options.headers?.Range;requests.push(range);const [,start,end]=/bytes=(\d+)-(\d+)/.exec(range);
  return new Response(new Uint8Array(Number(end)-Number(start)+1),{status:206,headers:{'Content-Range':`bytes ${start}-${end}/8`}});
 };
 const source=await createStreamedVideoSource([segment,next],metadata,{...codec(),fetcher});
 try{
  await source.frameAt(0);assert.deepEqual(requests,['bytes=0-3']);
  finish();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(requests,['bytes=0-3','bytes=4-7']);
  assert.equal(Math.round((await source.frameAt(12)).timestamp*60/1e6),12);
 }finally{source.dispose()}
});

test('advancing pauses skipped downloads and stale prefetch cannot fill an active jump prefix',async()=>{
 const next={...segment,url:segment.url+'?next',firstFrame:342,lastFrame:353,frameCount:12,bytes:12,frames:Array.from({length:12},(_,i)=>[i,1,Number(i%4===0)])};
 const requests=[];let firstSignal,tail;
 const fetcher=async(url,options)=>{
  if(url===segment.url){firstSignal=options.signal;return new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(4));options.signal.addEventListener('abort',()=>controller.error(options.signal.reason),{once:true})}}))}
  const range=options.headers.Range;requests.push(range);const [,start,end]=/bytes=(\d+)-(\d+)/.exec(range);
  const body=range==='bytes=8-11'?new ReadableStream({start(controller){tail=()=>{controller.enqueue(new Uint8Array(4));controller.close()}}}):new Uint8Array(Number(end)-Number(start)+1);
  return new Response(body,{status:206,headers:{'Content-Range':`bytes ${start}-${end}/12`}});
 };
 const source=await createStreamedVideoSource([segment,next],metadata,{...codec(),fetcher});
 try{
  await source.frameAt(0);const jump=source.frameAt(19);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(firstSignal.aborted,true);assert.deepEqual(requests,['bytes=0-3','bytes=8-11']);
  tail();assert.equal(Math.round((await jump).timestamp*60/1e6),19);
 }finally{source.dispose()}
});


test('4K decoding bounds retained pictures while preserving exact forward and reverse targets',async()=>{
 const part={...segment,bytes:12,lastFrame:345,frameCount:12,frames:Array.from({length:12},(_,i)=>[i,1,Number(i%12===0)])},fake=codec();
 const source=await createStreamedVideoSource([part],{...metadata,keyframeInterval:12},{...fake,width:3840,height:2160,fetcher:async()=>new Response(new Uint8Array(12))});
 try{
  for(const index of [0,4,11,2]){
   const frame=await source.frameAt(index);
   assert.equal(Math.round(frame.timestamp*60/1e6),index);assert.equal(frame.displayWidth,3840);
   assert.ok(fake.images.filter(frame=>!frame.closed).length<=3,'4K frames must fit the 1080p decoded-pixel budget');
  }
 }finally{source.dispose()}
 assert.ok(fake.images.every(frame=>frame.closed));
});
