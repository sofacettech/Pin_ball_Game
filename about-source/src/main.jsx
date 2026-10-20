import React, {useLayoutEffect, useRef} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';

function App() {
  const content=useRef(null);
  useLayoutEffect(()=>{
    const root=content.current,scenes=[...root.querySelectorAll('[data-scene]')],media=matchMedia('(prefers-reduced-motion: reduce)');
    let observer;
    scenes.forEach(scene=>scene.querySelectorAll('[data-reveal]').forEach((element,index)=>element.style.setProperty('--text-delay',index*85+'ms')));
    function reveal() {
      observer?.disconnect();
      if(media.matches||!('IntersectionObserver' in window)){
        root.classList.remove('motion-ready');scenes.forEach(scene=>scene.classList.add('is-visible'));return;
      }
      root.classList.add('motion-ready');
      observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('is-visible');observer.unobserve(entry.target)}}),{rootMargin:'0px 0px -5% 0px',threshold:.08});
      scenes.forEach(scene=>observer.observe(scene));
    }
    reveal();media.addEventListener('change',reveal);
    return()=>{observer?.disconnect();media.removeEventListener('change',reveal);root.classList.remove('motion-ready');scenes.forEach(scene=>scene.classList.remove('is-visible'));root.querySelectorAll('[data-reveal]').forEach(element=>element.style.removeProperty('--text-delay'))};
  },[]);
  return <>
    <img className="persistent-background" src="/assets/about/about-scene.webp" width="1122" height="430" alt="" aria-hidden="true" fetchPriority="high" onError={event=>{event.currentTarget.hidden=true}}/>
    <a className="skip-link" href="#about-content">Skip to content</a>
    <main id="about-content" ref={content} tabIndex={-1}>
      <section className="scene hero" data-scene aria-labelledby="hero-title">
        <div className="hero-shade" aria-hidden="true"/>
        <div className="hero-copy scene-copy">
          <p className="eyebrow" data-reveal>About SO/FACET</p>
          <h1 id="hero-title" data-reveal>Diamonds,<br/><span>made for who you are.</span></h1>
          <p className="hero-description" data-reveal>So/Facet is a lab-grown diamond jewellery house<br className="desktop-break"/> from India. Real diamonds, grown instead of mined.</p>
          <span className="accent-line" data-reveal aria-hidden="true"/>
        </div>
      </section>
      <section className="scene philosophy" data-scene aria-labelledby="philosophy-title">
        <div className="philosophy-shade" aria-hidden="true"/>
        <div className="philosophy-copy scene-copy">
          <p className="eyebrow" data-reveal>Our philosophy</p>
          <h2 id="philosophy-title" data-reveal>For generations,<br/><span>diamonds came with rules.</span></h2>
          <p data-reveal>Few shapes. Few occasions. Chosen by someone else.<br className="desktop-break"/> We’re building something different.</p>
          <span className="accent-line" data-reveal aria-hidden="true"/>
        </div>
      </section>
      <section className="scene collections" data-scene aria-labelledby="collections-title">
        <div className="collections-copy scene-copy">
          <p className="eyebrow" data-reveal>Our collections</p>
          <h2 id="collections-title" data-reveal>Six collections are on their way.</h2>
          <p data-reveal>We’d rather show you than tell you.</p>
          <span className="accent-line" data-reveal aria-hidden="true"/>
        </div>
      </section>
      <section className="scene closing" data-scene aria-labelledby="closing-title">
        <div className="closing-shade" aria-hidden="true"/>
        <div className="closing-copy scene-copy">
          <h2 id="closing-title" data-reveal>Until then, this world is our first hello. <br/>Explore it, play around, and keep what you win.</h2>
          <div className="closing-signoff" data-reveal><p>The doors open soon.</p><p className="signature">So/Facet. <span>What’s yours?</span></p></div>
          <div className="actions" data-reveal>
            <a className="button button-outline" href="/index.html#experience" target="_top">Back to the world</a>
            <a className="button button-primary" href="/play.html" target="_top">Play the game <svg aria-hidden="true" fill="none" width="17" height="13" viewBox="0 0 24 16"><path d="M1 8h20M15 2l6 6-6 6" stroke="currentColor" strokeWidth="1.4"/></svg></a>
          </div>
        </div>
      </section>
    </main>
  </>;
}

createRoot(document.getElementById('about-root')).render(<App/>);
