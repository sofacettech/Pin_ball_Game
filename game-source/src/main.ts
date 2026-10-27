import './style.css';
import {TableView} from './renderer';
import {PinballPhysics,DT} from './physics';
import type {Obstacle} from './physics';
import type {XYZ} from './types';
import {connectLeaderboard} from './leaderboard';
import {connectTouchControls,selectPaddle} from './touch-controls';
import type {PaddleSide} from './touch-controls';
import {completeViewOnly,phoneDevice} from './device-view';
import {connectFlipScorecard} from './flip-scorecard';
import {createGameSound} from './game-sound';
import {connectMembership} from './membership';
import {connectPostGameRewards} from './post-game-rewards';
import {formatPoints} from './player-copy';
import {connectControlsTutorial} from './controls-tutorial';

const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const stage=$('stage'),viewport=$('viewport'),canvas=$<HTMLCanvasElement>('game');
const mobileLives=$('mobile-lives'),lifeHearts=mobileLives.querySelectorAll<HTMLImageElement>('img');
const scorecardPanel=$('scorecard-panel'),scorecard=connectFlipScorecard($<HTMLButtonElement>('flip-card'),$('card-score'),$('card-best'));
scorecard.update(0,null);
const view=new TableView(canvas,viewport);let inspecting=false,loaded=false,physics:PinballPhysics;
let tutorial:ReturnType<typeof connectControlsTutorial>|undefined;
let physicsAssets:{vertices:Float32Array;indices:Uint32Array;obstacles:Obstacle[]},starting=false,highScore:number|null=null;
const keys=new Set<string>(),sound=createGameSound();void sound.load();let accumulator=0,lastFrame=0,holdCharge=false;
let animationFrame=0,parentVisible=window.sofacetGameLoader?.isActive()??window.parent===window;
function syncLoadingAnimation(){window.sofacetGameLoader?.setActive(parentVisible&&!document.hidden)}
syncLoadingAnimation();
function requestGameFrame(){if(!animationFrame&&parentVisible&&!document.hidden)animationFrame=requestAnimationFrame(frame)}
window.addEventListener('message',event=>{
 if(window.parent===window||event.source!==window.parent||event.origin!==location.origin||event.data?.type!=='sofacet:experience-visibility'||typeof event.data.visible!=='boolean')return;
 parentVisible=event.data.visible;cancelAnimationFrame(animationFrame);animationFrame=0;lastFrame=0;accumulator=0;
 syncLoadingAnimation();
 if(parentVisible){view.needsRender=true;requestGameFrame()}
});
const menu=$('game-menu'),settings=$<HTMLButtonElement>('settings'),navToggle=$<HTMLButtonElement>('nav-toggle');
const howToPlay=$('how-to-play-toggle'),controlsGuide=$('how-to-play-controls');
function closeSettings(){menu.hidden=true;settings.setAttribute('aria-expanded','false');howToPlay.setAttribute('aria-expanded','false');howToPlay.parentElement!.classList.remove('is-open');controlsGuide.inert=true}
function closeNavigation(){if(navToggle.getAttribute('aria-expanded')==='true')navToggle.click()}
new MutationObserver(()=>{if(navToggle.getAttribute('aria-expanded')!=='true'&&!menu.hidden){closeSettings();setGamePaused(false)}}).observe(navToggle,{attributes:true,attributeFilter:['aria-expanded']});
howToPlay.onclick=()=>{const expanded=howToPlay.getAttribute('aria-expanded')!=='true';howToPlay.setAttribute('aria-expanded',String(expanded));howToPlay.parentElement!.classList.toggle('is-open',expanded);controlsGuide.inert=!expanded};
const registration=$<HTMLDialogElement>('registration-dialog');
let resumeAfterMembership=false,resumeAfterLeaderboard=false;
let membership:ReturnType<typeof connectMembership>|undefined;
const rewards=connectPostGameRewards(result=>membership?.open($('rewards-register'),result),()=>$('start').click());
const leaderboard=connectLeaderboard(()=>{const resume=resumeAfterLeaderboard&&loaded&&physics.active&&physics.state!=='finished';resumeAfterLeaderboard=false;if(resume)setGamePaused(false);else $('start').focus()},()=>$('start').click(),(score,best)=>{if(loaded&&physics.state==='finished'){physics.score=score;highScore=best;sync()}},best=>{highScore=best;scorecard.update(loaded?physics.score:0,best);if(loaded)sync()},player=>membership?.updatePlayer(player),()=>membership?.open());
membership=connectMembership({
 beforeOpen(){resumeAfterMembership=loaded&&physics.active&&!physics.paused&&physics.state!=='finished';clearKeys();if(resumeAfterMembership){holdCharge=physics.state==='charging';physics.setPaused(true);accumulator=0}rewards.dialog.close();closeSettings()},
 afterClose(completed){const resume=resumeAfterMembership&&loaded;if(resume){physics.setPaused(false);accumulator=0}resumeAfterMembership=false;if(loaded)sync();if(!completed&&loaded&&physics.state==='finished')showResult();if(resume)canvas.focus()},
 refreshPlayer:()=>leaderboard.memberChanged(),
 onReplay:()=>$('start').click(),
 onLeaderboard:showLeaderboard,
 onDiscard:()=>rewards.discard(),
 pendingResult:()=>rewards.result,
});
function showLeaderboard(){
 if(membership?.isMember()!==true){void membership?.open();return}
 clearKeys();closeNavigation();closeSettings();rewards.dialog.close();
 if(!leaderboard.dialog.open){resumeAfterLeaderboard=loaded&&physics.active&&!physics.paused&&physics.state!=='finished';if(resumeAfterLeaderboard)setGamePaused(true);leaderboard.show()}
}
function showResult(){
 void leaderboard.ready.then(()=>{if(!loaded||starting||physics.state!=='finished'||registration.open||leaderboard.dialog.open)return;if(membership?.isMember()===false)rewards.show(physics.score,leaderboard.gameId);else showLeaderboard()});
}
const launchButton=$<HTMLButtonElement>('touch-launch');
const releasedPaddles={left:false,right:false},previousTouch={left:false,right:false},paddleSoundHeld={left:false,right:false};
let caveEjecting=false,activePaddle:PaddleSide|null=null;
const playPaddleSound=(side:'left'|'right')=>{void sound.unlock().then(()=>sound.play('flap',side==='left'?-.4:.4))};
const keyboardPaddle=(side:'left'|'right')=>side==='left'?keys.has('KeyA')||keys.has('ArrowLeft'):keys.has('KeyD')||keys.has('ArrowRight');
const touchInput=matchMedia('(any-pointer: coarse)');
const primaryTouch=matchMedia('(pointer: coarse)');let phone=false;
const mobileView=()=>completeViewOnly(navigator.userAgent,navigator.maxTouchPoints,primaryTouch.matches)||matchMedia('(max-width:1024px)').matches;
function applyScoreboardLayout(){
 const mobile=mobileView();scorecard.setPhoneStage(mobile);scorecard.setPregame(!loaded||!physics.active);
 if(mobile)scorecard.showScore(!loaded||!physics.active||physics.state==='playing'||physics.state==='finished');
 const playOnly=scorecard.hidden,visible=!inspecting;
 const changed=scorecardPanel.hidden===visible||scorecardPanel.classList.contains('play-only')!==playOnly;
 const label=playOnly?'Play pinball':mobile?'Scoreboard':'How to play and scoreboard';
 if(!changed&&scorecardPanel.getAttribute('aria-label')===label)return;
 scorecardPanel.classList.toggle('play-only',playOnly);$('flip-hint').hidden=playOnly;
 scorecardPanel.setAttribute('aria-label',label);
 scorecardPanel.hidden=!visible;stage.classList.toggle('has-scorecard',visible);
 if(changed)view.resize();
}
function applyNavigationLayout(){const compact=phone||loaded&&physics.active&&physics.state!=='finished'&&!inspecting;document.body.classList.toggle('compact-navigation',compact);view.setPhonePlay(phone&&loaded&&physics.active&&physics.state!=='finished'&&!inspecting&&!tutorial?.active)}
function applyDeviceView(){const mobile=mobileView();phone=phoneDevice(navigator.userAgent,navigator.maxTouchPoints,primaryTouch.matches,Math.min(screen.width,screen.height))||matchMedia('(max-width: 740px) and (orientation: portrait)').matches;document.body.classList.toggle('handheld',mobile);document.body.classList.toggle('phone-layout',phone);view.setHandheld(mobile);applyScoreboardLayout();applyNavigationLayout()}
applyDeviceView();primaryTouch.addEventListener('change',applyDeviceView);
const canTouch=(control:'paddle'|'launch')=>loaded&&!starting&&!tutorial?.active&&!inspecting&&!physics.paused&&physics.state!=='finished'&&menu.hidden&&!registration.open&&!rewards.dialog.open&&!leaderboard.dialog.open&&(control==='paddle'||physics.active&&(physics.state==='launcher'||physics.state==='charging'));
function paddleInput(state=touch.state){activePaddle=selectPaddle(keyboardPaddle('left')||state.left,keyboardPaddle('right')||state.right,activePaddle);return{left:activePaddle==='left',right:activePaddle==='right'}}
function updatePaddleSound(state=touch.state){const selected=paddleInput(state);for(const side of ['left','right'] as const){const held=canTouch('paddle')&&selected[side];if(held&&!paddleSoundHeld[side])playPaddleSound(side);paddleSoundHeld[side]=held}}
const touch=connectTouchControls(canvas,launchButton,canTouch,()=>{holdCharge=false},state=>{for(const side of ['left','right'] as const){if(previousTouch[side]&&!state[side]&&!keyboardPaddle(side))releasedPaddles[side]=true;previousTouch[side]=state[side]}updatePaddleSound(state)});
const input=()=>{const selected=paddleInput();const controls={left:!releasedPaddles.left&&selected.left,right:!releasedPaddles.right&&selected.right,space:keys.has('Space')||touch.state.space,holdCharge};releasedPaddles.left=releasedPaddles.right=false;return controls};
const clearKeys=()=>{keys.clear();touch.clear();activePaddle=null;releasedPaddles.left=releasedPaddles.right=true;paddleSoundHeld.left=paddleSoundHeld.right=false};
tutorial=connectControlsTutorial(view,viewport,scorecardPanel,playPaddleSound);
function openPractice(mode:'onboarding'|'replay'){
 if(!loaded||starting||tutorial!.active)return;
 if(inspecting)toggleInspection();
 const resume=mode==='replay'&&physics.active&&physics.state!=='finished';
 const wasPaused=physics.paused;
 closeSettings();closeNavigation();clearKeys();holdCharge=physics.state==='charging';
 physics.setPaused(true);accumulator=0;lastFrame=0;sound.setMusic(false);
 // Show both controls even when the current ball is on the close-up rail camera.
 view.follow(physics.pose().position,0,'playing','floor');
 tutorial!.open(mode,result=>{
  clearKeys();accumulator=0;lastFrame=0;view.needsRender=true;
  if(mode==='onboarding'&&result!=='cancel'){void beginGame();return}
  physics.setPaused(resume?false:wasPaused);sync();canvas.focus();requestGameFrame();
 });
 sync();requestGameFrame();
}
$('practice-replay').onclick=()=>openPractice('replay');
const applyInspectionLayout=()=>{if(!inspecting){viewport.style.width='';viewport.style.height=''}else{
 const ref=view.references[view.referenceIndex];const ratio=ref.resolution[0]/ref.resolution[1];const w=Math.min(stage.clientWidth,stage.clientHeight*ratio);viewport.style.width=w+'px';viewport.style.height=w/ratio+'px'}view.resize()};
