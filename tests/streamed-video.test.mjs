import test from 'node:test';import assert from 'node:assert/strict';
import {createStreamedVideoSource} from '../entrance-source/streamed-video.mjs';
const metadata={codec:'avc1.64002a',description:'0164002affe10000'};
const segment={url:'https://media.example/movie.mp4',bytes:8,firstFrame:334,lastFrame:341,frameCount:8,frames:Array.from({length:8},(_,i)=>[i,1,i%4===0?1:0])};
const decodeSizes=[{name:'1080p',width:1920,height:1080,maxFrames:4,probeDelay:50},{name:'4K',width:3840,height:2160,maxFrames:3,probeDelay:100}];
function codec({buffered=false,coldBuffered=false,asyncOutput=false,dropOutput=false,bufferedFrames=0}={}){
 const images=[],chunks=[],pending=[];let flushes=0,bufferOutput=buffered||coldBuffered,decoder;
 class Decoder{
  static async isConfigSupported(){return {supported:true}}
  constructor(callbacks){this.callbacks=callbacks;this.state='unconfigured';this.needsKey=true;decoder=this}
  configure(config){this.config=config;this.state='configured'}
  decode(chunk){if(this.needsKey)assert.equal(chunk.type,'key');this.needsKey=false;chunks.push(chunk);const frame={timestamp:chunk.timestamp,displayWidth:this.config.codedWidth,displayHeight:this.config.codedHeight,closed:false,close(){this.closed=true}};images.push(frame);if(dropOutput){frame.close();return}if(bufferOutput)pending.push(frame);else if(bufferedFrames){pending.push(frame);if(pending.length>bufferedFrames)this.callbacks.output(pending.shift())}else if(asyncOutput)queueMicrotask(()=>this.callbacks.output(frame));else this.callbacks.output(frame)}
  async flush(){flushes++;this.needsKey=true;for(const frame of pending.splice(0))this.callbacks.output(frame);if(coldBuffered)bufferOutput=false;}
  close(){this.state='closed';for(const frame of pending.splice(0))frame.close()}
 }
 return {Decoder,Chunk:class{constructor(value){Object.assign(this,value)}},images,chunks,get flushes(){return flushes},
  output(count){for(const frame of pending.splice(0,count))decoder.callbacks.output(frame)}};
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

for(const size of decodeSizes)test(`${size.name} twelve-frame groups begin incrementally and present the final short group`,async()=>{
 const part={...segment,bytes:15,lastFrame:348,frameCount:15,frames:Array.from({length:15},(_,i)=>[i,1,Number(i%12===0)])},fake=codec();
 const source=await createStreamedVideoSource([part],{...metadata,keyframeInterval:12},{...fake,...size,fetcher:async()=>new Response(new Uint8Array(15))});
 try{
  await source.frameAt(0);assert.equal(fake.flushes,0);assert.equal(fake.chunks.length,size.maxFrames,'first paint must not wait for all twelve prediction pictures');
  await source.frameAt(11);assert.equal(fake.flushes,1);assert.equal(fake.chunks.length,12);
  assert.equal(Math.round((await source.frameAt(14)).timestamp*60/1e6),14);assert.equal(fake.chunks.length,15);assert.equal(fake.flushes,2);
 }finally{source.dispose()}
 assert.ok(fake.images.every(frame=>frame.closed));
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


for(const size of decodeSizes)test(`${size.name} decoding bounds retained pictures while preserving exact forward and reverse targets`,async()=>{
 const part={...segment,bytes:12,lastFrame:345,frameCount:12,frames:Array.from({length:12},(_,i)=>[i,1,Number(i%12===0)])},fake=codec();
 const source=await createStreamedVideoSource([part],{...metadata,keyframeInterval:12},{...fake,...size,fetcher:async()=>new Response(new Uint8Array(12))});
 try{
  for(const index of [0,4,11,2]){
   const frame=await source.frameAt(index);
   assert.equal(Math.round(frame.timestamp*60/1e6),index);assert.equal(frame.displayWidth,size.width);
   assert.ok(fake.images.filter(frame=>!frame.closed).length<=size.maxFrames,'output pictures must fit the retained-frame budget');
  }
 }finally{source.dispose()}
 assert.ok(fake.images.every(frame=>frame.closed));
});

for(const size of decodeSizes)test(`${size.name} forward windows decode each picture once and reverse misses restart from a keyframe`,async()=>{
 const part={...segment,bytes:24,lastFrame:357,frameCount:24,frames:Array.from({length:24},(_,i)=>[i,1,Number(i%12===0)])},fake=codec({asyncOutput:true});
 const source=await createStreamedVideoSource([part],{...metadata,keyframeInterval:12},{...fake,...size,fetcher:async()=>new Response(new Uint8Array(24))});
 try{
  for(let index=0;index<12;index++){
   assert.equal(Math.round((await source.frameAt(index)).timestamp*60/1e6),index);
   assert.ok(fake.images.filter(frame=>!frame.closed).length<=size.maxFrames);
  }
  assert.equal(fake.chunks.length,12,'appending forward windows must not decode the prediction prefix again');
  assert.equal(fake.flushes,1,'only the end of the prediction group drains the decoder');
  const reverseIndex=11-size.maxFrames,reversePrefix=reverseIndex+1;
  await source.frameAt(reverseIndex);assert.equal(fake.chunks.at(-reversePrefix).type,'key');assert.equal(fake.chunks.length,12+reversePrefix);
  await source.frameAt(reverseIndex-1);await source.frameAt(reverseIndex-2);assert.equal(fake.chunks.length,12+reversePrefix,'reuse the reverse lookbehind window');
  await source.frameAt(10);assert.equal(fake.chunks.length,24+reversePrefix,'a forward reversal after draining starts from an independent keyframe');
  await source.frameAt(12);assert.equal(fake.chunks.at(-size.maxFrames).type,'key');assert.equal(fake.chunks.length,24+reversePrefix+size.maxFrames);
  assert.ok(fake.images.filter(frame=>!frame.closed).length<=size.maxFrames);
 }finally{source.dispose()}
 assert.ok(fake.images.every(frame=>frame.closed));
});

for(const size of decodeSizes)test(`${size.name} two-picture hardware buffering decodes incrementally and drains only the prediction tail`,async()=>{
 const part={...segment,bytes:24,lastFrame:357,frameCount:24,frames:Array.from({length:24},(_,i)=>[i,1,Number(i%12===0)])},fake=codec({bufferedFrames:2});
 const source=await createStreamedVideoSource([part],{...metadata,keyframeInterval:12},{...fake,...size,diagnostics:true,fetcher:async()=>new Response(new Uint8Array(24))});
 try{
  for(let index=0;index<24;index++){
   assert.equal(Math.round((await source.frameAt(index)).timestamp*60/1e6),index);
   assert.ok(fake.images.filter(frame=>!frame.closed).length<=size.maxFrames+2,'bound retained output pictures plus two internal decoder pictures');
  }
  assert.equal(fake.chunks.length,24,'buffered output must not force repeated prediction-prefix decoding');
  assert.equal(fake.flushes,2,'flush once per group rather than permanently selecting the compatibility path');
  assert.equal(source.metrics.compatibilityFlushes,0);
  for(const index of [21,19,15,10,3,0])assert.equal(Math.round((await source.frameAt(index)).timestamp*60/1e6),index);
 }finally{source.dispose()}
 assert.ok(fake.images.every(frame=>frame.closed));
});

test('decoders that buffer output switch to flush-based requests after one probe',async()=>{
 const part={...segment,bytes:12,lastFrame:345,frameCount:12,frames:Array.from({length:12},(_,i)=>[i,1,Number(i%12===0)])},fake=codec({buffered:true});
 const source=await createStreamedVideoSource([part],{...metadata,keyframeInterval:12},{...fake,width:3840,height:2160,fetcher:async()=>new Response(new Uint8Array(12))});
 try{
  for(const index of [0,4,11,2])assert.equal(Math.round((await source.frameAt(index)).timestamp*60/1e6),index);
  assert.equal(fake.flushes,4);assert.ok(fake.images.filter(frame=>!frame.closed).length<=3);
 }finally{source.dispose()}
});

for(const size of decodeSizes)test(`${size.name} cold buffered decoding recovers at the next independent GOP without increasing its frame budget`,async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const part={...segment,bytes:60,lastFrame:393,frameCount:60,frames:Array.from({length:60},(_,i)=>[i,1,Number(i%12===0)])},fake=codec({coldBuffered:true,asyncOutput:true});
 const source=await createStreamedVideoSource([part],{...metadata,keyframeInterval:12},{...fake,...size,diagnostics:true,fetcher:async()=>new Response(new Uint8Array(60))});
 try{
  const cold=source.frameAt(0);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(fake.flushes,0);t.mock.timers.tick(size.probeDelay);assert.equal(Math.round((await cold).timestamp*60/1e6),0);
  assert.equal(source.metrics.compatibilityFlushes,1);assert.equal(source.metrics.flushRequired,true);
  let coldFlushes;
  for(let index=1;index<60;index++){
   assert.equal(Math.round((await source.frameAt(index)).timestamp*60/1e6),index);
   assert.ok(fake.images.filter(frame=>!frame.closed).length<=size.maxFrames,'recovery must not enlarge the hardware-picture cache');
   if(index===11){assert.equal(source.metrics.lowDelayReprobes,0);assert.equal(source.metrics.flushRequired,true);coldFlushes=fake.flushes;}
   if(index===12){assert.equal(source.metrics.lowDelayReprobes,1);assert.equal(source.metrics.flushRequired,false);}
  }
  assert.equal(source.metrics.compatibilityFlushes,1,'a successful recovery never waits for another compatibility timer');
  assert.deepEqual(fake.chunks.map(chunk=>Math.round(chunk.timestamp*60/1e6)).filter(index=>index>=12),Array.from({length:48},(_,i)=>i+12),'subsequent GOP pictures must decode exactly once');
  assert.equal(fake.flushes-coldFlushes,4,'recovered groups drain only their prediction tails');
 }finally{source.dispose()}
 assert.ok(fake.images.every(frame=>frame.closed));
});

for(const size of decodeSizes)test(`${size.name} fully buffered decoding retries once and skips mandatory tail and reverse drains`,async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const part={...segment,bytes:60,lastFrame:393,frameCount:60,frames:Array.from({length:60},(_,i)=>[i,1,Number(i%12===0)])},fake=codec({buffered:true});
 const source=await createStreamedVideoSource([part],{...metadata,keyframeInterval:12},{...fake,...size,diagnostics:true,fetcher:async()=>new Response(new Uint8Array(60))});
 try{
  const first=source.frameAt(0);await new Promise(resolve=>setImmediate(resolve));t.mock.timers.tick(size.probeDelay);await first;
  for(const index of [3,23,12])assert.equal(Math.round((await source.frameAt(index)).timestamp*60/1e6),index);
  assert.equal(source.metrics.lowDelayReprobes,0,'reverse and group-tail requests cannot test immediate output');
  let settled=false;const retry=source.frameAt(24).then(frame=>{settled=true;return frame});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(source.metrics.lowDelayReprobes,1);assert.equal(source.metrics.compatibilityFlushes,1);
  t.mock.timers.tick(size.probeDelay-1);await Promise.resolve();assert.equal(settled,false);
  t.mock.timers.tick(1);assert.equal(Math.round((await retry).timestamp*60/1e6),24);
  for(const index of [27,36,39,48,51,59]){
   assert.equal(Math.round((await source.frameAt(index)).timestamp*60/1e6),index);
   assert.ok(fake.images.filter(frame=>!frame.closed).length<=size.maxFrames);
  }
  assert.equal(source.metrics.compatibilityFlushes,2,'a genuinely buffered backend pays exactly one additional deadline probe');
  assert.equal(source.metrics.lowDelayReprobes,1);assert.equal(source.metrics.flushRequired,true);
 }finally{source.dispose()}
 assert.ok(fake.images.every(frame=>frame.closed));
});

test('low-delay recovery recognizes a new section even when both sections start at local GOP zero',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const first={...segment,bytes:12,lastFrame:345,frameCount:12,frames:Array.from({length:12},(_,i)=>[i,1,Number(i%12===0)])};
 const second={...first,url:first.url+'?second',firstFrame:346,lastFrame:357},fake=codec({coldBuffered:true,asyncOutput:true});
 const source=await createStreamedVideoSource([first,second],{...metadata,keyframeInterval:12},{...fake,width:3840,height:2160,diagnostics:true,fetcher:async()=>new Response(new Uint8Array(12))});
 try{
  const cold=source.frameAt(0);await new Promise(resolve=>setImmediate(resolve));t.mock.timers.tick(100);await cold;
  assert.equal(Math.round((await source.frameAt(12)).timestamp*60/1e6),12);
  assert.equal(source.metrics.lowDelayReprobes,1);assert.equal(source.metrics.flushRequired,false);assert.equal(source.metrics.compatibilityFlushes,1);
 }finally{source.dispose()}
 assert.ok(fake.images.every(frame=>frame.closed));
});

