import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Run the production handoff with a fake clock and child document. Network
// speed must not turn a still-loading iframe into a permanent error screen.
const source=readFileSync(new URL('../entrance-source/entrance.mjs',import.meta.url),'utf8');
const handoff=source.slice(source.indexOf('function gameVisibility('),source.indexOf("$('scroll-hint').addEventListener"));

function entrance(){
 const timers=new Map();let now=0,id=0,observer;
 const stage={dataset:{ready:'false'},busy:'true',getAttribute(){return this.busy}};
 const game=new EventTarget();
 game.getAttribute=()=>game.src;
 game.contentDocument={getElementById:()=>stage};
 game.contentWindow={postMessage(){}};
 game.removeAttribute=()=>{};game.focus=()=>{};
 const loader={failed:false,shown:0,failures:0,readyCalls:0,
  show(){this.shown++},fail(){this.failed=true;this.failures++},
  ready(){this.readyCalls++;if(!this.failed)context.showGame()},
 };
 const context={game,gameLoader:loader,main:{setAttribute(){}},
  document:{body:{dataset:{},setAttribute(){}}},location:{origin:'http://localhost'},
  siteSound:{handoff(){},save(){}},opening:{removeAttribute(){},load(){}},
  journey:{suspend(){},dispose(){}},
  MutationObserver:class{constructor(callback){this.callback=callback;observer=this}observe(){}disconnect(){this.disconnected=true}},
  cancelAnimationFrame(){},
  setTimeout(callback,ms){const key=++id;timers.set(key,{callback,at:now+ms});return key},
  clearTimeout(key){timers.delete(key)},
 };
 vm.runInNewContext(`let gameRequested=false,gameLoaded=false,gameVisible=false,raf=0,openingPlayback,gameReadyObserver;${handoff};this.state=()=>({gameRequested,gameLoaded,gameVisible});`,context);
 return{context,loader,stage,game,
  enter(){context.enterGame()},
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
 assert.equal(view.context.journey,null,'Release the entrance renderer after handoff');
});

test('a delayed iframe document can load after the former deadline',()=>{
 const view=entrance();view.enter();view.advance(60000);
 assert.equal(view.loader.failures,0);
 view.frameLoaded();view.ready();
 assert.equal(view.context.state().gameVisible,true);
});

test('actual child initialization failures still show the retry screen',()=>{
 const view=entrance();view.enter();view.frameLoaded();view.fail();
 assert.equal(view.loader.failures,1);
 assert.equal(view.context.state().gameVisible,false);
 assert.equal(view.loader.readyCalls,0);
});

test('an iframe response without the game stage is an actual failure',()=>{
 const view=entrance();view.enter();view.game.contentDocument=null;view.frameLoaded();
 assert.equal(view.loader.failures,1);
 assert.equal(view.context.state().gameVisible,false);
});
