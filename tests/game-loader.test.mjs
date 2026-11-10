import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {withGameLoader} from '../scripts/game-loader-shell.mjs';
const source=readFileSync(new URL('../loader-source/controller.js',import.meta.url),'utf8').replace('export function','function');
function loader({reduced=false,embedded=false,parentOwnsCards=false,managed=false,images=[],cssReady=true,visited=false,chess=false,storageBlocked=false}={}){
 const timers=new Map(),renders=[],reports=[];let id=0;
 const node=()=>({hidden:false,dataset:{},style:{setProperty(){}},firstChild:{textContent:''},setAttribute(name,value){this[name]=value}});
 const root=node(),stage=node(),error=node(),status=node(),cards=node(),progress=node(),retry=node(),rootEvents=new EventTarget();
 const fill=node(),statement=node(),childWindow={},parentMessages=[];
 progress.querySelector=selector=>({'.game-loading-fill':fill,'.game-loading-statement':statement}[selector]);
 const storage=new Map(visited?[['sofacet-game-visited','1']]:[]);
 const sessionStorage={getItem:key=>{if(storageBlocked)throw Error('Storage unavailable');return storage.get(key)??null},setItem(key,value){if(storageBlocked)throw Error('Storage unavailable');storage.set(key,value)}};
 cards.hidden=true;cards.querySelectorAll=selector=>selector==='img'?images:[['Up Next:','Pinball'],['Score SO/ COINS.','Save them for<br>SO/ FACET diamond jewellery.'],['1,000 SO/ COINS = ₹100 OFF','SO/ FACET DIAMOND JEWELLERY']].map(lines=>({children:lines.map(innerHTML=>({innerHTML}))}));
 root.addEventListener=rootEvents.addEventListener.bind(rootEvents);root.dispatchEvent=rootEvents.dispatchEvent.bind(rootEvents);root.hasAttribute=name=>managed&&name==='data-managed';stage.inert=true;stage.dataset.ready='false';
 root.querySelector=selector=>({'#game-loader-cards-root':cards,'.loading-copy':status,'.game-loading-progress':progress,'.game-loading-error':error,'[data-game-retry]':retry}[selector]);
 const document=new EventTarget(),window=new EventTarget();document.body={hasAttribute:name=>!managed&&name==='data-game-loading',removeAttribute(){}};document.hidden=false;
 document.getElementById=id=>({'game-loading-screen':root,stage,'game-page':{contentWindow:childWindow},'game-loader-controller':{dataset:{gameEntry:''}},'game-loader-critical':{sheet:{}}}[id]);document.querySelectorAll=selector=>selector==='#stage'?[stage]:[];
 const url=new URL('http://localhost/play.html');if(parentOwnsCards)url.searchParams.set('loader','parent');if(chess)url.searchParams.set('from','chess');
 const context={CustomEvent,window,document,sessionStorage,parent:embedded?{postMessage:data=>parentMessages.push(data)}:window,location:{origin:'http://localhost',href:url.href},URL,matchMedia:()=>({matches:reduced}),AbortController,ResizeObserver:class{observe(){}disconnect(){}},visualViewport:null,addEventListener:window.addEventListener.bind(window),requestAnimationFrame:()=>++id,setTimeout:(callback,duration)=>{const key=++id;timers.set(key,{callback,duration});return key},clearTimeout:key=>timers.delete(key),console:{error(){}},fetch:async(url,options)=>reports.push({url,...options}),renderCards:(element,active,run,onComplete)=>renders.push({element,active,run,onComplete})};
 context.getComputedStyle=()=>({getPropertyValue:()=>cssReady?'1':''});
 vm.runInNewContext(source+';installGameLoader(renderCards)',context);
 return{api:window.sofacetGameLoader,root,stage,error,status,progress,fill,statement,childWindow,parentMessages,storage,renders,reports,document,window,timers,finishCards(){renders.at(-1).onComplete()},flushFade(){for(const [key,timer]of timers)if(timer.duration<=400){timers.delete(key);timer.callback()}}};
}