for(const size of decodeSizes)test(`${size.name} disposal rejects an in-flight decode without waiting for its timeout`,async()=>{
 const part={...segment,bytes:12,lastFrame:345,frameCount:12,frames:Array.from({length:12},(_,i)=>[i,1,Number(i%12===0)])},fake=codec({dropOutput:true});
 const source=await createStreamedVideoSource([part],{...metadata,keyframeInterval:12},{...fake,...size,fetcher:async()=>new Response(new Uint8Array(12))});
 const pending=assert.rejects(source.frameAt(0),{name:'AbortError'});
 await new Promise(resolve=>setImmediate(resolve));assert.ok(fake.chunks.length>0);
 source.dispose();await pending;assert.ok(fake.images.every(frame=>frame.closed));
});

for(const size of decodeSizes)test(`${size.name} reversing before queued output arrives closes duplicate timestamp frames`,async()=>{
 const part={...segment,bytes:12,lastFrame:345,frameCount:12,frames:Array.from({length:12},(_,i)=>[i,1,Number(i%12===0)])},fake=codec({buffered:true});
 const source=await createStreamedVideoSource([part],{...metadata,keyframeInterval:12},{...fake,...size,fetcher:async()=>new Response(new Uint8Array(12))});
 try{
  const forward=source.frameAt(1);await new Promise(resolve=>setImmediate(resolve));
  fake.output(2);assert.equal(Math.round((await forward).timestamp*60/1e6),1);
  const queued=fake.images.find(frame=>Math.round(frame.timestamp*60/1e6)===2);
  assert.equal(queued.closed,false,'the previous decode still owns queued pictures');
  assert.equal(Math.round((await source.frameAt(0)).timestamp*60/1e6),0);
  const duplicates=fake.images.filter(frame=>Math.round(frame.timestamp*60/1e6)===2);
  assert.equal(duplicates.length,2,'the reverse keyframe prefix includes an already queued timestamp');
  assert.equal(queued.closed,true,'replacing a queued picture must release the old VideoFrame');
  assert.equal(duplicates.at(-1).closed,false,'retain the replacement for the current window');
  assert.ok(fake.images.filter(frame=>!frame.closed).length<=size.maxFrames);
 }finally{source.dispose()}
 assert.ok(fake.images.every(frame=>frame.closed));
});

