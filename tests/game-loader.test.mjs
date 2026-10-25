import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {withGameLoader} from '../scripts/game-loader-shell.mjs';

const source=readFileSync(new URL('../assets/game-loader.js',import.meta.url),'utf8');
function controller(reduced=false,legacy=false){
 const animations=[],timers=new Map();let nextTimer=0;
 function element(text=''){
  return {textContent:text,dataset:{},hidden:false,inert:false,style:{setProperty(){}},setAttribute(){},
   append(...children){this.textContent+=children.map(child=>child.textContent).join('')},
   replaceChildren(...children){this.textContent=children.map(child=>child.textContent).join('')},
   animate(frames,options){const animation={frames,options,state:'running',pause(){this.state='paused'},play(){this.state='running'},cancel(){this.state='cancelled'},finish(){this.state='finished';this.onfinish?.()}};animations.push(animation);return animation}
  };
 }
 const statement=element(),status={firstChild:element()},error=element(),retry=element(),stage=element(),root=element();
 let removed=false;root.querySelectorAll=()=>legacy?[{remove(){removed=true}}]:[];
 root.hidden=true;root.querySelector=selector=>({'.loading-statement':statement,'[role="status"]':status,'.game-loading-error':error,'[data-game-retry]':retry})[selector];
 const document={hidden:false,body:{hasAttribute:()=>false,removeAttribute(){}},createTextNode:element,createElement:()=>element(),createElementNS:()=>element(),addEventListener(){},getElementById:id=>({'game-loading-screen':root,stage})[id],querySelectorAll:selector=>selector==='#stage'?[stage]:[]};
 const window={},sandbox={window,parent:window,document,matchMedia:()=>({matches:reduced,addEventListener(){}}),ResizeObserver:class{observe(){}disconnect(){}},AbortController,visualViewport:{addEventListener(){}},addEventListener(){},setTimeout:callback=>{timers.set(++nextTimer,callback);return nextTimer},clearTimeout:id=>timers.delete(id),location:{reload(){}},URL,Event};
 vm.runInNewContext(source,sandbox);
 return {api:window.sofacetGameLoader,statement,root,error,stage,animations,timers,legacyRemoved:()=>removed};
}

test('initial shell embeds exactly the supplied font and first statement without a ball or font download',()=>{
 const html=withGameLoader('<html><head></head><body></body></html>',{game:true,entry:'./assets/game.js'});
 const supplied=readFileSync(new URL('../assets/fonts/Biarty-Regular.otf',import.meta.url)).toString('base64');
 assert.ok(html.includes('data:font/otf;base64,'+supplied));assert.ok(html.includes('Your points could become something precious'));
 assert.ok(!html.includes('<canvas'));assert.ok(!html.includes('radial-gradient'));assert.match(html,/data-game-entry="\.\/assets\/game.js"/);
 assert.equal((withGameLoader(html,{game:true,entry:'./assets/game.js'}).match(/id="game-loading-screen"/g)||[]).length,1);
});

test('all five statements loop with alternating colours and stay visible until actual readiness',()=>{
 const c=controller();c.api.show();
 const expected=['Your points could become something precious','Your next high score is loading','Every 10 points gets you ₹1 closer to your first diamond','Play well. Save your points. Shine later',"Let's see what's yours?"];
 for(let i=0;i<12;i++){
  assert.equal(c.statement.textContent,expected[i%5]);assert.equal(c.statement.style.color,i%2?'#c9a0ff':'#fff');assert.equal(c.root.hidden,false);assert.equal(c.stage.inert,true);
  c.animations.at(-1).finish();
 }
 c.api.ready();assert.equal(c.stage.inert,false);assert.equal(c.root.dataset.state,'leaving');assert.equal(c.animations.at(-1).state,'cancelled');
 for(const callback of c.timers.values())callback();assert.equal(c.root.hidden,true);
});

test('cancellation, failure, retry, reduced motion and offscreen suspension clean up the loop',()=>{
 const c=controller();c.api.show();const first=c.animations.at(-1);c.api.setActive(false);assert.equal(first.state,'paused');c.api.setActive(true);assert.equal(first.state,'running');
 c.api.fail();assert.equal(first.state,'cancelled');assert.equal(c.error.hidden,false);assert.equal(c.root.hidden,false);c.api.ready();assert.equal(c.root.dataset.state,'error');
 c.api.show();assert.equal(c.error.hidden,true);assert.equal(c.statement.dataset.statement,'0');c.api.cancel();assert.equal(c.root.hidden,true);assert.equal(c.animations.at(-1).state,'cancelled');assert.equal(c.timers.size,0);
 const calm=controller(true);calm.api.show();assert.equal(calm.animations.length,0);assert.equal(calm.statement.textContent,'Your points could become something precious');
});


test('a leftover canvas from an older preview is removed before the text loader starts',()=>{
 const c=controller(false,true);assert.equal(c.legacyRemoved(),true);c.api.show();assert.equal(c.statement.textContent,'Your points could become something precious');
});