test('determinate progress never regresses and reaches 100 only when the game is ready',()=>{
 const view=loader({visited:true});assert.match(view.statement.innerHTML,/Up Next:/);assert.equal(view.fill.style.transform,'scaleX(0)');
 view.api.progress(42.4);assert.match(view.statement.innerHTML,/Score SO\/ COINS/);assert.equal(view.fill.style.transform,'scaleX(0.42)');
 for(const value of [12,-1,NaN,Infinity])view.api.progress(value);
 assert.equal(view.progress['aria-valuenow'],'42');
 view.api.progress(100);assert.match(view.statement.innerHTML,/1,000 SO\/ COINS = ₹100 OFF/);assert.equal(view.stage.inert,true);
 view.api.ready();assert.match(view.statement.innerHTML,/1,000 SO\/ COINS = ₹100 OFF/);assert.equal(view.fill.style.transform,'scaleX(1)');
 view.flushFade();assert.equal(view.root.hidden,true);
 const failed=loader({visited:true});failed.api.progress(35);failed.api.fail(Error('Missing asset'));failed.api.ready();failed.api.progress(100);
 assert.equal(failed.progress['aria-valuenow'],'35');assert.equal(failed.error.hidden,false);
});


test('card statements change only after 33 and 66 percent, with the last held through readiness',()=>{
 const view=loader({visited:true});
 for(const [value,copy] of [[0,'Up Next:'],[33,'Up Next:'],[34,'Score SO/ COINS.'],[66,'Score SO/ COINS.'],[67,'1,000 SO/ COINS'],[99,'1,000 SO/ COINS']]){
  view.api.progress(value);assert.ok(view.statement.innerHTML.includes(copy),String(value));
 }
 view.api.ready();assert.equal(view.progress['aria-valuenow'],'100');assert.match(view.statement.innerHTML,/1,000 SO\/ COINS = ₹100 OFF/);
 view.flushFade();view.api.show();assert.match(view.statement.innerHTML,/Up Next:/);
});

test('parent-owned game progress is forwarded only from the trusted game frame',()=>{
 const child=loader({embedded:true,parentOwnsCards:true});child.api.progress(64);
 assert.equal(child.parentMessages.at(-1).value,64);
 const view=loader({managed:true,visited:true});view.api.show();
 const send=(origin,source)=>view.window.dispatchEvent(Object.assign(new Event('message'),{origin,source,data:{type:'sofacet:game-load-progress',value:64}}));
 send('https://other.invalid',view.childWindow);send('http://localhost',{});assert.match(view.statement.innerHTML,/Up Next:/);
 send('http://localhost',view.childWindow);assert.match(view.statement.innerHTML,/Score SO\/ COINS/);
});

test('returning visitors get only a progress bar until the real table is ready',()=>{
 const view=loader({visited:true});
 assert.equal(view.root.dataset.loader,'progress');assert.equal(view.progress.hidden,false);
 assert.equal(view.renders.length,0);assert.equal(view.stage.inert,true);assert.equal(view.root.hidden,false);
 view.api.ready();view.flushFade();
 assert.equal(view.root.hidden,true);assert.equal(view.stage.inert,false);assert.equal(view.stage.dataset.ready,'true');
});

test('the game is remembered only after the first cards and table have handed off',async()=>{
 const view=loader();await Promise.resolve();
 assert.equal(view.root.dataset.loader,'cards');assert.equal(view.progress.hidden,true);
 view.api.ready();assert.equal(view.storage.get('sofacet-game-visited'),undefined);
 view.finishCards();assert.equal(view.storage.get('sofacet-game-visited'),'1');view.flushFade();
 view.api.show();assert.equal(view.root.dataset.loader,'progress');assert.equal(view.progress.hidden,false);
});

test('the chess-room story retains cards even after an earlier game visit',async()=>{
 for(const options of [{managed:true},{chess:true}]){
  const view=loader({...options,visited:true});if(options.managed)view.api.show({story:true});await Promise.resolve();
  assert.equal(view.root.dataset.loader,'cards');assert.equal(view.progress.hidden,true);
  view.api.ready();assert.equal(view.root.hidden,false);view.finishCards();view.flushFade();assert.equal(view.root.hidden,true);
 }
});

test('secondary pages use progress on return while a parent-owned game has no second loader',()=>{
 const page=loader({managed:true,visited:true});assert.equal(page.renders.length,0);page.api.show();
 assert.equal(page.root.dataset.loader,'progress');assert.equal(page.renders.length,0);
 const child=loader({embedded:true,parentOwnsCards:true,visited:true});
 assert.equal(child.progress.hidden,true);assert.equal(child.renders.length,0);child.api.ready();child.flushFade();assert.equal(child.root.hidden,true);
});