test('opt-in decoder metrics separate cache hits, chunk submission and compatibility drains',async()=>{
 const part={...segment,bytes:12,lastFrame:345,frameCount:12,frames:Array.from({length:12},(_,i)=>[i,1,Number(i%12===0)])},fake=codec({buffered:true});
 let time=0;
 const source=await createStreamedVideoSource([part],{...metadata,keyframeInterval:12},{...fake,width:3840,height:2160,diagnostics:true,clock:()=>++time,fetcher:async()=>new Response(new Uint8Array(12))});
 try{
  await source.frameAt(0);await source.frameAt(0);await source.frameAt(4);
  const stats=source.metrics;
  assert.equal(stats.requests,3);assert.equal(stats.cacheHits,1);
  assert.equal(stats.flushes,2);assert.equal(stats.compatibilityFlushes,1);assert.equal(stats.flushRequired,true);
  assert.equal(stats.compatibilityProbeDelayMs,100);
  assert.equal(stats.chunks,fake.chunks.length);assert.equal(stats.decodeWait.samples,2);
  assert.ok(stats.decodeWait.p95Ms>=0);assert.ok(stats.retainedFrames<=3);
 }finally{source.dispose()}
 const quiet=await createStreamedVideoSource([segment],metadata,{...codec(),fetcher:async()=>new Response(new Uint8Array(8))});
 try{await quiet.frameAt(0);assert.equal(quiet.metrics,null)}finally{quiet.dispose()}
});

