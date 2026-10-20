import {Vector3} from 'three';
import type {PerspectiveCamera} from 'three';

// Low three-quarter rail view, with stand-off to keep the moving ball framed.
export function aimRailCamera(camera:PerspectiveCamera,target:Vector3,scale:number){
 camera.position.copy(target).add(new Vector3(-2.5*scale,3*scale,7*scale));
 camera.lookAt(target);camera.fov=48;camera.updateProjectionMatrix();camera.updateMatrixWorld();
}
