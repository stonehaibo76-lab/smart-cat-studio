import React, { useMemo } from 'react';
import type { TermBaseEntry } from '../types';
import { collectUniqueTermHitSpans } from '../services/termQaMatch';

function isForbiddenTerm(term: TermBaseEntry): boolean {
  const ctx = (term.context || '').toLowerCase();
  return ctx.includes('禁止') || ctx.includes('forbidden') || ctx.startsWith('!');
}

export type TermLensRowProps = {
  sourceText: string;
  terms: TermBaseEntry[];
  onInsertTarget: (text: string) => void;
  className?: string;
};

/** RYS-style inline terminology chips under source text. */
export const TermLensRow: React.FC<TermLensRowProps> = ({
  sourceText,
  terms,
  onInsertTarget,
  className = '',
}) => {
  const hits = useMemo(
    () => collectUniqueTermHitSpans(sourceText, terms, false),
    [sourceText, terms]
  );

  if (!hits.length) return null;

  return (
    <div className={`flex flex-wrap gap-1 px-3 pb-2 pt-0.5 ${className}`}>
      {hits.map((hit) => {
        const forbidden = isForbiddenTerm(hit.term);
        return (
          <button
            key={hit.term.id}
            type="button"
            title={
              forbidden
                ? `禁止: ${hit.term.source} → ${hit.term.target}`
                : `${hit.term.source} → ${hit.term.target}`
            }
            onClick={(e) => {
              e.stopPropagation();
              if (!forbidden) onInsertTarget(hit.term.target);
            }}
            className={`text-[10px] leading-tight px-1.5 py-0.5 rounded border shadow-sm max-w-[12rem] truncate ${
              forbidden
                ? 'bg-red-50 text-red-700 border-red-200 cursor-not-allowed line-through'
                : 'bg-sky-50 text-sky-800 border-sky-200 hover:bg-sky-100 cursor-pointer'
            }`}
          >
            <span className="opacity-70">{hit.term.source}</span>
            <span className="mx-0.5">→</span>
            <span className="font-semibold">{hit.term.target}</span>
          </button>
        );
      })}
    </div>
  );
};
