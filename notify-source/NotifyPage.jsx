import React,{useEffect,useRef} from 'react';
import {createAnimationScope} from '../collective-source/animation-scope.js';
import {initializeCarousel} from './carousel.js';
import {initializeMesh} from './mesh.js';
import {accountNavigationHref} from '../shared/account-session.js';

const photographs=[
 ['sofacet-pear-ring.jpg','yellow pear-shaped ring','Yellow pear-shaped stone in a sculptural ring on violet fabric.'],
 ['blue-earrings.webp','blue earrings, worn','A model wearing an oval blue earring with a sparkling centre.'],
 ['leaf-earrings.webp','leaf-shaped earrings','Leaf-shaped sparkling earrings resting on blue fabric.'],
 ['butterfly.webp','butterfly-shaped jewel','A faceted butterfly-shaped jewel against a blue background.'],
 ['sofacet-oval-diamond-ring.jpg','oval-stone ring','An oval-stone gold-coloured ring with a sparkling band against violet.'],
 ['bracelet.webp','bracelet, worn',"A charm bracelet on a model's wrist as she holds a glass sphere."],
];
export default function NotifyPage(){
 const root=useRef(null),join=useRef(null),about=useRef(null);
 useEffect(()=>{
  const scope=createAnimationScope(root.current);
  initializeCarousel(scope);initializeMesh(scope);
  return()=>scope.dispose();
 },[]);
 function skipToAction(event){
  const target=document.documentElement.hasAttribute('data-signed-in')
   ? about.current
   : join.current;
  if(target?.getClientRects().length){event.preventDefault();target.focus()}
 }
 return <div ref={root}>
  <a className="skip-link" href="#notify" onClick={skipToAction}>Skip to launch options</a>
  <div className="scroll-sequence" id="scroll-sequence"><div className="scene" id="scene">
   <div className="mesh-background" id="mesh-background" role="button" tabIndex={0} aria-label="Interactive mesh background" aria-description="Click or tap an empty area to reveal the facets. Press Enter or Space for a centred wave. Escape clears it."><canvas aria-hidden="true"/></div>
   <div className="site-header" aria-hidden="true"/>
   <main id="top">
    <section className="intro" aria-labelledby="page-title"><h1 className="launch-eyebrow" id="page-title">LAUNCHING SOON</h1></section>
    <section className="collection" id="collection" aria-label="A first look at the collection" aria-roledescription="carousel">
     <div className="orbit-window"><div className="orbit" id="orbit" role="group" aria-label="An endless collection carousel. Scroll, drag or swipe to turn in either direction. You can also use the arrow buttons or arrow keys.">
      {photographs.map(([file,name,alt],index)=><button className="piece" data-index={index} type="button" aria-label={'View photograph '+(index+1)+': '+name} aria-pressed={index===0} key={file}><span className="piece-surface"><img src={'/assets/notify/'+file} alt={alt} width={900} height={1117} fetchPriority={index===0?'high':undefined} draggable={false}/></span></button>)}
     </div></div>
     <div className="collection-controls">
      <button className="arrow" id="previous" type="button" aria-label="Previous photograph"><svg viewBox="0 0 40 24" aria-hidden="true"><path d="M36 12H4m8-8-8 8 8 8"/></svg></button>
      <span className="scroll-cue" aria-hidden="true">Scroll, drag or swipe</span>
      <button className="arrow" id="next" type="button" aria-label="Next photograph"><svg viewBox="0 0 40 24" aria-hidden="true"><path d="M4 12h32m-8-8 8 8-8 8"/></svg></button>
     </div>
     <p className="sr-only" id="photo-status" role="status" aria-live="polite" aria-atomic="true">Photograph 1 of 6: yellow pear-shaped ring.</p>
    </section>
    <section className="notification" id="notify" aria-label="Collection launch notification">
     <div className="notify-join" data-join-for-guests><p>For exclusive early access,<br className="mobile-break"/> updates and more,</p><a ref={join} className="notify-button" href={accountNavigationHref('/join')}>JOIN THE SO/ COLLECTIVE</a></div>
     <div className="notify-member" data-notify-for-members><p>For exclusive early access,<br className="mobile-break"/> updates and more,</p><a ref={about} className="notify-button" href="/about"><span>ABOUT <span className="brand-word">SO/ FACET</span></span><span aria-hidden="true">→</span></a></div>
    </section>
   </main>
  </div></div>
 </div>;
}
