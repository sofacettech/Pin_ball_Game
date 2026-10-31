import {Matrix4,Vector3,Quaternion} from 'three';

// Animated GLTF nodes wrap their mesh primitives. Cache the animated wrappers,
// not the children whose names/materials have been changed by mesh batching.
export function findAssemblyObjects(root){
  const objects=[];
  root.traverse(object=>{if(object.userData.name?.includes('Travel exterior ball |'))objects.push(object)});
  return{objects,anchor:objects.find(object=>object.userData.name.endsWith('InnerCore'))};
}

// Sample once under the loader. Playback touches only the ball's rigid facets,
// with no scene-wide AnimationMixer evaluation or per-frame allocations.
export function createAssemblyPoses({objects,anchor,sample,targetFrame}) {
  if(!anchor||!objects.length)throw Error('The assembly ball is missing.');
  sample(240);
  const sourceInverse=anchor.matrixWorld.clone().invert();
  sample(targetFrame);
  const relocation=anchor.matrixWorld.clone().multiply(sourceInverse);
  const parents=objects.map(object=>object.parent.matrixWorld.clone().invert().multiply(relocation));
  const final=objects.map(object=>object.matrix.clone());
  const values=new Float32Array(240*objects.length*10);
  const matrix=new Matrix4(),position=new Vector3(),quaternion=new Quaternion(),scale=new Vector3();
  for(let frame=1;frame<=240;frame++) {
    sample(frame);
    objects.forEach((object,index)=>{
      if(frame===240)matrix.copy(final[index]);
      else matrix.multiplyMatrices(parents[index],object.matrixWorld);
      matrix.decompose(position,quaternion,scale);
      const offset=((frame-1)*objects.length+index)*10;
      position.toArray(values,offset);quaternion.toArray(values,offset+3);scale.toArray(values,offset+7);
    });
  }
  sample(targetFrame);
  return {
    byteLength:values.byteLength,
    apply(frame) {
      const at=Math.max(0,Math.min(239,frame-1)),a=Math.floor(at),b=Math.min(239,a+1),weight=at-a;
      for(let index=0;index<objects.length;index++){
        const object=objects[index];
        const x=(a*objects.length+index)*10,y=(b*objects.length+index)*10;
        object.position.fromArray(values,x).lerp(position.fromArray(values,y),weight);
        object.quaternion.fromArray(values,x+3).slerp(quaternion.fromArray(values,y+3),weight);
        object.scale.fromArray(values,x+7).lerp(scale.fromArray(values,y+7),weight);
        object.updateMatrix();
      }
    },
  };
}
