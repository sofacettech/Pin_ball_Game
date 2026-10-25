import {setBrandText} from '../../shared/brand-text.ts';
import {MAX_GAME_TICKS,MAX_INPUT_RUNS,REPLAY_VERSION,packInput} from './simulation.ts';
import type {InputRun} from './simulation';
import type {Input} from './physics';
import {formatPoints,resultHeadline} from './player-copy';
export type Entry={rank:number|null;display_name:string;points:number;is_you:boolean};
type Board={entries:Entry[];me:Entry|null;mode:'game'|'rewards'};
export type Player={display_name:string;member:boolean;best_score:number|null};

async function request<T>(url:string,body?:unknown,timeout=30000):Promise<T>{
 const response=await fetch(url,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});
 const data=await response.json().catch(()=>({message:'The leaderboard service is unavailable.'}));
 if(!response.ok)throw new Error(data.message||'Please try again in a moment.');return data as T;
}

// Keep the current player's real rank; never renumber their pinned row as tenth.
export function visibleEntries(entries:Entry[],me:Entry|null):Entry[]{
 const sorted=[...entries].sort((a,b)=>(a.rank??Infinity)-(b.rank??Infinity));
 if(me?.rank!=null&&me.rank>10)return [...sorted.filter(row=>!row.is_you).slice(0,9),me];
 const rows=sorted.slice(0,10);
 if(me?.rank!=null&&me.rank<=10&&!rows.some(row=>row.is_you))return [...rows.filter(row=>row.rank!==me.rank),me].sort((a,b)=>(a.rank??Infinity)-(b.rank??Infinity)).slice(0,10);
 return rows;
}

