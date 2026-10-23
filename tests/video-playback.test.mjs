import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareInlineVideo,waitForVideo,connectOpeningVideo} from '../assets/video-playback.js';
import {createFrameSource} from '../assets/frame-source.js';

class Video extends EventTarget {
 videoWidth=1920;videoHeight=1080;
 readyState=0;seeking=false;paused=true;ended=false;error=null;attrs=new Map();calls=0;loads=0;time=0;
 setAttribute(name,value){this.attrs.set(name,value)}
 removeAttribute(name){this.attrs.delete(name)}
 get currentTime(){return this.time}
 set currentTime(value){this.time=value;this.seeking=true}
 load(){this.loads++;this.error=null}
 pause(){this.paused=true;this.dispatchEvent(new Event('pause'))}
 play(){this.calls++;if(this.reject)return Promise.reject(new DOMException('Gesture required','NotAllowedError'));this.paused=false;this.dispatchEvent(new Event('playing'));return Promise.resolve()}
}
const turn=()=>new Promise(resolve=>setTimeout(resolve,0));
function snapshotEnvironment(t){
 const previous=globalThis.VideoFrame;
 globalThis.VideoFrame=class{constructor(video){this.time=video.currentTime;this.width=video.videoWidth;this.height=video.videoHeight}close(){this.closed=true}};
 t.after(()=>{globalThis.VideoFrame=previous});
}
function environment(t){
 const oldDocument=globalThis.document,oldWindow=globalThis.window;
 globalThis.document=Object.assign(new EventTarget(),{hidden:false});globalThis.window=new EventTarget();
 t.after(()=>{globalThis.document=oldDocument;globalThis.window=oldWindow});
 const video=new Video(),button=Object.assign(new EventTarget(),{innerHTML:'Enter SOFACET',hidden:true});let ended=0,frames=0;
 const player=connectOpeningVideo(video,button,()=>ended++,()=>frames++);t.after(()=>player.destroy());
 return{video,button,player,get ended(){return ended},get frames(){return frames}};
}

