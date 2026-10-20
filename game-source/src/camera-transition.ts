import {MathUtils,PerspectiveCamera} from 'three';

// Blend the entire rendered pose, so changing views never cuts position,
// orientation or zoom independently. A reversal starts from the visible pose.
export class CameraTransition {
 readonly camera=new PerspectiveCamera();
 private from=new PerspectiveCamera();private elapsed=0;
 active=false;progress=0;duration=1.2;
 begin(from:PerspectiveCamera,duration=1.2){this.duration=duration;this.from.copy(from);this.camera.copy(from);this.elapsed=0;this.progress=0;this.active=true}
 advance(to:PerspectiveCamera,dt:number){
  if(!this.active)return;
  this.elapsed+=Math.max(0,dt);const t=Math.min(1,this.elapsed/this.duration);
  this.progress=t*t*t*(t*(t*6-15)+10);
  this.camera.position.lerpVectors(this.from.position,to.position,this.progress);
  this.camera.quaternion.slerpQuaternions(this.from.quaternion,to.quaternion,this.progress);
  this.camera.fov=MathUtils.lerp(this.from.fov,to.fov,this.progress);this.camera.zoom=MathUtils.lerp(this.from.zoom,to.zoom,this.progress);
  this.camera.aspect=to.aspect;this.camera.near=to.near;this.camera.far=to.far;
  this.camera.updateProjectionMatrix();this.camera.updateMatrixWorld();
  if(t===1)this.active=false;
 }
}
