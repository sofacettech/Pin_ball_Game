import React, {useLayoutEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {AccountArtwork, butterflyTexture} from './AccountArtwork.jsx';

export function RewardNoticeArtwork() {
  const [status,setStatus]=useState('loading');
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
  return <div className="reward-notice-art" aria-hidden="true" data-art={status}><AccountArtwork/></div>;
}

export function mountRewardNoticeArtwork(container) {
  const root=createRoot(container);
  return view=>{
    if(view)flushSync(()=>root.render(<RewardNoticeArtwork key={view}/>));
    else root.render(null);
  };
}