test('progress loading keeps retry errors and blocked storage cannot break the game',async()=>{
 const returning=loader({visited:true});returning.api.fail(Error('Asset unavailable'));
 assert.equal(returning.progress.hidden,true);assert.equal(returning.error.hidden,false);assert.equal(returning.root.dataset.state,'error');
 const first=loader({storageBlocked:true});await Promise.resolve();first.api.ready();first.finishCards();first.flushFade();
 assert.equal(first.stage.dataset.ready,'true');assert.equal(first.root.hidden,true);
});
test('all generated shells contain the approved React card artwork and replace the old ball',()=>{
 const shell=withGameLoader('<html><head></head><body></body></html>',{game:true,entry:'./assets/game.js'});
 assert.match(shell,/data-game-entry="\.\/assets\/game.js"/);assert.match(shell,/game-loader-cards-root/);assert.doesNotMatch(shell,/<canvas|id="loading-statement"/);assert.equal((shell.match(/class="sofacet-card"/g)||[]).length,3);
 assert.equal((withGameLoader(shell,{game:true,entry:'./assets/game.js'}).match(/id="game-loading-screen"/g)||[]).length,1);
 for(const file of ['index.html','play.html','about.html','account.html','faq.html','membership.html','privacy.html','terms.html','launching-soon.html','first-cuts-confirmation.html','entrance-3d.html']){
  const html=readFileSync(new URL('../'+file,import.meta.url),'utf8'),markup=html.match(/<!-- game-loader-body -->([\s\S]*?)<!-- \/game-loader-body -->/)?.[1];assert.match(markup,/game-loader-cards-root/,file);assert.doesNotMatch(markup,/<canvas|id="loading-statement"/,file);
 }
});
test('handoff waits for both the table and the three cards, in either order',async()=>{
 for(const reduced of [false,true]){
  const view=loader({reduced});let handoffs=0;view.root.addEventListener('sofacet:game-loader-ready',()=>handoffs++);
  await Promise.resolve();
  assert.equal(view.stage.inert,true);assert.equal(view.renders.at(-1).active,true);assert.equal(view.root.hidden,false);
  if(reduced)view.finishCards();else view.api.ready();
  assert.equal(handoffs,0);assert.equal(view.root.hidden,false);assert.equal(view.stage.inert,true);
  if(reduced)view.api.ready();else view.finishCards();
  view.api.ready();view.finishCards();assert.equal(handoffs,1);assert.equal(view.stage.dataset.ready,'true');assert.equal(view.stage.inert,false);assert.equal(view.root.dataset.state,'leaving');view.flushFade();assert.equal(view.root.hidden,true);assert.equal(view.renders.at(-1).active,false);
 }
});
test('slow loads retain the cards; cancelling and reshowing preserves the table readiness guard',()=>{
 const view=loader();for(const timer of view.timers.values())if(timer.duration===20000)timer.callback();assert.match(view.status.firstChild.textContent,/Still preparing/);assert.equal(view.stage.inert,true);assert.equal(view.root.hidden,false);
 const firstRun=view.renders.at(-1).run;
 view.api.cancel();assert.equal(view.root.hidden,true);assert.equal(view.stage.dataset.ready,'false');view.api.show();assert.equal(view.root.hidden,false);assert.notEqual(view.renders.at(-1).run,firstRun);view.api.ready();view.finishCards();view.flushFade();
});
test('inactive or hidden embedded games pause the React cards without affecting readiness',async()=>{
 const view=loader({embedded:true});await Promise.resolve();assert.equal(view.renders.at(-1).active,false);view.api.setActive(true);assert.equal(view.renders.at(-1).active,true);view.document.hidden=true;view.document.dispatchEvent(new Event('visibilitychange'));assert.equal(view.renders.at(-1).active,false);view.document.hidden=false;view.document.dispatchEvent(new Event('visibilitychange'));assert.equal(view.renders.at(-1).active,true);view.api.ready();view.finishCards();view.flushFade();assert.equal(view.root.hidden,true);
});
test('the hidden game skips its own deck when the world owns the cards',()=>{
 const view=loader({embedded:true,parentOwnsCards:true});assert.equal(view.renders.length,0);view.api.ready();view.flushFade();assert.equal(view.root.hidden,true);
});
test('startup failures preserve retry and report only bounded categories',async()=>{
 const view=loader();view.api.fail(Error('WebGL failed with private URL http://secret.invalid'),'renderer');await Promise.resolve();assert.equal(view.root.dataset.errorCode,'graphics');assert.equal(view.error.hidden,false);assert.equal(view.stage.inert,true);assert.equal(view.renders.at(-1).active,false);
 const report=view.reports[0];assert.equal(report.url,'/api/game-load-failure');assert.equal(report.credentials,'omit');assert.deepEqual(JSON.parse(report.body),{phase:'renderer',code:'graphics',embedded:false});assert.ok(!report.body.includes('secret'));view.api.ready();view.flushFade();assert.equal(view.root.hidden,false);
});
test('a failure during dismissal cannot disappear with the previous fade timer',()=>{
 const view=loader();view.api.ready();view.finishCards();view.api.fail(Error('WASM unavailable'));view.flushFade();assert.equal(view.root.hidden,false);assert.equal(view.error.hidden,false);assert.equal(view.root.dataset.errorCode,'wasm');
});
test('ordinary pages keep React cards idle until game navigation needs the loader',async()=>{
 const view=loader({managed:true});assert.equal(view.renders.length,0);view.api.cancel();assert.equal(view.renders.length,0);view.api.show({story:true});await Promise.resolve();assert.equal(view.renders.at(-1).active,true);view.api.ready();view.finishCards();view.flushFade();assert.equal(view.root.hidden,true);
});
test('the deck waits for artwork while the table prepares in parallel',async()=>{
 let finishDecoding;
 const image={decode:()=>new Promise(resolve=>{finishDecoding=resolve})};
 const view=loader({images:[image]});
 const deck=view.renders[0].element;
 assert.equal(deck.hidden,true);
 assert.equal(image.loading,'eager');
 assert.equal(view.renders.at(-1).active,false);
 view.api.ready();
 assert.equal(view.stage.inert,true);
 finishDecoding();
 await new Promise(setImmediate);
 assert.equal(deck.hidden,false);
 assert.equal(view.renders.at(-1).active,true);
 assert.equal(view.stage.inert,true);

 for(const options of [{cssReady:false},{images:[{decode:()=>Promise.reject(Error('Missing artwork'))}]}]){
  const fallback=loader(options);
  await new Promise(setImmediate);
  assert.equal(fallback.renders[0].element.hidden,true);
  fallback.api.ready();
  fallback.flushFade();
  assert.equal(fallback.stage.dataset.ready,'true');
  assert.equal(fallback.root.hidden,true);
 }
});

