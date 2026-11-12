(() => {
  const root = document.documentElement;
  let pending;
  let expires;

  function syncFooter() {
    root.toggleAttribute('data-hide-join-footer', location.pathname === '/join');
  }

  syncFooter();
  window.addEventListener('popstate', syncFooter);
  window.addEventListener('sofacet:registration-route', syncFooter);

  async function updateJoinVisibility() {
    pending?.abort();
    clearTimeout(expires);
    const controller = new AbortController();
    pending = controller;
    try {
      const response = await fetch('/api/account/session', {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw Error('Session check failed');
      const session = await response.json();
      if (controller.signal.aborted) return;
      root.toggleAttribute('data-signed-out', session.signedIn === false);
      root.toggleAttribute('data-signed-in', session.signedIn === true);
      if (session.signedIn && Number.isFinite(session.expiresIn)) {
        expires = setTimeout(updateJoinVisibility, session.expiresIn);
      }
    } catch {
      if (!controller.signal.aborted) {
        root.removeAttribute('data-signed-out');
        root.removeAttribute('data-signed-in');
      }
    }
  }

  updateJoinVisibility();
  window.addEventListener('pageshow', event => {
    if (event.persisted) updateJoinVisibility();
  });
  window.addEventListener('focus', updateJoinVisibility);
  window.addEventListener('sofacet:account-player', updateJoinVisibility);
  window.addEventListener('message', event => {
    if (event.origin === location.origin && ['contest-registration:complete', 'sofacet:screen-route'].includes(event.data?.type)) {
      updateJoinVisibility();
    }
  });
})();
