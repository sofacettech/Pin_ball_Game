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
function bitmapEnvironment(t){
 const previous=globalThis.createImageBitmap;
 globalThis.createImageBitmap=async video=>({time:video.currentTime,width:video.videoWidth,height:video.videoHeight,closed:false,close(){this.closed=true}});
 t.after(()=>{globalThis.createImageBitmap=previous});
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
 bitmapEnvironment(t);
 const video=new Video(),source=await createFrameSource(video,{source:'./journey.mp4',fps:60},new URL('https://example.test/assets/index.json'));
 const first=source.decode(4);source.suspend();await assert.rejects(first,{name:'AbortError'});
 const next=source.decode(4);video.readyState=1;video.dispatchEvent(new Event('loadedmetadata'));await turn();assert.equal(video.currentTime,0);
 video.readyState=2;video.dispatchEvent(new Event('loadeddata'));await turn();assert.equal(video.currentTime,4.25/60);
 video.readyState=2;video.seeking=false;video.dispatchEvent(new Event('seeked'));const image=await next;
 assert.notEqual(image,video);assert.equal(image.time,4.25/60);image.close();source.destroy();
});
test('native video warms decoded data before seeking and retries blocked playback in the gesture',async t=>{
 bitmapEnvironment(t);
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
test('suspending a pending native snapshot releases the late full-size bitmap',async t=>{
 bitmapEnvironment(t);let resolve,closed=0;
 globalThis.createImageBitmap=()=>new Promise(r=>resolve=r);
 const video=new Video();video.readyState=2;video.time=4.25/60;
 const source=await createFrameSource(video,{source:'./journey.mp4',fps:60},new URL('https://example.test/index.json'));
 t.after(()=>source.destroy());
 const pending=source.decode(4);await turn();assert.ok(resolve);
 source.suspend();resolve({close(){closed++}});
 await assert.rejects(pending,{name:'AbortError'});assert.equal(closed,1);
});
test('a browser without video bitmap support keeps an unscaled native canvas snapshot',async t=>{
 bitmapEnvironment(t);globalThis.createImageBitmap=async()=>{throw new TypeError('Unsupported source')};
 const previous=globalThis.document,draws=[],canvas={getContext:()=>({drawImage:(...args)=>draws.push(args)})};
 globalThis.document=Object.assign(new EventTarget(),{createElement:()=>canvas});
 t.after(()=>{globalThis.document=previous});
 const video=new Video();video.readyState=2;video.time=4.25/60;
 const source=await createFrameSource(video,{source:'./journey.mp4',fps:60},new URL('https://example.test/index.json'));
 t.after(()=>source.destroy());
 const image=await source.decode(4);
 assert.equal(image.width,1920);assert.equal(image.height,1080);assert.deepEqual(draws,[[video,0,0]]);
 image.close();assert.equal(image.width,0);assert.equal(image.height,0);
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
