import {mountScorePage} from './score-page.jsx';
import './post-game-rewards.css';
import {leaveCopy} from './player-copy';

export type CompletedGameResult=Readonly<{points:number;rewardValue:number;completedAt:number;status:'completed';gameId?:string}>;
export function captureGameResult(finalScore:number,gameId?:string):CompletedGameResult{
 const whole=Math.trunc(finalScore),points=Number.isSafeInteger(whole)?Math.max(0,whole):0;
 return Object.freeze({points,rewardValue:points/10,completedAt:Date.now(),status:'completed',gameId});
}
export function connectPostGameRewards(onRegister:(result:CompletedGameResult,opener:HTMLElement)=>void,onRetry:()=>void,onLeaderboard:()=>void=()=>{}){
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
  if(view==='result')scorePage.render(result!);else scorePage.clear();
  const heading=views[view].querySelector<HTMLElement>('h1')!;
  dialog.setAttribute('aria-labelledby',heading.id);
  dialog.setAttribute('aria-describedby',view==='result'?(result!.points<10?'rewards-score rewards-low-copy':'rewards-score rewards-value-line rewards-expiry'):view==='leave'?'rewards-leave-copy':'rewards-exit-copy');
  resize.disconnect();if(!dialog.open){dialog.prepend(header);dialog.showModal()}resize.observe(views[view]);placeFloor();heading.focus({preventScroll:true});
 }
 function register(){if(!result){dialog.close();return}if(result){const opener=$(current==='leave'?'rewards-keep':'rewards-register');dialog.close();onRegister(result,opener)}}
 function replay(){discarded=true;dialog.close();onRetry()}
 function world(){discarded=true;window.top!.location.assign(destination)}
 function leave(href='/'){
  destination=href;
  if(!unsaved()){world();return}
  const copy=leaveCopy(result?.points??0);$('rewards-leave-title').textContent=copy.title;$('rewards-leave-copy').textContent=copy.support;setView('leave');
 }
 dialog.addEventListener('close',()=>{if(dialog.open)return;resize.disconnect();scorePage.clear?.();if(toggle.getAttribute('aria-expanded')==='true')toggle.click();document.body.prepend(header)});
 $('rewards-keep').onclick=register;
 $('rewards-leave-anyway').onclick=()=>{discarded=true;setView('exit')};$('rewards-exit-play').onclick=replay;$('rewards-exit-world').onclick=world;
 $('rewards-close').onclick=()=>current==='leave'?(result?setView('result'):dialog.close()):current==='exit'?world():leave();
 dialog.addEventListener('sofacet:page-ready',()=>{if(dialog.open&&current==='result'&&toggle.getAttribute('aria-expanded')!=='true')views.result.querySelector<HTMLElement>('h1')!.focus({preventScroll:true})});
 dialog.oncancel=event=>{event.preventDefault();if(current==='leave'){if(result)setView('result');else dialog.close()}else if(current==='result')leave()};
 document.addEventListener('click',event=>{
  if(!dialog.open||!unsaved()||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  const link=event.target instanceof Element?event.target.closest<HTMLAnchorElement>('a[href]'):null;
  if(!link||link.id==='skip-game'||link.target==='_blank'||link.hasAttribute('download'))return;
  const url=new URL(link.href,location.href);if(!['http:','https:'].includes(url.protocol)||url.href===location.href)return;
  event.preventDefault();leave(url.href);
 },true);
 addEventListener('beforeunload',event=>{if(dialog.open&&unsaved()){event.preventDefault();event.returnValue=''}});
 return{dialog,skip(href:string){destination=href;world()},get result(){return result},
  show(finalScore?:number,gameId?:string){
   if(discarded)return;
   if(!result){if(finalScore===undefined)return;result=captureGameResult(finalScore,gameId)}
   setView('result');
  },
  discard(){discarded=true;result=null},
  clear(){dialog.close();result=null;discarded=false;destination='/'},
 };
}
