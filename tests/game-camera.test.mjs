import test from 'node:test';
import assert from 'node:assert/strict';
import {Box3,PerspectiveCamera,Vector3} from 'three';
import {fitOverview,OverviewFocus} from '../game-source/src/overview-camera.ts';

test('portrait overview keeps the playable bounds visible during launcher focus and viewport changes',()=>{
 const bounds=new Box3(new Vector3(-.4,0,-.7),new Vector3(.4,.15,.7));
 const points=[bounds.min.x,bounds.max.x].flatMap(x=>[bounds.min.y,bounds.max.y].flatMap(y=>[bounds.min.z,bounds.max.z].map(z=>new Vector3(x,y,z))));
 const base=new PerspectiveCamera(),focus=new OverviewFocus();
 for(const [width,height] of [[300,350],[370,444],[373,447],[373,360]]){
  fitOverview(base,bounds,width/height,points,.65);focus.frame(base,bounds,points,true,true);
  for(const ball of [new Vector3(.3,.02,.6),new Vector3(-.3,.02,-.6),new Vector3(0,.02,0)]){
   for(let frame=0;frame<120;frame++){
    focus.advance(ball,1/60,.08,1.12);
    for(const point of points){const p=point.clone().project(focus.camera);assert.ok(Math.abs(p.x)<=.990001&&Math.abs(p.y)<=.990001,'focus must not crop gameplay bounds');assert.ok(p.z>=-1&&p.z<=1)}
   }
  }
 }
});
