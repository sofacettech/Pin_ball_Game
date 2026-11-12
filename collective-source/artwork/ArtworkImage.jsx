import React, {useState} from 'react';
import {artworkAssetURL} from '../../shared/artwork-assets.js';

export function ArtworkImage({src, onError, ...props}) {
  const [failed, setFailed] = useState(null);
  const resolved = failed?.original === src ? failed.local : artworkAssetURL(src);
  return <img decoding="async" loading="eager" {...props} crossOrigin="anonymous" src={resolved} onError={event => {
    const local = event.currentTarget.dataset.artworkLocalSrc || src;
    if (!event.currentTarget.dataset.artworkFallback && event.currentTarget.getAttribute('src') !== local) {
      setFailed({original:src, local});
      event.currentTarget.dataset.artworkFallback = 'true';
      event.currentTarget.src = local;
    } else onError?.(event);
  }}/>;
}
