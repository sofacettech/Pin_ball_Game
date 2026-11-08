import {mountScorePage} from './score-page.jsx';
import {mountRewardNoticeArtwork} from '../../collective-source/artwork/RewardNoticeArtwork.jsx';
import './post-game-rewards.css';
import '../../collective-source/reward-notice.css';
import {leaveCopy} from './player-copy';
import {setScreenRoute,writeScreenData} from '../../site-routes.js';

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
 const showNoticeArtwork=mountRewardNoticeArtwork($('reward-notice-art'));
 const unsaved=()=>!!result&&result.points>=10&&!discarded;
 const placeFloor=()=>{if(current==='result')return;const actions=views[current].querySelector<HTMLElement>('.rewards-actions')!;if(dialog.open)dialog.style.setProperty('--rewards-floor-top',actions.offsetTop+actions.offsetHeight+12+'px')};
 const resize=new ResizeObserver(placeFloor);
 function setView(view:keyof typeof views){
  if(view!=='leave')setScreenRoute(view==='result'?'/reward':'/exit',{replace:false});
  current=view;dialog.dataset.view=view;for(const [key,element] of Object.entries(views))element.hidden=key!==view;
  showNoticeArtwork(view==='result'?null:view);
  if(view==='result')scorePage.render(result!);else scorePage.clear();
  const heading=views[view].querySelector<HTMLElement>('h1')!;
  dialog.setAttribute('aria-labelledby',heading.id);
  dialog.setAttribute('aria-describedby',view==='result'?(result!.points<10?'rewards-score rewards-low-copy':'rewards-score rewards-value-line rewards-expiry'):view==='leave'?'rewards-leave-copy':'rewards-exit-copy');
  resize.disconnect();if(!dialog.open){dialog.prepend(header);dialog.showModal()}
  dialog.scrollTop=0;
  resize.observe(views[view]);placeFloor();heading.focus({preventScroll:true});
 }
 function register(){if(!result){dialog.close();return}if(result){const opener=$(current==='leave'?'rewards-keep':'rewards-register');dialog.close();onRegister(result,opener)}}
 function replay(){discarded=true;dialog.close();onRetry()}
 function world(){discarded=true;window.top!.location.assign(destination)}
 function leave(href='/'){
  destination=href;
  if(!unsaved()){world();return}
  const copy=leaveCopy(result?.points??0);$('rewards-leave-title').textContent=copy.title;$('rewards-leave-copy').textContent=copy.support;setView('leave');
 }
 dialog.addEventListener('close',()=>{if(dialog.open)return;resize.disconnect();scorePage.clear?.();showNoticeArtwork(null);if(toggle.getAttribute('aria-expanded')==='true')toggle.click();document.body.prepend(header)});
 $('rewards-keep').onclick=register;
 $('rewards-leave-anyway').onclick=()=>{discarded=true;writeScreenData('reward',null);setView('exit')};$('rewards-exit-play').onclick=replay;$('rewards-exit-world').onclick=world;
 $('rewards-close').onclick=()=>current==='leave'?(result?setView('result'):dialog.close()):current==='exit'?world():leave();
 dialog.addEventListener('sofacet:page-ready',()=>{if(dialog.open&&current==='result'&&toggle.getAttribute('aria-expanded')!=='true')views.result.querySelector<HTMLElement>('h1')!.focus({preventScroll:true})});
 dialog.oncancel=event=>{event.preventDefault();if(current==='leave'){if(result)setView('result');else dialog.close()}else if(current==='result')leave()};
 document.addEventListener('click',event=>{
  if(!dialog.open||!unsaved()||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  const link=event.target instanceof Element?event.target.closest<HTMLAnchorElement>('a[href]'):null;
  if(!link||link.target==='_blank'||link.hasAttribute('download')||link.hasAttribute('data-game-info'))return;
  const url=new URL(link.href,location.href);if(!['http:','https:'].includes(url.protocol)||url.href===location.href)return;
  event.preventDefault();leave(url.href);
 },true);
 addEventListener('beforeunload',event=>{if(dialog.open&&unsaved()){event.preventDefault();event.returnValue=''}});
 return{dialog,get result(){return discarded?null:result},
  show(finalScore?:number,gameId?:string){
   if(discarded)return;
   if(!result){if(finalScore===undefined)return;result=captureGameResult(finalScore,gameId);writeScreenData('reward',result)}
   setView('result');
  },
  showExit(){discarded=true;setView('exit')},
  discard(){discarded=true;result=null;writeScreenData('reward',null)},
  clear(){dialog.close();result=null;discarded=false;destination='/';writeScreenData('reward',null);setScreenRoute('/game')},
 };
}
