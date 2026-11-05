import React, {useEffect, useRef} from 'react';
import {mountScoreMesh} from '../../game-source/src/score-mesh';

export function AccessScene() {
  const surface = useRef(null);
  const butterfly = useRef(null);
  const trigger = useRef(null);

  useEffect(() => {
    const layer = surface.current;
    const mesh = mountScoreMesh(layer, () => {});
    if (!mesh) return;
    const events = new AbortController();
    const options = {signal: events.signal};
    document.addEventListener('click', event => {
      if (!(event.target instanceof Element) || event.target.closest('button, a, input, select, label, dialog')) return;
      mesh.start(event.clientX, event.clientY);
    }, options);
    trigger.current.addEventListener('click', () => mesh.start(layer.clientWidth / 2, layer.clientHeight / 2), options);
    const frame = requestAnimationFrame(() => {
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const art = butterfly.current.getBoundingClientRect();
      mesh.start(art.left + art.width * .39, art.top + art.height * .27);
    });
    return () => {events.abort(); cancelAnimationFrame(frame); mesh.dispose();};
  }, []);

  return <>
    <div className="access-mesh" ref={surface} aria-hidden="true"><canvas/></div>
    <figure className="access-butterfly" ref={butterfly} aria-hidden="true">
      <div className="butterfly-rig">
        {['top','left','right','bottom'].map(wing => <span key={wing} className={'piece facet-wing wing-'+wing}/>)}
        <span className="piece butterfly-body"/>
        <span className="piece antenna antenna-one"/>
        <span className="piece antenna antenna-two"/>
      </div>
      <div className="butterfly-reflection"/>
    </figure>
    <button className="access-mesh-key" type="button" ref={trigger}>Reveal the purple mesh</button>
  </>;
}
