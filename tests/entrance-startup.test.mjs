import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {fragment,withEntrancePresentation} from '../scripts/entrance-presentation.mjs';
import {downloadModel} from '../entrance-source/download-model.mjs';
import {createAssemblyClock} from '../entrance-source/assembly-clock.mjs';
import {createJourneyScrollMap} from '../entrance-source/journey-scroll.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('the 3D entrance shares copy, navigation and reveal without a video or a start button',()=>{
 const source=read('index.html').replace('LAB-GROWN DIAMOND','Updated approved copy,');
 const html=withEntrancePresentation(read('entrance-source/entrance.html'),source);
 for(const selector of [/\bid="story-copy"/,/\bclass="[^"]*\bsite-brand\b/])assert.ok(html.includes(fragment(source,selector)));
 assert.doesNotMatch(html,/<video\b|id="enter"/);
 assert.ok(html.includes('Updated approved copy,'));
 assert.equal((html.match(/id="site-loader"/g)||[]).length,1);
 assert.ok(html.includes('id="skip-game"'));
 assert.ok(html.includes('data-scene-progress'));
 assert.doesNotMatch(html,/__SHARED_(LOADER|COPY|BRAND|ENTER|NAVIGATION)__/);
});

test('model streaming reports decoded progress and preserves all bytes with Brotli delivery',async()=>{
 const progress=[],signal=new AbortController().signal;
 const bytes=await downloadModel('/model.glb',{signal,onProgress:value=>progress.push(value),fetchImpl:async(url,options)=>{
  assert.equal(options.signal,signal);
  return new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2,3]));c.enqueue(new Uint8Array([4,5,6]));c.close()}}),{headers:{'Content-Length':'2','X-Uncompressed-Length':'6'}});
 }});
 assert.deepEqual([...new Uint8Array(bytes)],[1,2,3,4,5,6]);
 assert.deepEqual(progress,[50,100]);
});

test('unknown download length stays indeterminate and real network failures reject',async()=>{
 const progress=[];
 await downloadModel('/model.glb',{onProgress:value=>progress.push(value),fetchImpl:async()=>new Response('abc')});
 assert.deepEqual(progress,[null]);
 await assert.rejects(downloadModel('/missing.glb',{fetchImpl:async()=>new Response('',{status:503})}),/503/);
 const controller=new AbortController();controller.abort();
 await assert.rejects(downloadModel('data:text/plain,abc',{signal:controller.signal}),{name:'AbortError'});
});

test('buffering intro audio cannot pin the six-second logo animation',()=>{
 const elements=new Map(),audio={paused:false,ended:false,currentTime:1,play:()=>Promise.resolve(),pause(){this.paused=true}};
 const target=()=>({dataset:{},setAttribute(){},addEventListener(){},removeEventListener(){}});
 const stage={...target(),querySelector(selector){if(selector==='#introAudio')return audio;if(!elements.has(selector))elements.set(selector,target());return elements.get(selector)}};
 let callback,completed=0;
 const context={localStorage:{getItem:()=>null},matchMedia:()=>({...target(),matches:false}),document:target(),window:target(),requestAnimationFrame:fn=>{callback=fn;return 1},cancelAnimationFrame(){}};
 vm.runInNewContext(read('assets/loading/reveal.js').replace('export function','function')+';this.mountReveal=mountReveal;',context);
 const cleanup=context.mountReveal(stage,()=>completed++);
 for(const now of [100,1100,3100,6100])callback(now);
 assert.equal(completed,1);assert.equal(stage.dataset.phase,'complete');assert.equal(audio.paused,true);cleanup();
});

