import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

/** Exact source meshes and sampled plate motion. No room, floor, camera, or lights in this asset. */
export async function loadSofacetBall() {
  return new GLTFLoader().loadAsync(new URL('./assets/sofacet-ball.glb', import.meta.url).href);
}

/** Reflections captured at the original ball location; this adds no scene geometry. */
export async function loadSofacetReflections(renderer) {
  const source = await new HDRLoader().loadAsync(new URL('./assets/frame223-reflections.hdr', import.meta.url).href);
  source.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromEquirectangular(source);
  source.dispose();
  pmrem.dispose();
  return environment;
}

/** Optional original light positions and colors. Lights have no visible geometry. */
export async function loadSofacetLighting() {
  const response = await fetch(new URL('./assets/source-lighting.json', import.meta.url));
  if (!response.ok) throw new Error('Could not load source lighting');
  const source = await response.json();
  RectAreaLightUniformsLib.init();
  const group = new THREE.Group();
  group.name = 'Source illumination (no geometry)';
  for (const entry of source) {
    const disk = entry.shape === 'DISK' || entry.shape === 'ELLIPSE';
    const factor = disk ? Math.sqrt(Math.PI / 4) : 1;
    // shortcut: equal-area rectangles approximate source disk lights; use custom disk integration for identical highlight outlines.
    const width = entry.width * factor;
    const height = entry.height * factor;
    const light = new THREE.RectAreaLight(new THREE.Color().setRGB(...entry.colorLinear), entry.energy / (Math.PI * width * height), width, height);
    light.name = entry.name;
    light.position.fromArray(entry.position);
    const [w, x, y, z] = entry.quaternion;
    light.quaternion.set(x, y, z, w);
    group.add(light);
  }
  return group;
}
