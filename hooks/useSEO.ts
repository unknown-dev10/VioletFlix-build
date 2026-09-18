// hooks/useSEO.ts
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { BASE_URL } from '@/constants/config';

interface SEOProps {
  title?: string;
  description?: string;
  image?: string;
  type?: 'website' | 'video.movie' | 'video.tv_show';
  rating?: number;
  year?: string;
  genres?: string;
  url?: string;
}

const APP_NAME = 'VioletFlix';
const DEFAULT_DESC = 'Stream Movies, Series, Anime & Live Sports in HD. No ads, just entertainment — powered by VioletFlix.';
const DEFAULT_IMAGE = (typeof window !== 'undefined' && window.location?.origin)
  ? `${window.location.origin}/assets/images/og-violetflix.png`
  : 'https://ui-avatars.com/api/?name=VioletFlix&background=7c3aed&color=fff&size=1200&bold=true&format=png&font-size=0.4';

function setMeta(property: string, content: string, isName = false) {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  const attr = isName ? 'name' : 'property';
  let el = document.querySelector(`meta[${attr}="${property}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, property);
    el.setAttribute('data-vftv', 'true');
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setTitle(t: string) {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  document.title = t;
}

function setJsonLd(data: object) {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  const existing = document.getElementById('vftv-jsonld');
  if (existing) existing.remove();
  
  const el = document.createElement('script');
  el.id = 'vftv-jsonld';
  el.setAttribute('type', 'application/ld+json');
  el.textContent = JSON.stringify(data);
  document.head.appendChild(el);
}

function setCanonical(url: string) {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  let el = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement('link') as HTMLLinkElement;
    el.rel = 'canonical';
    el.setAttribute('data-vftv', 'true');
    document.head.appendChild(el);
  }
  el.href = url;
}

export function useSEO({ title, description, image, type = 'website', rating, year, genres, url }: SEOProps) {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;

    const fullTitle = title ? `${title} — ${APP_NAME}` : APP_NAME;
    const desc = description || DEFAULT_DESC;
    const img = image || DEFAULT_IMAGE;
    const pageUrl = url || (typeof window !== 'undefined' ? window.location.href : BASE_URL);
    const oldTitle = document.title;

    setTitle(fullTitle);
    setCanonical(pageUrl);

    setMeta('og:title', fullTitle);
    setMeta('og:description', desc);
    setMeta('og:image', img);
    setMeta('og:url', pageUrl);
    setMeta('og:type', type);
    setMeta('og:site_name', APP_NAME);

    setMeta('twitter:card', 'summary_large_image', true);
    setMeta('twitter:title', fullTitle, true);
    setMeta('twitter:description', desc, true);
    setMeta('twitter:image', img, true);
    setMeta('twitter:site', '@VioletFlix', true);

    setMeta('description', desc, true);
    setMeta('theme-color', '#7c3aed', true);
    setMeta('keywords', 'streaming, movies, series, anime, live sports, VioletFlix', true);
    setMeta('robots', 'index, follow', true);

    if (type === 'video.movie' && title) {
      setJsonLd({
        '@context': 'https://schema.org',
        '@type': 'Movie',
        name: title,
        description: desc,
        image: img,
        datePublished: year,
        genre: genres,
        aggregateRating: rating ? { '@type': 'AggregateRating', ratingValue: rating.toFixed(1), bestRating: '10', ratingCount: '1000' } : undefined,
        url: pageUrl,
        publisher: { '@type': 'Organization', name: APP_NAME, url: BASE_URL },
      });
    } else if (type === 'video.tv_show' && title) {
      setJsonLd({
        '@context': 'https://schema.org',
        '@type': 'TVSeries',
        name: title,
        description: desc,
        image: img,
        genre: genres,
        url: pageUrl,
        publisher: { '@type': 'Organization', name: APP_NAME, url: BASE_URL },
      });
    } else {
      setJsonLd({
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: APP_NAME,
        url: BASE_URL,
        description: DEFAULT_DESC,
        publisher: { '@type': 'Organization', name: 'VIOLET KING DEV' },
      });
    }

    return () => {
      document.title = oldTitle;
      document.querySelectorAll('meta[data-vftv="true"]').forEach(el => el.remove());
      document.getElementById('vftv-jsonld')?.remove();
      document.querySelector('link[data-vftv="true"]')?.remove();
    };
  }, [title, description, image, type, rating, year, genres, url]);
}