test('silent inline properties and legacy attributes are set together',()=>{
 const video=new Video();prepareInlineVideo(video);assert.ok(video.muted&&video.defaultMuted&&video.playsInline);assert.ok(video.attrs.has('webkit-playsinline'));assert.ok(!video.attrs.has('autoplay')&&!video.attrs.has('loop'));
});
test('a completed seek must also have decoded data before drawing',async()=>{
 const video=new Video();video.readyState=1;video.seeking=true;let done=false;
 const wait=waitForVideo(video,{readyState:2}).then(()=>done=true);
 video.seeking=false;video.dispatchEvent(new Event('seeked'));await turn();assert.equal(done,false);
 video.readyState=2;video.dispatchEvent(new Event('loadeddata'));await wait;assert.equal(done,true);
});
test('video readiness waits are bounded, cancellable and reject media errors',async()=>{
 const video=new Video();await assert.rejects(waitForVideo(video,{timeout:5}),/still loading/);
 const controller=new AbortController(),wait=waitForVideo(video,{signal:controller.signal});controller.abort();await assert.rejects(wait,{name:'AbortError'});
 video.error={code:2};await assert.rejects(waitForVideo(video),/could not load/);
});
test('native readiness can complete on a paint before the queued seeked event',async t=>{
 const oldRequest=globalThis.requestAnimationFrame,oldCancel=globalThis.cancelAnimationFrame,callbacks=new Map();let id=0;
 globalThis.requestAnimationFrame=fn=>{callbacks.set(++id,fn);return id};
 globalThis.cancelAnimationFrame=id=>callbacks.delete(id);
 t.after(()=>{globalThis.requestAnimationFrame=oldRequest;globalThis.cancelAnimationFrame=oldCancel});
 const paint=()=>{const batch=[...callbacks.values()];callbacks.clear();for(const callback of batch)callback()};
 const video=new Video();video.readyState=2;video.seeking=true;let done=false;
 const pending=waitForVideo(video,{readyState:2,pollOnPaint:true}).then(()=>done=true);
 paint();await turn();assert.equal(done,false);assert.equal(callbacks.size,1);
 video.seeking=false;video.readyState=1;paint();await turn();assert.equal(done,false,'The seek must also have decoded data');
 video.readyState=2;paint();await pending;assert.equal(done,true);assert.equal(callbacks.size,0);
 video.dispatchEvent(new Event('seeked'));assert.equal(callbacks.size,0);
 video.seeking=true;const controller=new AbortController(),cancelled=waitForVideo(video,{signal:controller.signal,pollOnPaint:true});
 assert.equal(callbacks.size,1);controller.abort();await assert.rejects(cancelled,{name:'AbortError'});assert.equal(callbacks.size,0);
});
test('native readiness polling completes between paints only after decoded data is ready',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const video=new Video();video.readyState=2;video.seeking=true;let done=false;
 const pending=waitForVideo(video,{readyState:2,pollInterval:4}).then(()=>done=true);
 t.mock.timers.tick(4);await Promise.resolve();assert.equal(done,false);
 video.seeking=false;video.readyState=1;t.mock.timers.tick(4);await Promise.resolve();assert.equal(done,false,'A completed seek without decoded data is not ready');
 video.readyState=2;t.mock.timers.tick(4);await pending;assert.equal(done,true);
 video.error={code:2};t.mock.timers.tick(15000);video.dispatchEvent(new Event('seeked'));
 assert.equal(done,true,'Late media events and deadlines must not change a completed wait');
});
test('native readiness polling stops on cancellation, media errors and timeout',async t=>{
 const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout,timers=new Map();let id=0;
 globalThis.setTimeout=(fn,delay)=>{timers.set(++id,{fn,delay});return id};
 globalThis.clearTimeout=id=>timers.delete(id);
 t.after(()=>{globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear});
 const video=new Video();video.readyState=2;video.seeking=true;
 const controller=new AbortController(),cancelled=waitForVideo(video,{pollInterval:4,signal:controller.signal});
 assert.equal(timers.size,2);controller.abort();await assert.rejects(cancelled,{name:'AbortError'});assert.equal(timers.size,0);
 const failed=waitForVideo(video,{pollInterval:4});video.error={code:3};video.dispatchEvent(new Event('error'));
 await assert.rejects(failed,{name:'EncodingError'});assert.equal(timers.size,0);
 video.error=null;const expired=waitForVideo(video,{pollInterval:4,timeout:20});
 [...timers.values()].find(timer=>timer.delay===20).fn();await assert.rejects(expired,/still loading/);assert.equal(timers.size,0);
 const completed=waitForVideo(video,{pollInterval:4});video.seeking=false;video.dispatchEvent(new Event('seeked'));
 await completed;assert.equal(timers.size,0);
 video.seeking=true;const ordinary=waitForVideo(video);assert.equal(timers.size,1,'Other video waits must remain event-driven');
 video.seeking=false;video.dispatchEvent(new Event('seeked'));await ordinary;assert.equal(timers.size,0);
});
test('denied autoplay shows a working gesture button without automatic retries',async t=>{
 const e=environment(t);e.video.reject=true;e.player.start();await turn();assert.equal(e.button.hidden,false);assert.equal(e.video.calls,1);
 e.video.dispatchEvent(new Event('canplay'));await turn();assert.equal(e.video.calls,1);
 e.video.reject=false;e.button.dispatchEvent(new Event('click'));await turn();assert.equal(e.video.calls,2);assert.equal(e.button.hidden,true);assert.ok(e.frames);
});
test('unexpected pause prompts; visibility and bfcache resume once without restarting',async t=>{
 const e=environment(t);e.player.start();await turn();e.video.time=1.5;
 document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));assert.ok(e.video.paused);assert.equal(e.button.hidden,true);
 document.hidden=false;document.dispatchEvent(new Event('visibilitychange'));await turn();assert.equal(e.video.calls,2);assert.equal(e.video.time,1.5);
 window.dispatchEvent(new Event('pagehide'));const show=Object.assign(new Event('pageshow'),{persisted:true});window.dispatchEvent(show);await turn();assert.equal(e.video.calls,3);
 e.video.pause();assert.equal(e.button.hidden,false);assert.equal(e.video.calls,3);
});
test('reduced motion waits for a click; unsupported media can continue to the existing still',async t=>{
 const e=environment(t);e.player.start(true);assert.equal(e.video.calls,0);assert.equal(e.button.innerHTML,'Enter SOFACET');assert.equal(e.button.hidden,false);
 e.video.error={code:4};e.video.dispatchEvent(new Event('error'));e.button.dispatchEvent(new Event('click'));assert.equal(e.ended,1);assert.equal(e.video.calls,0);
 e.video.dispatchEvent(new Event('ended'));assert.equal(e.ended,1);
});
test('an opening initialized in a background tab waits and starts on return',async t=>{
 const e=environment(t);document.hidden=true;e.player.start();assert.equal(e.video.calls,0);
 document.hidden=false;document.dispatchEvent(new Event('visibilitychange'));await turn();assert.equal(e.video.calls,1);assert.equal(e.button.hidden,true);
});
test('destroy ignores a late rejected play promise and removes controls/listeners',async t=>{
 const e=environment(t);let reject;e.video.play=()=>{e.video.calls++;return new Promise((_,r)=>reject=r)};e.player.start();e.player.destroy();reject(Error('late'));await turn();
 e.button.dispatchEvent(new Event('click'));assert.equal(e.video.calls,1);assert.equal(e.button.hidden,true);assert.equal(e.ended,0);
});
test('native journey suspends pending work and recovers from a fresh metadata load',async t=>{
 snapshotEnvironment(t);
 const video=new Video(),source=await createFrameSource(video,{source:'./journey.mp4',fps:60},new URL('https://example.test/assets/index.json'));
 const first=source.decode(4);source.suspend();await assert.rejects(first,{name:'AbortError'});
 const next=source.decode(4);video.readyState=1;video.dispatchEvent(new Event('loadedmetadata'));await turn();assert.equal(video.currentTime,0);
 video.readyState=2;video.dispatchEvent(new Event('loadeddata'));await turn();assert.equal(video.currentTime,4.25/60);
 video.readyState=2;video.seeking=false;video.dispatchEvent(new Event('seeked'));const image=await next;
 assert.notEqual(image,video);assert.equal(image.time,4.25/60);image.close();source.destroy();
});
test('native video warms decoded data before seeking and retries blocked playback in the gesture',async t=>{
 snapshotEnvironment(t);
 const previousDocument=globalThis.document;
 globalThis.document=Object.assign(new EventTarget(),{hidden:false});
 t.after(()=>{globalThis.document=previousDocument});
 const video=new Video();video.hidden=true;video.reject=true;
 const source=await createFrameSource(video,{source:'./journey.mp4',fps:60},new URL('https://example.test/assets/index.json'));
 t.after(()=>source.destroy());
 const decoded=source.decode(60);
 assert.equal(video.hidden,false);assert.equal(video.preload,'auto');assert.equal(video.calls,1);
 video.readyState=1;video.dispatchEvent(new Event('loadedmetadata'));await turn();
 assert.equal(video.currentTime,0);
 video.reject=false;document.dispatchEvent(new Event('touchend'));
 assert.equal(video.calls,2,'play must run inside the gesture, before an async boundary');
 video.readyState=2;video.dispatchEvent(new Event('loadeddata'));await turn();
 assert.ok(video.paused);assert.equal(video.currentTime,60.25/60);
 video.seeking=false;video.dispatchEvent(new Event('seeked'));const image=await decoded;
 assert.equal(image.time,60.25/60);assert.equal(image.width,1920);assert.equal(image.height,1080);
 video.time=2;assert.equal(image.time,60.25/60,'Cached pixels must survive another seek');image.close();
 document.dispatchEvent(new Event('click'));assert.equal(video.calls,2,'normal scrolling must not restart playback');
 source.destroy();document.dispatchEvent(new Event('touchend'));assert.equal(video.calls,2);
});
test('suspending a native seek does not retain a frame from the cancelled generation',async t=>{
 snapshotEnvironment(t);let created=0;
 globalThis.VideoFrame=class{constructor(){created++}close(){}};
 const video=new Video();video.readyState=2;
 const source=await createFrameSource(video,{source:'./journey.mp4',fps:60},new URL('https://example.test/index.json'));
 t.after(()=>source.destroy());
 const pending=source.decode(4);await turn();assert.ok(video.seeking);
 source.suspend();video.seeking=false;video.dispatchEvent(new Event('seeked'));
 await assert.rejects(pending,{name:'AbortError'});assert.equal(created,0);
});
test('reversing scroll cancels the obsolete native seek without discarding its buffer',async t=>{
 snapshotEnvironment(t);
 const video=new Video();video.readyState=2;
 const source=await createFrameSource(video,{source:'./journey.mp4',fps:60},new URL('https://example.test/index.json'));
 t.after(()=>source.destroy());
 const forward=source.decode(20);await turn();assert.ok(video.seeking);
 source.retarget(30,10); // A useful forward seek is allowed to finish.
 source.retarget(15,10); // Reverse before crossing the last presented frame.
 await assert.rejects(forward,{name:'AbortError'});
 const reverse=source.decode(15);await turn();assert.equal(video.currentTime,15.25/60);
 video.seeking=false;video.dispatchEvent(new Event('seeked'));
 const image=await reverse;assert.equal(image.time,15.25/60);image.close();
 assert.equal(video.loads,1,'Direction changes must retain the existing media buffer');
});
test('a browser without native VideoFrame support uses the original native video compositor',async t=>{
 snapshotEnvironment(t);globalThis.VideoFrame=class{constructor(){throw new TypeError('Unsupported source')}};
 const video=new Video();video.readyState=2;video.time=4.25/60;
 const source=await createFrameSource(video,{source:'./journey.mp4',fps:60},new URL('https://example.test/index.json'));
 t.after(()=>source.destroy());
 const image=await source.decode(4);
 assert.equal(image,video);assert.equal(image.videoWidth,1920);assert.equal(image.videoHeight,1080);
 assert.equal(source.transient,true);assert.equal(source.stats.renderer,'native-video');image.close();
 source.suspend();await source.decode(4);
 assert.equal(video.loads,1,'Returning to an already decoded frame must keep its native buffer');
 assert.equal(video.currentTime,4.25/60);
});
test('an indexed all-IDR native seek accepts the requested sync frame without a second seek',async t=>{
 snapshotEnvironment(t);
 const video=new Video();video.readyState=2;let fastCalls=0;
 video.fastSeek=time=>{fastCalls++;video.time=Math.floor(time*60)/60;video.seeking=true};
 const source=await createFrameSource(video,{source:'./journey.mp4',fps:60,version:1,frameCount:30,frames:Array(30).fill([0,10])},new URL('https://example.test/index.json'));
 t.after(()=>source.destroy());
 const pending=source.decode(20);await turn();assert.equal(fastCalls,1);assert.equal(video.currentTime,20/60);
 video.seeking=false;video.dispatchEvent(new Event('seeked'));
 const image=await pending;assert.equal(image.time,20/60);assert.equal(video.seeking,false);image.close();
});
test('an approximate native seek corrects the frame and disables further approximate seeks',async t=>{
 snapshotEnvironment(t);
 const video=new Video();video.readyState=2;let fastCalls=0,done=false;
 video.fastSeek=()=>{fastCalls++;video.time=10/60;video.seeking=true};
 const source=await createFrameSource(video,{source:'./journey.mp4',fps:60,version:1,frameCount:30,frames:Array(30).fill([0,10])},new URL('https://example.test/index.json'));
 t.after(()=>source.destroy());
 const pending=source.decode(20).then(image=>{done=true;return image});await turn();
 video.seeking=false;video.dispatchEvent(new Event('seeked'));await turn();
 assert.equal(done,false,'An approximate frame must not be presented as the requested frame');
 assert.equal(video.currentTime,20.25/60);assert.equal(video.seeking,true);
 video.seeking=false;video.dispatchEvent(new Event('seeked'));const image=await pending;assert.equal(image.time,20.25/60);image.close();
 const next=source.decode(21);await turn();assert.equal(fastCalls,1);assert.equal(video.currentTime,21.25/60);
 video.seeking=false;video.dispatchEvent(new Event('seeked'));(await next).close();
});
test('native fast seeking requires the complete verified frame index and a working browser method',async t=>{
 snapshotEnvironment(t);
 const video=new Video();video.readyState=2;
 video.fastSeek=()=>assert.fail('Unindexed media must use precise seeking');
 const source=await createFrameSource(video,{source:'./journey.mp4',fps:60},new URL('https://example.test/index.json'));
 t.after(()=>source.destroy());
 const pending=source.decode(20);await turn();assert.equal(video.currentTime,20.25/60);
 video.seeking=false;video.dispatchEvent(new Event('seeked'));(await pending).close();
 const other=new Video();other.readyState=2;other.fastSeek=()=>{throw new TypeError('Unsupported')};
 const fallback=await createFrameSource(other,{source:'./journey.mp4',fps:60,version:1,frameCount:30,frames:Array(30).fill([0,10])},new URL('https://example.test/index.json'));
 t.after(()=>fallback.destroy());
 const precise=fallback.decode(20);await turn();assert.equal(other.currentTime,20.25/60);
 other.seeking=false;other.dispatchEvent(new Event('seeked'));(await precise).close();
});
test('reversing an approximate native seek cancels it before any corrective seek',async t=>{
 snapshotEnvironment(t);
 const video=new Video();video.readyState=2;
 video.fastSeek=time=>{video.time=Math.floor(time*60)/60;video.seeking=true};
 const source=await createFrameSource(video,{source:'./journey.mp4',fps:60,version:1,frameCount:30,frames:Array(30).fill([0,10])},new URL('https://example.test/index.json'));
 t.after(()=>source.destroy());
 const pending=source.decode(20);await turn();source.retarget(15,10);
 await assert.rejects(pending,{name:'AbortError'});
 video.time=18/60;video.seeking=false;video.dispatchEvent(new Event('seeked'));await turn();assert.equal(video.currentTime,18/60);
 const reverse=source.decode(15);await turn();video.seeking=false;video.dispatchEvent(new Event('seeked'));const image=await reverse;assert.equal(image.time,15/60);image.close();
});
test('touch devices use the native compositor even when VideoFrame is supported',async t=>{
 snapshotEnvironment(t);const previous=globalThis.matchMedia;
 globalThis.matchMedia=()=>({matches:true});t.after(()=>{globalThis.matchMedia=previous});
 globalThis.VideoFrame=class{constructor(){assert.fail('Touch playback should not copy the native decoder surface')}};
 const video=new Video();video.readyState=2;video.time=4.25/60;
 const source=await createFrameSource(video,{source:'./journey.mp4',fps:60},new URL('https://example.test/index.json'));
 t.after(()=>source.destroy());assert.equal(await source.decode(4),video);
 assert.equal(source.stats.renderer,'native-video');assert.equal(source.transient,true);
});
test('touch devices with efficient native decoding bypass per-frame downloads',async t=>{
 const previousMedia=globalThis.matchMedia,previousDecoder=globalThis.VideoDecoder,previousCapabilities=navigator.mediaCapabilities;
 globalThis.matchMedia=()=>({matches:true});
 navigator.mediaCapabilities={async decodingInfo(){return{supported:true,smooth:true,powerEfficient:true}}};
 globalThis.VideoDecoder=class{static async isConfigSupported(){assert.fail('Touch video must use the native media buffer')}};
 t.after(()=>{globalThis.matchMedia=previousMedia;globalThis.VideoDecoder=previousDecoder;navigator.mediaCapabilities=previousCapabilities});
 const video=new Video();video.readyState=2;video.time=4.25/60;
 const source=await createFrameSource(video,{source:'./journey.mp4',fps:60,codec:'avc1.64002a',sha256:'d'.repeat(64),width:1920,height:1080,frames:[[0,10]]},new URL('https://example.test/index.json'));
 t.after(()=>source.destroy());
 assert.equal(source.mode,'video');assert.equal(await source.decode(4),video);
 assert.equal(source.stats.networkRequests,0);assert.equal(source.stats.fallbackReason,'native-touch');
 assert.equal(source.transient,true);
});
test('touch devices retain WebCodecs when native decoding is reported inefficient',async t=>{
 const previousMedia=globalThis.matchMedia,previousDecoder=globalThis.VideoDecoder,previousCapabilities=navigator.mediaCapabilities;
 globalThis.matchMedia=()=>({matches:true});
 navigator.mediaCapabilities={async decodingInfo(config){assert.equal(config.video.framerate,60);assert.equal(config.video.bitrate,4800);return{supported:true,smooth:true,powerEfficient:false}}};
 globalThis.VideoDecoder=class{static async isConfigSupported(){return{supported:true}}state='configured';configure(){}close(){this.state='closed'}};
 t.after(()=>{globalThis.matchMedia=previousMedia;globalThis.VideoDecoder=previousDecoder;navigator.mediaCapabilities=previousCapabilities});
 const source=await createFrameSource(new Video(),{source:'./journey.mp4',fps:60,codec:'avc1.64002a',sha256:'e'.repeat(64),width:1920,height:1080,bytes:10,frameCount:1,frames:[[0,10]]},new URL('https://example.test/index.json'));
 t.after(()=>source.destroy());assert.equal(source.mode,'webcodecs');
});
test('a stalled compressed-frame request times out and releases its request slot',async t=>{
 const oldFetch=globalThis.fetch,oldDecoder=globalThis.VideoDecoder;let fetching=false;
 globalThis.VideoDecoder=class{static async isConfigSupported(){return{supported:true}}state='configured';configure(){}close(){this.state='closed'}};
 globalThis.fetch=(_url,{signal})=>{fetching=true;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))};
 t.after(()=>{globalThis.fetch=oldFetch;globalThis.VideoDecoder=oldDecoder});
 t.mock.timers.enable({apis:['setTimeout']});
 const source=await createFrameSource(new Video(),{source:'./journey.mp4',codec:'avc1.64002a',sha256:'a'.repeat(64),frames:[[0,10]]},new URL('https://example.test/assets/index.json'));
 const request=source.load(0,new AbortController().signal);for(let i=0;i<10&&!fetching;i++)await Promise.resolve();assert.ok(fetching);
 t.mock.timers.tick(15001);await assert.rejects(request,{name:'TimeoutError'});assert.equal(source.mode,'webcodecs');source.destroy();
});
test('adjacent compressed frames use one validated range and independent buffers',async t=>{
 const oldFetch=globalThis.fetch,oldDecoder=globalThis.VideoDecoder,oldCaches=globalThis.caches;
 const ranges=[];
 globalThis.caches=undefined;
 globalThis.VideoDecoder=class{static async isConfigSupported(){return{supported:true}}state='configured';configure(){}close(){this.state='closed'}};
 globalThis.fetch=async(_url,{headers})=>{
  ranges.push(headers.Range);
  return new Response(Uint8Array.from([1,2,3,4,5,6,7,8,9]),{status:206,headers:{'Content-Range':'bytes 100-108/200'}});
 };
 t.after(()=>{globalThis.fetch=oldFetch;globalThis.VideoDecoder=oldDecoder;globalThis.caches=oldCaches});
 const index={source:'./journey.mp4',codec:'avc1.64002a',sha256:'b'.repeat(64),bytes:200,frames:[[100,2],[102,3],[105,4]]};
 const source=await createFrameSource(new Video(),index,new URL('https://example.test/assets/index.json'));
 t.after(()=>source.destroy());
 const frames=await source.loadFrames([2,1,0],new AbortController().signal,9);
 assert.deepEqual(ranges,['bytes=100-108']);
 assert.deepEqual([...frames.get(1)],[3,4,5]);
 assert.equal(frames.get(1).buffer.byteLength,3);
 assert.equal(source.stats.networkRequests,1);assert.equal(source.stats.networkFrames,3);
 await assert.rejects(source.loadFrames([0,1,2],new AbortController().signal,8),/cache budget/);
 assert.equal(ranges.length,1);
 globalThis.fetch=async()=>new Response(new Uint8Array(9),{status:200});
 await assert.rejects(source.loadFrames([0,1,2],new AbortController().signal),/ranges are unavailable/);
 const controller=new AbortController();controller.abort();
 await assert.rejects(source.loadFrames([0],controller.signal),{name:'AbortError'});
});

