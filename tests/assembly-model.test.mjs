import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {AnimationMixer,LoopOnce,Vector3} from 'three';
import {JOURNEY_START_FRAME} from '../entrance-source/journey-scroll.mjs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {createAssemblyPoses,findAssemblyObjects} from '../entrance-source/assembly-poses.mjs';

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
 mixer.stopAllAction();mixer.uncacheRoot(data.scene);
});
