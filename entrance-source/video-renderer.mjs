import {JOURNEY_START_FRAME} from './journey-scroll.mjs';

// Short GOP media belongs to the browser decoder. The existing all-IDR
// WebCodecs worker cannot decode these samples independently.
export async function createJourneyRenderer({stage,onRender=()=>{},onError=()=>{}}){
  const base='/assets/entrance-video/';
  const response=await fetch(base+'manifest.json');
  if(!response.ok)throw Error('Rendered entrance is unavailable');
  const manifest=await response.json();
  if(manifest.version!==1||manifest.width!==1920||manifest.height!==1080||manifest.fps!==60||
    manifest.firstFrame!==JOURNEY_START_FRAME||manifest.lastFrame!==2164||
    manifest.clips?.opening?.frameCount!==240||manifest.clips?.journey?.frameCount!==1831)throw Error('Invalid rendered entrance');
  const canvas=document.createElement('canvas');canvas.width=manifest.width;canvas.height=manifest.height;
  const context=canvas.getContext('2d',{alpha:false});
  if(!context)throw Error('Video canvas unavailable');
  stage.prepend(canvas);
  const events=new AbortController(),videos={};
  const loadingTimers=new Set();
  let disposed=false,suspended=false,wanted=null,painted=null,pending=null,timeout=null,failure=null;
  let openingPlaying=false,openingCallback=null,autoplayBlocked=false;
  const waiters=new Set();
  const equal=(a,b)=>a&&b&&a.kind===b.kind&&a.index===b.index;
  const settled=()=>!!equal(wanted,painted);
  function fail(error){
    if(disposed||failure)return;failure=error;clearTimeout(timeout);pending=null;
    for(const waiter of waiters)waiter.reject(error);waiters.clear();onError(error);
  }
  function paint(request){
    if(disposed||suspended||failure)return;
    try{context.drawImage(videos[request.kind],0,0,canvas.width,canvas.height);}
    catch(error){fail(error);return;}
    painted=request;onRender({frame:request.kind==='opening'?JOURNEY_START_FRAME:JOURNEY_START_FRAME+request.index,width:canvas.width,height:canvas.height});
    if(settled()){for(const waiter of waiters)waiter.resolve();waiters.clear();}
  }
  function pump(){
    if(disposed||suspended||failure||pending||!wanted||settled())return;
    if(wanted.kind==='opening'&&openingPlaying)return;
    const request={...wanted},video=videos[request.kind],time=(request.index+.25)/manifest.fps;
    if(video.readyState<2)return;
    if(!video.seeking&&Math.abs(video.currentTime-time)<.25/manifest.fps){paint(request);return;}
    pending=request;
    timeout=setTimeout(()=>fail(Error('Rendered entrance seek timed out')),15000);
    try{video.currentTime=time;}catch(error){fail(error);}
  }
  function select(kind,index){wanted={kind,index};pump();}
  function stopOpening(){
    openingPlaying=false;videos.opening?.pause();
    if(openingCallback!==null)videos.opening?.cancelVideoFrameCallback(openingCallback);
    openingCallback=null;
  }
  function playOpening(){
    const video=videos.opening;
    if(disposed||suspended||!openingPlaying)return;
    if(openingCallback===null)openingCallback=video.requestVideoFrameCallback((_now,metadata)=>{
      openingCallback=null;
      if(!openingPlaying||suspended||disposed)return;
      paint({kind:'opening',index:Math.min(239,Math.floor(metadata.mediaTime*60))});
      playOpening();
    });
    if(video.paused)video.play().catch(()=>{autoplayBlocked=true;stopOpening();pump();});
  }
  async function loadVariant(){
    await Promise.all(['opening','journey'].map(kind=>new Promise((resolve,reject)=>{
      const video=document.createElement('video');videos[kind]=video;
      video.muted=true;video.playsInline=true;video.preload='auto';video.setAttribute('webkit-playsinline','');
      const timer=setTimeout(()=>reject(Error('Rendered entrance loading timed out')),30000);loadingTimers.add(timer);
      events.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('Entrance disposed','AbortError'));},{once:true});
      const loaded=()=>{clearTimeout(timer);loadingTimers.delete(timer);resolve();};
      video.addEventListener('loadeddata',loaded,{once:true,signal:events.signal});
      video.addEventListener('error',()=>{clearTimeout(timer);const error=Error('Rendered entrance video failed');reject(error);fail(error);},{signal:events.signal});
      video.addEventListener('seeked',()=>{
        if(!pending||pending.kind!==kind)return;
        const request=pending;pending=null;clearTimeout(timeout);
        paint(request);pump();
      },{signal:events.signal});
      // Only fixed local filenames are accepted, regardless of manifest content.
      video.src=base+kind+'.mp4?v='+manifest.clips[kind].sha256;video.load();
    })));
    for(const [kind,video] of Object.entries(videos)){
      if(video.videoWidth!==canvas.width||video.videoHeight!==canvas.height||Math.abs(video.duration-manifest.clips[kind].frameCount/60)>.02)throw Error('Rendered entrance media does not match its manifest');
    }
  }
  return {
    loadVariant,
    renderAt(frame){stopOpening();select('journey',Math.max(0,Math.min(1830,Math.round(frame-JOURNEY_START_FRAME))));},
    renderAssemblyAt(frame){
      const index=Math.max(0,Math.min(239,Math.round(frame)-1)),video=videos.opening;
      // Frame 1 stays paused under the loader. Once the assembly clock starts,
      // native playback delivers consecutive frames without repeated seeks.
      if(index>0&&painted?.kind==='opening'&&!pending&&!autoplayBlocked&&video.requestVideoFrameCallback){
        wanted={kind:'opening',index};openingPlaying=true;playOpening();
      }else select('opening',index);
    },
    whenSettled(){if(failure)return Promise.reject(failure);return settled()?Promise.resolve():new Promise((resolve,reject)=>waiters.add({resolve,reject}));},
    get settled(){return settled();},get displayedFrame(){return painted?.kind==='journey'?JOURNEY_START_FRAME+painted.index:null;},
    resize(){pump();},
    suspend(value=true){suspended=value;if(value){clearTimeout(timeout);pending=null;videos.opening?.pause();}else{if(openingPlaying)playOpening();else pump();}},
    dispose(){
      if(disposed)return;stopOpening();disposed=true;clearTimeout(timeout);events.abort();
      for(const timer of loadingTimers)clearTimeout(timer);loadingTimers.clear();
      for(const video of Object.values(videos)){video.pause();video.removeAttribute('src');video.load();}
      for(const waiter of waiters)waiter.reject(new DOMException('Entrance disposed','AbortError'));waiters.clear();canvas.remove();
    },
    profileFrames:[],policy:{video:true},batchingMode:'video',
    renderer:{domElement:canvas,getPixelRatio:()=>1,info:{render:{calls:0,triangles:0}}},
  };
}
