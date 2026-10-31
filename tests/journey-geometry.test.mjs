import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {prepareJourneyGeometry} from '../entrance-source/geometry-budget.mjs';

test('mobile simplification preserves vertex attributes and bounds while reducing redundant faces',async()=>{
 const geometry=new THREE.PlaneGeometry(10,10,100,100),root=new THREE.Group(),material=new THREE.MeshStandardMaterial();
 const position=geometry.attributes.position,normal=geometry.attributes.normal,uv=geometry.attributes.uv;
 const original=geometry.index.count;root.add(new THREE.Mesh(geometry,material));
 const result=await prepareJourneyGeometry(root);
 assert.ok(geometry.index.count<original/2);assert.equal(geometry.attributes.position,position);assert.equal(geometry.attributes.normal,normal);assert.equal(geometry.attributes.uv,uv);
 assert.ok(result.maxRelativeError<=.0002);assert.equal(result.optimizedGeometries,1);
 for(const index of geometry.index.array)assert.ok(index<position.count);
});

test('facet ball, lettering, animated morphs and multi-material geometry retain original indices',async()=>{
 const root=new THREE.Group(),geometries=[];
 for(const name of ['SOFACET ball | silver','Logo lettering','plain','multi']){
  const geometry=new THREE.PlaneGeometry(10,10,100,100),material=new THREE.MeshStandardMaterial();material.name=name;
  if(name==='plain')geometry.morphAttributes.position=[geometry.attributes.position.clone()];
  if(name==='multi'){geometry.addGroup(0,30000,0);geometry.addGroup(30000,30000,1);}
  root.add(new THREE.Mesh(geometry,material));geometries.push([geometry,geometry.index]);
 }
 const result=await prepareJourneyGeometry(root);assert.equal(result.optimizedGeometries,0);
 for(const [geometry,index] of geometries)assert.equal(geometry.index,index);
});

test('shared geometry is counted once and protection on any instance applies to all',async()=>{
 const geometry=new THREE.PlaneGeometry(10,10,100,100),root=new THREE.Group(),index=geometry.index;
 const ordinary=new THREE.MeshStandardMaterial(),protectedMaterial=new THREE.MeshStandardMaterial();protectedMaterial.name='SOFACET ball | silver';
 root.add(new THREE.Mesh(geometry,ordinary),new THREE.Mesh(geometry,protectedMaterial));
 const result=await prepareJourneyGeometry(root);assert.equal(result.originalTriangles,index.count/3);assert.equal(result.optimizedGeometries,0);assert.equal(geometry.index,index);
});
