import React,{useLayoutEffect,useRef} from 'react';
import {mountScoreMesh} from '../../game-source/src/score-mesh.js';

export function DashboardMesh(){
 const surface=useRef(null);
 useLayoutEffect(()=>{
  document.body.setAttribute('data-coins-dashboard','');
  const layer=surface.current,mesh=mountScoreMesh(layer,()=>{},{backgroundColor:'#000',ambient:false});
  let active=true,frame=0;
  document.fonts.ready.then(()=>{
   if(!active)return;
   frame=requestAnimationFrame(()=>{frame=requestAnimationFrame(()=>{
    if(!active||!mesh||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    const score=document.querySelector('#account-screen .score-number > span')?.getBoundingClientRect(),bounds=layer.getBoundingClientRect();
    if(score)mesh.start(score.left+score.width/2-bounds.left,score.top+score.height/2-bounds.top,'opening');
   })});
  });
  return()=>{active=false;cancelAnimationFrame(frame);mesh?.dispose();document.body.removeAttribute('data-coins-dashboard')};
 },[]);
 return <div className="dashboard-mesh" ref={surface} aria-hidden="true"><canvas/></div>;
}
