import {selectEntranceOption} from './entrance-option.mjs';
import {entranceVideoPreference} from './video-quality.mjs';

export function validateEntranceManifest(manifest,{width=1920,height=1080}={}){
  if(manifest?.version!==1||manifest.width!==width||manifest.height!==height||manifest.fps!==60||manifest.firstFrame!==334||manifest.lastFrame!==2164||
    manifest.clips?.opening?.frameCount!==240||manifest.clips?.journey?.frameCount!==1831)throw Error('Invalid rendered entrance');
  return manifest;
}

// A separate switch prevents an existing legacy-video CDN setting from selecting
// new objects before they have been uploaded and verified.
export async function loadEntranceMedia(fetcher=fetch,{option=selectEntranceOption(globalThis.location?.search||''),navigator=globalThis.navigator,signal}={}){
  const preference=entranceVideoPreference({option,navigator}),width=preference.width;
  // Keep the deadline/parent cancellation through JSON body consumption too.
  const readManifest=async(url,milliseconds)=>{
    signal?.throwIfAborted();
    const controller=new AbortController(),abort=()=>controller.abort(signal.reason);
    const timer=setTimeout(()=>controller.abort(new DOMException('Entrance manifest timed out','TimeoutError')),milliseconds);
    signal?.addEventListener('abort',abort,{once:true});
    try{
      const response=await fetcher(url,{signal:controller.signal});
      if(!response.ok)throw Error('Entrance manifest unavailable');
      const data=await response.json();controller.signal.throwIfAborted();return data;
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  };
  const localBase='/assets/entrance-video/';
  const [localManifest,config]=await Promise.all([
    readManifest(localBase+'manifest.json',5000),
    readManifest('/api/media-config',2500).catch(error=>{signal?.throwIfAborted();return {}}),
  ]);
  const manifest=validateEntranceManifest(localManifest);
  const clips=Object.fromEntries(['opening','journey'].map(kind=>{
    const local=localBase+kind+'.mp4?v='+manifest.clips[kind].sha256;
    return [kind,{url:local,local,bytes:manifest.clips[kind].bytes,localBytes:manifest.clips[kind].bytes,localWidth:manifest.width,localHeight:manifest.height}];
  }));
  const candidates=[...(width===3840?[{url:config.entrance4kManifestURL,width:3840,height:2160}]:[]),{url:config.entranceManifestURL,width:1920,height:1080}];
  for(const candidate of candidates.filter(item=>item.url))try{
    const url=new URL(candidate.url);
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('Invalid entrance CDN URL');
    const higherQuality=validateEntranceManifest(await readManifest(url.href,5000),candidate);
    const urls={};let segments,preview;
    const validFile=(clip,kind)=>/^[a-f0-9]{64}$/.test(clip.sha256)&&clip.file===`entrance-${kind}-${clip.sha256}.mp4`&&Number.isSafeInteger(clip.bytes)&&clip.bytes>0;
    for(const kind of ['opening','journey']){
      const clip=higherQuality.clips[kind];
      if(!validFile(clip,kind))throw Error('Invalid entrance CDN media');
      urls[kind]=new URL(clip.file,url).href;
    }
    if(higherQuality.clips.journey.segments){
      const parts=higherQuality.clips.journey.segments;
      if(!Array.isArray(parts)||parts.length>32||!parts.length)throw Error('Invalid video sections');
      let next=334;
      segments=parts.map(part=>{
        if(!validFile(part,'journey')||part.bytes>24*1024*1024||!Number.isInteger(part.frameCount)||part.frameCount<1||part.frameCount>120||part.firstFrame!==next||part.lastFrame!==next+part.frameCount-1)throw Error('Invalid video section timeline');
        next=part.lastFrame+1;return {...part,url:new URL(part.file,url).href};
      });
      if(next!==2165)throw Error('Incomplete video section timeline');
      const validateIndex=(decoder,parts)=>{
        if(!/^avc1\.[a-f0-9]{6}$/.test(decoder.codec)||!/^01[a-f0-9]{14,4094}$/.test(decoder.description)||decoder.description.length%2)throw Error('Invalid video decoder configuration');
        const interval=decoder.keyframeInterval??4;
        if(![4,12].includes(interval))throw Error('Invalid prediction group');
        for(const part of parts){
          if(!Array.isArray(part.frames)||part.frames.length!==part.frameCount)throw Error('Incomplete video frame index');
          let end=0;
          for(const [i,sample] of part.frames.entries()){
            if(!Array.isArray(sample)||sample.length!==3||!sample.every(Number.isSafeInteger)||sample[0]<end||sample[1]<=0||sample[0]+sample[1]>part.bytes||sample[2]!==Number(i%interval===0))throw Error('Invalid video frame range');
            end=sample[0]+sample[1];
          }
        }
      };
      const decoder=higherQuality.clips.journey.decoder;
      if(decoder)validateIndex(decoder,segments);
      const proxy=higherQuality.clips.journey.preview;
      if(proxy){
        if(!validFile(proxy,'journey')||proxy.bytes>12*1024*1024||proxy.width!==512||proxy.height!==288||proxy.frameCount!==1831||proxy.firstFrame!==334||proxy.lastFrame!==2164||!proxy.decoder)throw Error('Invalid motion preview');
        validateIndex(proxy.decoder,[proxy]);preview={...proxy,url:new URL(proxy.file,url).href};
      }
    }
    for(const kind of ['opening','journey']){clips[kind].url=urls[kind];clips[kind].bytes=higherQuality.clips[kind].bytes;}
    if(segments){clips.journey.segments=segments;clips.journey.decoder=higherQuality.clips.journey.decoder;}
    if(preview)clips.journey.preview=preview;
    return {manifest:higherQuality,clips,selectionReason:candidate.width===width?preference.reason:'cdn-fallback'};
  }catch{signal?.throwIfAborted();/* Try the regular CDN, then bundled media. */}
  return {manifest,clips,selectionReason:width===1920?preference.reason:'cdn-fallback'};
}
