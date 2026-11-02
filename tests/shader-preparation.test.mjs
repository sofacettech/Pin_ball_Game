import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene,Group,Mesh,BoxGeometry,MeshBasicMaterial,PerspectiveCamera} from 'three';
import {prepareVisibleShaders} from '../entrance-source/shader-preparation.mjs';

function fixture(){
  const scene=new Scene(),camera=new PerspectiveCamera(45,1,.1,100),compiled=[];
  camera.position.z=5;
  const geometry=new BoxGeometry(),material=new MeshBasicMaterial();
  const add=(parent=scene)=>{const mesh=new Mesh(geometry,material);parent.add(mesh);return mesh;};
  const programs=[],queried=[],gl={flush(){},getExtension:()=>({COMPLETION_STATUS_KHR:1}),isContextLost:()=>false,getProgramParameter(program){queried.push(program);return true;}};
  const render=()=>assert.fail('compilation must not draw');
  const renderer={render,info:{programs},getContext:()=>gl,compile(root,view,target){
    const objects=[];root.traverse(object=>objects.push(object));compiled.push({objects,view,target});
    programs.push({program:compiled.length});
  }};
  return {scene,camera,add,compiled,queried,renderer,render,gl};
}

test('preparation compiles visible primitives using the original lighting scene without reparenting',async()=>{
  const f=fixture(),shown=f.add(),offscreen=f.add(),hiddenParent=new Group();
  offscreen.position.x=100;f.scene.add(hiddenParent);hiddenParent.visible=false;f.add(hiddenParent);
  const hidden=f.add();hidden.visible=false;
  const otherLayer=f.add();otherLayer.layers.set(1);
  const uncullable=f.add();uncullable.position.x=100;uncullable.frustumCulled=false;
  await prepareVisibleShaders(f.renderer,()=>f.renderer.render(f.scene,f.camera));
  assert.deepEqual(f.compiled[0].objects,[shown,uncullable]);
  assert.equal(f.compiled[0].target,f.scene);assert.equal(f.compiled[0].view,f.camera);
  assert.equal(shown.parent,f.scene);assert.equal(f.renderer.render,f.render);
});

test('every queued program is checked even when later passes reuse a material',async()=>{
  const f=fixture();f.add();
  await prepareVisibleShaders(f.renderer,()=>{f.renderer.render(f.scene,f.camera);f.renderer.render(f.scene,f.camera);});
  assert.deepEqual(f.queried,[1,2]);assert.equal(f.renderer.render,f.render);
});

test('errors and cancellation restore rendering and stop readiness polling',async()=>{
  const f=fixture();f.add();
  await assert.rejects(prepareVisibleShaders(f.renderer,()=>{throw new Error('capture failed');}),/capture failed/);
  assert.equal(f.renderer.render,f.render);
  let cancelled=false;
  await prepareVisibleShaders(f.renderer,()=>{f.renderer.render(f.scene,f.camera);cancelled=true;},{cancelled:()=>cancelled});
  assert.deepEqual(f.queried,[]);assert.equal(f.renderer.render,f.render);
});

test('browsers without parallel compilation still restore normal drawing',async()=>{
  const f=fixture();f.add();f.gl.getExtension=()=>null;
  await prepareVisibleShaders(f.renderer,()=>f.renderer.render(f.scene,f.camera));
  assert.equal(f.renderer.render,f.render);assert.deepEqual(f.queried,[]);
});

test('an overlapping replacement cannot restore a cancelled compile callback as the renderer',async()=>{
  const f=fixture();f.add();let releaseOld,releaseNew;
  const old=prepareVisibleShaders(f.renderer,()=>new Promise(resolve=>{releaseOld=resolve;}));
  const newer=prepareVisibleShaders(f.renderer,()=>new Promise(resolve=>{releaseNew=resolve;}));
  releaseOld();await old;
  f.renderer.render(f.scene,f.camera);
  assert.equal(f.compiled.length,1,'new preparation remains active after the old one finishes');
  releaseNew();await newer;
  assert.equal(f.renderer.render,f.render);
});
