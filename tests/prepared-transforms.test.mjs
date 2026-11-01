import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createPreparedTransforms} from '../entrance-source/prepared-transforms.mjs';

function fixture(){
  const scene=new THREE.Scene(),root=new THREE.Group(),fixed=new THREE.Group(),moving=new THREE.Group(),child=new THREE.Group(),facet=new THREE.Group();
  moving.name='moving';facet.name='facet';
  scene.position.set(2,3,4);root.rotation.y=.4;fixed.position.set(-3,2,1);
  moving.position.set(1,2,3);child.position.set(-2,3,4);facet.scale.set(.9,1.1,1);
  scene.add(root);root.add(fixed,moving);moving.add(child);child.add(facet);
  const clip=new THREE.AnimationClip('motion',2,[
    new THREE.VectorKeyframeTrack('moving.position',[0,1,2],[1,2,3,8,4,-2,-1,6,4]),
    new THREE.QuaternionKeyframeTrack('moving.quaternion',[0,2],[0,0,0,1,0,Math.sin(.7),0,Math.cos(.7)]),
    new THREE.VectorKeyframeTrack('facet.scale',[0,1,2],[1,1,1,0,0,0,1,1,1]),
  ]);
  const mixer=new THREE.AnimationMixer(root);mixer.clipAction(clip).play();
  return {scene,root,fixed,moving,child,facet,clip,mixer};
}

test('prepared matrices match Three across fractional poses, zero scale and reverse seeks',()=>{
  const a=fixture(),b=fixture(),prepared=createPreparedTransforms(b.root,[b.clip]);
  for(const time of [0,.1,.999,1,1.001,1.5,1.9,.8,0]){
    a.mixer.setTime(time);b.mixer.setTime(time);a.scene.updateMatrixWorld(true);prepared.update();
    // Mirrors and transmission passes force traversal several times per frame.
    for(let pass=0;pass<4;pass++)b.scene.updateMatrixWorld(true);
    for(const key of ['root','fixed','moving','child','facet']){
      a[key].matrixWorld.elements.forEach((value,i)=>assert.ok(Math.abs(value-b[key].matrixWorld.elements[i])<1e-12,`${key} at ${time}`));
    }
  }
  prepared.restore();
});

test('static matrices are reused and animated branches update once across rendering passes',()=>{
  const f=fixture(),prepared=createPreparedTransforms(f.root,[f.clip]);
  const counts={fixed:0,moving:0,child:0,facet:0};
  for(const key of Object.keys(counts)){
    const matrix=f[key].matrixWorld,multiply=matrix.multiplyMatrices.bind(matrix);
    matrix.multiplyMatrices=(...args)=>{counts[key]++;return multiply(...args);};
  }
  f.mixer.setTime(.5);prepared.update();
  for(let pass=0;pass<6;pass++)f.scene.updateMatrixWorld(true);
  assert.deepEqual(counts,{fixed:0,moving:1,child:1,facet:1});
  prepared.restore();f.moving.position.x=55;f.scene.updateMatrixWorld(true);
  assert.equal(f.moving.matrixAutoUpdate,true);assert.equal(f.fixed.matrixWorldAutoUpdate,true);
  assert.equal(counts.fixed,1);assert.equal(counts.moving,2);
});

test('explicit assembly objects and a moved model parent invalidate the right matrices',()=>{
  const a=fixture(),b=fixture(),prepared=createPreparedTransforms(b.root,[b.clip],{dynamicObjects:[b.fixed]});
  a.fixed.position.y=b.fixed.position.y=12;a.scene.rotation.z=b.scene.rotation.z=.8;
  a.scene.updateMatrixWorld(true);prepared.update();
  for(const key of ['root','fixed','moving','child','facet'])assert.deepEqual(b[key].matrixWorld.elements,a[key].matrixWorld.elements);
  prepared.restore();prepared.restore();
});

test('unsupported animation bindings leave the model on normal Three traversal',()=>{
  const f=fixture(),clip=new THREE.AnimationClip('bone',1,[new THREE.VectorKeyframeTrack('moving.bones[Head].position',[0,1],[0,0,0,1,2,3])]);
  assert.equal(createPreparedTransforms(f.root,[clip]),null);
  assert.equal(f.moving.matrixAutoUpdate,true);assert.equal(f.root.matrixWorldAutoUpdate,true);
});
