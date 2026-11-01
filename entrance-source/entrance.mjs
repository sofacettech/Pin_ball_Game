import {presentationReady, modelDownload, videoEntrance, setStartupStatus, finishStartupStatus, completePreparation, cancelStartup} from './startup.mjs';
import { createLandingCopy } from '/assets/kinetic-copy.js?v=spawn-copy-1';
import { createAssemblyClock } from './assembly-clock.mjs';
import { storyFrameAt } from './story-timing.mjs';
import { createJourneyScrollMap, JOURNEY_START_FRAME } from './journey-scroll.mjs';
import { advanceJourneyFrame } from './journey-motion.mjs';
import { createFrameRatePanel } from './frame-rate-panel.js';
import { framePlacement } from '/frame-placement.js';
import { siteSound, CHESS_HIT_FRAME } from '/sounds/site-audio.js?v=state-46696ddb76e8';

const $=id=>document.getElementById(id);
const firstFrame=JOURNEY_START_FRAME,lastFrame=CHESS_HIT_FRAME;
const journeyScroll=createJourneyScrollMap(firstFrame,lastFrame),travel=journeyScroll.travel;
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const coarse=matchMedia('(any-pointer: coarse)');
const parameters=new URLSearchParams(location.search);
const performanceMode=!videoEntrance&&parameters.get('quality')!=='reference';
const showFPS=parameters.has('debug')||parameters.has('debug/1')||parameters.has('perf');
const game=$('game-page'),main=$('entrance'),stage=$('scene-frame'),viewport=$('scene-viewport');
const assembly=createAssemblyClock({reducedMotion:reduced.matches});
let journey,updateCopy,framing,ready=false,gameLoaded=false,gameRequested=false,gameVisible=false;
let phase='loading',gameLoader,gameReadyObserver;
let gameRecovering=false;
let startupFailed=false;
let frame=firstFrame,target=firstFrame,raf=0,lastTime=0,placement,renderView;
document.documentElement.style.setProperty('--travel',travel+'px');
history.scrollRestoration='manual';window.scrollTo(0,0);
const frameRate=showFPS?createFrameRatePanel({label:videoEntrance?'Rendered video':'Live 3D model',travel,firstFrame,
  compareURL:'/video?perf=1',compareLabel:'Video debug ↗',
  getState:()=>{const renderer=journey?.renderer,canvas=renderer?.domElement;return {
    ready,game:gameRequested,frame:phase==='assembly'?assembly.frame:frame,
    seeking:phase==='assembly'||Math.abs(target-frame)>.15,
    details:canvas?(videoEntrance?`${canvas.width} × ${canvas.height} · video frames`:`${canvas.width} × ${canvas.height} · ${renderer.getPixelRatio().toFixed(2)}× pixels\n${renderer.info.render.calls} draw calls`):''
  };}
}):null;

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
}
function startScene(){
  if(gameRequested||startupFailed)return;
  $('journey-preparation').hidden=true;
  finishStartupStatus();
  $('scene-loading-status').setAttribute('data-ready','');
  setTimeout(()=>{$('scene-loading-status').hidden=true},1500);
  phase=assembly.active?'assembly':'idle';document.body.dataset.phase=phase;ready=true;
  siteSound.setActive(true);syncScroll();requestTick();
}
async function prepareScene(){
  if(gameRequested||startupFailed)return;
  // Replace the old video poster while the loader is still opaque. The fade
  // must reveal the relocated 3D opening, with its animation held until ready.
  frame=firstFrame;updateCopy(assembly.active?assembly.frame:240);placeStage();journey.resize();
  if(assembly.active)journey.renderAssemblyAt(assembly.frame);else journey.renderAt(frame);
  await journey.whenSettled?.();
  $('scene-poster').remove();
}
function gameVisibility(visible){
  game.contentWindow?.postMessage({type:'sofacet:experience-visibility',visible},location.origin);
}
// This parent owns the reward story; the hidden game must not wait on a second story.
function loadGame(){if(!game.getAttribute('src'))game.src='/play.html';}
function recoverGame(){
  if(gameRecovering||gameVisible)return;
  gameRecovering=true;gameReadyObserver?.disconnect();
  // A fresh document releases both scenes and a partially initialized game.
  // The standalone loader has no route back here, so recovery cannot loop.
  location.replace('/play.html?recovery=entrance');
}
function showGame(){
  if(!gameLoaded||!gameRequested||gameVisible)return;
  gameVisible=true;
  document.body.dataset.game='visible';
  main.inert=true;main.setAttribute('aria-hidden','true');game.inert=false;game.removeAttribute('aria-hidden');
  siteSound.handoff();siteSound.save();journey?.suspend();
  gameVisibility(!document.hidden);game.focus();
}
function enterGame({fromChess=false}={}){
  if(gameRequested)return;gameRequested=true;cancelStartup();
  cancelAnimationFrame(raf);raf=0;journey?.suspend();siteSound.handoff();
  assembly.finish();
  // Keep game work after the 3D loop stops. The origin/main loader covers real
  // game readiness, including its reward-copy sequence after the chess room.
  main.inert=true;document.body.setAttribute('data-game-loading','');
  gameLoader.show({story:fromChess});
  // The opaque Canvas loader now covers the chess frame. Free its geometry,
  // reflection targets and WebGL context before allocating the pinball table.
  journey?.dispose();journey=null;
  loadGame();
  // A cold mobile download can legitimately exceed 45 seconds. The shared
  // loader already explains the wait; only an actual child failure is fatal.
  if(gameLoaded)gameLoader.ready();
}
game.addEventListener('load',()=>{
  if(!game.getAttribute('src'))return;
  gameVisibility(false);gameReadyObserver?.disconnect();
  const gameStage=game.contentDocument?.getElementById('stage');
  if(!gameStage){recoverGame();return;}
  const check=()=>{
    if(gameStage.dataset.ready==='true'){
      gameLoaded=true;gameReadyObserver?.disconnect();gameLoader.ready();
    }else if(gameStage.getAttribute('aria-busy')==='false'){
      recoverGame();
    }
  };
  gameReadyObserver=new MutationObserver(check);
  gameReadyObserver.observe(gameStage,{attributes:true,attributeFilter:['data-ready','aria-busy']});check();
});
$('scroll-hint').addEventListener('click',()=>{siteSound.unlock();window.scrollTo({top:window.scrollY+innerHeight*.8,behavior:reduced.matches?'instant':'smooth'});});

