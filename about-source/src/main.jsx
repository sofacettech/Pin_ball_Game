import React,{useLayoutEffect,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {accountNavigationHref} from '../../shared/account-session.js';
import content from './content.json';
import {initializeAbout} from './motion.js';
import './style.css';

export function AboutPage(){
 const page=useRef(null);
 useLayoutEffect(()=>initializeAbout(page.current),[]);
 return <div className="about-explore" ref={page}>
<div className="about-mesh" aria-hidden="true"><canvas/></div>

<a className="skip-link" href="#main">Skip to content</a>

<div className="reading-progress" aria-hidden="true"><span></span></div>
<main id="main">
  <section className="intro scene" aria-labelledby="intro-title">
    <p className="intro-label" data-reveal>ABOUT <span className="wordmark inline-wordmark">SO/ FACET</span></p>
    <h1 id="intro-title" data-reveal style={{"--order": "1"}}><span>Diamonds,</span><span><span data-mesh-start>m</span>ade for who you are.</span></h1>
    <p className="intro-copy" data-reveal style={{"--order": "2"}}><span className="wordmark inline-wordmark">SO/ FACET</span> is a lab-grown diamond jewellery house from India. Real diamonds, grown.</p>
  </section>

  <figure className="opening-image" aria-label="SO/ FACET imagery">
    <div className="opening-pin"><div className="image-window"><img data-image="hero" data-caption="Diamonds, made for who you are." src="/assets/about/campaign/campaign-1.webp" width="1800" height="2234" alt="Campaign portrait with a diamond ring and reflective glove." style={{"objectPosition": "50% 44%"}} decoding="async"/></div></div>
  </figure>

  <section id="philosophy" className="philosophy scene" aria-labelledby="philosophy-title">
    <div className="text-block">
      <p className="section-label" data-reveal>Our philosophy</p>
      <h2 id="philosophy-title" data-reveal style={{"--order": "1"}}><span className="heading-line">For generations,</span> <span className="heading-line">diamonds came with rules.</span></h2>
      <p className="story-copy" data-reveal style={{"--order": "2"}}><span className="wordmark inline-wordmark">SO/ FACET</span> begins with who you are.<br/>Real diamonds, grown.<br/>Worn your way.</p>
    </div>
    <figure className="philosophy-image image-scene">
      <div className="image-window"><img data-image="philosophy" data-caption="A small detail. A personal signature." src="/assets/about/campaign/campaign-2.webp" width="1800" height="2234" alt="Detail of the campaign model’s diamond bracelet." style={{"objectPosition": "50% 70%"}} decoding="async"/></div>
    </figure>
  </section>

  <section id="collections" className="collections" aria-labelledby="collections-title">
    <div className="collection-intro scene text-block">
      <p className="section-label" data-reveal>Our collections</p>
      <h2 id="collections-title" data-reveal style={{"--order": "1"}}>Six collections<br/>are on their way.</h2>
      <p className="story-copy" data-reveal style={{"--order": "2"}}>We’d rather show you than tell you.</p>
    </div>
    <div className="gallery">
      <div className="gallery-pair scene">
        <figure className="gallery-figure image-scene"><button className="image-button" data-gallery-index="0" aria-label="Enlarge collection image 1"><span className="image-window"><img data-image="collection1" data-caption="Diamonds, made for who you are." src="/assets/about/campaign/campaign-1.webp" width="1800" height="2234" alt="Campaign portrait with a diamond ring and reflective glove." style={{"objectPosition": "50% 50%"}} decoding="async"/></span><span className="image-caption">Diamonds, made for who you are.</span></button></figure>
        <figure className="gallery-figure image-scene"><button className="image-button" data-gallery-index="1" aria-label="Enlarge collection image 2"><span className="image-window"><img data-image="collection2" data-caption={content.images.collection2.caption} src="/assets/about/campaign/campaign-3.webp" width="1800" height="2234" alt="Campaign portrait with a star-shaped ring and reflective cuff." style={{"objectPosition": "50% 50%"}} decoding="async"/></span><span className="image-caption">{content.images.collection2.caption}</span></button></figure>
      </div>
      <div className="gallery-pair scene">
        <figure className="gallery-figure image-scene"><button className="image-button" data-gallery-index="2" aria-label="Enlarge collection image 3"><span className="image-window"><img data-image="collection3" data-caption="A small detail. A personal signature." src="/assets/about/campaign/campaign-2.webp" width="1800" height="2234" alt="Campaign portrait with a diamond bracelet." style={{"objectPosition": "50% 50%"}} decoding="async"/></span><span className="image-caption">A small detail. A personal signature.</span></button></figure>
        <figure className="gallery-figure image-scene"><button className="image-button" data-gallery-index="3" aria-label="Enlarge collection image 4"><span className="image-window"><img data-image="collection4" data-caption="Bloom in your own way." src="/assets/about/campaign/campaign-4.webp" width="1800" height="2234" alt="Campaign portrait with flower-shaped diamond earrings." style={{"objectPosition": "50% 50%"}} decoding="async"/></span><span className="image-caption">Bloom in your own way.</span></button></figure>
      </div>
      <div className="gallery-pair scene">
        <figure className="gallery-figure image-scene"><button className="image-button" data-gallery-index="4" aria-label="Enlarge collection image 5"><span className="image-window"><img data-image="collection5" data-caption="Real diamonds, grown." src="/assets/about/campaign/campaign-5.webp" width="1800" height="2234" alt="Campaign portrait with a rectangular diamond pendant necklace." style={{"objectPosition": "50% 50%"}} decoding="async"/></span><span className="image-caption">Real diamonds, grown.</span></button></figure>
        <figure className="gallery-figure image-scene"><button className="image-button" data-gallery-index="5" aria-label="Enlarge collection image 6"><span className="image-window"><img data-image="collection6" data-caption="So/ what’s yours?" src="/assets/about/campaign/sofacet-campaign-6.jpg" width="1856" height="2304" alt="Campaign portrait with a circular diamond pendant necklace." style={{"objectPosition": "50% 50%"}} decoding="async"/></span><span className="image-caption">So/ what’s yours?</span></button></figure>
      </div>
    </div>
  </section>

  <section className="closing scene" aria-labelledby="closing-title">
    <p className="closing-intro" data-reveal><span>Until then, this world is our first hello.</span><span>Explore it, play a round, and keep what you score.</span></p>
    <p className="launch-date" data-reveal><span>The doors open</span> <span>soon.</span></p>
    <h2 id="closing-title" data-reveal style={{"--order": "1"}}>
      <span className="closing-logo">
        <img className="closing-mark" src="/assets/sofacet-icon.svg" width="700" height="574" alt=""/>
        <img src="/assets/sofacet-wordmark.svg" width="2048" height="278" alt="SO/ FACET"/>
      </span>
      <span className="closing-question">What’s yours?</span>
    </h2>
    <div className="closing-actions" data-reveal style={{"--order": "2"}}>
      <button className="action-button" data-destination="world">Back to the world</button>
      <button className="action-button action-primary" data-destination="game">Play the game <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></button>
      <a className="action-button" href={accountNavigationHref('/join')} data-join-for-guests>JOIN THE SO/ COLLECTIVE <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></a>
    </div>
    <a className="text-link" href="#top" data-reveal style={{"--order": "3"}}>Back to the top <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6"/></svg></a>
  </section>
</main>
<dialog className="gallery-dialog" aria-labelledby="gallery-title">
  <div className="gallery-toolbar"><h2 id="gallery-title">Our collections</h2><button className="icon-button" data-close-gallery aria-label="Close pictures"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>
  <figure className="lightbox-figure"><img className="lightbox-image" alt=""/><figcaption aria-live="polite"></figcaption></figure>
  <div className="gallery-controls"><button className="icon-button" data-previous aria-label="Previous picture"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m6-6-6 6 6 6"/></svg></button><p className="image-count sr-only" aria-live="polite"></p><button className="icon-button" data-next aria-label="Next picture"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></button></div>
</dialog>
<dialog className="coming-soon" id="coming-soon" aria-labelledby="soon-title" aria-describedby="soon-copy">
  <button className="icon-button soon-close" data-close-soon aria-label="Close coming-soon message"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
  <h2 id="soon-title">The doors<br/>open soon.</h2>
  <p id="soon-copy">Until then, this world is our first hello.</p>
  <button className="action-button action-primary" data-close-soon>Back to About Us</button>
</dialog>

 </div>;
}
createRoot(document.getElementById('about-root')).render(<AboutPage/>);
