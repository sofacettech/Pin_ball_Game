import * as THREE from 'three';

// Keep the rendered highlights on each real plate as it lifts from the matched resting pose.
export async function matchRenderedAppearance(model, camera) {
  const image = await new THREE.TextureLoader().loadAsync('./assets/handoff.webp');
  image.colorSpace = THREE.SRGBColorSpace;
  image.minFilter = THREE.LinearFilter;
  image.magFilter = THREE.LinearFilter;
  image.generateMipmaps = false;
  model.updateWorldMatrix(true, true);
  camera.updateWorldMatrix(true, false);
  const projection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const vertex = new THREE.Vector4();
  const normal = new THREE.Vector3();
  const position = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const eye = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  model.traverse(mesh => {
    if (!mesh.isMesh) return;
    let part = mesh;
    while (part && !part.userData.part) part = part.parent;
    if (part?.userData.part !== 'plate') return;
    mesh.geometry = mesh.geometry.clone();
    const geometry = mesh.geometry;
    const points = geometry.attributes.position;
    const normals = geometry.attributes.normal;
    const coordinates = new Float32Array(points.count * 4);
    const facing = new Float32Array(points.count);
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    for (let i = 0; i < points.count; i++) {
      position.fromBufferAttribute(points, i).applyMatrix4(mesh.matrixWorld);
      normal.fromBufferAttribute(normals, i).applyNormalMatrix(normalMatrix);
      facing[i] = normal.dot(direction.subVectors(eye, position).normalize()) > .01 ? 1 : 0;
      vertex.set(position.x, position.y, position.z, 1).applyMatrix4(projection).toArray(coordinates, i * 4);
    }
    geometry.setAttribute('referenceClip', new THREE.BufferAttribute(coordinates, 4));
    geometry.setAttribute('referenceFacing', new THREE.BufferAttribute(facing, 1));
    mesh.material = mesh.material.clone();
    mesh.material.onBeforeCompile = shader => {
      shader.uniforms.referenceImage = { value: image };
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
        attribute vec4 referenceClip;
        attribute float referenceFacing;
        varying vec4 vReferenceClip;
        varying float vReferenceFacing;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        vReferenceClip = referenceClip;
        vReferenceFacing = referenceFacing;`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
        uniform sampler2D referenceImage;
        varying vec4 vReferenceClip;
        varying float vReferenceFacing;`)
        .replace('#include <opaque_fragment>', `
        vec2 referenceUV = vReferenceClip.xy / vReferenceClip.w * .5 + .5;
        outgoingLight = mix(outgoingLight, texture2D(referenceImage, referenceUV).rgb, step(.99, vReferenceFacing));
        #include <opaque_fragment>`);
    };
    mesh.material.needsUpdate = true;
  });
  return image;
}
