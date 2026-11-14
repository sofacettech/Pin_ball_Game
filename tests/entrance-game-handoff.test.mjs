import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {advanceJourneyFrame,createJourneyCompletion,FINAL_FRAME_HOLD_MS} from '../entrance-source/journey-motion.mjs';

// Run the production handoff with a fake clock and child document. Network
// speed must not turn a still-loading iframe into a permanent error screen.
const source=readFileSync(new URL('../entrance-source/entrance.mjs',import.meta.url),'utf8');
const handoff=source.slice(source.indexOf('function gameVisibility('),source.indexOf("$('scroll-hint').addEventListener"));

function videoView({initial=2162,target=2164,coarse=true,reducedMotion=false}={}){
 const handoffs=[],requests=[];
 let wanted;
 const context={touchGlide:null,raf:0,ready:true,gameRequested:false,phase:'idle',frame:initial,target,lastFrame:2164,lastTime:0,
  presentedFrame:initial,finalFramePresentedAt:Infinity,videoEntrance:true,advanceJourneyFrame,FINAL_FRAME_HOLD_MS,completion:createJourneyCompletion(2164),
  coarse:{matches:coarse},reduced:{matches:reducedMotion},
  document:{hidden:false},performance:{now:()=>0},
  journey:{settled:true,profileFrames:[],renderAt(frame){requests.push(frame);if(wanted!==frame){wanted=frame;this.settled=false}}},
  requestTick(){},enterGame:options=>handoffs.push(options),
 };
 vm.runInNewContext(source.slice(source.indexOf('function tick(now){'),source.indexOf('function presentJourneyFrame(')),context);
 return {context,handoffs,requests,decoded(){context.journey.settled=true;context.presentedFrame=context.frame;context.finalFramePresentedAt=Infinity}};
}

test('touch scrolling immediately requests the latest opening pose while an older decode is pending',()=>{
 const view=videoView({initial:334,target:1100});view.context.journey.settled=false;
 view.context.tick(16.67);
 assert.equal(view.context.frame,1100,'the start must follow the scroll instead of advancing two video frames');
 assert.equal(view.requests.at(-1),1100);
 view.context.target=500;view.context.tick(33.34);
 assert.equal(view.requests.at(-1),500,'reverse input replaces the pending destination immediately');
 assert.equal(view.handoffs.length,0);
});

test('desktop opening scrolling follows the existing easing without a normal-playback speed limit',()=>{
 const view=videoView({initial:334,target:1100,coarse:false});view.context.journey.settled=false;
 view.context.tick(16.67);
 assert.ok(view.context.frame>400&&view.context.frame<1100,'retain easing, without the two-frame step');
 for(let now=33.34;now<1000;now+=16.67)view.context.tick(now);
 assert.equal(view.context.frame,1100,'a large opening scroll settles in less than a second');
 assert.equal(view.handoffs.length,0);
});

test('reduced-motion video scrolling directly selects its destination',()=>{
 const view=videoView({initial:334,target:1840,coarse:false,reducedMotion:true});
 view.context.tick(16.67);assert.equal(view.requests.at(-1),1840);
 assert.equal(view.handoffs.length,0);
});

test('automatic cards wait for the final decoded frame and its screen presentation',()=>{
 const view=videoView({initial:2164});
 view.context.tick(40);view.context.tick(90);
 assert.equal(view.context.frame,2164,'the requested playhead has reached the end');
 assert.equal(view.handoffs.length,0,'an unfinished decode must not open the cards');
 view.context.journey.settled=true;view.context.tick(95);
 assert.equal(view.handoffs.length,0,'the final source picture must actually be presented');
 view.decoded(100);view.context.tick(110);
 assert.equal(view.handoffs.length,0,'the last image needs a screen presentation interval');
 view.context.tick(311);
 assert.equal(view.handoffs.length,1);assert.equal(view.handoffs[0].fromChess,true);
});

test('a long task after final decoding cannot expire the hold before its first rendering opportunity',()=>{
 const view=videoView({initial:2164});view.context.tick(40);view.decoded(100);
 view.context.tick(400);
 assert.equal(view.handoffs.length,0,'the first RAF after a stalled decode must retain the final canvas');
 assert.equal(view.context.finalFramePresentedAt,400);
 view.context.tick(599);assert.equal(view.handoffs.length,0);
 view.context.tick(601);assert.equal(view.handoffs.length,1);
});

test('scrolling back from the final frame cancels automatic entry into the cards',()=>{
 const view=videoView({initial:2164});view.context.tick(40);view.decoded(50);
 view.context.tick(72);view.context.target=2100;view.context.tick(86);
 assert.equal(view.context.frame,2100,'reverse input must leave the final frame immediately');
 assert.equal(view.handoffs.length,0,'a reversal must cancel entry before the final-frame hold ends');
 view.context.tick(110);assert.ok(view.context.frame<2164);
});

