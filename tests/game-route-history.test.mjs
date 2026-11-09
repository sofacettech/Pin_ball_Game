import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {connectMembership} from '../game-source/src/membership.ts';

test('Claim pushes its public URL, Back closes its frame, without a browser leave prompt',async t=>{
 const originals=new Map(['window','document','location'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 t.after(()=>{for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]}});
 const listeners=new Map(),nodes=new Map(),visits=[],closed=[];
 const get=id=>{
  if(!nodes.has(id))nodes.set(id,{id,open:false,hidden:false,isConnected:true,addEventListener(){},focus(){},closest(){return null},
   showModal(){this.open=true},close(){this.open=false},remove(){visits.push('frame removed')},append(){visits.push('fresh frame attached')},contentWindow:{location:{replace:href=>visits.push(href)}}});
  return nodes.get(id);
 };
 const host={addEventListener:(type,callback)=>listeners.set(type,callback),removeEventListener(){}};host.top=host;
 host.history={state:{sofacetGame:true},pushState(state,_,url){this.previous=this.state;this.state=state;visits.push(url)},back(){this.state=this.previous;listeners.get('popstate')({state:this.state})}};
 Object.defineProperty(globalThis,'window',{configurable:true,value:host});
 Object.defineProperty(globalThis,'document',{configurable:true,value:{getElementById:get,body:{classList:{add(){},remove(){}}}}});
 Object.defineProperty(globalThis,'location',{configurable:true,value:{origin:'http://fixture.local'}});
 const membership=connectMembership({beforeOpen(){},afterClose:(...args)=>closed.push(args),refreshPlayer:async()=>{},onReplay(){},onLeaderboard(){},onDiscard(){},pendingResult:()=>null});
 membership.updatePlayer({member:false,display_name:'Guest',best_score:null});
 await membership.open(undefined,{points:3205,rewardValue:320.5,completedAt:1,status:'completed'});
 assert.deepEqual(visits,['/claim','/claim?nav=game']);
 assert.equal(listeners.has('beforeunload'),false);
 membership.close(true);
 assert.equal(get('registration-dialog').open,false);assert.deepEqual(visits.slice(-2),['frame removed','fresh frame attached']);assert.deepEqual(closed,[[false,true]]);
});

test('standalone and embedded reward flows do not add a native leave prompt',()=>{
 for(const file of ['collective-source/AuthFlow.jsx','game-source/src/post-game-rewards.ts']){
  const source=readFileSync(new URL('../'+file,import.meta.url),'utf8');
  assert.doesNotMatch(source,/addEventListener\(['"]beforeunload['"]/);
 }
});
