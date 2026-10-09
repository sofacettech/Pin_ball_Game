import type {Vector3} from 'three';

// Small alternating collisions stay inside a stable frame. Sustained travel
// moves the frame smoothly; a larger separation increases catch-up continuously.
export function advanceBallFollow(anchor:Vector3,ball:Vector3,dt:number,scale:number,resetting=false){
 if(dt<=0)return;
 if(resetting){anchor.lerp(ball,1-Math.exp(-dt*2.2));return}
 const dx=ball.x-anchor.x,dz=ball.z-anchor.z,distance=Math.hypot(dx,dz),radius=.9*scale;
 const alpha=1-Math.exp(-dt*(4+Math.max(0,distance/scale-1.5)*12));
 const movement=distance>radius?(distance-radius)/distance*alpha:0;
 anchor.x+=dx*movement;anchor.z+=dz*movement;
 anchor.y+=(ball.y-anchor.y)*(1-Math.exp(-dt*4));
}
