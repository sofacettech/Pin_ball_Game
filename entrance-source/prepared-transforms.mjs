import {PropertyBinding} from 'three';

// The exported world is rigid. Prepare its static matrices once, then update
// only animated branches once per pose, sharing those matrices with every
// mirror, transmission and main-camera pass. The model hierarchy must remain
// fixed while this cache is installed; restore before replacing the model.
export function createPreparedTransforms(root,clips,{dynamicObjects=[]}={}){
  const animated=new Set(dynamicObjects);
  for(const clip of clips)for(const track of clip.tracks){
    const path=PropertyBinding.parseTrackName(track.name);
    // Keep Three's normal traversal for exports requiring bone/property paths.
    if(path.objectName||path.propertyIndex!==undefined)return null;
    if(!['position','quaternion','scale'].includes(path.propertyName))continue;
    const object=PropertyBinding.findNode(root,path.nodeName);
    if(!object)return null;
    animated.add(object);
  }
  root.updateWorldMatrix(true,true);
  const nodes=[],moving=[],affected=new Set(),flags=[];
  root.traverse(object=>{
    nodes.push(object);flags.push([object.matrixAutoUpdate,object.matrixWorldAutoUpdate]);
    if(animated.has(object)||affected.has(object.parent)){affected.add(object);moving.push(object);}
    object.matrixAutoUpdate=false;object.matrixWorldAutoUpdate=false;
  });
  const local=nodes.filter(object=>animated.has(object));
  let parent=root.parent,parentMatrix=parent?.matrixWorld.clone(),restored=false;
  return {
    update(){
      if(restored)return;
      root.parent?.updateWorldMatrix(true,false);
      const parentChanged=root.parent!==parent||(root.parent&&!parentMatrix?.equals(root.parent.matrixWorld));
      if(parentChanged){parent=root.parent;parentMatrix=parent?.matrixWorld.clone();}
      for(const object of local)object.updateMatrix();
      for(const object of parentChanged?nodes:moving){
        if(object.parent)object.matrixWorld.multiplyMatrices(object.parent.matrixWorld,object.matrix);
        else object.matrixWorld.copy(object.matrix);
        object.matrixWorldNeedsUpdate=false;
      }
    },
    restore(){
      if(restored)return;restored=true;
      nodes.forEach((object,index)=>{
        [object.matrixAutoUpdate,object.matrixWorldAutoUpdate]=flags[index];
        object.matrixWorldNeedsUpdate=true;
      });
    },
  };
}
