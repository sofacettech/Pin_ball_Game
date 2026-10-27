import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {withGameLoader} from '../scripts/game-loader-shell.mjs';

// Exercise the actual Canvas controller's integrator without a browser or GPU.
const source=readFileSync(new URL('../assets/game-loader.js',import.meta.url),'utf8');
test('generated pages retain the ball and initially hidden story text',()=>{
 const shell=withGameLoader('<html><head></head><body></body></html>',{game:true,entry:'./assets/game.js'});
 assert.match(shell,/<canvas aria-hidden="true"><\/canvas>/);
 assert.match(shell,/data-game-entry="\.\/assets\/game.js"/);
 assert.equal((withGameLoader(shell,{game:true,entry:'./assets/game.js'}).match(/id="game-loading-screen"/g)||[]).length,1);
 for(const file of ['index.html','play.html','about.html','account.html','faq.html','membership.html','privacy.html']){
  const html=readFileSync(new URL('../'+file,import.meta.url),'utf8');
  const loader=html.match(/<!-- game-loader-body -->([\s\S]*?)<!-- \/game-loader-body -->/)?.[1];
  assert.ok(loader?.includes('<canvas aria-hidden="true"></canvas>'),file);
  assert.match(loader,/class="loading-statement"[^>]*hidden/,file);
 }
 assert.match(readFileSync(new URL('../sequence.js',import.meta.url),'utf8'),/game\.src = '\.\/play\.html\?from=chess'/);
});
const integrator=source.slice(source.indexOf('function advance(dt)'),source.indexOf('function tick(now)'));
function simulation(initial={}){
 const sandbox={initial};
 vm.runInNewContext(`let {width=320,height=480,radius=10,x=160,y=240,vx=320,vy=240}=initial;let time=0,points=[],impacts=[];${integrator};this.step=advance;this.state=()=>({x,y,vx,vy,time,points,impacts,width,height,radius})`,sandbox);
 return sandbox;
}
test('ball motion is refresh-rate independent, radius-aware, and keeps bounded history',()=>{
 const sixty=simulation(),fast=simulation();
 for(let i=0;i<600;i++){sixty.step(1/60);const p=sixty.state();assert.ok(p.x>=p.radius-1e-8&&p.x<=p.width-p.radius+1e-8);assert.ok(p.y>=p.radius-1e-8&&p.y<=p.height-p.radius+1e-8);assert.ok(p.points.length<=240&&p.impacts.length<=8)}
 for(let i=0;i<1440;i++)fast.step(1/144);
 const a=sixty.state(),b=fast.state();assert.ok(Math.abs(a.x-b.x)<1e-6&&Math.abs(a.y-b.y)<1e-6);
});
test('corner contacts reflect both axes once, with exact edge positions',()=>{
 const motion=simulation({width:100,height:100,radius:10,x:50,y:50,vx:40,vy:40});motion.step(1);
 const contact=motion.state();assert.equal(contact.x,90);assert.equal(contact.y,90);assert.equal(contact.vx,-40);assert.equal(contact.vy,-40);assert.equal(contact.impacts.length,2);
 assert.equal(contact.impacts[0].x,100);assert.equal(contact.impacts[1].y,100);assert.equal(contact.points.at(-1).x,90);
 motion.step(1/144);assert.equal(motion.state().impacts.length,2);
 motion.step(.5);assert.equal(motion.state().impacts.length,0);
});
test('trail records the reflection vertex instead of cutting across a bounce',()=>{
 const motion=simulation({width:100,height:100,radius:10,x:85,y:50,vx:40,vy:20});motion.step(.25);
 const {points,x,vx}=motion.state();assert.equal(points.length,2);assert.equal(points[0].x,90);assert.equal(points[0].y,52.5);assert.equal(x,85);assert.equal(vx,-40);
});

