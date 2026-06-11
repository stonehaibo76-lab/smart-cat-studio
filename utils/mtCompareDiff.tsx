import React, { useMemo } from 'react';

export type MtRevisionSegment = { text: string; type: 'equal' | 'delete' | 'insert' };

function isMostlyCjk(text: string): boolean {
  const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  const alpha = (text.match(/[a-zA-Z]/g) || []).length;
  return cjk >= alpha;
}

function tokensEqual(a: string, b: string): boolean {
  if (a === b) return true;
  if (/^\s+$/.test(a) && /^\s+$/.test(b)) return true;
  const hasCjk = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(a + b);
  if (!hasCjk) return a.toLowerCase() === b.toLowerCase();
  return false;
}

/** 按语种习惯切分：中文等按字，西文按词（保留空白） */
export function tokenizeForMtDiff(text: string): string[] {
  if (!text) return [];
  if (isMostlyCjk(text)) {
    const tokens: string[] = [];
    for (const ch of text) {
      if (/\s/.test(ch)) {
        const last = tokens[tokens.length - 1];
        if (last !== undefined && /^\s+$/.test(last)) tokens[tokens.length - 1] = last + ch;
        else tokens.push(ch);
      } else {
        tokens.push(ch);
      }
    }
    return tokens;
  }
  return text.split(/(\s+)/);
}

function mergeRevisionSegments(segments: MtRevisionSegment[]): MtRevisionSegment[] {
  const merged: MtRevisionSegment[] = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    if (last && last.type === seg.type) {
      last.text += seg.text;
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

/** 相对基准译文生成修订式 diff（删除线 + 下划线） */
export function buildMtRevisionSegments(baseline: string, current: string): MtRevisionSegment[] {
  const base = tokenizeForMtDiff(baseline);
  const cur = tokenizeForMtDiff(current);
  if (!baseline.trim() && !current.trim()) return [];
  if (baseline.trim() === current.trim()) {
    return current ? [{ text: current, type: 'equal' }] : [];
  }

  const n = base.length;
  const m = cur.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = tokensEqual(base[i - 1], cur[j - 1])
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const raw: MtRevisionSegment[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && tokensEqual(base[i - 1], cur[j - 1])) {
      raw.push({ type: 'equal', text: cur[j - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      raw.push({ type: 'insert', text: cur[j - 1] });
      j--;
    } else if (i > 0) {
      raw.push({ type: 'delete', text: base[i - 1] });
      i--;
    }
  }

  return mergeRevisionSegments(raw.reverse());
}

/** @deprecated 兼容旧名 */
export const buildMtDiffSegments = buildMtRevisionSegments;

export function countMtRevisionChars(segments: MtRevisionSegment[]): number {
  return segments
    .filter((s) => s.type !== 'equal')
    .reduce((n, s) => n + s.text.replace(/\s/g, '').length, 0);
}

/** @deprecated 兼容旧名 */
export const countMtDiffChars = countMtRevisionChars;

export interface MtCompareDiffTextProps {
  baseline: string;
  text: string;
  className?: string;
}

export const MtCompareDiffText: React.FC<MtCompareDiffTextProps> = ({ baseline, text, className }) => {
  const segments = useMemo(() => buildMtRevisionSegments(baseline, text), [baseline, text]);

  return (
    <span className={className}>
      {segments.map((seg, i) => {
        if (seg.type === 'equal') {
          return <span key={i}>{seg.text}</span>;
        }
        if (seg.type === 'delete') {
          return (
            <del
              key={i}
              className="text-red-700 bg-red-50 line-through decoration-red-500 decoration-1.5 box-decoration-clone"
              title="基准译文中有，本引擎未保留"
            >
              {seg.text}
            </del>
          );
        }
        return (
          <ins
            key={i}
            className="text-green-800 bg-green-50 underline decoration-green-600 decoration-2 underline-offset-2 box-decoration-clone"
            title="本引擎新增，基准译文中无"
          >
            {seg.text}
          </ins>
        );
      })}
    </span>
  );
};