test('preempted background sections retain received bytes and can become visible without decoder downgrade',async()=>{
 const next={...segment,url:segment.url+'?next',firstFrame:342,lastFrame:349},requests=[];
 let rejected=false,rejectPrefetch;
 const fetcher=async(url,options)=>{
  requests.push({url,priority:options.priority,range:options.headers?.Range});
  if(url===next.url&&options.priority==='low'&&!rejected){
   rejected=true;return await new Promise((_resolve,reject)=>{rejectPrefetch=reject});
  }
  const range=options.headers?.Range;
  if(!range)return new Response(new Uint8Array(8));
  const [,from,to]=/bytes=(\d+)-(\d+)/.exec(range);
  return new Response(new Uint8Array(Number(to)-Number(from)+1),{status:206,headers:{'Content-Range':`bytes ${from}-${to}/8`}});
 };
 const source=await createStreamedVideoSource([segment,next],metadata,{...codec(),fetcher});
 try{
  await source.frameAt(0);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(rejected,true);
  const entering=source.frameAt(8);
  rejectPrefetch(new DOMException('Video prefetch superseded','AbortError'));
  const result=await entering;
  assert.equal(Math.round(result.timestamp*60/1e6),8);
  assert.ok(requests.some(request=>request.url===next.url&&request.priority==='high'));
 }finally{source.dispose()}
});

