import {finishLoading} from '../assets/loading/intro.js';
import {downloadModel} from './download-model.mjs';

const controller = new AbortController();
let lastStatus, lastProgress;
export function setStartupStatus(message, progress = null) {
  if (message === lastStatus && progress === lastProgress) return;
  lastStatus = message; lastProgress = progress;
  for (const status of document.querySelectorAll('[data-scene-status]')) status.textContent = message;
  for (const bar of document.querySelectorAll('[data-scene-progress]')) {
    if (progress === null) bar.removeAttribute('value'); else bar.value = progress;
  }
}
// The lightweight logo owns only its six-second reveal, never the WebGL download.
// It is a separate entry so GSAP, fonts and Three.js cannot delay the first UI.
export const presentationReady = finishLoading();
export const modelDownload = downloadModel('/assets/entrance-3d/journey-compact.glb', {
  signal: controller.signal,
  onProgress: value => setStartupStatus(value === null ? 'Loading the world…' : `Loading the world… ${value}%`, value),
});
// The renderer can attach later, after its own module has downloaded.
modelDownload.catch(() => {});
export function cancelStartup() { controller.abort(); }
