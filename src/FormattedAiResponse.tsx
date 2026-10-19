import React, { useState } from 'react';
import { RichLinkCard } from './RichLinkCard';
import { Download, Maximize2, X, Sparkles, Image as ImageIcon } from 'lucide-react';

interface FormattedTextProps {
  content?: string;
  text?: string;
}

interface ImageBlockData {
  src: string;
  alt: string;
  prompt?: string;
  model?: string;
}

// Clean up unnecessary citations, markdown debris, and normalize links
export function cleanAiSymbols(raw: string): string {
  if (!raw) return '';
  let cleaned = raw
    // Strip citation markers like [cite: 1], [cite: 1, 2], [cite: 1-3], [source: 1]
    .replace(/\[cite:\s*[\d,\s\-]+\]/gi, '')
    .replace(/\[source:\s*[\d,\s\-]+\]/gi, '')
    // Clean up empty citation brackets if any remain
    .replace(/\[cite:\s*\]/gi, '')
    .replace(/\[source:\s*\]/gi, '')
    // Join multiline split markdown links: [Title]\n(URL) -> [Title](URL)
    .replace(/\[([^\n\]]+)\]\s*\n+\s*\((https?:\/\/[^\s\)]+)\)/g, '\n[$1]($2)\n')
    // Clean stray trailing/double brackets (not markdown links)
    .replace(/\[\s*\]/g, '')
    // Fix messy multiple spaces (preserve newlines)
    .replace(/[ \t]{2,}/g, ' ');

  return cleaned;
}

// Colorful palette for key tags and headings
const HIGHLIGHT_COLORS = [
  { border: 'border-cyan-500/40', bg: 'bg-cyan-500/10', text: 'text-cyan-300', dot: 'bg-cyan-400' },
  { border: 'border-emerald-500/40', bg: 'bg-emerald-500/10', text: 'text-emerald-300', dot: 'bg-emerald-400' },
  { border: 'border-amber-500/40', bg: 'bg-amber-500/10', text: 'text-amber-300', dot: 'bg-amber-400' },
  { border: 'border-purple-500/40', bg: 'bg-purple-500/10', text: 'text-purple-300', dot: 'bg-purple-400' },
  { border: 'border-blue-500/40', bg: 'bg-blue-500/10', text: 'text-blue-300', dot: 'bg-blue-400' },
  { border: 'border-rose-500/40', bg: 'bg-rose-500/10', text: 'text-rose-300', dot: 'bg-rose-400' },
  { border: 'border-teal-500/40', bg: 'bg-teal-500/10', text: 'text-teal-300', dot: 'bg-teal-400' },
];

/**
 * Dedicated Full Screen Zoom & Download Modal for Generated Images
 */