test('the logo overlay requires real readiness and its existing reveal, with no message-duration gate',async()=>{
 for(const readyFirst of [false,true]){
  let reveal,release,removed=false,cleaned=false;
  const ready=new Promise(resolve=>{release=resolve});
  const overlay={querySelector:()=>({}),setAttribute(){},removeAttribute(){},classList:{add(){}},contains:()=>false,remove(){removed=true}};
  const context={Promise,document:{querySelector:selector=>selector==='#site-loader'?overlay:{inert:true,removeAttribute(){}},documentElement:{hasAttribute:()=>false},body:{removeAttribute(){}}},mountReveal:(_stage,done)=>{reveal=done;return()=>{cleaned=true}},matchMedia:()=>({matches:true})};
  vm.runInNewContext(read('assets/loading/intro.js').replace(/^import .*;\n/,'').replace('export function','function')+';this.finishLoading=finishLoading;',context);
  const done=context.finishLoading({ready});
  if(readyFirst)release();else reveal();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(removed,false);
  if(readyFirst)reveal();else release();
  await done;assert.equal(removed,true);assert.equal(cleaned,true);
 }
});

const source=read('entrance-source/entrance.mjs');
const startup=source.slice(source.lastIndexOf('\ntry{')).replace("import('./journey-renderer.mjs')",'Promise.resolve(rendererModuleFixture)');
const opening=source.slice(source.indexOf('function startScene(){'),source.indexOf('function gameVisibility('));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}}
async function startupFixture({reduced=false,reveal=Promise.resolve()}={}){
 const model=deferred(),nodes=new Map(),rendered=[],assemblyRendered=[],copyFrames=[];let removed=0,disposed=0,aborted=0,handoffs=0,redirect,prepared=0;
 const element=()=>({hidden:true,dataset:{},removeAttribute(){},setAttribute(){},load(){},remove(){removed++}});
 const renderer={loadVariant:()=>model.promise,resize(){},renderAt(frame){rendered.push(frame)},renderAssemblyAt(frame){assemblyRendered.push(frame)},dispose(){disposed++}};
 const context={console:{error(){}},URLSearchParams,Promise,parameters:new URLSearchParams(),videoEntrance:false,performanceMode:true,stage:{},renderView:{},placement:{width:1920,height:1080},devicePixelRatio:1,
  $:id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id)},
  document:{body:{dataset:{}}},fetch:async()=>({ok:true,json:async()=>({points:[]})}),
  gameRequested:false,startupFailed:false,ready:false,firstFrame:334,assembly:createAssemblyClock({reducedMotion:reduced}),
  gameLoader:{},enterGame(){handoffs++;context.gameRequested=true},location:{replace(url){redirect=url}},
  presentationReady:reveal,modelDownload:model.promise,
  loadMainPresentation:async()=>{},createLandingCopy:async()=>frame=>copyFrames.push(frame),placeStage(){},syncScroll(){},requestTick(){},setStartupStatus(){},finishStartupStatus(){},setTimeout(){},
  completePreparation(){prepared++},cancelStartup(){aborted++},journey:undefined,rendererModuleFixture:{createJourneyRenderer:async()=>renderer},
  reduced:{matches:reduced},siteSound:{setActive(){}},performancePanel:{record(){}},
 };
 vm.createContext(context);vm.runInContext(opening,context);
 const done=vm.runInContext('(async()=>{'+startup+'})()',context);
 await new Promise(resolve=>setImmediate(resolve));
 return{context,model,done,rendered,assemblyRendered,copyFrames,get prepared(){return prepared},get disposed(){return disposed},get aborted(){return aborted},get removed(){return removed},get handoffs(){return handoffs},get redirect(){return redirect}};
}

test('3D assembly starts only after GPU preparation with the original first pose',async()=>{
 const view=await startupFixture();assert.equal(view.context.ready,false);assert.equal(view.assemblyRendered.length,0);assert.equal(view.prepared,0);
 view.model.resolve();await view.done;
 assert.equal(view.context.ready,true);assert.equal(view.context.phase,'assembly');assert.equal(view.removed,1);
 assert.deepEqual(view.assemblyRendered,[1]);assert.equal(view.context.frame,334);assert.equal(view.prepared,1);assert.equal(view.context.$('journey-preparation').hidden,true);
});

test('reduced motion starts at the assembled pose without any media activation',async()=>{
 const view=await startupFixture({reduced:true});view.model.resolve();await view.done;
 assert.equal(view.context.phase,'idle');assert.equal(view.context.ready,true);assert.deepEqual(view.rendered,[334]);
});

