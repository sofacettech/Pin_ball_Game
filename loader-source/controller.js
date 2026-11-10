export function installGameLoader(renderCards) {
 if(window.sofacetGameLoader)return;
 const root=document.getElementById('game-loading-screen');
 if(!root)return;
 const cards=root.querySelector('#game-loader-cards-root'),status=root.querySelector('.loading-copy'),progress=root.querySelector('.game-loading-progress'),error=root.querySelector('.game-loading-error');
 const statement=progress.querySelector('.game-loading-statement');
 const statements=[...cards.querySelectorAll('.card-copy')].map(copy=>[...copy.children].map(line=>line.innerHTML).join('<br>'));
 const gamePage=document.body.hasAttribute('data-game-loading'),motion=matchMedia('(prefers-reduced-motion: reduce)');
 const parentOwnsCards=gamePage&&parent!==window&&new URL(location.href).searchParams.get('loader')==='parent';
 const chessEntry=gamePage&&new URL(location.href).searchParams.get('from')==='chess';
 const visitedKey='sofacet-game-visited';
 const hasVisited=()=>{try{return sessionStorage.getItem(visitedKey)==='1'}catch{return false}};
 let active=false,failed=false,parentVisible=parent===window,fade,delay,observer,pageObserver,events,blocked=[];
 let run=0,tableReady=false,cardsComplete=false,progressOnly=false,progressValue=0;
 function updateProgress(value,complete=false){
  if(!active||failed||!Number.isFinite(value))return;
  progressValue=Math.max(progressValue,Math.max(0,Math.min(complete?100:99,Math.round(value))));
  progress.setAttribute('aria-valuenow',String(progressValue));
  progress.querySelector('.game-loading-fill').style.transform=`scaleX(${progressValue/100})`;
  const copy=statements[progressValue<=33?0:progressValue<=66?1:2];
  if(statement.innerHTML!==copy)statement.innerHTML=copy;
  if(parentOwnsCards)parent.postMessage({type:'sofacet:game-load-progress',value:progressValue},location.origin);
 }
 function measure(){
  const anchors=gamePage?document.querySelectorAll('.navbar-backdrop,.nav-trim,#game-header .site-brand,#nav-toggle'):document.querySelectorAll('.site-brand,[data-menu-toggle]');
  let top=0;
  for(const element of anchors){const box=element.getBoundingClientRect();if(box.width&&box.height&&getComputedStyle(element).visibility!=='hidden')top=Math.max(top,box.bottom)}
  root.style.setProperty('--game-loader-measured-top',Math.ceil(top+4)+'px');
 }
 function paint(){
  if(!run||parentOwnsCards||progressOnly)return;
  renderCards(cards,!cards.hidden&&active&&!failed&&parentVisible&&!document.hidden&&document.documentElement?.dataset.loaded!=='false',run,completeCards);
 }
 function completeCards(){
  if(!active||cardsComplete)return;
  cardsComplete=true;
  cards.hidden=true;
  paint();
  handoff();
 }
 function loadCards(){
  if(parentOwnsCards)return;
  paint();
  const session=events.signal;
  const images=[...cards.querySelectorAll('img')];
  // Safari can defer lazy images in a hidden deck, so request them before decoding.
  for(const image of images)image.loading='eager';
  Promise.all(images.map(image=>image.decode())).then(()=>{
   if(session.aborted)return;
   if(!document.getElementById('game-loader-critical')?.sheet||
      getComputedStyle(cards).getPropertyValue('--game-loader-css-ready').trim()!=='1'){
    completeCards();return;
   }
   cards.hidden=false;
   paint();
  },()=>{if(!session.aborted)completeCards();});
 }
 function cleanup(){events?.abort();observer?.disconnect();pageObserver?.disconnect();events=observer=pageObserver=null;clearTimeout(delay);}
 function show({story=chessEntry}={}){
  if(active&&!failed)return;
  clearTimeout(fade);cleanup();active=false;cards.hidden=true;paint();
  progressOnly=!parentOwnsCards&&!story&&hasVisited();
  active=true;failed=false;root.hidden=false;delete root.dataset.state;error.hidden=true;
  root.dataset.loader=progressOnly?'progress':'cards';progress.hidden=!progressOnly;
  progressValue=0;updateProgress(0);
  run++;tableReady=false;cardsComplete=parentOwnsCards||progressOnly;
  status.firstChild.textContent='Polishing your table… ';
  blocked=[...document.querySelectorAll('#stage')].map(element=>[element,element.inert]);for(const [element] of blocked)element.inert=true;
  events=new AbortController();const signal=events.signal;
  addEventListener('resize',measure,{signal});visualViewport?.addEventListener('resize',measure,{signal});document.addEventListener('visibilitychange',paint,{signal});
  observer=new ResizeObserver(measure);for(const element of document.querySelectorAll('#game-header,.navbar-backdrop,.site-brand,[data-menu-toggle]'))observer.observe(element);
  if(document.documentElement?.dataset.loaded==='false'){
   pageObserver=new MutationObserver(()=>{measure();paint()});
   pageObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-loaded']});
  }
  measure();if(!progressOnly)loadCards();
  delay=setTimeout(()=>{if(active&&!failed)status.firstChild.textContent='Still preparing your game. Please wait. '},20000);
 }
 function hide(){
  clearTimeout(fade);cleanup();active=false;root.hidden=true;delete root.dataset.state;paint();
  for(const [element,inert] of blocked)element.inert=inert;blocked=[];
  const stage=document.getElementById('stage');if(gamePage&&stage?.dataset.ready==='true'){stage.inert=false;document.body.removeAttribute('data-game-loading')}
 }
 function ready(){
  if(failed)return;
  tableReady=true;
  updateProgress(100,true);
  handoff();
 }
 function handoff(){
  if(failed||!active||!tableReady||!cardsComplete)return;
  if(!parentOwnsCards)try{sessionStorage.setItem(visitedKey,'1')}catch{}
  cleanup();active=false;
  const stage=document.getElementById('stage');if(stage){stage.inert=false;stage.dataset.ready='true';stage.setAttribute('aria-busy','false')}
  blocked=[];root.dataset.state='leaving';
  root.dispatchEvent(new CustomEvent('sofacet:game-loader-ready'));
  fade=setTimeout(()=>{root.hidden=true;document.body.removeAttribute('data-game-loading');paint();},motion.matches?0:400);
 }
 function fail(reason,phase='module'){
  if(failed)return;
  const message=String(reason?.message||reason||'Unknown startup failure');
  const code=/memory|allocation|array buffer|out of bounds/i.test(message)?'memory':/webgl|context lost|gpu/i.test(message)?'graphics':/wasm|webassembly|unreachable/i.test(message)?'wasm':/fetch|network|load|asset|http/i.test(message)?'asset':'runtime';
  console.error('[SOFACET game startup]',phase,code,reason);root.dataset.errorCode=code;root.dataset.errorPhase=phase;
  if(gamePage)try{void fetch('/api/game-load-failure',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',keepalive:true,body:JSON.stringify({phase,code,embedded:parent!==window})}).catch(()=>{})}catch{}
  if(root.hidden)show();clearTimeout(fade);failed=true;cleanup();active=false;cards.hidden=true;progress.hidden=true;paint();error.hidden=false;root.dataset.state='error';document.getElementById('stage')?.setAttribute('aria-busy','false');
 }
 const style=document.getElementById('game-entry-style');
 const stylesReady=style?.dataset.failed?Promise.reject(Error('Game styles unavailable')):!style||style.sheet?Promise.resolve():new Promise((resolve,reject)=>{style.addEventListener('load',resolve,{once:true});style.addEventListener('error',()=>reject(Error('Game styles unavailable')),{once:true})});
 stylesReady.catch(error=>fail(error,'styles'));
 window.sofacetGameLoader={show,ready,progress:updateProgress,fail,cancel:hide,stylesReady,isActive:()=>parentVisible,setActive(value){parentVisible=value;if(active)paint()}};
 root.querySelector('[data-game-retry]').onclick=()=>location.reload();
 document.addEventListener('click',event=>{
  if(root.hasAttribute('data-managed')||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||event.defaultPrevented)return;
  const link=event.target.closest?.('a[href]');if(!link||link.target==='_blank'||link.hasAttribute('download'))return;
  const url=new URL(link.href,location.href);if(url.origin!==location.origin||url.pathname!=='/game')return;
  show();setTimeout(()=>{if(event.defaultPrevented)hide()},0);
 },true);
 addEventListener('message',event=>{
  if(event.origin!==location.origin)return;
  if(event.source===parent&&event.data?.type==='sofacet:experience-visibility'&&typeof event.data.visible==='boolean')window.sofacetGameLoader.setActive(event.data.visible);
  if(event.source===document.getElementById('game-page')?.contentWindow&&event.data?.type==='sofacet:game-load-progress')updateProgress(event.data.value);
 });
 addEventListener('pagehide',()=>{cleanup();clearTimeout(fade);active=false;paint();});
 addEventListener('pageshow',event=>{
  if(!event.persisted)return;
  if(gamePage&&failed){root.hidden=false;return}
  const prepared=document.getElementById('stage')?.dataset.ready==='true';
  if(gamePage&&(!prepared||!cardsComplete)){active=false;show();if(prepared)ready()}
  else hide();
 });
 if(gamePage){
  show();
  const entry=document.getElementById('game-loader-controller').dataset.gameEntry;
  const load=()=>import(new URL(entry,location.href).href).catch(fail);
  if(entry){if(document.hidden||!parentVisible)setTimeout(load,0);else requestAnimationFrame(()=>setTimeout(load,0))}
 }
}
