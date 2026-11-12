// The server supplies this public URL in the HTML, before any artwork renders.
// Empty or invalid configuration keeps the bundled images available offline.
export function normaliseArtworkCDNBase(value = '') {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return '';
    return url.href.replace(/\/$/, '');
  } catch { return ''; }
}

export function artworkAssetURL(path, base = globalThis.document?.querySelector('meta[name="sofacet-artwork-cdn"]')?.content || '') {
  const cdn = normaliseArtworkCDNBase(base);
  return cdn && /^\/assets\/collective\/[a-f0-9]{20}\.(?:png|webp)$/.test(path)
    ? `${cdn}/artwork${path.slice('/assets'.length)}` : path;
}

// Hidden desktop/mobile compositions must not hold up the visible artwork.
export function activeArtworkImages(root, selector = 'img') {
  return [...root.querySelectorAll(selector)].filter(image => {
    const scene = image.closest('.motion-scene');
    return !scene || scene.offsetWidth > 0;
  });
}

export async function decodeArtworkImages(root, selector = 'img') {
  await Promise.all(activeArtworkImages(root, selector).map(async image => {
    image.loading = 'eager';
    try { await image.decode(); }
    catch (error) {
      // A failed CDN image switches synchronously to its local fallback.
      if (!image.dataset.artworkFallback) throw error;
      await image.decode();
    }
  }));
}
