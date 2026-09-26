import React from 'react';
import { RichLinkCard } from './RichLinkCard';

interface FormattedTextProps {
  content: string;
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
 * Parses and renders rich inline formatting with colorful highlights:
 * - **bold key terms** -> vibrant highlighted badges/texts
 * - `code snippets` -> stylish mono badges
 * - *italic* -> subtle emphasis
 * - [Link Title](URL) or raw URLs -> Compact interactive RichLinkCard (no ugly raw URL!)
 */
function renderInlineContent(text: string, colorIndex: number): React.ReactNode {
  // Regex to match **bold**, `code`, *italic*, [Title](URL), or standalone http(s) URL
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

export const FormattedAiResponse: React.FC<FormattedTextProps> = ({ content }) => {
  const cleaned = cleanAiSymbols(content);
  if (!cleaned.trim()) return null;

  // Split content by paragraphs / lines
  const lines = cleaned.split('\n');

  let activeBulletIndex = 0;

  return (
    <div className="space-y-2.5 text-[13.5px] sm:text-sm leading-relaxed text-neutral-100 select-text">
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return <div key={`empty-${idx}`} className="h-1.5" />;
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
