import {Box3,MathUtils,PerspectiveCamera,Vector3} from 'three';
import type {Mesh} from 'three';

const FRAME_MARGIN=.99;

// Five support vertices exactly bound the four frustum sides and nearest depth.
// Sample only on aspect changes; loose mesh boxes otherwise waste screen space.
export function overviewGeometryPoints(meshes:Mesh[],aspect:number,tilt=.62){
 const basis=new PerspectiveCamera();basis.position.set(0,1,tilt);basis.lookAt(0,0,0);
 const vertical=FRAME_MARGIN*Math.tan(MathUtils.degToRad(42/2)),horizontal=vertical*aspect;
 const directions=[new Vector3(1,0,horizontal),new Vector3(-1,0,horizontal),new Vector3(0,1,vertical),new Vector3(0,-1,vertical),new Vector3(0,0,1)].map(d=>d.applyQuaternion(basis.quaternion));
 const points=directions.map(()=>new Vector3()),peaks=directions.map(()=>-Infinity),point=new Vector3();
 for(const mesh of meshes){
  const positions=mesh.geometry.getAttribute('position');
  for(let i=0;i<positions.count;i++){
   point.fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld);
   for(let j=0;j<directions.length;j++){const value=point.dot(directions[j]);if(value>peaks[j]){peaks[j]=value;points[j].copy(point)}}
  }
 }
 return points;
}

// Fit the machine's individual geometry bounds, keeping its natural perspective.
// Room geometry never drives the frame. This runs only on load or resize.
export function fitOverview(camera:PerspectiveCamera,bounds:Box3,aspect:number,points?:Vector3[],tilt=.62){
 camera.aspect=aspect;camera.fov=42;
 const target=bounds.getCenter(new Vector3()),direction=new Vector3(0,1,tilt).normalize();
 camera.position.copy(target).add(direction);camera.lookAt(target);camera.updateMatrixWorld();
 const rotation=camera.quaternion.clone(),inverse=rotation.clone().invert(),vertical=Math.tan(MathUtils.degToRad(camera.fov/2)),horizontal=vertical*aspect;
 const corners=points||[bounds.min.x,bounds.max.x].flatMap(x=>[bounds.min.y,bounds.max.y].flatMap(y=>[bounds.min.z,bounds.max.z].map(z=>new Vector3(x,y,z))));
 const local=corners.map(p=>p.clone().sub(target).applyQuaternion(inverse));
 const intervals=(distance:number)=>{
  let x0=-Infinity,x1=Infinity,y0=-Infinity,y1=Infinity;
  for(const p of local){const depth=distance-p.z;x0=Math.max(x0,p.x-FRAME_MARGIN*horizontal*depth);x1=Math.min(x1,p.x+FRAME_MARGIN*horizontal*depth);y0=Math.max(y0,p.y-FRAME_MARGIN*vertical*depth);y1=Math.min(y1,p.y+FRAME_MARGIN*vertical*depth)}
  return {x0,x1,y0,y1,fits:x0<=x1&&y0<=y1};
 };
 let low=Math.max(...local.map(p=>p.z))+.001,high=low+bounds.getSize(new Vector3()).length()*4;
 for(let i=0;i<40;i++){const mid=(low+high)/2;if(intervals(mid).fits)high=mid;else low=mid}
 const frame=intervals(high),offset=new Vector3((frame.x0+frame.x1)/2,(frame.y0+frame.y1)/2,high).applyQuaternion(rotation);
 camera.position.copy(target).add(offset);camera.quaternion.copy(rotation);
 camera.near=.001;camera.far=Math.max(10,high+bounds.getSize(new Vector3()).length());camera.updateProjectionMatrix();camera.updateMatrixWorld();
}

// Retain the full machine during drift; an optional launcher zoom is anchored on the ball.
export class OverviewFocus {
 readonly camera=new PerspectiveCamera();
 private base=new PerspectiveCamera();private center=new Vector3();private localPoints:Vector3[]=[];
 private offset=new Vector3();private target=new Vector3();private shift=new Vector3();
 private zoom=1;private zoomPoint=new Vector3();private containZoom=false;private centered=false;
 frame(base:PerspectiveCamera,bounds:Box3,points:Vector3[],containZoom=false,centered=false){
  this.centered=centered;this.containZoom=containZoom;this.base.copy(base);bounds.getCenter(this.center);
  this.localPoints=points.map(p=>p.clone().applyMatrix4(base.matrixWorldInverse));this.apply();
 }
 reset(){this.offset.set(0,0,0);this.zoom=1;this.apply()}
 advance(ball:Vector3,dt:number,strength:number,zoom=1){
  this.target.copy(ball).sub(this.center).applyQuaternion(this.base.quaternion.clone().invert()).multiplyScalar(strength);this.target.z=0;
  if(this.offset.distanceToSquared(this.target)<=1e-14&&Math.abs(this.zoom-zoom)<1e-7&&(zoom===1||this.zoomPoint.distanceToSquared(ball)<=1e-14))return false;
  const alpha=1-Math.exp(-Math.max(0,dt)*2);
  if(zoom>1){if(this.zoom===1)this.zoomPoint.copy(ball);else this.zoomPoint.lerp(ball,alpha)}
  this.offset.lerp(this.target,alpha);this.zoom=MathUtils.lerp(this.zoom,zoom,alpha);
  if(this.offset.distanceToSquared(this.target)<1e-14)this.offset.copy(this.target);
  if(Math.abs(this.zoom-zoom)<1e-7)this.zoom=zoom;
  this.apply();return true;
 }
 private apply(){
  this.camera.copy(this.base);
  let x=this.offset.x,y=this.offset.y;
  if(this.zoom>1){this.shift.copy(this.zoomPoint).applyMatrix4(this.base.matrixWorldInverse);const anchor=1-1/this.zoom;x+=(this.shift.x-x)*anchor;y+=(this.shift.y-y)*anchor}
  const originalX=x;
  if(this.centered){this.shift.copy(this.center).applyMatrix4(this.base.matrixWorldInverse);x=this.containZoom?this.shift.x:0}
  const vertical=FRAME_MARGIN*Math.tan(MathUtils.degToRad(this.base.fov/2))/(this.containZoom?this.zoom:1),horizontal=vertical*this.base.aspect;
  const fitX=this.centered||this.containZoom?x:this.offset.x,fitY=this.containZoom?y:this.offset.y;let back=0;
  for(const p of this.localPoints)back=Math.max(back,Math.abs(p.x-fitX)/horizontal+p.z,this.centered&&this.containZoom?Math.abs(p.x-originalX)/horizontal+p.z:0,Math.abs(p.y-fitY)/vertical+p.z);
  this.shift.set(x,y,back).applyQuaternion(this.base.quaternion);
  this.camera.position.add(this.shift);this.camera.zoom=this.zoom;this.camera.updateProjectionMatrix();this.camera.updateMatrixWorld();
 }
}
