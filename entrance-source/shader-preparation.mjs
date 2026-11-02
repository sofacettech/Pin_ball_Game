import {Object3D, Frustum, Matrix4} from 'three';

const activePreparations=new WeakMap();

// Queue the programs used by the real camera/reflection/postprocessing passes
// before any draw waits for their compilation. Three's compile(scene) traverses
// even hidden/offscreen meshes, so give it only this pass's visible primitives,
// retaining the original scene for its lights, environment and material hooks.
export async function prepareVisibleShaders(renderer, draw, {cancelled=()=>false}={}) {
  const previous=activePreparations.get(renderer);
  if(previous)previous.superseded=true;
  const state={render:previous?.render??renderer.render,superseded:false};
  activePreparations.set(renderer,state);
  const stopped=()=>state.superseded||cancelled();
  const frustum=new Frustum(),projection=new Matrix4(),visible=new Object3D();
  const compile=(scene,camera)=>{
    if(stopped())return;
    scene.updateMatrixWorld();camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    const objects=[];
    scene.traverseVisible(object=>{
      if(!(object.isMesh||object.isLine||object.isPoints||object.isSprite)||!object.layers.test(camera.layers))return;
      if(object.frustumCulled&&(object.isSprite?!frustum.intersectsSprite(object):!frustum.intersectsObject(object)))return;
      objects.push(object);
    });
    visible.traverse=callback=>objects.forEach(callback);
    renderer.compile(visible,camera,scene);
  };
  renderer.render=compile;
  try { await draw(); } finally {
    if(activePreparations.get(renderer)===state){
      renderer.render=state.render;activePreparations.delete(renderer);
    }
  }
  if(stopped())return;
  const gl=renderer.getContext(),extension=gl.getExtension('KHR_parallel_shader_compile');
  gl.flush();
  if(!extension){await new Promise(resolve=>setTimeout(resolve,10));return;}
  // A material can have several lighting variants. Waiting on its currentProgram
  // alone would miss earlier views; poll every program queued by these passes.
  const pending=new Set(renderer.info.programs.map(program=>program.program));
  while(pending.size&&!stopped()){
    if(gl.isContextLost())throw new Error('WebGL context lost during scene preparation');
    for(const program of pending)if(gl.getProgramParameter(program,extension.COMPLETION_STATUS_KHR))pending.delete(program);
    if(pending.size)await new Promise(resolve=>setTimeout(resolve,10));
  }
}
