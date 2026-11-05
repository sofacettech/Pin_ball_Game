import React, {useLayoutEffect, useRef} from 'react';
import {createAnimationScope} from './animation-scope.js';

export default function PageShell({scene, initialize, title, children}) {
  const root = useRef(null);
  useLayoutEffect(() => {
    if (window.matchMedia('(max-width:900px)').matches) window.scrollTo(0, 0);
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = '/assets/collective/styles/' + scene + '.css?v=mobile-20261105b';
    let active = true;
    let scope;
    stylesheet.onload = () => {
      if (!active) return;
      scope = createAnimationScope(root.current);
      try {initialize(scope); root.current.dataset.sceneReady = 'true';}
      catch (error) {console.error('Artwork could not initialize:', error);}
    };
    const previousTitle = document.title;
    document.title = title;
    document.head.append(stylesheet);
    return () => {active = false; scope?.dispose(); stylesheet.remove(); document.title = previousTitle;};
  }, [scene, initialize, title]);
  return <div className={'react-page-root design-' + scene + (scene === 'claim' ? ' claim-art-intro' : '')} ref={root}>{children}</div>;
}
