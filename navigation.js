const standalone = document.querySelector('[data-standalone-navigation]');
if (standalone) standalone.hidden = false;

const toggle = document.querySelector('[data-menu-toggle]');
const panel = document.querySelector('[data-menu-panel]');
const gamePage = !!document.querySelector('#game-header');
const gameAccount = new URLSearchParams(location.search).get('nav') === 'game';
const inGame = gamePage || gameAccount;
const contextual = href => {
  if (!inGame || !href.startsWith('/')) return href;
  const url = new URL(href, location.href);url.searchParams.set('nav', 'game');
  return url.pathname + url.search + url.hash;
};
if (inGame) document.querySelectorAll('a[href]').forEach(link => {
  const url = new URL(link.href, location.href);
  if (url.origin === location.origin && ['/account.html','/membership.html','/about.html','/faq.html','/launching-soon.html','/first-cuts-confirmation.html'].includes(url.pathname)) link.href = contextual(url.pathname + url.search + url.hash);
});
// Keep the game's existing controls and panels connected when replacing its menu.
if (gamePage) {
  const settings = document.getElementById('settings');
  settings.className = '';settings.querySelector('span').className = 'sr-only';
  document.getElementById('gameplay-controls').append(settings);
  document.body.append(document.getElementById('game-menu'));
  const inactive = document.createElement('div');inactive.hidden = true;
  inactive.append(document.getElementById('navbar-extras'), document.getElementById('profile-navigation'));
  document.body.append(inactive);
}
function menuLink(label, href, className = 'menu-item') {
  const link = document.createElement('a');link.className = className;link.textContent = label;
  if (href) { link.href = contextual(href);link.target = '_top'; }
  else { link.setAttribute('role', 'link');link.setAttribute('aria-disabled', 'true'); }
  return link;
}
const play = gamePage ? document.createElement('button') : menuLink(inGame ? 'Back to game' : 'Play Pinball', '/play.html');
if (gamePage) {play.type = 'button';play.className = 'menu-item';play.textContent = 'Back to game';play.setAttribute('data-menu-close', '');}
const accountLink = menuLink('My points', '/account.html');accountLink.setAttribute('data-account-link', '');
const about = menuLink('About ', '/about.html');
const wordmark = document.createElement('span');wordmark.className = 'brand-word';wordmark.textContent = 'SO/ FACET';about.append(wordmark);
const join = menuLink('Join THE FIRST CUT', '/membership.html?from=first-cuts', 'menu-item menu-join');
const small = document.createElement('div');small.className = 'menu-small-links';
// Policy pages remain unavailable until their approved text is supplied.
small.append(menuLink('Terms', null, ''), menuLink('Privacy', null, ''), menuLink('Contact', 'mailto:hello@sofacet.com', ''));
const socials = document.createElement('div');socials.className = 'menu-social-links';socials.setAttribute('role', 'group');socials.setAttribute('aria-label', 'Social media');
for (const [label, icon, href] of [
  ['Instagram', '<rect x="2" y="2" width="20" height="20" rx="6"/><rect x="4.5" y="4.5" width="15" height="15" rx="3.5" fill="#0b0e18"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="2.6" fill="#0b0e18"/><circle cx="17.5" cy="6.6" r="1.3"/>'],
  ['LinkedIn', '<rect x="2" y="2" width="20" height="20" rx="2"/><g fill="#0b0e18"><circle cx="7" cy="7" r="1.5"/><path d="M5.7 9.5h2.6V18H5.7zM10 9.5h2.5v1.2c.7-1 1.6-1.5 2.8-1.5 2.6 0 3.4 1.6 3.4 4.2V18H16v-4.1c0-1.4-.2-2.2-1.5-2.2-1.4 0-1.8.9-1.8 2.2V18H10z"/></g>', 'https://www.linkedin.com/company/so-facet/'],
  ['Facebook', '<path d="M14.2 22v-9.1h3.1l.5-3.6h-3.6V7c0-1 .3-1.7 1.8-1.7H18V2.1c-.4 0-1.6-.1-2.9-.1-2.9 0-4.9 1.8-4.9 5.1v2.2H7v3.6h3.2V22z"/>'],
  ['X', '<path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.634 7.584H.478l8.6-9.835L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/>', 'https://x.com/so_facet?s=11&t=MpVMDpjvxy77_g81vQ3U7w'],
  ['YouTube', '<rect x="1" y="4.5" width="22" height="15" rx="4.5"/><path d="m10 8.2 6 3.8-6 3.8Z" fill="#0b0e18"/>', 'https://youtube.com/@so_facet?si=_lCL7Q40ECeZ60g1'],
]) {
  const item = document.createElement(href ? 'a' : 'button');item.className = 'social-placeholder';item.setAttribute('aria-label', label);
  if (href) {item.href = href;item.target = '_blank';item.rel = 'noopener noreferrer';}
  else {item.type = 'button';item.disabled = true;}
  item.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + icon + '</svg>';socials.append(item);
}
small.append(socials);
panel.replaceChildren(play, accountLink, menuLink('How points work', '/faq.html'), about, join, small);
panel.setAttribute('aria-label', inGame ? 'Game navigation' : 'Main navigation');
const currentPath = location.pathname === '/' ? '/index.html' : location.pathname;
panel.querySelectorAll('a[href]').forEach(item => {
  const target = new URL(item.href, location.href);
  const targetPath = target.pathname === '/' ? '/index.html' : target.pathname;
  if (target.origin !== location.origin || targetPath !== currentPath) return;
  if (targetPath === '/membership.html' && target.searchParams.get('from') !== new URLSearchParams(location.search).get('from')) return;
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
