import * as THREE from 'three';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {FullScreenQuad} from 'three/addons/postprocessing/Pass.js';

// Reuse the exact opaque board pixels and depth while its camera is stationary.
// Moving parts, hit lights and transparent glass still render every frame.
export class CachedBoardPass extends RenderPass {
 cacheEnabled=false;
 private objects:THREE.Mesh[]=[];
 private lights:THREE.Light[]=[];
 private objectMasks:number[]=[];private lightMasks:number[]=[];
 private target?:THREE.WebGLRenderTarget;
 private valid=false;
 private lastWorld=new THREE.Matrix4();
 private lastProjection=new THREE.Matrix4();
 private width=1;private height=1;
 private copyMaterial=new THREE.ShaderMaterial({
  uniforms:{color:{value:null},depth:{value:null}},
  depthTest:true,depthWrite:true,depthFunc:THREE.AlwaysDepth,blending:THREE.NoBlending,toneMapped:false,
  vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
  fragmentShader:'uniform sampler2D color;uniform sampler2D depth;varying vec2 vUv;void main(){gl_FragColor=texture2D(color,vUv);gl_FragDepth=texture2D(depth,vUv).r;}'
 });
 private quad=new FullScreenQuad(this.copyMaterial);
 readonly cacheStats={builds:0,hits:0,fallbacks:0,meshes:0,staticDraws:0,staticTriangles:0};
 configure(objects:THREE.Mesh[],lights:THREE.Light[]){this.objects=objects;this.lights=lights;this.objectMasks=new Array(objects.length);this.lightMasks=new Array(lights.length);this.cacheStats.meshes=objects.length;this.invalidate()}
 invalidate(){this.valid=false;this.lastWorld.elements.fill(NaN)}
 override setSize(width:number,height:number){
  if(width===this.width&&height===this.height)return;
  this.width=width;this.height=height;this.target?.setSize(width,height);this.invalidate();
 }
 override render(renderer:THREE.WebGLRenderer,writeBuffer:THREE.WebGLRenderTarget,readBuffer:THREE.WebGLRenderTarget,deltaTime:number,maskActive:boolean){
  this.camera.updateMatrixWorld();
  const stable=this.lastWorld.equals(this.camera.matrixWorld)&&this.lastProjection.equals(this.camera.projectionMatrix);
  this.lastWorld.copy(this.camera.matrixWorld);this.lastProjection.copy(this.camera.projectionMatrix);
  if(!this.cacheEnabled||!this.objects.length||!stable||readBuffer.samples>0){
   this.valid=false;this.cacheStats.fallbacks++;super.render(renderer,writeBuffer,readBuffer,deltaTime,maskActive);return;
  }
  if(!this.target){
   this.target=new THREE.WebGLRenderTarget(this.width,this.height,{type:THREE.HalfFloatType,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
   // Preserve fragment depth before the destination buffer quantizes it.
   // Copying an integer depth texture can round coplanar edges a second time.
   this.target.depthTexture=new THREE.DepthTexture(this.width,this.height,THREE.FloatType);
   this.copyMaterial.uniforms.color.value=this.target.texture;this.copyMaterial.uniforms.depth.value=this.target.depthTexture;
  }
  const autoClear=renderer.autoClear,background=this.scene.background,cameraMask=this.camera.layers.mask;
  const objectMasks=this.objectMasks,lightMasks=this.lightMasks;
  for(let i=0;i<this.objects.length;i++)objectMasks[i]=this.objects[i].layers.mask;
  for(let i=0;i<this.lights.length;i++)lightMasks[i]=this.lights[i].layers.mask;
  renderer.autoClear=false;
  try{
   if(!this.valid){
    for(const object of this.objects)object.layers.enable(1);
    for(const light of this.lights)light.layers.enable(1);
    this.camera.layers.set(1);renderer.setRenderTarget(this.target);renderer.clear();
    const before={...renderer.info.render};renderer.render(this.scene,this.camera);
    this.cacheStats.staticDraws=renderer.info.render.calls-before.calls;
    this.cacheStats.staticTriangles=renderer.info.render.triangles-before.triangles;
    this.valid=true;this.cacheStats.builds++;
   }
   this.camera.layers.mask=cameraMask;
   renderer.setRenderTarget(this.renderToScreen?null:readBuffer);renderer.clear();this.quad.render(renderer);
   for(const object of this.objects)object.layers.disable(0);
   this.scene.background=null;
   renderer.render(this.scene,this.camera);this.cacheStats.hits++;
  }finally{
   this.objects.forEach((object,i)=>object.layers.mask=objectMasks[i]);
   this.lights.forEach((light,i)=>light.layers.mask=lightMasks[i]);
   this.camera.layers.mask=cameraMask;this.scene.background=background;renderer.autoClear=autoClear;
  }
 }
 override dispose(){this.target?.dispose();this.copyMaterial.dispose();this.quad.dispose()}
}
