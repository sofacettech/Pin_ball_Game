import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {withGameLoader} from '../scripts/game-loader-shell.mjs';
const source=readFileSync(new URL('../loader-source/controller.js',import.meta.url),'utf8').replace('export function','function');
function loader({reduced=false,embedded=false,managed=false}={}){
 const timers=new Map(),renders=[],reports=[];let id=0;
 const node=()=>({hidden:false,dataset:{},style:{setProperty(){}},firstChild:{textContent:''},setAttribute(name,value){this[name]=value}});
 const root=node(),stage=node(),error=node(),status=node(),cards=node(),retry=node(),rootEvents=new EventTarget();
 root.addEventListener=rootEvents.addEventListener.bind(rootEvents);root.dispatchEvent=rootEvents.dispatchEvent.bind(rootEvents);root.hasAttribute=name=>managed&&name==='data-managed';stage.inert=true;stage.dataset.ready='false';
 root.querySelector=selector=>({'#game-loader-cards-root':cards,'.loading-copy':status,'.game-loading-error':error,'[data-game-retry]':retry}[selector]);
 const document=new EventTarget(),window=new EventTarget();document.body={hasAttribute:name=>!managed&&name==='data-game-loading',removeAttribute(){}};document.hidden=false;
 document.getElementById=id=>({'game-loading-screen':root,stage,'game-loader-controller':{dataset:{gameEntry:''}}}[id]);document.querySelectorAll=selector=>selector==='#stage'?[stage]:[];
 const context={CustomEvent,window,document,parent:embedded?{}:window,location:{origin:'http://localhost',href:'http://localhost/play.html'},URL,matchMedia:()=>({matches:reduced}),AbortController,ResizeObserver:class{observe(){}disconnect(){}},visualViewport:null,addEventListener:window.addEventListener.bind(window),requestAnimationFrame:()=>++id,setTimeout:(callback,duration)=>{const key=++id;timers.set(key,{callback,duration});return key},clearTimeout:key=>timers.delete(key),console:{error(){}},fetch:async(url,options)=>reports.push({url,...options}),renderCards:(element,active)=>renders.push({element,active})};
 vm.runInNewContext(source+';installGameLoader(renderCards)',context);
 return{api:window.sofacetGameLoader,root,stage,error,status,renders,reports,document,window,timers,flushFade(){for(const [key,timer]of timers)if(timer.duration<=400){timers.delete(key);timer.callback()}}};
}
test('all generated shells contain the approved React card artwork and replace the old ball',()=>{
 const shell=withGameLoader('<html><head></head><body></body></html>',{game:true,entry:'./assets/game.js'});
 assert.match(shell,/data-game-entry="\.\/assets\/game.js"/);assert.match(shell,/game-loader-cards-root/);assert.doesNotMatch(shell,/<canvas|loading-statement/);assert.equal((shell.match(/class="sofacet-card"/g)||[]).length,3);
 assert.equal((withGameLoader(shell,{game:true,entry:'./assets/game.js'}).match(/id="game-loading-screen"/g)||[]).length,1);
 for(const file of ['index.html','play.html','about.html','account.html','faq.html','membership.html','privacy.html','terms.html','launching-soon.html','first-cuts-confirmation.html','entrance-3d.html']){
  const html=readFileSync(new URL('../'+file,import.meta.url),'utf8'),markup=html.match(/<!-- game-loader-body -->([\s\S]*?)<!-- \/game-loader-body -->/)?.[1];assert.match(markup,/game-loader-cards-root/,file);assert.doesNotMatch(markup,/<canvas|loading-statement/,file);
 }
});
test('cards cover real game preparation and hand off exactly once without waiting for a full slideshow',()=>{
 for(const reduced of [false,true]){
  const view=loader({reduced});let handoffs=0;view.root.addEventListener('sofacet:game-loader-ready',()=>handoffs++);
  assert.equal(view.stage.inert,true);assert.equal(view.renders.at(-1).active,true);assert.equal(view.root.hidden,false);
  view.api.ready();view.api.ready();assert.equal(handoffs,1);assert.equal(view.stage.dataset.ready,'true');assert.equal(view.stage.inert,false);assert.equal(view.root.dataset.state,'leaving');view.flushFade();assert.equal(view.root.hidden,true);assert.equal(view.renders.at(-1).active,false);
 }
});
test('slow loads retain the cards; cancelling and reshowing preserves the table readiness guard',()=>{
 const view=loader();for(const timer of view.timers.values())if(timer.duration===20000)timer.callback();assert.match(view.status.firstChild.textContent,/Still preparing/);assert.equal(view.stage.inert,true);assert.equal(view.root.hidden,false);
 view.api.cancel();assert.equal(view.root.hidden,true);assert.equal(view.stage.dataset.ready,'false');view.api.show();assert.equal(view.root.hidden,false);view.api.ready();view.flushFade();
});
test('inactive or hidden embedded games pause the React cards without affecting readiness',()=>{
 const view=loader({embedded:true});assert.equal(view.renders.at(-1).active,false);view.api.setActive(true);assert.equal(view.renders.at(-1).active,true);view.document.hidden=true;view.document.dispatchEvent(new Event('visibilitychange'));assert.equal(view.renders.at(-1).active,false);view.document.hidden=false;view.document.dispatchEvent(new Event('visibilitychange'));assert.equal(view.renders.at(-1).active,true);view.api.ready();view.flushFade();assert.equal(view.root.hidden,true);
});
test('startup failures preserve retry and report only bounded categories',async()=>{
 const view=loader();view.api.fail(Error('WebGL failed with private URL http://secret.invalid'),'renderer');await Promise.resolve();assert.equal(view.root.dataset.errorCode,'graphics');assert.equal(view.error.hidden,false);assert.equal(view.stage.inert,true);assert.equal(view.renders.at(-1).active,false);
 const report=view.reports[0];assert.equal(report.url,'/api/game-load-failure');assert.equal(report.credentials,'omit');assert.deepEqual(JSON.parse(report.body),{phase:'renderer',code:'graphics',embedded:false});assert.ok(!report.body.includes('secret'));view.api.ready();view.flushFade();assert.equal(view.root.hidden,false);
});
test('a failure during dismissal cannot disappear with the previous fade timer',()=>{
 const view=loader();view.api.ready();view.api.fail(Error('WASM unavailable'));view.flushFade();assert.equal(view.root.hidden,false);assert.equal(view.error.hidden,false);assert.equal(view.root.dataset.errorCode,'wasm');
});
test('ordinary pages keep React cards idle until game navigation needs the loader',()=>{
 const view=loader({managed:true});assert.equal(view.renders.length,0);view.api.cancel();assert.equal(view.renders.length,0);view.api.show({story:true});assert.equal(view.renders.at(-1).active,true);view.api.ready();view.flushFade();assert.equal(view.root.hidden,true);
});
