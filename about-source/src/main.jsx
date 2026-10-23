import React, {useLayoutEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';

const collectionPictures = [
  {
    "src": "/assets/about/explore/sofacet-about-collection1.webp",
    "alt": "Flowing violet glass in a softly lit architectural interior.",
    "width": "175"
  },
  {
    "src": "/assets/about/explore/sofacet-about-collection2.webp",
    "alt": "A woman in a black gown framed by a golden arch.",
    "width": "170"
  },
  {
    "src": "/assets/about/explore/sofacet-about-collection3.webp",
    "alt": "Curved purple glass sculpture displayed on a pedestal.",
    "width": "168"
  },
  {
    "src": "/assets/about/explore/sofacet-about-collection4.webp",
    "alt": "Delicate pink and gold flowers growing through dark crystal.",
    "width": "169"
  },
  {
    "src": "/assets/about/explore/sofacet-about-collection5.webp",
    "alt": "A bonsai tree beneath a purple circular opening reflected in water.",
    "width": "168"
  },
  {
    "src": "/assets/about/explore/sofacet-about-collection6.webp",
    "alt": "Translucent lilac and yellow crystal forms among black rock.",
    "width": "174"
  }
];

function Wordmark() {
  return <span className="wordmark">SO<span className="wordmark-slash">/</span>FACET</span>;
}

function Picture(props) {
  const [failed, setFailed] = useState(false);
  return failed ? <span className="image-error" role="img" aria-label={props.alt}>Image unavailable</span> : <img {...props} onError={() => setFailed(true)}/>;
}

function App() {
  const content = useRef(null), dialog = useRef(null), opener = useRef(null);
  const [preview, setPreview] = useState(null);
  function showImage(index) {
    const images = collectionPictures;
    const active = (index + images.length) % images.length, image = images[active];
    setPreview({index: active, src: image.src, alt: image.alt});
  }
  function openGallery(index, trigger) {
    opener.current = trigger;
    showImage(index);
    dialog.current.showModal();
    dialog.current.querySelector('[data-close-gallery]').focus();
  }
  useLayoutEffect(() => {
    const root = content.current, page = document.documentElement;
    const scenes = [...root.querySelectorAll('.scene')], media = matchMedia('(prefers-reduced-motion: reduce)');
    const opening = root.querySelector('.opening-image'), pin = root.querySelector('.opening-pin'), frame = root.querySelector('.opening-image .image-window');
    const pairs = [...root.querySelectorAll('.gallery-pair')], progress = root.querySelector('.reading-progress span');
    const launch = root.querySelector('[data-open-gallery]'), collections = root.querySelector('#collections'), closing = root.querySelector('.closing');
    let observer, animation, arm, observe;
    const clamp = value => Math.min(1, Math.max(0, value));
    function updateReading() {
      animation = undefined;
      const available = page.scrollHeight - innerHeight;
      progress.style.transform = `scaleY(${available > 0 ? scrollY / available : 0})`;
      launch.hidden = collections.getBoundingClientRect().top > innerHeight * .8 || closing.getBoundingClientRect().top < innerHeight * .5;
      if (!root.classList.contains('scroll-motion')) return;
      const bounds = opening.getBoundingClientRect(), mobile = innerWidth <= 600;
      const top = document.querySelector('.about-header').offsetHeight;
      const position = clamp((top - bounds.top) / Math.max(1, bounds.height - pin.offsetHeight));
      const eased = position * position * (3 - 2 * position);
      frame.style.setProperty('--frame-scale', (1 - (mobile ? .16 : .32) * eased).toFixed(4));
      frame.style.setProperty('--frame-y', `${-(mobile ? 12 : 30) * eased}px`);
      opening.querySelector('img')?.style.setProperty('--photo-scale', (1.1 - .1 * eased).toFixed(4));
      for (const pair of pairs) {
        const box = pair.getBoundingClientRect();
        if (box.top > innerHeight + 150 || box.bottom < -150) continue;
        const fraction = clamp((innerHeight - box.top) / (innerHeight + box.height));
        [...pair.children].forEach((figure, index) => figure.style.setProperty('--drift', `${((.5 - fraction) * (index ? 110 : 55) * (mobile ? .5 : 1)).toFixed(2)}px`));
      }
    }
    function schedule() { if (animation === undefined) animation = requestAnimationFrame(updateReading); }
    function syncMotion() {
      observer?.disconnect(); cancelAnimationFrame(arm); cancelAnimationFrame(observe);
      root.classList.remove('motion-ready', 'motion-armed');
      root.classList.toggle('scroll-motion', !media.matches);
      if (!media.matches && 'IntersectionObserver' in window) {
        root.classList.add('motion-ready');
        observer = new IntersectionObserver(entries => {
          for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); }
        }, {threshold: .08, rootMargin: '0px 0px -3% 0px'});
        arm = requestAnimationFrame(() => {
          root.classList.add('motion-armed');
          observe = requestAnimationFrame(() => scenes.forEach(scene => observer.observe(scene)));
        });
      }
      updateReading();
    }
    function focused(event) { event.target.closest('.scene')?.classList.add('is-visible'); }
    addEventListener('scroll', schedule, {passive: true});
    addEventListener('resize', schedule);
    root.addEventListener('focusin', focused);
    media.addEventListener('change', syncMotion);
    syncMotion();
    return () => {
      observer?.disconnect(); [animation, arm, observe].forEach(cancelAnimationFrame);
      removeEventListener('scroll', schedule); removeEventListener('resize', schedule);
      root.removeEventListener('focusin', focused); media.removeEventListener('change', syncMotion);
    };
  }, []);
  return <div ref={content}>
    <a className="skip-link" href="#about-content">Skip to content</a>
    <div className="reading-progress" aria-hidden="true"><span/></div>
