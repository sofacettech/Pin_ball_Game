// Reflector mirrors the camera's right axis. Its off-centre horizontal crop
// must mirror too, otherwise visible floor pixels project outside the capture.
// Keep vertical framing, lens, and the source camera itself unchanged.
export function copyReflectionCamera(source,target){
  target.copy(source,false);
  target.projectionMatrix.elements[8]*=-1;
  target.projectionMatrixInverse.copy(target.projectionMatrix).invert();
  return target;
}
