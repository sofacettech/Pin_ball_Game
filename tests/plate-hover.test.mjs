import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createPlateHover} from '../plate-hover.js';

test('preparation waves reuse authored poses, stay bounded, and settle without drift',async t=>{
 const originalFetch=globalThis.fetch;
 const model=new THREE.Group(),spec={fps:60,response:8,neighbourLift:.65,plates:{}},tracks=[];
 for(let i=0;i<43;i++){
  const object=new THREE.Object3D();object.name='plate'+i;object.userData={part:'plate',source_name:object.name};model.add(object);
  spec.plates[object.name]={peakFrame:30+i,neighbours:[]};
  tracks.push(new THREE.VectorKeyframeTrack(object.name+'.position',[0,2],[0,0,0,0,2,0]));
 }
 globalThis.fetch=async()=>({ok:true,json:async()=>spec});
 t.after(()=>{globalThis.fetch=originalFetch});
 const hover=await createPlateHover(model,new THREE.AnimationClip('split',2,tracks));
 for(let i=0;i<600;i++){
  hover.restoreBase();hover.wave(i/60);hover.update(1/60);
  for(const plate of hover.plates.values()){
   assert.ok(plate.weight>=0&&plate.weight<=.62);
   assert.ok(plate.object.position.y<=plate.peakPosition.y*.62+1e-6);
  }
 }
 assert.ok(new Set([...hover.plates.values()].map(p=>p.target.toFixed(3))).size>30,'Different plates must travel in a wave');
 hover.clear();
 for(let i=0;i<150;i++){hover.restoreBase();hover.update(1/60)}
 for(const plate of hover.plates.values()){
  assert.equal(plate.target,0);assert.equal(plate.weight,0);assert.equal(plate.object.position.length(),0);
 }
});