let completedRunRecorded=false;
function sync(){
 const p=physics.pose();
 mobileLives.hidden=!physics.active||inspecting||p.state==='finished';
 if(mobileLives.dataset.lives!==String(p.lives)){
  mobileLives.dataset.lives=String(p.lives);mobileLives.setAttribute('aria-label',p.lives+' '+(p.lives===1?'life':'lives')+' remaining');
  lifeHearts.forEach((heart,index)=>{heart.hidden=index>=p.lives});
 }
 applyNavigationLayout();stage.classList.toggle('showing-play',!physics.active||p.state==='finished');
 sound.setMusic(physics.active&&!p.paused&&p.state!=='finished'&&!registration.open&&!leaderboard.dialog.open);
 $('resume').textContent=physics.active&&p.state!=='finished'?'Resume game':'Back to game';
 $('menu-description').textContent=physics.active&&p.state!=='finished'?'Game paused. Your progress is saved here.':'Game settings.';
 if(p.state==='finished'&&!completedRunRecorded){completedRunRecorded=true;
  clearKeys();holdCharge=false;showResult();
  void leaderboard.finish().catch(error=>console.warn('Completed game remains pending verification.',error));
 }
 if(view.scoreboard.update(p.score,highScore??0,p.lives))view.needsRender=true;
 scorecard.update(p.score,highScore);applyScoreboardLayout();
 $('charge-fill').style.transform='scaleX('+p.charge+')';document.querySelector('.charge')!.setAttribute('aria-valuenow',String(Math.round(p.charge*100)));
 $('pause').textContent=p.paused?'Resume':'Pause';$<HTMLButtonElement>('pause').disabled=!physics.active||p.state==='finished'||inspecting;
 const launchReady=canTouch('launch'),mobile=mobileView(),showHold=mobile&&physics.active&&p.state!=='finished';
 if(!launchReady&&p.state==='playing'&&document.activeElement===launchButton)canvas.focus({preventScroll:true});
 launchButton.hidden=!(showHold||launchReady);launchButton.disabled=!launchReady;launchButton.inert=!launchReady;
 launchButton.setAttribute('aria-hidden',String(!launchReady));
 const scoreVisible=String(!mobile||p.state==='playing'||!physics.active||p.state==='finished');
 if(scorecardPanel.dataset.scoreVisible!==scoreVisible)scorecardPanel.dataset.scoreVisible=scoreVisible;
 stage.classList.toggle('launch-ready',launchReady);
 $<HTMLButtonElement>('restart').disabled=starting||inspecting||!physics.active||p.state==='finished';
 $('start').hidden=physics.active&&p.state!=='finished';$<HTMLButtonElement>('start').disabled=starting;$('start-label').textContent=starting?'Preparing…':physics.active?'Play again':'Play';
 $('action').hidden=!menu.hidden||mobile&&physics.active&&p.state!=='finished'||physics.active&&(p.state==='playing'||p.state==='draining'||p.state==='spring_return')&&!p.paused;
 $('message').textContent=starting?'Preparing your game…':!physics.active?'Your table, ready to play.':p.state==='finished'?`Three balls down. Final score: ${formatPoints(p.score)}.`:p.paused?'Game paused.':p.state==='resetting'?'Returning to the launcher…':p.state==='draining'?'':p.state==='spring_return'?'Settling at the spring…':touchInput.matches?p.state==='charging'&&!holdCharge?'Release the launch button to launch.':'Hold the launch button to charge.':p.state==='charging'?holdCharge?'Hold the launch button or Space to continue charging.':'Release the launch button or Space to launch.':'Hold the launch button or Space to charge.';
}
function toggleInspection(){if(!loaded)return;inspecting=!inspecting;clearKeys();if(physics.active&&physics.state!=='finished')physics.setPaused(true);
 document.body.classList.toggle('inspect-mode',inspecting);$('inspection').hidden=!inspecting;view.setInspect(inspecting);applyScoreboardLayout();applyInspectionLayout();updateOverlay();sync();if(!inspecting&&physics.state==='finished')showResult()}
