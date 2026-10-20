import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareInlineVideo,waitForVideo,connectOpeningVideo} from '../assets/video-playback.js';
import {createFrameSource} from '../assets/frame-source.js';

class Video extends EventTarget {
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
test('native journey suspends pending work and recovers from a fresh metadata load',async()=>{
 const video=new Video(),source=await createFrameSource(video,{source:'./journey.mp4',fps:60},new URL('https://example.test/assets/index.json'));
 const first=source.decode(4);source.suspend();await assert.rejects(first,{name:'AbortError'});
 const next=source.decode(4);video.readyState=1;video.dispatchEvent(new Event('loadedmetadata'));await turn();assert.equal(video.currentTime,4.25/60);
 video.readyState=2;video.seeking=false;video.dispatchEvent(new Event('seeked'));assert.equal(await next,video);source.destroy();
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
