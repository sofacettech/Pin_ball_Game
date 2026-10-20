// Mobile uses smaller loading budgets, while both profiles preserve the original Full HD media.
export function selectMediaVariant({width,coarse=false,saveData=false,effectiveType='',memory=8}) {
  return width <= 1024 || coarse || saveData || /(^|-)2g$/.test(effectiveType) || memory <= 4 ? 'mobile' : 'desktop';
}

export function mediaURL(asset,baseURL,localBase) {
  const local=new URL(asset.file,localBase).href;
  if(!baseURL)return local;
  const base=new URL(baseURL);
  if(base.protocol!=='https:' || base.username || base.password || base.search || base.hash)throw Error('Invalid media CDN URL');
  return new URL(asset.key,base.href.replace(/\/?$/,'/')).href;
}

async function json(url,timeout) {
  const response=await fetch(url,{signal:AbortSignal.timeout(timeout),cache:'no-cache'});
  if(!response.ok)throw Error('Media configuration unavailable');
  return response.json();
}

export async function prepareMedia(opening) {
  const localBase=new URL('./',import.meta.url);
  const variant=selectMediaVariant({
    width:window.innerWidth,coarse:matchMedia('(any-pointer: coarse)').matches,
    saveData:navigator.connection?.saveData,effectiveType:navigator.connection?.effectiveType,
    memory:navigator.deviceMemory,
  });
  const [manifest,config]=await Promise.all([
    json(new URL('video-manifest.json',localBase),5000).catch(()=>null),
    json(new URL('../api/media-config',localBase),2500).catch(()=>({})),
  ]);
  const files=manifest?.version===1&&manifest.variants?.[variant] || {
    journey:{file:'sofacet-experience.mp4',index:'journey-index.json',width:1920,height:1080},
    opening:{file:'sofacet-opening.mp4'},
  };
  function resolve(asset) {
    const local=new URL(asset.file,localBase).href;
    let url=local;
    try{if(asset.key)url=mediaURL(asset,config.baseURL,localBase)}catch{/* A bad CDN setting must not prevent local playback. */}
    return {...asset,url,local};
  }
  const media={variant,journey:resolve(files.journey),opening:resolve(files.opening),indexURL:new URL(files.journey.index,localBase)};
  // Set before src so native fallback can be drawn to a canvas across origins.
  opening.crossOrigin='anonymous';
  opening.addEventListener('error',()=>{
    if(opening.src!==media.opening.local){
      const playing=!opening.paused;
      opening.src=media.opening.local;opening.load();
      if(playing)void opening.play().catch(()=>{});
    }
  },{once:true});
  opening.src=media.opening.url;
  opening.load();
  return media;
}
