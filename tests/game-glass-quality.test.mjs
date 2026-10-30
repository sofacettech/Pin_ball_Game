import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {handheldGlass,batchOverview} from '../game-source/src/visual-quality.ts';

test('handheld canopy remains reflective and transparent without a transmission render pass',()=>{
  const full=new THREE.MeshPhysicalMaterial({
    name:'Tunnel canopy',transmission:.98,opacity:1,side:THREE.DoubleSide,
    envMapIntensity:1.25,roughness:.045,clearcoat:1,
  });
  const glass=handheldGlass(full);
  assert.ok(glass instanceof THREE.MeshStandardMaterial);
  assert.ok(!(glass instanceof THREE.MeshPhysicalMaterial));
  assert.equal(glass.transmission,undefined);
  assert.equal(glass.transparent,true);
  assert.ok(glass.opacity>0&&glass.opacity<.3);
  assert.equal(glass.depthWrite,false);
  assert.equal(glass.forceSinglePass,true);
  assert.equal(glass.envMapIntensity,full.envMapIntensity);
  assert.equal(glass.side,full.side);
  assert.equal(full.transmission,.98);
  assert.equal(full.opacity,1);
  assert.equal(full.transparent,false);
  assert.equal(full.depthWrite,true);
});

test('overview batching cannot retain the costly glass material after switching to handheld',()=>{
  const scene=new THREE.Scene();
  const full=new THREE.MeshPhysicalMaterial({transmission:.98});
  const solid=new THREE.MeshStandardMaterial();
  const canopy=[],opaque=[];
  for(let i=0;i<2;i++){
    for(const [material,list] of [[full,canopy],[solid,opaque]]){
      const mesh=new THREE.Mesh(new THREE.BoxGeometry(),material);
      mesh.userData.game_render_group='static_tunnel';
      scene.add(mesh);list.push(mesh);
    }
  }
  const batch=batchOverview(scene);
  batch.setEnabled(true);
  assert.equal(batch.originalDraws,2);
  assert.equal(batch.batchedDraws,1);
  for(const mesh of canopy){mesh.material=handheldGlass(full);assert.equal(mesh.visible,true)}
  for(const mesh of opaque)assert.equal(mesh.visible,false);
  scene.traverse(obj=>{
    if(obj instanceof THREE.Mesh&&obj.visible)assert.notEqual(obj.material,full);
  });
  batch.setEnabled(false);
  for(const mesh of [...canopy,...opaque])assert.equal(mesh.visible,true);
});