<main id="about-content" tabIndex={-1}>
  <section className="intro scene" aria-labelledby="intro-title">
    <p className="intro-label" data-reveal>About Us</p>
    <h1 id="intro-title" data-reveal style={{'--order':1}}><span>Diamonds,</span><span>made for who you are.</span></h1>
    <p className="intro-copy" data-reveal style={{'--order':2}}><Wordmark/> is a lab-grown diamond jewellery house from India. Real diamonds, grown instead of mined.</p>
  </section>

  <figure className="opening-image scene" aria-label="SO/FACET imagery">
    <div className="opening-pin"><div className="image-window"><Picture data-image="hero" src="/assets/about/explore/sofacet-about-hero.webp" width="1122" height="430" alt="A woman wearing jewellery in a purple-lit lounge." decoding="async"/></div></div>
  </figure>

  <section id="philosophy" className="philosophy scene" aria-labelledby="philosophy-title">
    <div className="text-block">
      <p className="section-label" data-reveal>Our philosophy</p>
      <h2 id="philosophy-title" data-reveal style={{'--order':1}}>For generations,<br/>diamonds came with rules.</h2>
      <p className="story-copy" data-reveal style={{'--order':2}}>Few shapes. Few occasions.<br/>Chosen by someone else.<br/>We’re building something different.</p>
    </div>
    <figure className="philosophy-image">
      <div className="image-window"><Picture data-image="philosophy" loading="lazy" src="/assets/about/explore/sofacet-about-philosophy.webp" width="1122" height="286" alt="A hand wearing a bracelet and rings rests on glossy purple crystal." decoding="async"/></div>
    </figure>
  </section>

  <section id="collections" className="collections" aria-labelledby="collections-title">
    <div className="collection-intro scene text-block">
      <p className="section-label" data-reveal>Our collections</p>
      <h2 id="collections-title" data-reveal style={{'--order':1}}>Six collections<br/>are on their way.</h2>
      <p className="story-copy" data-reveal style={{'--order':2}}>We’d rather show you than tell you.</p>
    </div>
    <div className="gallery">
      {[0, 2, 4].map(start => <div className="gallery-pair scene" key={start}>
        {collectionPictures.slice(start, start + 2).map((image, offset) => <figure className="gallery-figure" key={image.src}>
          <button className="image-button" aria-label={`Enlarge collection image ${start + offset + 1}`} onClick={event => openGallery(start + offset, event.currentTarget)}>
            <span className="image-window"><Picture {...image} data-image={`collection${start + offset + 1}`} height="278" loading="lazy" decoding="async"/></span><span className="image-caption"><Wordmark/></span>
          </button>
        </figure>)}
      </div>)}
    </div>
  </section>

  <section className="closing scene" aria-labelledby="closing-title">
    <p data-reveal>The doors open soon.</p>
    <h2 id="closing-title" data-reveal style={{'--order':1}}><Wordmark/><span className="closing-question">What’s yours?</span></h2>
    <div className="closing-actions" data-reveal style={{'--order':2}}>
      <a className="action-button" href="/index.html#experience" target="_top">Back to the world</a>
      <a className="action-button action-primary" href="/play.html" target="_top">Play the game <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></a>
    </div>
    <a className="text-link" href="#top" data-reveal style={{'--order':3}}>Back to the top <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6"/></svg></a>
  </section>
</main>
    <button className="gallery-launch" data-open-gallery hidden onClick={event => openGallery(0, event.currentTarget)}>All pictures <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><rect x="14" y="14" width="6" height="6"/></svg></button>
    <dialog ref={dialog} className="gallery-dialog" aria-labelledby="gallery-title" onClose={() => { setPreview(null); opener.current?.focus({preventScroll: true}); }} onKeyDown={event => {
      if (preview && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); showImage(preview.index + (event.key === 'ArrowLeft' ? -1 : 1)); }
    }}>
      <div className="gallery-toolbar"><h2 id="gallery-title">Our collections</h2><button className="icon-button" data-close-gallery aria-label="Close pictures" onClick={() => dialog.current.close()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>
      <figure className="lightbox-figure">{preview && <Picture key={preview.src} className="lightbox-image" src={preview.src} alt={preview.alt}/>}<figcaption aria-live="polite">{preview?.alt}</figcaption></figure>
      <div className="gallery-controls"><button className="icon-button" aria-label="Previous picture" onClick={() => showImage(preview.index - 1)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m6-6-6 6 6 6"/></svg></button><p className="image-count sr-only" aria-live="polite">{preview ? `${preview.index + 1} / 6` : ''}</p><button className="icon-button" aria-label="Next picture" onClick={() => showImage(preview.index + 1)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></button></div>
    </dialog>
  </div>;
}

createRoot(document.getElementById('about-root')).render(<App/>);
