import {createPreloadedVideo} from './preloaded-video.mjs';
import {loadEntranceMedia} from './video-delivery.mjs';
import {createVideoTransferPolicy} from './video-transfer-policy.mjs';

const filesFor=media=>[media.clips.opening,...(media.clips.journey.segments||[media.clips.journey])];
function bundledMedia(media){
  const clips=Object.fromEntries(['opening','journey'].map(kind=>{
    const clip=media.clips[kind];
    return [kind,{url:clip.local,local:clip.local,bytes:clip.localBytes,localBytes:clip.localBytes,
      localWidth:clip.localWidth??1920,localHeight:clip.localHeight??1080}];
  }));
  return {manifest:{...media.manifest,width:clips.opening.localWidth,height:clips.opening.localHeight},clips};
}

// Measure useful video bytes while the loader is opaque. A one-way downgrade
// avoids both a throwaway speed-test request and hot-swapping painted frames.
export function createAdaptiveVideoPreload(initialMedia,{onProgress=()=>{},fetcher=fetch,
  createBuffer=createPreloadedVideo,loadMedia=loadEntranceMedia,clock=()=>performance.now(),
  document=globalThis.document,timers=globalThis}={}){
  const lifetime=new AbortController();
  let media=initialMedia,buffer,loading,loaded=0;
  let selection={reason:media.selectionReason??'preferred',width:media.manifest.width,switches:0,discardedBytes:0};
  const check=()=>lifetime.signal.throwIfAborted();
  const makeBuffer=()=>{
    loaded=0;
    return createBuffer(filesFor(media),{fetcher,clock,bypassHTTPCache:media.manifest.width===3840,
      onProgress:(value,total)=>{loaded=value;onProgress(value,total)}});
  };
  const isBundled=()=>['opening','journey'].every(kind=>media.clips[kind].url===media.clips[kind].local);
  buffer=makeBuffer();

  async function preload(measured){
    check();let stop=()=>{};
    if(measured){
      // The current CDN HD set is slightly larger than bundled HD; do not
      // discard almost-finished 4K based on the smaller bundled byte count.
      const fallbackBytes=Math.max(61882825,['opening','journey'].reduce((sum,kind)=>sum+(media.clips[kind].localBytes||0),0));
      const policy=createVideoTransferPolicy({fallbackBytes});
      // Keep byte progress local to this attempt; cached bytes affect remaining
      // work, but the preloader's network counters alone establish throughput.
      const observe=()=>{
        if(lifetime.signal.aborted||buffer.ready)return;
        const transfer=buffer.networkProgress;
        if(!transfer)return;
        const decision=policy.observe({...transfer,now:clock(),loaded,total:buffer.bytes,hidden:document?.hidden===true});
        if(decision){selection={...selection,...decision,width:1920,switches:1};buffer.dispose();}
        else if(policy.diagnostic){
          const {mbps,observedMs,estimatedRemainingMs}=policy.diagnostic;
          selection={...selection,mbps,observedMs,estimatedRemainingMs};
        }
      };
      const reset=()=>policy.reset();
      const timer=timers.setInterval(observe,250);
      document?.addEventListener?.('visibilitychange',reset);
      stop=()=>{timers.clearInterval(timer);document?.removeEventListener?.('visibilitychange',reset)};
    }
    try{await buffer.load();check();}
    finally{stop();}
  }

  async function load(){
    try{await preload(media.manifest.width===3840);}
    catch(error){
      check();buffer.dispose();
      if(media.manifest.width===3840){
        const slow=selection.reason==='slow-network';
        selection={...selection,reason:slow?'slow-network':'cdn-fallback',width:1920,switches:1};
        try{media=await loadMedia(fetcher,{option:'2',signal:lifetime.signal});}
        catch(error){check();media=bundledMedia(media);selection={...selection,reason:'local-fallback'};}
        check();
        // An invalid/custom loader cannot silently put us back into 4K.
        if(media.manifest.width!==1920)media=bundledMedia(media);
        buffer=makeBuffer();
        try{await preload(false);}
        catch(error){check();buffer.dispose();if(isBundled())throw error;media=bundledMedia(media);selection={...selection,reason:'local-fallback'};buffer=makeBuffer();await preload(false);}
      }else{
        if(isBundled())throw error;
        media=bundledMedia(media);selection={...selection,reason:'local-fallback',width:1920};
        buffer=makeBuffer();await preload(false);
      }
    }
    check();return {...media,buffer,selection};
  }
  return {
    load(){return loading??=load()},
    get selection(){return {...selection}},
    dispose(){lifetime.abort(new DOMException('Entrance preload disposed','AbortError'));buffer.dispose()},
  };
}
