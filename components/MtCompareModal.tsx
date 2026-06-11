import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icons } from './ui/Icons';
import { MT_COMPARE_MAX, MT_COMPARE_PRESETS } from '../constants';
import type { MtCompareResultItem } from '../services/mtReferenceClient';
import type { MtTranslatorOption } from './EditorDictionaryPanel';
import { buildMtDiffSegments, countMtDiffChars } from '../utils/mtCompareDiff';
import {
  getEditableMtActionText,
  resolveMtInsertPayload,
  type MtInsertMode,
} from '../utils/mtResultText';

export interface MtCompareModalProps {
  open: boolean;
  onClose: () => void;
  query: string;
  langPair?: string;
  tagWarning?: boolean;
  autoLookup?: boolean;
  onAutoLookupChange?: (enabled: boolean) => void;
  translators: MtTranslatorOption[];
  compareTranslators: string[];
  onCompareTranslatorsChange: (ids: string[]) => void;
  onSwitchToSingleEngine?: () => void;
  results: MtCompareResultItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onCopy: (text?: string) => void;
  onInsert: (text?: string, mode?: MtInsertMode) => void;
}

export const MtCompareModal: React.FC<MtCompareModalProps> = ({
  open,
  onClose,
  query,
  langPair = '',
  tagWarning = false,
  autoLookup = true,
  onAutoLookupChange,
  translators,
  compareTranslators,
  onCompareTranslatorsChange,
  onSwitchToSingleEngine,
  results,
  selectedId,
  onSelect,
  loading,
  error,
  onRefresh,
  onCopy,
  onInsert,
}) => {
  const [showDiff, setShowDiff] = useState(false);
  const [editedTexts, setEditedTexts] = useState<Record<string, string>>({});
  const textareaRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());
  const committedQuery = query.trim();
  const compareSet = useMemo(() => new Set(compareTranslators), [compareTranslators]);

  const okResults = useMemo(
    () => results.filter((r) => r.status === 'ok' && (r.text ?? '').trim()),
    [results]
  );

  const diffBaseline = useMemo(() => {
    const selected = results.find((r) => r.translatorId === selectedId && r.status === 'ok');
    if (selected?.text?.trim()) return selected.text.trim();
    return okResults[0]?.text?.trim() ?? '';
  }, [results, selectedId, okResults]);

  const diffBaselineLabel = useMemo(() => {
    const selected = results.find((r) => r.translatorId === selectedId && r.status === 'ok');
    if (selected?.text?.trim()) return selected.label;
    return okResults[0]?.label ?? '';
  }, [results, selectedId, okResults]);

  const canShowDiff = okResults.length >= 2;

  const toggleCompareEngine = useCallback(
    (id: string) => {
      const next = new Set(compareTranslators);
      if (next.has(id)) {
        if (next.size <= 1) return;
        next.delete(id);
      } else if (next.size >= MT_COMPARE_MAX) {
        return;
      } else {
        next.add(id);
      }
      onCompareTranslatorsChange([...next]);
    },
    [compareTranslators, onCompareTranslatorsChange]
  );

  const applyComparePreset = useCallback(
    (ids: readonly string[]) => {
      const enabledIds = new Set(translators.map((t) => t.id));
      const picked = ids.filter((id) => enabledIds.has(id)).slice(0, MT_COMPARE_MAX);
      if (picked.length > 0) onCompareTranslatorsChange(picked);
    },
    [translators, onCompareTranslatorsChange]
  );

  const selectedResult = useMemo(
    () => results.find((r) => r.translatorId === selectedId && r.status === 'ok'),
    [results, selectedId]
  );

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const row of results) {
      if (row.status === 'ok' && row.text) {
        next[row.translatorId] = row.text;
      }
    }
    setEditedTexts(next);
  }, [results]);

  const setTextareaRef = useCallback((id: string, el: HTMLTextAreaElement | null) => {
    if (el) textareaRefs.current.set(id, el);
    else textareaRefs.current.delete(id);
  }, []);

  const getResultText = useCallback(
    (translatorId: string, fallback = '') => editedTexts[translatorId] ?? fallback,
    [editedTexts]
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="MT 多引擎对比"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex flex-col w-full max-w-6xl max-h-[85vh] rounded-2xl bg-white shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="shrink-0 flex flex-wrap items-center gap-3 px-5 py-4 border-b border-slate-200 bg-slate-50">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2 shrink-0">
            <Icons.Languages className="w-5 h-5 text-indigo-600" />
            MT 多引擎对比
          </h2>
          <div className="flex rounded-lg border border-slate-200 overflow-hidden shrink-0">
            <button
              type="button"
              onClick={() => {
                onSwitchToSingleEngine?.();
                onClose();
              }}
              className="px-3 py-1.5 text-xs font-medium bg-white text-slate-600 hover:bg-slate-100"
            >
              单引擎
            </button>
            <button
              type="button"
              className="px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white"
            >
              多引擎对比
            </button>
          </div>
          {MT_COMPARE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => applyComparePreset(p.translators)}
              className="rounded-lg px-2.5 py-1 text-xs font-medium bg-violet-50 text-violet-800 border border-violet-200 hover:bg-violet-100 shrink-0"
              title={p.translators.join(', ')}
            >
              {p.label}
            </button>
          ))}
          <span className="text-xs text-slate-400 shrink-0">
            已选 {compareTranslators.length}/{MT_COMPARE_MAX}
          </span>
          <div className="flex-1 min-w-4" />
          <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={autoLookup}
              onChange={(e) => onAutoLookupChange?.(e.target.checked)}
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
            />
            句段切换自动查询
          </label>
          <label
            className={`flex items-center gap-1.5 text-xs cursor-pointer shrink-0 ${
              canShowDiff ? 'text-slate-600' : 'text-slate-400 cursor-not-allowed'
            }`}
            title={
              canShowDiff
                ? '以当前选中引擎（或首个成功结果）为基准，用修订标记（删除线/下划线）标出差异'
                : '至少需要两个成功译文才能显示差异'
            }
          >
            <input
              type="checkbox"
              checked={showDiff && canShowDiff}
              disabled={!canShowDiff}
              onChange={(e) => setShowDiff(e.target.checked)}
              className="rounded border-slate-300 text-amber-600 focus:ring-amber-500 w-3.5 h-3.5 disabled:opacity-40"
            />
            显示差异
          </label>
          <button
            type="button"
            disabled={loading || !committedQuery}
            onClick={onRefresh}
            className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-indigo-700 border border-indigo-200 bg-white hover:bg-indigo-50 disabled:opacity-40"
          >
            {loading ? '查询中…' : '刷新'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-500"
            title="关闭 (Esc)"
          >
            <Icons.X className="w-5 h-5" />
          </button>
        </div>

        <div className="shrink-0 flex flex-row border-b border-indigo-100 bg-white">
          <div className="flex-1 min-w-0 px-4 py-3">
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">
              对比引擎
            </p>
            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
              {translators.map((t) => {
                const on = compareSet.has(t.id);
                const atMax = compareTranslators.length >= MT_COMPARE_MAX;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleCompareEngine(t.id)}
                    disabled={!on && atMax}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors disabled:opacity-40 ${
                      on
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                    title={t.description}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>
          {committedQuery ? (
            <div
              className="shrink-0 w-[42%] min-w-[240px] max-w-[520px] border-l border-indigo-100 bg-gradient-to-br from-indigo-50/95 via-white to-slate-50 px-4 py-3"
              title={committedQuery}
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1.5">
                <span className="inline-flex items-center rounded-md bg-indigo-600 px-2 py-0.5 text-[11px] font-bold text-white tracking-wide">
                  原文
                </span>
                {langPair ? (
                  <span className="text-[11px] font-medium text-indigo-700/90">{langPair}</span>
                ) : null}
                <span className="text-[11px] text-slate-500">{committedQuery.length} 字</span>
              </div>
              <p className="text-base font-semibold text-slate-900 leading-relaxed whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
                {committedQuery}
              </p>
            </div>
          ) : null}
        </div>

        <div className="flex-1 min-h-0 overflow-auto bg-slate-50 p-4">
          {tagWarning ? (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
              原文含格式标记，参考译文可能不完整；仅供对照。
            </p>
          ) : null}
          {!committedQuery ? (
            <p className="text-sm text-slate-500 text-center py-16">
              划选原文或切换到句段后，将在此显示多引擎对照结果。
            </p>
          ) : (
            <>
              {error ? (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">
                  {error}
                </p>
              ) : null}
              {results.length === 0 && !loading ? (
                <p className="text-sm text-slate-500 text-center py-16">
                  请选择对比引擎并点击「刷新」。
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <span className="inline-flex items-center rounded-md bg-emerald-600 px-2 py-0.5 text-[11px] font-bold text-white tracking-wide">
                      参考译文
                    </span>
                    <span className="text-xs text-slate-500">
                      译文可编辑 · 可划选部分复制或插入到句段光标处
                    </span>
                    {showDiff && canShowDiff ? (
                      <span className="text-xs text-slate-700 bg-slate-100 border border-slate-200 rounded-md px-2 py-0.5">
                        基准：{diffBaselineLabel}
                        <span className="text-slate-400 mx-1">·</span>
                        <del className="text-red-700 line-through decoration-red-500">删除</del>
                        <span className="text-slate-400 mx-0.5">/</span>
                        <ins className="text-green-800 underline decoration-green-600">插入</ins>
                        <span className="text-slate-500 ml-1">= 相对基准的修订</span>
                      </span>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {results.map((row) => {
                      const selected = row.translatorId === selectedId;
                      const rowText = row.text?.trim() ?? '';
                      const isBaseline =
                        showDiff &&
                        canShowDiff &&
                        row.status === 'ok' &&
                        rowText &&
                        rowText === diffBaseline;
                      const diffCharCount =
                        showDiff && canShowDiff && row.status === 'ok' && rowText && !isBaseline
                          ? countMtDiffChars(buildMtDiffSegments(diffBaseline, rowText))
                          : 0;
                      return (
                        <div
                          key={row.translatorId}
                          className={`flex flex-col min-h-[140px] rounded-xl border bg-white overflow-hidden text-left transition-shadow ${
                            selected
                              ? 'border-indigo-500 ring-2 ring-indigo-200 shadow-md'
                              : 'border-slate-200 hover:border-slate-300 hover:shadow-sm'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => onSelect(row.translatorId)}
                            className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 bg-slate-50 shrink-0 w-full text-left hover:bg-slate-100/80"
                          >
                            <span className="text-xs font-semibold text-slate-800">{row.label}</span>
                            {showDiff && canShowDiff && row.status === 'ok' && rowText ? (
                              isBaseline ? (
                                <span className="text-[10px] font-medium text-indigo-600 bg-indigo-50 border border-indigo-100 rounded px-1.5">
                                  基准
                                </span>
                              ) : diffCharCount === 0 ? (
                                <span className="text-[10px] text-emerald-600">与基准一致</span>
                              ) : (
                                <span className="text-[10px] text-amber-700">有修订</span>
                              )
                            ) : null}
                            {row.status === 'loading' ? (
                              <span className="text-[10px] text-slate-400 ml-auto">查询中…</span>
                            ) : row.elapsedMs != null ? (
                              <span className="text-[10px] text-slate-400 ml-auto">{row.elapsedMs} ms</span>
                            ) : null}
                          </button>
                          <div className="flex-1 min-h-[80px] overflow-auto p-3">
                            {row.status === 'loading' ? (
                              <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-500">
                                <span className="w-4 h-4 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
                                正在查询…
                              </div>
                            ) : row.status === 'error' ? (
                              <p className="text-xs text-red-600">{row.error ?? '查询失败'}</p>
                            ) : (
                              <textarea
                                ref={(el) => setTextareaRef(row.translatorId, el)}
                                value={getResultText(row.translatorId, row.text ?? '')}
                                onChange={(e) =>
                                  setEditedTexts((prev) => ({
                                    ...prev,
                                    [row.translatorId]: e.target.value,
                                  }))
                                }
                                onFocus={() => onSelect(row.translatorId)}
                                onClick={(e) => e.stopPropagation()}
                                onMouseDown={(e) => e.stopPropagation()}
                                spellCheck={false}
                                className="w-full min-h-[72px] resize-y border-0 bg-transparent p-0 text-sm text-slate-800 leading-relaxed whitespace-pre-wrap focus:outline-none focus:ring-0"
                                aria-label={`${row.label} 参考译文`}
                              />
                            )}
                          </div>
                          {row.status === 'ok' && row.text ? (
                            <div className="shrink-0 flex gap-2 px-3 py-2 border-t border-slate-100 bg-slate-50/80">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const ta = textareaRefs.current.get(row.translatorId);
                                  onCopy(
                                    getEditableMtActionText(ta, getResultText(row.translatorId, row.text))
                                  );
                                }}
                                className="rounded-lg px-2.5 py-1 text-xs font-medium border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                              >
                                复制
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const ta = textareaRefs.current.get(row.translatorId);
                                  const payload = resolveMtInsertPayload(
                                    ta,
                                    getResultText(row.translatorId, row.text)
                                  );
                                  if (payload.text) onInsert(payload.text, payload.mode);
                                }}
                                className="rounded-lg px-2.5 py-1 text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700"
                                title="未划选时整句替换句段译文；划选时插入到句段光标处"
                              >
                                插入
                              </button>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <div className="shrink-0 flex flex-wrap items-center gap-2 px-5 py-3 border-t border-slate-200 bg-white">
          {selectedResult?.text ? (
            <span className="text-xs text-slate-500 truncate max-w-md">
              已选：{selectedResult.label}
            </span>
          ) : null}
          <div className="flex-1" />
          <button
            type="button"
            disabled={!selectedResult?.text}
            onClick={() => {
              if (!selectedId) return;
              const ta = textareaRefs.current.get(selectedId);
              onCopy(
                getEditableMtActionText(
                  ta,
                  getResultText(selectedId, selectedResult?.text ?? '')
                )
              );
            }}
            className="rounded-lg px-4 py-2 text-sm font-medium border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            复制选中
          </button>
          <button
            type="button"
            disabled={!selectedResult?.text}
            onClick={() => {
              if (!selectedId) return;
              const ta = textareaRefs.current.get(selectedId);
              const payload = resolveMtInsertPayload(
                ta,
                getResultText(selectedId, selectedResult?.text ?? '')
              );
              if (payload.text) onInsert(payload.text, payload.mode);
            }}
            className="rounded-lg px-4 py-2 text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
            title="未划选时整句替换句段译文；划选时插入到句段光标处"
          >
            插入选中
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};
