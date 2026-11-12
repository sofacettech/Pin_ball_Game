import {JOURNEY_START_FRAME} from './journey-scroll.mjs';
import {createPreloadedVideo} from './preloaded-video.mjs';
import {loadEntranceMedia} from './video-delivery.mjs';
import {createSegmentedVideoSource} from './segmented-video.mjs';
import {createStreamedVideoSource} from './streamed-video.mjs';
import {visibleVideoCrop} from './video-crop.mjs';

// Short GOP media belongs to the browser decoder. The existing all-IDR
// WebCodecs worker cannot decode these samples independently.
export async function createJourneyRenderer({stage,renderView=()=>null,diagnostics=false,onProgress=()=>{},onRender=()=>{},onError=()=>{}}){
  const {manifest,clips}=await loadEntranceMedia();
  const canvas=document.createElement('canvas'),initialCrop=visibleVideoCrop(manifest.width,manifest.height,renderView(JOURNEY_START_FRAME));
  canvas.width=initialCrop?.width??manifest.width;canvas.height=initialCrop?.height??manifest.height;
  const context=canvas.getContext('2d',{alpha:false});
  if(!context)throw Error('Video canvas unavailable');
  stage.prepend(canvas);
  const events=new AbortController(),videos={};
  const loadingTimers=new Set();
  const files=[clips.opening,...(clips.journey.segments||[clips.journey])];
  let buffer=createPreloadedVideo(files,{onProgress});
  const size={width:manifest.width,height:manifest.height,fetcher:(...args)=>buffer.fetch(...args),cacheStorage:null,diagnostics};
  let segmented=clips.journey.segments?(await createStreamedVideoSource(clips.journey.segments,clips.journey.decoder,size)||createSegmentedVideoSource(clips.journey.segments,size)):null;
  let disposed=false,suspended=false,wanted=null,painted=null,pending=null,prepared=null,targetIndex=null,timeout=null,failure=null;
  let displayed=null;
  let sourceWidth=manifest.width,sourceHeight=manifest.height;
  let crop=null;
  const paintTimes=diagnostics?[]:null;
  let paintCount=0,paintTotalMs=0,paintMaxMs=0,canvasResizes=0;
  function paintMetrics(){
    const sorted=paintTimes.slice().sort((a,b)=>a-b);
    return {count:paintCount,meanMs:paintCount?paintTotalMs/paintCount:0,maxMs:paintMaxMs,
      p95Ms:sorted.length?sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))]:0,
      lastMs:paintTimes.at(-1)??0,sampleCount:sorted.length,canvasResizes,
      timing:'Canvas sizing, style updates and drawImage submission; excludes GPU completion and copy callback'};
  }
  let openingPlaying=false,openingCallback=null,autoplayBlocked=false;
  const waiters=new Set();
  const equal=(a,b)=>a&&b&&a.kind===b.kind&&a.index===b.index;
  const settled=()=>!!equal(wanted,painted)&&!!equal(wanted,displayed);
  function fail(error){
    if(disposed||failure)return;failure=error;clearTimeout(timeout);pending=null;
    for(const waiter of waiters)waiter.reject(error);waiters.clear();onError(error);
  }
  function paint(request,video=videos[request.kind]){
    if(disposed||suspended||failure||request.kind!==wanted?.kind)return;
    // Do not finish an obsolete outward seek after the visitor reverses. The
    // picture, camera crop and copy advance together toward the current target.
    if(displayed?.kind===request.kind&&(request.index<Math.min(displayed.index,wanted.index)||request.index>Math.max(displayed.index,wanted.index)))return;
    const drawnFrame=request.kind==='opening'?JOURNEY_START_FRAME:JOURNEY_START_FRAME+request.index;
    const width=video.displayWidth||video.videoWidth||manifest.width,height=video.displayHeight||video.videoHeight||manifest.height;
    const view=visibleVideoCrop(width,height,renderView(drawnFrame));
    const drawingWidth=view?.width??width,drawingHeight=view?.height??height;
    const paintStart=diagnostics?performance.now():0;
    try{
      if(canvas.width!==drawingWidth){canvas.width=drawingWidth;if(diagnostics)canvasResizes++;}
      if(canvas.height!==drawingHeight){canvas.height=drawingHeight;if(diagnostics)canvasResizes++;}
      if(view){
        canvas.style.position='absolute';canvas.style.left='0';canvas.style.top='0';
        canvas.style.width=view.cssWidth+'px';canvas.style.height=view.cssHeight+'px';
        canvas.style.transform=`translate3d(${view.cssX}px,${view.cssY}px,0)`;
        // Clip the translated original at the backing bounds. Safari's
        // nine-argument VideoFrame source rectangle can resample incorrectly.
        context.drawImage(video,-view.x,-view.y);
      }else{
        canvas.style.position='';canvas.style.left='';canvas.style.top='';
        canvas.style.width='100%';canvas.style.height='100%';canvas.style.transform='none';
        context.drawImage(video,0,0,canvas.width,canvas.height);
      }
    }
    catch(error){fail(error);return;}
    if(diagnostics){
      const elapsed=performance.now()-paintStart;paintCount++;paintTotalMs+=elapsed;paintMaxMs=Math.max(paintMaxMs,elapsed);
      if(paintTimes.length===180)paintTimes.shift();paintTimes.push(elapsed);
    }
    crop=view;displayed=request;painted=request;sourceWidth=width;sourceHeight=height;
    onRender({frame:drawnFrame,width:canvas.width,height:canvas.height});
    if(settled()){for(const waiter of waiters)waiter.resolve();waiters.clear();}
  }
  function nextRequest(){
    if(wanted?.kind!=='journey'||!segmented||targetIndex===null||targetIndex===wanted.index)return null;
    return {kind:'journey',index:wanted.index+Math.sign(targetIndex-wanted.index)*Math.min(2,Math.abs(targetIndex-wanted.index))};
  }
  function pump(){
    if(disposed||suspended||failure||pending||!wanted)return;
    if(wanted.kind==='opening'&&openingPlaying)return;
    if(!settled()&&prepared){
      const ready=prepared;prepared=null;
      if(equal(ready.request,wanted)){paint(wanted,ready.video);pump();return;}
    }
    // Decode one clock step during its presentation interval. The source owns
    // this picture in its existing bounded cache; paint only after selection.
    const speculative=settled(),request=speculative?nextRequest():{...wanted};
    if(!request||(speculative&&equal(prepared?.request,request)))return;
    prepared=null;
    if(request.kind==='journey'&&segmented){
      pending=request;
      segmented.frameAt(request.index).then(video=>{
        if(disposed||pending!==request)return;
        pending=null;
        if(!speculative||equal(request,wanted))paint(request,video);
        else if(settled()&&equal(request,nextRequest()))prepared={request,video};
        pump();
      }).catch(async(error)=>{
        if(disposed||pending!==request)return;
        if(request.cancelled&&error?.name==='AbortError'){pending=null;pump();return;}
        if(segmented?.engine==='webcodecs'){
          pending=null;segmented.dispose();segmented=createSegmentedVideoSource(clips.journey.segments,size);pump();return;
        }
        pending=null;segmented?.dispose();segmented=null;
        try{await loadNative('journey',true);pump()}catch(error){fail(error)}
      });
      return;
    }
    const video=videos[request.kind],time=(request.index+.25)/manifest.fps;
    if(!video)return;
    if(video.readyState<2)return;
    if(!video.seeking&&Math.abs(video.currentTime-time)<.25/manifest.fps){paint(request);return;}
    pending=request;
    timeout=setTimeout(()=>fail(Error('Rendered entrance seek timed out')),15000);
    try{video.currentTime=time;}catch(error){fail(error);}
  }
  const sectionAt=index=>clips.journey.segments?.find(part=>part.firstFrame<=JOURNEY_START_FRAME+index&&part.lastFrame>=JOURNEY_START_FRAME+index)?.url;
  function select(kind,index){
    if(kind==='journey'){
      const url=sectionAt(index),shown=displayed?.kind==='journey'?displayed.index:0;
      // Drop an obsolete network wait on a jump or reversal. Let an active
      // decode finish, and never cancel the normal forward presentation step.
      if(pending?.kind==='journey'&&(sectionAt(pending.index)!==url||pending.index<Math.min(shown,index)||pending.index>Math.max(shown,index))&&segmented?.cancelPending?.())pending.cancelled=true;
    }
    wanted={kind,index};pump();
  }
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
  function loadNative(kind,forceLocal=false){
    if(disposed)return Promise.reject(new DOMException('Entrance disposed','AbortError'));
    return new Promise((resolve,reject)=>{
      const video=document.createElement('video');videos[kind]=video;
      video.crossOrigin='anonymous';video.muted=true;video.playsInline=true;video.preload='auto';video.setAttribute('webkit-playsinline','');
      let local=forceLocal||clips[kind].url===clips[kind].local,timer;
      const clear=()=>{clearTimeout(timer);loadingTimers.delete(timer)};
      const arm=()=>{clear();timer=setTimeout(()=>retryOrFail(Error('Rendered entrance loading timed out')),30000);loadingTimers.add(timer)};
      const retryOrFail=error=>{
        clear();
        if(!local&&!disposed){
          local=true;
          if(pending?.kind===kind){pending=null;clearTimeout(timeout)}
          if(painted?.kind===kind)painted=null;
          if(kind==='opening')stopOpening();
          video.src=clips[kind].local;arm();video.load();
        }else{reject(error);fail(error)}
      };
      arm();
      events.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('Entrance disposed','AbortError'));},{once:true});
      const loaded=()=>{
        const width=local?(clips[kind].localWidth??1920):manifest.width,height=local?(clips[kind].localHeight??1080):manifest.height;
        if(video.videoWidth!==width||video.videoHeight!==height||Math.abs(video.duration-manifest.clips[kind].frameCount/60)>.02){retryOrFail(Error('Rendered entrance media does not match its manifest'));return}
        clear();resolve();pump();
      };
      video.addEventListener('loadeddata',loaded,{signal:events.signal});
      video.addEventListener('error',()=>retryOrFail(Error('Rendered entrance video failed')),{signal:events.signal});
      video.addEventListener('seeked',()=>{
        if(!pending||pending.kind!==kind)return;
        const request=pending;pending=null;clearTimeout(timeout);
        paint(request);pump();
      },{signal:events.signal});
      video.src=forceLocal?clips[kind].local:buffer.url(clips[kind].url);video.load();
    });
  }
  async function prepareJourney(){
    if(!segmented)return loadNative('journey');
    try{await segmented.frameAt(0)}catch(error){
      if(disposed)throw error;
      const streaming=segmented.engine==='webcodecs';segmented.dispose();
      segmented=streaming?createSegmentedVideoSource(clips.journey.segments,size):null;
      return segmented?prepareJourney():loadNative('journey',true);
    }
  }
  async function loadVariant(){
    try{await buffer.load()}catch(error){
      if(disposed)throw error;
      buffer.dispose();segmented?.dispose();segmented=null;
      for(const clip of Object.values(clips)){clip.url=clip.local;clip.bytes=clip.localBytes;}
      buffer=createPreloadedVideo([clips.opening,clips.journey],{onProgress});
      await buffer.load();
    }
    await Promise.all([loadNative('opening'),prepareJourney()]);
  }
  return {
    loadVariant,
    renderAt(frame,target){
      stopOpening();targetIndex=Number.isFinite(target)?Math.max(0,Math.min(1830,Math.round(target-JOURNEY_START_FRAME))):null;
      select('journey',Math.max(0,Math.min(1830,Math.round(frame-JOURNEY_START_FRAME))));
    },
    renderAssemblyAt(frame){
      const index=Math.max(0,Math.min(239,Math.round(frame)-1)),video=videos.opening;
      // Frame 1 stays paused under the loader. Once the assembly clock starts,
      // native playback delivers consecutive frames without repeated seeks.
      if(index>0&&painted?.kind==='opening'&&!pending&&!autoplayBlocked&&video.requestVideoFrameCallback){
        wanted={kind:'opening',index};openingPlaying=true;playOpening();
      }else select('opening',index);
    },
    whenSettled(){if(failure)return Promise.reject(failure);return settled()?Promise.resolve():new Promise((resolve,reject)=>waiters.add({resolve,reject}));},
    get settled(){return settled();},get displayedFrame(){return displayed?.kind==='journey'?JOURNEY_START_FRAME+displayed.index:null;},
    get sourceWidth(){return sourceWidth;},get sourceHeight(){return sourceHeight;},
    resize(){
      // Repaint the selected frame with the new viewport, including at rest.
      // Request it from the source's bounded cache instead of retaining another
      // decoder-owned picture that could exhaust a phone's output surfaces.
      painted=null;prepared=null;pump();
    },
    suspend(value=true){suspended=value;if(value){clearTimeout(timeout);if(!segmented)pending=null;videos.opening?.pause();}else{if(openingPlaying)playOpening();else{pump();}}},
    dispose(){
      if(disposed)return;stopOpening();disposed=true;clearTimeout(timeout);events.abort();
      segmented?.dispose();segmented=null;prepared=null;
      buffer.dispose();
      for(const timer of loadingTimers)clearTimeout(timer);loadingTimers.clear();
      for(const video of Object.values(videos)){video.pause();video.removeAttribute('src');video.load();}
      for(const waiter of waiters)waiter.reject(new DOMException('Entrance disposed','AbortError'));waiters.clear();canvas.remove();
    },
    profileFrames:[],get policy(){return {video:true,segmented:!!segmented,streaming:segmented?.engine==='webcodecs',preloaded:buffer.ready,preloadedBytes:buffer.bytes,preview:false,previewVisible:false,sourceWidth,sourceHeight,visibleArea:!!crop,drawingWidth:canvas.width,drawingHeight:canvas.height,crop:crop?{x:crop.x,y:crop.y,width:crop.width,height:crop.height}:null,...(diagnostics?{paintMetrics:paintMetrics(),decoderMetrics:segmented?.metrics??null}:{})}},batchingMode:'video',
    renderer:{domElement:canvas,getPixelRatio:()=>1,info:{render:{calls:0,triangles:0}}},
  };
}
