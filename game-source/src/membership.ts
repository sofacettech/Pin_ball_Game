import type {Player} from './leaderboard';
import type {CompletedGameResult} from './post-game-rewards';

type Options={beforeOpen:()=>void;afterClose:(completed:boolean,returnToScore:boolean)=>void;refreshPlayer:()=>Promise<void>;onReplay:()=>void;onLeaderboard:()=>void;onDiscard:()=>void;pendingResult:()=>CompletedGameResult|null};

export function connectMembership(options:Options){
 const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
 const dialog=$<HTMLDialogElement>('registration-dialog'),frame=$<HTMLIFrameElement>('registration-frame');
 const member=$<HTMLButtonElement>('member'),menuMember=$<HTMLButtonElement>('menu-member');
 const historyHost=window.top!,timeline=historyHost.history;
 let player:Player|null=null,checking=true,completed=false,opener:HTMLElement=$('nav-toggle');
 let pendingReward:CompletedGameResult|null=null;
 let joinHistory=false,pendingClose:{returnToScore:boolean;after?:()=>void}|null=null;
 frame.addEventListener('load',()=>{if(dialog.open&&pendingReward)frame.contentWindow?.postMessage({type:'sofacet:pending-reward',result:pendingReward},location.origin)});

 function paint(){member.hidden=menuMember.hidden=player?.member!==true}
 function updatePlayer(next:Player|null){checking=false;player=next;paint()}
 async function open(source:HTMLElement=$('nav-toggle'),pending:CompletedGameResult|null=null,verify=false){
  if(dialog.open)return;
  if(checking||!player){checking=true;paint();await options.refreshPlayer();if(dialog.open||!player)return}
  if(player.member&&!verify){options.onLeaderboard();return}
  opener=source;pendingReward=pending??options.pendingResult();completed=false;options.beforeOpen();
  const route=verify?'/sign-in':pendingReward?'/claim':'/join';
  timeline.pushState({...timeline.state,sofacetJoin:true},'',route);joinHistory=true;
  frame.contentWindow!.location.replace(verify?'/join?nav=game&verify=1':route+'?nav=game');dialog.showModal();document.body.classList.add('membership-open');
 }
 function finishClose(returnToScore=false,after?:()=>void){
  if(!dialog.open)return;
  dialog.close();frame.remove();dialog.append(frame);pendingReward=null;document.body.classList.remove('membership-open');
  (!opener.isConnected||opener.hidden||opener.closest('[hidden],[inert]')?$('nav-toggle'):opener).focus();
  options.afterClose(completed,returnToScore);
  after?.();
 }
 function close(returnToScore=false,after?:()=>void){
  if(!dialog.open)return;
  // Consume the modal history step before resuming/replaying the game.
  if(joinHistory){if(!pendingClose){pendingClose={returnToScore,after};timeline.back();}return;}
  finishClose(returnToScore,after);
 }
 const restoreMembership=(event:PopStateEvent)=>{
  if(!joinHistory||event.state?.sofacetJoin)return;
  joinHistory=false;const requested=pendingClose;pendingClose=null;
  finishClose(requested?.returnToScore??true,requested?.after??(completed?options.onLeaderboard:undefined));
 };
 historyHost.addEventListener('popstate',restoreMembership);
 window.addEventListener('pagehide',event=>{if(!event.persisted)historyHost.removeEventListener('popstate',restoreMembership)});
 member.onclick=()=>open(member);menuMember.onclick=()=>open(menuMember);
 const requestExit=()=>{if(joinHistory){close(true);return;}frame.contentWindow?.postMessage({type:'sofacet:request-exit'},location.origin);};
 dialog.oncancel=event=>{event.preventDefault();requestExit()};
 dialog.addEventListener('click',event=>{
  if(event.target!==dialog)return;
  const rect=dialog.getBoundingClientRect();
  if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)requestExit();
 });
 window.addEventListener('message',async event=>{
  if(!dialog.open||event.origin!==location.origin||event.source!==frame.contentWindow)return;
  if(event.data?.type==='sofacet:screen-route'&&['/claim','/join','/sign-in','/verify','/coins-saved'].includes(event.data.href)){
   timeline.replaceState({...timeline.state},'',event.data.href);return;
  }
  if(event.data?.type==='sofacet:membership-ready'&&pendingReward){frame.contentWindow?.postMessage({type:'sofacet:pending-reward',result:pendingReward},location.origin);return}
  if(event.data?.type==='contest-registration:close'){close(event.data.returnToScore===true&&pendingReward!==null,completed?options.onLeaderboard:undefined);return}
  if(event.data?.type==='sofacet:reward-discarded'){pendingReward=null;options.onDiscard();return}
  if(event.data?.type==='sofacet:membership-replay'){close(false,options.onReplay);return}
  if(event.data?.type==='sofacet:membership-existing'){
   await options.refreshPlayer();
   if(dialog.open&&player?.member){completed=true;close(false,options.onLeaderboard)}
   return;
  }
  if(event.data?.type==='contest-registration:complete'&&!completed){
   const next=event.data.player;
   if(next?.member===true&&typeof next.display_name==='string'){
    completed=true;pendingReward=null;updatePlayer(next as Player);await options.refreshPlayer();
   }
  }
 });
 paint();
 return {updatePlayer,open,close,isMember:()=>player?.member};
}