const AiImageRenderer: React.FC<{ data: ImageBlockData }> = ({ data }) => {
  const [isZoomed, setIsZoomed] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    const link = document.createElement('a');
    link.href = data.src;
    link.download = `${(data.alt || 'generated_artwork').replace(/[^a-zA-Z0-9_-]/g, '_')}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <>
      <div className="my-3 rounded-2xl overflow-hidden border border-slate-700/80 bg-neutral-950 shadow-2xl group relative max-w-xl transition-all hover:border-cyan-500/60">
        {/* Glow backdrop */}
        <div className="absolute -inset-1 bg-gradient-to-r from-blue-600/20 to-purple-600/20 rounded-2xl blur-sm opacity-50 group-hover:opacity-100 transition duration-500 pointer-events-none" />

        <div className="relative overflow-hidden bg-neutral-950">
          <img
            src={data.src}
            alt={data.alt || 'AI Generated Image'}
            onLoad={() => setIsLoaded(true)}
            onClick={() => setIsZoomed(true)}
            className="w-full max-h-[500px] object-cover rounded-xl transition duration-300 cursor-zoom-in block group-hover:scale-[1.01]"
          />

          {/* Action Overlay Floating Buttons */}
          <div className="absolute bottom-2.5 right-2.5 flex items-center gap-2 opacity-95 group-hover:opacity-100 transition z-10">
            <button
              onClick={handleDownload}
              className="bg-neutral-900/90 hover:bg-blue-600 text-white text-xs px-3 py-1.5 rounded-xl border border-neutral-700 backdrop-blur-md flex items-center gap-1.5 shadow-xl font-medium transition active:scale-95"
            >
              <Download className="w-3.5 h-3.5 text-cyan-300" /> Save HD
            </button>
            <button
              onClick={() => setIsZoomed(true)}
              className="bg-neutral-900/90 hover:bg-neutral-800 text-white p-1.5 rounded-xl border border-neutral-700 backdrop-blur-md shadow-xl transition active:scale-95"
            >
              <Maximize2 className="w-3.5 h-3.5 text-neutral-300" />
            </button>
          </div>
        </div>

        {data.alt && (
          <div className="p-2.5 bg-neutral-900/90 border-t border-neutral-800/80 flex items-center justify-between text-xs text-neutral-300">
            <div className="flex items-center gap-1.5 truncate mr-2">
              <ImageIcon className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span className="truncate font-medium text-neutral-200">{data.alt}</span>
            </div>
            <span className="text-[11px] text-cyan-400 shrink-0 font-mono">FLUX.1 Ultra-HD</span>
          </div>
        )}
      </div>

      {/* Lightbox Zoom Modal */}
      {isZoomed && (
        <div
          className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex items-center justify-center p-4 transition-all"
          onClick={() => setIsZoomed(false)}
        >
          <div
            className="relative max-w-5xl w-full flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute -top-12 right-0 flex items-center gap-3">
              <button
                onClick={handleDownload}
                className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-lg active:scale-95 transition"
              >
                <Download className="w-3.5 h-3.5" /> Save HD
              </button>
              <button
                onClick={() => setIsZoomed(false)}
                className="bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white w-8 h-8 rounded-xl flex items-center justify-center text-sm border border-neutral-700 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="rounded-2xl overflow-hidden border border-neutral-700 shadow-2xl max-h-[85vh] flex items-center justify-center bg-neutral-950">
              <img
                src={data.src}
                alt={data.alt || 'Zoomed Artwork'}
                className="max-w-full max-h-[85vh] object-contain rounded-xl"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
};

/**
 * Parses and renders rich inline formatting with colorful highlights:
 * - **bold key terms** -> vibrant highlighted badges/texts
 * - `code snippets` -> stylish mono badges
 * - *italic* -> subtle emphasis
 * - [Link Title](URL) or raw URLs -> Compact interactive RichLinkCard
 */
function renderInlineContent(text: string, colorIndex: number): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*.*?\*\*|`.*?`|\*.*?\*|\[[^\]]+\]\(https?:\/\/[^\s\)]+\)|https?:\/\/[^\s\)\],]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let innerKey = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }
    const token = match[0];

    // Markdown link: [Title](URL)
    const linkMatch = token.match(/^\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)$/);
    if (linkMatch) {
      parts.push(
        <RichLinkCard
          key={`link-inline-${innerKey}`}
          title={linkMatch[1]}
          url={linkMatch[2]}
          isCompact={true}
        />
      );
    } else if (token.startsWith('http://') || token.startsWith('https://')) {
      // Standalone inline URL
      parts.push(
        <RichLinkCard
          key={`url-inline-${innerKey}`}
          url={token}
          isCompact={true}
        />
      );
    } else if (token.startsWith('**') && token.endsWith('**')) {
      const boldContent = token.slice(2, -2);
      const color = HIGHLIGHT_COLORS[(colorIndex + innerKey) % HIGHLIGHT_COLORS.length];
      parts.push(
        <span
          key={`bold-${innerKey}`}
          className={`font-semibold ${color.text} inline-block px-1 py-0.5 rounded bg-white/5 border border-white/10 mx-0.5`}
        >
          {boldContent}
        </span>
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      const codeContent = token.slice(1, -1);
      parts.push(
        <code
          key={`code-${innerKey}`}
          className="font-mono text-xs px-1.5 py-0.5 rounded-md bg-neutral-900 border border-neutral-700 text-amber-300 mx-0.5"
        >
          {codeContent}
        </code>
      );
    } else if (token.startsWith('*') && token.endsWith('*')) {
      const italicContent = token.slice(1, -1);
      parts.push(
        <span key={`it-${innerKey}`} className="italic text-neutral-200">
          {italicContent}
        </span>
      );
    }
    innerKey++;
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

export const FormattedAiResponse: React.FC<FormattedTextProps> = ({ content, text }) => {
  const raw = content ?? text ?? '';
  if (!raw) return null;

  // ─── EXTRACT & ISOLATE REAL IMAGES (HTML <img .../>, Markdown ![alt](src), or raw base64) ───
  const imageBlocks: ImageBlockData[] = [];
  let processedContent = raw;

  // 1. Match HTML <img ... src="..." ... /> across multiple lines
  processedContent = processedContent.replace(/<img\s+([^>]*?)>/gis, (_fullMatch, attrs) => {
    const srcMatch = attrs.match(/src=["']([^"']+)["']/i);
    const altMatch = attrs.match(/alt=["']([^"']+)["']/i);
    if (srcMatch && srcMatch[1]) {
      const idx = imageBlocks.length;
      imageBlocks.push({
        src: srcMatch[1],
        alt: altMatch ? altMatch[1] : 'AI Generated Art',
      });
      return `\n__AI_IMAGE_BLOCK_${idx}__\n`;
    }
    return '';
  });

  // 2. Match Markdown ![alt](src)
  processedContent = processedContent.replace(/!\[(.*?)\]\s*\((data:image\/[^\s\)]+|https?:\/\/[^\s\)]+|\/v1\/images\/cache\/[^\s\)]+)\)/g, (_full, alt, src) => {
    const idx = imageBlocks.length;
    imageBlocks.push({
      src: src,
      alt: alt || 'AI Generated Art',
    });
    return `\n__AI_IMAGE_BLOCK_${idx}__\n`;
  });

  // 3. Match raw standalone data:image/jpeg;base64,... URLs
  processedContent = processedContent.replace(/(data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+)/g, (_full, dataUrl) => {
    const idx = imageBlocks.length;
    imageBlocks.push({
      src: dataUrl,
      alt: 'AI Generated Art',
    });
    return `\n__AI_IMAGE_BLOCK_${idx}__\n`;
  });

  const cleaned = cleanAiSymbols(processedContent);
  if (!cleaned.trim() && imageBlocks.length === 0) return null;

  // Split content by lines
  const lines = cleaned.split('\n');
  let activeBulletIndex = 0;

  return (
    <div className="space-y-2.5 text-[13.5px] sm:text-sm leading-relaxed text-neutral-100 select-text">
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return <div key={`empty-${idx}`} className="h-1.5" />;
        }

        // Image Placeholder Replacement
        const imgBlockMatch = trimmed.match(/^__AI_IMAGE_BLOCK_(\d+)__$/);
        if (imgBlockMatch) {
          const blockIdx = parseInt(imgBlockMatch[1], 10);
          const imgData = imageBlocks[blockIdx];
          if (imgData) {
            return <AiImageRenderer key={`ai-img-${blockIdx}`} data={imgData} />;
          }
        }

        // 1. Code Block Fence
        if (trimmed.startsWith('```')) {
          return (
            <div
              key={`fence-${idx}`}
              className="font-mono text-xs text-neutral-400 bg-neutral-950 px-2 py-1 rounded"
            >
              {trimmed}
            </div>
          );
        }

        // 2. Full Block-Level Link: [Title](URL)
        const fullLinkMatch = trimmed.match(/^\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)[\.\,]?$/);
        if (fullLinkMatch) {
          return (
            <div key={`link-block-${idx}`} className="my-3">
              <RichLinkCard
                title={fullLinkMatch[1]}
                url={fullLinkMatch[2]}
                isCompact={false}
              />
            </div>
          );
        }

        // 3. Standalone Raw URL: https://...
        const standaloneUrlMatch = trimmed.match(/^(https?:\/\/[^\s\)]+)[\.\,]?$/);
        if (standaloneUrlMatch) {
          return (
            <div key={`url-block-${idx}`} className="my-3">
              <RichLinkCard
                url={standaloneUrlMatch[1]}
                isCompact={false}
              />
            </div>
          );
        }

        // 4. Headings (###, ##, #)
        const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
        if (headingMatch) {
          const level = headingMatch[1].length;
          const text = headingMatch[2];
          const color = HIGHLIGHT_COLORS[idx % HIGHLIGHT_COLORS.length];
          return (
            <div
              key={`h-${idx}`}
              className={`font-bold mt-3 mb-1.5 flex items-center space-x-2 ${
                level === 1
                  ? 'text-base sm:text-lg text-white border-b border-neutral-700 pb-1'
                  : 'text-sm sm:text-base ' + color.text
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${color.dot}`} />
              <span>{renderInlineContent(text, idx)}</span>
            </div>
          );
        }

        // 5. Bullet Point with Heading/Key (e.g., "* **Taglines:** Is app ka main slogan...", "- **App ke Fayde:** ...")
        const bulletMatch = trimmed.match(/^[*•-]\s+(.+)$/);
        if (bulletMatch) {
          const itemText = bulletMatch[1];
          const color = HIGHLIGHT_COLORS[activeBulletIndex % HIGHLIGHT_COLORS.length];
          activeBulletIndex++;

          // Check if bullet starts with a bold key: `**Key:** Description`
          const keyMatch = itemText.match(/^\*\*(.+?)\*\*:\s*(.*)$/);
          if (keyMatch) {
            const keyTitle = keyMatch[1];
            const rest = keyMatch[2];
            return (
              <div
                key={`bullet-key-${idx}`}
                className={`my-1.5 pl-3 py-1.5 pr-3 rounded-xl border ${color.border} ${color.bg} transition-all`}
              >
                <div className="flex items-start space-x-2">
                  <div className={`w-2 h-2 rounded-full ${color.dot} mt-1.5 shrink-0 shadow-sm`} />
                  <div className="flex-1">
                    <span className={`font-bold text-sm ${color.text} tracking-wide mr-1.5`}>
                      {keyTitle}:
                    </span>
                    <span className="text-neutral-200">
                      {renderInlineContent(rest, activeBulletIndex)}
                    </span>
                  </div>
                </div>
              </div>
            );
          }

          // Regular bullet point
          return (
            <div key={`bullet-${idx}`} className="flex items-start space-x-2.5 my-1 pl-1">
              <span className={`w-1.5 h-1.5 rounded-full ${color.dot} mt-2 shrink-0`} />
              <div className="flex-1 text-neutral-200 leading-relaxed">
                {renderInlineContent(itemText, activeBulletIndex)}
              </div>
            </div>
          );
        }

        // 6. Standalone Bold Key on line (e.g., "**Conclusion:** This is important")
        const standaloneKeyMatch = trimmed.match(/^\*\*(.+?)\*\*:\s*(.*)$/);
        if (standaloneKeyMatch) {
          const keyTitle = standaloneKeyMatch[1];
          const rest = standaloneKeyMatch[2];
          const color = HIGHLIGHT_COLORS[activeBulletIndex % HIGHLIGHT_COLORS.length];
          activeBulletIndex++;
          return (
            <div
              key={`standalone-key-${idx}`}
              className={`my-2 p-2.5 rounded-xl border ${color.border} ${color.bg}`}
            >
              <div className="flex items-start space-x-2">
                <span className={`w-2 h-2 rounded-full ${color.dot} mt-1.5 shrink-0`} />
                <div>
                  <span className={`font-bold text-sm ${color.text} mr-1.5`}>{keyTitle}:</span>
                  <span className="text-neutral-200">{renderInlineContent(rest, activeBulletIndex)}</span>
                </div>
              </div>
            </div>
          );
        }

        // 7. Standard text paragraph with inline highlights and compact rich links
        return (
          <p key={`p-${idx}`} className="text-neutral-200 leading-relaxed">
            {renderInlineContent(trimmed, idx)}
          </p>
        );
      })}
    </div>
  );
};
