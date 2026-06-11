import React, { useEffect, useRef, useState } from 'react';
import { Icons } from './ui/Icons';
import {
  fetchMtReferenceCompare,
  type MtCompareResultItem,
} from '../services/mtReferenceClient';
import { MT_COMPARE_MAX, MT_TRANSLATOR_IDS } from '../constants';
import type { MtReferenceSettings } from '../types';

export type QuickMtPopupProps = {
  open: boolean;
  sourceText: string;
  sourceLang: string;
  targetLang: string;
  mtSettings: MtReferenceSettings;
  onClose: () => void;
  onInsert: (text: string) => void;
};

export const QuickMtPopup: React.FC<QuickMtPopupProps> = ({
  open,
  sourceText,
  sourceLang,
  targetLang,
  mtSettings,
  onClose,
  onInsert,
}) => {
  const [results, setResults] = useState<MtCompareResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !sourceText.trim()) return;
    let cancelled = false;
    setLoading(true);
    setResults([]);
    const ids = (
      mtSettings?.compareTranslators?.length
        ? mtSettings.compareTranslators
        : MT_TRANSLATOR_IDS
    ).slice(0, MT_COMPARE_MAX);
    void fetchMtReferenceCompare(sourceText, ids, sourceLang, targetLang, mtSettings).then(
      (items) => {
        if (!cancelled) {
          setResults(items);
          setLoading(false);
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [open, sourceText, sourceLang, targetLang, mtSettings]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= 9) {
        const item = results.filter((r) => r.status === 'ok')[n - 1];
        if (item?.text) {
          e.preventDefault();
          onInsert(item.text);
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, results, onClose, onInsert]);

  if (!open) return null;

  const okResults = results.filter((r) => r.status === 'ok' && r.text);

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[12vh] bg-black/30 backdrop-blur-sm">
      <div
        ref={dialogRef}
        className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-lg mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
          <div>
            <h3 className="font-bold text-slate-800 text-sm">快速 MT 参考</h3>
            <p className="text-[10px] text-slate-500">按数字键 1–9 插入译文 · Esc 关闭</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <Icons.X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-4 py-2 text-xs text-slate-600 bg-yellow-50 border-b border-yellow-100 truncate">
          {sourceText}
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-3 space-y-2">
          {loading && (
            <div className="flex items-center justify-center py-8 text-slate-500 text-sm">
              <Icons.RefreshCw className="w-5 h-5 animate-spin mr-2" />
              正在查询 MT…
            </div>
          )}
          {!loading &&
            okResults.map((r, idx) => (
              <button
                key={r.translatorId}
                type="button"
                onClick={() => {
                  onInsert(r.text!);
                  onClose();
                }}
                className="w-full text-left p-3 rounded-lg border border-slate-200 hover:border-blue-400 hover:bg-blue-50 transition-colors"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-bold bg-slate-800 text-white w-5 h-5 rounded flex items-center justify-center">
                    {idx + 1}
                  </span>
                  <span className="text-xs font-semibold text-slate-700">{r.label}</span>
                </div>
                <p className="text-sm text-slate-800 whitespace-pre-wrap">{r.text}</p>
              </button>
            ))}
          {!loading && okResults.length === 0 && (
            <p className="text-center text-sm text-slate-500 py-6">无可用 MT 结果，请检查 MT 参考服务设置。</p>
          )}
        </div>
      </div>
    </div>
  );
};
