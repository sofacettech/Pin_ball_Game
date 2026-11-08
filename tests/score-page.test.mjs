import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {build,transform} from 'esbuild-wasm';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {leaveCopy} from '../game-source/src/player-copy.ts';

const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:[fileURLToPath(new URL('../game-source/src/score-page.jsx',import.meta.url))],bundle:true,platform:'node',format:'cjs',packages:'external',loader:{'.css':'empty'},write:false});
const module={exports:{}};vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require});
const {ScorePage}=module.exports;
const result=points=>({points,rewardValue:points/10,completedAt:123,gameId:'verified-game-reference',status:'completed'});
function elements(node){return React.isValidElement(node)?[node,...React.Children.toArray(node.props.children).flatMap(elements)]:[]}

test('React score screen uses the game result and preserves exact rupee conversion',()=>{
 const html=renderToStaticMarkup(React.createElement(ScorePage,{result:result(3205)}));
 assert.match(html,/id="rewards-points">3,205<\//);assert.match(html.replace(/<[^>]+>/g,''),/₹320\.5 off/);
 assert.match(html,/SO\/ COINS/);assert.doesNotMatch(html,/>pts</);
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
   setAttribute(key,value){this[key]=value},getAttribute(key){return this[key]},focus(){captured.focused=id},prepend(){},querySelector:selector=>node(id+selector),
   addEventListener(type,fn){this[type+'Listener']=fn},showModal(){this.open=true},close(){this.open=false;this.closeListener?.()},click(){this.onclick?.()}});
  return nodes.get(id);
 };
 const source=readFileSync(new URL('../game-source/src/post-game-rewards.ts',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
 const compiled=await transform(source,{loader:'ts',format:'cjs'}),exports={};
 const context={exports,module:{exports},Date,Math,Number,URL,Element:class{},location:{origin:'http://test.local',href:'http://test.local/play.html'},
  document:{getElementById:node,querySelector:()=>node('header'),body:{prepend(){}},addEventListener:(key,fn)=>events.set(key,fn)},
  ResizeObserver:class{observe(){}disconnect(){}},addEventListener:(key,fn)=>events.set(key,fn),leaveCopy,
  mountRewardNoticeArtwork:()=>()=>{},mountScorePage:(_container,actions)=>{captured.actions=actions;return {render:value=>{captured.result=value;captured.scoreVisible=true},clear:()=>{captured.scoreVisible=false}}},window:{top:{location:{assign:value=>{captured.destination=value}}}},
 };
 vm.runInNewContext(compiled.code,context);
 const registered=[],openers=[],replays=[],boards=[];
 const controller=context.module.exports.connectPostGameRewards((value,opener)=>{registered.push(value);openers.push(opener.id)},()=>replays.push(true),()=>boards.push(true));
 return {controller,node,captured,registered,openers,replays,boards,events,element:context.Element};
}
test('score controller passes the immutable completed result and game ID into registration',async()=>{
 const fixture=await controllerFixture();fixture.controller.show(3205,'real-game-id');
 assert.equal(fixture.captured.result.points,3205);assert.equal(fixture.captured.result.rewardValue,320.5);assert.equal(Object.isFrozen(fixture.captured.result),true);
 fixture.captured.actions.onSave();assert.equal(fixture.registered[0],fixture.captured.result);assert.equal(fixture.registered[0].gameId,'real-game-id');assert.equal(fixture.openers[0],'rewards-register');
});
test('the score heading receives focus after its styles finish loading without interrupting an open menu',async()=>{
 const f=await controllerFixture();f.controller.show(200);f.captured.focused=null;
 f.controller.dialog['sofacet:page-readyListener']();assert.equal(f.captured.focused,'rewards-resulth1');
 f.node('nav-toggle').setAttribute('aria-expanded','true');f.captured.focused=null;
 f.controller.dialog['sofacet:page-readyListener']();assert.equal(f.captured.focused,null);
});
test('keyboard dismissal, keep, leave-anyway, replay and leaderboard retain their established flow',async()=>{
 const fixture=await controllerFixture();fixture.controller.show(4800,'game');
 const escape=()=>fixture.controller.dialog.oncancel({preventDefault(){}});
 fixture.captured.actions.onLeaderboard();assert.equal(fixture.boards.length,1);
 escape();assert.equal(fixture.controller.dialog.dataset.view,'leave');assert.equal(fixture.captured.scoreVisible,false);
 escape();assert.equal(fixture.controller.dialog.dataset.view,'result');assert.equal(fixture.captured.scoreVisible,true);
 escape();fixture.node('rewards-keep').click();assert.equal(fixture.registered[0].points,4800);assert.equal(fixture.openers[0],'rewards-keep');
 fixture.controller.show();escape();fixture.node('rewards-leave-anyway').click();assert.equal(fixture.controller.dialog.dataset.view,'exit');
 fixture.node('rewards-exit-play').click();assert.equal(fixture.replays.length,1);
 fixture.controller.clear();fixture.controller.show(9);escape();assert.equal(fixture.captured.destination,'/');
});

test('internal game pages can open over the score without treating it as discarded',async()=>{
 const f=await controllerFixture();f.controller.show(3205,'completed-game');
 const link={id:'skip-game',target:'_top',hasAttribute:name=>name==='data-game-info'};
 let prevented=false;
 f.events.get('click')({button:0,target:Object.assign(Object.create(f.element.prototype),{closest:()=>link}),preventDefault(){prevented=true;}});
 assert.equal(prevented,false);
 assert.equal(f.controller.result.points,3205);
 assert.equal(f.controller.dialog.dataset.view,'result');
});