export function connectLeaderboard(onClose:()=>void,onReplay:()=>void,onVerified:(score:number,best:number)=>void,onBest:(best:number|null)=>void,onPlayer:(player:Player|null)=>void=()=>{},onJoin:()=>void=()=>{}){
 const dialog=document.getElementById('leaderboard-dialog') as HTMLDialogElement;
 const rows=document.getElementById('leaderboard-rows')!,status=document.getElementById('leaderboard-status')!,summary=document.getElementById('leaderboard-summary')!;
 const retry=document.getElementById('leaderboard-retry') as HTMLButtonElement;
 type Run={id?:string;seed?:number;inputs:InputRun[];ticks:number;ended:boolean;submitted:boolean;previousBest?:number|null;score?:number;rewardSaved?:boolean;error?:string;submission?:Promise<void>};
 let player:Player|null=null,run:Run={inputs:[],ticks:0,ended:false,submitted:false},revision=0,playerRevision=0;
 const refreshPlayer=async()=>{const current=++playerRevision;try{const next=await request<Player>('/api/player');if(typeof next.member!=='boolean')throw Error('Invalid player');if(current!==playerRevision)return;player=next;onBest(player.best_score);onPlayer(player)}catch{if(current===playerRevision){player=null;onPlayer(null)}}};
 const ready=refreshPlayer();
 function close(){revision++;dialog.close();onClose()}
 document.getElementById('leaderboard-close')!.onclick=close;
 document.getElementById('leaderboard-play')!.onclick=()=>{close();onReplay()};
 dialog.oncancel=event=>{event.preventDefault();close()};
 function paint(board:Board){
  const selected=visibleEntries(board.entries,board.me);rows.replaceChildren();
  document.getElementById('leaderboard-score-label')!.textContent=board.mode==='rewards'?'Rewards':'Score';
  setBrandText(document.getElementById('leaderboard-caption')!,board.mode==='rewards'?'All-time SO/ FACET rewards':'Best pinball scores');
  for(const entry of selected){const row=document.createElement('tr');if(entry.is_you){row.className='current-player';row.setAttribute('aria-label','Your position')}
   for(const [index,value] of [entry.rank===null?'—':String(entry.rank),entry.display_name,new Intl.NumberFormat('en-IN').format(entry.points)].entries()){
    const cell=document.createElement('td');cell.textContent=value;if(index===1&&entry.is_you){const you=document.createElement('span');you.className='you-label';you.textContent='You';cell.append(you)}row.append(cell);
   }rows.append(row);
  }
  if(!selected.length){const row=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=3;cell.className='board-empty';cell.textContent='No scores yet.';row.append(cell);rows.append(row)}
  setBrandText(status,board.mode==='rewards'&&!board.me?'Your personal rewards rank requires an identified SO/ FACET customer session.':board.me?.rank&&board.me.rank>10?'Your row stays visible below the top nine.':'');
 }
 async function submit(target:Run){
  if(target.submitted)return;
  if(target.error||!target.id)throw new Error(target.error||'This game could not connect for verification. Please play again with a connection.');
  target.submission??=request<{score:number;best_score:number}>('/api/games/'+target.id+'/finish',{version:REPLAY_VERSION,inputs:target.inputs},75000).then(result=>{
   if(!Number.isSafeInteger(result.score)||result.score<0||!Number.isSafeInteger(result.best_score)||result.best_score<result.score)throw Error('Your score could not be verified. Please try again.');
   target.submitted=true;target.score=result.score;onBest(result.best_score);if(target===run){if(player)player={...player,best_score:result.best_score};summary.textContent='This run: '+formatPoints(result.score);onVerified(result.score,result.best_score)}
  }).catch(error=>{target.submission=undefined;throw error});
  await target.submission;
 }
 async function refresh(){const current=++revision,target=run;retry.hidden=true;status.textContent=target.ended&&!target.submitted?'Verifying your game…':'Loading the leaderboard…';rows.setAttribute('aria-busy','true');
  try{
   if(!player)await refreshPlayer();
   if(current!==revision)return;
   if(player?.member===false){close();onJoin();return}
   if(!player)throw Error('Your membership could not be checked. Try again.');
   if(target.ended&&!target.submitted)await submit(target);
   let rewardError='';
   if(target.ended&&target.submitted&&player?.member&&target.id&&!target.rewardSaved){
    try{const result=await request<{pointsSaved:boolean}>('/api/membership/rewards',{gameId:target.id});if(result.pointsSaved!==true)throw Error('Points have not been saved yet.');target.rewardSaved=true}
    catch(error){rewardError=error instanceof Error?error.message:'Points have not been saved yet.'}
   }
   if(current!==revision)return;const board=await request<Board>('/api/leaderboard');if(current===revision){paint(board);if(rewardError){status.textContent='Your score is recorded. Points could not be saved: '+rewardError;retry.hidden=false}else if(target.ended&&target.rewardSaved&&target.score!==undefined){summary.textContent=resultHeadline(target.score,target.previousBest)}}
  }catch(error){if(current===revision){status.textContent=error instanceof Error?error.message:'Unable to load the leaderboard.';retry.hidden=false}}
  finally{if(current===revision)rows.removeAttribute('aria-busy')}
 }
 retry.onclick=()=>void refreshPlayer().then(refresh);
 return {
  dialog,ready,
  get gameId(){return run.id},
  finish(){run.ended=true;return submit(run)},
  async start(){const next:Run={inputs:[],ticks:0,ended:false,submitted:false,previousBest:player?.member?player.best_score:null};run=next;try{const result=await request<{id:string;seed:number;version:number}>('/api/games/start',{},10000);if(result.version!==REPLAY_VERSION||!Number.isInteger(result.seed))throw new Error('Please refresh the game to start a verified run.');next.id=result.id;next.seed=result.seed}catch(error){next.error=error instanceof Error?error.message:'This run is offline and cannot enter the leaderboard.'}return next.seed??crypto.getRandomValues(new Uint32Array(1))[0]},
  record(input:Input){if(run.error||run.ended)return;const bits=packInput(input),last=run.inputs.at(-1);run.ticks++;if(last&&last[0]===bits)last[1]++;else run.inputs.push([bits,1]);if(run.ticks>MAX_GAME_TICKS||run.inputs.length>MAX_INPUT_RUNS){run.error='This game exceeded the verification limit. Please play a shorter game to enter the leaderboard.';run.inputs=[]}},
  async show(){const current=++revision;await refreshPlayer();if(current!==revision)return;if(player?.member!==true){close();onJoin();return}if(!run.ended)summary.textContent='';else if(!run.submitted)summary.textContent='This run: awaiting verification';rows.replaceChildren();if(!dialog.open)dialog.showModal();void refresh()},
  async memberChanged(){await refreshPlayer();if(dialog.open)await refresh()},
 };
}
