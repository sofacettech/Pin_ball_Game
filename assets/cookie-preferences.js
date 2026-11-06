(()=>{
 if(window.sofacetCookiePreferences)return;
 const key='sofacet-cookie-preferences',policy='/privacy.html#privacy-9-cookies-pixels-and-similar-technologies';
 const defaults=()=>({essential:true,analytics:false,advertising:false});
 function read(){
  try{const value=JSON.parse(localStorage.getItem(key));if(value?.version===1&&Number.isFinite(value.expires)&&value.expires>Date.now()&&typeof value.analytics==='boolean'&&typeof value.advertising==='boolean')return value}catch{}
  return null;
 }
 let saved=read(),choice=saved||defaults(),banner,dialog,opener;
 try{if(window.top!==window)document.documentElement.dataset.cookieSettingsOpen=window.top.document.documentElement.dataset.cookieSettingsOpen||'false'}catch{}
 function modalState(open,scope=window){
  scope.document.documentElement.dataset.cookieSettingsOpen=String(open);
  scope.dispatchEvent(new scope.CustomEvent('sofacet:cookie-settings',{detail:{open}}));
  for(const frame of scope.document.querySelectorAll('iframe')){try{modalState(open,frame.contentWindow)}catch{}}
 }
 function publish(){
  document.documentElement.dataset.analytics=String(choice.analytics);
  document.documentElement.dataset.advertising=String(choice.advertising);
  window.dispatchEvent(new CustomEvent('sofacet:cookie-preferences',{detail:{...choice,essential:true}}));
 }
 function open(){
  if(window.top!==window){try{return window.top.sofacetCookiePreferences.open()}catch{return}}
  if(!dialog)return;
  opener=document.activeElement;
  dialog.querySelector('[name="analytics"]').checked=choice.analytics;
  dialog.querySelector('[name="advertising"]').checked=choice.advertising;
  dialog.querySelector('[role="status"]').textContent='';
  dialog.showModal();
  modalState(true);
 }
 function save(analytics,advertising){
  const expires=new Date();expires.setFullYear(expires.getFullYear()+1);
  choice={version:1,essential:true,analytics,advertising,expires:expires.getTime()};
  let persisted=true;
  try{localStorage.setItem(key,JSON.stringify(choice))}catch{persisted=false}
  saved=choice;publish();banner.hidden=true;
  if(dialog.open){
   if(persisted)dialog.close();
   else dialog.querySelector('[role="status"]').textContent='Your choice applies to this page. Your browser could not save it for future visits.';
  }
 }
 window.sofacetCookiePreferences={open,allows:category=>category==='essential'||['analytics','advertising'].includes(category)&&choice[category]===true};
 publish();
 window.addEventListener('storage',event=>{if(event.key===key||event.key===null){saved=read();choice=saved||defaults();publish();if(banner)banner.hidden=!!saved}});
 document.addEventListener('click',event=>{
  const link=event.target instanceof Element?event.target.closest('[data-cookie-settings]'):null;
  if(link&&!event.defaultPrevented&&event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.altKey&&!event.shiftKey){event.preventDefault();open()}
 },true);
 function mount(){
  if(window.top!==window)return;
  banner=document.createElement('section');banner.id='sf-cookie-notice';banner.setAttribute('aria-label','Cookie choices');banner.hidden=!!saved;
  banner.innerHTML=`<div><h2>Your cookie choices</h2><p>Essential cookies keep the website, game and sign-in working. Choose whether to allow optional analytics and advertising. <a href="${policy}">Privacy Policy</a></p></div><div class="sf-cookie-actions"><button type="button" data-reject>Essential only</button><button type="button" data-manage>Cookie settings</button><button type="button" data-accept>Accept all</button></div>`;
  dialog=document.createElement('dialog');dialog.id='sf-cookie-settings';dialog.setAttribute('aria-labelledby','sf-cookie-title');dialog.setAttribute('aria-describedby','sf-cookie-description');
  dialog.innerHTML=`<button class="sf-cookie-close" type="button" aria-label="Close cookie settings">×</button><h2 id="sf-cookie-title">Cookie preferences</h2><p id="sf-cookie-description">Choose what you allow. You can change your choices through Cookie settings in the menu or FAQ footer.</p><form><label><input type="checkbox" checked disabled><span><strong>Essential — always on</strong><small>Game settings, sign-in, security and your cookie choices.</small></span></label><label><input name="analytics" type="checkbox"><span><strong>Analytics</strong><small>Help us understand how the website is used.</small></span></label><label><input name="advertising" type="checkbox"><span><strong>Advertising</strong><small>Measure advertising and personalise ads.</small></span></label><p>Optional analytics and advertising are not currently in use.</p><p><a href="${policy}">Read our Privacy Policy</a></p><div class="sf-cookie-actions"><button type="button" data-reject>Essential only</button><button type="submit">Save preferences</button></div><p role="status" aria-live="polite"></p></form>`;
  document.body.append(banner,dialog);
  banner.querySelector('[data-manage]').onclick=open;
  banner.querySelector('[data-accept]').onclick=()=>save(true,true);
  banner.querySelector('[data-reject]').onclick=()=>save(false,false);
  dialog.querySelector('[data-reject]').onclick=()=>save(false,false);
  dialog.querySelector('.sf-cookie-close').onclick=()=>dialog.close();
  dialog.querySelector('form').onsubmit=event=>{event.preventDefault();save(dialog.querySelector('[name="analytics"]').checked,dialog.querySelector('[name="advertising"]').checked)};
  dialog.addEventListener('keydown',event=>event.stopPropagation());
  dialog.addEventListener('close',()=>{
   modalState(false);
   if(opener?.isConnected)opener.focus({preventScroll:true});
  });
 }
 document.readyState==='loading'?document.addEventListener('DOMContentLoaded',mount,{once:true}):mount();
})();
