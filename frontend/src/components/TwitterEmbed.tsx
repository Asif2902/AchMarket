import { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    twttr?: {
      widgets: {
        createTweet: (tweetId: string, element: HTMLElement, options?: Record<string, unknown>) => Promise<HTMLElement>;
        load: (element?: HTMLElement) => void;
      };
    };
  }
}

interface TwitterEmbedProps {
  url: string;
}

export default function TwitterEmbed({ url }: TwitterEmbedProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const tweetId = extractTweetId(url);
    if (!tweetId) {
      setError(true);
      return;
    }

    const loadTwitterWidget = () => {
      if (window.twttr?.widgets) {
        setLoading(true);
        window.twttr.widgets.createTweet(tweetId, containerRef.current!, {
          theme: 'dark',
          align: 'center',
        }).then(() => {
          setLoading(false);
        }).catch(() => {
          setLoading(false);
          setError(true);
        });
      }
    };

    if (!window.twttr) {
      const script = document.createElement('script');
      script.src = 'https://platform.twitter.com/widgets.js';
      script.async = true;
      script.charset = 'utf-8';
      script.onload = loadTwitterWidget;
      document.head.appendChild(script);
    } else {
      loadTwitterWidget();
    }
  }, [url]);

  if (error) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-emerald-300/70 hover:text-emerald-300 transition-colors inline-flex items-center gap-1"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
        View on Twitter
      </a>
    );
  }

  return (
    <div>
      {loading && (
        <div className="flex items-center gap-2 text-xs text-dark-500 py-2">
          <div className="w-4 h-4 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
          Loading Tweet...
        </div>
      )}
      <div ref={containerRef} className={loading ? 'hidden' : ''} />
    </div>
  );
}

function extractTweetId(url: string): string | null {
  const patterns = [
    /twitter\.com\/\w+\/status\/(\d+)/i,
    /x\.com\/\w+\/status\/(\d+)/i,
    /twitter\.com\/\w+\/i\/status\/(\d+)/i,
    /x\.com\/\w+\/i\/status\/(\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  return null;
}
