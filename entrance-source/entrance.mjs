import {presentationReady, modelDownload, setStartupStatus, cancelStartup} from './startup.mjs';
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
let phase='loading',openingPlayback,gameLoader,gameReadyObserver;
let sceneReady=false,openingFinished=false,startupFailed=false;
let frame=firstFrame,target=firstFrame,raf=0,lastTime=0,placement,renderView;
document.documentElement.style.setProperty('--travel',travel+'px');
history.scrollRestoration='manual';window.scrollTo(0,0);
const performancePanel=showPerformance?createFrameRatePanel({label:'Live 3D',travel,minimumFPS:45,
  compareURL:'/video?perf#experience',compareLabel:'Video FPS ↗',
  getState:()=>{
    const renderer=journey?.renderer,canvas=renderer?.domElement;
    return {ready,game:gameRequested,frame,seeking:Math.abs(target-frame)>.15,
      details:canvas?`${canvas.width} × ${canvas.height} · ${renderer.getPixelRatio().toFixed(2)}× pixels\n${renderer.info.render.calls} draws · ${(renderer.info.render.triangles/1e6).toFixed(2)}M triangles\n${journey.policy.name} · ${journey.batchingMode} batching`:''};
  },
}):{record(){},destroy(){}};

async function loadMainPresentation(){
  // All markup and styles come from index.html at build time. Imports reuse the
  // same controllers as /video, without fetching and parsing that page again.
  await Promise.all([
    import(new URL($('game-loader-controller').getAttribute('src'),document.baseURI).href),
    import(new URL($('entrance-navigation-controller').getAttribute('src'),document.baseURI).href),
  ]);
  gameLoader=window.sofacetGameLoader;
  $('game-loading-screen').addEventListener('sofacet:game-loader-ready',showGame);
  $('skip-game').addEventListener('click',event=>{event.preventDefault();enterGame();});
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
  if(gameRequested||startupFailed)return;
  openingFinished=true;
  if(!sceneReady){phase='buffering';document.body.dataset.phase=phase;$('journey-preparation').hidden=false;return;}
  $('journey-preparation').hidden=true;
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
  gameVisible=true;
  document.body.dataset.game='visible';
  main.inert=true;main.setAttribute('aria-hidden','true');game.inert=false;game.removeAttribute('aria-hidden');
  siteSound.handoff();siteSound.save();journey?.suspend();
  gameVisibility(!document.hidden);game.focus();
  // The last journey frame stays behind the crossfade, then release its GPU context.
  setTimeout(()=>{journey?.dispose();journey=null;},350);
}
function enterGame({fromChess=false}={}){
  if(gameRequested)return;gameRequested=true;cancelStartup();
  cancelAnimationFrame(raf);raf=0;journey?.suspend();siteSound.handoff();
  openingPlayback?.destroy();opening.removeAttribute('src');opening.load();
  // Keep game work after the 3D loop stops. The origin/main loader covers real
  // game readiness, including its reward-copy sequence after the chess room.
  main.inert=true;document.body.setAttribute('data-game-loading','');
  gameLoader.show({story:fromChess});loadGame();
  // A cold mobile download can legitimately exceed 45 seconds. The shared
  // loader already explains the wait; only an actual child failure is fatal.
  if(gameLoaded)gameLoader.ready();
}
game.addEventListener('load',()=>{
  if(!game.getAttribute('src'))return;
  gameVisibility(false);gameReadyObserver?.disconnect();
  const gameStage=game.contentDocument?.getElementById('stage');
  if(!gameStage){gameLoader.fail();return;}
  const check=()=>{
    if(gameStage.dataset.ready==='true'){
      gameLoaded=true;gameReadyObserver?.disconnect();gameLoader.ready();
    }else if(gameStage.getAttribute('aria-busy')==='false'){
      gameReadyObserver?.disconnect();gameLoader.fail();
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
window.addEventListener('pagehide',event=>{if(!event.persisted){cancelAnimationFrame(raf);gameReadyObserver?.disconnect();resizeObserver.disconnect();openingPlayback?.destroy();updateCopy?.destroy();journey?.dispose();performancePanel.destroy();}});
window.addEventListener('pageshow',event=>{if(event.persisted){gameVisibility(gameVisible);if(!gameRequested){journey?.suspend(false);requestTick();}}});
// Read-only state for verifying scroll and handoff in the test entrance.
window.entrancePreview={get ready(){return ready;},get phase(){return phase;},get frame(){return frame;},get gameVisible(){return gameVisible;},get gameLoaded(){return gameLoaded;},get renderer(){return journey?.renderer;},get profile(){return journey?.profileFrames;},get quality(){return journey?.policy;},get batching(){return journey?.batchingMode;}};

try{
  const pointsReady=fetch('/assets/ball-framing.json').then(r=>{if(!r.ok)throw Error('Camera framing unavailable');return r.json();}).then(points=>{framing=points;placeStage();});
  // The opening is usable while the model downloads. Keep its final frame and
  // a live progress indicator until the scene's actual GPU preparation is done.
  const openingReady=(async()=>{
    await loadMainPresentation();
    const [copy]=await Promise.all([createLandingCopy(),prepareMedia(opening),pointsReady]);
    updateCopy=copy;
    await presentationReady;
    if(gameRequested||startupFailed)return;
    phase='opening';document.body.dataset.phase=phase;updateCopy(0);placeStage();
    openingPlayback=connectOpeningVideo(opening,$('enter'),finishOpening,requestTick);
    siteSound.setActive(true);openingPlayback.start(reduced.matches);
  })();
  const scenePrepared=(async()=>{
    const renderModule=await import('./journey-renderer.mjs');
    await pointsReady;
    if(gameRequested||startupFailed)return;
    journey=await renderModule.createJourneyRenderer({stage,
      profile:parameters.has('profile'),performanceMode,renderView:()=>performanceMode?renderView:null,
      pixelRatio:()=>Math.min(devicePixelRatio||1,1.5,1920/placement.width,1080/placement.height),
      onStatus:message=>{if(message)setStartupStatus(message);},
      onRender:()=>{if(ready)performancePanel.record();},
    });
    if(gameRequested||startupFailed){journey.dispose();journey=null;return;}
    await journey.loadVariant('compact',{download:modelDownload});
    if(gameRequested||startupFailed){journey?.dispose();journey=null;return;}
    sceneReady=true;
    $('scene-loading-status').hidden=true;
    if(openingFinished)finishOpening();
  })();
  await Promise.all([openingReady,scenePrepared]);
}catch(error){
  startupFailed=true;cancelStartup();
  journey?.dispose();journey=null;
  if(!gameRequested){
    openingPlayback?.destroy();
    document.body.dataset.error='';console.error(error);
    await presentationReady;
    // The entrance is optional. Recover through the normal game loader instead
    // of stopping visitors on a separate error screen that needs another tap.
    if(!gameRequested){
      if(gameLoader)enterGame();
      else location.replace('/play.html');
    }
  }
}
