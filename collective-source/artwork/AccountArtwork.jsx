import React, {useEffect, useRef, useState} from "react";
import {artworkAssetURL} from "../../shared/artwork-assets.js";
import "./account-butterfly.css";

export const butterflyTexture = "/assets/collective/a2aff306d62c24d0bbcf.webp";

export function AccountArtwork() {
  const scene = useRef(null);
  const [texture, setTexture] = useState(() => artworkAssetURL(butterflyTexture));
  useEffect(() => {
    const node = scene.current;
    let visible = typeof IntersectionObserver === 'undefined';
    const sync = () => node.classList.toggle('butterfly-paused', document.hidden || !visible);
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      sync();
    });
    observer?.observe(node);
    document.addEventListener('visibilitychange', sync);
    sync();
    return () => {observer?.disconnect(); document.removeEventListener('visibilitychange', sync);};
  }, []);
  useEffect(() => {
    if (texture === butterflyTexture) return;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onerror = () => setTexture(butterflyTexture);
    image.src = texture;
    return () => { image.onerror = null; };
  }, [texture]);
  return (<figure ref={scene} aria-label="Faceted crystal butterfly with gently moving wings and antennae" className="butterfly-scene butterfly-paused" style={{"--butterfly-art": `url("${texture}")`}}>{"\n  "}<div className="butterfly-rig" aria-hidden="true">{"\n    "}<div className="butterfly-wings">{"\n      "}<span className="piece facet-wing wing-top"></span>{"\n      "}<span className="piece facet-wing wing-left"></span>{"\n      "}<span className="piece facet-wing wing-right"></span>{"\n      "}<span className="piece facet-wing wing-bottom"></span>{"\n    "}</div>{"\n    "}<span className="piece butterfly-body"></span>{"\n    "}<div className="butterfly-antennae">{"\n      "}<span className="piece antenna antenna-one"></span>{"\n      "}<span className="piece antenna antenna-two"></span>{"\n    "}</div>{"\n  "}</div>{"\n  "}<div className="butterfly-reflection" aria-hidden="true"></div>{"\n"}</figure>);
}

export function AccountMesh() {
  return (<iframe className="mesh-layer" aria-label="Interactive background" src="/assets/collective/meshes/account.html?v=no-hints-20261106"></iframe>);
}
