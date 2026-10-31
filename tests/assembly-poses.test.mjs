import test from 'node:test';
import assert from 'node:assert/strict';
import {Group,Object3D} from 'three';
import {createAssemblyPoses} from '../entrance-source/assembly-poses.mjs';

function fixture(){
 const root=new Group(),anchor=new Object3D(),facet=new Object3D();root.add(anchor,facet);root.position.x=5;
 let samples=0;
 const sample=frame=>{
  samples++;
  if(frame===680){
   anchor.position.set(100,20,0);facet.position.set(100,22,0);
   for(const object of [anchor,facet]){object.rotation.set(0,0,Math.PI/2);object.scale.setScalar(2);}
  }else{
   anchor.position.set(10,0,0);facet.position.set(11+(240-frame)/120,0,0);
   for(const object of [anchor,facet]){object.rotation.set(0,0,0);object.scale.setScalar(1);}
  }
  root.updateMatrixWorld(true);
 };
 const poses=createAssemblyPoses({objects:[anchor,facet],anchor,sample,targetFrame:680});
 return{root,anchor,facet,poses,get samples(){return samples}};
}
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-5,actual+' != '+expected);

test('cached fragment motion relocates and rotates into the new spawn without moving its scene parent',()=>{
 const view=fixture();view.poses.apply(120);
 close(view.anchor.position.x,100);close(view.anchor.position.y,20);
 close(view.facet.position.x,100);close(view.facet.position.y,24);close(view.facet.scale.x,2);
 close(view.facet.rotation.z,Math.PI/2);close(view.root.position.x,5);
});

test('cached playback interpolates fractional poses without evaluating the scene animation again',()=>{
 const view=fixture(),samples=view.samples;view.poses.apply(120.5);
 close(view.facet.position.y,24-1/120);
 for(let i=0;i<1000;i++)view.poses.apply(1+(i%239));
 assert.equal(view.samples,samples);assert.equal(view.poses.byteLength,240*2*10*4);
});

test('the final cached pose exactly matches the authored new start for a seamless scroll handoff',()=>{
 const view=fixture();view.poses.apply(100);view.poses.apply(240);
 close(view.facet.position.x,100);close(view.facet.position.y,22);close(view.facet.scale.x,2);
 view.poses.apply(999);close(view.facet.position.y,22);
});
