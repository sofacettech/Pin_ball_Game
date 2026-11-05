// The supplied canvas effects keep their original rendering code. React owns
// their lifetime, including browser listeners, observers, frames and timers.
export function createAnimationScope(root) {
  const cleanup = [];
  const frames = new Set();
  const timers = new Set();
  const globals = new Map();
  let disposed = false;
  function listen(target, type, listener, options) {
    if (disposed) return;
    target.addEventListener(type, listener, options);
    cleanup.push(() => target.removeEventListener(type, listener, options));
  }
  const requestFrame = callback => {
    if (disposed) return 0;
    const id = window.requestAnimationFrame(time => {frames.delete(id); if (!disposed) callback(time);});
    frames.add(id);
    return id;
  };
  const schedule = (callback, delay, ...args) => {
    if (disposed) return 0;
    const id = window.setTimeout(() => {timers.delete(id); if (!disposed) callback(...args);}, delay);
    timers.add(id);
    return id;
  };
  const media = query => {
    const target = window.matchMedia(query);
    return new Proxy(target, {get(object, key) {
      if (key === 'addEventListener') return (type, fn, options) => listen(object, type, fn, options);
      const value = Reflect.get(object, key, object);
      return typeof value === 'function' ? value.bind(object) : value;
    }});
  };
  const observer = BrowserObserver => class {
    constructor(callback, options) {
      const instance = new BrowserObserver((...args) => {if (!disposed) callback(...args);}, options);
      cleanup.push(() => instance.disconnect());
      return new Proxy(instance, {get(object, key) {
        if (key === 'observe') return (...args) => {if (!disposed) object.observe(...args);};
        const value = Reflect.get(object, key, object);
        return typeof value === 'function' ? value.bind(object) : value;
      }});
    }
  };
  const scopedDocument = new Proxy(document, {get(target, key) {
    if (key === 'documentElement' || key === 'body') return root;
    if (key === 'querySelector') return selector => root.querySelector(selector);
    if (key === 'querySelectorAll') return selector => root.querySelectorAll(selector);
    if (key === 'getElementById') return id => root.querySelector('#' + CSS.escape(id));
    if (key === 'addEventListener') return (type, fn, options) => listen(target, type, fn, options);
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  }});
  const scopedWindow = new Proxy(window, {
    get(target, key) {
      if (key === 'addEventListener') return (type, fn, options) => listen(target, type, fn, options);
      if (key === 'requestAnimationFrame') return requestFrame;
      if (key === 'setTimeout') return schedule;
      if (key === 'matchMedia') return media;
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, key, value) {
      if (disposed) return true;
      if (!globals.has(key)) globals.set(key, Object.getOwnPropertyDescriptor(target, key));
      return Reflect.set(target, key, value);
    }
  });
  return {
    document: scopedDocument, window: scopedWindow,
    requestAnimationFrame: requestFrame,
    cancelAnimationFrame: id => {frames.delete(id); window.cancelAnimationFrame(id);},
    setTimeout: schedule,
    clearTimeout: id => {timers.delete(id); window.clearTimeout(id);},
    addEventListener: (type, fn, options) => listen(window, type, fn, options),
    matchMedia: media,
    ResizeObserver: observer(ResizeObserver),
    IntersectionObserver: observer(IntersectionObserver),
    MutationObserver: observer(MutationObserver),
    dispose() {
      disposed = true;
      frames.forEach(id => window.cancelAnimationFrame(id));
      timers.forEach(id => window.clearTimeout(id));
      cleanup.reverse().forEach(fn => fn());
      for (const [key, descriptor] of globals) {
        if (descriptor) Object.defineProperty(window, key, descriptor);
        else delete window[key];
      }
      root.classList.remove('wave-intro-pending');
      delete root.dataset.textWaveStart;
    }
  };
}