test('visible cards each get 8 seconds, and a manual advance resets the timer for the next card',()=>{
 const cardMotion=readFileSync(new URL('../loader-source/card-motion.js',import.meta.url),'utf8').replace('export function','function');
 const node=()=>Object.assign(new EventTarget(),{dataset:{},style:{},classList:{toggle(){}},setAttribute(name,value){this[name]=value}});
 const deck=node(),stage=node(),status=node(),document=Object.assign(new EventTarget(),{hidden:false});
 const cards=Array.from({length:3},()=>Object.assign(node(),{querySelector:()=>node()}));
 const root=Object.assign(node(),{
  querySelectorAll:()=>cards,
  querySelector:selector=>({'.stage':stage,'.deck':deck,'[data-card-status]':status}[selector])
 });
 let time=0,completed=0,id=0;
 const timers=new Map(),context={root,document,AbortController,matchMedia:()=>({matches:true}),performance:{now:()=>time},
  setTimeout(callback,delay){timers.set(++id,{callback,at:time+delay});return id},clearTimeout:key=>timers.delete(key),
  done:()=>completed++
 };
 vm.runInNewContext(cardMotion+';this.motion=connectCardMotion(root,done)',context);
 function advance(ms){
  time+=ms;
  for(const [key,timer] of [...timers])if(timer.at<=time){timers.delete(key);timer.callback()}
 }
 const front=()=>cards.findIndex(card=>card.dataset.slot===0);
 advance(45000);assert.equal(front(),0,'No timer while the deck is hidden');
 context.motion.setActive(true);
 advance(7999);assert.equal(front(),0);
 advance(1);assert.equal(front(),1);
 advance(3000);assert.equal(front(),1);
 const swipe=new Event('keydown');Object.assign(swipe,{key:'ArrowLeft'});deck.dispatchEvent(swipe);
 assert.equal(front(),2);
 advance(7000);assert.equal(completed,0);
 context.motion.setActive(false);
 advance(30000);assert.equal(completed,0,'A hidden tab does not consume the remaining second');
 context.motion.setActive(true);
 advance(999);assert.equal(completed,0);
 advance(1);assert.equal(completed,1);
 advance(25000);assert.equal(completed,1);
});
