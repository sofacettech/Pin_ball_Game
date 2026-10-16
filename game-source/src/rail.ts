import {BALL_MOTION_RATE} from './motion.ts';
import type {XYZ,RailRoute} from './types.ts';
export class RailTravel {
 readonly distances:number[]=[0];readonly length:number;
 distance:number;speed=.18;elapsed=0;arrivalSeconds:number|null=null;
 readonly route:RailRoute;
 constructor(route:RailRoute,fraction:number){
  this.route=route;
  for(let i=1;i<route.points.length;i++)this.distances.push(this.distances[i-1]+Math.hypot(...route.points[i].map((v,j)=>v-route.points[i-1][j])));
  this.length=this.distances.at(-1)!;this.distance=this.length*Math.max(0,Math.min(1,fraction));
 }
 sample(distance=this.distance){
  let i=1;while(i<this.distances.length-1&&this.distances[i]<distance)i++;
  const a=this.route.points[i-1],b=this.route.points[i],len=this.distances[i]-this.distances[i-1],t=(distance-this.distances[i-1])/len;
  const tangent=b.map((v,j)=>(v-a[j])/len) as XYZ;
  return {position:a.map((v,j)=>v+(b[j]-v)*t) as XYZ,tangent};
 }
 advance(dt:number,gravity:XYZ){
  const motionDt=dt*BALL_MOTION_RATE;const old=this.sample(),accel=gravity.reduce((sum,v,i)=>sum+v*old.tangent[i],0)*5/7;
  this.speed=Math.max(.07,Math.min(.38,this.speed+accel*motionDt-.045*this.speed*motionDt));
  if(this.arrivalSeconds===null){
   const remaining=this.length-this.distance,travel=this.speed*motionDt;
   if(travel>=remaining){this.arrivalSeconds=this.elapsed+remaining/(this.speed*BALL_MOTION_RATE);this.distance=this.length}
   else this.distance+=travel;
  }else this.distance+=this.speed*motionDt;
  this.elapsed+=dt;return this.sample();
 }
}
