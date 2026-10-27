import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createAnimatedMeshBatch} from '../entrance-source/animated-mesh-batch.mjs';
import {createChamberReflections} from '../entrance-source/chamber-reflections.mjs';

function makeSources() {
  const material = new THREE.MeshStandardMaterial();
  const geometry = new THREE.BoxGeometry();
  return {material, geometry, objects: [new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material)]};
}

function assertClose(actual, expected) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++) assert.ok(Math.abs(actual[i] - expected[i]) < 1e-5, `${i}: ${actual[i]} != ${expected[i]}`);
}

test('merges every source triangle and attribute into one ordinary mesh with a transform ID per vertex', () => {
  const {objects, material, geometry} = makeSources();
  const batch = createAnimatedMeshBatch(objects, material);
  const merged = batch.mesh.geometry;
  assert.equal(batch.mesh.isBatchedMesh, undefined);
  assert.equal(batch.mesh.isMesh, true);
  assert.equal(batch.mesh.material, material);
  assert.equal(batch.mesh.frustumCulled, false);
  assert.equal(merged.groups.length, 0);
  assert.equal(merged.index.count, geometry.index.count * 2);
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    assert.equal(merged.attributes[name].count, attribute.count * 2);
    assert.deepEqual([...merged.attributes[name].array], [...attribute.array, ...attribute.array]);
  }
  assert.deepEqual([...merged.index.array], [...geometry.index.array, ...geometry.index.array.map(i => i + geometry.attributes.position.count)]);
  assert.deepEqual([...merged.attributes.journeyMatrixIndex.array], [
    ...new Array(geometry.attributes.position.count).fill(0),
    ...new Array(geometry.attributes.position.count).fill(1),
  ]);
  assert.equal(geometry.attributes.journeyMatrixIndex, undefined);
  assert.equal(objects[0].visible, true, 'source visibility remains the caller’s responsibility');
  batch.dispose();
});

test('matrix rows preserve nested animated transforms relative to a transformed root', () => {
  const {objects, material} = makeSources();
  const root = new THREE.Group();
  root.position.set(20, -30, 12);
  root.rotation.set(0.3, -0.5, 0.2);
  const parent = new THREE.Group();
  parent.position.set(2, 3, 4);
  parent.rotation.y = 0.6;
  root.add(parent, objects[1]);
  parent.add(objects[0]);
  objects[0].position.set(1, -2, 3);
  objects[0].scale.set(0.5, 2, 3);
  objects[1].position.set(-4, 5, 6);
  const batch = createAnimatedMeshBatch(objects, material);
  root.add(batch.mesh);
  const inverse = new THREE.Matrix4();
  const expected = new THREE.Matrix4();
  for (const turn of [0, 1]) {
    if (turn) { parent.rotation.y = 1.2; objects[1].position.x += 10; }
    root.updateMatrixWorld(true);
    inverse.copy(root.matrixWorld).invert();
    const before = batch.matrixTexture.version;
    batch.update(inverse);
    assert.equal(batch.matrixTexture.version, before + 1);
    for (let index = 0; index < objects.length; index++) {
      expected.multiplyMatrices(inverse, objects[index].matrixWorld);
      assertClose([...batch.matrixTexture.image.data.slice(index * 16, (index + 1) * 16)], expected.elements);
      const originalVertex = new THREE.Vector3().fromBufferAttribute(objects[index].geometry.attributes.position, 0).applyMatrix4(objects[index].matrixWorld);
      const batchVertex = new THREE.Vector3().fromBufferAttribute(objects[index].geometry.attributes.position, 0)
        .applyMatrix4(new THREE.Matrix4().fromArray(batch.matrixTexture.image.data, index * 16)).applyMatrix4(root.matrixWorld);
      assertClose(batchVertex.toArray(), originalVertex.toArray());
    }
  }
  assert.equal(batch.matrixTexture.image.width, 4);
  assert.equal(batch.matrixTexture.image.height, 2);
  assert.equal(batch.matrixTexture.type, THREE.FloatType);
  assert.equal(batch.matrixTexture.minFilter, THREE.NearestFilter);
  assert.equal(batch.matrixTexture.magFilter, THREE.NearestFilter);
  assert.equal(batch.matrixTexture.generateMipmaps, false);
  batch.dispose();
});

