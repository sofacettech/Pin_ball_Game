import {Box3,Vector3,MathUtils} from 'three';
import {JOURNEY_START_FRAME} from './journey-scroll.mjs';

// Fit the actual emblem and assembled ball into the opening viewport. A camera
// view offset can reveal more sky without changing the ball's world position.
export function fitOpeningView(view,bounds,frame){
  if(frame>=640)return view;
  const {width,height}=view;
  const left=Math.min(24,width*.04),top=MathUtils.clamp(height*.08,64,88),bottom=Math.min(64,height*.1);
  const scale=Math.min(1,(width-left*2)/(bounds.maxX-bounds.minX),(height-top-bottom)/(bounds.maxY-bounds.minY));
  const x=value=>(value-width/2)*scale+width/2;
  const y=value=>(value-height/2)*scale+height/2;
  const dx=MathUtils.clamp(0,left-x(bounds.minX),width-left-x(bounds.maxX));
  const dy=MathUtils.clamp(0,top-y(bounds.minY),height-bottom-y(bounds.maxY));
  const weight=1-MathUtils.smoothstep(frame,460,640),zoom=1+(scale-1)*weight;
  return {...view,fullWidth:view.fullWidth*zoom,fullHeight:view.fullHeight*zoom,
    x:view.x*zoom-width/2*(1-zoom)-dx*weight,
    y:view.y*zoom-height/2*(1-zoom)-dy*weight};
}

export function createOpeningFraming(model,{objects,anchor}){
  model.updateMatrixWorld(true);
  const logoPoints=[],ball=new Box3(),point=new Vector3();
  const vertices=(object,visit)=>{const positions=object.geometry.attributes.position;for(let i=0;i<positions.count;i++)visit(point.fromBufferAttribute(positions,i).applyMatrix4(object.matrixWorld))};
  model.traverse(object=>{if(object.isMesh&&object.material?.name==='Porcelain white emblem')vertices(object,p=>logoPoints.push(p.clone()))});
  if(!logoPoints.length)return ()=>null;
  for(const object of objects)ball.expandByObject(object);
  const center=ball.getCenter(new Vector3()),localCenter=center.clone().applyMatrix4(anchor.matrixWorld.clone().invert());
  let radiusSquared=0;
  for(const object of objects)object.traverse(child=>{if(child.isMesh)vertices(child,p=>{radiusSquared=Math.max(radiusSquared,p.distanceToSquared(center))})});
  const radius=Math.sqrt(radiusSquared),initialScale=anchor.matrixWorld.getMaxScaleOnAxis();
  let lastFrame,lastView,lastFit;
  return (camera,view,frame)=>{
    if(!view||frame>=640)return null;
    // The assembly camera stays fixed: reuse its fit until a scroll or resize.
    if(frame===lastFrame&&view===lastView)return lastFit;
    camera.updateMatrixWorld(true);
    if(frame!==JOURNEY_START_FRAME)anchor.updateWorldMatrix(true,false);
    const bounds={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
    for(const vertex of logoPoints){
      point.copy(vertex).project(camera);
      const x=(point.x+1)/2*view.fullWidth-view.x,y=(1-point.y)/2*view.fullHeight-view.y;
      bounds.minX=Math.min(bounds.minX,x);bounds.maxX=Math.max(bounds.maxX,x);
      bounds.minY=Math.min(bounds.minY,y);bounds.maxY=Math.max(bounds.maxY,y);
    }
    // The sphere's tangent bounds avoid the empty corners of a world AABB,
    // which would unnecessarily shrink the ball and lower the mobile emblem.
    const fixed=frame===JOURNEY_START_FRAME;
    point.copy(fixed?center:localCenter);if(!fixed)point.applyMatrix4(anchor.matrixWorld);
    point.applyMatrix4(camera.matrixWorldInverse);
    const r=radius*(fixed?1:anchor.matrixWorld.getMaxScaleOnAxis()/initialScale),depth=-point.z,denominator=depth*depth-r*r;
    const tangent=(value,sign)=>(value*depth+sign*r*Math.sqrt(depth*depth+value*value-r*r))/denominator;
    const px=camera.projectionMatrix.elements[0],py=camera.projectionMatrix.elements[5];
    bounds.minX=Math.min(bounds.minX,(tangent(point.x,-1)*px+1)/2*view.fullWidth-view.x);
    bounds.maxX=Math.max(bounds.maxX,(tangent(point.x,1)*px+1)/2*view.fullWidth-view.x);
    bounds.minY=Math.min(bounds.minY,(1-tangent(point.y,1)*py)/2*view.fullHeight-view.y);
    bounds.maxY=Math.max(bounds.maxY,(1-tangent(point.y,-1)*py)/2*view.fullHeight-view.y);
    lastFrame=frame;lastView=view;lastFit=fitOpeningView(view,bounds,frame);
    return lastFit;
  };
}
