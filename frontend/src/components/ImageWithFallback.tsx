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
      <div className={`flex items-center justify-center bg-gradient-to-br from-dark-800 to-dark-900 ${className}`}>
        <div className="text-center p-4">
          <div className="w-12 h-12 mx-auto rounded-xl bg-dark-750 flex items-center justify-center mb-2">
            <svg className="w-6 h-6 text-dark-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <span className="text-2xs text-dark-500 font-medium">No image</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden bg-dark-850 ${className}`}>
      {loading && <div className="absolute inset-0 skeleton" />}
      <img
        src={resolved}
        alt={alt}
        className={`w-full h-full object-cover transition-all duration-500 ${loading ? 'opacity-0 scale-105' : 'opacity-100 scale-100'} group-hover:scale-105`}
        onLoad={() => setLoading(false)}
        onError={() => { setError(true); setLoading(false); }}
      />
    </div>
  );
}
