import React, {useCallback, useState, useSyncExternalStore} from 'react';
import {artworkAssetURL} from '../../shared/artwork-assets.js';
import {flowerImageAttributes, flowerSceneMedia} from './responsive-flowers.js';

const emptyArtwork = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
function useArtworkScene(query) {
  const subscribe = useCallback(notify => {
    if (!query || !globalThis.matchMedia) return () => {};
    const media = matchMedia(query);
    media.addEventListener('change', notify);
    return () => media.removeEventListener('change', notify);
  }, [query]);
  return useSyncExternalStore(subscribe, () => !query || !globalThis.matchMedia || matchMedia(query).matches, () => true);
}

export function ArtworkImage({src, onError, artworkScene, ...props}) {
  const active = useArtworkScene(flowerSceneMedia(src, artworkScene));
  const [failed, setFailed] = useState(null);
  const resolved = failed?.original === src ? failed.local : artworkAssetURL(src);
  const responsive = !active || failed?.original === src ? {} : flowerImageAttributes(src, props.style?.width);
  return <img decoding="async" loading="eager" {...props} {...responsive} crossOrigin="anonymous" src={active ? resolved : emptyArtwork} onError={event => {
    const local = event.currentTarget.dataset.artworkLocalSrc || src;
    if (!event.currentTarget.dataset.artworkFallback && (event.currentTarget.srcset || event.currentTarget.getAttribute('src') !== local)) {
      setFailed({original:src, local});
      event.currentTarget.dataset.artworkFallback = 'true';
      event.currentTarget.removeAttribute('srcset');
      event.currentTarget.removeAttribute('sizes');
      event.currentTarget.src = local;
    } else onError?.(event);
  }}/>;
}