$<HTMLSelectElement>('view').onchange=e=>{view.setReference(Number((e.target as HTMLSelectElement).value));applyInspectionLayout();updateOverlay()};
function updateOverlay(){const opacity=Number($<HTMLInputElement>('overlay').value)/100;const image=$<HTMLImageElement>('reference');image.src='/references/'+view.references[view.referenceIndex].file;image.hidden=!inspecting||!opacity;image.style.opacity=String(opacity);document.querySelector<HTMLElement>('.compare-label')!.hidden=!inspecting||!opacity}
$<HTMLInputElement>('overlay').oninput=updateOverlay;
function setGamePaused(value:boolean){if(!loaded||inspecting||tutorial?.active)return;clearKeys();accumulator=0;if(value)holdCharge=physics.state==='charging';else closeSettings();physics.setPaused(value);sync();if(!value)(rewards.dialog.open?navToggle:canvas).focus()}
function togglePause(){if(!loaded||inspecting||!physics.active||physics.state==='finished')return;setGamePaused(!physics.paused)}
$('pause').onclick=togglePause;
settings.onclick=()=>{if(!menu.hidden){resumeGame();return}if(inspecting)toggleInspection();menu.hidden=false;settings.setAttribute('aria-expanded','true');setGamePaused(true);$('menu-title').focus({preventScroll:true});menu.scrollIntoView({block:'nearest'})};
function resumeGame(){closeSettings();closeNavigation();setGamePaused(false)}
window.addEventListener('sofacet:back-to-game',resumeGame);
$('resume').onclick=resumeGame;
$('menu-close').onclick=resumeGame;
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!menu.hidden){event.preventDefault();event.stopPropagation();resumeGame()}});
function updateSoundSettings(){$('volume-value').textContent=Math.round(sound.volume)+'%';$('sound-label').textContent=sound.muted?'Unmute':'Mute';$('sound').setAttribute('aria-pressed',String(sound.muted));$('sound').setAttribute('aria-label',sound.muted?'Unmute game sound':'Mute game sound')}
$('sound').onclick=()=>{sound.setMuted(!sound.muted);updateSoundSettings()};
$<HTMLInputElement>('volume').oninput=event=>{sound.setVolume(Number((event.target as HTMLInputElement).value));sound.unlock();updateSoundSettings()};
async function beginGame(){if(!loaded||starting)return;sound.unlock();sound.setMusic(false);starting=true;if(inspecting)toggleInspection();clearKeys();holdCharge=false;physics.setPaused(true);sync();
 try{const seed=await leaderboard.start(),fresh=await PinballPhysics.create(view.manifest,physicsAssets.vertices,physicsAssets.indices,physicsAssets.obstacles);const old=physics;physics=fresh;old.dispose();bindFeedback();completedRunRecorded=false;physics.start(seed);rewards.clear();if(!phone)scorecard.showScore(true);view.resetFeedback();accumulator=0;lastFrame=0;view.setReference(0);view.resize();canvas.focus();sound.play('start');sound.setMusic(true,1.5)}
 catch(error){loaded=false;$('error').hidden=false;$('error-detail').textContent=error instanceof Error?error.message:String(error);$('action').hidden=true}
 finally{starting=false;if(loaded)sync()}
}
$('start').onclick=()=>{if(!loaded||starting||tutorial?.active)return;if(!tutorial!.seen)openPractice('onboarding');else void beginGame()};
$('restart').onclick=()=>{if(loaded&&!starting&&physics.active&&physics.state!=='finished')$('start').click()};
const playKeys=new Set(['ArrowLeft','ArrowRight','KeyA','KeyD','Space']);
addEventListener('keydown',event=>{
 if(starting||tutorial?.active||registration.open||rewards.dialog.open||leaderboard.dialog.open)return;
 if(event.code==='Escape'){if(loaded&&!inspecting){event.preventDefault();if(!event.repeat)togglePause()}return}
 if(!menu.hidden&&playKeys.has(event.code)){if(!(event.target as HTMLElement).matches('button,select,input,textarea,a'))event.preventDefault();return}
 const target=event.target as HTMLElement;if(target.matches('input,select,textarea,button,a')&&target!==canvas)return;
 if(!loaded||inspecting)return;
 if(event.code==='KeyP'){event.preventDefault();if(!event.repeat)togglePause();return}
 if(playKeys.has(event.code)&&(physics.active||event.code!=='Space')){event.preventDefault();if(physics.paused||event.code!=='Space'&&event.repeat)return;if(event.code==='Space')holdCharge=false;keys.add(event.code);updatePaddleSound()}
});
addEventListener('keyup',event=>{const wasHeld=keys.delete(event.code);if(wasHeld){const side=event.code==='KeyA'||event.code==='ArrowLeft'?'left':event.code==='KeyD'||event.code==='ArrowRight'?'right':null;if(side&&!keyboardPaddle(side)&&!touch.state[side])releasedPaddles[side]=true;updatePaddleSound()}if(playKeys.has(event.code)&&event.target===canvas)event.preventDefault()});
function pauseOnFocusLoss(){clearKeys();tutorial?.cancelHold();if(loaded&&physics.active&&physics.state!=='finished')setGamePaused(true)}
addEventListener('blur',pauseOnFocusLoss);document.addEventListener('visibilitychange',()=>{syncLoadingAnimation();if(document.hidden){pauseOnFocusLoss();cancelAnimationFrame(animationFrame);animationFrame=0;lastFrame=0}else requestGameFrame()});
window.addEventListener('resize',()=>{clearKeys();tutorial?.cancelHold();applyDeviceView();applyInspectionLayout()});
function bindFeedback(){caveEjecting=false;physics.onHit=(id,delta)=>{view.hit(id);if(delta>0)view.scoreDiamonds();sound.play(id==='cave'?'teleport':id.startsWith('ring_')||id.startsWith('triangle_')||id.startsWith('bumper_neutral_')?'rebound':'bumper',id.includes('left')?-.5:id.includes('right')?.5:0)};physics.onTarget=()=>{view.scoreDiamonds();sound.play('collect')};physics.onTransport=source=>{view.teleport(source,physics.pose().position);sound.play('teleport')}}
async function start(){let phase='styles';try{
 await window.sofacetGameLoader?.stylesReady;
 phase='table';
 await view.load((_value,label)=>{$('loading-detail').textContent=label});
 phase='collision';
 $('loading-detail').textContent='Preparing ball and paddle movement…';
 const fetchAsset=async(name:string)=>{const response=await fetch('/assets/'+name+'?v='+(view.manifest.asset_checksums[name]||view.manifest.asset_revision));if(!response.ok)throw new Error('Missing physics asset: '+name);return response};
 const [vertices,indices,obstacles]=await Promise.all([fetchAsset('collision-vertices.bin').then(r=>r.arrayBuffer()),fetchAsset('collision-indices.bin').then(r=>r.arrayBuffer()),fetchAsset('collider-entities.json').then(r=>r.json())]);
 await new Promise<void>(resolve=>setTimeout(resolve,0));
 phase='physics';
 physicsAssets={vertices:new Float32Array(vertices),indices:new Uint32Array(indices),obstacles};physics=await PinballPhysics.create(view.manifest,physicsAssets.vertices,physicsAssets.indices,obstacles);bindFeedback();
 phase='first-frame';
 loaded=true;view.needsRender=true;for(const id of ['start','settings'])$<HTMLButtonElement>(id).disabled=false;sync();view.render();
 if(view.renderer.getContext().isContextLost())throw new Error('WebGL context lost during game startup');
 stage.dataset.ready='true';stage.setAttribute('aria-busy','false');window.sofacetGameLoader?.ready();requestGameFrame();
 }catch(error){loaded=false;window.sofacetGameLoader?.fail(error,phase);stage.setAttribute('aria-busy','false');$('action').hidden=true;$('error').hidden=false;$('error-detail').textContent=error instanceof Error?error.message:String(error)}}
