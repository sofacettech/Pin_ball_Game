import test from 'node:test';
import assert from 'node:assert/strict';
import {createFrameSource} from '../assets/frame-source.js';

const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve()};
class Video extends EventTarget {
 src='https://example.test/journey.mp4';readyState=2;paused=true;seeking=false;time=0;playbackRate=1;error=null;
 callbacks=new Map();id=0;fastCalls=0;preciseCalls=0;plays=0;
 setAttribute(){} removeAttribute(){} load(){} pause(){this.paused=true}
 play(){this.plays++;this.paused=false;return Promise.resolve()}
 get currentTime(){return this.time}
 set currentTime(time){this.preciseCalls++;this.time=time;this.seeking=true}
 fastSeek(time){this.fastCalls++;this.time=Math.floor(time*60)/60;this.seeking=true}
 requestVideoFrameCallback(callback){this.callbacks.set(++this.id,callback);return this.id}
 cancelVideoFrameCallback(id){this.callbacks.delete(id)}
 present(frame){const batch=[...this.callbacks.values()];this.callbacks.clear();for(const callback of batch)callback(0,{mediaTime:frame/60})}
 complete(){this.seeking=false;this.dispatchEvent(new Event('seeked'))}
}
async function fixture(t,{fastSeek=true}={}){
 const old=globalThis.matchMedia;globalThis.matchMedia=()=>({matches:true});
 const video=new Video();if(!fastSeek)video.fastSeek=undefined;
 const source=await createFrameSource(video,{source:'./journey.mp4',fps:60,version:1,frameCount:30,frames:Array(30).fill([0,10])},new URL('https://example.test/index.json'),()=>assert.fail('Moving frames must not be copied'));
 t.after(()=>{source.destroy();globalThis.matchMedia=old});
 return{video,source};
}

test('moving fast seeks wait for their matching compositor acknowledgment',async t=>{
 const {video,source}=await fixture(t);let done=false;
 const pending=source.decode(20,undefined,false).then(image=>{done=true;return image});await flush();
 assert.equal(video.fastCalls,1);assert.equal(video.callbacks.size,1);
 video.complete();await flush();assert.equal(done,false,'Decoded data must not release another seek before presentation');
 video.present(19);await flush();assert.equal(done,false);assert.equal(video.callbacks.size,1,'Old surface callbacks must be ignored');
 video.present(20);assert.equal(await pending,video);assert.equal(video.callbacks.size,0);
 assert.equal(source.stats.nativePresentationWaits,1);assert.equal(source.stats.nativePresentationTimeouts,0);
 assert.equal(video.plays,0);assert.equal(video.paused,true);assert.equal(source.nativeFastSeek,true);
});

test('a presentation callback before seeked is retained without skipping decoded readiness',async t=>{
 const {video,source}=await fixture(t);let done=false;
 const fastSeek=video.fastSeek.bind(video);
 video.fastSeek=time=>{assert.equal(video.callbacks.size,1,'Subscribe before fastSeek can present its first frame');fastSeek(time);video.present(20)};
 const pending=source.decode(20,undefined,false).then(image=>{done=true;return image});await flush();
 assert.equal(done,false);assert.equal(video.callbacks.size,0,'The early matching acknowledgment is retained');
 video.complete();assert.equal(await pending,video);assert.equal(source.stats.nativePresentationTimeouts,0);
});

test('missing paused-video callbacks add at most one frame after decoded readiness',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const {video,source}=await fixture(t);let done=false;
 const pending=source.decode(20,undefined,false).then(image=>{done=true;return image});await flush();
 t.mock.timers.tick(500);await flush();assert.equal(done,false);assert.equal(source.stats.nativePresentationTimeouts,0,'The acknowledgment deadline starts after decoding');
 video.complete();await flush();t.mock.timers.tick(32);await flush();assert.equal(done,false);
 t.mock.timers.tick(2);assert.equal(await pending,video);assert.equal(source.stats.nativePresentationTimeouts,1);assert.equal(video.callbacks.size,0);
 assert.equal(source.nativeFastSeek,true,'A missing paused callback is not an inaccurate seek');
 t.mock.timers.tick(1000);assert.equal(source.stats.nativePresentationTimeouts,1);
});