test('a failed CDN range retries the identical indexed bytes on Railway without disabling WebCodecs',async t=>{
 const oldFetch=globalThis.fetch,oldDecoder=globalThis.VideoDecoder,oldCaches=globalThis.caches,requests=[];
 globalThis.caches=undefined;
 globalThis.VideoDecoder=class{static async isConfigSupported(){return{supported:true}}state='configured';configure(){}close(){this.state='closed'}};
 globalThis.fetch=async(url,{headers})=>{
  requests.push([url.origin,headers.Range]);
  if(url.hostname==='media.example')throw new TypeError('CDN unavailable');
  return new Response(new Uint8Array([1,2,3]),{status:206,headers:{'Content-Range':'bytes 100-102/200'}});
 };
 t.after(()=>{globalThis.fetch=oldFetch;globalThis.VideoDecoder=oldDecoder;globalThis.caches=oldCaches});
 const source=await createFrameSource(new Video(),{source:'https://media.example/journey.mp4',fallbackSource:'./journey.mp4',codec:'avc1.64002a',sha256:'c'.repeat(64),bytes:200,width:1280,height:720,frames:[[100,3]]},new URL('https://app.example/assets/index.json'));
 t.after(()=>source.destroy());
 await source.load(0,new AbortController().signal);
 await source.load(0,new AbortController().signal);
 assert.deepEqual(requests,[['https://media.example','bytes=100-102'],['https://app.example','bytes=100-102'],['https://app.example','bytes=100-102']]);
 assert.equal(source.mode,'webcodecs');assert.equal(source.stats.deliveryFallbacks,1);
 assert.equal(source.decodedFrameBytes,1280*720*4);
});