function tick(now){
  raf=0;if(gameRequested||document.hidden)return;
  if(!ready)return;
  if(phase==='assembly'){
    const pose=assembly.advance(now);updateCopy(pose);journey.renderAssemblyAt(pose);
    if(assembly.active)requestTick();
    else{phase='idle';document.body.dataset.phase=phase;syncScroll();}
    return;
  }
  const tickStart=performance.now();
  const dt=lastTime?Math.min(100,now-lastTime):16.67;lastTime=now;
  frame=advanceJourneyFrame(frame,target,dt,{coarse:coarse.matches,reducedMotion:reduced.matches});
  placeStage();updateCopy.setScrolled(target>firstFrame);updateCopy(storyFrameAt(frame));
  document.body.toggleAttribute('data-scrolled',target>firstFrame+8);
  $('progress').style.transform=`scaleX(${(frame-firstFrame)/(lastFrame-firstFrame)})`;
  siteSound.frame(frame);
  const pageTime=performance.now()-tickStart;
  journey.renderAt(frame);
  if(journey.profileFrames.length)journey.profileFrames.at(-1).page=pageTime;
  if(frame===lastFrame){if(videoEntrance&&!journey.settled){requestTick();return;}enterGame({fromChess:true});return;}
  if(frame!==target)requestTick();else lastTime=0;
}
function requestTick(){if(!raf&&!document.hidden&&!gameRequested)raf=requestAnimationFrame(tick);}
function syncScroll(){
  if(!ready)return;
  // A swipe can enter the journey immediately, without waiting for assembly.
  if(phase==='assembly'&&scrollY>0){assembly.finish();frame=firstFrame;phase='idle';document.body.dataset.phase=phase;}
  target=journeyScroll.frameAtScroll(scrollY);requestTick();
}
window.addEventListener('scroll',syncScroll,{passive:true});
const resizeObserver=new ResizeObserver(()=>{placeStage();if(ready){journey?.resize();requestTick();}});
resizeObserver.observe(viewport);
document.addEventListener('visibilitychange',()=>{
  gameVisibility(gameVisible&&!document.hidden);
  if(document.hidden){cancelAnimationFrame(raf);raf=0;lastTime=0;assembly.suspend();journey?.suspend();}
  else if(!gameRequested){journey?.suspend(false);requestTick();}
});
window.addEventListener('pagehide',event=>{assembly.suspend();if(!event.persisted){cancelAnimationFrame(raf);gameReadyObserver?.disconnect();resizeObserver.disconnect();updateCopy?.destroy();journey?.dispose();frameRate?.destroy();}});
window.addEventListener('pageshow',event=>{if(event.persisted){gameVisibility(gameVisible);if(!gameRequested){journey?.suspend(false);requestTick();}}});
// Read-only state for verifying scroll and handoff in the test entrance.
window.entrancePreview={get ready(){return ready;},get phase(){return phase;},get frame(){return frame;},get displayedFrame(){return journey?.displayedFrame??frame;},get settled(){return journey?.settled??true;},get gameVisible(){return gameVisible;},get gameLoaded(){return gameLoaded;},get renderer(){return journey?.renderer;},get profile(){return journey?.profileFrames;},get quality(){return journey?.policy;},get resolution(){return journey?.resolution;},get batching(){return journey?.batchingMode;}};

try{
  const pointsReady=fetch('/assets/ball-framing.json').then(r=>{if(!r.ok)throw Error('Camera framing unavailable');return r.json();}).then(points=>{framing=points;placeStage();});
  const copyReady=(async()=>{
    await loadMainPresentation();
    const [copy]=await Promise.all([createLandingCopy(),pointsReady]);
    updateCopy=copy;
  })();
  const scenePrepared=(async()=>{
    const renderModule=await (videoEntrance?import('./video-renderer.mjs'):import('./journey-renderer.mjs'));
    await pointsReady;
    if(gameRequested||startupFailed)return;
    journey=await renderModule.createJourneyRenderer({stage,
      profile:parameters.has('profile'),performanceMode,renderView:()=>renderView,
      pixelRatio:()=>Math.min(devicePixelRatio||1,1.5,1920/placement.width,1080/placement.height),
      onStatus:message=>{if(message)setStartupStatus(message);},
      onRender:()=>frameRate?.record(),
      onError:error=>{console.error(error);if(ready&&!gameRequested)enterGame();},
    });
    if(gameRequested||startupFailed){journey.dispose();journey=null;return;}
    await journey.loadVariant('compact',{download:modelDownload});
    if(gameRequested||startupFailed){journey?.dispose();journey=null;return;}
  })();
  // Keep the logo visible until assets, cached poses and real GPU passes are ready.
  await Promise.all([copyReady,scenePrepared]);
  await prepareScene();
  completePreparation();
  await presentationReady;
  startScene();
}catch(error){
  startupFailed=true;cancelStartup();
  journey?.dispose();journey=null;
  if(!gameRequested){
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
