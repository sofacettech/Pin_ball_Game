import {BufferAttribute} from 'three';
import {MeshoptSimplifier} from 'three/addons/libs/meshopt_simplifier.module.js';

// Keep every source vertex, UV and normal. Remove redundant triangle indices
// within the existing 0.02% object-size error bound. Attribute-aware seam
// collapse is limited to scenery; glass, polished architecture and jewelry
// retain the original stricter topology rules.
export async function prepareJourneyGeometry(root){
  const geometries=new Map(),protectedGeometry=new Set(),strictGeometry=new Set();
  root.traverse(object=>{
    if(!object.isMesh)return;
    const geometry=object.geometry,materials=Array.isArray(object.material)?object.material:[object.material];
    if(materials.some(material=>/SOFACET ball|logo|letter|text/i.test(material.name))||object.isSkinnedMesh||Object.keys(geometry.morphAttributes).length)protectedGeometry.add(geometry);
    if(materials.some(material=>material.transmission>0||/Polished steel|Arch borders|Arch entry|architectural blocks|Exterior boxes|Earrings|Necklace|Ring|Chess ·/.test(material.name)))strictGeometry.add(geometry);
    geometries.set(geometry,object);
  });
  let originalTriangles=0,optimizedTriangles=0,maxRelativeError=0,optimizedGeometries=0,yielded=performance.now();
  if(MeshoptSimplifier.supported)await MeshoptSimplifier.ready;
  for(const [geometry] of geometries){
    const index=geometry.index,position=geometry.getAttribute('position'),normal=geometry.getAttribute('normal'),uv=geometry.getAttribute('uv');
    const originalCount=index?.count||position.count;originalTriangles+=originalCount/3;
    if(MeshoptSimplifier.supported&&index&&originalCount>=18000&&!protectedGeometry.has(geometry)&&geometry.groups.length<=1){
      if(performance.now()-yielded>8){await new Promise(resolve=>setTimeout(resolve,0));yielded=performance.now();}
      const positions=new Float32Array(position.count*3),attributes=new Float32Array(position.count*5);
      for(let i=0;i<position.count;i++){
        const p=i*3,a=i*5;
        positions[p]=position.getX(i);positions[p+1]=position.getY(i);positions[p+2]=position.getZ(i);
        attributes[a]=normal?.getX(i)||0;attributes[a+1]=normal?.getY(i)||0;attributes[a+2]=normal?.getZ(i)||0;
        attributes[a+3]=uv?.getX(i)||0;attributes[a+4]=uv?.getY(i)||0;
      }
      const strict=strictGeometry.has(geometry),normalWeight=strict?.015:.05;
      const [indices,error]=MeshoptSimplifier.simplifyWithAttributes(new Uint32Array(index.array),positions,3,attributes,5,[normalWeight,normalWeight,normalWeight,.1,.1],null,Math.floor(originalCount*.25/3)*3,.0002,strict?['LockBorder']:['LockBorder','Permissive']);
      if(indices.length<originalCount){
        geometry.setIndex(new BufferAttribute(indices,1));
        if(geometry.groups.length===1)geometry.groups[0].count=indices.length;
        maxRelativeError=Math.max(maxRelativeError,error);optimizedGeometries++;
      }
    }
    optimizedTriangles+=(geometry.index?.count||position.count)/3;
  }
  return {originalTriangles,optimizedTriangles,maxRelativeError,optimizedGeometries};
}
