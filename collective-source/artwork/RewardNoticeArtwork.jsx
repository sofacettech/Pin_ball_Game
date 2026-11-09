import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {AccountArtwork, butterflyTexture} from './AccountArtwork.jsx';

export function RewardNoticeArtwork() {
  const [status,setStatus]=useState('loading');
  const [meshReady,setMeshReady]=useState(false);
  const mesh=useRef(null),art=useRef(null);
  useLayoutEffect(()=>{
    let active=true;
    let timedOut=false;
    const timeout=setTimeout(()=>{timedOut=true;setStatus('fallback');},1600);
    const image=new Image();
    image.src=butterflyTexture;
    image.decode().then(()=>{
      if(active)setStatus(timedOut?'fallback':'ready');
    },()=>{
      if(active)setStatus('fallback');
    }).finally(()=>clearTimeout(timeout));
    return ()=>{active=false;clearTimeout(timeout);};
  },[]);
  useEffect(()=>{
    if(!meshReady||status==='loading')return;
    let frame=requestAnimationFrame(()=>{
      frame=requestAnimationFrame(()=>{
        const bounds=mesh.current.getBoundingClientRect();
        const butterfly=art.current.querySelector('.butterfly-scene').getBoundingClientRect();
        mesh.current.contentWindow?.__startMeshWave?.(
          butterfly.left+butterfly.width*.39-bounds.left,
          butterfly.top+butterfly.height*.27-bounds.top,'opening');
      });
    });
    return ()=>cancelAnimationFrame(frame);
  },[meshReady,status]);
  return <>
    <iframe ref={mesh} className="reward-notice-mesh" src="/assets/collective/meshes/rewards.html?theme=black"
      title="Decorative mesh" aria-hidden="true" tabIndex={-1} onLoad={()=>setMeshReady(true)}/>
    <div ref={art} className="reward-notice-art" aria-hidden="true" data-art={status}><AccountArtwork/></div>
  </>;
}

export function mountRewardNoticeArtwork(container) {
  const root=createRoot(container);
  return view=>{
    if(view)flushSync(()=>root.render(<RewardNoticeArtwork key={view}/>));
    else root.render(null);
  };
}