test('cancelling a missing-byte seek preserves its prefix for retry and complete-section caching',{timeout:1500},async()=>{
 const fake=codec(),requests=[],stored=new Map();let firstSignal;
 const cache={match:async url=>stored.get(url)?.clone(),put:async(url,response)=>stored.set(url,response.clone()),
  keys:async()=>[...stored.keys()].map(url=>({url})),delete:async key=>stored.delete(key.url??key)};
 const fetcher=async(url,options)=>{
  requests.push(options.headers?.Range);
  if(requests.length===1){
   firstSignal=options.signal;
   return new Response(new ReadableStream({start(controller){
    controller.enqueue(Uint8Array.of(11,12));
    options.signal.addEventListener('abort',()=>controller.error(options.signal.reason),{once:true});
   }}));
  }
  assert.equal(options.headers.Range,'bytes=2-7','reuse bytes received before the cancelled seek');
  return new Response(Uint8Array.of(13,14,15,16,17,18),{status:206,headers:{'Content-Range':'bytes 2-7/8'}});
 };
 const source=await createStreamedVideoSource([segment],metadata,{...fake,fetcher,cacheStorage:{open:async()=>cache},diagnostics:true});
 try{
  const obsolete=assert.rejects(source.frameAt(0),{name:'AbortError'});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(fake.chunks.length,0);
  assert.equal(source.cancelPending(),true);assert.equal(source.cancelPending(),false);
  const retry=source.frameAt(0);await obsolete;
  assert.equal(Math.round((await retry).timestamp*60/1e6),0);assert.equal(firstSignal.aborted,true);
  assert.deepEqual(fake.chunks.slice(0,4).map(chunk=>chunk.data[0]),[11,12,13,14]);
  await source.frameAt(7);await source.frameAt(0);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(requests,[undefined,'bytes=2-7']);
  assert.deepEqual([...new Uint8Array(await stored.get(segment.url).arrayBuffer())],[11,12,13,14,15,16,17,18]);
  assert.equal(source.metrics.networkWait.samples,2,'cancelled and successful waits retain their diagnostic samples');
  assert.equal(source.cancelPending(),false);
 }finally{source.dispose()}
 assert.ok(fake.images.every(frame=>frame.closed));
});

