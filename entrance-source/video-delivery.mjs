export function validateEntranceManifest(manifest){
  if(manifest?.version!==1||manifest.width!==1920||manifest.height!==1080||manifest.fps!==60||manifest.firstFrame!==334||manifest.lastFrame!==2164||
    manifest.clips?.opening?.frameCount!==240||manifest.clips?.journey?.frameCount!==1831)throw Error('Invalid rendered entrance');
  return manifest;
}

// A separate switch prevents an existing legacy-video CDN setting from selecting
// new objects before they have been uploaded and verified.
export async function loadEntranceMedia(fetcher=fetch){
  const localBase='/assets/entrance-video/';
  const [response,config]=await Promise.all([
    fetcher(localBase+'manifest.json'),
    fetcher('/api/media-config',{signal:AbortSignal.timeout(2500)}).then(response=>response.ok?response.json():{}).catch(()=>({})),
  ]);
  if(!response.ok)throw Error('Rendered entrance is unavailable');
  const manifest=validateEntranceManifest(await response.json());
  const clips=Object.fromEntries(['opening','journey'].map(kind=>{
    const local=localBase+kind+'.mp4?v='+manifest.clips[kind].sha256;
    return [kind,{url:local,local}];
  }));
  try{
    if(!config.entranceManifestURL)return {manifest,clips};
    const url=new URL(config.entranceManifestURL);
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('Invalid entrance CDN URL');
    const remote=await fetcher(url.href,{signal:AbortSignal.timeout(5000)});
    if(!remote.ok)throw Error('Entrance CDN unavailable');
    const higherQuality=validateEntranceManifest(await remote.json());
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
    for(const kind of ['opening','journey'])clips[kind].url=urls[kind];
    if(segments){clips.journey.segments=segments;clips.journey.decoder=higherQuality.clips.journey.decoder;}
    if(preview)clips.journey.preview=preview;
  }catch{/* Local media keeps the entrance available if CDN configuration fails. */}
  return {manifest,clips};
}
