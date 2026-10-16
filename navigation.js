const menu = document.querySelector('#site-menu');

document.addEventListener('pointerdown', event => {
  if (menu.open && !menu.contains(event.target)) menu.open = false;
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menu.open) {
    menu.open = false;
    menu.querySelector('summary').focus();
  }
});
menu.addEventListener('focusout', event => {
  if (!menu.contains(event.relatedTarget)) menu.open = false;
});