function frame(now:number){animationFrame=0;if(!loaded||!parentVisible||document.hidden)return;const delta=lastFrame?Math.min((now-lastFrame)/1000,.05):0;lastFrame=now;if(!physics.paused&&!tutorial?.active)accumulator+=delta;else accumulator=0;
 while(accumulator>=DT){const controls=input(),launches=physics.launches;
  if(physics.active&&!physics.paused&&physics.state!=='finished')leaderboard.record(controls);physics.tick(controls);if(physics.launches>launches)sound.play('launch',.5);accumulator-=DT}
 const p=physics.pose();view.updateFeedback(physics.active&&!physics.paused&&!inspecting?delta:0);view.updateBall(p.position,p.rotation,p.ballVisible);for(const paddle of p.paddles)view.updatePaddle(paddle.id,paddle.angle);
 const ejecting=p.cave?.phase==='ejecting';if(ejecting&&!caveEjecting)sound.play('teleport');caveEjecting=ejecting;
 for(const target of p.targets)view.updateTarget(target.id,target.position);
 view.updateSpring(p.springCompression);view.updateCaveCharge(p.cave?.phase==='charging'?p.cave.progress:0,!!p.cave);
 if(physics.active&&!physics.paused){const s=view.manifest.scale,spawn=view.manifest.calibration.authored_ball_spawn;
  const target:XYZ=p.state==='resetting'?[spawn[0]*s,spawn[2]*s,-spawn[1]*s]:p.position;const focus=p.cave?'cave':!p.laneExited&&['launcher','charging','spring_return','playing'].includes(p.state)?'launcher':null;view.follow(target,delta,p.state,p.ballMode,focus)}
 view.advanceCamera(delta);
 tutorial?.update(delta);
 if((physics.active&&!physics.paused&&p.state!=='finished')||view.needsRender)view.render();sync();if(inspecting){const m=view.metrics();$('metrics').textContent=`${Math.round(m.medianFrameMs)} ms/frame · ${m.drawCalls} draws`}requestGameFrame()
}
if(import.meta.env.DEV||(new URLSearchParams(location.search)).has('review')){
 (window as any).__facet={ready:()=>loaded,view,inspect:(index:number)=>{if(!inspecting)toggleInspection();$<HTMLSelectElement>('view').value=String(index);view.setReference(index);applyInspectionLayout();updateOverlay()},metrics:()=>view.metrics(),pose:()=>physics.pose()};
 if(import.meta.env.DEV)Object.defineProperty((window as any).__facet,'physics',{get:()=>physics});
}
const gameReady=start();
if(location.hash==='#leaderboard')void Promise.all([leaderboard.ready,gameReady]).then(()=>{if(loaded)showLeaderboard()});
if(['#settings','#profile'].includes(location.hash))void gameReady.then(()=>{
 if(!loaded)return;
 if(navToggle.getAttribute('aria-expanded')!=='true')navToggle.click();
 $(location.hash==='#settings'?'settings':'profile').click();
});

