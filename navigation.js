const standalone = document.querySelector('[data-standalone-navigation]');
if (standalone) standalone.hidden = false;

const toggle = document.querySelector('[data-menu-toggle]');
const panel = document.querySelector('[data-menu-panel]');
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
const currentPath = location.pathname === '/' ? '/index.html' : location.pathname;
panel.querySelectorAll('a[href]').forEach(item => {
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
