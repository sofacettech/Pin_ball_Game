import './style.css';
import {TableView} from './renderer';
import {PinballPhysics,DT} from './physics';
import type {Obstacle} from './physics';
import type {XYZ} from './types';
import {connectLeaderboard} from './leaderboard';
import {connectTouchControls} from './touch-controls';
import {completeViewOnly,phoneDevice} from './device-view';
import {connectNeonScoreboard} from './neon-scoreboard';
import {createGameSound} from './game-sound';
import {connectMembership} from './membership';

const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const stage=$('stage'),viewport=$('viewport'),canvas=$<HTMLCanvasElement>('game');
const livesDisplay=$('lives'),lifeDots=Array.from(livesDisplay.children);
const neonScoreboard=$('neon-scoreboard'),updateNeonScoreboard=connectNeonScoreboard($<HTMLOutputElement>('neon-score'),$<HTMLOutputElement>('neon-high-score'));
updateNeonScoreboard(0,null);
const view=new TableView(canvas,viewport);let inspecting=false,loaded=false,physics:PinballPhysics;
let physicsAssets:{vertices:Float32Array;indices:Uint32Array;obstacles:Obstacle[]},starting=false,highScore:number|null=null;
const keys=new Set<string>(),sound=createGameSound();let accumulator=0,lastFrame=0,lastState='',holdCharge=false;
const menu=$<HTMLDialogElement>('game-menu');
const howToPlay=$('how-to-play-toggle'),controlsGuide=$('how-to-play-controls');
howToPlay.onclick=()=>{const expanded=howToPlay.getAttribute('aria-expanded')!=='true';howToPlay.setAttribute('aria-expanded',String(expanded));howToPlay.parentElement!.classList.toggle('is-open',expanded);controlsGuide.inert=!expanded};
const registration=$<HTMLDialogElement>('registration-dialog');
let resumeAfterMembership=false;
let membership:ReturnType<typeof connectMembership>|undefined;
const leaderboard=connectLeaderboard(()=>{$('start').focus()},()=>$('start').click(),(score,best)=>{if(loaded&&physics.state==='finished'){physics.score=score;highScore=best;sync()}},best=>{highScore=best;updateNeonScoreboard(loaded?physics.score:0,best);if(loaded)sync()},player=>membership?.updatePlayer(player));
membership=connectMembership({
 beforeOpen(){resumeAfterMembership=loaded&&physics.active&&!physics.paused&&physics.state!=='finished';clearKeys();if(resumeAfterMembership){holdCharge=physics.state==='charging';physics.setPaused(true);accumulator=0}if(menu.open)menu.close()},
 afterClose(){const resume=resumeAfterMembership&&loaded;if(resume){physics.setPaused(false);accumulator=0}resumeAfterMembership=false;if(loaded)sync();if(resume)canvas.focus();else if(menu.open)$('resume').focus()},
 refreshPlayer:()=>leaderboard.memberChanged(),
});
const launchButton=$<HTMLButtonElement>('touch-launch'),touchHints=$('touch-hints');
const releasedPaddles={left:false,right:false},previousTouch={left:false,right:false};
const keyboardPaddle=(side:'left'|'right')=>side==='left'?keys.has('KeyA')||keys.has('ArrowLeft'):keys.has('KeyD')||keys.has('ArrowRight');
const touchInput=matchMedia('(any-pointer: coarse)');
const primaryTouch=matchMedia('(pointer: coarse)'),cameraChoice=$<HTMLSelectElement>('camera');let desktopCamera:'ball'|'complete'='ball',phone=false;
const mobileView=()=>completeViewOnly(navigator.userAgent,navigator.maxTouchPoints,primaryTouch.matches);
const selectedCamera=()=>mobileView()?'complete':desktopCamera;
function applyScoreboardLayout(){const visible=!phone&&!inspecting&&view.cameraMode==='complete';if(neonScoreboard.hidden===!visible)return;neonScoreboard.hidden=!visible;stage.classList.toggle('has-neon-scoreboard',visible);const artwork=$<HTMLTemplateElement>('neon-scoreboard-artwork');if(visible&&artwork)artwork.replaceWith(artwork.content);view.resize()}
function applyNavigationLayout(){const compact=phone||loaded&&physics.active&&physics.state!=='finished'&&!inspecting;document.body.classList.toggle('compact-navigation',compact);$('navbar-extras').inert=compact}
function applyDeviceView(){const mobile=mobileView();phone=phoneDevice(navigator.userAgent,navigator.maxTouchPoints,primaryTouch.matches,Math.min(screen.width,screen.height));cameraChoice.disabled=mobile;cameraChoice.value=selectedCamera();cameraChoice.querySelector<HTMLOptionElement>('option[value="ball"]')!.disabled=mobile;document.body.classList.toggle('handheld',mobile);document.body.classList.toggle('phone-layout',phone);if(loaded&&!inspecting)view.setCameraMode(physics.active&&physics.state!=='finished'?selectedCamera():'complete');applyScoreboardLayout();applyNavigationLayout()}
applyDeviceView();primaryTouch.addEventListener('change',applyDeviceView);
const canTouch=(control:'paddle'|'launch')=>loaded&&!starting&&!inspecting&&physics.active&&!physics.paused&&physics.state!=='finished'&&!menu.open&&!registration.open&&!leaderboard.dialog.open&&(control==='paddle'||physics.state==='launcher'||physics.state==='charging');
const touch=connectTouchControls(canvas,launchButton,canTouch,()=>{holdCharge=false},state=>{for(const side of ['left','right'] as const){if(previousTouch[side]&&!state[side]&&!keyboardPaddle(side))releasedPaddles[side]=true;previousTouch[side]=state[side]}stage.classList.toggle('left-held',state.left);stage.classList.toggle('right-held',state.right)});
const input=()=>{const controls={left:!releasedPaddles.left&&(keyboardPaddle('left')||touch.state.left),right:!releasedPaddles.right&&(keyboardPaddle('right')||touch.state.right),space:keys.has('Space')||touch.state.space,holdCharge};releasedPaddles.left=releasedPaddles.right=false;return controls};
const clearKeys=()=>{keys.clear();touch.clear();releasedPaddles.left=releasedPaddles.right=true};
const applyInspectionLayout=()=>{if(!inspecting){viewport.style.width='100%';viewport.style.height='100%'}else{
 const ref=view.references[view.referenceIndex];const ratio=ref.resolution[0]/ref.resolution[1];const w=Math.min(stage.clientWidth,stage.clientHeight*ratio);viewport.style.width=w+'px';viewport.style.height=w/ratio+'px'}view.resize()};
