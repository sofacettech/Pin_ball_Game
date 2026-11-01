import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Reflector} from 'three/addons/objects/Reflector.js';
import {copyReflectionCamera} from '../entrance-source/reflection-camera.mjs';

function captureMatrix(camera,normal,point,correct=true){
 const mirror=new Reflector(new THREE.PlaneGeometry(1,1));
 mirror.position.copy(point);mirror.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),normal);mirror.updateMatrixWorld();
 const renderer={xr:{enabled:false},shadowMap:{autoUpdate:false},autoClear:true,state:{buffers:{depth:{setMask(){}}}},getRenderTarget:()=>null,setRenderTarget(){},render(){}};
 const view=correct?copyReflectionCamera(camera,new THREE.PerspectiveCamera()):camera;
 mirror.onBeforeRender(renderer,new THREE.Scene(),view);
 const matrix=mirror.material.uniforms.textureMatrix.value.clone().multiply(mirror.matrixWorld.clone().invert());mirror.dispose();mirror.geometry.dispose();return matrix;
}

test('shifted portrait and landscape views retain every visible floor/wall reflection',()=>{
 for(const [normal,point,position] of [
  [[0,1,0],[0,0,0],[3,7,14]],[[0,0,1],[0,0,0],[4,3,12]],[[0,-1,0],[0,10,0],[2,2,14]]
 ])for(const [x,y,width,height] of [[900,0,393,735],[0,90,393,735],[320,240,844,390],[0,0,1600,900]]){
  const n=new THREE.Vector3(...normal),p=new THREE.Vector3(...point),camera=new THREE.PerspectiveCamera(48,16/9,.1,1000);
  camera.position.set(...position);camera.lookAt(p);camera.setViewOffset(1600,900,x,y,width,height);camera.updateMatrixWorld();
  const original=camera.projectionMatrix.clone(),world=camera.matrixWorld.clone(),view={...camera.view},matrix=captureMatrix(camera,n,p),plane=new THREE.Plane().setFromNormalAndCoplanarPoint(n,p);
  let checked=0;
  for(const x of [-.9,0,.9])for(const y of [-.9,-.5,0]){
   const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(x,y),camera);
   const hit=ray.ray.intersectPlane(plane,new THREE.Vector3());if(!hit)continue;
   const uv=hit.applyMatrix4(matrix);checked++;
   assert.ok(Math.abs(uv.x-(1-x)/2)<1e-8,`horizontal crop: ${uv.x}`);
   assert.ok(Math.abs(uv.y-(1+y)/2)<1e-8,`vertical crop: ${uv.y}`);
  }
  assert.ok(checked>=3);assert.deepEqual(camera.projectionMatrix,original);assert.deepEqual(camera.matrixWorld,world);assert.deepEqual(camera.view,view);
 }
});

test('the reported chamber offset would discard the ball reflection without correction',()=>{
 const camera=new THREE.PerspectiveCamera(48,393/735,.05,5000);camera.position.set(41,7,-33);camera.lookAt(31,4,-35);camera.updateMatrixWorld();
 camera.projectionMatrix.elements[8]=.8704727396098386;camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
 const n=new THREE.Vector3(0,1,0),p=new THREE.Vector3(0,4.05,0),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(0,-.9),camera);
 const hit=ray.ray.intersectPlane(new THREE.Plane(n,-4.05),new THREE.Vector3());
 assert.ok(hit.clone().applyMatrix4(captureMatrix(camera,n,p,false)).x<0,'old mirror misses the visible floor');
 assert.ok(Math.abs(hit.applyMatrix4(captureMatrix(camera,n,p)).x-.5)<1e-8);
});

test('reflection camera inverse remains consistent after reusing the camera across crops',()=>{
 const source=new THREE.PerspectiveCamera(45,16/9,.1,1000),target=new THREE.PerspectiveCamera();
 for(const x of [0,800,100,1200]){
  source.setViewOffset(1600,900,x,0,393,735);copyReflectionCamera(source,target);
  const product=target.projectionMatrix.clone().multiply(target.projectionMatrixInverse),identity=new THREE.Matrix4();
  product.elements.forEach((value,i)=>assert.ok(Math.abs(value-identity.elements[i])<1e-10));
 }
});
