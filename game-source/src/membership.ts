import {setBrandText} from '../../shared/brand-text.ts';
import type {Player} from './leaderboard';
import type {CompletedGameResult} from './post-game-rewards';
import {validPublicName} from './player-copy';

type Options={beforeOpen:()=>void;afterClose:(completed:boolean)=>void;refreshPlayer:()=>Promise<void>;onReplay:()=>void;onLeaderboard:()=>void;onDiscard:()=>void;pendingResult:()=>CompletedGameResult|null};

export function connectMembership(options:Options){
 const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
 const dialog=$<HTMLDialogElement>('registration-dialog'),frame=$<HTMLIFrameElement>('registration-frame');
 const profile=$<HTMLButtonElement>('profile'),profileMenu=$('profile-menu'),profileArea=$('profile-navigation');
 const profileMember=$<HTMLButtonElement>('profile-member'),profileRetry=$<HTMLButtonElement>('profile-retry');
 const member=$<HTMLButtonElement>('member'),menuMember=$<HTMLButtonElement>('menu-member');
 const edit=$<HTMLButtonElement>('profile-edit'),editForm=$<HTMLFormElement>('profile-edit-form'),editName=$<HTMLInputElement>('profile-display-name'),editStatus=$('profile-edit-status'),editSave=$<HTMLButtonElement>('profile-save');
 let profileUpdateUrl:string|null=null,editing=false;
 let player:Player|null=null,checking=true,completed=false,opener:HTMLElement=profile;
 let pendingReward:CompletedGameResult|null=null;
 frame.addEventListener('load',()=>{if(dialog.open&&pendingReward)frame.contentWindow?.postMessage({type:'sofacet:pending-reward',result:pendingReward},location.origin)});

 function paint(){
  const registered=player?.member===true,guest=player?.member===false;
  profile.classList.toggle('is-member',registered);
  profile.setAttribute('aria-label',registered?'Profile for '+player!.display_name:'Profile');
  profile.title='Profile';
  $('profile-name').textContent=registered?player!.display_name:'Your profile';
  setBrandText($('profile-status'),checking?'Checking your membership…':registered?'Your So/Facet membership is active.':guest?'Become a So/Facet member and keep playing.':'We couldn’t load your membership. Please try again.');
  profileMember.hidden=!guest;profileRetry.hidden=checking||player!==null;
  edit.hidden=!registered;
  if(!registered){editing=false;editForm.hidden=true}
  member.hidden=menuMember.hidden=!player;
  member.textContent=menuMember.textContent=registered?'Leaderboard':'Become a member';
 }
 function updatePlayer(next:Player|null){checking=false;player=next;paint()}
 function closeProfile(restoreFocus=false){if(editing)return;profileMenu.hidden=true;profile.setAttribute('aria-expanded','false');if(restoreFocus)profile.focus()}
 function showProfile(){
  if(!profileMenu.hidden){closeProfile(true);return}
  profileMenu.hidden=false;profile.setAttribute('aria-expanded','true');
  (profileMember.hidden?profileRetry.hidden?$('profile-close'):profileRetry:profileMember).focus();
 }
 async function open(source:HTMLElement=profile,pending:CompletedGameResult|null=null){
  if(dialog.open)return;
  if(checking||!player){checking=true;paint();await options.refreshPlayer();if(dialog.open||!player)return}
  if(player.member){closeProfile();options.onLeaderboard();return}
  opener=source;pendingReward=pending??options.pendingResult();completed=false;closeProfile();options.beforeOpen();
  frame.src='/membership.html';dialog.showModal();document.body.classList.add('membership-open');
 }
 function close(){
  if(!dialog.open)return;
  dialog.close();frame.removeAttribute('src');pendingReward=null;document.body.classList.remove('membership-open');
  (opener.hidden||opener.closest('[hidden],[inert]')?$('nav-toggle'):opener).focus();
  options.afterClose(completed);
 }
 profile.onclick=showProfile;
 $('profile-close').onclick=()=>closeProfile(true);
 profileMember.onclick=()=>open(profile);
 member.onclick=()=>open(member);menuMember.onclick=()=>open(menuMember);
 profileRetry.onclick=async()=>{checking=true;paint();await options.refreshPlayer()};
 const requestExit=()=>frame.contentWindow?.postMessage({type:'sofacet:request-exit'},location.origin);
 dialog.oncancel=event=>{event.preventDefault();requestExit()};
 dialog.addEventListener('click',event=>{
  if(event.target!==dialog)return;
  const rect=dialog.getBoundingClientRect();
  if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)requestExit();
 });
 document.addEventListener('pointerdown',event=>{if(!profileMenu.hidden&&!profileArea.contains(event.target as Node))closeProfile()});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!profileMenu.hidden){event.preventDefault();event.stopPropagation();closeProfile(true)}});
 window.addEventListener('message',async event=>{
  if(!dialog.open||event.origin!==location.origin||event.source!==frame.contentWindow)return;
  if(event.data?.type==='sofacet:membership-ready'&&pendingReward){frame.contentWindow?.postMessage({type:'sofacet:pending-reward',result:pendingReward},location.origin);return}
  if(event.data?.type==='contest-registration:close'){close();return}
  if(event.data?.type==='sofacet:reward-discarded'){pendingReward=null;options.onDiscard();return}
  if(event.data?.type==='sofacet:membership-replay'){close();options.onReplay();return}
  if(event.data?.type==='sofacet:membership-existing'){
   await options.refreshPlayer();
   if(dialog.open&&player?.member){completed=true;close();options.onLeaderboard()}
   return;
  }
  if(event.data?.type==='contest-registration:complete'&&!completed){
   const next=event.data.player;
   if(next?.member===true&&typeof next.display_name==='string'){
    completed=true;updatePlayer(next as Player);close();await options.refreshPlayer();options.onLeaderboard();
   }
  }
 });
 edit.onclick=async()=>{
  editForm.hidden=false;editName.value=player?.display_name||'';editName.setAttribute('aria-invalid','false');editStatus.textContent='Checking name changes…';editSave.disabled=true;editName.focus();
  try{
   const response=await fetch('/api/membership/config',{signal:AbortSignal.timeout(10000)}),config=await response.json();
   const url=typeof config.profileUpdateUrl==='string'?new URL(config.profileUpdateUrl,location.origin):null;
   profileUpdateUrl=response.ok&&url?.origin===location.origin&&url.pathname.startsWith('/api/')?url.href:null;
  }catch{profileUpdateUrl=null}
  if(editForm.hidden)return;
  editSave.disabled=false;
  editStatus.textContent=profileUpdateUrl?'Your public name appears with your score and rank. Changes may be reviewed.':'Name changes are coming soon. Your current name has not changed.';
 };
 $('profile-edit-cancel').onclick=()=>{if(!editing){editForm.hidden=true;edit.focus()}};
 editForm.onsubmit=async event=>{
  event.preventDefault();if(editing||!player?.member)return;
  if(!validPublicName(editName.value)){editName.setAttribute('aria-invalid','true');editStatus.textContent='Choose a name using letters (up to 30 characters).';editName.focus();return}
  editName.setAttribute('aria-invalid','false');
  if(!profileUpdateUrl){editStatus.textContent='Name changes are coming soon. Your current name has not changed.';return}
  editing=true;editSave.disabled=editName.disabled=true;editStatus.textContent='Saving your name…';
  try{
   const response=await fetch(profileUpdateUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({leaderboardName:editName.value.trim()}),signal:AbortSignal.timeout(30000)}),result=await response.json();
   if(!response.ok||result.success!==true||!['saved','pending'].includes(result.status))throw Error(result.message||'Your name was not changed. Please try again.');
   if(result.status==='saved'){await options.refreshPlayer();if(player?.display_name!==editName.value.trim())throw Error('Your updated name could not be confirmed. Please refresh your profile.');editStatus.textContent='Your leaderboard name was updated.'}
   else editStatus.textContent='Your name was submitted for review. Your current name stays visible until it is approved.';
  }catch(error){editStatus.textContent=error instanceof Error?error.message:'Your name was not changed. Please try again.'}
  finally{editing=false;editSave.disabled=editName.disabled=false}
 };
 paint();
 return {updatePlayer,open,close,isMember:()=>player?.member};
}
