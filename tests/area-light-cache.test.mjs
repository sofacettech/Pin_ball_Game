import test from 'node:test';
import assert from 'node:assert/strict';
import {MeshPhysicalMaterial,Texture} from 'three';
import {canShareAreaCoat} from '../entrance-source/area-light-cache.mjs';

test('only equal unperturbed area-light lobes share their integral',()=>{
 const m=new MeshPhysicalMaterial({roughness:.18,clearcoat:1,clearcoatRoughness:.18});
 assert.equal(canShareAreaCoat(m),true);
 m.clearcoatRoughness=.19;assert.equal(canShareAreaCoat(m),false);
 m.roughness=.01;m.clearcoatRoughness=.02;assert.equal(canShareAreaCoat(m),true,'both clamp to the same minimum in the physical shader');
 m.clearcoat=0;assert.equal(canShareAreaCoat(m),false);
});

test('normal, bump and roughness textures keep independently evaluated lobes',()=>{
 for(const property of ['normalMap','bumpMap','clearcoatNormalMap','roughnessMap','clearcoatRoughnessMap']){
  const m=new MeshPhysicalMaterial({roughness:.18,clearcoat:1,clearcoatRoughness:.18});m[property]=new Texture();
  assert.equal(canShareAreaCoat(m),false,property);
 }
});
