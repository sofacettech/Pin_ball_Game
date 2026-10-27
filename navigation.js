const standalone = document.querySelector('[data-standalone-navigation]');
if (standalone) standalone.hidden = false;

const toggle = document.querySelector('[data-menu-toggle]');
const panel = document.querySelector('[data-menu-panel]');
// Preserve the game menu across its linked pages; normal website visits keep the site menu.
const accountFlow = ['/account.html', '/membership.html'].includes(location.pathname);
const gamePage = !!document.querySelector('#game-header');
const gameAccount = ['/account.html', '/membership.html', '/about.html', '/faq.html', '/privacy.html', '/launching-soon.html', '/first-cuts-confirmation.html'].includes(location.pathname) && new URLSearchParams(location.search).get('nav') === 'game';
if (gameAccount) {
  panel.setAttribute('aria-label', 'Game navigation');
  const items = [
    ['Leaderboard', '/play.html#leaderboard'], ['Pause', null], ['Restart game', null],
    ['Settings', '/play.html#settings'], ['Profile', '/play.html#profile'],
    ['My Account', '/account.html?nav=game'], ['About', '/about.html'],
    ['FAQs', '/faq.html'], ['Privacy Policies', '/privacy.html'], ['Back to game', '/play.html']
  ];
  panel.replaceChildren(...items.map(([label, href]) => {
    const item = document.createElement('a');item.className = 'menu-item';item.textContent = label;
    if (href) { item.href = href;item.target = '_top'; }
    else { item.setAttribute('role', 'link');item.setAttribute('aria-disabled', 'true');item.style.opacity = '.45';item.title = 'Available during an active game'; }
    if (label === 'My Account') item.setAttribute('data-account-link', '');
    if (label === 'Leaderboard') { item.hidden = true;window.addEventListener('sofacet:account-player', event => { item.hidden = event.detail?.member !== true; }); }
    return item;
  }));
}
if (gamePage) {
  const back = document.createElement('a');back.className = 'menu-item';back.href = '/play.html';back.target = '_top';back.textContent = 'Back to game';back.setAttribute('data-game-return', '');panel.append(back);
  back.addEventListener('click', event => { event.preventDefault();setOpen(false);window.dispatchEvent(new Event('sofacet:back-to-game')); });
}
if (gamePage || gameAccount) panel.querySelectorAll('a[href]').forEach(item => {
  const url = new URL(item.href, location.href);
  if (url.origin === location.origin && ['/account.html', '/about.html', '/faq.html', '/privacy.html'].includes(url.pathname)) { url.searchParams.set('nav', 'game');item.href = url.pathname + url.search + url.hash; }
});
if (gameAccount && !accountFlow) fetch('/api/player').then(response => response.ok ? response.json() : null).then(player => window.dispatchEvent(new CustomEvent('sofacet:account-player', {detail:player}))).catch(() => {});
let accountLink = panel.querySelector('[data-account-link]');
if (!accountLink) {
  accountLink = document.createElement('a');
  accountLink.className = 'menu-item';
  accountLink.href = './account.html';
  accountLink.target = '_top';
  accountLink.setAttribute('data-account-link', '');
  panel.prepend(accountLink);
}
accountLink.textContent = 'My Account';
if (gamePage || gameAccount) accountLink.href = '/account.html?nav=game';
const currentPath = location.pathname === '/' ? '/index.html' : location.pathname;
panel.querySelectorAll('a[href]').forEach(item => {
  if (item.hasAttribute('data-game-return')) return;
  const target = new URL(item.href, location.href);
  const targetPath = target.pathname === '/' ? '/index.html' : target.pathname;
  if (target.origin !== location.origin || targetPath !== currentPath) return;
  item.setAttribute('aria-current', 'page');
  item.setAttribute('aria-disabled', 'true');
  item.setAttribute('role', 'link');
  item.removeAttribute('href');
  item.removeAttribute('target');
});
const backdrop = document.createElement('div');
backdrop.className = 'menu-backdrop';
backdrop.setAttribute('aria-hidden', 'true');
panel.before(backdrop);
panel.querySelectorAll('.menu-item').forEach((item, index) => item.style.setProperty('--menu-order', index));

function setOpen(open, restoreFocus = false) {
  if (!open && (restoreFocus || panel.contains(document.activeElement))) toggle.focus({ preventScroll: true });
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
  panel.inert = !open;
  panel.setAttribute('aria-hidden', String(!open));
  panel.toggleAttribute('data-open', open);
  document.body.toggleAttribute('data-menu-open', open);
}

toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
backdrop.addEventListener('click', () => setOpen(false, true));
panel.addEventListener('click', event => {
  if (event.target.closest('a[href],[data-menu-close]')) setOpen(false);
});
document.addEventListener('pointerdown', event => {
  if (toggle.getAttribute('aria-expanded') === 'true' && event.target !== backdrop && !panel.contains(event.target) && !toggle.contains(event.target)) setOpen(false);
});
document.addEventListener('keydown', event => {
  if (toggle.getAttribute('aria-expanded') !== 'true') return;
  if (event.key === 'Escape' && !panel.querySelector('[aria-expanded="true"]')) {
    event.preventDefault(); event.stopImmediatePropagation(); setOpen(false, true);
  }
  if (event.key === 'Tab') {
    const stops = [toggle, ...panel.querySelectorAll('a[href],button:not(:disabled)')].filter(item => item.getClientRects().length && !item.closest('[hidden],[inert]'));
    const first = stops[0], last = stops.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
}, true);