test('composes material hooks, preserves Three’s scaled-normal path and transforms chamber reflection positions', () => {
  const {objects, material} = makeSources();
  const renderer = {testRenderer: true};
  let customCalls = 0;
  createChamberReflections([], {value: 0.5})(material, {ball: true});
  const chamberCompile = material.onBeforeCompile;
  material.onBeforeCompile = function (shader, receivedRenderer) {
    assert.equal(this, material);
    assert.equal(receivedRenderer, renderer);
    customCalls++;
    chamberCompile(shader);
    shader.uniforms.existingUniform = {value: 7};
  };
  material.customProgramCacheKey = function () { assert.equal(this, material); return 'existing-chamber'; };
  material.defines = {EXISTING_DEFINE: 1};
  const batch = createAnimatedMeshBatch(objects, material);
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  material.onBeforeCompile(shader, renderer);
  assert.equal(customCalls, 1);
  assert.equal(shader.uniforms.existingUniform.value, 7);
  assert.equal(shader.uniforms.journeyMatrixTexture.value, batch.matrixTexture);
  assert.deepEqual(material.defines, {EXISTING_DEFINE: 1, USE_BATCHING: ''});
  assert.equal(material.customProgramCacheKey(), 'existing-chamber-journey-vertex-matrix-batch-v1');
  assert.match(shader.vertexShader, /vChamberSurface=\(modelMatrix\*batchingMatrix\*vec4\(transformed,1\.\)\)\.xyz/);
  assert.match(shader.vertexShader, /mat4 batchingMatrix = getBatchingMatrix\(journeyMatrixIndex\)/);
  assert.match(shader.vertexShader, /texelFetch\(journeyMatrixTexture, ivec2\(3, row\), 0\)/);
  assert.match(shader.vertexShader, /#include <defaultnormal_vertex>/);
  function expandIncludes(source) {
    return source.replace(/#include <(\w+)>/g, (_, name) => expandIncludes(THREE.ShaderChunk[name]));
  }
  const expanded = expandIncludes(shader.vertexShader);
  // Three's optional per-batch-color chunk still names gl_DrawID inside a
  // disabled branch. This mesh uses its ordinary material/vertex colors.
  assert.equal(material.defines.USE_BATCHING_COLOR, undefined);
  const withoutDisabledBatchColors = expanded.replace(/#ifdef USE_BATCHING_COLOR[\s\S]*?#endif/g, '');
  assert.doesNotMatch(withoutDisabledBatchColors, /gl_DrawID|batchingIdTexture|GL_ANGLE_multi_draw/);
  assert.match(expanded, /mat3 bm = mat3\( batchingMatrix \)/);
  assert.match(expanded, /transformedNormal \/= vec3/);
  assert.match(expanded, /mvPosition = batchingMatrix \* mvPosition/);
  assert.match(expanded, /worldPosition = batchingMatrix \* worldPosition/);
  batch.dispose();
});

test('disposes owned GPU resources once and restores material hooks without disposing shared sources', () => {
  const {objects, material, geometry} = makeSources();
  const originalCompile = material.onBeforeCompile;
  const originalCacheKey = material.customProgramCacheKey;
  const originalDefines = material.defines;
  const batch = createAnimatedMeshBatch(objects, material);
  let geometryDisposals = 0, textureDisposals = 0, sourceDisposals = 0, materialDisposals = 0;
  batch.mesh.geometry.addEventListener('dispose', () => geometryDisposals++);
  batch.matrixTexture.addEventListener('dispose', () => textureDisposals++);
  geometry.addEventListener('dispose', () => sourceDisposals++);
  material.addEventListener('dispose', () => materialDisposals++);
  batch.dispose();
  batch.dispose();
  assert.equal(geometryDisposals, 1);
  assert.equal(textureDisposals, 1);
  assert.equal(sourceDisposals, 0);
  assert.equal(materialDisposals, 0);
  assert.equal(material.onBeforeCompile, originalCompile);
  assert.equal(material.customProgramCacheKey, originalCacheKey);
  assert.equal(material.defines, originalDefines);
  const textureVersion = batch.matrixTexture.version;
  batch.update(new THREE.Matrix4());
  assert.equal(batch.matrixTexture.version, textureVersion);
});
