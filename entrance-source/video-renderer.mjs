import {JOURNEY_START_FRAME} from './journey-scroll.mjs';
import {loadEntranceMedia} from './video-delivery.mjs';
import {createSegmentedVideoSource} from './segmented-video.mjs';
import {createStreamedVideoSource} from './streamed-video.mjs';

// Short GOP media belongs to the browser decoder. The existing all-IDR
// WebCodecs worker cannot decode these samples independently.
export async function createJourneyRenderer({stage,onRender=()=>{},onError=()=>{}}){
  const {manifest,clips}=await loadEntranceMedia();
  const canvas=document.createElement('canvas');canvas.width=manifest.width;canvas.height=manifest.height;
  const context=canvas.getContext('2d',{alpha:false});
  if(!context)throw Error('Video canvas unavailable');
  stage.prepend(canvas);
  const events=new AbortController(),videos={};
  const loadingTimers=new Set();
  const size={width:manifest.width,height:manifest.height};
  let segmented=clips.journey.segments?(await createStreamedVideoSource(clips.journey.segments,clips.journey.decoder,size)||createSegmentedVideoSource(clips.journey.segments,size)):null;
  const proxy=clips.journey.preview;
  const proxySize=proxy?{width:proxy.width,height:proxy.height}:undefined;
  let preview=proxy?(await createStreamedVideoSource([proxy],proxy.decoder,proxySize)||createSegmentedVideoSource([proxy],proxySize)):null;
  let disposed=false,suspended=false,wanted=null,painted=null,pending=null,timeout=null,failure=null;
  let displayed=null,previewPending=null,previewVisible=false,fullPaintSequence=0;
  let sourceWidth=manifest.width,sourceHeight=manifest.height;
  let openingPlaying=false,openingCallback=null,autoplayBlocked=false;
  const waiters=new Set();
  const equal=(a,b)=>a&&b&&a.kind===b.kind&&a.index===b.index;
  const settled=()=>!!equal(wanted,painted)&&!!equal(wanted,displayed)&&!previewVisible;
  function fail(error){
    if(disposed||failure)return;failure=error;clearTimeout(timeout);pending=null;
    for(const waiter of waiters)waiter.reject(error);waiters.clear();onError(error);
  }
  function paint(request,video=videos[request.kind],lightweight=false){
    if(disposed||suspended||failure)return;
    try{context.drawImage(video,0,0,canvas.width,canvas.height);}
    catch(error){fail(error);return;}
    displayed=request;previewVisible=lightweight;
    if(!lightweight){painted=request;fullPaintSequence++;sourceWidth=video.displayWidth||video.videoWidth||canvas.width;sourceHeight=video.displayHeight||video.videoHeight||canvas.height;}
    onRender({frame:request.kind==='opening'?JOURNEY_START_FRAME:JOURNEY_START_FRAME+request.index,width:canvas.width,height:canvas.height});
    if(settled()){for(const waiter of waiters)waiter.resolve();waiters.clear();}
  }
  function pumpPreview(){
    if(!preview||disposed||suspended||failure||previewPending||wanted?.kind!=='journey'||settled())return;
    const request={...wanted},sequence=fullPaintSequence;previewPending=request;
    preview.frameAt(request.index).then(image=>{
      if(disposed||previewPending!==request)return;previewPending=null;
      // A delayed preview must never overwrite a sharper frame. Full resolution
      // completion remains separate from presentation and from game handoff.
      if(sequence===fullPaintSequence&&wanted?.kind==='journey'&&!settled())paint(request,image,true);
      if(!equal(request,wanted))pumpPreview();
    }).catch(()=>{previewPending=null;preview?.dispose();preview=null});
  }
  function pump(){
    if(disposed||suspended||failure||pending||!wanted||settled())return;
    if(wanted.kind==='opening'&&openingPlaying)return;
    const request={...wanted};
    if(request.kind==='journey'&&segmented){
      pending=request;
      segmented.frameAt(request.index).then(video=>{
        if(disposed||pending!==request)return;
        pending=null;if(!preview||equal(request,wanted))paint(request,video);pump();
      }).catch(async()=>{
        if(disposed||pending!==request)return;
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
  function select(kind,index){wanted={kind,index};pump();void Promise.resolve().then(pumpPreview);}
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
        const width=local?(clips[kind].localWidth??1920):canvas.width,height=local?(clips[kind].localHeight??1080):canvas.height;
        if(video.videoWidth!==width||video.videoHeight!==height||Math.abs(video.duration-manifest.clips[kind].frameCount/60)>.02){retryOrFail(Error('Rendered entrance media does not match its manifest'));return}
        clear();resolve();pump();
      };
      video.addEventListener('loadeddata',loaded,{signal:events.signal});
      video.addEventListener('error',()=>retryOrFail(Error('Rendered entrance video failed')),{signal:events.signal});
      video.addEventListener('seeked',()=>{
        if(!pending||pending.kind!==kind)return;
        const request=pending;pending=null;clearTimeout(timeout);
        if(!preview||equal(request,wanted))paint(request);pump();
      },{signal:events.signal});
      video.src=local?clips[kind].local:clips[kind].url;video.load();
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
    await Promise.all([loadNative('opening'),prepareJourney(),preview?.frameAt(0).catch(()=>{preview?.dispose();preview=null})]);
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
    get settled(){return settled();},get displayedFrame(){return displayed?.kind==='journey'?JOURNEY_START_FRAME+displayed.index:null;},
    resize(){pump();},
    suspend(value=true){suspended=value;if(value){clearTimeout(timeout);if(!segmented)pending=null;videos.opening?.pause();}else{if(openingPlaying)playOpening();else{pump();pumpPreview();}}},
    dispose(){
      if(disposed)return;stopOpening();disposed=true;clearTimeout(timeout);events.abort();
      segmented?.dispose();segmented=null;
      preview?.dispose();preview=null;
      for(const timer of loadingTimers)clearTimeout(timer);loadingTimers.clear();
      for(const video of Object.values(videos)){video.pause();video.removeAttribute('src');video.load();}
      for(const waiter of waiters)waiter.reject(new DOMException('Entrance disposed','AbortError'));waiters.clear();canvas.remove();
    },
    profileFrames:[],get policy(){return {video:true,segmented:!!segmented,streaming:segmented?.engine==='webcodecs',preview:!!preview,previewVisible,sourceWidth,sourceHeight}},batchingMode:'video',
    renderer:{domElement:canvas,getPixelRatio:()=>1,info:{render:{calls:0,triangles:0}}},
  };
}
