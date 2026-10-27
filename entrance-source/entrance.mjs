import { createLandingCopy } from '/assets/kinetic-copy.js';
import { prepareMedia } from '/assets/media-delivery.js?v=frames-dc4a9c95ed77';
import { connectOpeningVideo } from '/assets/video-playback.js?v=entrance-opening-1';
import { framePlacement } from '/frame-placement.js';
import { siteSound, CHESS_HIT_FRAME } from '/sounds/site-audio.js';
import { createFrameRatePanel } from './frame-rate-panel.js';

const $=id=>document.getElementById(id);
const firstFrame=240,lastFrame=CHESS_HIT_FRAME,travel=(lastFrame-firstFrame)*8;
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const coarse=matchMedia('(any-pointer: coarse)');
const parameters=new URLSearchParams(location.search);
const performanceMode=parameters.get('quality')!=='reference';
const showPerformance=parameters.has('perf')||location.pathname.startsWith('/entrance-3d');
const game=$('game-page'),main=$('entrance'),stage=$('scene-frame'),viewport=$('scene-viewport');
const opening=$('opening'),openingStage=$('opening-frame');
let journey,updateCopy,framing,ready=false,gameLoaded=false,gameRequested=false,gameVisible=false;
let phase='loading',openingPlayback,finishLoading,gameLoader,gameReadyObserver;
let frame=firstFrame,target=firstFrame,raf=0,lastTime=0,placement,renderView,gameTimeout;
document.documentElement.style.setProperty('--travel',travel+'px');
history.scrollRestoration='manual';window.scrollTo(0,0);
const performancePanel=showPerformance?createFrameRatePanel({label:'Live 3D',travel,minimumFPS:45,
  compareURL:'/video?perf#experience',compareLabel:'Video FPS ↗',
  getState:()=>{
    const renderer=journey?.renderer,canvas=renderer?.domElement;
    return {ready,game:gameRequested,frame,seeking:Math.abs(target-frame)>.15,
      details:canvas?`${canvas.width} × ${canvas.height} · ${renderer.getPixelRatio().toFixed(2)}× pixels\n${renderer.info.render.calls} draws · ${(renderer.info.render.triangles/1e6).toFixed(2)}M triangles`:''};
  },
}):{record(){},destroy(){}};

