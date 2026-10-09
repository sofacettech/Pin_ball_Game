import './style.css';
import {TableView} from './renderer';
import {PinballPhysics,DT} from './physics';
import type {XYZ} from './types';

const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const stage=$('stage'),viewport=$('viewport'),canvas=$<HTMLCanvasElement>('game');
const view=new TableView(canvas,viewport);let inspecting=false,loaded=false,physics:PinballPhysics;
const keys=new Set<string>();let accumulator=0,lastFrame=0,lastState='',sound=false,audio:AudioContext|undefined,holdCharge=false;
const menu=$<HTMLDialogElement>('game-menu');
const input=()=>({left:keys.has('KeyA')||keys.has('ArrowLeft'),right:keys.has('KeyD')||keys.has('ArrowRight'),space:keys.has('Space'),holdCharge});
const clearKeys=()=>keys.clear();
const applyInspectionLayout=()=>{if(!inspecting){viewport.style.width='100%';viewport.style.height='100%'}else{
 const ref=view.references[view.referenceIndex];const ratio=ref.resolution[0]/ref.resolution[1];const w=Math.min(stage.clientWidth,stage.clientHeight*ratio);viewport.style.width=w+'px';viewport.style.height=w/ratio+'px'}view.resize()};
const highScoreKey='facet.pinball.high-score.v1';let highScore:number|null=null,completedRunRecorded=false;
try{const stored=localStorage.getItem(highScoreKey);if(stored!==null){const saved=Number(stored);if(Number.isSafeInteger(saved))highScore=saved}}catch{/* Game remains playable when local storage is unavailable. */}
function sync(){
 const p=physics.pose();
 if(p.paused&&!inspecting){if(!menu.open)menu.showModal()}else if(menu.open)menu.close();
 $('resume').textContent=physics.active&&p.state!=='finished'?'Resume game':'Back to game';
 $('menu-description').textContent=physics.active&&p.state!=='finished'?'Game paused. Your progress is saved here.':'Choose your gameplay view.';
 if(p.state==='finished'&&!completedRunRecorded){completedRunRecorded=true;highScore=highScore===null?p.score:Math.max(highScore,p.score);try{localStorage.setItem(highScoreKey,String(highScore))}catch{/* Retain the best score for this session. */}}
 if(view.scoreboard.update(p.score,highScore??0,p.lives))view.needsRender=true;
 $('lives').textContent=String(p.lives);$('score').textContent=String(p.score);$('charge-fill').style.transform='scaleX('+p.charge+')';document.querySelector('.charge')!.setAttribute('aria-valuenow',String(Math.round(p.charge*100)));
 $('pause').textContent=p.paused?'Resume':'Pause';$<HTMLButtonElement>('pause').disabled=!physics.active||p.state==='finished'||inspecting;
 $('start').hidden=physics.active&&p.state!=='finished';$('start').textContent=physics.active?'Play again':'Play';
 $('action').hidden=menu.open||physics.active&&(p.state==='playing'||p.state==='draining'||p.state==='spring_return')&&!p.paused;
 $('message').textContent=!physics.active?'Your table, ready to play.':p.state==='finished'?`Three balls played. Final score: ${p.score} · High score: ${highScore}`:p.paused?'Game paused.':p.state==='resetting'?'Returning to the launcher…':p.state==='draining'?'':p.state==='spring_return'?'Settling at the spring…':p.state==='charging'?holdCharge?'Press Space to continue charging.':'Keep holding Space to launch.':'Hold Space to charge the spring.';
}
function toggleInspection(){if(!loaded)return;inspecting=!inspecting;clearKeys();if(physics.active&&physics.state!=='finished')physics.setPaused(true);
 document.body.classList.toggle('inspect-mode',inspecting);$('inspection').hidden=!inspecting;$('inspect').textContent=inspecting?'Back to game':'Inspect table';view.setInspect(inspecting);applyInspectionLayout();updateOverlay();sync()}
