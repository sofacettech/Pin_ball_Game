import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {MeshoptSimplifier} from 'three/addons/libs/meshopt_simplifier.module.js';

// Luminous strips do not need the metal BRDF, environment sampling or area-light
// calculations. Keep emission controls so existing isolated hit flashes work.
export class NeonMaterial extends THREE.MeshBasicMaterial {
 readonly emissive=new THREE.Color();private strength=1;
 constructor(source?:THREE.MeshStandardMaterial){
  super();
  // Three refreshes the compatibility emission field even on a basic shader.
  this.onBeforeCompile=shader=>{shader.uniforms.emissive={value:new THREE.Color()}};
  if(source){this.name=source.name;this.side=source.side;this.transparent=source.transparent;this.opacity=source.opacity;this.emissive.copy(source.emissive);this.emissiveIntensity=source.emissiveIntensity}
 }
 get emissiveIntensity(){return this.strength}
 set emissiveIntensity(value:number){
  this.strength=value;
  // Bound only luminous-strip radiance before multisample resolve. Otherwise
  // clipped HDR edges stay jagged even with AA and every hit looks equally white.
  const peak=Math.max(this.emissive.r,this.emissive.g,this.emissive.b,1e-6);
  const radiance=1.5*value/(value+2);
  this.color.copy(this.emissive).multiplyScalar(radiance/peak);
 }
 override copy(source:THREE.Material){super.copy(source as THREE.MeshBasicMaterial);if(source instanceof NeonMaterial){this.emissive.copy(source.emissive);this.emissiveIntensity=source.emissiveIntensity}return this}
}

export type GlowMaterial=THREE.MeshStandardMaterial|NeonMaterial;

export async function prepareGeometry(root:THREE.Object3D){
 const meshes:THREE.Mesh[]=[];
 root.traverse(obj=>{if(obj instanceof THREE.Mesh)meshes.push(obj)});
 const details:{mesh:THREE.Mesh;original:THREE.BufferAttribute;optimized:THREE.BufferAttribute}[]=[];
 let originalTriangles=0,optimizedTriangles=0,maxErrorMetres=0;
 if(MeshoptSimplifier.supported)await MeshoptSimplifier.ready;
 let yieldedAt=performance.now();
 for(const mesh of meshes){
  if(performance.now()-yieldedAt>8){await new Promise<void>(resolve=>setTimeout(resolve,0));yieldedAt=performance.now()}
  const geometry=mesh.geometry,index=geometry.index,position=geometry.getAttribute('position'),normal=geometry.getAttribute('normal'),uv=geometry.getAttribute('uv');
  const originalCount=index?index.count:position.count;originalTriangles+=originalCount/3;
  const group=mesh.userData.game_render_group||'',mat=mesh.material as THREE.MeshStandardMaterial;
  // Keep ball facets, lettering, luminous outlines and numeric displays exact.
  if(!MeshoptSimplifier.supported||!index||originalCount<18000||group==='ball_main'||group.startsWith('target_')||group.startsWith('scoreboard_')||mat.emissiveIntensity>2){optimizedTriangles+=originalCount/3;continue}
  const positions=new Float32Array(position.count*3),attributes=new Float32Array(position.count*5);
  for(let i=0;i<position.count;i++){
   positions.set([position.getX(i),position.getY(i),position.getZ(i)],i*3);
   attributes.set([normal?.getX(i)||0,normal?.getY(i)||0,normal?.getZ(i)||0,uv?.getX(i)||0,uv?.getY(i)||0],i*5);
  }
  const scale=MeshoptSimplifier.getScale(positions,3)*mesh.matrixWorld.getMaxScaleOnAxis();
  if(!scale){optimizedTriangles+=originalCount/3;continue}
  // No moved vertices: reduce indices only, bound geometric error to 0.15 mm,
  // preserve boundaries and account for normals/UVs when choosing collapses.
  const [indices,error]=MeshoptSimplifier.simplifyWithAttributes(new Uint32Array(index.array),positions,3,attributes,5,[.015,.015,.015,.1,.1],null,Math.floor(originalCount*.25/3)*3,.00015/scale,['LockBorder']);
  const optimized=new THREE.BufferAttribute(indices,1);
  if(indices.length<originalCount){geometry.setIndex(optimized);details.push({mesh,original:index,optimized});maxErrorMetres=Math.max(maxErrorMetres,error*scale)}
  optimizedTriangles+=geometry.index!.count/3;
 }
 return {originalTriangles,optimizedTriangles,maxErrorMetres,optimizedMeshes:details.length,
  setInspection(inspect:boolean){for(const {mesh,original,optimized} of details)mesh.geometry.setIndex(inspect?original:optimized)}};
}

// Complete view draws the same static geometry and material instances in fewer
// calls. Ball view retains spatial culling; inspection retains original meshes.
export function batchOverview(root:THREE.Object3D){
 root.updateMatrixWorld(true);
 const buckets=new Map<THREE.Material,Map<string,THREE.Mesh[]>>(),hidden:{mesh:THREE.Mesh;visible:boolean}[]=[];
 const group=new THREE.Group();group.name='Complete view | shared-material static batches';group.visible=false;
 root.traverse(obj=>{
  if(!(obj instanceof THREE.Mesh)||!obj.visible||Array.isArray(obj.material)||obj.material.transparent)return;
  const id=obj.userData.game_render_group||'';if(!id.startsWith('static_')&&id!=='rail_network')return;
  const signature=Object.keys(obj.geometry.attributes).sort().map(k=>{const a=obj.geometry.attributes[k];return k+':'+a.itemSize+':'+a.normalized+':'+a.array.constructor.name+':'+('gpuType' in a?a.gpuType:'default')}).join(',');
  const byAttributes=buckets.get(obj.material)||new Map<string,THREE.Mesh[]>(),list=byAttributes.get(signature)||[];list.push(obj);byAttributes.set(signature,list);buckets.set(obj.material,byAttributes);
 });
 let originalDraws=0;
 for(const [material,attributes] of buckets)for(const list of attributes.values()){
  if(list.length<2)continue;
  const pieces=list.map(mesh=>mesh.geometry.clone().applyMatrix4(mesh.matrixWorld)),geometry=mergeGeometries(pieces,false);for(const piece of pieces)piece.dispose();if(!geometry)continue;
  geometry.computeBoundingBox();geometry.computeBoundingSphere();const mesh=new THREE.Mesh(geometry,material);mesh.name='Overview batch | '+material.name;group.add(mesh);
  for(const mesh of list)hidden.push({mesh,visible:mesh.visible});originalDraws+=list.length;
 }
 root.add(group);
 return{originalDraws,batchedDraws:group.children.length,setEnabled(enabled:boolean){group.visible=enabled;for(const item of hidden)item.mesh.visible=enabled?false:item.visible}};
}
