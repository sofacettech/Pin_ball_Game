import * as THREE from 'three';

/** Lift the picked plate to its authored Blender peak, with lower edge-sharing neighbours. */
export async function createPlateHover(model, clip) {
  const response = await fetch(new URL('./assets/hover-spec.json', import.meta.url));
  if (!response.ok) throw new Error('Could not load plate hover data');
  const spec = await response.json();
  const plates = new Map();
  model.traverse(object => {
    if (object.userData.part !== 'plate') return;
    const name = object.userData.source_name;
    if (!spec.plates[name]) throw new Error(`Missing hover data for ${name}`);
    plates.set(name, {
      object, neighbours: spec.plates[name].neighbours,
      basePosition: object.position.clone(), baseQuaternion: object.quaternion.clone(),
      restPosition: object.position.clone(), restQuaternion: object.quaternion.clone(),
      peakPosition: new THREE.Vector3(), peakQuaternion: new THREE.Quaternion(),
      weight: 0, target: 0,
    });
  });
  if (plates.size !== 43) throw new Error('Expected all 43 authored plates');

  const sampler = new THREE.AnimationMixer(model);
  sampler.clipAction(clip).play();
  for (const [name, state] of plates) {
    sampler.setTime(spec.plates[name].peakFrame / spec.fps);
    state.peakPosition.copy(state.object.position);
    state.peakQuaternion.copy(state.object.quaternion);
  }
  sampler.stopAllAction();
  sampler.uncacheRoot(model);
  for (const state of plates.values()) {
    state.object.position.copy(state.restPosition);
    state.object.quaternion.copy(state.restQuaternion);
  }

  const raycaster = new THREE.Raycaster();
  const intersections = [];
  let activePlate = null;

  function select(object) {
    if (object === activePlate) return;
    activePlate = object;
    const active = object ? plates.get(object.userData.source_name) : null;
    for (const [name, state] of plates) {
      state.target = state === active ? 1 : (active?.neighbours.includes(name) ? spec.neighbourLift : 0);
    }
  }
  function restoreBase() {
    for (const state of plates.values()) {
      state.object.position.copy(state.basePosition);
      state.object.quaternion.copy(state.baseQuaternion);
    }
  }
  function pick(pointer, camera) {
    model.updateWorldMatrix(true, true);
    camera.updateWorldMatrix(true, false);
    raycaster.setFromCamera(pointer, camera);
    intersections.length = 0;
    raycaster.intersectObject(model, true, intersections);
    let object = intersections[0]?.object ?? null;
    while (object && !object.userData.part) object = object.parent;
    select(object?.userData.part === 'plate' ? object : null);
  }
  function update(delta) {
    const amount = 1 - Math.exp(-spec.response * delta);
    for (const state of plates.values()) {
      state.basePosition.copy(state.object.position);
      state.baseQuaternion.copy(state.object.quaternion);
      state.weight += (state.target - state.weight) * amount;
      if (Math.abs(state.weight - state.target) < .0001) state.weight = state.target;
      if (!state.weight) continue;
      state.object.position.lerp(state.peakPosition, state.weight);
      state.object.quaternion.slerp(state.peakQuaternion, state.weight);
    }
  }
  function reset() {
    restoreBase();
    select(null);
    for (const state of plates.values()) state.weight = 0;
  }
  return { plates, restoreBase, pick, update, reset, clear: () => select(null),
    get activePlate() { return activePlate; }, neighbourLift: spec.neighbourLift };
}
