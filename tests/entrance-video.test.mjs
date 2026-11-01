import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../entrance-source/video-renderer.mjs',import.meta.url),'utf8');
async function fixture(){
  const videos=[],draws=[],errors=[];
  class Video extends EventTarget{
    readyState=2;videoWidth=1920;videoHeight=1080;time=0;seeking=false;seeks=[];
    constructor(){super();this.duration=videos.length?1831/60:4;videos.push(this)}
    setAttribute(){}removeAttribute(){}pause(){}load(){queueMicrotask(()=>this.dispatchEvent(new Event('loadeddata')))}
    set currentTime(value){this.time=value;this.seeking=true;this.seeks.push(value)}
    get currentTime(){return this.time}
    complete(){this.seeking=false;this.dispatchEvent(new Event('seeked'))}
  }
  let removed=false;
  const canvas={getContext:()=>({drawImage:video=>draws.push({video,index:Math.floor(video.time*60)})}),remove(){removed=true}};
  const manifest={version:1,width:1920,height:1080,fps:60,firstFrame:334,lastFrame:2164,clips:{opening:{frameCount:240,sha256:'a'.repeat(64)},journey:{frameCount:1831,sha256:'b'.repeat(64)}}};
  const context={JOURNEY_START_FRAME:334,document:{createElement:type=>type==='canvas'?canvas:new Video()},
    fetch:async()=>({ok:true,json:async()=>manifest}),AbortController,DOMException,setTimeout,clearTimeout,console};
  vm.runInNewContext(source.replace(/^import .*;\n/,'').replace('export async function','async function')+';this.create=createJourneyRenderer',context);
  const renderer=await context.create({stage:{prepend(){}},onError:error=>errors.push(error)});
  await renderer.loadVariant();
  return{renderer,videos,draws,errors,get removed(){return removed}};
}

test('video preserves source timing and coalesces rapid scroll/reversal into one outstanding seek',async()=>{
  const f=await fixture(),video=f.videos[1];
  try{
    f.renderer.renderAt(1000);f.renderer.renderAt(1800);f.renderer.renderAt(800);
    assert.equal(video.seeks.length,1);assert.equal(f.renderer.settled,false);
    video.complete();assert.equal(video.seeks.length,2);assert.equal(f.draws.at(-1).index,666);
    video.complete();assert.equal(f.draws.at(-1).index,466);assert.equal(f.renderer.displayedFrame,800);assert.equal(f.renderer.settled,true);
    f.renderer.renderAt(2164);const ready=f.renderer.whenSettled();video.complete();await ready;
    assert.equal(f.draws.at(-1).index,1830);assert.equal(f.renderer.displayedFrame,2164);
    f.renderer.renderAt(334);video.complete();assert.equal(f.draws.at(-1).index,0);
  }finally{f.renderer.dispose()}
});

test('opening and journey use distinct timelines and wait for an actual decoded pose',async()=>{
  const f=await fixture();
  try{
    f.renderer.renderAssemblyAt(240);assert.equal(f.renderer.settled,false);
    f.videos[0].complete();assert.equal(f.draws.at(-1).index,239);
    f.renderer.renderAt(334);assert.equal(f.renderer.settled,false);
    f.videos[1].complete();assert.equal(f.draws.at(-1).index,0);assert.equal(f.renderer.settled,true);
  }finally{f.renderer.dispose()}
});

test('suspending releases seek deadlines and resumes the latest target without hidden paints',async()=>{
  const f=await fixture(),video=f.videos[1];
  try{
    f.renderer.renderAt(1200);f.renderer.suspend();video.complete();
    assert.equal(f.draws.length,0);f.renderer.renderAt(700);f.renderer.suspend(false);
    video.complete();assert.equal(f.renderer.displayedFrame,700);assert.equal(f.renderer.settled,true);
  }finally{f.renderer.dispose()}
  assert.equal(f.removed,true);
});

test('media errors reject readiness and dispose releases pending callers',async()=>{
  const f=await fixture();f.renderer.renderAt(1500);
  const failed=assert.rejects(f.renderer.whenSettled(),/video failed/);
  f.videos[1].dispatchEvent(new Event('error'));await failed;assert.equal(f.errors.length,1);f.renderer.dispose();
  const g=await fixture();g.renderer.renderAt(1500);const canceled=assert.rejects(g.renderer.whenSettled(),{name:'AbortError'});g.renderer.dispose();await canceled;
});

test('opening uses consecutive decoded video frames after the loader, then cancels playback for scrolling',async()=>{
  const f=await fixture(),video=f.videos[0];let callback,plays=0,cancels=0;
  video.paused=true;video.play=()=>{video.paused=false;plays++;return Promise.resolve()};video.pause=()=>{video.paused=true};
  video.requestVideoFrameCallback=fn=>{callback=fn;return 1};video.cancelVideoFrameCallback=()=>{callback=null;cancels++};
  try{
    f.renderer.renderAssemblyAt(1);assert.equal(plays,0);video.complete();
    const seeks=video.seeks.length;
    f.renderer.renderAssemblyAt(2);f.renderer.renderAssemblyAt(30);
    assert.equal(plays,1);assert.equal(video.seeks.length,seeks);
    video.time=.25;callback(0,{mediaTime:.25});assert.equal(f.draws.at(-1).index,15,'draw the actual decoded frame');
    f.renderer.suspend();assert.equal(video.paused,true);f.renderer.suspend(false);assert.equal(plays,2);
    f.renderer.renderAt(334);assert.equal(video.paused,true);assert.ok(cancels>0);
    f.videos[1].complete();assert.equal(f.renderer.settled,true);
  }finally{f.renderer.dispose()}
});
