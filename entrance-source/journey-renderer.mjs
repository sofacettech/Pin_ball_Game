import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { entranceRenderPolicy } from './render-policy.mjs';
import { createAnimatedMeshBatch } from './animated-mesh-batch.mjs';
import { createAssemblyPoses, findAssemblyObjects } from './assembly-poses.mjs';
import { JOURNEY_START_FRAME } from './journey-scroll.mjs';
import { createExteriorLook } from './exterior-look.mjs';
import { createInteriorLook } from './interior-look.mjs';
import { createChessLook } from './chess-look.mjs';
import { createCinematicPass, matchExteriorPalette } from './cinematic-look.mjs';

export async function createJourneyRenderer({stage,pixelRatio=()=>Math.min(2,devicePixelRatio),cinematicEnabled=()=>true,onStatus=()=>{},onRender=()=>{},profile=false,performanceMode=false,renderView=()=>null}){
const base='/assets/entrance-3d/';
const policy=entranceRenderPolicy({quality:performanceMode?new URLSearchParams(location.search).get('quality'):'reference',
  userAgent:navigator.userAgent,platform:navigator.platform,maxTouchPoints:navigator.maxTouchPoints});
const renderer=new THREE.WebGLRenderer({antialias:policy.canvasAntialias,powerPreference:'high-performance'});
const chosenPixelRatio=()=>Math.min(policy.maxPixelRatio,Math.max(.5,pixelRatio()));
renderer.setPixelRatio(chosenPixelRatio());renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;
renderer.transmissionResolutionScale=performanceMode?.5:1;
stage.prepend(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color('#101827');
const pmrem=new THREE.PMREMGenerator(renderer);const envScene=new RoomEnvironment();
const env=pmrem.fromScene(envScene,.04);scene.environment=env.texture;scene.environmentIntensity=.4;
envScene.dispose();pmrem.dispose();
const ambient=new THREE.HemisphereLight(0xb9ceff,0x11091d,.3);scene.add(ambient);
const sun=new THREE.DirectionalLight(0xfff7e7,1.25);sun.position.set(-10,50,35);scene.add(sun);
const fill=new THREE.DirectionalLight(0x9872ff,1.5);fill.position.set(30,10,-10);scene.add(fill);
const camera=new THREE.PerspectiveCamera(45,16/9,.05,5000);
const exterior=createExteriorLook(scene,renderer,{captureReflection,performanceMode,reflectionSamples:policy.reflectionSamples,reflectionWidth:policy.exteriorReflectionWidth});
const interior=createInteriorLook(scene,renderer,{reflectionPass:exterior.reflectionPass,captureReflection,performanceMode,reflectionWidth:policy.chamberReflectionWidth});
const chess=createChessLook(scene,renderer,{captureReflection,performanceMode,reflectionSamples:policy.reflectionSamples,reflectionScale:policy.chessReflectionScale});
const composer=new EffectComposer(renderer,new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,samples:Math.min(policy.mainSamples,renderer.capabilities.maxSamples)}));composer.addPass(new RenderPass(scene,camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(1024,576),.035,.05,2.2));
// Blend subpixel neon edges after bloom, in linear color before display output.
if(!performanceMode)composer.addPass(new SMAAPass());
const cinematic=createCinematicPass();composer.addPass(cinematic);
// FXAA runs on the final display colours and avoids resolving multisampled
// HDR buffers on Apple mobile GPUs. Preserve bloom and the approved grade.
const fxaa=policy.mobile?new ShaderPass(FXAAShader):null;
if(fxaa)composer.addPass(fxaa);
renderer.info.autoReset=false;
const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const motion=await fetch(base+'camera-motion.json').then(r=>r.json());
const metadataPromise=fetch(base+'variants.json').then(r=>r.ok?r.json():{}).catch(()=>({}));
let model,mixer,actions=[],frame=JOURNEY_START_FRAME,preparing=false,loadID=0,suspended=false,disposed=false;
let assemblyPoses,assemblyPose=null,assemblyBaseNeedsReset=true,lastAssemblyReflectionPose=null;
let loadMs=0,modelBytes=0,renderRequested=0;
let ballBatches=[];
const batchingMode=!performanceMode?'individual':policy.mobile||!renderer.extensions.has('WEBGL_multi_draw')?'portable':'multi-draw';
let reflectionBindings=[],reflectionMaterials=new Map();
let lastReflectionFrame=null,entryReflectionTurn=0;
const q0=new THREE.Quaternion(),q1=new THREE.Quaternion();
const lerp=THREE.MathUtils.lerp;
function prepareStableLighting(){
  if(!performanceMode)return;
  // Keep the same light slots across rooms. Zero-intensity lights skip their
  // BRDF work instead of changing the shader layout at the doorway.
  const done=new Set();
  model.traverse(object=>{
    for(const material of object.material?(Array.isArray(object.material)?object.material:[object.material]):[]){
      if(!material.isMeshStandardMaterial||done.has(material))continue;done.add(material);
      const compile=material.onBeforeCompile,key=material.customProgramCacheKey.bind(material);
      material.onBeforeCompile=shader=>{
        compile(shader);
        // Some facade/water hooks already expanded this chunk. Apply guards
        // after those hooks too, so inactive room lights do no BRDF work.
        shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_begin>',THREE.ShaderChunk.lights_fragment_begin)
          .replaceAll('RE_Direct( directLight,','if ( directLight.visible ) RE_Direct( directLight,')
          .replaceAll('RE_Direct_RectArea( rectAreaLight,','if ( any( greaterThan( rectAreaLight.color, vec3( 0.0 ) ) ) ) RE_Direct_RectArea( rectAreaLight,');
      };
      material.customProgramCacheKey=()=>key()+'-stable-light-slots-v2';material.needsUpdate=true;
    }
  });
}
function prepareReflectionMaterials(){
  if(!performanceMode)return;
  model.traverse(object=>{
    if(!object.isMesh)return;
    const sources=Array.isArray(object.material)?object.material:[object.material];
    if(!sources.some(m=>m.transmission>0))return;
    for(const source of sources){
      if(!(source.transmission>0)||reflectionMaterials.has(source))continue;
      const reflected=source.clone();
      reflected.onBeforeCompile=source.onBeforeCompile;
      reflected.customProgramCacheKey=source.customProgramCacheKey.bind(source);
      // A secondary reflection needs a glass silhouette and reflected light,
      // not another full-scene transmission buffer inside each mirror.
      reflected.transmission=0;reflected.transparent=true;reflected.depthWrite=false;
      reflected.forceSinglePass=true;
      reflectionMaterials.set(source,reflected);
    }
    reflectionBindings.push({object,original:object.material,sources,materials:[...sources]});
  });
}
function captureReflection(draw){
  if(!performanceMode||!reflectionBindings.length){draw();return;}
  for(const [source,reflected] of reflectionMaterials){
    reflected.color.copy(source.color);reflected.emissive.copy(source.emissive);
    reflected.emissiveIntensity=source.emissiveIntensity;reflected.envMap=source.envMap;
    reflected.envMapIntensity=source.envMapIntensity;reflected.roughness=source.roughness;
    reflected.opacity=Math.max(.3,1-source.transmission*.65);
  }
  for(const binding of reflectionBindings){
    binding.sources.forEach((m,i)=>{binding.materials[i]=m.transmission>0?reflectionMaterials.get(m):m;});
    binding.object.material=Array.isArray(binding.original)?binding.materials:binding.materials[0];
  }
  try{draw();}finally{for(const {object,original} of reflectionBindings)object.material=original;}
}
const profileFrames=[];
const gl=renderer.getContext(),timerExtension=profile?gl.getExtension('EXT_disjoint_timer_query_webgl2'):null,pendingTimers=[];
function pollTimers(){
  if(!timerExtension)return;
  const disjoint=gl.getParameter(timerExtension.GPU_DISJOINT_EXT);
  for(let i=pendingTimers.length-1;i>=0;i--){const item=pendingTimers[i];if(disjoint||gl.getQueryParameter(item.query,gl.QUERY_RESULT_AVAILABLE)){if(!disjoint)item.timings['gpu_'+item.name]=gl.getQueryParameter(item.query,gl.QUERY_RESULT)/1e6;gl.deleteQuery(item.query);pendingTimers.splice(i,1);}}
}