test('welcome text and fragments advance together while the new spawn stays fixed',async()=>{
 const view=await startupFixture();view.model.resolve();await view.done;
 vm.runInContext(source.slice(source.indexOf('function tick(now){'),source.indexOf('function requestTick(){')),view.context);
 view.context.tick(100);view.context.tick(1100);
 assert.equal(view.copyFrames.at(-1),61);assert.equal(view.assemblyRendered.at(-1),61);
 assert.equal(view.context.frame,334);assert.equal(view.context.phase,'assembly');
});

test('the prepared opening replaces the old poster before the loader fades, with assembly held at its first pose',async()=>{
 const reveal=deferred(),view=await startupFixture({reveal:reveal.promise});view.model.resolve();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(view.context.ready,false);assert.equal(view.prepared,1);
 assert.equal(view.removed,1,'the outdated poster must be gone before releasing the loader');
 assert.deepEqual(view.assemblyRendered,[1],'draw the actual opening while the loader is still opaque');
 assert.equal(view.context.assembly.frame,1,'the opening animation must wait for the reveal');
 reveal.resolve();await view.done;assert.deepEqual(view.assemblyRendered,[1]);
});

test('reduced-motion visitors also get their final opening pose before the loader is released',async()=>{
 const reveal=deferred(),view=await startupFixture({reduced:true,reveal:reveal.promise});view.model.resolve();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(view.removed,1);assert.deepEqual(view.rendered,[334]);assert.equal(view.context.ready,false);
 reveal.resolve();await view.done;assert.deepEqual(view.rendered,[334]);
});

test('skipping while a successful model finishes preparation cannot reveal the entrance over the game',async()=>{
 const view=await startupFixture();view.context.gameRequested=true;
 view.model.resolve();await view.done;
 assert.equal(view.context.ready,false);assert.equal(view.disposed,1);
 assert.equal(view.removed,0);assert.deepEqual(view.assemblyRendered,[]);
});

test('a first swipe during assembly can advance directly into the journey',async()=>{
 const view=await startupFixture();view.model.resolve();await view.done;
 view.context.scrollY=100;view.context.journeyScroll=createJourneyScrollMap();
 const sync=source.slice(source.indexOf('function syncScroll(){'),source.indexOf("window.addEventListener('scroll',syncScroll"));
 vm.runInContext(sync+';syncScroll();',view.context);
 assert.equal(view.context.phase,'idle');assert.equal(view.context.frame,334);assert.ok(view.context.target>334);
});

test('skipping while a cold model loads releases its renderer without showing a false error',async()=>{
 const view=await startupFixture();view.context.gameRequested=true;
 view.model.reject(new DOMException('Cancelled','AbortError'));await view.done;
 assert.equal(view.disposed,1);assert.equal(view.aborted,1);assert.equal(view.context.document.body.dataset.error,undefined);
});

test('a real scene failure automatically opens the game without another user action',async()=>{
 const view=await startupFixture();view.model.reject(Error('Network disconnected'));await view.done;
 assert.equal(view.handoffs,1);assert.equal(view.redirect,undefined);assert.equal(view.disposed,1);
 assert.equal(view.context.gameRequested,true);
});

test('failure before the shared game loader is available navigates directly to the game',async()=>{
 const view=await startupFixture();view.context.gameLoader=undefined;
 view.model.reject(Error('Presentation unavailable'));await view.done;
 assert.equal(view.redirect,'/play.html');assert.equal(view.handoffs,0);assert.equal(view.disposed,1);
});

test('manual Skip to Game during recovery does not start a second handoff',async()=>{
 const view=await startupFixture(),reveal=deferred();view.context.presentationReady=reveal.promise;
 view.model.reject(Error('Renderer unavailable'));await new Promise(resolve=>setImmediate(resolve));
 view.context.enterGame();reveal.resolve();await view.done;
 assert.equal(view.handoffs,1);assert.equal(view.redirect,undefined);
});