test('a replacement network wait survives the cancelled seek finally and can itself be superseded',{timeout:1500},async()=>{
 const next={...segment,url:segment.url+'?next',firstFrame:342,lastFrame:349},fake=codec(),requests=[],signals=[];
 const fetcher=async(url,options)=>{
  requests.push({url,range:options.headers?.Range});signals.push(options.signal);
  if(requests.length<=2)return new Response(new ReadableStream({start(controller){
   controller.enqueue(Uint8Array.of(1,2));
   options.signal.addEventListener('abort',()=>controller.error(options.signal.reason),{once:true});
  }}));
  assert.equal(url,next.url);assert.equal(options.headers.Range,'bytes=2-7');
  return new Response(new Uint8Array(6),{status:206,headers:{'Content-Range':'bytes 2-7/8'}});
 };
 const source=await createStreamedVideoSource([segment,next],metadata,{...fake,fetcher});
 try{
  const old=assert.rejects(source.frameAt(0),{name:'AbortError'});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(source.cancelPending(),true);
  const replacement=assert.rejects(source.frameAt(8),{name:'AbortError'});
  await old;await new Promise(resolve=>setImmediate(resolve));
  assert.equal(source.cancelPending(),true,'old finally must not clear the newer network waiter');
  const newest=source.frameAt(8);await replacement;
  assert.equal(Math.round((await newest).timestamp*60/1e6),8);
  assert.ok(signals.slice(0,2).every(signal=>signal.aborted));
  assert.deepEqual(requests,[{url:segment.url,range:undefined},{url:next.url,range:undefined},{url:next.url,range:'bytes=2-7'}]);
 }finally{source.dispose()}
 assert.ok(fake.images.every(frame=>frame.closed));
});

test('network cancellation is a no-op during an in-flight decoder flush and on decoded cache hits',{timeout:1500},async()=>{
 const fake=codec(),flush=fake.Decoder.prototype.flush;let finishFlush;
 fake.Decoder.prototype.flush=function(){return new Promise(resolve=>{finishFlush=()=>flush.call(this).then(resolve)})};
 const source=await createStreamedVideoSource([segment],metadata,{...fake,fetcher:async()=>new Response(new Uint8Array(8))});
 try{
  const pending=source.frameAt(0);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(fake.chunks.length,4);assert.equal(source.cancelPending(),false);
  assert.ok(fake.images.every(frame=>!frame.closed),'network-only cancellation keeps the pending decoder output');
  finishFlush();assert.equal(Math.round((await pending).timestamp*60/1e6),0);
  assert.equal(source.cancelPending(),false);
  assert.equal(Math.round((await source.frameAt(2)).timestamp*60/1e6),2);
  assert.equal(fake.chunks.length,4);assert.equal(fake.flushes,1);
 }finally{source.dispose()}
 assert.ok(fake.images.every(frame=>frame.closed));
});

test('disposing a cancelled-and-retried network wait aborts the replacement and leaves no cancellable waiter',{timeout:1500},async()=>{
 const signals=[],fake=codec();let closes=0;const close=fake.Decoder.prototype.close;
 fake.Decoder.prototype.close=function(){closes++;close.call(this)};
 const fetcher=async(_url,{signal})=>{signals.push(signal);return new Response(new ReadableStream({start(controller){
  signal.addEventListener('abort',()=>controller.error(signal.reason),{once:true});
 }}))};
 const source=await createStreamedVideoSource([segment],metadata,{...fake,fetcher});
 const old=assert.rejects(source.frameAt(0),{name:'AbortError'});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(source.cancelPending(),true);
 const retry=assert.rejects(source.frameAt(0),{name:'AbortError'});await old;
 await new Promise(resolve=>setImmediate(resolve));source.dispose();
 assert.equal(source.cancelPending(),false);await retry;source.dispose();
 assert.equal(source.cancelPending(),false);assert.equal(closes,1);assert.equal(signals.length,2);
 assert.ok(signals.every(signal=>signal.aborted));assert.equal(fake.chunks.length,0);
});

test('a picture is returned once decoded; a slow group drain neither delays it nor settles a later request',{timeout:1500},async()=>{
 const part={...segment,bytes:16,lastFrame:349,frameCount:16,frames:Array.from({length:16},(_,i)=>[i,1,Number(i%4===0)])},fake=codec({asyncOutput:true}),flush=fake.Decoder.prototype.flush;let finishFlush;
 fake.Decoder.prototype.flush=function(){return new Promise(resolve=>{finishFlush=()=>flush.call(this).then(resolve)})};
 const source=await createStreamedVideoSource([part],metadata,{...fake,fetcher:async()=>new Response(new Uint8Array(16))});
 try{
  // The drain never completes, yet the requested picture is delivered.
  assert.equal(Math.round((await source.frameAt(0)).timestamp*60/1e6),0);
  // A later group must resolve from its own output, not from the old drain.
  assert.equal(Math.round((await source.frameAt(5)).timestamp*60/1e6),5);
  finishFlush?.();
 }finally{source.dispose()}
});
