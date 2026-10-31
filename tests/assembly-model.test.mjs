import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {AnimationMixer,LoopOnce,Vector3,PerspectiveCamera,Quaternion} from 'three';
import {JOURNEY_START_FRAME} from '../entrance-source/journey-scroll.mjs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {createAssemblyPoses,findAssemblyObjects} from '../entrance-source/assembly-poses.mjs';
import {createOpeningFraming} from '../entrance-source/opening-framing.mjs';
import {framePlacement} from '../frame-placement.js';

test('the actual compressed model supplies animated facet wrappers and a seamless relocated final pose',async()=>{
 const bytes=await readFile(new URL('../assets/entrance-3d/journey-compact.glb',import.meta.url));
 const length=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+length)),bin=bytes.subarray(28+length);
 // Geometry, hierarchy and animation stay unchanged. Texture loading needs a
 // browser and is irrelevant to validating the exported animation wrappers.
 json.materials=json.materials.map(material=>({name:material.name}));json.images=[];json.textures=[];
 const raw=Buffer.from(JSON.stringify(json)),padded=Buffer.alloc(Math.ceil(raw.length/4)*4,32);raw.copy(padded);
 const glb=Buffer.alloc(28+padded.length+bin.length);
 glb.writeUInt32LE(0x46546c67,0);glb.writeUInt32LE(2,4);glb.writeUInt32LE(glb.length,8);
 glb.writeUInt32LE(padded.length,12);glb.writeUInt32LE(0x4e4f534a,16);padded.copy(glb,20);
 glb.writeUInt32LE(bin.length,20+padded.length);glb.writeUInt32LE(0x004e4942,24+padded.length);bin.copy(glb,28+padded.length);
 const data=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(glb.buffer.slice(glb.byteOffset,glb.byteOffset+glb.byteLength),'');
 const mixer=new AnimationMixer(data.scene);
 for(const clip of data.animations){const action=mixer.clipAction(clip);action.setLoop(LoopOnce,1);action.clampWhenFinished=true;action.play()}
 const selected=findAssemblyObjects(data.scene);assert.ok(selected.objects.length>30);assert.ok(selected.anchor);
 assert.ok(selected.objects.every(object=>!object.isMesh),'Animated wrappers must be selected instead of primitive children');
 let samples=0;const sample=frame=>{samples++;mixer.setTime(frame/60);data.scene.updateMatrixWorld(true)};
 sample(JOURNEY_START_FRAME);const expected=selected.objects.map(object=>object.matrix.clone());
 const positions=expected.map(matrix=>new Vector3().setFromMatrixPosition(matrix));
 const poses=createAssemblyPoses({...selected,sample,targetFrame:JOURNEY_START_FRAME}),preparedSamples=samples;
 poses.apply(120);assert.ok(selected.objects.some((object,index)=>object.position.distanceToSquared(positions[index])>.01));
 poses.apply(240);
 selected.objects.forEach((object,index)=>object.matrix.elements.forEach((value,j)=>assert.ok(Math.abs(value-expected[index].elements[j])<1e-4)));
 assert.equal(samples,preparedSamples);assert.ok(poses.byteLength<1024*1024);
 // Project the real exported emblem and ball, including short landscape and
 // ultrawide screens where a ball-centred cover crop previously hid the logo.
 sample(JOURNEY_START_FRAME);
 const fit=createOpeningFraming(data.scene,selected);
 const motion=JSON.parse(await readFile(new URL('../assets/entrance-3d/camera-motion.json',import.meta.url)));
 const framing=JSON.parse(await readFile(new URL('../assets/ball-framing.json',import.meta.url)));
 for(const frame of [334,390,450,460])for(const [width,height] of [[1288,770],[1440,900],[1920,1080],[2560,1080],[393,852],[375,667],[320,568],[844,390]]){
  sample(frame);
  const a=motion.camera.findLast(point=>point.frame<=frame),b=motion.camera.find(point=>point.frame>frame),t=(frame-a.frame)/(b.frame-a.frame);
  const camera=new PerspectiveCamera(a.fov+(b.fov-a.fov)*t,16/9,a.near,a.far);
  camera.position.fromArray(a.position).lerp(new Vector3().fromArray(b.position),t);
  camera.quaternion.fromArray(a.quaternion).slerp(new Quaternion().fromArray(b.quaternion),t);
  const originalPosition=camera.position.clone(),p=framePlacement(width,height,framing.points[frame],true);
  const view={fullWidth:p.width,fullHeight:p.height,x:-p.x,y:-p.y,width,height};
  const fitted=fit(camera,view,frame);
  assert.equal(fit(camera,view,frame),fitted,'Assembly must reuse the fixed framing');
  camera.setViewOffset(fitted.fullWidth,fitted.fullHeight,fitted.x,fitted.y,width,height);camera.updateMatrixWorld(true);
  let ballVertices=0,logoVertices=0;
  data.scene.traverse(object=>{
   if(!object.isMesh||!(object.material?.name==='Porcelain white emblem'||object.material?.name.startsWith('SOFACET ball |')))return;
   if(!selected.objects.some(parent=>object.parent===parent)){
    if(object.material.name!=='Porcelain white emblem')return;
   }
   const position=object.geometry.attributes.position,v=new Vector3();
   if(object.material.name==='Porcelain white emblem')logoVertices+=position.count;else ballVertices+=position.count;
   for(let i=0;i<position.count;i++){
    v.fromBufferAttribute(position,i).applyMatrix4(object.matrixWorld).project(camera);
    const x=(v.x+1)*width/2,y=(1-v.y)*height/2,context=`${frame} at ${width}x${height}`;
    assert.ok(x>=-1&&x<=width+1,`horizontal clipping: ${context}`);
    assert.ok(y>=Math.max(64,Math.min(88,height*.08))-1&&y<=height-Math.min(64,height*.1)+1,`vertical clipping: ${context}`);
   }
  });
  assert.ok(ballVertices>100&&logoVertices>100,'Check both the real ball and emblem geometry');
  assert.ok(camera.position.equals(originalPosition),'Framing must retain the closer world position');
  assert.equal(fit(camera,view,640),null,'Opening fit must release before the doorway');
 }
 mixer.stopAllAction();mixer.uncacheRoot(data.scene);
});
