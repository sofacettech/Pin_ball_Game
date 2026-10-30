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
for (const [label, icon] of [
  ['Instagram', '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".7"/>'],
  ['LinkedIn', '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 10v7m0-10v.01M11 17v-7m0 3a3 3 0 0 1 6 0v4"/>'],
  ['Facebook', '<path d="M14 21V11h4l.5-4H14V5.5c0-1.5.5-2 2-2h2V0h-3c-4 0-5 2.5-5 5.5V7H7v4h3v10" transform="translate(0 1) scale(.95)"/>'],
  ['X', '<path d="m4 3 12 18h4L8 3Zm0 18 7-8M20 3l-7 8"/>'],
  ['YouTube', '<rect x="2" y="5" width="20" height="14" rx="4"/><path d="m10 9 5 3-5 3Z"/>'],
]) {
  const button = document.createElement('button');button.type = 'button';button.disabled = true;button.className = 'social-placeholder';button.setAttribute('aria-label', label);
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + icon + '</svg>';socials.append(button);
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
