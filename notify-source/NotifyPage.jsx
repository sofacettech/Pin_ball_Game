import React,{useEffect,useRef,useState} from 'react';
import {createAnimationScope} from '../collective-source/animation-scope.js';
import {initializeCarousel} from './carousel.js';
import {initializeMesh} from './mesh.js';
import {accountNavigationHref} from '../shared/account-session.js';

const photographs=[
 ['pear-ring','yellow pear-shaped ring','Yellow pear-shaped stone in a sculptural ring on violet fabric.'],
 ['blue-earrings','blue earrings, worn','A model wearing an oval blue earring with a sparkling centre.'],
 ['leaf-earrings','leaf-shaped earrings','Leaf-shaped sparkling earrings resting on blue fabric.'],
 ['butterfly','butterfly-shaped jewel','A faceted butterfly-shaped jewel against a blue background.'],
 ['oval-ring','oval-stone ring','An oval-stone gold-coloured ring with a sparkling band against violet.'],
 ['bracelet','bracelet, worn',"A charm bracelet on a model's wrist as she holds a glass sphere."],
];
export default function NotifyPage(){
 const root=useRef(null),email=useRef(null),confirmation=useRef(null),join=useRef(null);
 const [confirmed,setConfirmed]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  const scope=createAnimationScope(root.current);
  initializeCarousel(scope);initializeMesh(scope);
  return()=>scope.dispose();
 },[]);
 useEffect(()=>{
  if(!confirmed)return;
  confirmation.current.querySelector('h2').focus({preventScroll:true});
  if(!matchMedia('(prefers-reduced-motion: reduce)').matches)confirmation.current.animate([{opacity:0},{opacity:1}],{duration:250,easing:'ease-out'});
 },[confirmed]);
 function submit(event){
  event.preventDefault();email.current.value=email.current.value.trim();
  if(!email.current.checkValidity()){
   setError(email.current.validity.valueMissing?'Enter your email address.':'Enter a valid email, such as you@example.com.');
   email.current.focus({preventScroll:true});return;
  }
  setError('');setConfirmed(true);
 }
 function reset(){setConfirmed(false);setError('');email.current.form.reset();requestAnimationFrame(()=>email.current.focus({preventScroll:true}))}
 function skipToAction(event){
  const target=document.documentElement.hasAttribute('data-signed-in')
   ? (confirmed?confirmation.current.querySelector('h2'):email.current)
   : join.current;
  if(target?.getClientRects().length){event.preventDefault();target.focus()}
 }
 return <div ref={root}>
  <a className="skip-link" href="#notify" onClick={skipToAction}>Skip to launch options</a>
  <div className="scroll-sequence" id="scroll-sequence"><div className="scene" id="scene">
   <div className="mesh-background" id="mesh-background" role="button" tabIndex={0} aria-label="Interactive mesh background" aria-description="Click or tap an empty area to reveal the facets. Press Enter or Space for a centred wave. Escape clears it."><canvas aria-hidden="true"/></div>
   <div className="site-header" aria-hidden="true"/>
   <main id="top">
    <section className="intro" aria-labelledby="page-title"><p className="launch-eyebrow">LAUNCHING SOON</p><h1 id="page-title">A new facet <span>of you.</span></h1><p className="lead">Something SO/ you.</p></section>
    <section className="collection" id="collection" aria-label="A first look at the collection" aria-roledescription="carousel">
     <div className="orbit-window"><div className="orbit" id="orbit" role="group" aria-label="An endless collection carousel. Scroll, drag or swipe to turn in either direction. You can also use the arrow buttons or arrow keys.">
      {photographs.map(([file,name,alt],index)=><button className="piece" data-index={index} type="button" aria-label={'View photograph '+(index+1)+': '+name} aria-pressed={index===0} key={file}><span className="piece-surface"><img src={'/assets/notify/'+file+'.webp'} alt={alt} width={900} height={1117} fetchPriority={index===0?'high':undefined} draggable={false}/></span></button>)}
     </div></div>
     <div className="collection-controls">
      <button className="arrow" id="previous" type="button" aria-label="Previous photograph"><svg viewBox="0 0 40 24" aria-hidden="true"><path d="M36 12H4m8-8-8 8 8 8"/></svg></button>
      <span className="scroll-cue" aria-hidden="true">Scroll, drag or swipe</span>
      <button className="arrow" id="next" type="button" aria-label="Next photograph"><svg viewBox="0 0 40 24" aria-hidden="true"><path d="M4 12h32m-8-8 8 8-8 8"/></svg></button>
     </div>
     <p className="sr-only" id="photo-status" role="status" aria-live="polite" aria-atomic="true">Photograph 1 of 6: yellow pear-shaped ring.</p>
    </section>
    <section className="notification" id="notify" aria-label="Collection launch notification">
     <div className="notify-join" data-join-for-guests><a ref={join} className="notify-button" href={accountNavigationHref('/join')}>JOIN SO/ COLLECTIVE</a></div>
     <form id="notify-form" data-notify-for-members noValidate onSubmit={submit} hidden={confirmed}>
      <div className="form-row"><div className="email-field">
       <label htmlFor="email">Email address</label><input ref={email} id="email" name="email" type="email" autoComplete="email" inputMode="email" placeholder="you@example.com" required maxLength={254} aria-describedby="form-message" aria-invalid={error?true:undefined} onInput={()=>setError('')}/>
      </div><button className="notify-button" type="submit">Notify me</button></div>
      <p className="form-message" id="form-message" role="status" aria-live="polite">{error}</p>
     </form>
     <div className="confirmation" id="confirmation" data-notify-for-members ref={confirmation} hidden={!confirmed}><h2 tabIndex={-1}>You're in the loop.</h2><p>Preview complete. No signup has been sent.</p><button type="button" id="reset-form" onClick={reset}>Try again</button></div>
    </section>
   </main>
  </div></div>
 </div>;
}
