import type {XYZ,TargetDefinition} from './types.ts';
export type TargetPose={id:string;slot:string;surface:string;position:XYZ};
const shuffle=<T>(values:T[])=>{const result=[...values];for(let i=result.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[result[i],result[j]]=[result[j],result[i]]}return result};
export class LetterTargets {
 readonly poses:TargetPose[]=[];
 readonly definitions:TargetDefinition[];readonly radius:number;
 constructor(definitions:TargetDefinition[],radius:number){this.definitions=definitions;this.radius=radius;this.restore()}
 restore(){this.poses.splice(0,this.poses.length,...this.definitions.map(d=>({id:d.id,slot:d.initial_slot,surface:d.placements.find(p=>p.slot===d.initial_slot)!.surface,position:[...d.initial_position] as XYZ})))}
 reset(ball:XYZ){
  this.poses.length=0;
  const assign=(index:number):boolean=>{if(index===this.definitions.length)return true;const d=this.definitions[index];
   for(const p of shuffle(d.placements.filter(p=>p.safe&&this.available(d,p,ball)))){this.poses.push({id:d.id,slot:p.slot,surface:p.surface,position:[...p.position]});if(assign(index+1))return true;this.poses.pop()}return false};
  if(!assign(0))throw new Error('The marked target spots cannot safely hold all seven letters.');
 }
 private bounds(d:TargetDefinition,position:XYZ,padding=0){return d.bounds_local.map((side,j)=>side.map((v,i)=>v+position[i]+(j===0?-padding:padding))) as [XYZ,XYZ]}
 private available(d:TargetDefinition,p:TargetDefinition['placements'][number],ball:XYZ){
  const b=this.bounds(d,p.position,this.radius*.12);
  if(ball.every((v,i)=>v>=b[0][i]-this.radius&&v<=b[1][i]+this.radius))return false;
  return !this.poses.some(t=>{if(t.id===d.id)return false;if(t.slot===p.slot)return true;const a=this.bounds(this.definitions.find(d=>d.id===t.id)!,t.position);return a[0].every((v,i)=>v<b[1][i]&&a[1][i]>b[0][i])});
 }
 passage(from:XYZ,to:XYZ,surface:string,onPass:(id:string)=>void){
  // Capture the old placements once: a relocation never participates in this same sweep.
  const snapshot=this.poses.map(t=>({...t,position:[...t.position] as XYZ}));
  for(const t of snapshot){if(t.surface!==surface)continue;const d=this.definitions.find(d=>d.id===t.id)!;
   const b=this.bounds(d,t.position,this.radius*.8),inside=(p:XYZ)=>p.every((v,i)=>v>=b[0][i]&&v<=b[1][i]);
   if(inside(from))continue;
   let entry=0,exit=1;for(let i=0;i<3;i++){const delta=to[i]-from[i];if(Math.abs(delta)<1e-12){if(from[i]<b[0][i]||from[i]>b[1][i])exit=-1;continue}const a=(b[0][i]-from[i])/delta,c=(b[1][i]-from[i])/delta;entry=Math.max(entry,Math.min(a,c));exit=Math.min(exit,Math.max(a,c))}
   if(entry>exit||exit<0||entry>1)continue;
   onPass(t.id);
   const destinations=shuffle(d.placements.filter(p=>p.safe&&p.slot!==t.slot&&this.available(d,p,to)));
   if(destinations.length){const next=destinations[0],actual=this.poses.find(p=>p.id===t.id)!;actual.slot=next.slot;actual.surface=next.surface;actual.position=[...next.position]}
  }
 }
}
