import * as THREE from 'three';
import { loadSofacetBall, loadSofacetReflections, loadSofacetLighting } from './sofacet-ball.js';
import { createPlateHover } from './plate-hover.js';
import { matchRenderedAppearance } from './reference-appearance.js';
import { createSequence } from './sequence.js';
import { framePlacement } from './frame-placement.js';

const canvas = document.querySelector('#ball-canvas');
const status = document.querySelector('#status');
const stage = document.querySelector('#scene-frame');
const opening = document.querySelector('#opening');

async function main() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const [referenceResponse, framingResponse] = await Promise.all([
    fetch('./assets/frame223-reference.json'), fetch('./assets/ball-framing.json'),
  ]);
  if (!referenceResponse.ok || !framingResponse.ok) throw new Error('Could not load source camera framing');
  const [reference, framing] = await Promise.all([referenceResponse.json(), framingResponse.json()]);
  if (framing.fps !== 60 || framing.points.length !== 2230 || !framing.points.every(p => p.length === 2 && p.every(v => Number.isFinite(v) && v >= 0 && v <= 1))) {
    throw new Error('Invalid ball framing data');
  }
  const camera = new THREE.PerspectiveCamera();
  camera.matrixAutoUpdate = false;
  camera.matrix.set(...reference.cameraWorldMatrixRows.flat());
  camera.projectionMatrix.set(...reference.projectionMatrixRows.flat());
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  scene.add(camera);
  const [gltf, environment, lighting] = await Promise.all([loadSofacetBall(), loadSofacetReflections(renderer), loadSofacetLighting()]);
  const ball = new THREE.Group();
  ball.add(gltf.scene);
  scene.add(ball);
  scene.add(lighting);
  scene.environment = environment.texture;
  // The panorama's centre faces source +Y, which is Three.js -Z.
  scene.environmentRotation.y = Math.PI / 2;
  const hover = await createPlateHover(gltf.scene, gltf.animations[0]);
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const action = mixer.clipAction(gltf.animations[0]);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  // Clip 1 ends at 240, after the last animated plate has closed.
  mixer.setTime(240 / 60);
  hover.update(0);
  await matchRenderedAppearance(gltf.scene, camera);
  const mouse = new THREE.Vector2();
  let mouseInside = false;
  let pickDirty = false;
  let interactive = false;
  let sequence;
  let frameRequest = 0;
  let previous = 0;
  let drawDirty = true;
  const coverViewport = matchMedia('(max-width: 1024px), (any-pointer: coarse)');
  let viewportWidth = 0;
  let viewportHeight = 0;
  let placement;
  function requestFrame() {
    if (!sequence || frameRequest || document.hidden) return;
    frameRequest = requestAnimationFrame(renderFrame);
  }
  function clearHover() {
    mouseInside = false;
    hover.clear();
    requestFrame();
  }
  function trackMouse(event) {
    const bounds = canvas.getBoundingClientRect();
    mouse.set((event.clientX - bounds.left) / bounds.width * 2 - 1, 1 - (event.clientY - bounds.top) / bounds.height * 2);
    mouseInside = true;
    pickDirty = true;
    requestFrame();
  }
  canvas.addEventListener('pointermove', event => {
    if (interactive && event.pointerType !== 'touch') trackMouse(event);
  });
  canvas.addEventListener('pointerleave', clearHover);
  canvas.addEventListener('pointercancel', clearHover);
  window.addEventListener('blur', clearHover);
  canvas.addEventListener('webglcontextrestored', () => {
    drawDirty = true;
    requestFrame();
  });
  function placeStage() {
    const sourceFrame = sequence?.phase === 'journey' ? 240 + sequence.displayedFrame : sequence?.phase === 'idle' ? 240 : Math.min(240, opening.currentTime * 60);
    const index = Math.floor(sourceFrame);
    const next = framing.points[Math.min(index + 1, 2229)];
    const point = framing.points[index].map((v, i) => v + (next[i] - v) * (sourceFrame - index));
    const nextPlacement = framePlacement(viewportWidth, viewportHeight, point, coverViewport.matches);
    if (!placement || nextPlacement.width !== placement.width || nextPlacement.height !== placement.height) {
      stage.style.width = `${nextPlacement.width}px`;
      stage.style.height = `${nextPlacement.height}px`;
    }
    if (!placement || nextPlacement.x !== placement.x || nextPlacement.y !== placement.y) {
      stage.style.transform = `translate3d(${nextPlacement.x}px,${nextPlacement.y}px,0)`;
      drawDirty = true;
    }
    placement = nextPlacement;
  }
  function resize() {
    const available = stage.parentElement.getBoundingClientRect();
    viewportWidth = available.width;
    viewportHeight = available.height;
    placeStage();
    renderer.setSize(placement.width, placement.height, false);
    drawDirty = true;
    pickDirty = true;
    requestFrame();
  }
  new ResizeObserver(resize).observe(stage.parentElement);
  coverViewport.addEventListener('change', resize);
  opening.addEventListener('seeked', requestFrame);
  resize();
  sequence = await createSequence(enabled => {
    interactive = enabled;
    if (!enabled) clearHover();
    else pickDirty = true;
  }, requestFrame);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(frameRequest);
      frameRequest = 0;
      previous = 0;
      clearHover();
    } else requestFrame();
  });
  function renderFrame(now) {
    frameRequest = 0;
    const delta = previous ? Math.min((now - previous) / 1000, .1) : 1 / 60;
    previous = now;
    let moving = false;
    for (const plate of hover.plates.values()) moving ||= plate.weight !== plate.target;
    if (pickDirty || moving) {
      hover.restoreBase();
      // Pick against the underlying pose so a lifting plate cannot un-hover itself.
      if (mouseInside && pickDirty) hover.pick(mouse, camera);
      else if (!mouseInside) hover.clear();
      pickDirty = false;
      hover.update(delta);
      drawDirty = true;
    }
    let hoverWeight = 0;
    moving = false;
    for (const plate of hover.plates.values()) {
      hoverWeight = Math.max(hoverWeight, plate.weight);
      moving ||= plate.weight !== plate.target;
    }
    const seeking = sequence.tick(delta, hoverWeight);
    placeStage();
    if (drawDirty && sequence.phase === 'idle') {
      renderer.setScissorTest(coverViewport.matches);
      if (coverViewport.matches) renderer.setScissor(-placement.x - 1, placement.height + placement.y - viewportHeight - 1, viewportWidth + 2, viewportHeight + 2);
      renderer.render(scene, camera);
      drawDirty = false;
    }
    if (moving || seeking || (coverViewport.matches && sequence.phase === 'opening' && !opening.paused && !opening.ended)) requestFrame();
    else previous = 0;
  }
  window.sofacetPreview = { scene, camera, renderer, gltf, ball, hover, reference, frame: 240, sequence };
  requestFrame();
}
main().catch(error => {
  status.hidden = false;
  status.classList.add('error');
  status.textContent = `Could not load the ball: ${error.message}. Run this folder through a local web server.`;
  console.error(error);
});
