import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {build,transform} from 'esbuild-wasm';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {leaveCopy} from '../game-source/src/player-copy.ts';

const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:[new URL('../game-source/src/score-page.jsx',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',packages:'external',loader:{'.css':'empty'},write:false});
const module={exports:{}};vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require});
const {ScorePage}=module.exports;
const result=points=>({points,rewardValue:points/10,completedAt:123,gameId:'verified-game-reference',status:'completed'});
function elements(node){return React.isValidElement(node)?[node,...React.Children.toArray(node.props.children).flatMap(elements)]:[]}

test('React score screen uses the game result and preserves exact rupee conversion',()=>{
 const html=renderToStaticMarkup(React.createElement(ScorePage,{result:result(3205)}));
 assert.match(html,/id="rewards-points">3,205<\/strong>/);assert.match(html,/₹320\.5 off/);
 assert.match(html,/id="rewards-register"/);assert.match(html,/id="rewards-leaderboard"/);
 assert.doesNotMatch(html,/<nav|<header|4,800|₹480|href="#"/);
});
test('zero and low scores retain replay without offering to save unredeemable points',()=>{
 for(const points of [0,9]){
  const html=renderToStaticMarkup(React.createElement(ScorePage,{result:result(points)}));
  assert.match(html,/Not much to keep yet/);assert.doesNotMatch(html,/id="rewards-register"|id="rewards-expiry"/);
  assert.match(html,/id="rewards-retry"/);assert.match(html,/id="rewards-low-copy"/);
 }
});
test('the three React actions invoke their existing callbacks once',()=>{
 const calls=[],props={result:result(4800),onSave:()=>calls.push('save'),onReplay:()=>calls.push('replay'),onLeaderboard:()=>calls.push('leaderboard')};
 const nodes=elements(ScorePage(props));
 for(const id of ['rewards-register','rewards-retry','rewards-leaderboard'])nodes.find(node=>node.props.id===id).props.onClick();
 assert.deepEqual(calls,['save','replay','leaderboard']);
});

async function controllerFixture(){
 const nodes=new Map(),events=new Map(),captured={};
 const node=id=>{
  if(!nodes.has(id))nodes.set(id,{id,hidden:false,open:false,dataset:{},style:{setProperty(){}},offsetTop:1,offsetHeight:1,
   setAttribute(key,value){this[key]=value},getAttribute(key){return this[key]},focus(){},prepend(){},querySelector:selector=>node(id+selector),
   addEventListener(type,fn){this[type+'Listener']=fn},showModal(){this.open=true},close(){this.open=false;this.closeListener?.()},click(){this.onclick?.()}});
  return nodes.get(id);
 };
 const source=readFileSync(new URL('../game-source/src/post-game-rewards.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
 const compiled=await transform(source,{loader:'ts',format:'cjs'}),exports={};
 const context={exports,module:{exports},Date,Math,Number,URL,location:{origin:'http://test.local',href:'http://test.local/play.html'},
  document:{getElementById:node,querySelector:()=>node('header'),body:{prepend(){}},addEventListener:(key,fn)=>events.set(key,fn)},
  ResizeObserver:class{observe(){}disconnect(){}},addEventListener:(key,fn)=>events.set(key,fn),leaveCopy,
  mountScorePage:(_container,actions)=>{captured.actions=actions;return {render:value=>{captured.result=value}}},window:{top:{location:{assign:value=>{captured.destination=value}}}},
 };
 vm.runInNewContext(compiled.code,context);
 const registered=[],replays=[],boards=[];
 const controller=context.module.exports.connectPostGameRewards(value=>registered.push(value),()=>replays.push(true),()=>boards.push(true));
 return {controller,node,captured,registered,replays,boards};
}
test('score controller passes the immutable completed result and game ID into registration',async()=>{
 const fixture=await controllerFixture();fixture.controller.show(3205,'real-game-id');
 assert.equal(fixture.captured.result.points,3205);assert.equal(fixture.captured.result.rewardValue,320.5);assert.equal(Object.isFrozen(fixture.captured.result),true);
 fixture.captured.actions.onSave();assert.equal(fixture.registered[0],fixture.captured.result);assert.equal(fixture.registered[0].gameId,'real-game-id');
});
test('close, keep, leave-anyway, replay and leaderboard retain their established flow',async()=>{
 const fixture=await controllerFixture();fixture.controller.show(4800,'game');
 fixture.captured.actions.onLeaderboard();assert.equal(fixture.boards.length,1);
 fixture.node('rewards-close').click();assert.equal(fixture.controller.dialog.dataset.view,'leave');
 fixture.node('rewards-close').click();assert.equal(fixture.controller.dialog.dataset.view,'result');
 fixture.node('rewards-close').click();fixture.node('rewards-keep').click();assert.equal(fixture.registered[0].points,4800);
 fixture.controller.show();fixture.node('rewards-close').click();fixture.node('rewards-leave-anyway').click();assert.equal(fixture.controller.dialog.dataset.view,'exit');
 fixture.node('rewards-exit-play').click();assert.equal(fixture.replays.length,1);
 fixture.controller.clear();fixture.controller.show(9);fixture.node('rewards-close').click();assert.equal(fixture.captured.destination,'/');
});
