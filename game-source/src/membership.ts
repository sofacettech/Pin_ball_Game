import type {Player} from './leaderboard';

type Options={beforeOpen:()=>void;afterClose:(completed:boolean)=>void;refreshPlayer:()=>Promise<void>};

export function connectMembership(options:Options){
 const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
 const dialog=$<HTMLDialogElement>('registration-dialog'),frame=$<HTMLIFrameElement>('registration-frame');
 const profile=$<HTMLButtonElement>('profile'),profileMenu=$('profile-menu'),profileArea=$('profile-navigation');
 const profileMember=$<HTMLButtonElement>('profile-member'),profileRetry=$<HTMLButtonElement>('profile-retry');
 const member=$<HTMLButtonElement>('member'),menuMember=$<HTMLButtonElement>('menu-member');
 let player:Player|null=null,checking=true,completed=false,opener:HTMLElement=profile;

 function paint(){
  const registered=player?.member===true,guest=player?.member===false;
  profile.classList.toggle('is-member',registered);
  profile.setAttribute('aria-label',registered?'Profile for '+player!.display_name:'Profile');
  profile.title='Profile';
  $('profile-name').textContent=registered?player!.display_name:'Your profile';
  $('profile-status').textContent=checking?'Checking your membership…':registered?'Your So/Facet membership is active.':guest?'Become a So/Facet member and keep playing.':'We couldn’t load your membership. Please try again.';
  profileMember.hidden=!guest;profileRetry.hidden=checking||player!==null;
  member.hidden=!guest;menuMember.hidden=!guest;
  member.textContent=menuMember.textContent='Become a member';
 }
 function updatePlayer(next:Player|null){checking=false;player=next;paint()}
 function closeProfile(restoreFocus=false){profileMenu.hidden=true;profile.setAttribute('aria-expanded','false');if(restoreFocus)profile.focus()}
 function showProfile(){
  if(!profileMenu.hidden){closeProfile(true);return}
  profileMenu.hidden=false;profile.setAttribute('aria-expanded','true');
  (profileMember.hidden?profileRetry.hidden?$('profile-close'):profileRetry:profileMember).focus();
 }
 function open(source:HTMLElement=profile){
  if(dialog.open)return;
  if(player?.member){showProfile();return}
  opener=source;completed=false;closeProfile();options.beforeOpen();
  frame.src='/membership.html';dialog.showModal();document.body.classList.add('membership-open');
 }
 function close(){
  if(!dialog.open)return;
  dialog.close();frame.removeAttribute('src');document.body.classList.remove('membership-open');
  (opener.hidden||opener.closest('[hidden],[inert]')?$('nav-toggle'):opener).focus();
  options.afterClose(completed);
 }
 profile.onclick=showProfile;
 $('profile-close').onclick=()=>closeProfile(true);
 profileMember.onclick=()=>open(profile);
 member.onclick=()=>open(member);menuMember.onclick=()=>open(menuMember);
 profileRetry.onclick=async()=>{checking=true;paint();await options.refreshPlayer()};
 dialog.oncancel=event=>{event.preventDefault();close()};
 dialog.addEventListener('click',event=>{
  if(event.target!==dialog)return;
  const rect=dialog.getBoundingClientRect();
  if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)close();
 });
 document.addEventListener('pointerdown',event=>{if(!profileMenu.hidden&&!profileArea.contains(event.target as Node))closeProfile()});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!profileMenu.hidden){event.preventDefault();event.stopPropagation();closeProfile(true)}});
 window.addEventListener('message',event=>{
  if(!dialog.open||event.origin!==location.origin||event.source!==frame.contentWindow)return;
  if(event.data?.type==='contest-registration:close'){close();return}
  if(event.data?.type==='contest-registration:complete'&&!completed){
   completed=true;
   const next=event.data.player;
   if(next?.member===true&&typeof next.display_name==='string')updatePlayer(next as Player);
   void options.refreshPlayer();
  }
 });
 paint();
 return {updatePlayer,open,close,isMember:()=>player?.member===true};
}
