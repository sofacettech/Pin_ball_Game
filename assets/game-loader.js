(() => {
 'use strict';
 if(window.sofacetGameLoader)return;
 const root=document.getElementById('game-loading-screen');
 if(!root)return;
 // Retire any canvas left by an older, already-open preview.
 root.querySelectorAll('canvas').forEach(canvas=>canvas.remove());
 const statement=root.querySelector('.loading-statement');
 const status=root.querySelector('[role="status"]'),error=root.querySelector('.game-loading-error');
 const phrases=[
  'Your points could become something precious',
  'Your next high score is loading',
  'Every 10 points gets you ₹1 closer to your first diamond',
  'Play well. Save your points. Shine later',
  "Let's see what's yours?"
 ];
 // The supplied display face has letters only. Draw its missing symbols rather
 // than silently switching any part of the statements to a different font.
 const symbols={
  '1':['M5 7 10 3V24',.4],
  '0':['M11 3C1 3 1 24 11 24S21 3 11 3Z',.6],
  '₹':['M3 4h16M3 10h16M13 4c3 8-2 11-10 11l14 10',.62],
  '.':['M10 23h2v2h-2Z',.2],
  "'":['M10 3h2l-2 5',.2],
  '’':['M10 3h2l-2 5',.2],
  '?':['M4 8C4 0 19 0 19 8c0 6-8 6-8 12M10 24h2v1h-2',.55]
 };
 const gamePage=document.body.hasAttribute('data-game-loading');
 const motion=matchMedia('(prefers-reduced-motion: reduce)');
 let animation,fade=0,delay=0,turn=0;
 let active=false,failed=false,parentVisible=parent===window,events,observer,blocked=[];
 function glyphs(text){
  return [...text].map(character=>{
   if(!symbols[character])return document.createTextNode(character);
   const [path,width]=symbols[character],span=document.createElement('span'),copy=document.createElement('span');
   span.className='loading-symbol';span.style.width=width+'em';copy.className='loading-symbol-copy';copy.textContent=character;
   const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),shape=document.createElementNS('http://www.w3.org/2000/svg','path');
   svg.setAttribute('viewBox','0 0 22 28');svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('aria-hidden','true');shape.setAttribute('d',path);svg.append(shape);span.append(copy,svg);return span;
  });
 }
 function renderStatement(){
  statement.dataset.statement=String(turn%phrases.length);
  statement.style.color=turn%2?'#c9a0ff':'#fff';
  statement.replaceChildren(...phrases[turn%phrases.length].split(/(10|₹1)/).flatMap(part=>{
   if(part!=='10'&&part!=='₹1')return glyphs(part);
   const token=document.createElement('span');token.className='loading-token';token.append(...glyphs(part));return token;
  }));
 }
 function stop(){animation?.pause()}
 function cleanup(){animation?.cancel();animation=null;events?.abort();observer?.disconnect();events=observer=null;clearTimeout(delay)}
 function measure(){
  const anchors=gamePage?document.querySelectorAll('.navbar-backdrop,.nav-trim,#game-header .site-brand,#nav-toggle'):document.querySelectorAll('.site-brand,[data-menu-toggle]');
  let top=0;
  for(const element of anchors){const box=element.getBoundingClientRect();if(box.width&&box.height&&getComputedStyle(element).visibility!=='hidden')top=Math.max(top,box.bottom)}
  root.style.setProperty('--game-loader-top',Math.ceil(top+4)+'px');
 }
 function cycle(first=false){
  if(!active||failed||motion.matches)return;
  animation=statement.animate([{opacity:first?1:0,offset:0},{opacity:1,offset:.18},{opacity:1,offset:.80},{opacity:0,offset:1}],{duration:4400,easing:'ease-in-out'});
  animation.onfinish=()=>{if(!active||failed)return;turn++;renderStatement();cycle()};
  if(document.hidden||!parentVisible)stop();
 }
 function resume(){
  if(!active||failed||root.hidden)return;
  measure();
  if(document.hidden||!parentVisible){stop();return}
  if(!motion.matches){if(animation)animation.play();else cycle(true)}
 }
 function listen(){
  events=new AbortController();const signal=events.signal;
  addEventListener('resize',measure,{signal});visualViewport?.addEventListener('resize',measure,{signal});
  document.addEventListener('visibilitychange',()=>document.hidden?stop():resume(),{signal});
  motion.addEventListener('change',()=>{animation?.cancel();animation=null;resume()},{signal});
  observer=new ResizeObserver(measure);
  for(const element of document.querySelectorAll('#game-header,.navbar-backdrop,.site-brand,[data-menu-toggle]'))observer.observe(element);
 }
 function show(){
  if(active&&!failed)return;
  clearTimeout(fade);cleanup();active=true;failed=false;turn=0;root.hidden=false;delete root.dataset.state;error.hidden=true;
  status.firstChild.textContent='Preparing your table. ';
  renderStatement();
  blocked=[...document.querySelectorAll('#stage')].map(element=>[element,element.inert]);for(const [element] of blocked)element.inert=true;
  listen();resume();
  delay=setTimeout(()=>{if(active&&!failed)status.firstChild.textContent='Still preparing your game. Please wait. '},20000);
 }
 function hide(){clearTimeout(fade);cleanup();root.hidden=true;active=false;delete root.dataset.state;for(const [element,inert] of blocked)element.inert=inert;blocked=[];if(gamePage&&document.getElementById('stage')?.dataset.ready==='true')document.body.removeAttribute('data-game-loading')}
 function ready(){
  if(failed)return;
  cleanup();active=false;const stage=document.getElementById('stage');if(stage){stage.inert=false;stage.dataset.ready='true';stage.setAttribute('aria-busy','false')}
  blocked=[];root.dataset.state='leaving';
  fade=setTimeout(()=>{root.hidden=true;document.body.removeAttribute('data-game-loading')},motion.matches?0:200);
 }
 function fail(){
  if(root.hidden)show();failed=true;cleanup();active=false;error.hidden=false;root.dataset.state='error';document.getElementById('stage')?.setAttribute('aria-busy','false');
 }
 const style=document.getElementById('game-entry-style');
 const stylesReady=style?.dataset.failed?Promise.reject(Error('Game styles unavailable')):!style||style.sheet?Promise.resolve():new Promise((resolve,reject)=>{style.addEventListener('load',resolve,{once:true});style.addEventListener('error',()=>{fail();reject(Error('Game styles unavailable'))},{once:true})});
 stylesReady.catch(fail);
 window.sofacetGameLoader={show,ready,fail,cancel:hide,stylesReady,isActive:()=>parentVisible,setActive(value){parentVisible=value;value?resume():stop()}};
 root.querySelector('[data-game-retry]').onclick=()=>location.reload();
 document.addEventListener('click',event=>{
  if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||event.defaultPrevented)return;
  const link=event.target.closest?.('a[href]');if(!link||link.target==='_blank'||link.hasAttribute('download'))return;
  const url=new URL(link.href,location.href);if(url.origin!==location.origin||url.pathname!=='/play.html')return;
  show();setTimeout(()=>{if(event.defaultPrevented)hide()},0);
 },true);
 addEventListener('message',event=>{if(event.source===parent&&event.origin===location.origin&&event.data?.type==='sofacet:experience-visibility'&&typeof event.data.visible==='boolean')window.sofacetGameLoader.setActive(event.data.visible)});
 addEventListener('pagehide',()=>{cleanup();clearTimeout(fade)});
 addEventListener('pageshow',event=>{if(event.persisted){if(gamePage&&failed){root.hidden=false;return}if(gamePage&&document.getElementById('stage')?.dataset.ready!=='true'){active=false;show()}else hide()}});
 if(gamePage){
  show();
  const entry=document.getElementById('game-loader-controller').dataset.gameEntry;
  // Show the initial shell before evaluating the game module; never wait for
  // the statement sequence or font loading before initializing the game.
  const load=()=>import(new URL(entry,location.href).href).catch(fail);
  if(entry){if(document.hidden||!parentVisible)setTimeout(load,0);else requestAnimationFrame(()=>setTimeout(load,0))}
 }
})();
