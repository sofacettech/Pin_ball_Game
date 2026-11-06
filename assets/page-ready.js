(() => {
  const root = document.documentElement;
  root.dataset.loaded = 'false';
  function reveal() {
    root.dataset.loaded = 'true';
  }
  function ready() {
    requestAnimationFrame(() => {
      // Flush layout so fonts used by the mounted page have started loading.
      document.body?.getBoundingClientRect();
      Promise.resolve(document.fonts?.ready).catch(() => {}).then(() => requestAnimationFrame(reveal));
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, {once: true});
  else ready();
  addEventListener('pageshow', event => {if (event.persisted) reveal();});
})();
