import React, { useState } from 'react';
import { Play, ExternalLink, Globe, Youtube, Image as ImageIcon } from 'lucide-react';

interface RichLinkCardProps {
  url: string;
  title?: string;
  isCompact?: boolean;
}

export function extractYouTubeId(url: string): string | null {
  try {
    const regExp = /(?:youtube\.com\/(?:watch\?.*v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i;
    const match = url.match(regExp);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export function isImageUrl(url: string): boolean {
  try {
    return /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(url);
  } catch {
    return false;
  }
}

export function getDomain(url: string): string {
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    return parsed.hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

export const RichLinkCard: React.FC<RichLinkCardProps> = ({ url, title, isCompact = false }) => {
  const [imgError, setImgError] = useState(false);
  const ytId = extractYouTubeId(url);
  const isImg = isImageUrl(url);
  const domain = getDomain(url);

  // Clean title: If user title is absent or equal to URL, generate a readable name
  const displayTitle =
    title && title.trim() && !title.startsWith('http')
      ? title.trim()
      : ytId
      ? 'Watch YouTube Video'
      : domain
      ? `${domain.charAt(0).toUpperCase() + domain.slice(1)}`
      : 'Open Link';

  // 1. YouTube Video Preview Card
  if (ytId) {
    if (isCompact) {
      return (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="group inline-flex items-center space-x-2 my-1 px-2.5 py-1 rounded-lg bg-red-950/40 hover:bg-red-900/50 border border-red-500/40 transition-all text-neutral-100 hover:text-white"
        >
          <Youtube className="w-3.5 h-3.5 text-red-400 shrink-0" />
          <span className="text-xs font-medium text-red-200 group-hover:text-white line-clamp-1">
            {displayTitle}
          </span>
          <ExternalLink className="w-3 h-3 text-red-400 shrink-0" />
        </a>
      );
    }

    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="group block my-3 overflow-hidden rounded-2xl border border-red-500/30 bg-neutral-900/90 shadow-xl transition-all duration-300 hover:border-red-500/60 hover:shadow-red-500/10 hover:shadow-2xl"
      >
        {/* Video Thumbnail with Play Button */}
        <div className="relative aspect-video w-full overflow-hidden bg-neutral-950">
          <img
            src={`https://img.youtube.com/vi/${ytId}/hqdefault.jpg`}
            alt={displayTitle}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-600/95 text-white shadow-lg shadow-black/50 transition-transform duration-300 group-hover:scale-115">
              <Play className="h-5 w-5 fill-white ml-0.5" />
            </div>
          </div>
          <div className="absolute bottom-2.5 left-2.5 flex items-center space-x-1.5 rounded-md bg-black/80 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur-sm border border-white/10">
            <Youtube className="h-3.5 w-3.5 text-red-500" />
            <span>YouTube Video</span>
          </div>
        </div>

        {/* Video Information & CTA */}
        <div className="p-3.5 flex items-start justify-between gap-3 bg-neutral-900/90">
          <div className="min-w-0">
            <div className="font-semibold text-sm text-neutral-100 group-hover:text-red-300 transition-colors line-clamp-2">
              {displayTitle}
            </div>
            <div className="flex items-center space-x-2 mt-1">
              <span className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide">
                youtube.com
              </span>
              <span className="text-neutral-600">•</span>
              <span className="text-[11px] text-red-400 font-medium">Click to watch</span>
            </div>
          </div>
          <div className="h-7 w-7 rounded-lg bg-neutral-800 flex items-center justify-center shrink-0 border border-neutral-700 group-hover:bg-red-600/20 group-hover:border-red-500/40 transition-colors">
            <ExternalLink className="h-3.5 w-3.5 text-neutral-400 group-hover:text-red-300 transition-colors" />
          </div>
        </div>
      </a>
    );
  }

  // 2. Direct Image Preview Card
  if (isImg) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="group block my-3 overflow-hidden rounded-2xl border border-cyan-500/30 bg-neutral-900 shadow-lg hover:border-cyan-500/60 transition-all"
      >
        <div className="relative max-h-60 overflow-hidden bg-neutral-950 flex items-center justify-center p-1">
          <img
            src={url}
            alt={displayTitle}
            className="max-h-60 w-auto object-contain rounded-lg transition-transform duration-300 group-hover:scale-102"
            loading="lazy"
          />
        </div>
        <div className="p-3 flex items-center justify-between gap-2 bg-neutral-900/90">
          <div className="flex items-center space-x-2 min-w-0">
            <ImageIcon className="h-4 w-4 text-cyan-400 shrink-0" />
            <span className="text-xs font-semibold text-neutral-200 truncate group-hover:text-cyan-300 transition-colors">
              {displayTitle}
            </span>
          </div>
          <div className="flex items-center space-x-1 text-[11px] text-cyan-400 font-medium">
            <span>View Image</span>
            <ExternalLink className="h-3 w-3" />
          </div>
        </div>
      </a>
    );
  }

  // 3. Website / Portal / Link Card
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-center gap-3.5 my-2.5 p-3 rounded-2xl border border-neutral-700/60 bg-gradient-to-r from-neutral-900 via-neutral-900/95 to-neutral-850 hover:from-neutral-850 hover:to-neutral-800 hover:border-cyan-500/50 shadow-md transition-all duration-200 text-left"
    >
      {/* Favicon / Logo Box */}
      <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-neutral-800 border border-neutral-700 p-2 overflow-hidden shadow-inner group-hover:scale-105 group-hover:border-cyan-500/40 transition-transform">
        {!imgError ? (
          <img
            src={`https://www.google.com/s2/favicons?domain=${domain || 'google.com'}&sz=64`}
            alt={domain}
            className="h-6 w-6 object-contain"
            onError={() => setImgError(true)}
          />
        ) : (
          <Globe className="h-5 w-5 text-cyan-400" />
        )}
      </div>

      {/* Title & Domain info */}
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-[13.5px] sm:text-sm text-neutral-100 group-hover:text-cyan-300 transition-colors truncate">
          {displayTitle}
        </div>
        <div className="flex items-center space-x-1.5 mt-0.5">
          <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
            {domain || 'Website'}
          </span>
          <span className="text-neutral-600">•</span>
          <span className="text-[11px] text-cyan-400/90 font-medium group-hover:text-cyan-300 transition-colors">
            Click to open
          </span>
        </div>
      </div>

      {/* External Action Button */}
      <div className="h-7 w-7 rounded-lg bg-neutral-800 flex items-center justify-center shrink-0 border border-neutral-700 group-hover:bg-cyan-500/20 group-hover:border-cyan-500/40 transition-colors">
        <ExternalLink className="h-3.5 w-3.5 text-neutral-400 group-hover:text-cyan-300 transition-colors" />
      </div>
    </a>
  );
};
