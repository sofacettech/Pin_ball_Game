(()=>{
 if(window.sofacetCookiePreferences)return;
 const key='sofacet-cookie-preferences';
 const defaults=()=>({essential:true,analytics:false,advertising:false});
 function read(){
  try{const value=JSON.parse(localStorage.getItem(key));if(value?.version===1&&Number.isFinite(value.expires)&&value.expires>Date.now()&&typeof value.analytics==='boolean'&&typeof value.advertising==='boolean')return value}catch{}
  return null;
 }
 let saved=read(),choice=saved||defaults(),settingsOpen=false,persisted=true,opener,render=()=>{};
 const landing=['/','/index.html','/entrance-3d','/entrance-3d/','/entrance-3d.html','/video','/video/'].includes(window.location?.pathname||'/');
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
 function paint(){render({showNotice:landing&&!saved&&!settingsOpen,settingsOpen,choice,persisted,open,close,save})}
 function open(){
  if(window.top!==window){try{return window.top.sofacetCookiePreferences.open()}catch{return}}
  if(settingsOpen)return;
  opener=document.activeElement;settingsOpen=true;modalState(true);paint();
 }
 function close(){
  if(!settingsOpen)return;
  settingsOpen=false;modalState(false);paint();
  if(opener?.isConnected)opener.focus({preventScroll:true});
 }
 function save(analytics,advertising){
  const expires=new Date();expires.setFullYear(expires.getFullYear()+1);
  choice={version:1,essential:true,analytics,advertising,expires:expires.getTime()};
  persisted=true;
  try{localStorage.setItem(key,JSON.stringify(choice))}catch{persisted=false}
  saved=choice;publish();
  if(settingsOpen&&persisted)close();else paint();
 }
 window.sofacetCookiePreferences={open,allows:category=>category==='essential'||['analytics','advertising'].includes(category)&&choice[category]===true,mount(renderer){render=renderer;paint()}};
 publish();
 window.addEventListener('storage',event=>{if(event.key===key||event.key===null){saved=read();choice=saved||defaults();persisted=true;publish();paint()}});
 document.addEventListener('click',event=>{
  const link=event.target instanceof Element?event.target.closest('[data-cookie-settings]'):null;
  if(link&&!event.defaultPrevented&&event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.altKey&&!event.shiftKey){event.preventDefault();open()}
 },true);
})();
