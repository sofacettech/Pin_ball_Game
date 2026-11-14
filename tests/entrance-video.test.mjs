import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {loadEntranceMedia} from '../entrance-source/video-delivery.mjs';
import {createAdaptiveVideoPreload} from '../entrance-source/adaptive-video-preload.mjs';
import {visibleVideoCrop} from '../entrance-source/video-crop.mjs';
import {framePlacement} from '../frame-placement.js';

const source=readFileSync(new URL('../entrance-source/video-renderer.mjs',import.meta.url),'utf8');
async function fixture({cdn=false,segmentSource,streamSource,previewSource,width=1920,height=1080,preloadFailure=false,renderView=()=>null,onRender=()=>{},diagnostics=false,
  media:providedMedia,preloadedFactory,adaptiveOptions={},load=true}={}){
  const videos=[],draws=[],errors=[];
  class Video extends EventTarget{
    readyState=2;videoWidth=width;videoHeight=height;time=0;seeking=false;seeks=[];
    constructor(){super();this.duration=videos.length?1831/60:4;videos.push(this)}
    setAttribute(){}removeAttribute(name){if(name==='src'){delete this.src;this.unloaded=true}}pause(){}load(){if(this.src){this.duration=this.src.includes('opening')?4:1831/60}if(this.src?.startsWith('/local/')||this.src?.startsWith('/assets/entrance-video/')){this.videoWidth=1920;this.videoHeight=1080}queueMicrotask(()=>this.dispatchEvent(new Event('loadeddata')))}
    set currentTime(value){this.time=value;this.seeking=true;this.seeks.push(value)}
    get currentTime(){return this.time}
    complete(){this.seeking=false;this.dispatchEvent(new Event('seeked'))}
  }
  let removed=false;
  const canvas={style:{},getContext:()=>({drawImage:(video,...args)=>draws.push({video,index:Math.floor(video.time*60),args,width:canvas.width,height:canvas.height})}),remove(){removed=true}};
  const manifest={version:1,width,height,fps:60,firstFrame:334,lastFrame:2164,clips:{opening:{frameCount:240,sha256:'a'.repeat(64)},journey:{frameCount:1831,sha256:'b'.repeat(64)}}};
  const media=providedMedia??{manifest,clips:Object.fromEntries(['opening','journey'].map(kind=>[kind,{url:(cdn?'https://media.example/':'/local/')+kind+'.mp4',local:'/local/'+kind+'.mp4',localWidth:1920,localHeight:1080,...((segmentSource||streamSource)&&kind==='journey'?{segments:[],...(previewSource?{preview:{width:512,height:288}}:{})}:{} )}]))};
  const createBuffer=preloadedFactory??(()=>({load:async()=>{if(preloadFailure){preloadFailure=false;throw Error('CDN unavailable')}},url:url=>url,fetch:async()=>{},dispose(){},ready:true,bytes:100}));
  const context={JOURNEY_START_FRAME:334,visibleVideoCrop,
    createAdaptiveVideoPreload:(initial,options)=>createAdaptiveVideoPreload(initial,{...options,createBuffer,loadMedia:async()=>media,document:null,...adaptiveOptions}),
    createStreamedVideoSource:async(_parts,_metadata,size)=>size?.width===512?previewSource:typeof streamSource==='function'?streamSource(size):streamSource??null,createSegmentedVideoSource:()=>segmentSource,loadEntranceMedia:async()=>media,document:{createElement:type=>type==='canvas'?canvas:new Video()},
    fetch:async()=>({ok:true,json:async()=>manifest}),AbortController,DOMException,setTimeout,clearTimeout,console,performance};
  vm.runInNewContext(source.replace(/^import .*;\r?\n/gm,'').replace('export async function','async function')+';this.create=createJourneyRenderer',context);
  const renderer=await context.create({stage:{prepend(){}},renderView,onRender,diagnostics,onError:error=>errors.push(error)});
  if(load)await renderer.loadVariant();
  return{renderer,videos,draws,errors,media,get removed(){return removed}};
}

