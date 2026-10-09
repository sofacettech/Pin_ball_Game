import type {XYZ} from './types.ts';
import type {Outline} from './bumper-sweep.ts';
export function overlapCircle(shape:Outline,p:XYZ,r:number){
 let inside=true,best=Infinity,point:[number,number]=[0,0],edgeNormal:[number,number]=[0,0];
 for(let i=0;i<shape.points.length;i++){
  const a=shape.points[i],b=shape.points[(i+1)%shape.points.length],x=b[0]-a[0],z=b[1]-a[1],l2=x*x+z*z;
  if(!l2)continue;
  if(x*(p[2]-a[1])-z*(p[0]-a[0])<0)inside=false;
  const t=Math.max(0,Math.min(1,((p[0]-a[0])*x+(p[2]-a[1])*z)/l2)),q:[number,number]=[a[0]+x*t,a[1]+z*t],d=Math.hypot(p[0]-q[0],p[2]-q[1]);
  if(d<best){best=d;point=q;edgeNormal=[z/Math.sqrt(l2),-x/Math.sqrt(l2)]}
 }
 if(!inside&&best>=r)return null;
 const n:XYZ=inside||best<1e-12?[edgeNormal[0],0,edgeNormal[1]]:[(p[0]-point[0])/best,0,(p[2]-point[1])/best];
 return {normal:n,depth:inside?r+best:r-best};
}
const sub=(a:XYZ,b:XYZ):XYZ=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const dot=(a:XYZ,b:XYZ)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const mix=(a:XYZ,b:XYZ,t:number):XYZ=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
// Closest actual triangle point; avoids scale-sensitive convex support queries.
export function closestTriangle(p:XYZ,a:XYZ,b:XYZ,c:XYZ):XYZ{
 const ab=sub(b,a),ac=sub(c,a),ap=sub(p,a),d1=dot(ab,ap),d2=dot(ac,ap);if(d1<=0&&d2<=0)return a;
 const bp=sub(p,b),d3=dot(ab,bp),d4=dot(ac,bp);if(d3>=0&&d4<=d3)return b;
 const vc=d1*d4-d3*d2;if(vc<=0&&d1>=0&&d3<=0)return mix(a,b,d1/(d1-d3));
 const cp=sub(p,c),d5=dot(ab,cp),d6=dot(ac,cp);if(d6>=0&&d5<=d6)return c;
 const vb=d5*d2-d1*d6;if(vb<=0&&d2>=0&&d6<=0)return mix(a,c,d2/(d2-d6));
 const va=d3*d6-d5*d4;if(va<=0&&(d4-d3)>=0&&(d5-d6)>=0)return mix(b,c,(d4-d3)/((d4-d3)+(d5-d6)));
 const denom=va+vb+vc;if(Math.abs(denom)<1e-24)return a;
 const v=vb/denom,w=vc/denom;return[a[0]+ab[0]*v+ac[0]*w,a[1]+ab[1]*v+ac[1]*w,a[2]+ab[2]*v+ac[2]*w];
}
