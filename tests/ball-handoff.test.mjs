import test from 'node:test';
import assert from 'node:assert/strict';
import {AnimationClip,AnimationMixer,Group,LoopOnce,Quaternion,QuaternionKeyframeTrack,VectorKeyframeTrack} from 'three';
import {createBallHandoff} from '../entrance-source/ball-handoff.mjs';

function fixture(){
 const root=new Group(),tracks=[],pairs=[];
 for(const [i,part] of ['InnerCore','Panel_01 • 6 sides'].entries()){
  const from=new Group(),to=new Group();from.name=`exterior${i}`;to.name=`interior${i}`;
  from.userData.source_name=`Travel exterior ball | ${part}`;to.userData.source_name=`Same starting ball | ${part}`;root.add(from,to);
  const turn=new Quaternion().setFromAxisAngle({x:0,y:1,z:0},.1),scale=1+i*.05;
  tracks.push(new VectorKeyframeTrack(`${from.name}.position`,[925,931], [24,8,-2,139,6,221]),new VectorKeyframeTrack(`${to.name}.position`,[925,931],[31,6,-23,24.1,7.9,-2.5]),
   new VectorKeyframeTrack(`${from.name}.scale`,[925,931],[scale,scale,scale,0,0,0]),new VectorKeyframeTrack(`${to.name}.scale`,[925,931],[0,0,0,scale*.98,scale*.98,scale*.98]),
   new QuaternionKeyframeTrack(`${from.name}.quaternion`,[925,931],[0,0,0,1,0,0,0,1]),new QuaternionKeyframeTrack(`${to.name}.quaternion`,[925,931],[0,0,0,1,...turn.toArray()]));pairs.push({from,to,scale});
 }
 const mixer=new AnimationMixer(root),action=mixer.clipAction(new AnimationClip('handoff',1000,tracks));action.setLoop(LoopOnce,1);action.clampWhenFinished=true;action.play();
 const sample=at=>mixer.setTime(at),handoff=createBallHandoff(root,{sample,restoreFrame:924});
 return{root,pairs,sample,handoff,mixer};
}

test('the baked copy switch cannot move or shrink the visible ball to its storage pose',()=>{
 const {pairs,sample,handoff}=fixture();
 // Revisit and reverse across the switch, including repeated sharp redraws.
 for(const frame of [925,925.01,926,927.5,928,929,930.99,931,932,930.99,929,929,927,925,924]){
  sample(frame);const original=pairs.map(({from,to})=>[from.position.clone(),from.scale.clone(),to.scale.clone()]);handoff.apply(frame);
  for(const [i,{from,to,scale}] of pairs.entries()){
   if(frame<925||frame>=931){assert.ok(from.position.equals(original[i][0]));assert.ok(from.scale.equals(original[i][1]));assert.ok(to.scale.equals(original[i][2]));continue;}
   const t=(frame-925)/6;assert.ok(Math.abs(from.position.x-(24+.1*t))<1e-5);assert.ok(Math.abs(from.position.z-(-2-.5*t))<1e-5);
   assert.ok(Math.abs(from.scale.x-scale*(1-.02*t))<1e-6);assert.equal(to.scale.length(),0);
   const expected=new Quaternion().setFromAxisAngle({x:0,y:1,z:0},.1*t);assert.ok(from.quaternion.angleTo(expected)<.001);
  }
 }
});

test('sampling the handoff restores the requested startup pose and keeps facet transforms separate',()=>{
 const {pairs,mixer}=fixture();assert.equal(mixer.time,924);
 assert.ok(pairs[1].from.scale.x>pairs[0].from.scale.x);
});

test('a missing counterpart fails before sampling an incomplete ball',()=>{
 const root=new Group(),part=new Group();part.userData.source_name='Travel exterior ball | InnerCore';root.add(part);
 assert.throws(()=>createBallHandoff(root,{sample:()=>assert.fail('must not sample'),restoreFrame:334}),/matching facets/);
});