function resize(){const rect=stage.getBoundingClientRect();renderer.setPixelRatio(chosenPixelRatio());renderer.setSize(rect.width,rect.height,false);composer.setPixelRatio(renderer.getPixelRatio());composer.setSize(rect.width,rect.height);fxaa?.uniforms.resolution.value.set(1/renderer.domElement.width,1/renderer.domElement.height);camera.aspect=motion.aspect;camera.updateProjectionMatrix();lastReflectionFrame=null;lastAssemblyReflectionPose=null;requestRender();}
const observer=new ResizeObserver(resize);observer.observe(stage);

function sampleCamera(at){
  const path=motion.camera;let lo=0,hi=path.length-1;
  while(lo+1<hi){const mid=(lo+hi)>>1;if(path[mid].frame<=at)lo=mid;else hi=mid;}
  const a=path[lo],b=path[hi],t=THREE.MathUtils.clamp((at-a.frame)/(b.frame-a.frame),0,1);
  camera.position.fromArray(a.position).lerp(new THREE.Vector3().fromArray(b.position),t);
  q0.fromArray(a.quaternion);q1.fromArray(b.quaternion);camera.quaternion.copy(q0).slerp(q1,t);
  camera.fov=lerp(a.fov,b.fov,t);camera.near=a.near;camera.far=a.far;camera.updateProjectionMatrix();
  const view=renderView();if(view)camera.setViewOffset(view.fullWidth,view.fullHeight,view.x,view.y,view.width,view.height);else if(camera.view?.enabled)camera.clearViewOffset();
}
function batchBall(){
  const groups=new Map();
  model.traverse(object=>{
    if(!object.isMesh||Array.isArray(object.material)||!object.material.name.startsWith('SOFACET ball |'))return;
    const group=groups.get(object.material)??[];group.push(object);groups.set(object.material,group);
  });
  for(const [material,objects] of groups){
    if(batchingMode==='portable'){
      const portable=createAnimatedMeshBatch(objects,material);
      objects.forEach(object=>{object.visible=false;});
      model.add(portable.mesh);ballBatches.push({portable});
      continue;
    }
    const geometries=[...new Set(objects.map(o=>o.geometry))];
    const batch=new THREE.BatchedMesh(objects.length,geometries.reduce((n,g)=>n+g.attributes.position.count,0),geometries.reduce((n,g)=>n+g.index.count,0),material);
    batch.name='Animated ball facet batch';batch.frustumCulled=false;batch.sortObjects=false;
    const ids=new Map(geometries.map(g=>[g,batch.addGeometry(g)]));
    const instances=objects.map(object=>{object.visible=false;return {object,id:batch.addInstance(ids.get(object.geometry))};});
    // Custom chamber reflections need the per-instance transform as well.
    const compile=material.onBeforeCompile,key=material.customProgramCacheKey.bind(material);
    material.onBeforeCompile=shader=>{compile(shader);shader.vertexShader=shader.vertexShader.replaceAll('(modelMatrix*vec4(transformed,1.)).xyz','journeyWorldPosition.xyz').replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
      vec4 journeyWorldPosition=vec4(transformed,1.);
      #ifdef USE_BATCHING
        journeyWorldPosition=batchingMatrix*journeyWorldPosition;
      #endif
      journeyWorldPosition=modelMatrix*journeyWorldPosition;`);};
    material.customProgramCacheKey=()=>key()+'-animated-ball-batch';material.needsUpdate=true;
    model.add(batch);ballBatches.push({batch,instances});
  }
}
const batchInverse=new THREE.Matrix4(),batchMatrix=new THREE.Matrix4();
function updateBallBatches(){
  if(!ballBatches.length)return;
  model.updateMatrixWorld(true);batchInverse.copy(model.matrixWorld).invert();
  for(const {batch,instances,portable} of ballBatches){
    if(portable){portable.update(batchInverse);continue;}
    for(const {object,id} of instances)batch.setMatrixAt(id,batchMatrix.multiplyMatrices(batchInverse,object.matrixWorld));
  }
}
function render(){
  renderRequested=0;if(!model||preparing||suspended||disposed)return;
  pollTimers();
  const timings={frame},started=profile?performance.now():0;let measured=started,query=null;
  const beginTimer=()=>{if(timerExtension){query=gl.createQuery();gl.beginQuery(timerExtension.TIME_ELAPSED_EXT,query);}};
  beginTimer();
  const mark=name=>{if(profile){const now=performance.now();timings[name]=now-measured;measured=now;if(query){gl.endQuery(timerExtension.TIME_ELAPSED_EXT);pendingTimers.push({query,timings,name});query=null;}if(name!=='main')beginTimer();}};
  if(assemblyPose!==null){
    if(assemblyBaseNeedsReset){mixer.setTime(JOURNEY_START_FRAME/motion.fps);assemblyBaseNeedsReset=false;}
    assemblyPoses.apply(assemblyPose);
  }else mixer?.setTime(frame/motion.fps);
  updateBallBatches();sampleCamera(frame);
  mark('animation');
  const outside=1-THREE.MathUtils.smoothstep(frame,780,940);
  const chamber=interior.update(frame);
  const gallery=chess.update(frame);
  cinematic.setLook(chamber,gallery,cinematicEnabled(),outside);
  renderer.toneMappingExposure=lerp(lerp(lerp(1,.8,outside),.9,chamber),.95,gallery);
  ambient.intensity=lerp(lerp(lerp(.65,.18,outside),.3,chamber),.23,gallery);
  sun.intensity=lerp(lerp(lerp(1.25,.45,outside),.2,chamber),.2,gallery);
  fill.intensity=lerp(lerp(lerp(1.5,.25,outside),.32,chamber),.12,gallery);
  scene.environmentIntensity=lerp(lerp(.4,.18,outside),.12,chamber);
  // Both floor captures overlap at the doorway. Alternate them during small
  // movements, retaining each texture's capture matrix for reprojection. Refresh
  // both on entry, resize or a seek so a stale capture cannot leave a blank edge.
  const alternate=performanceMode&&frame>680&&frame<940&&lastReflectionFrame>680&&lastReflectionFrame<940&&Math.abs(frame-lastReflectionFrame)<8;
  const exteriorTurn=entryReflectionTurn++%2===0;
  lastReflectionFrame=frame;
  // The opening camera is stationary: refresh its planar reflection at 30 Hz
  // while the main ball animation still renders on every requested frame.
  const reflectAssembly=assemblyPose===null||lastAssemblyReflectionPose===null||Math.abs(assemblyPose-lastAssemblyReflectionPose)>=2||assemblyPose===240;
  if(assemblyPose!==null&&reflectAssembly)lastAssemblyReflectionPose=assemblyPose;
  mark('lighting');renderer.info.reset();exterior.update(camera,frame,(!alternate||exteriorTurn)&&reflectAssembly);mark('exterior');
  if(!alternate||!exteriorTurn)interior.capture(camera);
  mark('chamber');chess.capture(camera,frame);mark('gallery');composer.render();mark('main');
  if(profile){timings.total=performance.now()-started;timings.calls=renderer.info.render.calls;timings.triangles=renderer.info.render.triangles;timings.programs=renderer.info.programs.length;profileFrames.push(timings);if(profileFrames.length>1200)profileFrames.shift();}
  onRender({frame,triangles:renderer.info.render.triangles,calls:renderer.info.render.calls,width:renderer.domElement.width,height:renderer.domElement.height});
}
function requestRender(){if(!renderRequested&&!suspended&&!disposed)renderRequested=requestAnimationFrame(render);}
function selectFrame(value){assemblyPose=null;assemblyBaseNeedsReset=true;lastAssemblyReflectionPose=null;frame=THREE.MathUtils.clamp(value,JOURNEY_START_FRAME,2164);}
function setFrame(value){selectFrame(value);requestRender();}
function renderAt(value){if(renderRequested)cancelAnimationFrame(renderRequested);selectFrame(value);render();}
function renderAssemblyAt(value){
  if(renderRequested)cancelAnimationFrame(renderRequested);
  frame=JOURNEY_START_FRAME;assemblyPose=THREE.MathUtils.clamp(value,1,240);render();
}
function disposeModel(){
  if(!model)return;mixer?.stopAllAction();mixer?.uncacheRoot(model);scene.remove(model);
  assemblyPoses=null;assemblyPose=null;assemblyBaseNeedsReset=true;lastAssemblyReflectionPose=null;
  for(const {batch,portable} of ballBatches){if(portable)portable.dispose();else batch.dispose();}ballBatches=[];
  for(const material of reflectionMaterials.values())material.dispose();reflectionMaterials.clear();reflectionBindings=[];
  lastReflectionFrame=null;entryReflectionTurn=0;
  const geometries=new Set(),materials=new Set(),textures=new Set();
  model.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){materials.add(m);for(const v of Object.values(m))if(v?.isTexture&&!v.userData.journeyShared)textures.add(v);}});
  geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>{t.source?.data?.close?.();t.dispose();});
  model=null;
}
async function loadVariant(name,{download}={}){
  if(!['compact','baseline'].includes(name))throw Error('Unknown model');
  const id=++loadID;preparing=true;disposeModel();onStatus('Loading the world…');
  const start=performance.now();
  try{
    const bytes=await (download||fetch(base+'journey-'+name+'.glb').then(response=>{if(!response.ok)throw Error('Export not available: '+response.status);return response.arrayBuffer();}));
    if(id!==loadID||disposed)return;
    const gltf=await loader.parseAsync(bytes,base);if(id!==loadID||disposed)return;
    model=gltf.scene;scene.add(model);const look=exterior.install(model);interior.install(model);chess.install(model);mixer=new THREE.AnimationMixer(model);actions=gltf.animations.map(clip=>{const a=mixer.clipAction(clip);a.setLoop(THREE.LoopOnce,1);a.clampWhenFinished=true;a.play();return a;});
    matchExteriorPalette(model);
    prepareStableLighting();
    if(performanceMode)batchBall();
    prepareReflectionMaterials();
    const assemblyObjects=findAssemblyObjects(model);
    assemblyPoses=createAssemblyPoses({...assemblyObjects,targetFrame:JOURNEY_START_FRAME,
      sample:at=>{mixer.setTime(at/motion.fps);model.updateMatrixWorld(true);}});
    onStatus('Preparing the lights…');
    // Prepare the actual HDR, transmission, and mirror passes. Compiling only
    // the default framebuffer leaves different shader variants cold at entry.
    for(const warmFrame of [JOURNEY_START_FRAME,720,780,850,940,1000,1480,1520,1600,1680,1800]){
      mixer.setTime(warmFrame/motion.fps);updateBallBatches();sampleCamera(warmFrame);
      interior.update(warmFrame);chess.update(warmFrame);exterior.update(camera,warmFrame);
      renderer.setRenderTarget(composer.renderTarget1);
      await renderer.compileAsync(scene,camera);
      if(id!==loadID||disposed)return;
      renderer.setRenderTarget(null);
      interior.capture(camera);chess.capture(camera,warmFrame);composer.render();
    }
    // Draw the actual relocated facet poses too, including batch texture uploads
    // and reflection/composer targets, before releasing the startup loader.
    preparing=false;assemblyBaseNeedsReset=true;
    for(const pose of [1,60,90,120,150,180,240,1])renderAssemblyAt(pose);
    gl.finish();
    modelBytes=bytes.byteLength;loadMs=performance.now()-start;
    onStatus('');
    return {ready:true,variant:name,bytes:modelBytes,loadMs,animations:gltf.animations.length,metadata:(await metadataPromise)[name],look};
  }catch(error){preparing=false;renderer.setRenderTarget(null);throw error;}
}
function suspend(value=true){suspended=value;if(renderRequested)cancelAnimationFrame(renderRequested);renderRequested=0;if(!value)requestRender();}
function dispose(){
  if(disposed)return;disposed=true;loadID++;suspend();observer.disconnect();disposeModel();
  for(const item of pendingTimers)gl.deleteQuery(item.query);pendingTimers.length=0;
  env.dispose();for(const pass of composer.passes)pass.dispose?.();composer.dispose();
  renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();
}
return {setFrame,renderAt,renderAssemblyAt,requestRender,loadVariant,resize,suspend,dispose,renderer,scene,camera,composer,profileFrames,policy,batchingMode,
  get model(){return model;},get mixer(){return mixer;},get frame(){return frame;}};
}