let completedRunRecorded=false;
function sync(){
 const p=physics.pose();
 applyNavigationLayout();stage.classList.toggle('showing-play',!physics.active||p.state==='finished');
 if(p.paused&&!inspecting&&!starting&&!registration.open&&!leaderboard.dialog.open){if(!menu.open)menu.showModal()}else if(menu.open)menu.close();
 $('resume').textContent=physics.active&&p.state!=='finished'?'Resume game':'Back to game';
 $('menu-description').textContent=physics.active&&p.state!=='finished'?'Game paused. Your progress is saved here.':'Choose your gameplay view.';
 if(p.state==='finished'&&!completedRunRecorded){completedRunRecorded=true;
  clearKeys();holdCharge=false;leaderboard.show();
 }
 if(view.scoreboard.update(p.score,highScore??0,p.lives))view.needsRender=true;
 updateNeonScoreboard(p.score,highScore);applyScoreboardLayout();
 if(livesDisplay.dataset.remaining!==String(p.lives)){lifeDots.forEach((dot,i)=>dot.classList.toggle('is-spent',i>=p.lives));livesDisplay.dataset.remaining=String(p.lives);livesDisplay.setAttribute('aria-label',`${p.lives} of 3 lives remaining`)}
 $('score').textContent=String(p.score);$('charge-fill').style.transform='scaleX('+p.charge+')';document.querySelector('.charge')!.setAttribute('aria-valuenow',String(Math.round(p.charge*100)));
 $('pause').textContent=p.paused?'Resume':'Pause';$<HTMLButtonElement>('pause').disabled=!physics.active||p.state==='finished'||inspecting;
 launchButton.hidden=!canTouch('launch');launchButton.disabled=!canTouch('launch');touchHints.hidden=!canTouch('paddle');stage.classList.toggle('launch-ready',canTouch('launch'));
 $<HTMLButtonElement>('restart').disabled=starting||inspecting||!physics.active||p.state==='finished';
 $('start').hidden=physics.active&&p.state!=='finished';$<HTMLButtonElement>('start').disabled=starting;$('start').textContent=starting?'Preparing…':physics.active?'Play again':'Play';
 $('action').hidden=menu.open||physics.active&&(p.state==='playing'||p.state==='draining'||p.state==='spring_return')&&!p.paused;
 $('message').textContent=starting?'Preparing your game…':!physics.active?'Your table, ready to play.':p.state==='finished'?`Three balls played. Final score: ${p.score} · High score: ${highScore??'—'}`:p.paused?'Game paused.':p.state==='resetting'?'Returning to the launcher…':p.state==='draining'?'':p.state==='spring_return'?'Settling at the spring…':touchInput.matches?p.state==='charging'&&!holdCharge?'Release the launch button to launch.':'Hold the launch button to charge.':p.state==='charging'?holdCharge?'Press Space to continue charging.':'Keep holding Space to launch.':'Hold Space to charge the spring.';
}
function toggleInspection(){if(!loaded)return;inspecting=!inspecting;clearKeys();if(physics.active&&physics.state!=='finished')physics.setPaused(true);
 document.body.classList.toggle('inspect-mode',inspecting);$('inspection').hidden=!inspecting;$('inspect').textContent=inspecting?'Back to game':'Inspect table';view.setInspect(inspecting);applyScoreboardLayout();applyInspectionLayout();updateOverlay();sync()}
