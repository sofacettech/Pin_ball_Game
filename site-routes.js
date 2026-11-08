// Public addresses share the existing documents and screen controllers.
export const routeDocuments=Object.freeze({
 '/':'entrance-3d.html','/game':'play.html','/leaderboard':'play.html','/reward':'play.html',
 '/claim':'membership.html','/sign-in':'account.html','/join':'membership.html','/verify':'membership.html',
 '/coins-saved':'membership.html','/my-coins':'account.html','/exit':'play.html',
 '/launch':'launching-soon.html','/notify':'notify.html','/confirmation':'first-cuts-confirmation.html',
 '/about':'about.html','/how-coins-work':'faq.html','/contact':'faq.html',
 '/terms':'terms.html','/privacy':'privacy.html','/404':'404.html',
});
const legacy={
 '/index.html':'/','/entrance-3d.html':'/','/entrance-3d':'/',
 '/play.html':'/game','/membership.html':'/join','/account.html':'/my-coins',
 '/launching-soon.html':'/launch','/notify.html':'/notify','/first-cuts-confirmation.html':'/confirmation',
 '/about.html':'/about','/faq.html':'/how-coins-work','/terms.html':'/terms','/privacy.html':'/privacy','/404.html':'/404',
};
export function canonicalHref(href){
 if(typeof href!=='string'||!href.startsWith('/')||href.startsWith('//'))return href;
 const url=new URL(href,'http://site.local');
 const path=url.pathname.replace(/\/$/,'')||'/';
 url.pathname=legacy[path]||path;
 if(url.pathname==='/game'&&url.hash==='#leaderboard'){url.pathname='/leaderboard';url.hash='';}
 if(url.pathname==='/game'&&url.hash==='#profile'){url.pathname='/my-coins';url.hash='';}
 if(url.pathname==='/how-coins-work'&&['#contact','#topic-contact','#faq-contact'].includes(url.hash)){url.pathname='/contact';url.hash='';}
 if(path==='/membership.html'){
  if(url.searchParams.get('from')==='score')url.pathname='/claim';
  if(url.searchParams.get('verify')==='1')url.pathname='/sign-in';
 }
 if(path==='/account.html'&&url.searchParams.get('view')==='signin')url.pathname='/sign-in';
 if(['/join','/claim'].includes(url.pathname)&&['collective','first-cuts','score'].includes(url.searchParams.get('from')))url.searchParams.delete('from');
 if(url.pathname==='/sign-in'){url.searchParams.delete('view');url.searchParams.delete('verify');}
 return url.pathname+url.search+url.hash;
}

export function setScreenRoute(href,{replace=true}={}){
 const route=canonicalHref(href),host=window.top;
 if(window!==host&&(window.name==='sofacet-game-info'||window.frameElement?.id==='registration-frame')){
  const local=new URL(route,location.origin);local.searchParams.set('nav','game');
  history.replaceState(history.state,'',local.pathname+local.search+local.hash);
  parent.postMessage({type:'sofacet:screen-route',href:route},location.origin);return;
 }
 if(host.location.pathname+host.location.search+host.location.hash===route)return;
 host.history[replace?'replaceState':'pushState']({...host.history.state},'',route);
}
// Only presentation context is kept. Authentication and reward credits remain server-verified.
export function readScreenData(key){try{return JSON.parse(sessionStorage.getItem('sofacet-screen-'+key)||'null')}catch{return null}}
export function writeScreenData(key,value){try{if(value===null)sessionStorage.removeItem('sofacet-screen-'+key);else sessionStorage.setItem('sofacet-screen-'+key,JSON.stringify(value))}catch{}}
