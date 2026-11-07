import React, {useLayoutEffect, useRef} from 'react';
import {createAnimationScope} from './animation-scope.js';
import {brandText} from '../shared/brand-react.jsx';

export default function PageShell({scene, initialize, title, children}) {
  const root = useRef(null);
  useLayoutEffect(() => {
    root.current.style.visibility = 'hidden';
    root.current.style.opacity = '0';
    delete root.current.dataset.sceneReady;
    root.current.dataset.loaded = 'false';
    if (window.matchMedia('(max-width:900px)').matches) window.scrollTo(0, 0);
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = '/assets/collective/styles/' + scene + '.css?v=rules-20261107a';
    let active = true;
    let scope;
    stylesheet.onload = async () => {
      root.current?.getBoundingClientRect();
      await document.fonts?.ready.catch(() => {});
      if (!active) return;
      scope = createAnimationScope(root.current);
      try {initialize(scope); root.current.dataset.sceneReady = 'true';}
      catch (error) {console.error('Artwork could not initialize:', error);}
      root.current.dataset.loaded = 'true';
      root.current.style.removeProperty('visibility');
      root.current.style.removeProperty('opacity');
      root.current.dispatchEvent(new Event('sofacet:page-ready', {bubbles:true}));
    };
    stylesheet.onerror = () => {
      if (!active) return;
      root.current.style.removeProperty('visibility');
      root.current.style.removeProperty('opacity');
      root.current.dataset.loaded = 'error';
      console.error('Page stylesheet could not load:', stylesheet.href);
    };
    const previousTitle = document.title;
    document.title = title;
    document.head.append(stylesheet);
    return () => {active = false; scope?.dispose(); stylesheet.remove(); document.title = previousTitle;};
  }, [scene, initialize, title]);
  return <div className={'react-page-root design-' + scene + (scene === 'claim' ? ' claim-art-intro' : '')} style={{visibility:'hidden',opacity:0}} ref={root}>{brandText(children)}</div>;
}
