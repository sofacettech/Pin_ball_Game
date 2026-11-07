import React, {useEffect, useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {mountMesh} from './mesh.js';
import './style.css';

function MeshBackground() {
  const surface = useRef(null);
  useEffect(() => mountMesh(surface.current), []);
  return <div className="mesh-layer">
    <div className="mesh-surface" id="mesh" ref={surface} tabIndex={0} role="button" aria-label="Click or tap to reveal the dark purple mesh with an outward wave. Press Enter or Space for a centered wave; Escape clears it.">
      <canvas aria-hidden="true"/>
    </div>
  </div>;
}

function NotFoundPage() {
  return <>
    <MeshBackground/>
    <main className="not-found-content">
      <section className="message" aria-labelledby="page-title">
        <svg className="error-art" viewBox="0 0 360 220" role="img" aria-label="404">
          <path className="numerals" d="M89 53 10 157H111M89 53V205 M331 53 252 157H353M331 53V205"/>
          <g className="gem">
            <path d="M210 30H158L136 56V182L158 208H210L232 182V56 M198 53H170L157 67V171L170 185H198L209 171V67"/>
            <path d="M158 30 170 53 M136 56 157 67 M136 182 157 171 M158 208 170 185 M210 208 198 185 M232 182 209 171 M210 30 198 53 M232 56 209 67"/>
          </g>
          <path className="facet" d="M210 30 232 56 209 67 198 53Z"/>
        </svg>
        <h1 id="page-title">Page not found.</h1>
        <div className="actions">
          <a className="action" href="/">Back to the world</a>
          <a className="action" href="/play.html">Play Pinball</a>
        </div>
      </section>
    </main>
  </>;
}

createRoot(document.getElementById('not-found-root')).render(<NotFoundPage/>);