async function loadMainPresentation(){
  const response=await fetch('/video',{cache:'no-cache'});
  if(!response.ok)throw Error('Main page presentation unavailable');
  const source=new DOMParser().parseFromString(await response.text(),'text/html');
  const sourceBase=new URL('/',location.href);
  const loader=source.querySelector('#site-loader'),copy=source.querySelector('#story-copy');
  const intro=source.querySelector('script[src*="assets/loading/intro.js"]');
  const gameScreen=source.querySelector('#game-loading-screen'),gameStyle=source.querySelector('#game-loader-critical'),enter=source.querySelector('#enter');
  const controller=source.querySelector('#game-loader-controller');
  const navigation=source.querySelector('header.site-navigation'),brand=source.querySelector('.site-brand');
  const navigationModule=source.querySelector('script[src*="navigation.js"]');
  if(!loader||!copy||!intro||!gameScreen||!gameStyle||!enter||!controller||!navigation||!brand||!navigationModule)throw Error('Main page presentation is incomplete');
  // Reuse the deployed video entrance's copy, fonts and loading presentation.
  for(const fragment of [loader,copy,enter,navigation,brand]){
    for(const element of [fragment,...fragment.querySelectorAll('[src],[href]')])for(const attribute of ['src','href'])if(element.hasAttribute(attribute))element.setAttribute(attribute,new URL(element.getAttribute(attribute),sourceBase).href);
  }
  navigation.querySelector('.play-now').id='skip-game';
  const sharedNavigation=document.importNode(navigation,true);
  // Move the live sound control with its gesture listeners into the shared nav.
  const sound=$('site-sound');if(sound)sharedNavigation.prepend(sound);
  document.querySelector('header.site-navigation').replaceWith(sharedNavigation);
  document.querySelector('.site-brand').replaceWith(document.importNode(brand,true));
  $('skip-game').addEventListener('click',event=>{event.preventDefault();enterGame();});
  document.body.prepend(document.importNode(loader,true));
  $('story-copy').replaceWith(document.importNode(copy,true));
  $('enter').replaceWith(document.importNode(enter,true));
  document.head.append(document.importNode(gameStyle,true));
  const gameOverlay=document.importNode(gameScreen,true);gameOverlay.setAttribute('data-managed','');
  document.body.append(gameOverlay);gameOverlay.addEventListener('sofacet:game-loader-ready',showGame);
  if(location.hash==='#experience')document.documentElement.setAttribute('data-skip-intro','');
  const styles=[...source.querySelectorAll('link[rel="stylesheet"]')].map(link=>new Promise((resolve,reject)=>{
    const href=new URL(link.getAttribute('href'),sourceBase).href;
    if([...document.styleSheets].some(sheet=>sheet.href===href)){resolve();return;}
    const shared=document.createElement('link');shared.rel='stylesheet';shared.href=href;
    shared.onload=resolve;shared.onerror=()=>reject(Error('Main page styles unavailable'));
    document.head.insertBefore(shared,document.querySelector('link[data-entrance-style]'));
  }));
  const introModule=import(new URL(intro.getAttribute('src'),sourceBase).href);
  const [module]=await Promise.all([introModule,import(new URL(controller.getAttribute('src'),sourceBase).href),import(new URL(navigationModule.getAttribute('src'),sourceBase).href),...styles]);
  finishLoading=module.finishLoading;
  gameLoader=window.sofacetGameLoader;
}
function placementAt(at,rect){
  const index=Math.floor(at),next=Math.min(index+1,framing.points.length-1);
  const focus=framing.points[index].map((v,i)=>v+(framing.points[next][i]-v)*(at-index));
  return framePlacement(rect.width,rect.height,focus,true);
}
function placeStage(){
  if(!framing)return;
  const rect=viewport.getBoundingClientRect();
  placement=placementAt(frame,rect);
  renderView={fullWidth:placement.width,fullHeight:placement.height,x:-placement.x,y:-placement.y,width:rect.width,height:rect.height};
  stage.style.width=(performanceMode?rect.width:placement.width)+'px';stage.style.height=(performanceMode?rect.height:placement.height)+'px';
  stage.style.transform=performanceMode?'none':`translate3d(${placement.x}px,${placement.y}px,0)`;
  if(phase==='loading'||phase==='opening'){
    const introPlacement=placementAt(Math.min(firstFrame,opening.currentTime*60),rect);
    openingStage.style.width=introPlacement.width+'px';openingStage.style.height=introPlacement.height+'px';
    openingStage.style.transform=`translate3d(${introPlacement.x}px,${introPlacement.y}px,0)`;
  }
}
function finishOpening(){
  if(gameRequested)return;
  openingPlayback?.destroy();opening.removeAttribute('src');opening.load();openingStage.remove();
  phase='idle';document.body.dataset.phase=phase;ready=true;
  updateCopy(firstFrame);placeStage();journey.resize();syncScroll();
}
function gameVisibility(visible){
  game.contentWindow?.postMessage({type:'sofacet:experience-visibility',visible},location.origin);
}
// This parent owns the reward story; the hidden game must not wait on a second story.
function loadGame(){if(!game.getAttribute('src'))game.src='/play.html';}
function showGame(){
  if(!gameLoaded||!gameRequested||gameVisible)return;
  clearTimeout(gameTimeout);gameVisible=true;
  document.body.dataset.game='visible';
  main.inert=true;main.setAttribute('aria-hidden','true');game.inert=false;game.removeAttribute('aria-hidden');
  siteSound.handoff();siteSound.save();journey?.suspend();
  gameVisibility(!document.hidden);game.focus();
  // The last journey frame stays behind the crossfade, then release its GPU context.
  setTimeout(()=>{journey?.dispose();journey=null;},350);
}
function enterGame({fromChess=false}={}){
  if(gameRequested)return;gameRequested=true;
  cancelAnimationFrame(raf);raf=0;journey?.suspend();siteSound.handoff();
  openingPlayback?.destroy();opening.removeAttribute('src');opening.load();
  // Keep game work after the 3D loop stops. The origin/main loader covers real
  // game readiness, including its reward-copy sequence after the chess room.
  main.inert=true;document.body.setAttribute('data-game-loading','');
  gameLoader.show({story:fromChess});loadGame();
  gameTimeout=setTimeout(()=>{
    if(!gameLoaded)gameLoader.fail();
  },45000);
  if(gameLoaded)gameLoader.ready();
}
game.addEventListener('load',()=>{
  if(!game.getAttribute('src'))return;
  gameVisibility(false);gameReadyObserver?.disconnect();
  const gameStage=game.contentDocument?.getElementById('stage');
  if(!gameStage){gameLoader.fail();return;}
  const check=()=>{
    if(gameStage.dataset.ready==='true'){
      gameLoaded=true;clearTimeout(gameTimeout);gameReadyObserver?.disconnect();gameLoader.ready();
    }else if(gameStage.getAttribute('aria-busy')==='false'){
      clearTimeout(gameTimeout);gameReadyObserver?.disconnect();gameLoader.fail();
    }
  };
  gameReadyObserver=new MutationObserver(check);
  gameReadyObserver.observe(gameStage,{attributes:true,attributeFilter:['data-ready','aria-busy']});check();
});
$('scroll-hint').addEventListener('click',()=>{siteSound.unlock();window.scrollTo({top:window.scrollY+innerHeight*.8,behavior:reduced.matches?'instant':'smooth'});});

