import React, { useMemo } from 'react';
import type { InlineRunStyle, TermBaseEntry } from '../types';
import {
  colorCss,
  hasInlineMarkers,
  highlightColorCss,
  metaById,
  parseMarkedParts,
} from '../services/inlineFormatting/markerParse';
import { segmentSourceByTermHits } from '../services/termQaMatch';

function runStyleToCss(style: InlineRunStyle | undefined): React.CSSProperties {
  if (!style) return {};
  const css: React.CSSProperties = {};
  if (style.bold) css.fontWeight = 'bold';
  if (style.italic) css.fontStyle = 'italic';
  const decorations: string[] = [];
  if (style.underline) decorations.push('underline');
  if (style.strike) decorations.push('line-through');
  if (decorations.length) css.textDecoration = decorations.join(' ');
  if (style.color) {
    const c = colorCss(style.color);
    if (c) css.color = c;
  }
  if (style.highlight) {
    const bg = highlightColorCss(style.highlight);
    if (bg) css.backgroundColor = bg;
  }
  if (style.vertAlign === 'superscript') {
    css.verticalAlign = 'super';
    css.fontSize = '0.75em';
  }
  if (style.vertAlign === 'subscript') {
    css.verticalAlign = 'sub';
    css.fontSize = '0.75em';
  }
  return css;
}

function renderPlainWithTerms(text: string, terms: TermBaseEntry[], keyPrefix: string): React.ReactNode[] {
  if (!terms.length || !text) return [text];
  const segments = segmentSourceByTermHits(text, terms, false);
  return segments.map((seg, i) =>
    seg.term ? (
      <span
        key={`${keyPrefix}-t-${i}`}
        className="bg-yellow-200/50 text-yellow-700 border-b-2 border-yellow-400/50 cursor-help font-medium rounded-[2px] px-0.5 mx-0.5"
        title={`术语: ${seg.term.source} -> ${seg.term.target}`}
      >
        {seg.text}
      </span>
    ) : (
      <React.Fragment key={`${keyPrefix}-p-${i}`}>{seg.text}</React.Fragment>
    )
  );
}

export type InlineMarkedTextProps = {
  text: string;
  inlineRunMeta?: InlineRunStyle[];
  terms?: TermBaseEntry[];
  className?: string;
  style?: React.CSSProperties;
  /** Ctrl 按住且译文有选区时，有格式原文显示手形并可点击取格式 */
  formatPickActive?: boolean;
  onFormattedRunPick?: (runId: string, style: InlineRunStyle) => void;
};

/** Read-only WYSIWYG render for marked segment text. */
export function InlineMarkedText({
  text,
  inlineRunMeta,
  terms = [],
  className,
  style,
  formatPickActive = false,
  onFormattedRunPick,
}: InlineMarkedTextProps) {
  const meta = useMemo(() => metaById(inlineRunMeta), [inlineRunMeta]);

  const nodes = useMemo(() => {
    if (!text) return null;
    if (!hasInlineMarkers(text)) {
      return renderPlainWithTerms(text, terms, 'plain');
    }
    const parts = parseMarkedParts(text);
    return parts.map((part, i) => {
      if (part.type === 'plain') {
        return (
          <React.Fragment key={`p-${i}`}>
            {renderPlainWithTerms(part.text, terms, `p-${i}`)}
          </React.Fragment>
        );
      }
      if (part.type === 'standalone') {
        return (
          <span
            key={`s-${i}`}
            data-run-id={part.id}
            className="inline-block w-0 h-0 overflow-hidden"
            aria-hidden
          />
        );
      }
      const runStyle = meta.get(part.id);
      const pickable = formatPickActive && !!runStyle && !!onFormattedRunPick;
      return (
        <span
          key={`r-${i}`}
          data-run-id={part.id}
          style={runStyleToCss(runStyle)}
          className={
            pickable
              ? 'cursor-pointer rounded-sm hover:outline hover:outline-2 hover:outline-teal-400/70 hover:outline-offset-1'
              : undefined
          }
          title={pickable ? '点击将此处格式应用到译文选区' : undefined}
          onMouseDown={(e) => {
            if (pickable && e.ctrlKey) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          onClick={(e) => {
            if (!pickable || !e.ctrlKey || !runStyle) return;
            e.preventDefault();
            e.stopPropagation();
            onFormattedRunPick(part.id, { ...runStyle, id: part.id });
          }}
        >
          {part.text}
        </span>
      );
    });
  }, [text, meta, terms, formatPickActive, onFormattedRunPick]);

  return (
    <span className={className} style={style}>
      {nodes}
    </span>
  );
}

export { runStyleToCss };
