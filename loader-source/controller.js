export function installGameLoader(renderCards) {
 if(window.sofacetGameLoader)return;
 const root=document.getElementById('game-loading-screen');
 if(!root)return;
 const cards=root.querySelector('#game-loader-cards-root'),status=root.querySelector('.loading-copy'),error=root.querySelector('.game-loading-error');
 const gamePage=document.body.hasAttribute('data-game-loading'),motion=matchMedia('(prefers-reduced-motion: reduce)');
 let mounted=false,active=false,failed=false,parentVisible=parent===window,fade,delay,observer,events,blocked=[];
 function measure(){
  const anchors=gamePage?document.querySelectorAll('.navbar-backdrop,.nav-trim,#game-header .site-brand,#nav-toggle'):document.querySelectorAll('.site-brand,[data-menu-toggle]');
  let top=0;
  for(const element of anchors){const box=element.getBoundingClientRect();if(box.width&&box.height&&getComputedStyle(element).visibility!=='hidden')top=Math.max(top,box.bottom)}
  root.style.setProperty('--game-loader-top',Math.ceil(top+4)+'px');
 }
 function paint(){if(!mounted&&!active)return;mounted=true;renderCards(cards,active&&!failed&&parentVisible&&!document.hidden);}
 function cleanup(){events?.abort();observer?.disconnect();events=observer=null;clearTimeout(delay);}
 function show(){
  if(active&&!failed)return;
  clearTimeout(fade);cleanup();active=true;failed=false;root.hidden=false;delete root.dataset.state;error.hidden=true;
  status.firstChild.textContent='Polishing your table… ';
  blocked=[...document.querySelectorAll('#stage')].map(element=>[element,element.inert]);for(const [element] of blocked)element.inert=true;
  events=new AbortController();const signal=events.signal;
  addEventListener('resize',measure,{signal});visualViewport?.addEventListener('resize',measure,{signal});document.addEventListener('visibilitychange',paint,{signal});
  observer=new ResizeObserver(measure);for(const element of document.querySelectorAll('#game-header,.navbar-backdrop,.site-brand,[data-menu-toggle]'))observer.observe(element);
  measure();paint();
  delay=setTimeout(()=>{if(active&&!failed)status.firstChild.textContent='Still preparing your game. Please wait. '},20000);
 }
 function hide(){
  clearTimeout(fade);cleanup();active=false;root.hidden=true;delete root.dataset.state;paint();
  for(const [element,inert] of blocked)element.inert=inert;blocked=[];
  const stage=document.getElementById('stage');if(gamePage&&stage?.dataset.ready==='true'){stage.inert=false;document.body.removeAttribute('data-game-loading')}
 }
 function ready(){
  if(failed||!active)return;
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
  if(root.hidden)show();clearTimeout(fade);failed=true;cleanup();active=false;paint();error.hidden=false;root.dataset.state='error';document.getElementById('stage')?.setAttribute('aria-busy','false');
 }
 const style=document.getElementById('game-entry-style');
 const stylesReady=style?.dataset.failed?Promise.reject(Error('Game styles unavailable')):!style||style.sheet?Promise.resolve():new Promise((resolve,reject)=>{style.addEventListener('load',resolve,{once:true});style.addEventListener('error',()=>reject(Error('Game styles unavailable')),{once:true})});
 stylesReady.catch(error=>fail(error,'styles'));
 window.sofacetGameLoader={show,ready,fail,cancel:hide,stylesReady,isActive:()=>parentVisible,setActive(value){parentVisible=value;if(active)paint()}};
 root.querySelector('[data-game-retry]').onclick=()=>location.reload();
 document.addEventListener('click',event=>{
  if(root.hasAttribute('data-managed')||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||event.defaultPrevented)return;
  const link=event.target.closest?.('a[href]');if(!link||link.target==='_blank'||link.hasAttribute('download'))return;
  const url=new URL(link.href,location.href);if(url.origin!==location.origin||url.pathname!=='/play.html')return;
  show();setTimeout(()=>{if(event.defaultPrevented)hide()},0);
 },true);
 addEventListener('message',event=>{if(event.source===parent&&event.origin===location.origin&&event.data?.type==='sofacet:experience-visibility'&&typeof event.data.visible==='boolean')window.sofacetGameLoader.setActive(event.data.visible)});
 addEventListener('pagehide',()=>{cleanup();clearTimeout(fade);active=false;paint();});
 addEventListener('pageshow',event=>{if(event.persisted){if(gamePage&&failed){root.hidden=false;return}if(gamePage&&document.getElementById('stage')?.dataset.ready!=='true'){active=false;show()}else hide()}});
 if(gamePage){
  show();
  const entry=document.getElementById('game-loader-controller').dataset.gameEntry;
  const load=()=>import(new URL(entry,location.href).href).catch(fail);
  if(entry){if(document.hidden||!parentVisible)setTimeout(load,0);else requestAnimationFrame(()=>setTimeout(load,0))}
 }
}
