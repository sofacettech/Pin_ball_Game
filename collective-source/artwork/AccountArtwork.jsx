import React from "react";
import "./account-butterfly.css";

export const butterflyTexture = "/assets/collective/99e9c8ee37d7118ed1f7.png";

export function AccountArtwork() {
  return (<figure aria-label="Faceted crystal butterfly with gently moving wings and antennae" className="butterfly-scene" style={{"--butterfly-art": `url("${butterflyTexture}")`}}>{"\n  "}<div className="butterfly-rig" aria-hidden="true">{"\n    "}<div className="butterfly-wings">{"\n      "}<span className="piece facet-wing wing-top"></span>{"\n      "}<span className="piece facet-wing wing-left"></span>{"\n      "}<span className="piece facet-wing wing-right"></span>{"\n      "}<span className="piece facet-wing wing-bottom"></span>{"\n    "}</div>{"\n    "}<span className="piece butterfly-body"></span>{"\n    "}<div className="butterfly-antennae">{"\n      "}<span className="piece antenna antenna-one"></span>{"\n      "}<span className="piece antenna antenna-two"></span>{"\n    "}</div>{"\n  "}</div>{"\n  "}<div className="butterfly-reflection" aria-hidden="true"></div>{"\n"}</figure>);
}

export function AccountMesh() {
  return (<iframe className="mesh-layer" aria-label="Interactive background" src="/assets/collective/meshes/account.html?v=no-hints-20261106"></iframe>);
}