$('inspect').onclick=toggleInspection;
$<HTMLSelectElement>('quality').onchange=e=>view.setQuality((e.target as HTMLSelectElement).value==='auto');
$<HTMLSelectElement>('view').onchange=e=>{view.setReference(Number((e.target as HTMLSelectElement).value));applyInspectionLayout();updateOverlay()};
function updateOverlay(){const opacity=Number($<HTMLInputElement>('overlay').value)/100;const image=$<HTMLImageElement>('reference');image.src='/references/'+view.references[view.referenceIndex].file;image.hidden=!inspecting||!opacity;image.style.opacity=String(opacity);document.querySelector<HTMLElement>('.compare-label')!.hidden=!inspecting||!opacity}
$<HTMLInputElement>('overlay').oninput=updateOverlay;
function setGamePaused(value:boolean){if(!loaded||inspecting)return;clearKeys();accumulator=0;if(value)holdCharge=physics.state==='charging';physics.setPaused(value);sync();if(!value)canvas.focus()}
function togglePause(){if(!loaded||inspecting||!physics.active||physics.state==='finished')return;setGamePaused(!physics.paused)}
$('pause').onclick=togglePause;
$('settings').onclick=()=>inspecting?toggleInspection():setGamePaused(true);
$('resume').onclick=()=>setGamePaused(false);
$('menu-close').onclick=()=>setGamePaused(false);
menu.oncancel=event=>{event.preventDefault();setGamePaused(false)};
cameraChoice.onchange=()=>{if(!mobileView())desktopCamera=cameraChoice.value as 'ball'|'complete';applyDeviceView()};
function updateSoundSettings(){$('volume-value').textContent=Math.round(sound.volume)+'%';$('sound-label').textContent=sound.muted?'Unmute':'Mute';$('sound').setAttribute('aria-pressed',String(sound.muted));$('sound').setAttribute('aria-label',sound.muted?'Unmute game sound':'Mute game sound')}
$('sound').onclick=()=>{sound.setMuted(!sound.muted);updateSoundSettings()};
$<HTMLInputElement>('volume').oninput=event=>{sound.setVolume(Number((event.target as HTMLInputElement).value));sound.unlock();updateSoundSettings()};
function playTone(frequency:number){sound.play(frequency)}
$('start').onclick=async()=>{if(!loaded||starting)return;sound.unlock();starting=true;if(inspecting)toggleInspection();clearKeys();holdCharge=false;physics.setPaused(true);sync();
 try{const seed=await leaderboard.start(),fresh=await PinballPhysics.create(view.manifest,physicsAssets.vertices,physicsAssets.indices,physicsAssets.obstacles);const old=physics;physics=fresh;old.dispose();bindFeedback();completedRunRecorded=false;view.setCameraMode(selectedCamera(),true);physics.start(seed);view.resetFeedback();accumulator=0;lastFrame=0;lastState='';view.setReference(0);view.resize();canvas.focus();playTone(440)}
 catch(error){loaded=false;$('error').hidden=false;$('error-detail').textContent=error instanceof Error?error.message:String(error);$('action').hidden=true}
 finally{starting=false;if(loaded)sync()}
};
$('restart').onclick=()=>{if(loaded&&!starting&&physics.active&&physics.state!=='finished')$('start').click()};
const playKeys=new Set(['ArrowLeft','ArrowRight','KeyA','KeyD','Space']);
addEventListener('keydown',event=>{
 if(starting||registration.open||leaderboard.dialog.open)return;
 if(event.code==='Escape'){if(loaded&&!inspecting){event.preventDefault();if(!event.repeat){if(menu.open)setGamePaused(false);else togglePause()}}return}
 if(menu.open&&playKeys.has(event.code)){if(!(event.target as HTMLElement).matches('button,select,input,textarea,a'))event.preventDefault();return}
 const target=event.target as HTMLElement;if(target.matches('input,select,textarea,button,a')&&target!==canvas)return;
 if(!loaded||inspecting)return;
 if(event.code==='KeyP'){event.preventDefault();if(!event.repeat)togglePause();return}
 if(playKeys.has(event.code)&&physics.active){event.preventDefault();if(physics.paused||event.code!=='Space'&&event.repeat)return;if(event.code==='Space')holdCharge=false;keys.add(event.code)}
});
addEventListener('keyup',event=>{const wasHeld=keys.delete(event.code);if(wasHeld){const side=event.code==='KeyA'||event.code==='ArrowLeft'?'left':event.code==='KeyD'||event.code==='ArrowRight'?'right':null;if(side&&!keyboardPaddle(side)&&!touch.state[side])releasedPaddles[side]=true}if(playKeys.has(event.code)&&event.target===canvas)event.preventDefault()});
function pauseOnFocusLoss(){clearKeys();if(loaded&&physics.active&&physics.state!=='finished')setGamePaused(true)}
addEventListener('blur',pauseOnFocusLoss);document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseOnFocusLoss()});
window.addEventListener('resize',()=>{clearKeys();applyDeviceView();applyInspectionLayout()});
function bindFeedback(){physics.onHit=(id,delta)=>{view.hit(id);playTone(id.startsWith('ring_')?620:delta>0?880:delta<0?330:620)};physics.onTarget=()=>playTone(1046);physics.onTransport=source=>view.teleport(source,physics.pose().position)}
async function start(){try{
 await view.load((value,label)=>{document.querySelector<HTMLProgressElement>('progress')!.value=value*.9;$('loading-detail').textContent=label});
 $('loading-detail').textContent='Preparing ball and paddle movement…';
 const fetchAsset=async(name:string)=>{const response=await fetch('/assets/'+name+'?v='+(view.manifest.asset_checksums[name]||view.manifest.asset_revision));if(!response.ok)throw new Error('Missing physics asset: '+name);return response};
 const [vertices,indices,obstacles]=await Promise.all([fetchAsset('collision-vertices.bin').then(r=>r.arrayBuffer()),fetchAsset('collision-indices.bin').then(r=>r.arrayBuffer()),fetchAsset('collider-entities.json').then(r=>r.json())]);
 physicsAssets={vertices:new Float32Array(vertices),indices:new Uint32Array(indices),obstacles};physics=await PinballPhysics.create(view.manifest,physicsAssets.vertices,physicsAssets.indices,obstacles);bindFeedback();
 loaded=true;view.needsRender=true;$('loading').hidden=true;for(const id of ['inspect','start','settings'])$<HTMLButtonElement>(id).disabled=false;sync();requestAnimationFrame(frame);
 }catch(error){$('loading').hidden=true;$('action').hidden=true;$('error').hidden=false;$('error-detail').textContent=error instanceof Error?error.message:String(error)}}
