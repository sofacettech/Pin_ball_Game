import {mountScorePage} from './score-page.jsx';
import './post-game-rewards.css';
import {leaveCopy} from './player-copy';

export type CompletedGameResult=Readonly<{points:number;rewardValue:number;completedAt:number;status:'completed';gameId?:string}>;
export function captureGameResult(finalScore:number,gameId?:string):CompletedGameResult{
 const whole=Math.trunc(finalScore),points=Number.isSafeInteger(whole)?Math.max(0,whole):0;
 return Object.freeze({points,rewardValue:points/10,completedAt:Date.now(),status:'completed',gameId});
}
export function connectPostGameRewards(onRegister:(result:CompletedGameResult)=>void,onRetry:()=>void,onLeaderboard:()=>void=()=>{}){
 const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
 const dialog=$<HTMLDialogElement>('post-game-rewards'),header=document.querySelector<HTMLElement>('body > header')!,toggle=$('nav-toggle');
 const views={result:$('rewards-result'),leave:$('rewards-leave'),exit:$('rewards-exit')};
 let result:CompletedGameResult|null=null,discarded=false,current:keyof typeof views='result',destination='/';
 const scorePage=mountScorePage($('score-page-root'),{onSave:register,onReplay:replay,onLeaderboard});
 const unsaved=()=>!!result&&result.points>=10&&!discarded;
 const placeFloor=()=>{if(current==='result')return;const actions=views[current].querySelector<HTMLElement>('.rewards-actions')!;if(dialog.open)dialog.style.setProperty('--rewards-floor-top',actions.offsetTop+actions.offsetHeight+12+'px')};
 const resize=new ResizeObserver(placeFloor);
 function setView(view:keyof typeof views){
  current=view;dialog.dataset.view=view;for(const [key,element] of Object.entries(views))element.hidden=key!==view;
  const heading=views[view].querySelector<HTMLElement>('h1')!;
  dialog.setAttribute('aria-labelledby',heading.id);
  dialog.setAttribute('aria-describedby',view==='result'?'rewards-score rewards-value-line rewards-expiry':view==='leave'?'rewards-leave-copy':'rewards-exit-copy');
  resize.disconnect();if(!dialog.open){dialog.prepend(header);dialog.showModal()}resize.observe(views[view]);placeFloor();heading.focus({preventScroll:true});
 }
 function register(){if(result){dialog.close();onRegister(result)}}
 function replay(){discarded=true;dialog.close();onRetry()}
 function world(){discarded=true;window.top!.location.assign(destination)}
 function leave(href='/'){
  destination=href;
  if(!unsaved()){world();return}
  const copy=leaveCopy(result!.points);$('rewards-leave-title').textContent=copy.title;$('rewards-leave-copy').textContent=copy.support;setView('leave');
 }
 dialog.addEventListener('close',()=>{if(dialog.open)return;resize.disconnect();if(toggle.getAttribute('aria-expanded')==='true')toggle.click();document.body.prepend(header)});
 $('rewards-keep').onclick=register;
 $('rewards-leave-anyway').onclick=()=>{discarded=true;setView('exit')};$('rewards-exit-play').onclick=replay;$('rewards-exit-world').onclick=world;
 $('rewards-close').onclick=()=>current==='leave'?setView('result'):current==='exit'?world():leave();
 dialog.oncancel=event=>{event.preventDefault();if(current==='leave')setView('result');else if(current==='result')leave()};
 document.addEventListener('click',event=>{
  if(!dialog.open||!unsaved()||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  const link=event.target instanceof Element?event.target.closest<HTMLAnchorElement>('a[href]'):null;
  if(!link||link.target==='_blank'||link.hasAttribute('download'))return;
  const url=new URL(link.href,location.href);if(!['http:','https:'].includes(url.protocol)||url.href===location.href)return;
  event.preventDefault();leave(url.href);
 },true);
 addEventListener('beforeunload',event=>{if(dialog.open&&unsaved()){event.preventDefault();event.returnValue=''}});
 return{dialog,get result(){return result},
  show(finalScore?:number,gameId?:string){
   if(discarded)return;
   if(!result){if(finalScore===undefined)return;result=captureGameResult(finalScore,gameId)}
   scorePage.render(result);setView('result');
   if(result.points<10)dialog.setAttribute('aria-describedby','rewards-score rewards-low-copy');
  },
  discard(){discarded=true;result=null},
  clear(){dialog.close();result=null;discarded=false;destination='/'},
 };
}
