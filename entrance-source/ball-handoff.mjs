// The flattened GLB switches ball copies between its last exterior sample
// (925) and first interior sample (931). Interpolating each copy separately
// sends the outgoing ball toward its hidden storage pose while shrinking it.
// Bridge the two visible poses with one complete ball, then use the interior
// copy's original animation. Camera, materials and all other frames stay intact.
const startFrame=925,endFrame=931;
const exterior='Travel exterior ball |',interior='Same starting ball |';
const pose=object=>({position:object.position.clone(),quaternion:object.quaternion.clone(),scale:object.scale.clone()});

export function createBallHandoff(root,{sample,restoreFrame}){
  const outgoing=new Map(),incoming=new Map();
  root.traverse(object=>{
    const name=object.userData.source_name||object.userData.name||object.name;
    for(const [prefix,parts] of [[exterior,outgoing],[interior,incoming]]){
      const at=name.indexOf(prefix);
      if(at!==-1)parts.set(name.slice(at+prefix.length).trim(),object);
    }
  });
  const pairs=[...outgoing].map(([part,from])=>({from,to:incoming.get(part)}));
  if(!pairs.length||pairs.some(pair=>!pair.to))throw Error('The entrance ball handoff is missing matching facets.');
  try{
    sample(startFrame);for(const pair of pairs)pair.start=pose(pair.from);
    sample(endFrame);for(const pair of pairs)pair.end=pose(pair.to);
  }finally{sample(restoreFrame);}
  return {
    apply(frame){
      if(frame<startFrame||frame>=endFrame)return;
      const weight=(frame-startFrame)/(endFrame-startFrame);
      for(const {from,to,start,end} of pairs){
        from.position.copy(start.position).lerp(end.position,weight);
        from.quaternion.copy(start.quaternion).slerp(end.quaternion,weight);
        from.scale.copy(start.scale).lerp(end.scale,weight);
        to.scale.setScalar(0);
        from.updateMatrix();to.updateMatrix();
      }
    }
  };
}
