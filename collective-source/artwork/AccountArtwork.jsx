import React, {useEffect, useState} from "react";
import {artworkAssetURL} from "../../shared/artwork-assets.js";
import "./account-butterfly.css";

export const butterflyTexture = "/assets/collective/a2aff306d62c24d0bbcf.webp";

export function AccountArtwork() {
  const [texture, setTexture] = useState(() => artworkAssetURL(butterflyTexture));
  useEffect(() => {
    if (texture === butterflyTexture) return;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onerror = () => setTexture(butterflyTexture);
    image.src = texture;
    return () => { image.onerror = null; };
  }, [texture]);
  return (<figure aria-label="Faceted crystal butterfly with gently moving wings and antennae" className="butterfly-scene" style={{"--butterfly-art": `url("${texture}")`}}>{"\n  "}<div className="butterfly-rig" aria-hidden="true">{"\n    "}<div className="butterfly-wings">{"\n      "}<span className="piece facet-wing wing-top"></span>{"\n      "}<span className="piece facet-wing wing-left"></span>{"\n      "}<span className="piece facet-wing wing-right"></span>{"\n      "}<span className="piece facet-wing wing-bottom"></span>{"\n    "}</div>{"\n    "}<span className="piece butterfly-body"></span>{"\n    "}<div className="butterfly-antennae">{"\n      "}<span className="piece antenna antenna-one"></span>{"\n      "}<span className="piece antenna antenna-two"></span>{"\n    "}</div>{"\n  "}</div>{"\n  "}<div className="butterfly-reflection" aria-hidden="true"></div>{"\n"}</figure>);
}

export function AccountMesh() {
  return (<iframe className="mesh-layer" aria-label="Interactive background" src="/assets/collective/meshes/account.html?v=no-hints-20261106"></iframe>);
}