$('inspect').onclick=toggleInspection;
$<HTMLSelectElement>('quality').onchange=e=>view.setQuality((e.target as HTMLSelectElement).value==='auto');
$<HTMLSelectElement>('view').onchange=e=>{view.setReference(Number((e.target as HTMLSelectElement).value));applyInspectionLayout();updateOverlay()};
function updateOverlay(){const opacity=Number($<HTMLInputElement>('overlay').value)/100;const image=$<HTMLImageElement>('reference');image.src='/references/'+view.references[view.referenceIndex].file;image.hidden=!inspecting||!opacity;image.style.opacity=String(opacity);document.querySelector<HTMLElement>('.compare-label')!.hidden=!inspecting||!opacity}
$<HTMLInputElement>('overlay').oninput=updateOverlay;
function setGamePaused(value:boolean){if(!loaded||inspecting)return;clearKeys();accumulator=0;if(value)holdCharge=physics.state==='charging';physics.setPaused(value);sync();if(!value)canvas.focus()}
function togglePause(){if(!loaded||inspecting||!physics.active||physics.state==='finished')return;setGamePaused(!physics.paused)}
$('pause').onclick=togglePause;
$('settings').onclick=()=>setGamePaused(true);
$('resume').onclick=()=>setGamePaused(false);
menu.oncancel=event=>{event.preventDefault();setGamePaused(false)};
$<HTMLSelectElement>('camera').onchange=event=>view.setCameraMode((event.target as HTMLSelectElement).value as 'ball'|'complete');
$('sound').onclick=()=>{sound=!sound;if(sound){audio??=new AudioContext();void audio.resume()}$('sound').textContent=sound?'Sound on':'Sound off';$('sound').setAttribute('aria-pressed',String(sound))};
function playTone(frequency:number){if(!sound||!audio||audio.state!=='running')return;const oscillator=audio.createOscillator(),gain=audio.createGain();oscillator.frequency.value=frequency;gain.gain.setValueAtTime(.06,audio.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.1);oscillator.connect(gain).connect(audio.destination);oscillator.start();oscillator.stop(audio.currentTime+.11)}
$('start').onclick=()=>{if(inspecting)toggleInspection();clearKeys();holdCharge=false;completedRunRecorded=false;physics.start();view.resetFeedback();accumulator=0;view.setReference(0);view.resize();sync();canvas.focus();playTone(440)};
const playKeys=new Set(['ArrowLeft','ArrowRight','KeyA','KeyD','Space']);
addEventListener('keydown',event=>{
 if(event.code==='Escape'){if(loaded&&!inspecting){event.preventDefault();if(!event.repeat){if(menu.open)setGamePaused(false);else togglePause()}}return}
 if(menu.open&&playKeys.has(event.code)){event.preventDefault();return}
 const target=event.target as HTMLElement;if(target.matches('input,select,textarea,button,a')&&target!==canvas)return;
 if(!loaded||inspecting)return;
 if(event.code==='KeyP'){event.preventDefault();if(!event.repeat)togglePause();return}
 if(playKeys.has(event.code)&&physics.active){event.preventDefault();if(physics.paused)return;if(event.code==='Space')holdCharge=false;keys.add(event.code)}
});
addEventListener('keyup',event=>{keys.delete(event.code);if(playKeys.has(event.code)&&event.target===canvas)event.preventDefault()});
function pauseOnFocusLoss(){clearKeys();if(loaded&&physics.active&&physics.state!=='finished')setGamePaused(true)}
addEventListener('blur',pauseOnFocusLoss);document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseOnFocusLoss()});
window.addEventListener('resize',applyInspectionLayout);
async function start(){try{
 await view.load((value,label)=>{document.querySelector<HTMLProgressElement>('progress')!.value=value*.9;$('loading-detail').textContent=label});
 $('loading-detail').textContent='Preparing ball and paddle movement…';
 const fetchAsset=async(name:string)=>{const response=await fetch('/assets/'+name);if(!response.ok)throw new Error('Missing physics asset: '+name);return response};
 const [vertices,indices,obstacles]=await Promise.all([fetchAsset('collision-vertices.bin').then(r=>r.arrayBuffer()),fetchAsset('collision-indices.bin').then(r=>r.arrayBuffer()),fetchAsset('collider-entities.json').then(r=>r.json())]);
 physics=await PinballPhysics.create(view.manifest,new Float32Array(vertices),new Uint32Array(indices),obstacles);physics.onHit=(id,delta)=>{view.hit(id);playTone(id.startsWith('ring_')?620:delta>0?880:delta<0?330:620)};
 physics.onTarget=()=>playTone(1046);physics.onTransport=source=>view.teleport(source,physics.pose().position);
 loaded=true;view.needsRender=true;$('loading').hidden=true;for(const id of ['inspect','sound','start','settings'])$<HTMLButtonElement>(id).disabled=false;sync();requestAnimationFrame(frame);
 }catch(error){$('loading').hidden=true;$('action').hidden=true;$('error').hidden=false;$('error-detail').textContent=error instanceof Error?error.message:String(error)}}
function frame(now:number){if(!loaded)return;const delta=lastFrame?Math.min((now-lastFrame)/1000,.05):0;lastFrame=now;if(!physics.paused)accumulator+=delta;else accumulator=0;
 while(accumulator>=DT){physics.tick(input());accumulator-=DT}
 const p=physics.pose();view.updateFeedback(physics.active&&!physics.paused&&!inspecting?delta:0);view.updateBall(p.position,p.rotation,p.ballVisible);for(const paddle of p.paddles)view.updatePaddle(paddle.id,paddle.angle);
 for(const target of p.targets)view.updateTarget(target.id,target.position);
 view.updateSpring(p.springCompression);view.updateCaveCharge(p.cave?.phase==='charging'?p.cave.progress:0,!!p.cave);
 if(physics.active&&!physics.paused&&(p.state!=='finished'||lastState!=='finished')){const s=view.manifest.scale,spawn=view.manifest.calibration.authored_ball_spawn;
  const target:XYZ=p.state==='resetting'?[spawn[0]*s,spawn[2]*s,-spawn[1]*s]:p.position;view.follow(target,delta,p.state)}
 if((physics.active&&!physics.paused&&p.state!=='finished')||view.needsRender)view.render();lastState=p.state;sync();if(inspecting){const m=view.metrics();$('metrics').textContent=`${Math.round(m.medianFrameMs)} ms/frame · ${m.drawCalls} draws`}requestAnimationFrame(frame)
}
if(import.meta.env.DEV||(new URLSearchParams(location.search)).has('review')){
 (window as any).__facet={ready:()=>loaded,view,inspect:(index:number)=>{if(!inspecting)toggleInspection();$<HTMLSelectElement>('view').value=String(index);view.setReference(index);applyInspectionLayout();updateOverlay()},metrics:()=>view.metrics(),pose:()=>physics.pose()};
 if(import.meta.env.DEV)Object.defineProperty((window as any).__facet,'physics',{get:()=>physics});
}
start();

