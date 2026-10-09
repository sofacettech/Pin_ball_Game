import type {XYZ} from './types.ts';
export type Outline={points:[number,number][];bounds:[number,number,number,number]};
export function outline(vertices:number[]):Outline{
 const sorted=Array.from({length:vertices.length/3},(_,i)=>[vertices[i*3],vertices[i*3+2]] as [number,number]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 const cross=(a:number[],b:number[],c:number[])=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 const half=(points:[number,number][])=>{const result:[number,number][]=[];for(const p of points){while(result.length>1&&cross(result.at(-2)!,result.at(-1)!,p)<=0)result.pop();result.push(p)}return result};
 const lower=half(sorted),upper=half([...sorted].reverse());lower.pop();upper.pop();const points=lower.concat(upper);
 return{points,bounds:[sorted[0][0],Math.min(...points.map(p=>p[1])),sorted.at(-1)![0],Math.max(...points.map(p=>p[1]))]};
}
export function sweepCircle(shape:Outline,p:XYZ,v:XYZ,r:number,dt:number):{time:number;normal:XYZ;position:XYZ}|null{
 const [loX,loZ,hiX,hiZ]=shape.bounds,endX=p[0]+v[0]*dt,endZ=p[2]+v[2]*dt;
 if(Math.max(p[0],endX)+r<loX||Math.min(p[0],endX)-r>hiX||Math.max(p[2],endZ)+r<loZ||Math.min(p[2],endZ)-r>hiZ)return null;
 let best:{time:number;normal:XYZ;position:XYZ}|null=null;
 const accept=(t:number,nx:number,nz:number)=>{if(t<0||t>dt||v[0]*nx+v[2]*nz>=-.001||best&&t>=best.time)return;best={time:t,normal:[nx,0,nz],position:[p[0]+v[0]*t,p[1],p[2]+v[2]*t]}};
 const velocity2=v[0]**2+v[2]**2;if(velocity2<1e-12)return null;
 for(let i=0;i<shape.points.length;i++){
  const a=shape.points[i],b=shape.points[(i+1)%shape.points.length],ex=b[0]-a[0],ez=b[1]-a[1],length=Math.hypot(ex,ez),nx=ez/length,nz=-ex/length;
  const distance=(p[0]-a[0])*nx+(p[2]-a[1])*nz,approach=v[0]*nx+v[2]*nz;
  if(approach<-.001){const t=(r-distance)/approach,x=p[0]+v[0]*t,z=p[2]+v[2]*t,along=((x-a[0])*ex+(z-a[1])*ez)/(length*length);if(along>=0&&along<=1)accept(t,nx,nz)}
  // Rounded corners belong to the moving circle's true outline, not an enlarged box.
  const dx=p[0]-a[0],dz=p[2]-a[1],q=dx*v[0]+dz*v[2],discriminant=q*q-velocity2*(dx*dx+dz*dz-r*r);
  if(discriminant>=0){const t=(-q-Math.sqrt(discriminant))/velocity2,hx=dx+v[0]*t,hz=dz+v[2]*t,len=Math.hypot(hx,hz);if(len>1e-12)accept(t,hx/len,hz/len)}
 }
 return best;
}
