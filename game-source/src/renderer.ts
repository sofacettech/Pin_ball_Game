import {aimRailCamera} from './camera-follow';
import {fitOverview,OverviewFocus,overviewGeometryPoints} from './overview-camera';
import {CameraTransition} from './camera-transition';
import {prepareGeometry,NeonMaterial,batchOverview} from './visual-quality';
import type {GlowMaterial} from './visual-quality';
import {TeleportEffect} from './teleport';
import {Scoreboard} from './scoreboard';
import type {DisplayLayout} from './scoreboard';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {HDRLoader} from 'three/addons/loaders/HDRLoader.js';
import {EXRLoader} from 'three/addons/loaders/EXRLoader.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';
import {FXAAShader} from 'three/addons/shaders/FXAAShader.js';
import {RectAreaLightUniformsLib} from 'three/addons/lights/RectAreaLightUniformsLib.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import type {Manifest,Reference,XYZ} from './types';

export const ROOM_LIGHT_FACTOR=1.05;
type SourceLighting={source_sha256:string;exposure:number;keys:{name:string;energy:number;color:XYZ;matrix:number[][];size:number;size_y:number;shape:string}[];materials:{name:string;emission:number[];strength:number}[]};

export class TableView {
 readonly scene=new THREE.Scene();readonly camera=new THREE.PerspectiveCamera(48,1,.001,10);
 readonly overviewCamera=new THREE.PerspectiveCamera(42,1,.001,10);
 private overviewFocus=new OverviewFocus();private overviewBounds=new THREE.Box3();private overviewPoints:THREE.Vector3[]=[];private overviewMeshes:THREE.Mesh[]=[];private phoneMeshes:THREE.Mesh[]=[];private overviewFill:THREE.Light[]=[];private renderPass:RenderPass;private overviewBatch?:ReturnType<typeof batchOverview>;
 private handheld=false;private phonePlay=false;private railCamera=false;private cameraTransition=new CameraTransition();private transitionExposure=0;
 private get overviewExposure(){return this.handheld?1.7:1.4}
 private sourceExposure=2**-.65*1.05;
 private get destinationCamera(){return !this.inspect&&!this.railCamera?this.overviewFocus.camera:this.camera}
 get activeCamera(){return this.cameraTransition.active?this.cameraTransition.camera:this.destinationCamera}
 readonly renderer:THREE.WebGLRenderer;
 readonly composer:EffectComposer;private fxaa=new ShaderPass(FXAAShader);private automaticQuality=true;private qualityClock=0;private geometryQuality!:Awaited<ReturnType<typeof prepareGeometry>>;
 readonly groups=new Map<string,THREE.Object3D[]>();references:Reference[]=[];
 manifest!:Manifest;referenceIndex=0;inspect=false;frames:number[]=[];needsRender=true;
 private reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;readonly teleportEffect=new TeleportEffect(this.reduced);
 private conversion=new THREE.Matrix4().makeRotationX(-Math.PI/2);
 private last=performance.now();private smoothedBall=new THREE.Vector3();private initializedFollow=false;
 private previewKeys:THREE.DirectionalLight[]=[];private authoredKeys:THREE.RectAreaLight[]=[];private ballShadow!:THREE.Mesh<THREE.PlaneGeometry,THREE.MeshBasicMaterial>;
 private springScale=new Map<THREE.Object3D,number>();private flashes=new Map<string,number>();private glow=new Map<string,{material:GlowMaterial;baseline:number}[]>();scoreboard!:Scoreboard;
 private halos=new Map<string,THREE.Mesh<THREE.PlaneGeometry,THREE.MeshBasicMaterial>>();
 private caveGlow:{material:GlowMaterial;baseline:number}[]=[];
 private glassQuality=new Map<THREE.Mesh,{full:THREE.MeshPhysicalMaterial;fast:THREE.MeshStandardMaterial}>();
 constructor(readonly canvas:HTMLCanvasElement,readonly viewport:HTMLElement){
  this.renderer=new THREE.WebGLRenderer({canvas,antialias:false,powerPreference:'high-performance'});
  this.renderer.setPixelRatio(Math.min(devicePixelRatio,matchMedia('(pointer: coarse)').matches?1:1.25));this.renderer.transmissionResolutionScale=.5;this.renderer.toneMapping=THREE.LinearToneMapping;this.renderer.toneMappingExposure=2**-.65*1.05;
  this.renderer.info.autoReset=false;
  this.scene.background=new THREE.Color('#000');
  const target=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,samples:2});
  this.composer=new EffectComposer(this.renderer,target);this.renderPass=new RenderPass(this.scene,this.camera);this.composer.addPass(this.renderPass);this.composer.addPass(new OutputPass());this.fxaa.enabled=false;this.composer.addPass(this.fxaa);
  RectAreaLightUniformsLib.init();
  new ResizeObserver(()=>this.resize()).observe(viewport);
 }
 convert(p:XYZ){const s=this.manifest.scale;return new THREE.Vector3(p[0]*s,p[2]*s,-p[1]*s)}
 async load(progress:(value:number,label:string)=>void){
  const json=async(url:string)=>{const r=await fetch(url,{cache:'no-cache'});if(!r.ok)throw new Error(`Missing asset: ${url}`);return r.json()};
  const [manifest,referenceData]=await Promise.all([json('/assets/manifest.json?v=target-spots-4e06c150'),json('/assets/reference-cameras.json')]);this.manifest=manifest;this.references=referenceData.views;
  const asset=(name:string)=>'/assets/'+name+'?v='+(manifest.asset_checksums[name]||manifest.asset_revision);
  if(manifest.runtime_contract_version!==6)throw new Error('This model package is incompatible. Restore the matching game files.');
  if(manifest.target_gameplay?.length!==7||manifest.target_gameplay.some((t:{score:number})=>t.score!==1000))throw new Error('The model package is missing the seven 1000-point target mappings.');
  if(!(manifest.scale>0)||manifest.entities.filter((e:EntityLike)=>e.role==='ball').length!==1)throw new Error('Invalid model manifest.');
  progress(8,'Loading the original geometry…');
  const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf=await loader.loadAsync(asset(manifest.model),e=>progress(8+Math.min(65,e.loaded/(e.total||manifest.model_bytes||20e6)*65),'Loading the original geometry…'));
  this.scene.add(gltf.scene);gltf.scene.updateMatrixWorld(true);
  const bedBounds=this.manifest.static_collision_objects.find(o=>o.source_name==='Playfield | dark purple metal bed')!.world_bounds;
  const tableBounds=new THREE.Box3().setFromPoints(bedBounds.map(p=>this.convert(p))),tableSize=tableBounds.getSize(new THREE.Vector3()),padding=manifest.ball_diameter*2;
  const floorTop=manifest.static_collision_objects.find((o:{source_name:string})=>o.source_name.startsWith('Flooring | reference polygon plate')).world_bounds[1][2]*manifest.scale;
  const playableIds=new Set(manifest.entities.filter((e:{role:string})=>e.role.startsWith('bumper')||['flipper','drum_base_bumper','letter_target'].includes(e.role)).map((e:{game_id:string})=>e.game_id));
  gltf.scene.traverse(obj=>{if(!(obj instanceof THREE.Mesh))return;const box=new THREE.Box3().setFromObject(obj),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
   const material=obj.userData.game_material_name;
   // Room illumination and reflections remain in the baked textures and separate lights.
   // Hide detached architecture before batching so quality/inspection changes cannot reveal it.
   if(box.max.z<tableBounds.min.z-padding||material==='Architectural floor | dark violet polished stone'||material==='Black recessed grooves'&&box.max.y<floorTop-manifest.ball_diameter){obj.visible=false;return}
   if(size.x<tableSize.x*2&&size.z<tableSize.z*2&&center.x>=tableBounds.min.x-padding&&center.x<=tableBounds.max.x+padding&&center.z>=tableBounds.min.z-padding&&center.z<=tableBounds.max.z+padding){this.overviewBounds.union(box);this.overviewMeshes.push(obj);if(playableIds.has(obj.userData.game_render_group))this.phoneMeshes.push(obj)}
  });
  gltf.scene.traverse(obj=>{
   const key=obj.userData.game_render_group;if(key){const list=this.groups.get(key)||[];list.push(obj);this.groups.set(key,list)}
  });
  for(const target of manifest.target_gameplay)this.updateTarget(target.id,target.initial_position);
  if(!this.groups.has('ball_main')||!this.groups.has('flipper_left')||!this.groups.has('flipper_right'))throw new Error('Ball or paddle mappings are missing.');
  for(const id of manifest.calibration.spring.render_groups){const parts=this.groups.get(id);if(!parts?.length)throw new Error('Spring mapping is missing.');for(const obj of parts)this.springScale.set(obj,obj.scale.z)}
  const haloCanvas=document.createElement('canvas');haloCanvas.width=haloCanvas.height=128;
  const context=haloCanvas.getContext('2d')!,gradient=context.createRadialGradient(64,64,8,64,64,64);gradient.addColorStop(0,'rgba(255,255,255,1)');gradient.addColorStop(.55,'rgba(255,255,255,.6)');gradient.addColorStop(1,'rgba(255,255,255,0)');context.fillStyle=gradient;context.fillRect(0,0,128,128);
  const haloTexture=new THREE.CanvasTexture(haloCanvas),haloGeometry=new THREE.PlaneGeometry(1,1);
  for(const entity of manifest.entities){if(!['bumper_neutral','bumper_plus','bumper_minus','drum_base_bumper'].includes(entity.role))continue;
   const lights:{material:GlowMaterial;baseline:number}[]=[];
   for(const root of this.groups.get(entity.game_id)||[])root.traverse(obj=>{if(obj instanceof THREE.Mesh&&obj.material instanceof THREE.MeshStandardMaterial&&(obj.material.emissive.r+obj.material.emissive.g+obj.material.emissive.b)>0){const material=obj.material.clone();obj.material=material;lights.push({material,baseline:material.emissiveIntensity})}});
   this.glow.set(entity.game_id,lights)
   if(lights.length){const box=new THREE.Box3();for(const obj of this.groups.get(entity.game_id)||[])box.expandByObject(obj);const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()),color=lights[0].material.emissive.clone();color.multiplyScalar(1/Math.max(color.r,color.g,color.b,1));
    const material=new THREE.MeshBasicMaterial({map:haloTexture,color,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false});const halo=new THREE.Mesh(haloGeometry,material);halo.rotation.x=-Math.PI/2;halo.position.set(center.x,floorTop+.0004,center.z);const diameter=Math.max(size.x,size.z)*1.75;halo.scale.set(diameter,diameter,1);halo.visible=false;this.scene.add(halo);this.halos.set(entity.game_id,halo)
   }
  }
  const shadowMaterial=new THREE.MeshBasicMaterial({map:haloTexture,color:0x000000,transparent:true,opacity:.32,depthWrite:false});
  this.ballShadow=new THREE.Mesh(haloGeometry,shadowMaterial);this.ballShadow.rotation.x=-Math.PI/2;this.ballShadow.scale.setScalar(manifest.ball_diameter*1.5);this.ballShadow.userData.floorHeight=floorTop;this.scene.add(this.ballShadow);
  progress(74,'Preparing detailed lighting and smooth edges…');
  this.geometryQuality=await prepareGeometry(gltf.scene);
  const lighting:SourceLighting=await json('/assets/table-lighting.json');
  if(lighting.source_sha256!==manifest.source_sha256||!Number.isFinite(lighting.exposure))throw new Error('The lighting does not match the current table.');
  this.sourceExposure=2**lighting.exposure;
  const [environment,appearance]=await Promise.all([new HDRLoader().loadAsync('/assets/table-reflections-reference.hdr'),new EXRLoader().loadAsync('/assets/table-floor-reference.exr')]);
  environment.mapping=THREE.EquirectangularReflectionMapping;
  const pmrem=new THREE.PMREMGenerator(this.renderer);this.scene.environment=pmrem.fromEquirectangular(environment).texture;this.scene.environmentIntensity=ROOM_LIGHT_FACTOR;environment.dispose();
  appearance.flipY=true;appearance.generateMipmaps=true;appearance.minFilter=THREE.LinearMipmapLinearFilter;appearance.anisotropy=Math.min(4,this.renderer.capabilities.getMaxAnisotropy());
  const floorMaterial=new THREE.MeshBasicMaterial({map:appearance});floorMaterial.name='Blender stationary floor appearance';
  // Three detached lamp reflections are baked into the floor; fill only their footprints from neighbouring floor pixels.
  floorMaterial.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
   vec4 floorSample=texture2D(map,vMapUv);
   vec4 patches[3];
   patches[0]=vec4(.3096,.5994,.025,.014);
   patches[1]=vec4(.6323,.6328,.025,.014);
   patches[2]=vec4(.2756,.8195,.025,.014);
   for(int i=0;i<3;i++){
    vec2 distance=abs(vMapUv-patches[i].xy)/patches[i].zw;
    float weight=1.-smoothstep(.6,1.,max(distance.x,distance.y));
    if(weight>0.){
     float span=patches[i].w*1.25;
     vec4 above=texture2D(map,vec2(vMapUv.x,patches[i].y-span));
     vec4 below=texture2D(map,vec2(vMapUv.x,patches[i].y+span));
     floorSample=mix(floorSample,mix(above,below,clamp((vMapUv.y-patches[i].y+span)/(2.*span),0.,1.)),weight);
    }
   }
   diffuseColor*=floorSample;
  `)};
  const backgroundMaterial=new THREE.MeshBasicMaterial({color:0x000000});backgroundMaterial.name='Black surrounding floor';
  gltf.scene.traverse(obj=>{if(!(obj instanceof THREE.Mesh))return;
   const mat=obj.material as THREE.MeshStandardMaterial;
   mat.envMapIntensity=1;
   if(mat.name==='Architectural floor | dark violet polished stone')obj.material=backgroundMaterial;
   else if(mat.name.startsWith('Reference flooring |')||mat.name==='Purple black reflective playfield')obj.material=floorMaterial;
   else for(const texture of [mat.map,mat.roughnessMap,mat.normalMap])if(texture)texture.anisotropy=Math.min(4,this.renderer.capabilities.getMaxAnisotropy());
  });
  // Keep the ball's neutral silver reflections independent of table lighting.
  const room=new RoomEnvironment(),chrome=pmrem.fromScene(room,.04).texture;room.dispose();pmrem.dispose();
  for(const root of this.groups.get('ball_main')||[])root.traverse(obj=>{
   if(!(obj instanceof THREE.Mesh))return;
   const brighten=(original:THREE.MeshStandardMaterial)=>{const mat=original.clone();mat.envMap=chrome;mat.envMapIntensity=1.1;this.teleportEffect.attach(mat,manifest.ball_diameter);
    if(mat.name.startsWith('Polished stainless steel')){mat.color.set('#d3d8df');mat.metalness=1;mat.roughness=.18}return mat};
   obj.material=Array.isArray(obj.material)?obj.material.map(mat=>brighten(mat as THREE.MeshStandardMaterial)):brighten(obj.material as THREE.MeshStandardMaterial);
  });
  // Localized lights and linked decoration fills are captured in the textures.
  // Broad source keys also illuminate moving surfaces in their authored positions.
  const s=manifest.scale;
  for(const source of lighting.keys){
   const height=source.shape==='RECTANGLE'||source.shape==='ELLIPSE'?source.size_y:source.size;
   const intensity=source.energy/(Math.PI*source.size*height)*ROOM_LIGHT_FACTOR;
   const matrix=new THREE.Matrix4().set(...source.matrix.flat() as Parameters<THREE.Matrix4['set']>);
   matrix.setPosition(new THREE.Vector3().setFromMatrixPosition(matrix).multiplyScalar(s));matrix.premultiply(this.conversion);
   const color=new THREE.Color().setRGB(...source.color),position=new THREE.Vector3(),rotation=new THREE.Quaternion();matrix.decompose(position,rotation,new THREE.Vector3());
   const area=new THREE.RectAreaLight(color,intensity,source.size*s,height*s);area.name=source.name;area.position.copy(position);area.quaternion.copy(rotation);this.scene.add(area);this.authoredKeys.push(area);
   const key=new THREE.DirectionalLight(color,intensity*.22);key.name=source.name;key.position.copy(position);key.target.position.copy(position).add(new THREE.Vector3(0,0,-1).applyQuaternion(rotation));this.scene.add(key,key.target);this.previewKeys.push(key);
  }
  this.scene.add(new THREE.HemisphereLight(new THREE.Color().setRGB(.58,.4,.75),new THREE.Color().setRGB(.06,.035,.08),.28*ROOM_LIGHT_FACTOR));
  const fill=new THREE.HemisphereLight(0xe7e1ff,0x493459,.85*ROOM_LIGHT_FACTOR),key=new THREE.DirectionalLight(0xfff1dd,1.1*ROOM_LIGHT_FACTOR);
  key.position.copy(this.convert([1,-4,10]));key.target.position.copy(this.convert([0,5,0]));this.overviewFill.push(fill,key);this.scene.add(fill,key,key.target);
  this.updateLightingQuality();
  const sourceMaterials=new Map(lighting.materials.map(material=>[material.name,material]));
  gltf.scene.traverse(obj=>{if(!(obj instanceof THREE.Mesh)||!(obj.material instanceof THREE.MeshStandardMaterial))return;const source=sourceMaterials.get(obj.material.name);if(source?.emission){obj.material.emissive.setRGB(source.emission[0],source.emission[1],source.emission[2]);obj.material.emissiveIntensity=source.strength}});
  for(const parts of this.glow.values())for(const part of parts)part.baseline=part.material.emissiveIntensity;
  const layout:DisplayLayout=await json('/assets/scoreboard-layout.json');
  const scoreRoot=this.groups.get('scoreboard_score')?.[0];let displayMaterial:THREE.Material|undefined;
  scoreRoot?.traverse(obj=>{if(obj instanceof THREE.Mesh&&!displayMaterial)displayMaterial=(Array.isArray(obj.material)?obj.material[0]:obj.material).clone()});
  if(!displayMaterial)throw new Error('Modeled numeric display mapping is missing.');
  for(const field of Object.values(layout.fields))for(const obj of this.groups.get(field.render_group)||[])obj.visible=false;
  this.scoreboard=new Scoreboard(this.scene,layout,s,displayMaterial);this.scoreboard.update(0,0,3);
  let greenDiffuser:THREE.MeshStandardMaterial|undefined;
  this.scene.traverse(obj=>{if(obj instanceof THREE.Mesh&&obj.material instanceof THREE.MeshStandardMaterial&&obj.material.name==='Lighting | original green recessed diffuser')greenDiffuser=obj.material});
  const neon=new Map<THREE.MeshStandardMaterial,NeonMaterial>();
  this.scene.traverse(obj=>{if(!(obj instanceof THREE.Mesh)||!(obj.material instanceof THREE.MeshStandardMaterial))return;const mat=obj.material;
   if(mat.emissiveIntensity<3||mat.metalness>.3||mat.map||mat.emissive.r+mat.emissive.g+mat.emissive.b===0)return;
   if(!neon.has(mat)){
    const logo=mat.name==='Logo | solid model-green enamel',lens=new NeonMaterial(logo?greenDiffuser||mat:mat);lens.name=mat.name;
    // The floor emblem is only 0.036 mm above the baked floor. Keep its green
    // surface in front of that receiver without changing geometry or lighting.
    if(logo){lens.polygonOffset=true;lens.polygonOffsetFactor=-3;lens.polygonOffsetUnits=-3}
    neon.set(mat,lens);
   }obj.material=neon.get(mat)!;
  });
  for(const parts of this.glow.values())for(const part of parts)part.material=neon.get(part.material as THREE.MeshStandardMaterial)||part.material;
  // Recessed border lenses meet their black housings at nearly equal depth.
  // Bias only these static diffusers; retain depth testing and physical geometry.
  const borderNeon=new Map<NeonMaterial,NeonMaterial>();
  this.scene.traverse(obj=>{if(!(obj instanceof THREE.Mesh)||!(obj.material instanceof NeonMaterial)||!obj.userData.game_render_group?.startsWith('static_')||obj.material.name!=='Lighting | original green recessed diffuser')return;
   const mat=obj.material;if(!borderNeon.has(mat)){const lens=mat.clone();lens.polygonOffset=true;lens.polygonOffsetFactor=-2;lens.polygonOffsetUnits=-2;borderNeon.set(mat,lens)}obj.material=borderNeon.get(mat)!;
  });
  for(const root of this.groups.get('static_cave')||[])root.traverse(obj=>{if(obj instanceof THREE.Mesh&&(obj.material instanceof THREE.MeshStandardMaterial||obj.material instanceof NeonMaterial)&&obj.material.emissiveIntensity>0){const mat=obj.material.clone();obj.material=mat;this.caveGlow.push({material:mat,baseline:mat.emissiveIntensity})}});
  gltf.scene.traverse(obj=>{if(obj instanceof THREE.Mesh&&obj.material instanceof THREE.MeshPhysicalMaterial&&obj.material.transmission>0){const full=obj.material;
   full.color.set('#f2fbff');full.roughness=.045;full.metalness=0;full.ior=1.52;full.transmission=.98;full.thickness=.003;full.attenuationColor.set('#d8f5ee');full.attenuationDistance=.4;full.clearcoat=1;full.clearcoatRoughness=.035;full.envMapIntensity=1.25;
   const fast=full.clone();fast.name=full.name;fast.transmission=.94;fast.clearcoat=.6;fast.depthWrite=false;fast.forceSinglePass=true;this.glassQuality.set(obj,{full,fast})}});
  this.overviewBatch=batchOverview(this.scene);this.updateLightingQuality();this.setReference(0);this.resize();this.render();progress(100,'Table ready.');
 }
 setReference(index:number){
  this.needsRender=true;
  this.referenceIndex=index;const ref=this.references[index];if(!ref)return;
  const matrix=new THREE.Matrix4().set(...ref.world_matrix.flat() as [number,number,number,number,number,number,number,number,number,number,number,number,number,number,number,number]);
  const s=this.manifest.scale;matrix.setPosition(new THREE.Vector3().setFromMatrixPosition(matrix).multiplyScalar(s));matrix.premultiply(this.conversion);
  matrix.decompose(this.camera.position,this.camera.quaternion,new THREE.Vector3());
  const ratio=ref.resolution[0]/ref.resolution[1];const height=ref.sensor_fit==='VERTICAL'?ref.sensor_height:ref.sensor_width/(ref.sensor_fit==='AUTO'?Math.max(ratio,1):ratio);
  this.camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(height/(2*ref.lens_mm)));this.camera.aspect=ratio;this.camera.updateProjectionMatrix();this.initializedFollow=false;
 }
 setHandheld(active:boolean){
  if(active===this.handheld)return;
  this.handheld=active;this.updatePixelRatio();this.updateCameraLighting();this.resize();
 }
 private updatePixelRatio(){
  const requested=this.handheld?Math.max(devicePixelRatio,1.25):devicePixelRatio;
  const limit=this.handheld?1.5:this.automaticQuality?(matchMedia('(pointer: coarse)').matches?1:1.25):1.5;
  this.renderer.setPixelRatio(Math.min(requested,limit));
 }
 setPhonePlay(active:boolean){
  if(active===this.phonePlay)return;
  if(!this.inspect&&!this.reduced){this.cameraTransition.begin(this.activeCamera,2.2);this.transitionExposure=this.renderer.toneMappingExposure}
  this.phonePlay=active;if(!active)this.overviewFocus.reset();this.overviewPoints=[];this.resize();
 }
 resize(){
  this.needsRender=true;const w=this.viewport.clientWidth,h=this.viewport.clientHeight;if(!w||!h)return;
  this.renderer.setSize(w,h,false);this.composer.setPixelRatio(this.renderer.getPixelRatio());this.composer.setSize(w,h);
  this.fxaa.uniforms.resolution.value.set(1/(w*this.renderer.getPixelRatio()),1/(h*this.renderer.getPixelRatio()));
  this.camera.aspect=w/h;this.camera.updateProjectionMatrix();if(this.overviewBounds.isEmpty())return;
  // Keep the playable area large on phones, retaining the full vertical span.
  const portrait=this.phonePlay&&w/h<.85,tilt=this.phonePlay?.8:.62;
  if(this.overviewPoints.length!==(portrait?8:5)||this.overviewCamera.aspect!==w/h){
   this.overviewPoints=overviewGeometryPoints(this.overviewMeshes,w/h,tilt);
   if(portrait){const x=this.overviewBounds.getCenter(new THREE.Vector3()).x,vertical=this.overviewPoints.slice(2).map(p=>p.setX(x));this.overviewPoints=[...overviewGeometryPoints(this.phoneMeshes,w/h,tilt),...vertical]}
  }
  fitOverview(this.overviewCamera,this.overviewBounds,w/h,this.overviewPoints,tilt);
  this.overviewFocus.frame(this.overviewCamera,this.overviewBounds,this.overviewPoints,portrait,document.body.classList.contains('phone-layout'));
 }

 advanceCamera(dt:number){if(!this.cameraTransition.active)return;this.cameraTransition.advance(this.destinationCamera,dt);this.renderer.toneMappingExposure=THREE.MathUtils.lerp(this.transitionExposure,this.sourceExposure*(!this.railCamera?this.overviewExposure:1),this.cameraTransition.progress);this.needsRender=true}
 private updateCameraLighting(){this.frames=[];this.last=performance.now();const complete=!this.inspect&&!this.railCamera;for(const light of this.overviewFill)light.visible=complete;this.overviewBatch?.setEnabled(complete);if(!this.cameraTransition.active)this.renderer.toneMappingExposure=this.sourceExposure*(complete?this.overviewExposure:1)}
 private updateLightingQuality(){this.updateCameraLighting();for(const light of this.authoredKeys)light.visible=!this.automaticQuality;for(const light of this.previewKeys)light.visible=this.automaticQuality;for(const [mesh,materials] of this.glassQuality)mesh.material=this.automaticQuality?materials.fast:materials.full}
 setQuality(automatic:boolean){this.automaticQuality=automatic;this.renderer.transmissionResolutionScale=automatic?.5:1;this.updateLightingQuality();this.composer.renderTarget1.samples=this.composer.renderTarget2.samples=2;this.composer.renderTarget1.dispose();this.composer.renderTarget2.dispose();this.fxaa.enabled=false;this.updatePixelRatio();this.frames=[];this.qualityClock=performance.now();this.resize()}
 setInspect(inspect:boolean){this.cameraTransition.active=false;this.inspect=inspect;this.updateCameraLighting();this.geometryQuality?.setInspection(inspect);this.setReference(this.referenceIndex);this.resize()}
 updateBall(position:XYZ,rotation:{x:number;y:number;z:number;w:number},visible=true){if(!visible)this.teleportEffect.reset();const fx=this.inspect?{position,presence:1,strength:0}:this.teleportEffect.sample(position);this.teleportEffect.apply(fx.position,fx.presence,fx.strength);const floor=this.ballShadow.userData.floorHeight;this.ballShadow.visible=visible&&fx.presence>0&&fx.position[1]<floor+this.manifest.ball_diameter*.9;this.ballShadow.position.set(fx.position[0],floor+.00035,fx.position[2]);this.ballShadow.material.opacity=.32*fx.presence;for(const obj of this.groups.get('ball_main')||[]){obj.visible=visible;obj.position.set(...fx.position);obj.quaternion.set(rotation.x,rotation.y,rotation.z,rotation.w)}}
 updatePaddle(id:string,angle:number){for(const obj of this.groups.get(id)||[])obj.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),angle)}
 updateTarget(id:string,position:XYZ){for(const obj of this.groups.get(id)||[])obj.position.set(...position)}
 updateSpring(compression:number){const ratio=1-(1-this.manifest.calibration.spring.minimum_length_ratio)*THREE.MathUtils.clamp(compression,0,1);for(const [obj,baseline] of this.springScale)obj.scale.z=baseline*ratio}
 updateCaveCharge(progress:number,active:boolean){for(const p of this.caveGlow)p.material.emissiveIntensity=p.baseline*(active?1+progress*1.5:1)}
  hit(id:string){if(id==='triangle_left'||id==='triangle_right'){for(let i=1;i<=3;i++)this.flashes.set(`bumper_neutral_${id.slice(9)}_${i}`,.24)}else this.flashes.set(id,.24)}
 teleport(source:XYZ,destination:XYZ){this.teleportEffect.begin(source,this.initializedFollow?this.smoothedBall.toArray() as XYZ:source);this.needsRender=true}
 retarget(ball?:XYZ){this.teleportEffect.reset();this.initializedFollow=false;this.needsRender=true;if(ball)this.follow(ball,0,'playing')}
 resetFeedback(){this.cameraTransition.active=false;this.railCamera=false;this.overviewFocus.reset();this.updateCameraLighting();this.teleportEffect.reset();this.flashes.clear();for(const parts of this.glow.values())for(const p of parts)p.material.emissiveIntensity=p.baseline;for(const halo of this.halos.values())halo.visible=false}
 updateFeedback(dt:number){this.teleportEffect.advance(dt);for(const [id,remaining] of this.flashes){const t=Math.max(0,remaining-dt);for(const p of this.glow.get(id)||[])p.material.emissiveIntensity=p.baseline*(1+1.5*t/.24);const halo=this.halos.get(id);if(halo){halo.visible=t>0;halo.material.opacity=.75*t/.24}if(t===0)this.flashes.delete(id);else this.flashes.set(id,t)}}
 follow(ball:XYZ,dt:number,state:string,ballMode:'floor'|'rail'='floor',focus:'launcher'|'cave'|null=null){
  if(this.inspect)return;
  const rail=ballMode==='rail'&&state==='playing';
  if(rail!==this.railCamera){this.cameraTransition.begin(this.activeCamera,this.reduced?.2:rail?2:1.2);this.transitionExposure=this.renderer.toneMappingExposure;this.railCamera=rail;this.updateCameraLighting();if(rail)this.smoothedBall.set(...ball)}
  const b=new THREE.Vector3(...ball),strength=this.reduced||rail||state==='finished'?0:focus==='cave'?.12:focus==='launcher'?.08:0;
  if(this.overviewFocus.advance(b,dt,strength,focus==='launcher'&&strength>0?1.12:1))this.needsRender=true;
  if(!this.initializedFollow||!rail){this.smoothedBall.copy(b);this.initializedFollow=true}
  if(rail){this.smoothedBall.lerp(b,1-Math.exp(-dt*3));aimRailCamera(this.camera,this.smoothedBall,this.manifest.scale)}
 }

 render(){this.needsRender=false;this.renderPass.camera=this.activeCamera;this.renderer.info.reset();this.composer.render();const now=performance.now();const elapsed=now-this.last;if(elapsed<250)this.frames.push(elapsed);this.last=now;if(this.frames.length>240)this.frames.shift();
  if(this.automaticQuality&&this.frames.length>=60&&now-this.qualityClock>2000){this.qualityClock=now;const sorted=this.frames.slice(-60).sort((a,b)=>a-b),median=sorted[30],ratio=this.renderer.getPixelRatio();if(median>24&&ratio>1){this.renderer.setPixelRatio(Math.max(1,ratio-.1));this.resize();this.frames=[]}
   else if(median>24&&this.composer.renderTarget1.samples>0){this.composer.renderTarget1.samples=this.composer.renderTarget2.samples=0;this.composer.renderTarget1.dispose();this.composer.renderTarget2.dispose();this.fxaa.enabled=true;this.frames=[]}
   else if(median<17&&this.composer.renderTarget1.samples===0){this.composer.renderTarget1.samples=this.composer.renderTarget2.samples=2;this.composer.renderTarget1.dispose();this.composer.renderTarget2.dispose();this.fxaa.enabled=false;this.frames=[]}}
 }
 metrics(){const sorted=[...this.frames].sort((a,b)=>a-b);return{drawCalls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles,medianFrameMs:sorted[Math.floor(sorted.length/2)]||0,p95FrameMs:sorted[Math.floor(sorted.length*.95)]||0,pixelRatio:this.renderer.getPixelRatio(),automaticQuality:this.automaticQuality,textureCount:this.renderer.info.memory.textures,geometryCount:this.renderer.info.memory.geometries,antialiasing:this.fxaa.enabled?'FXAA':'MSAA 2x',lightingQuality:this.automaticQuality?'baked floor + broad keys':'baked floor + authored area keys',originalTriangles:this.geometryQuality?.originalTriangles,optimizedTriangles:this.geometryQuality?.optimizedTriangles,geometryErrorMetres:this.geometryQuality?.maxErrorMetres,overviewOriginalDraws:this.overviewBatch?.originalDraws,overviewBatchedDraws:this.overviewBatch?.batchedDraws}}
}
type EntityLike={role:string};
