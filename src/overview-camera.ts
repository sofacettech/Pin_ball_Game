import {Box3,MathUtils,PerspectiveCamera,Vector3} from 'three';

// Fit the machine's individual geometry bounds, keeping its natural perspective.
// Room geometry never drives the frame. This runs only on load or resize.
export function fitOverview(camera:PerspectiveCamera,bounds:Box3,aspect:number,points?:Vector3[]){
 camera.aspect=aspect;camera.fov=42;
 const target=bounds.getCenter(new Vector3()),direction=new Vector3(0,1,.62).normalize();
 camera.position.copy(target).add(direction);camera.lookAt(target);camera.updateMatrixWorld();
 const rotation=camera.quaternion.clone(),inverse=rotation.clone().invert(),vertical=Math.tan(MathUtils.degToRad(camera.fov/2)),horizontal=vertical*aspect;
 const corners=points||[bounds.min.x,bounds.max.x].flatMap(x=>[bounds.min.y,bounds.max.y].flatMap(y=>[bounds.min.z,bounds.max.z].map(z=>new Vector3(x,y,z))));
 const local=corners.map(p=>p.clone().sub(target).applyQuaternion(inverse));
 const intervals=(distance:number)=>{
  let x0=-Infinity,x1=Infinity,y0=-Infinity,y1=Infinity;
  for(const p of local){const depth=distance-p.z;x0=Math.max(x0,p.x-.98*horizontal*depth);x1=Math.min(x1,p.x+.98*horizontal*depth);y0=Math.max(y0,p.y-.98*vertical*depth);y1=Math.min(y1,p.y+.98*vertical*depth)}
  return {x0,x1,y0,y1,fits:x0<=x1&&y0<=y1};
 };
 let low=Math.max(...local.map(p=>p.z))+.001,high=low+bounds.getSize(new Vector3()).length()*4;
 for(let i=0;i<40;i++){const mid=(low+high)/2;if(intervals(mid).fits)high=mid;else low=mid}
 const frame=intervals(high),offset=new Vector3((frame.x0+frame.x1)/2,(frame.y0+frame.y1)/2,high).applyQuaternion(rotation);
 camera.position.copy(target).add(offset);camera.quaternion.copy(rotation);
 camera.near=.001;camera.far=Math.max(10,high+bounds.getSize(new Vector3()).length());camera.updateProjectionMatrix();camera.updateMatrixWorld();
}