async function segmentedMedia(){
  const local={version:1,width:1920,height:1080,fps:60,firstFrame:334,lastFrame:2164,
    clips:{opening:{frameCount:240,sha256:'a'.repeat(64),bytes:80},journey:{frameCount:1831,sha256:'b'.repeat(64),bytes:128}}};
  const remote={...structuredClone(local),width:3840,height:2160};let next=334;
  const segments=Array.from({length:31},(_,index)=>{
    const frameCount=Math.min(60,2165-next),sha256=(index+1).toString(16).padStart(64,'0'),firstFrame=next;next+=frameCount;
    return {file:`entrance-journey-${sha256}.mp4`,sha256,bytes:16+frameCount*2,frameCount,firstFrame,lastFrame:next-1,
      frames:Array.from({length:frameCount},(_,i)=>[16+i*2,2,Number(i%12===0)])};
  });
  for(const kind of ['opening','journey'])remote.clips[kind]={...remote.clips[kind],file:`entrance-${kind}-${remote.clips[kind].sha256}.mp4`};
  remote.clips.journey.bytes=segments.reduce((sum,part)=>sum+part.bytes,0);
  remote.clips.journey.segments=segments;remote.clips.journey.decoder={codec:'avc1.64002a',description:'0164002affe10000',keyframeInterval:12};
  return loadEntranceMedia(async url=>({ok:true,json:async()=>url==='/api/media-config'?{entrance4kManifestURL:'https://media.example/native4k/manifest.json'}:
    url==='/assets/entrance-video/manifest.json'?local:remote}),{option:'3'});
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

test('moving frames stay sharp and a completed decode advances before the latest target settles',async()=>{
 const high={engine:'webcodecs',frameAt:async index=>({time:index/60,displayWidth:3840,displayHeight:2160}),dispose(){}};
 const low={frameAt:async()=>{throw Error('The blurry preview must never be requested')},dispose(){}};
 const f=await fixture({streamSource:high,previewSource:low,width:3840,height:2160}),pending=[];
 high.frameAt=index=>new Promise(resolve=>pending.push({index,resolve}));
 try{
  f.renderer.renderAt(1700);f.renderer.renderAt(2100);
  assert.equal(f.renderer.policy.preloaded,true);assert.equal(f.renderer.policy.preview,false);
  pending[0].resolve({time:pending[0].index/60,displayWidth:3840,displayHeight:2160});await new Promise(r=>setImmediate(r));
  assert.equal(f.renderer.displayedFrame,1700,'keep presenting completed full-resolution frames during continuous scrolling');
  assert.equal(f.renderer.policy.sourceWidth,3840);assert.equal(f.renderer.settled,false);assert.equal(pending.length,2);
  pending[1].resolve({time:pending[1].index/60,displayWidth:3840,displayHeight:2160});await f.renderer.whenSettled();
  assert.equal(f.renderer.displayedFrame,2100);assert.equal(f.renderer.policy.previewVisible,false);
 }finally{f.renderer.dispose()}
});

function croppedView(frame,width=393,height=695){
 const p=framePlacement(width,height,[frame/2164,.5],true);
 return {fullWidth:p.width,fullHeight:p.height,x:-p.x,y:-p.y,width,height};
}

test('visible rendering paints the completed full-resolution frame with its own crop before publishing copy alignment',async()=>{
 const high={engine:'webcodecs',frameAt:async index=>({time:index/60,displayWidth:3840,displayHeight:2160}),dispose(){}},views=[],publications=[];
 const f=await fixture({streamSource:high,width:3840,height:2160,renderView:frame=>{views.push(frame);return croppedView(frame)},
  onRender:({frame})=>publications.push({frame,drawnIndex:f.draws.at(-1).index})});
 const pending=[];high.frameAt=index=>new Promise(resolve=>pending.push({index,resolve}));
 try{
  f.renderer.renderAt(1000);f.renderer.renderAt(1500);
  pending[0].resolve({time:666/60,displayWidth:3840,displayHeight:2160});await new Promise(r=>setImmediate(r));
  const expected=visibleVideoCrop(3840,2160,croppedView(1000)),draw=f.draws.at(-1);
  assert.equal(views.at(-1),1000,'use the decoded/presented frame, not the newer scroll destination');
  assert.deepEqual(draw.args,[-expected.x,-expected.y],'clip the translated source without Safari VideoFrame source-rectangle resampling');
  assert.deepEqual({...f.renderer.policy.crop},{x:expected.x,y:expected.y,width:expected.width,height:expected.height});
  assert.deepEqual(publications,[{frame:1000,drawnIndex:666}],'copy callback follows the matching pixel draw');
  assert.equal(draw.width,expected.width);assert.equal(draw.height,2160);assert.ok(draw.width<1230);
  assert.equal(f.renderer.policy.sourceWidth,3840);assert.equal(f.renderer.policy.visibleArea,true);assert.equal(f.renderer.settled,false);
  pending[1].resolve({time:1166/60,displayWidth:3840,displayHeight:2160});await f.renderer.whenSettled();
  assert.equal(views.at(-1),1500);assert.equal(f.renderer.displayedFrame,1500);
 }finally{f.renderer.dispose()}
});

test('rotation repaints a stationary selected frame without holding another decoded picture',async()=>{
 let viewport=[393,695],requests=0;
 const high={engine:'webcodecs',frameAt:async index=>{requests++;return {time:index/60,displayWidth:3840,displayHeight:2160}},dispose(){}};
 const f=await fixture({streamSource:high,width:3840,height:2160,renderView:frame=>croppedView(frame,...viewport)});
 try{
  f.renderer.renderAt(1200);await f.renderer.whenSettled();
  const before=requests,oldWidth=f.renderer.renderer.domElement.width;
  viewport=[900,393];f.renderer.resize();assert.equal(f.renderer.settled,false);await f.renderer.whenSettled();
  assert.equal(requests,before+1,'reacquire from the bounded source cache rather than retaining a source reference');
  assert.equal(f.renderer.displayedFrame,1200);assert.equal(f.renderer.renderer.domElement.width,3840);
  assert.ok(f.renderer.renderer.domElement.height<2160);assert.ok(oldWidth<3840);
  assert.equal(f.renderer.policy.sourceWidth,3840);assert.equal(f.errors.length,0);
 }finally{f.renderer.dispose()}
});

test('cropped native playback validates full source dimensions and keeps fallback and final frame intact',async()=>{
 const f=await fixture({cdn:true,width:3840,height:2160,renderView:croppedView}),video=f.videos[1];
 try{
  f.renderer.renderAt(1840);video.complete();await f.renderer.whenSettled();
  assert.equal(f.renderer.policy.sourceWidth,3840);assert.ok(f.renderer.renderer.domElement.width<1230);
  f.renderer.renderAt(2164);video.dispatchEvent(new Event('error'));await new Promise(r=>setImmediate(r));
  video.complete();await f.renderer.whenSettled();
  assert.equal(f.renderer.displayedFrame,2164);assert.equal(f.renderer.policy.sourceWidth,1920);assert.equal(f.renderer.policy.sourceHeight,1080);
  assert.ok(f.renderer.renderer.domElement.width<620);assert.equal(f.renderer.renderer.domElement.height,1080);assert.deepEqual(f.errors,[]);
 }finally{f.renderer.dispose()}
});

test('canvas timings and decoder diagnostics are opt-in and do not read layout during painting',async()=>{
 const metrics={requests:3,cacheHits:1,chunks:12},high={engine:'webcodecs',metrics,frameAt:async index=>({time:index/60,displayWidth:3840,displayHeight:2160}),dispose(){}};
 const normal=await fixture({streamSource:high,width:3840,height:2160});
 try{normal.renderer.renderAt(500);await normal.renderer.whenSettled();assert.equal('paintMetrics' in normal.renderer.policy,false);assert.equal('decoderMetrics' in normal.renderer.policy,false);}
 finally{normal.renderer.dispose()}
 const measured=await fixture({streamSource:high,width:3840,height:2160,diagnostics:true,renderView:croppedView});
 try{
  measured.renderer.renderAt(500);await measured.renderer.whenSettled();
  assert.equal(measured.renderer.policy.paintMetrics.count,1);assert.ok(measured.renderer.policy.paintMetrics.p95Ms>=0);
  assert.equal(measured.renderer.policy.paintMetrics.canvasResizes,0,'focus movement does not reallocate the backing store');
  assert.equal(measured.renderer.policy.decoderMetrics,metrics);
 }finally{measured.renderer.dispose()}
});

test('a reversal does not paint an obsolete frame beyond the new destination',async()=>{
 const high={engine:'webcodecs',frameAt:async index=>({time:index/60}),dispose(){}};
 const f=await fixture({streamSource:high}),pending=[];
 try{
  f.renderer.renderAt(334);await f.renderer.whenSettled();
  high.frameAt=index=>new Promise(resolve=>pending.push({index,resolve}));
  f.renderer.renderAt(1700);f.renderer.renderAt(500);
  pending[0].resolve({time:1366/60});await new Promise(r=>setImmediate(r));
  assert.equal(f.renderer.displayedFrame,334,'discard the overshoot instead of shaking outward and back');
  pending[1].resolve({time:166/60});await f.renderer.whenSettled();assert.equal(f.renderer.displayedFrame,500);
 }finally{f.renderer.dispose()}
});

test('section requests remain serialized across hide/show and a missing section falls back to local playback',async()=>{
  const source={frameAt:async()=>({time:0}),dispose(){}},f=await fixture({segmentSource:source});
  try{
    const pending=[];source.frameAt=index=>new Promise(resolve=>pending.push({index,resolve}));
    f.renderer.renderAt(1000);f.renderer.suspend();f.renderer.renderAt(700);f.renderer.suspend(false);
    assert.equal(pending.length,1,'resuming must not start a concurrent seek on the same video');
    pending[0].resolve({time:666/60});await new Promise(r=>setImmediate(r));
    assert.equal(pending.length,2);assert.equal(pending[1].index,366);
    pending[1].resolve({time:366/60});await f.renderer.whenSettled();assert.equal(f.renderer.displayedFrame,700);
    source.frameAt=async()=>{throw Error('section unavailable')};f.renderer.renderAt(1500);
    await new Promise(r=>setImmediate(r));assert.equal(f.renderer.policy.segmented,false);assert.equal(f.videos[1].src,'/local/journey.mp4');
    f.videos[1].complete();assert.equal(f.renderer.displayedFrame,1500);assert.equal(f.errors.length,0);
  }finally{f.renderer.dispose()}
});

test('stream decoder failure retains the high-quality native section fallback',async()=>{
  let released=0;
  const streamSource={engine:'webcodecs',frameAt:async index=>({time:index/60}),dispose(){released++}};
  const segmentSource={frameAt:async index=>({time:index/60}),dispose(){}};
  const f=await fixture({segmentSource,streamSource});
  try{
    assert.equal(f.renderer.policy.streaming,true);
    streamSource.frameAt=async()=>{throw Error('decoder reclaimed')};
    f.renderer.renderAt(1100);await f.renderer.whenSettled();
    assert.equal(f.renderer.displayedFrame,1100);assert.equal(f.renderer.policy.streaming,false);assert.equal(f.renderer.policy.segmented,true);assert.equal(released,1);
    assert.equal(f.videos.length,1,'do not download the bundled journey when native sections are healthy');
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

test('the finished native opening unloads after a journey paint and assembly replay stays local across hide/show',async()=>{
  const revoked=[],urls=[];
  const high={engine:'webcodecs',frameAt:async index=>({time:index/60,displayWidth:3840,displayHeight:2160}),dispose(){}};
  const f=await fixture({cdn:true,width:3840,height:2160,streamSource:high,preloadedFactory:()=>({
    load:async()=>{},fetch:async()=>{},url:url=>{urls.push(url);return url},revokeURL:url=>revoked.push(url),dispose(){},ready:true,bytes:100,
  })});
  const opening=f.videos[0];let finish;
  try{
    f.renderer.renderAssemblyAt(240);opening.complete();assert.equal(f.draws.at(-1).index,239);
    high.frameAt=index=>new Promise(resolve=>{finish=()=>resolve({time:index/60,displayWidth:3840,displayHeight:2160})});
    f.renderer.renderAt(1000);
    assert.equal(f.renderer.policy.openingResident,true,'keep the assembly available while the next picture is still decoding');
    assert.equal(opening.unloaded,undefined);finish();await f.renderer.whenSettled();
    assert.equal(f.renderer.policy.openingResident,false);assert.equal(opening.unloaded,true);
    assert.deepEqual(revoked,['https://media.example/opening.mp4']);
    opening.dispatchEvent(new Event('error'));opening.complete();await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(f.errors,[],'unloading must ignore stale native error, loadeddata and seeked events');
    f.renderer.suspend();f.renderer.suspend(false);
    assert.equal(f.renderer.policy.openingResident,false,'BFCache/visibility resume must not restart the completed opening');
    high.frameAt=async index=>({time:index/60,displayWidth:3840,displayHeight:2160});
    f.renderer.renderAt(334);await f.renderer.whenSettled();assert.equal(f.renderer.policy.preloaded,true);
    f.renderer.renderAssemblyAt(120);f.renderer.renderAssemblyAt(240);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(f.videos.length,2,'coalesce replay requests into one native opening');
    assert.equal(f.renderer.policy.openingResident,true);assert.equal(f.renderer.settled,false);
    f.videos[1].complete();await f.renderer.whenSettled();
    assert.equal(f.draws.at(-1).index,239);assert.deepEqual(urls,['https://media.example/opening.mp4','https://media.example/opening.mp4']);
    f.renderer.renderAt(2164);await f.renderer.whenSettled();
    assert.equal(f.renderer.displayedFrame,2164);assert.equal(f.renderer.policy.sourceWidth,3840);
    assert.equal(f.renderer.policy.openingResident,false);assert.equal(revoked.length,2);assert.deepEqual(f.errors,[]);
  }finally{f.renderer.dispose()}
});

test('CDN playback failure retries the matching local timeline once and preserves scroll intent',async()=>{
  const f=await fixture({cdn:true}),video=f.videos[1];
  try{
    assert.equal(video.crossOrigin,'anonymous');
    assert.equal(video.src,'https://media.example/journey.mp4');
    f.renderer.renderAt(1500);
    const ready=f.renderer.whenSettled();
    video.dispatchEvent(new Event('error'));
    await Promise.resolve();
    assert.equal(video.src,'/local/journey.mp4');assert.equal(f.errors.length,0);
    video.complete();await ready;assert.equal(f.renderer.displayedFrame,1500);
    f.renderer.renderAt(1600);
    const failed=assert.rejects(f.renderer.whenSettled(),/video failed/);
    video.dispatchEvent(new Event('error'));await failed;assert.equal(f.errors.length,1);
  }finally{f.renderer.dispose()}
});

test('higher-quality CDN media requires a complete matching timeline and immutable filenames',async()=>{
  const local={version:1,width:1920,height:1080,fps:60,firstFrame:334,lastFrame:2164,clips:{opening:{frameCount:240,sha256:'a'.repeat(64)},journey:{frameCount:1831,sha256:'b'.repeat(64)}}};
  const remote=structuredClone(local);
  for(const kind of ['opening','journey'])remote.clips[kind]={...remote.clips[kind],file:`entrance-${kind}-${remote.clips[kind].sha256}.mp4`,bytes:100};
  const calls=[];
  let config={entranceManifestURL:'https://media.example/release/manifest.json'};
  const fetcher=async url=>{calls.push(url);return {ok:true,json:async()=>url==='/api/media-config'?config:String(url).startsWith('https:')?remote:local}};
  const good=await loadEntranceMedia(fetcher);
  assert.equal(good.clips.journey.url,`https://media.example/release/${remote.clips.journey.file}`);
  assert.match(good.clips.journey.local,/^\/assets\/entrance-video\/journey.mp4/);
  remote.clips.journey.frameCount=100;
  const mismatched=await loadEntranceMedia(fetcher);
  assert.equal(mismatched.clips.opening.url,mismatched.clips.opening.local);
  remote.clips.journey.frameCount=1831;remote.clips.journey.file='https://unrelated.example/video.mp4';
  const malformed=await loadEntranceMedia(fetcher);
  assert.equal(malformed.clips.opening.url,malformed.clips.opening.local);
  config={entranceManifestURL:'http://media.example/manifest.json'};
  const before=calls.length;
  const insecure=await loadEntranceMedia(fetcher);
  assert.equal(insecure.clips.journey.url,insecure.clips.journey.local);
  assert.equal(calls.length-before,2,'invalid CDN URL is never fetched');
  const unavailable=await loadEntranceMedia(async url=>{
    if(url==='/api/media-config')throw Error('offline');return {ok:true,json:async()=>local};
  });
  assert.equal(unavailable.clips.opening.url,unavailable.clips.opening.local);
});


test('4K native playback reports its decoded size and falls back to the 1080p timeline',async()=>{
 const f=await fixture({cdn:true,width:3840,height:2160});
 try{
  f.renderer.renderAt(1840);f.videos[1].complete();await f.renderer.whenSettled();
  assert.equal(f.renderer.renderer.domElement.width,3840);assert.equal(f.renderer.policy.sourceWidth,3840);assert.equal(f.renderer.policy.sourceHeight,2160);
  f.renderer.renderAt(1900);f.videos[1].dispatchEvent(new Event('error'));await new Promise(r=>setImmediate(r));
  f.videos[1].complete();await f.renderer.whenSettled();
  assert.equal(f.renderer.displayedFrame,1900);assert.equal(f.renderer.policy.sourceWidth,1920);assert.equal(f.renderer.policy.sourceHeight,1080);assert.equal(f.errors.length,0);
 }finally{f.renderer.dispose()}
});

test('option 3 selects verified 4K media while option 2 and unavailable 4K retain 1080p delivery',async()=>{
 const local={version:1,width:1920,height:1080,fps:60,firstFrame:334,lastFrame:2164,clips:{opening:{frameCount:240,sha256:'a'.repeat(64)},journey:{frameCount:1831,sha256:'b'.repeat(64)}}};
 const regular=structuredClone(local);
 for(const kind of ['opening','journey'])regular.clips[kind]={...regular.clips[kind],file:`entrance-${kind}-${regular.clips[kind].sha256}.mp4`,bytes:100};
 const ultra={...structuredClone(regular),width:3840,height:2160},calls=[];
 let available=true;
 const fetcher=async url=>{calls.push(url);return {ok:url!=='https://media.example/4k/manifest.json'||available,json:async()=>url==='/api/media-config'?{entranceManifestURL:'https://media.example/hd/manifest.json',entrance4kManifestURL:'https://media.example/4k/manifest.json'}:url==='https://media.example/4k/manifest.json'?ultra:url==='https://media.example/hd/manifest.json'?regular:local}};
 const hd=await loadEntranceMedia(fetcher,{option:'2'});assert.equal(hd.manifest.width,1920);assert.equal(calls.some(url=>url.includes('/4k/')),false);
 const selected=await loadEntranceMedia(fetcher);assert.equal(selected.manifest.width,3840);assert.match(selected.clips.journey.url,/\/4k\//);assert.equal(selected.clips.journey.localWidth,1920);
 available=false;const missing=await loadEntranceMedia(fetcher,{option:'3'});assert.equal(missing.manifest.width,1920);assert.match(missing.clips.journey.url,/\/hd\//);
 available=true;ultra.width=1920;const wrongSize=await loadEntranceMedia(fetcher,{option:'3'});assert.equal(wrongSize.manifest.width,1920);assert.match(wrongSize.clips.journey.url,/\/hd\//);
});

test('entrance selectors default to version 3 and retain explicit alternatives and aliases',async()=>{
 const {selectEntranceOption}=await import('../entrance-source/entrance-option.mjs');
 for(const [query,expected] of [['','3'],['?debug=1','3'],['?entrance=1','1'],['?entrance=2','2'],['?entrance=3','3'],['?version=1','1'],['?version=2','2'],['?version=3','3'],['?version=3&entrance=2','2'],['?version=1&entrance=3','3'],['?entrance=video','3'],['?entrance=4','3']])assert.equal(selectEntranceOption(query),expected);
});

test('failed CDN preloading retries the complete bundled journey before preparing any decoder',async()=>{
 let released=0;
 const high={engine:'webcodecs',frameAt:async index=>({time:index/60}),dispose(){released++}};
 const f=await fixture({cdn:true,width:3840,height:2160,streamSource:high,preloadFailure:true});
 try{
  assert.equal(released,0,'do not allocate a decoder for a failed unbuffered variant');assert.equal(f.renderer.policy.segmented,false);assert.equal(f.renderer.policy.preloaded,true);
  assert.equal(f.videos[0].src,'/local/opening.mp4');assert.equal(f.videos[1].src,'/local/journey.mp4');
  f.renderer.renderAt(1840);f.videos[1].complete();await f.renderer.whenSettled();
  assert.equal(f.renderer.policy.sourceWidth,1920);assert.deepEqual(f.errors,[]);
 }finally{f.renderer.dispose()}
});

test('the next clock step decodes ahead without painting early or retaining an extra picture',async()=>{
 const high={engine:'webcodecs',frameAt:async index=>({time:index/60}),dispose(){}};
 const f=await fixture({streamSource:high,width:3840,height:2160}),pending=[];
 high.frameAt=index=>new Promise(resolve=>pending.push({index,resolve}));
 const complete=async position=>{pending[position].resolve({time:pending[position].index/60,displayWidth:3840,displayHeight:2160});await new Promise(resolve=>setImmediate(resolve))};
 try{
  f.renderer.renderAt(334,350);assert.equal(pending.length,1);
  await complete(0);assert.equal(f.renderer.settled,true);assert.equal(f.renderer.displayedFrame,334);
  assert.equal(pending.length,2);assert.equal(pending[1].index,2,'use the idle presentation interval for the next two-frame clock step');
  await complete(1);assert.equal(f.draws.length,1,'decoded lookahead must remain invisible until its clock step');
  assert.equal(pending.length,2,'hold one prepared source picture rather than decoding farther ahead');
  f.renderer.renderAt(336,350);
  assert.equal(f.renderer.displayedFrame,336,'the next step paints synchronously from its prepared source picture');
  assert.equal(pending.length,3);assert.equal(pending[2].index,4);
  assert.equal(f.renderer.policy.sourceWidth,3840);
 }finally{f.renderer.dispose()}
});

test('lookahead remains serialized through reversal, visibility changes and disposal',async()=>{
 let disposed=0;
 const high={engine:'webcodecs',frameAt:async index=>({time:index/60}),dispose(){disposed++}};
 const f=await fixture({streamSource:high}),pending=[];
 high.frameAt=index=>new Promise(resolve=>pending.push({index,resolve}));
 const complete=async position=>{pending[position].resolve({time:pending[position].index/60});await new Promise(resolve=>setImmediate(resolve))};
 try{
  f.renderer.renderAt(334,400);await complete(0);assert.equal(pending.length,2);
  f.renderer.renderAt(334,334);await complete(1);
  assert.equal(f.draws.length,1,'a reversed scroll hint must not paint its stale speculative frame');
  assert.equal(pending.length,2);
  f.renderer.renderAt(334,400);assert.equal(pending.length,3);
  f.renderer.suspend();f.renderer.renderAt(336,400);f.renderer.suspend(false);
  assert.equal(pending.length,3,'resume must not start a second seek while lookahead is outstanding');
  f.renderer.suspend();await complete(2);assert.equal(f.draws.length,1,'hidden scenes must not paint completed lookahead');
  f.renderer.suspend(false);assert.equal(pending.length,4);
  await complete(3);assert.equal(f.renderer.displayedFrame,336);assert.equal(pending.length,5);
  const draws=f.draws.length;f.renderer.dispose();await complete(4);
  assert.equal(f.draws.length,draws);assert.equal(disposed,1);
 }finally{f.renderer.dispose()}
});

test('lookahead stops at the final authored picture and reports it settled only after selection',async()=>{
 const high={engine:'webcodecs',frameAt:async index=>({time:index/60}),dispose(){}};
 const f=await fixture({streamSource:high}),pending=[];
 high.frameAt=index=>new Promise(resolve=>pending.push({index,resolve}));
 const complete=async position=>{pending[position].resolve({time:pending[position].index/60});await new Promise(resolve=>setImmediate(resolve))};
 try{
  f.renderer.renderAt(2162,2164);await complete(0);assert.equal(f.renderer.displayedFrame,2162);
  assert.equal(pending[1].index,1830);await complete(1);
  assert.equal(f.renderer.displayedFrame,2162,'decoding the final pose must not advance its crop or handoff');
  f.renderer.renderAt(2164,2164);await f.renderer.whenSettled();
  assert.equal(f.renderer.displayedFrame,2164);assert.equal(f.renderer.settled,true);
  assert.equal(pending.length,2,'no decoding may pass the last authored picture');
 }finally{f.renderer.dispose()}
});

test('segmented 4K readiness waits for the complete preloaded variant before any pose is prepared',async()=>{
 const media=await segmentedMedia(),catalog=[],prepared=[];let finish,loaded=false;
 const high={engine:'webcodecs',frameAt:async index=>{assert.equal(loaded,true);prepared.push(index);return {time:index/60,displayWidth:3840,displayHeight:2160}},dispose(){}};
 const f=await fixture({media,width:3840,height:2160,streamSource:high,load:false,preloadedFactory:files=>{
  catalog.push(...Array.from(files,file=>({url:file.url,bytes:file.bytes})));
  return {load:()=>new Promise(resolve=>{finish=()=>{loaded=true;resolve()}}),fetch:async()=>{},
   url:url=>{assert.equal(loaded,true);return url},dispose(){},get ready(){return loaded},bytes:4238};
 }});
 try{
  const readiness=f.renderer.loadVariant();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(catalog,[media.clips.opening,...media.clips.journey.segments].map(file=>({url:file.url,bytes:file.bytes})));
  assert.equal(catalog.length,32);assert.equal(f.renderer.policy.preloaded,false);
  assert.deepEqual(prepared,[]);assert.equal(f.videos.length,0,'keep the loader opaque until all sections are available');
  finish();await readiness;
  assert.equal(f.renderer.policy.preloaded,true);assert.equal(f.renderer.policy.preloadedBytes,4238);
  assert.deepEqual(prepared,[0]);assert.equal(f.renderer.policy.streaming,true);assert.equal(f.videos.length,1);
  f.renderer.renderAt(2164);await f.renderer.whenSettled();
  assert.equal(f.renderer.displayedFrame,2164);assert.equal(f.renderer.policy.sourceWidth,3840);
  assert.deepEqual(f.errors,[]);
 }finally{f.renderer.dispose()}
});

test('concurrent variant preparation shares one preload, decoder and first-picture preparation',async()=>{
 let prepared=0;
 const high={engine:'webcodecs',frameAt:async index=>{prepared++;return {time:index/60}},dispose(){}};
 const f=await fixture({streamSource:high,load:false});
 try{
  const first=f.renderer.loadVariant(),second=f.renderer.loadVariant();assert.equal(first,second);
  await Promise.all([first,second]);assert.equal(prepared,1);assert.equal(f.videos.length,1);assert.deepEqual(f.errors,[]);
 }finally{f.renderer.dispose()}
});

test('a decoder completing after disposal is released without preparing or painting a picture',async()=>{
 let finish,disposed=0,prepared=0;
 const high={engine:'webcodecs',frameAt:async()=>{prepared++;return {}},dispose(){disposed++}};
 const f=await fixture({streamSource:()=>new Promise(resolve=>{finish=resolve}),load:false});
 const readiness=f.renderer.loadVariant();await new Promise(resolve=>setImmediate(resolve));
 f.renderer.dispose();finish(high);
 await assert.rejects(readiness,{name:'AbortError'});
 assert.equal(disposed,1);assert.equal(prepared,0);assert.equal(f.videos.length,0);assert.equal(f.draws.length,0);
});

test('obsolete network seeks cancel on section jumps while active forward decoding stays serialized',async()=>{
 const media=await segmentedMedia(),pending=[];let cancellations=0,disposals=0,network=true;
 const high={engine:'webcodecs',frameAt:async index=>({time:index/60}),dispose(){disposals++}};
 const f=await fixture({media,width:3840,height:2160,streamSource:high});
 high.frameAt=index=>new Promise((resolve,reject)=>pending.push({index,resolve,reject}));
 high.cancelPending=()=>{if(!network)return false;cancellations++;pending.at(-1).reject(new DOMException('Superseded','AbortError'));return true};
 const complete=async position=>{pending[position].resolve({time:pending[position].index/60,displayWidth:3840,displayHeight:2160});await new Promise(resolve=>setImmediate(resolve))};
 try{
  f.renderer.renderAt(334);await complete(0);
  f.renderer.renderAt(338);f.renderer.renderAt(340);
  assert.equal(cancellations,0,'normal forward movement must not starve a pending frame');
  f.renderer.renderAt(450);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(cancellations,1);assert.equal(pending.at(-1).index,116);
  assert.equal(disposals,0);assert.equal(f.renderer.policy.streaming,true);
  network=false;f.renderer.renderAt(600);
  assert.equal(pending.length,3,'an actual decoder operation must finish before its replacement');
  await complete(2);await complete(3);await f.renderer.whenSettled();
  assert.equal(f.renderer.displayedFrame,600);assert.equal(cancellations,1);assert.deepEqual(f.errors,[]);
 }finally{f.renderer.dispose()}
});

test('a failed segmented 4K preload never allocates its decoder and retries the complete local 1080p variant',async()=>{
 const media=await segmentedMedia(),preloads=[];let bufferDisposals=0,decoderDisposals=0;
 const high={engine:'webcodecs',frameAt:async index=>({time:index/60}),dispose(){decoderDisposals++}};
 const f=await fixture({media,width:3840,height:2160,streamSource:high,preloadedFactory:files=>{
  preloads.push(Array.from(files,file=>({url:file.url,bytes:file.bytes})));const failed=preloads.length===1;
  return {load:async()=>{if(failed)throw Error('CDN preload unavailable')},fetch:async()=>{},url:url=>url,
   dispose(){if(failed)bufferDisposals++},ready:!failed,bytes:failed?4238:208};
 }});
 try{
  assert.equal(bufferDisposals,1);assert.equal(decoderDisposals,0,'only a fully buffered selected variant may create a decoder');assert.equal(preloads.length,2);
  assert.equal(preloads[0].length,32);
  assert.deepEqual(preloads[1],[{url:media.clips.opening.local,bytes:80},{url:media.clips.journey.local,bytes:128}]);
  assert.equal(f.renderer.policy.streaming,false);assert.equal(f.renderer.policy.segmented,false);assert.equal(f.renderer.policy.preloaded,true);
  assert.match(f.videos[0].src,/^\/assets\/entrance-video\/opening\.mp4/);assert.match(f.videos[1].src,/^\/assets\/entrance-video\/journey\.mp4/);
  f.renderer.renderAt(1840);f.videos[1].complete();await f.renderer.whenSettled();
  assert.equal(f.renderer.displayedFrame,1840);assert.equal(f.renderer.policy.sourceWidth,1920);assert.equal(f.renderer.policy.sourceHeight,1080);
  assert.deepEqual(f.errors,[]);
 }finally{f.renderer.dispose()}
});