test('a range exposes its first complete frame before the rest of the batch downloads',async t=>{
 const oldFetch=globalThis.fetch,oldDecoder=globalThis.VideoDecoder,oldCaches=globalThis.caches;
 let stream;
 globalThis.caches=undefined;
 globalThis.VideoDecoder=class{static async isConfigSupported(){return{supported:true}}state='configured';configure(){}close(){this.state='closed'}};
 globalThis.fetch=async()=>new Response(new ReadableStream({start(controller){stream=controller}}),{status:206,headers:{'Content-Range':'bytes 100-105/200'}});
 t.after(()=>{globalThis.fetch=oldFetch;globalThis.VideoDecoder=oldDecoder;globalThis.caches=oldCaches});
 const source=await createFrameSource(new Video(),{source:'./journey.mp4',codec:'avc1.64002a',sha256:'d'.repeat(64),bytes:200,frames:[[100,3],[103,3]]},new URL('https://example.test/assets/index.json'));
 t.after(()=>source.destroy());
 const ready=[];
 const loading=source.loadFrames([0,1],new AbortController().signal,6,(frame,bytes)=>ready.push([frame,[...bytes]]));
 await turn();stream.enqueue(new Uint8Array([1,2]));await turn();assert.deepEqual(ready,[]);
 stream.enqueue(new Uint8Array([3,4]));await turn();
 try{assert.deepEqual(ready,[[0,[1,2,3]]],'The camera must not wait for unrelated later frames in the HTTP batch')}
 finally{stream.enqueue(new Uint8Array([5,6]));stream.close();await loading}
 assert.deepEqual(ready,[[0,[1,2,3]],[1,[4,5,6]]]);
});