function frame(now:number){if(!loaded)return;const delta=lastFrame?Math.min((now-lastFrame)/1000,.05):0;lastFrame=now;if(!physics.paused)accumulator+=delta;else accumulator=0;
 while(accumulator>=DT){const controls=input();if(physics.active&&!physics.paused&&physics.state!=='finished')leaderboard.record(controls);physics.tick(controls);accumulator-=DT}
 const p=physics.pose();view.updateFeedback(physics.active&&!physics.paused&&!inspecting?delta:0);view.updateBall(p.position,p.rotation,p.ballVisible);for(const paddle of p.paddles)view.updatePaddle(paddle.id,paddle.angle);
 for(const target of p.targets)view.updateTarget(target.id,target.position);
 view.updateSpring(p.springCompression);view.updateCaveCharge(p.cave?.phase==='charging'?p.cave.progress:0,!!p.cave);
 if(physics.active&&!physics.paused&&(p.state!=='finished'||lastState!=='finished')){const s=view.manifest.scale,spawn=view.manifest.calibration.authored_ball_spawn;
  const target:XYZ=p.state==='resetting'?[spawn[0]*s,spawn[2]*s,-spawn[1]*s]:p.position;view.follow(target,delta,p.state,p.ballMode)}
 view.advanceCamera(delta);
 if((physics.active&&!physics.paused&&p.state!=='finished')||view.needsRender)view.render();lastState=p.state;sync();if(inspecting){const m=view.metrics();$('metrics').textContent=`${Math.round(m.medianFrameMs)} ms/frame · ${m.drawCalls} draws`}requestAnimationFrame(frame)
}
if(import.meta.env.DEV||(new URLSearchParams(location.search)).has('review')){
 (window as any).__facet={ready:()=>loaded,view,inspect:(index:number)=>{if(!inspecting)toggleInspection();$<HTMLSelectElement>('view').value=String(index);view.setReference(index);applyInspectionLayout();updateOverlay()},metrics:()=>view.metrics(),pose:()=>physics.pose()};
 if(import.meta.env.DEV)Object.defineProperty((window as any).__facet,'physics',{get:()=>physics});
}
start();

