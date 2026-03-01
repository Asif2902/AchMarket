import { useState } from 'react';
import { resolveImageUri } from '../utils/format';

interface Props {
  src: string;
  alt: string;
  className?: string;
}

export default function ImageWithFallback({ src, alt, className = '' }: Props) {
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const resolved = resolveImageUri(src);

  if (!src || error) {
    return (
      <div className={`flex items-center justify-center bg-dark-800 ${className}`}>
        <div className="text-center p-4">
          <svg className="w-10 h-10 mx-auto text-dark-500 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span className="text-xs text-dark-500">No image</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {loading && <div className="absolute inset-0 skeleton" />}
      <img
        src={resolved}
        alt={alt}
        className={`w-full h-full object-cover transition-opacity duration-300 ${loading ? 'opacity-0' : 'opacity-100'}`}
        onLoad={() => setLoading(false)}
        onError={() => { setError(true); setLoading(false); }}
      />
    </div>
  );
}