function loader({story=true,reduced=false,embedded=false,managed=false,fontReady=Promise.resolve()}={}){
 const animations=[],timers=new Map();let id=0;
 const element=()=>({hidden:false,dataset:{},style:{setProperty(){}},children:[],firstChild:{textContent:''},setAttribute(name,value){this[name]=value},removeAttribute(name){delete this[name]},getBoundingClientRect:()=>({width:1440,height:720,bottom:90}),replaceChildren(...children){this.children=children},get textContent(){return this.children.map(child=>child.textContent).join('')},set textContent(value){this.children=[{textContent:value}]}});
 const root=element(),stage=element(),statement=element(),phrase=element(),error=element(),status=element(),retry=element(),canvas=element(),body=element();
 body.hasAttribute=name=>!managed&&name==='data-game-loading';
 const rootEvents=new EventTarget();root.addEventListener=rootEvents.addEventListener.bind(rootEvents);root.dispatchEvent=rootEvents.dispatchEvent.bind(rootEvents);root.hasAttribute=name=>managed&&name==='data-managed';stage.inert=true;stage.dataset.ready='false';canvas.getContext=()=>null;
 phrase.animate=(frames,options)=>{const animation={frames,options,playState:'running',pause(){this.playState='paused'},play(){this.playState='running'},cancel(){this.playState='idle'},finish(){this.playState='finished';this.onfinish?.()}};animations.push(animation);return animation};
 const nodes={canvas,'.loading-statement':statement,'.loading-phrase':phrase,'.game-loading-error':error,'[role="status"]':status,'[data-game-retry]':retry};root.querySelector=selector=>nodes[selector];
 const document=new EventTarget(),window=new EventTarget(),motion=new EventTarget();document.body=body;document.hidden=false;document.fonts={load:()=>fontReady};motion.matches=reduced;
 document.getElementById=id=>({'game-loading-screen':root,stage,'game-loader-controller':{dataset:{gameEntry:''}}}[id]);
 document.querySelectorAll=selector=>selector==='#stage'?[stage]:[];document.createTextNode=textContent=>({textContent});document.createElement=element;
 const context={CustomEvent,window,document,parent:embedded?{}:window,location:{search:story?'?from=chess':'',origin:'http://localhost',href:'http://localhost/play.html'},URLSearchParams,URL,matchMedia:()=>motion,AbortController,ResizeObserver:class{observe(){}disconnect(){}},devicePixelRatio:1,visualViewport:null,addEventListener:window.addEventListener.bind(window),requestAnimationFrame:()=>++id,cancelAnimationFrame(){},setTimeout:(callback,duration)=>{const key=++id;timers.set(key,{callback,duration});return key},clearTimeout:key=>timers.delete(key)};
 vm.runInNewContext(source,context);
 return{api:window.sofacetGameLoader,root,stage,statement,phrase,error,animations,document,motion,timers,flushFade(){for(const [key,timer]of timers)if(timer.duration<=800){timers.delete(key);timer.callback()}}};
}
const fontLoaded=()=>new Promise(resolve=>setImmediate(resolve));
test('chess arrival shows each approved message once and waits for both story and table',async()=>{
 const view=loader();await fontLoaded();
 assert.equal(view.phrase.textContent,'Your points could become something precious');
 view.api.ready();assert.equal(view.stage.inert,true);assert.equal(view.root.hidden,false);
 view.animations[0].finish();assert.equal(view.phrase.textContent,'Every 10 points you score is ₹1 off SO/ FACET diamond jewellery.');
 assert.deepEqual(view.phrase.children.filter(child=>child.className==='loading-value').map(child=>child.textContent),['10','₹1']);
 assert.equal(view.phrase.children.find(child=>child.className==='brand-word')?.textContent,'SO/ FACET');
 assert.equal(view.animations[0].playState,'idle');assert.equal(view.animations[0].frames.at(-1).opacity,0);
 view.animations[1].finish();assert.equal(view.phrase.textContent,'Play well. Save your points. Shine later.');assert.equal(view.stage.inert,true);
 view.animations[2].finish();assert.equal(view.phrase.textContent,'Pink triangles and neon-green (+) bumpers add points. Cyan (−) bumpers take points away.');assert.equal(view.stage.inert,true);
 assert.deepEqual(view.phrase.children.filter(child=>child.className).map(child=>[child.textContent,child.className]),[['Pink','loading-pink'],['neon-green','loading-green'],['Cyan','loading-cyan']]);
 view.animations[3].finish();assert.equal(view.stage.inert,false);assert.equal(view.root.dataset.state,'leaving');
 view.flushFade();assert.equal(view.root.hidden,true);assert.equal(view.animations.length,4);
});
test('last message stays visible while the table is still loading and never restarts on resume',async()=>{
 const view=loader();await fontLoaded();view.animations[0].finish();view.animations[1].finish();view.animations[2].finish();view.animations[3].finish();
 assert.equal(view.root.hidden,false);assert.equal(view.stage.inert,true);
 view.api.setActive(false);view.api.setActive(true);assert.notEqual(view.animations[3].playState,'running');
 view.api.ready();view.flushFade();assert.equal(view.root.hidden,true);
});
test('direct game and reduced-motion navigation do not wait for the story',async()=>{
 for(const options of [{story:false},{reduced:true}]){
  const view=loader(options);await fontLoaded();assert.equal(view.animations.length,0);assert.equal(view.statement.hidden,options.story===false);
  view.api.ready();view.flushFade();assert.equal(view.stage.inert,false);assert.equal(view.root.hidden,true);
 }
});
test('story pauses when hidden and respects a reduced-motion preference change',async()=>{
 const view=loader({embedded:true});await fontLoaded();assert.equal(view.animations[0].playState,'paused');
 view.api.setActive(true);assert.equal(view.animations[0].playState,'running');
 view.document.hidden=true;view.document.dispatchEvent(new Event('visibilitychange'));assert.equal(view.animations[0].playState,'paused');
 view.document.hidden=false;view.document.dispatchEvent(new Event('visibilitychange'));assert.equal(view.animations[0].playState,'running');
 view.api.ready();view.motion.matches=true;view.motion.dispatchEvent(new Event('change'));view.flushFade();assert.equal(view.root.hidden,true);
});
test('failure, cancellation and retry clean up story animation and stale font callbacks',async()=>{
 let resolveFont;const view=loader({fontReady:new Promise(resolve=>resolveFont=resolve)});
 view.api.cancel();resolveFont();await fontLoaded();assert.equal(view.animations.length,0);assert.equal(view.root.hidden,true);
 view.api.show();await fontLoaded();assert.equal(view.animations.length,1);
 view.api.fail();assert.equal(view.animations[0].playState,'idle');assert.equal(view.error.hidden,false);assert.equal(view.statement.hidden,true);
 view.api.ready();assert.notEqual(view.root.dataset.state,'leaving');
 view.api.show();await fontLoaded();assert.equal(view.error.hidden,true);assert.equal(view.statement.dataset.statement,'0');
 view.stage.dataset.ready='true';view.api.cancel();assert.equal(view.stage.inert,false);assert.equal(view.root.hidden,true);
});

// The Three.js parent uses this same controller while the child loads without
// a second story. Handoff must occur only when both the copy and game finish.
test('managed entrance uses the current shared story and signals one game handoff',async()=>{
 const view=loader({managed:true,story:false});let handoffs=0;
 view.root.addEventListener('sofacet:game-loader-ready',()=>handoffs++);
 assert.equal(view.animations.length,0);
 view.api.show({story:true});await fontLoaded();view.api.ready();
 assert.equal(handoffs,0);
 const messages=[];
 while(handoffs===0&&messages.length<5){messages.push(view.phrase.textContent);view.animations.at(-1).finish()}
 assert.equal(messages.length,4);
 assert.equal(messages[1],'Every 10 points you score is ₹1 off SO/ FACET diamond jewellery.');
 assert.match(messages[3],/Cyan.*take points away/);
 assert.equal(handoffs,1);view.flushFade();assert.equal(view.root.hidden,true);
});