function tick(now){
  raf=0;if(gameRequested||document.hidden)return;
  if(phase==='opening'){
    placeStage();updateCopy(Math.min(firstFrame,opening.currentTime*60));
    if(!opening.paused&&!opening.ended)requestTick();return;
  }
  if(!ready)return;
  const tickStart=performance.now();
  const dt=lastTime?Math.min(100,now-lastTime):16.67;lastTime=now;
  const amount=coarse.matches||reduced.matches?1:1-Math.exp(-dt/75);
  frame+= (target-frame)*amount;if(Math.abs(target-frame)<.15)frame=target;
  placeStage();updateCopy.setScrolled(target>firstFrame);updateCopy(frame);
  document.body.toggleAttribute('data-scrolled',target>firstFrame+8);
  $('progress').style.transform=`scaleX(${(frame-firstFrame)/(lastFrame-firstFrame)})`;
  siteSound.frame(frame);
  const pageTime=performance.now()-tickStart;
  journey.renderAt(frame);
  if(journey.profileFrames.length)journey.profileFrames.at(-1).page=pageTime;
  if(frame===lastFrame){enterGame({fromChess:true});return;}
  if(frame!==target)requestTick();else lastTime=0;
}
function requestTick(){if(!raf&&!document.hidden&&!gameRequested)raf=requestAnimationFrame(tick);}
function syncScroll(){if(!ready)return;target=firstFrame+(lastFrame-firstFrame)*Math.max(0,Math.min(1,scrollY/travel));requestTick();}
window.addEventListener('scroll',syncScroll,{passive:true});
const resizeObserver=new ResizeObserver(()=>{placeStage();if(ready){journey?.resize();requestTick();}});
resizeObserver.observe(viewport);
document.addEventListener('visibilitychange',()=>{
  gameVisibility(gameVisible&&!document.hidden);
  if(document.hidden){cancelAnimationFrame(raf);raf=0;lastTime=0;journey?.suspend();}
  else if(!gameRequested){journey?.suspend(false);requestTick();}
});
window.addEventListener('pagehide',event=>{if(!event.persisted){cancelAnimationFrame(raf);clearTimeout(gameTimeout);gameReadyObserver?.disconnect();resizeObserver.disconnect();openingPlayback?.destroy();updateCopy?.destroy();journey?.dispose();performancePanel.destroy();}});
window.addEventListener('pageshow',event=>{if(event.persisted){gameVisibility(gameVisible);if(!gameRequested){journey?.suspend(false);requestTick();}}});
// Read-only state for verifying scroll and handoff in the test entrance.
window.entrancePreview={get ready(){return ready;},get phase(){return phase;},get frame(){return frame;},get gameVisible(){return gameVisible;},get gameLoaded(){return gameLoaded;},get renderer(){return journey?.renderer;},get profile(){return journey?.profileFrames;}};

try{
  await loadMainPresentation();
  const [renderModule,points,copy]=await Promise.all([
    import('./journey-renderer.mjs'),
    fetch('/assets/ball-framing.json').then(r=>{if(!r.ok)throw Error('Camera framing unavailable');return r.json();}),
    createLandingCopy(),
    prepareMedia(opening),
  ]);
  framing=points;updateCopy=copy;placeStage();
  journey=await renderModule.createJourneyRenderer({stage,
    profile:new URLSearchParams(location.search).has('profile'),
    performanceMode,renderView:()=>performanceMode?renderView:null,
    pixelRatio:()=>Math.min(devicePixelRatio||1,1.5,1920/placement.width,1080/placement.height),
    onStatus:message=>{if(message)$('world-status').textContent=message;},
    onRender:()=>{if(ready)performancePanel.record();},
  });
  openingPlayback=connectOpeningVideo(opening,$('enter'),finishOpening,requestTick);
  await journey.loadVariant('compact');
  await finishLoading();
  siteSound.setActive(!gameRequested);
  if(gameRequested){journey?.dispose();journey=null;}
  else{phase='opening';updateCopy(0);placeStage();openingPlayback.start(reduced.matches);}
}catch(error){
  await finishLoading?.();document.body.dataset.error='';
  console.error(error);$('world-status').textContent='The 3D world could not load.';$('loading-fallback').hidden=false;
  journey?.dispose();journey=null;
}