function entrance(){
 const timers=new Map(),events=[],redirects=[];let now=0,id=0,observer;
 const stage={dataset:{ready:'false'},busy:'true',getAttribute(){return this.busy}};
 const game=new EventTarget();
 game.getAttribute=()=>game.src;
 let gameSource;
 Object.defineProperty(game,'src',{get:()=>gameSource,set(value){gameSource=value;events.push('load-game')}});
 game.contentDocument={getElementById:()=>stage};
 game.contentWindow={postMessage(){}};
 game.removeAttribute=()=>{};game.focus=()=>{};
 const loader={failed:false,shown:0,failures:0,readyCalls:0,
  show(options){this.shown++;this.options=options;events.push('show-loader')},fail(){this.failed=true;this.failures++},
  ready(){this.readyCalls++;if(!this.failed)context.showGame()},
 };
 const context={cancelStartup(){},game,gameLoader:loader,main:{setAttribute(){}},
  history:{state:null,replaceState(value){this.state=value},pushState(value){this.state=value}},
  journeyScroll:{scrollAtFrame:()=>100},lastFrame:40,scrollY:100,
  document:{body:{dataset:{},setAttribute(){}}},location:{origin:'http://localhost',replace:url=>redirects.push(url)},
  siteSound:{handoff(){},save(){}},assembly:{finish(){}},
  journey:{suspend(){},dispose(){events.push('dispose-journey')}},
  MutationObserver:class{constructor(callback){this.callback=callback;observer=this}observe(){}disconnect(){this.disconnected=true}},
  cancelAnimationFrame(){},
  setTimeout(callback,ms){const key=++id;timers.set(key,{callback,at:now+ms});return key},
  clearTimeout(key){timers.delete(key)},
 };
 vm.runInNewContext(`let gameRequested=false,gameLoaded=false,gameVisible=false,gameRecovering=false,raf=0,openingPlayback,gameReadyObserver;${handoff};this.state=()=>({gameRequested,gameLoaded,gameVisible});`,context);
 return{context,loader,stage,game,events,redirects,
  enter(options){context.enterGame(options)},
  frameLoaded(){game.dispatchEvent(new Event('load'))},
  ready(){stage.dataset.ready='true';stage.busy='false';observer.callback()},
  fail(){stage.busy='false';observer.callback()},
  advance(ms){now+=ms;for(const [key,timer]of timers)if(timer.at<=now){timers.delete(key);timer.callback()}},
 };
}

test('a cold download lasting over 45 seconds still hands off when ready',()=>{
 const view=entrance();view.enter();view.frameLoaded();
 view.advance(75000);
 assert.equal(view.loader.failures,0,'Elapsed time alone is not a loading failure');
 assert.equal(view.context.state().gameVisible,false);
 assert.equal(view.stage.dataset.ready,'false');
 view.ready();
 assert.equal(view.loader.readyCalls,1);
 assert.equal(view.context.state().gameLoaded,true);
 assert.equal(view.context.state().gameVisible,true);
 assert.equal(view.context.document.body.dataset.game,'visible');
 view.advance(350);
 assert.equal(view.context.journey,null);
});

test('a delayed iframe document can load after the former deadline',()=>{
 const view=entrance();view.enter();view.advance(60000);
 assert.equal(view.loader.failures,0);
 view.frameLoaded();view.ready();
 assert.equal(view.context.state().gameVisible,true);
});

test('chess handoff releases the entrance before allocating the game',()=>{
 const view=entrance();view.enter({fromChess:true});
 assert.equal(view.loader.options.story,true,'The chess-room handoff explicitly keeps the cards');
 assert.deepEqual(view.events,['show-loader','dispose-journey','load-game']);
 assert.equal(view.context.journey,null,'No concurrent entrance and table GPU allocations');
 view.enter();assert.equal(view.events.length,3,'Repeated input cannot allocate twice');
});

test('child initialization failures recover once in a fresh standalone game document',()=>{
 const view=entrance();view.enter();view.frameLoaded();view.fail();
 view.fail();
 assert.deepEqual(view.redirects,['/game?recovery=entrance']);
 assert.equal(view.loader.failures,0,'Do not strand the visitor behind the parent error screen');
 assert.equal(view.context.state().gameVisible,false);
 assert.equal(view.loader.readyCalls,0);
});

test('an iframe response without the game stage is an actual failure',()=>{
 const view=entrance();view.enter();view.game.contentDocument=null;view.frameLoaded();
 assert.deepEqual(view.redirects,['/game?recovery=entrance']);
 assert.equal(view.context.state().gameVisible,false);
});
