import content from './content.json';
import {createAnimationScope} from '../../collective-source/animation-scope.js';
import {mountScoreMesh} from '../../game-source/src/score-mesh.js';
export function initializeAbout(contentRoot){
 const scope=createAnimationScope(contentRoot);
 const {document,window,matchMedia,IntersectionObserver,requestAnimationFrame,addEventListener}=scope;
const config = content;
  const root = document.documentElement;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const meshLayer = root.querySelector('.about-mesh');
  const mesh = mountScoreMesh(meshLayer,()=>{},{backgroundColor:'#050505',ambient:false});
  let meshActive=true,openingStarted=false;
  function startMesh(x,y,source){
    if(!meshActive||!mesh)return;
    const bounds=meshLayer.getBoundingClientRect();
    meshLayer.dataset.waveOrigin=`${x-bounds.left},${y-bounds.top}`;
    meshLayer.dataset.waveSource=source;
    meshLayer.dataset.waveCount=String(Number(meshLayer.dataset.waveCount||0)+1);
    mesh.start(x-bounds.left,y-bounds.top,source);
  }
  document.addEventListener('click',event=>{
    if(event.defaultPrevented||event.button!==0||document.body.hasAttribute('data-menu-open')||
      event.target.closest('a,button,input,select,textarea,dialog,[role="button"]'))return;
    openingStarted=true;
    startMesh(event.clientX,event.clientY,'input');
  });
  function startOpeningMesh(line){
    if(!meshActive||openingStarted||!mesh||reducedMotion.matches)return;
    const letter=line.querySelector('[data-mesh-start]')?.getBoundingClientRect();
    if(!letter)return;
    openingStarted=true;
    startMesh(letter.left,letter.top+letter.height/2,'opening');
  }
  const images = [...document.querySelectorAll('img[data-image]')];
  for (const img of images) {
    const replacement = config.images[img.dataset.image];
    if (replacement?.alt) img.alt = replacement.alt;
    if (replacement?.caption) img.dataset.caption = replacement.caption;
    if (replacement?.position) img.style.objectPosition = replacement.position;
    img.addEventListener('error', () => {
      const fallback = document.createElement('span');
      fallback.className = 'image-error';
      fallback.textContent = 'Image unavailable';
      img.parentElement.append(fallback);
      img.hidden = true;
    }, { once: true });
    if (replacement?.src) img.src = replacement.src;
  }
  if (config.motion) {
    root.style.setProperty('--image-delay', `${config.motion.imageDelay}ms`);
    root.style.setProperty('--image-duration', `${config.motion.imageDuration}ms`);
  }
  const motionTargets = [...document.querySelectorAll('.intro, .opening-image, .philosophy .text-block, .philosophy-image, .collection-intro, .gallery-figure, .closing>[data-reveal]')];
  const played = new WeakSet();
  const liveAnimations = new Set();
  const motionEase = 'cubic-bezier(.2,.75,.2,1)';
  function arrival(element, frames, delay = 0, duration = 850) {
    if (!element || reducedMotion.matches) return;
    const animation = element.animate(frames, {duration, delay, easing: motionEase, fill: 'backwards'});
    liveAnimations.add(animation);
    animation.finished.then(() => liveAnimations.delete(animation), () => liveAnimations.delete(animation));
    return animation;
  }
  function slide(element, delay = 0) {
    arrival(element, [{opacity: 0, transform: 'translateX(-42px)'}, {opacity: 1, transform: 'translateX(0)'}], delay);
  }
  function revealSection(section) {
    if (played.has(section)) return;
    played.add(section);
    section.classList.add('is-visible');
    if (reducedMotion.matches) return;
    if (section.matches('.intro')) {
      slide(section.querySelector('.intro-label'));
      section.querySelectorAll('h1>span').forEach((line, index) => {
        const animation=arrival(line,
        [{opacity: .1, clipPath: 'inset(0 100% 0 0)', transform: 'translateX(-42px)'}, {opacity: 1, clipPath: 'inset(0)', transform: 'translateX(0)'}], 120 + index * 120);
        if(index===1)animation?.finished.then(()=>startOpeningMesh(line),()=>{});
      });
      slide(section.querySelector('.intro-copy'), 420);
    } else if (section.matches('.opening-image')) {
      arrival(section.querySelector('.image-window'),
        [{opacity: .12, clipPath: 'inset(0 0 12% 0)', transform: 'translateY(24px)'},
         {opacity: 1, clipPath: 'inset(0)', transform: 'translateY(0)'}], 0, 1100);
    } else if (section.matches('.philosophy .text-block')) {
      slide(section.querySelector('.section-label'));
      section.querySelectorAll('.heading-line').forEach((line, index) => slide(line, 120 + index * 120));
      slide(section.querySelector('.story-copy'), 420);
    } else if (section.matches('.philosophy-image')) {
      arrival(section.querySelector('.image-window'),
        [{opacity: .4, clipPath: 'inset(0 48% 0 48%)'}, {opacity: 1, clipPath: 'inset(0)'}], 0, 1100);
    } else if (section.matches('.collection-intro')) {
      slide(section.querySelector('.section-label'));
      arrival(section.querySelector('h2'),
        [{opacity: .15, clipPath: 'inset(100% 0 0)', transform: 'translateY(20px)'}, {opacity: 1, clipPath: 'inset(0)', transform: 'translateY(0)'}], 120);
      slide(section.querySelector('.story-copy'), 320);
    } else if (section.matches('.gallery-figure')) {
      const second = section.matches(':nth-child(2)');
      const distance = innerWidth <= 600 ? 18 : 42;
      arrival(section.querySelector('.image-window'),
        [{opacity: .15, transform: `translateX(${second ? distance : -distance}px)`, clipPath: second ? 'inset(0 0 0 12%)' : 'inset(0 12% 0 0)'},
         {opacity: 1, transform: 'translateX(0)', clipPath: 'inset(0)'}], second ? 120 : 0, 1000);
      arrival(section.querySelector('.image-caption'),
        [{opacity: 0, transform: 'translateY(8px)'}, {opacity: 1, transform: 'translateY(0)'}], second ? 420 : 320, 650);
    } else if (section.matches('.closing-intro')) {
      slide(section);
    } else if (section.matches('.launch-date')) {
      section.querySelectorAll(':scope>span').forEach((line, index) => arrival(line,
        [{opacity: .15, clipPath: 'inset(100% 0 0)', transform: 'translateY(18px)'}, {opacity: 1, clipPath: 'inset(0)', transform: 'translateY(0)'}], 120 + index * 120));
    } else if (section.matches('.closing h2')) {
      arrival(section.querySelector('.wordmark'),
        [{opacity: .2, clipPath: 'inset(0 100% 0 0)'}, {opacity: 1, clipPath: 'inset(0)'}], 0, 850);
      slide(section.querySelector('.closing-question'), 220);
    } else if (section.matches('.closing-actions,.closing>.text-link')) {
      slide(section);
    }
  }
  if ('IntersectionObserver' in window) {
    const sectionObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        if (entry.target.matches('.opening-image') && entry.intersectionRatio < .22) continue;
        revealSection(entry.target);
        sectionObserver.unobserve(entry.target);
      }
    }, {threshold: [.08, .22], rootMargin: '0px 0px -4% 0px'});
    if (!reducedMotion.matches) root.classList.add('motion-ready');
    document.fonts.ready.then(() => motionTargets.forEach(section => sectionObserver.observe(section)));
    reducedMotion.addEventListener('change', event => {
      if (!event.matches) return;
      root.classList.remove('motion-ready');
      liveAnimations.forEach(animation => animation.finish());
      document.getAnimations().forEach(animation => animation.finish());
      motionTargets.forEach(section => section.classList.add('is-visible'));
    });
    document.addEventListener('focusin', event => {
      motionTargets.filter(section => section.contains(event.target)).forEach(revealSection);
    });
  }


  const progress = document.querySelector('.reading-progress span');
  const launch = document.querySelector('[data-open-gallery]');
  const collections = document.querySelector('#collections');
  const closing = document.querySelector('.closing');
  let scheduled = false;
  const updateReading = () => {
    const available = root.scrollHeight - innerHeight;
    progress.style.transform = `scaleY(${available > 0 ? scrollY / available : 0})`;
    launch.hidden = collections.getBoundingClientRect().top > innerHeight * 0.8 || closing.getBoundingClientRect().top < innerHeight * 0.5;
    scheduled = false;
  };
  addEventListener('scroll', () => {
    if (!scheduled) requestAnimationFrame(updateReading);
    scheduled = true;
  }, { passive: true });
  addEventListener('resize', updateReading);
  updateReading();
  document.fonts.ready.then(updateReading);

  const dialog = document.querySelector('.gallery-dialog');
  const preview = dialog.querySelector('img');
  const collectionImages = images.filter(img => img.dataset.image.startsWith('collection'));
  let active = 0;
  let opener;
  let imageChange = 0;
  const showImage = index => {
    const change = ++imageChange;
    const direction = index >= active ? 1 : -1;
    active = (index + collectionImages.length) % collectionImages.length;
    const original = collectionImages[active];
    const caption = dialog.querySelector('figcaption');
    preview.getAnimations().forEach(animation => animation.cancel());
    caption.getAnimations().forEach(animation => animation.cancel());
    preview.src = original.src;
    preview.alt = original.alt;
    caption.textContent = original.dataset.caption || '';
    dialog.querySelector('.image-count').textContent = `${active + 1} / ${collectionImages.length}`;
    preview.decode().catch(() => {}).then(() => {
      if (change !== imageChange || !dialog.open || reducedMotion.matches) return;
      preview.animate([{ opacity: .35, transform: `translateX(${direction * 12}px)` }, { opacity: 1, transform: 'translateX(0)' }],
        { duration: 450, easing: 'cubic-bezier(.16,1,.3,1)' });
      caption.animate([{ opacity: .2, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 360, delay: 90, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' });
    });
  };
  const openGallery = (index, trigger) => {
    opener = trigger;
    showImage(index);
    dialog.showModal();
    dialog.querySelector('[data-close-gallery]').focus();
  };
  launch.addEventListener('click', () => openGallery(0, launch));
  document.querySelectorAll('[data-gallery-index]').forEach(button => {
    button.addEventListener('click', () => openGallery(Number(button.dataset.galleryIndex), button));
  });
  dialog.querySelector('[data-close-gallery]').addEventListener('click', () => dialog.close());
  dialog.querySelector('[data-previous]').addEventListener('click', () => showImage(active - 1));
  dialog.querySelector('[data-next]').addEventListener('click', () => showImage(active + 1));
  dialog.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      showImage(active + (event.key === 'ArrowLeft' ? -1 : 1));
    }
  });
  dialog.addEventListener('close', () => opener?.focus({ preventScroll: true }));

  const soon = document.querySelector('.coming-soon');
  let soonOpener;
  document.querySelectorAll('[data-destination]').forEach(button => {
    button.addEventListener('click', () => {
      const destination = config.links?.[button.dataset.destination]?.trim();
      if (destination) {
        window.top.location.assign(destination);
        return;
      }
      soonOpener = button;
      soon.showModal();
      soon.querySelector('[data-close-soon]').focus();
    });
  });
  soon.querySelectorAll('[data-close-soon]').forEach(button => button.addEventListener('click', () => soon.close()));
  soon.addEventListener('click', event => {
    if (event.target !== soon) return;
    const box = soon.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) soon.close();
  });
  soon.addEventListener('close', () => soonOpener?.focus({ preventScroll: true }));
 return ()=>{meshActive=false;mesh?.dispose();contentRoot.getAnimations({subtree:true}).forEach(animation=>animation.cancel());scope.dispose();};
}