for(const action of ['retarget','suspend','destroy'])for(const ready of [false,true]){
 test(`${action} cancels presentation work ${ready?'after':'before'} decoded readiness`,async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const {video,source}=await fixture(t),pending=source.decode(20,undefined,false);await flush();
  if(ready){video.complete();await flush()}
  const lateCallback=[...video.callbacks.values()][0];
  const rejection=assert.rejects(pending,{name:'AbortError'});
  if(action==='retarget')source.retarget(5,10);else source[action]();
  await rejection;assert.equal(video.callbacks.size,0);assert.equal(source.stats.nativeSeeks,0);
  lateCallback(0,{mediaTime:20/60});t.mock.timers.tick(1000);await flush();
  assert.equal(video.callbacks.size,0);assert.equal(source.stats.nativePresentationTimeouts,0,'Cancelled deadlines must not fire later');
 });
}

for(const ready of [false,true]){
 test(`media errors reject and clean acknowledgment work ${ready?'after':'before'} decoded readiness`,async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const {video,source}=await fixture(t),pending=source.decode(20,undefined,false);await flush();
  if(ready){video.complete();await flush()}
  const rejection=assert.rejects(pending,{name:'EncodingError'});
  video.error={code:3};video.dispatchEvent(new Event('error'));await rejection;
  assert.equal(video.callbacks.size,0);t.mock.timers.tick(1000);assert.equal(source.stats.nativePresentationTimeouts,0);
 });
}

for(const failure of ['throw','wrong-frame']){
 test(`fastSeek ${failure} cancels presentation watching before precise fallback`,async t=>{
  const {video,source}=await fixture(t);
  video.fastSeek=()=>{if(failure==='throw')throw new TypeError('Unsupported');video.time=10/60;video.seeking=true};
  const pending=source.decode(20,undefined,false);await flush();
  if(failure==='wrong-frame'){video.complete();await flush()}
  assert.equal(video.callbacks.size,0);assert.equal(video.currentTime,20.25/60);assert.equal(source.nativeFastSeek,false);
  video.complete();assert.equal(await pending,video);assert.equal(source.stats.nativePresentationWaits,0);
 });
}

for(const path of ['frame-zero','precise']){
 test(`${path} motion does not acquire the fastSeek presentation guard`,async t=>{
  const {video,source}=await fixture(t,{fastSeek:path!=='precise'});
  const pending=source.decode(path==='frame-zero'?0:20,undefined,false);await flush();
  assert.equal(video.callbacks.size,0);video.complete();assert.equal(await pending,video);
  assert.equal(source.stats.nativePresentationWaits,0);assert.equal(video.plays,0);
 });
}


test('three consecutive presentation timeouts restore the original seek path for the session',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const {video,source}=await fixture(t);
 assert.equal(source.stats.nativePresentationGuardEnabled,true);assert.equal(source.stats.nativePresentationFailure,null);
 let lateCallback;
 for(const frame of [20,21,22]){
  const pending=source.decode(frame,undefined,false);await flush();
  lateCallback=[...video.callbacks.values()][0];
  video.complete();await flush();t.mock.timers.tick(34);assert.equal(await pending,video);
 }
 assert.equal(source.stats.nativePresentationTimeouts,3);assert.equal(source.stats.nativePresentationTimeoutStreak,3);
 assert.equal(source.stats.nativePresentationGuardEnabled,false);assert.equal(source.stats.nativePresentationFailure,'consecutive-timeouts');
 lateCallback(0,{mediaTime:22/60});assert.equal(source.stats.nativePresentationTimeoutStreak,3,'Late callbacks cannot reopen the circuit');
 for(const frame of [23,24]){
  if(frame===24)source.suspend();
  let done=false;const pending=source.decode(frame,undefined,false).then(image=>{done=true;return image});await flush();
  assert.equal(video.callbacks.size,0);video.complete();await flush();assert.equal(done,true,'No timeout is needed once the guard is disabled');
  assert.equal(await pending,video);
 }
 assert.equal(source.nativeFastSeek,true);assert.equal(source.stats.nativePresentationWaits,3);
 t.mock.timers.tick(1000);assert.equal(source.stats.nativePresentationTimeouts,3);
});

test('a matching presentation resets the consecutive timeout streak',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const {video,source}=await fixture(t);
 for(const frame of [20,21,22,23,24]){
  const pending=source.decode(frame,undefined,false);await flush();
  if(frame===22)video.present(frame);
  video.complete();await flush();
  if(frame!==22)t.mock.timers.tick(34);
  assert.equal(await pending,video);
  if(frame===22)assert.equal(source.stats.nativePresentationTimeoutStreak,0,'An early matching callback counts as a successful acknowledgment');
 }
 assert.equal(source.stats.nativePresentationTimeouts,4);assert.equal(source.stats.nativePresentationTimeoutStreak,2);
 assert.equal(source.stats.nativePresentationGuardEnabled,true);assert.equal(source.stats.nativePresentationFailure,null);
});
