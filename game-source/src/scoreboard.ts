import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {XYZ} from './types';
type Field={render_group:string;origin_blender:XYZ;width_blender:number;height_blender:number;step_blender:number;digits:number};
export type DisplayLayout={fields:Record<string,Field>;stroke_radius_blender:number};
// Keep the source's split chamfered outlines and slim pale-violet tube strokes.
const upper=[[0,.56],[.02,.87],[.18,1],[.82,1],[.98,.87],[1,.56]];
const lower=[[1,.44],[.98,.13],[.82,0],[.18,0],[.02,.13],[0,.44]];
const strokes:Record<string,number[][][]>={
 '0':[upper,lower],'1':[[[1,1],[1,.56]],[[1,.44],[1,0]]],
 '2':[[[0,.87],[.18,1],[.82,1],[1,.87],[1,.56],[.82,.5],[.18,.5],[0,.44],[0,.13],[.18,0],[1,0]]],
 '3':[[[0,1],[.82,1],[1,.87],[1,.56],[.82,.5],[.18,.5]],[[.82,.5],[1,.44],[1,.13],[.82,0],[0,0]]],
 '4':[[[0,1],[0,.56],[.18,.5],[1,.5]],[[1,1],[1,0]]],
 '5':[[[1,1],[.18,1],[0,.87],[0,.56],[.18,.5],[.82,.5],[1,.44],[1,.13],[.82,0],[0,0]]],
 '6':[[[1,1],[.18,1],[0,.87],[0,.13],[.18,0],[.82,0],[1,.13],[1,.44],[.82,.5],[.18,.5]]],
 '7':[[[0,1],[1,1],[1,.56]],[[1,.44],[1,0]]],
 '8':[upper,lower,[[.18,.5],[.82,.5]]],
 '9':[upper,[[0,.56],[.18,.5],[.82,.5],[1,.44],[1,.13],[.82,0],[0,0]]],
 '-':[[[.18,.5],[.82,.5]]]
};
export function displayNumber(value:number,digits:number){
 const n=Math.trunc(Number.isFinite(value)?value:0),negative=n<0;
 return (negative?'-':'')+String(Math.abs(n)).padStart(Math.max(1,digits-(negative?1:0)),'0');
}
export class Scoreboard {
 readonly values:Record<string,string>={};private meshes=new Map<string,THREE.Mesh>();
 private lifeDots:THREE.Mesh[]=[];private availableLife=new THREE.MeshBasicMaterial({color:'#fff',toneMapped:false});private spentLife=new THREE.MeshBasicMaterial({color:'#67616f',toneMapped:false});
 constructor(readonly scene:THREE.Scene,readonly layout:DisplayLayout,readonly scale:number,material:THREE.Material){
  for(const key of Object.keys(layout.fields)){
   if(key==='lives'){
    const field=layout.fields[key],center=field.origin_blender[0]+field.width_blender/2,geometry=new THREE.CircleGeometry(.075*scale,24);
    for(let i=0;i<3;i++){const dot=new THREE.Mesh(geometry,this.availableLife);dot.name=`Life dot ${i+1}`;dot.position.set((center+(i-1)*.25)*scale,(field.origin_blender[2]+field.height_blender/2)*scale,-field.origin_blender[1]*scale);scene.add(dot);this.lifeDots.push(dot)}
   }else{const mesh=new THREE.Mesh(new THREE.BufferGeometry(),material);scene.add(mesh);this.meshes.set(key,mesh)}
  }
 }
 update(score:number,highScore:number,lives:number){
  let changed=false;
  for(const [key,value] of Object.entries({score,high_score:highScore,lives,bonus:0})){
   const field=this.layout.fields[key];if(!field)continue;const text=displayNumber(value,field.digits);if(this.values[key]===text)continue;
   if(key==='lives'){this.lifeDots.forEach((dot,i)=>{dot.material=i<value?this.availableLife:this.spentLife});this.values[key]=text;changed=true;continue}
   const pieces:THREE.BufferGeometry[]=[],totalWidth=(field.digits-1)*field.step_blender+field.width_blender;
   const step=text.length>field.digits?totalWidth/text.length:field.step_blender,compression=text.length>field.digits?step/field.step_blender:1;
   for(let index=0;index<text.length;index++)for(const stroke of strokes[text[index]]||[]){
    const points=stroke.map(([x,y])=>new THREE.Vector3((field.origin_blender[0]+index*step+(x-.04*(1-y))*field.width_blender*compression)*this.scale,(field.origin_blender[2]+y*field.height_blender)*this.scale,-field.origin_blender[1]*this.scale));
    for(let i=1;i<points.length;i++){
     const direction=points[i].clone().sub(points[i-1]),geometry=new THREE.CylinderGeometry(this.layout.stroke_radius_blender*this.scale,this.layout.stroke_radius_blender*this.scale,direction.length(),5,1);
     geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize()));geometry.translate(...points[i].clone().add(points[i-1]).multiplyScalar(.5).toArray() as XYZ);pieces.push(geometry);
    }
   }
   const mesh=this.meshes.get(key)!;mesh.geometry.dispose();mesh.geometry=mergeGeometries(pieces);for(const part of pieces)part.dispose();this.values[key]=text;changed=true;
  }
  return changed;
 }
}
