import flowers from './flower-variants.json' with {type:'json'};
import {artworkAssetURL} from '../../shared/artwork-assets.js';

export function flowerSceneMedia(src, scene) {
  const flower = flowers[src];
  if (!flower || !['desktop','mobile'].includes(scene)) return null;
  const breakpoint = flower.layout === 'launch' ? 850 : 767;
  return scene === 'mobile' ? `(max-width:${breakpoint}px)` : `not all and (max-width:${breakpoint}px)`;
}

// These slots mirror the scene artboards in flow.css/reward-integration.css,
// including short landscape screens. The 2% sampling guard covers the sub-1%
// petal deformation. CSS sway rotates the artwork without magnification.
export function flowerImageAttributes(src, width, resolve = artworkAssetURL) {
  const flower = flowers[src];
  const percent = Number.parseFloat(width);
  if (!flower || !/^\d+(?:\.\d+)?%$/.test(width || '') || !(percent > 0)) return {};
  const fraction = percent / 100 * 1.02;
  const slot = canvas => `calc(${canvas} * ${fraction})`;
  const sizes = flower.layout === 'launch'
    ? `(max-width:850px) ${slot('min(100vw, 620px)')}, ${slot('min(100vw, 1671px)')}`
    : `(max-width:850px) ${slot('min(100vw, 500px, 90svh)')}, ${slot('min(100vw, 1671px)')}`;
  return {srcSet:flower.variants.map(candidate => `${resolve(candidate.src)} ${candidate.width}w`).join(', '), sizes};
}
