import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

const matrixAttribute = 'journeyMatrixIndex';
const batchingParameters = /* glsl */`
#ifdef USE_BATCHING
  attribute float journeyMatrixIndex;
  uniform highp sampler2D journeyMatrixTexture;
  mat4 getBatchingMatrix(const in float index) {
    int row = int(index);
    return mat4(
      texelFetch(journeyMatrixTexture, ivec2(0, row), 0),
      texelFetch(journeyMatrixTexture, ivec2(1, row), 0),
      texelFetch(journeyMatrixTexture, ivec2(2, row), 0),
      texelFetch(journeyMatrixTexture, ivec2(3, row), 0)
    );
  }
#endif
`;
const batchingTransform = /* glsl */`
#ifdef USE_BATCHING
  mat4 batchingMatrix = getBatchingMatrix(journeyMatrixIndex);
#endif
`;

/**
 * Combine rigid, independently animated meshes into one ordinary Mesh draw.
 * Unlike BatchedMesh's fallback, this does not need WEBGL_multi_draw: each
 * vertex carries its source transform's row in a small float texture.
 *
 * Sources must have compatible geometry attributes and no skin/morph animation.
 * The caller hides the source meshes (retaining them for AnimationMixer), adds
 * the returned mesh with an identity transform under the animation root, and
 * updates source matrixWorld values before passing the inverse root matrix to
 * update(). The supplied material must be exclusive to this batch.
 * dispose() owns only the merged geometry/texture and restores material hooks.
 */
export function createAnimatedMeshBatch(objects, material) {
  if (!objects.length) throw new Error('An animated mesh batch needs at least one source mesh.');
  if (!material?.isMaterial) throw new Error('An animated mesh batch needs one material.');
  for (const object of objects) {
    if (!object.isMesh || object.isSkinnedMesh || !object.geometry?.attributes.position
      || Object.keys(object.geometry.morphAttributes).length) {
      throw new Error('Animated mesh batches support rigid meshes with position attributes only.');
    }
  }

  const geometries = objects.map((object, index) => {
    const geometry = object.geometry.clone();
    geometry.setAttribute(matrixAttribute, new THREE.Float32BufferAttribute(
      new Float32Array(geometry.attributes.position.count).fill(index), 1,
    ));
    return geometry;
  });
  let geometry;
  try {
    geometry = mergeGeometries(geometries, false);
  } finally {
    for (const source of geometries) source.dispose();
  }
  if (!geometry) throw new Error('Animated mesh batch source geometries have incompatible attributes.');

  // Four RGBA texels store the four columns of one matrix. No indirect-ID
  // texture or draw-ID shader extension is needed, including on iOS Safari.
  const matrices = new Float32Array(objects.length * 16);
  const matrix = new THREE.Matrix4();
  for (let index = 0; index < objects.length; index++) matrix.toArray(matrices, index * 16);
  const matrixTexture = new THREE.DataTexture(matrices, 4, objects.length, THREE.RGBAFormat, THREE.FloatType);
  matrixTexture.name = 'Animated mesh transforms';
  matrixTexture.needsUpdate = true;

  const previousCompile = material.onBeforeCompile;
  const previousCacheKey = material.customProgramCacheKey;
  const previousDefines = material.defines;
  const batchDefines = {...previousDefines, USE_BATCHING: ''};
  material.defines = batchDefines;
  const compile = function (shader, renderer) {
    previousCompile.call(this, shader, renderer);
    shader.uniforms.journeyMatrixTexture = {value: matrixTexture};
    shader.vertexShader = shader.vertexShader
      .replace('#include <batching_pars_vertex>', batchingParameters)
      .replace('#include <batching_vertex>', batchingTransform)
      // The finite chamber reflections add their own world-position varying.
      // Three's standard world/project/normal chunks already handle batching.
      .replaceAll('(modelMatrix*vec4(transformed,1.)).xyz', '(modelMatrix*batchingMatrix*vec4(transformed,1.)).xyz');
  };
  const cacheKey = function () {
    return previousCacheKey.call(this) + '-journey-vertex-matrix-batch-v1';
  };
  material.onBeforeCompile = compile;
  material.customProgramCacheKey = cacheKey;
  material.needsUpdate = true;

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Animated ball facet batch';
  // The merged geometry's local bounds cannot describe independently animated
  // source transforms. Keep the same culling behavior as the previous batch.
  mesh.frustumCulled = false;
  let disposed = false;

  return {
    mesh,
    matrixTexture,
    update(rootInverse) {
      if (disposed) return;
      for (let index = 0; index < objects.length; index++) {
        matrix.multiplyMatrices(rootInverse, objects[index].matrixWorld).toArray(matrices, index * 16);
      }
      matrixTexture.needsUpdate = true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      geometry.dispose();
      matrixTexture.dispose();
      if (material.onBeforeCompile === compile) material.onBeforeCompile = previousCompile;
      if (material.customProgramCacheKey === cacheKey) material.customProgramCacheKey = previousCacheKey;
      if (material.defines === batchDefines) material.defines = previousDefines;
      material.needsUpdate = true;
    },
  };
}
