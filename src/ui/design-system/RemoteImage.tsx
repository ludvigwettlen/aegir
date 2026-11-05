import { useState } from 'react';
import { remoteImageLabel, remoteImageSource } from '../../../shared/remote-images';

export function RemoteImage({ src = '', alt = '', title }: { src?: string; alt?: string; title?: string }) {
  const source = remoteImageSource(src);
  return <ImageWithConsent key={source} source={source} alt={alt} title={title} />;
}

function ImageWithConsent({ source, alt, title }: { source: string | null; alt: string; title?: string }) {
  const [allowed, setAllowed] = useState(false);
  if (!source) return <span>{alt || 'Image unavailable'}</span>;
  if (!allowed) return <span className="ws-remote-image">
    <span>{remoteImageLabel(source)}{alt ? `: ${alt}` : ''}. </span>
    <button type="button" onClick={() => setAllowed(true)}>Load remote image</button>
  </span>;
  return <img src={source} alt={alt} title={title} referrerPolicy="no-referrer" />;
}
