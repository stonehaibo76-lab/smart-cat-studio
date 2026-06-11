import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icons } from './ui/Icons';
import type { CustomOnlineDictionary } from '../types';
import {
  getAllOnlineDictionaryProviders,
  type OnlineDictionaryId,
  getOnlineDictionaryProvider,
} from '../services/onlineDictionaryUrls';
import {
  getEditableMtActionText,
  resolveMtInsertPayload,
  type MtInsertMode,
} from '../utils/mtResultText';

const PANEL_HEIGHT_MIN = 120;
const PANEL_HEIGHT_MAX = 560;
const PANEL_HEIGHT_DEFAULT = 280;

export type EditorBottomPanelTab = 'dictionary' | 'mt';

export const DICTIONARY_AUTO_LOOKUP_KEY = 'smartcat-dict-auto-lookup';
export const DICTIONARY_PANEL_HEIGHT_KEY = 'smartcat-dict-panel-height';

function readStoredPanelHeight(): number {
  try {
    const raw = localStorage.getItem(DICTIONARY_PANEL_HEIGHT_KEY);
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n) && n >= PANEL_HEIGHT_MIN && n <= PANEL_HEIGHT_MAX) return n;
  } catch {
    /* ignore */
  }
  return PANEL_HEIGHT_DEFAULT;
}

export function readDictionaryAutoLookupEnabled(): boolean {
  try {
    const v = localStorage.getItem(DICTIONARY_AUTO_LOOKUP_KEY);
    if (v === '0' || v === 'false') return false;
  } catch {
    /* ignore */
  }
  return true;
}

export function writeDictionaryAutoLookupEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(DICTIONARY_AUTO_LOOKUP_KEY, enabled ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export interface MtTranslatorOption {
  id: string;
  label: string;
  description: string;
}

export interface EditorDictionaryPanelProps {
  open: boolean;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onClose: () => void;
  query: string;
  providerId: OnlineDictionaryId;
  onProviderChange: (id: OnlineDictionaryId) => void;
  autoLookupEnabled: boolean;
  onAutoLookupEnabledChange: (enabled: boolean) => void;
  customDictionaries?: CustomOnlineDictionary[];
  bottomTab: EditorBottomPanelTab;
  onBottomTabChange: (tab: EditorBottomPanelTab) => void;
  mtReferenceEnabled?: boolean;
  mtTranslators?: MtTranslatorOption[];
  mtTranslatorId?: string;
  onMtTranslatorChange?: (id: string) => void;
  mtAutoLookup?: boolean;
  onMtAutoLookupChange?: (enabled: boolean) => void;
  mtLoading?: boolean;
  mtError?: string | null;
  mtResult?: string | null;
  mtElapsedMs?: number | null;
  mtTagWarning?: boolean;
  mtLangPair?: string;
  onMtRefresh?: () => void;
  onMtCopy?: (text?: string) => void;
  onMtInsert?: (text?: string, mode?: MtInsertMode) => void;
  onOpenMtCompareModal?: () => void;
}

export const EditorDictionaryPanel: React.FC<EditorDictionaryPanelProps> = ({
  open,
  collapsed,
  onCollapsedChange,
  onClose,
  query,
  providerId,
  onProviderChange,
  autoLookupEnabled,
  onAutoLookupEnabledChange,
  customDictionaries = [],
  bottomTab,
  onBottomTabChange,
  mtReferenceEnabled = false,
  mtTranslators = [],
  mtTranslatorId = 'bing',
  onMtTranslatorChange,
  mtAutoLookup = true,
  onMtAutoLookupChange,
  mtLoading = false,
  mtError = null,
  mtResult = null,
  mtElapsedMs = null,
  mtTagWarning = false,
  mtLangPair = '',
  onMtRefresh,
  onMtCopy,
  onMtInsert,
  onOpenMtCompareModal,
}) => {
  const [panelHeight, setPanelHeight] = useState(readStoredPanelHeight);
  const [mtEditedResult, setMtEditedResult] = useState('');
  const mtResultTextareaRef = useRef<HTMLTextAreaElement>(null);
  const resizeRef = useRef<{ startY: number; startH: number } | null>(null);

  const dictionaryProviders = useMemo(
    () => getAllOnlineDictionaryProviders(customDictionaries),
    [customDictionaries]
  );

  const provider = useMemo(
    () => getOnlineDictionaryProvider(providerId, customDictionaries),
    [providerId, customDictionaries]
  );

  const mtTranslator = useMemo(
    () => mtTranslators.find((t) => t.id === mtTranslatorId) ?? mtTranslators[0],
    [mtTranslators, mtTranslatorId]
  );

  const committedQuery = query.trim();
  const isMtTab = bottomTab === 'mt';

  useEffect(() => {
    setMtEditedResult(mtResult ?? '');
  }, [mtResult]);

  const openInBrowser = useCallback(() => {
    if (!provider.homeUrl) return;
    window.open(provider.homeUrl, '_blank', 'noopener,noreferrer');
  }, [provider.homeUrl]);

  const onResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizeRef.current = { startY: e.clientY, startH: panelHeight };
      const onMove = (ev: MouseEvent) => {
        const r = resizeRef.current;
        if (!r) return;
        const next = Math.min(
          PANEL_HEIGHT_MAX,
          Math.max(PANEL_HEIGHT_MIN, r.startH + (r.startY - ev.clientY))
        );
        setPanelHeight(next);
      };
      const onUp = () => {
        resizeRef.current = null;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        setPanelHeight((h) => {
          try {
            localStorage.setItem(DICTIONARY_PANEL_HEIGHT_KEY, String(h));
          } catch {
            /* ignore */
          }
          return h;
        });
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [panelHeight]
  );

  if (!open) return null;

  return (
    <div
      className="shrink-0 flex flex-col border-t border-slate-300 bg-white shadow-[0_-4px_12px_rgba(0,0,0,0.06)] z-30"
      role="region"
      aria-label={isMtTab ? '机器翻译参考' : '在线词典'}
    >
      {!collapsed ? (
        <div
          className="h-1.5 cursor-row-resize hover:bg-blue-400/40 bg-transparent shrink-0"
          onMouseDown={onResizeMouseDown}
          title="拖动调整面板高度"
        />
      ) : null}

      <div
        className={`shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 bg-slate-50 ${
          collapsed ? '' : 'border-b border-slate-200'
        }`}
      >
        <button
          type="button"
          onClick={() => onCollapsedChange(!collapsed)}
          className="p-1 rounded hover:bg-slate-200 text-slate-600"
          title={collapsed ? '展开面板' : '折叠面板（仅保留标题栏）'}
        >
          <Icons.ChevronDown
            className={`w-4 h-4 transition-transform ${collapsed ? '' : 'rotate-180'}`}
          />
        </button>

        {!collapsed ? (
          <div className="flex rounded-lg border border-slate-200 overflow-hidden shrink-0">
            <button
              type="button"
              onClick={() => onBottomTabChange('dictionary')}
              className={`px-2.5 py-1 text-[11px] font-medium ${
                bottomTab === 'dictionary'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-100'
              }`}
            >
              在线词典
            </button>
            {mtReferenceEnabled ? (
              <button
                type="button"
                onClick={() => onBottomTabChange('mt')}
                className={`px-2.5 py-1 text-[11px] font-medium ${
                  bottomTab === 'mt'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-slate-600 hover:bg-slate-100'
                }`}
              >
                MT 参考
              </button>
            ) : null}
          </div>
        ) : isMtTab ? (
          <Icons.Languages className="w-4 h-4 text-indigo-600 shrink-0" />
        ) : (
          <Icons.Globe className="w-4 h-4 text-blue-600 shrink-0" />
        )}

        <span className="text-xs font-bold text-slate-700 uppercase tracking-wide shrink-0">
          {isMtTab ? '机器翻译参考' : '在线词典'}
        </span>
        {committedQuery ? (
          isMtTab ? (
            <span className="text-[11px] font-medium text-indigo-700 shrink-0">已载入原文</span>
          ) : (
            <span
              className="text-xs text-slate-600 truncate max-w-[min(40vw,16rem)]"
              title={committedQuery}
            >
              「{committedQuery}」
            </span>
          )
        ) : (
          <span className="text-xs text-slate-400">
            {isMtTab ? 'Ctrl+Shift+M · 单引擎参考' : '划选可作备查；Ctrl+D 打开词典'}
          </span>
        )}
        {collapsed && isMtTab && committedQuery ? (
          <span
            className="text-[11px] font-semibold text-slate-800 truncate max-w-[min(50vw,20rem)]"
            title={committedQuery}
          >
            原文：{committedQuery}
          </span>
        ) : null}
        {collapsed ? (
          <span className="text-[10px] text-slate-400 shrink-0">
            · {isMtTab ? mtTranslator?.label ?? 'MT' : provider.label}
          </span>
        ) : null}

        <div className="flex-1 min-w-2" />

        {isMtTab && onOpenMtCompareModal ? (
          <button
            type="button"
            onClick={onOpenMtCompareModal}
            className="shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-medium text-violet-800 border border-violet-200 bg-violet-50 hover:bg-violet-100"
          >
            多引擎对比…
          </button>
        ) : null}

        {!isMtTab ? (
          <label className="flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={autoLookupEnabled}
              onChange={(e) => onAutoLookupEnabledChange(e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
            />
            划词自动展开
          </label>
        ) : (
          <label className="flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={mtAutoLookup}
              onChange={(e) => onMtAutoLookupChange?.(e.target.checked)}
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
            />
            句段切换自动查询
          </label>
        )}

        {!isMtTab ? (
          <button
            type="button"
            disabled={!provider.homeUrl}
            onClick={openInBrowser}
            className="shrink-0 rounded px-2 py-1 text-[11px] font-medium text-slate-700 border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40"
          >
            浏览器打开
          </button>
        ) : (
          <button
            type="button"
            disabled={mtLoading || !committedQuery}
            onClick={() => onMtRefresh?.()}
            className="shrink-0 rounded px-2 py-1 text-[11px] font-medium text-indigo-700 border border-indigo-200 bg-white hover:bg-indigo-50 disabled:opacity-40"
          >
            {mtLoading ? '查询中…' : '刷新'}
          </button>
        )}

        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded hover:bg-slate-200 text-slate-500"
          title="关闭面板"
        >
          <Icons.X className="w-4 h-4" />
        </button>
      </div>

      {!collapsed ? (
        <div className="flex flex-col min-h-0">
          {!isMtTab ? (
            <>
              <div className="shrink-0 flex flex-wrap gap-1 px-2 py-1.5 border-b border-slate-100 bg-white overflow-x-auto">
                {dictionaryProviders.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onProviderChange(p.id)}
                    className={`rounded px-2 py-1 text-[11px] font-medium whitespace-nowrap transition-colors ${
                      providerId === p.id
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div
                className="overflow-hidden bg-slate-50 shrink-0"
                style={{ height: panelHeight }}
              >
                <div className="flex h-full items-center justify-center p-4 overflow-auto">
                  <div className="max-w-md text-center">
                    <p className="text-sm font-medium text-slate-800">{provider.label}</p>
                    <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                      点击「浏览器打开」进入词典主页，在站内自行检索。
                      {committedQuery ? (
                        <>
                          {' '}
                          备查词：
                          <span className="font-medium text-slate-900">「{committedQuery}」</span>
                        </>
                      ) : null}
                    </p>
                    <button
                      type="button"
                      onClick={openInBrowser}
                      className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700"
                    >
                      <Icons.ExternalLink className="h-3.5 w-3.5" />
                      在浏览器中打开
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="shrink-0 flex flex-row border-b border-indigo-100 bg-white">
                <div className="flex-1 min-w-0 px-2 py-2">
                  <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                    {mtTranslators.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => onMtTranslatorChange?.(t.id)}
                        className={`rounded px-2 py-1 text-[11px] font-medium whitespace-nowrap transition-colors ${
                          mtTranslatorId === t.id
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                        title={t.description}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
                {committedQuery ? (
                  <div
                    className="shrink-0 w-[38%] min-w-[200px] max-w-[440px] border-l border-indigo-100 bg-gradient-to-br from-indigo-50/95 via-white to-slate-50 px-3 py-2 flex flex-col justify-center"
                    title={committedQuery}
                  >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mb-1">
                      <span className="inline-flex items-center rounded-md bg-indigo-600 px-2 py-0.5 text-[10px] font-bold text-white tracking-wide">
                        原文
                      </span>
                      {mtLangPair ? (
                        <span className="text-[10px] font-medium text-indigo-700/90">{mtLangPair}</span>
                      ) : null}
                      <span className="text-[10px] text-slate-500">{committedQuery.length} 字</span>
                    </div>
                    <p className="text-sm font-semibold text-slate-900 leading-snug whitespace-pre-wrap break-words line-clamp-3 overflow-y-auto">
                      {committedQuery}
                    </p>
                  </div>
                ) : null}
              </div>

              <div className="overflow-auto bg-slate-50 shrink-0 p-3" style={{ height: panelHeight }}>
                {mtTagWarning ? (
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 mb-2">
                    原文含格式标记，参考译文可能不完整；仅供对照。
                  </p>
                ) : null}
                {!committedQuery ? (
                  <p className="text-xs text-slate-500 text-center py-8">
                    切换到句段后，将显示当前句原文的 MT 参考译文（不会自动写入）。
                  </p>
                ) : mtLoading ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500">
                    <span className="w-4 h-4 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
                    正在查询 {mtTranslator?.label ?? 'MT'}…
                  </div>
                ) : mtError ? (
                  <div className="text-center py-6">
                    <p className="text-sm text-red-600">{mtError}</p>
                    <button
                      type="button"
                      onClick={() => onMtRefresh?.()}
                      className="mt-3 text-xs text-indigo-600 hover:underline"
                    >
                      重试
                    </button>
                  </div>
                ) : mtResult ? (
                  <div className="flex flex-col h-full min-h-0 gap-2">
                    <div className="shrink-0 flex items-center gap-2">
                      <span className="inline-flex items-center rounded-md bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white tracking-wide">
                        参考译文
                      </span>
                      <span className="text-[11px] font-medium text-slate-600">
                        {mtTranslator?.label ?? 'MT'}
                      </span>
                      <span className="text-[10px] text-slate-400">可编辑 · 可划选部分</span>
                    </div>
                    <textarea
                      ref={mtResultTextareaRef}
                      value={mtEditedResult}
                      onChange={(e) => setMtEditedResult(e.target.value)}
                      spellCheck={false}
                      className="flex-1 min-h-[80px] w-full resize-y overflow-auto rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-800 leading-relaxed whitespace-pre-wrap focus:outline-none focus:ring-2 focus:ring-indigo-200"
                      aria-label="MT 参考译文"
                    />
                    <div className="shrink-0 flex flex-wrap items-center gap-2">
                      {mtElapsedMs != null ? (
                        <span className="text-[10px] text-slate-400">{mtElapsedMs} ms</span>
                      ) : null}
                      <div className="flex-1" />
                      <button
                        type="button"
                        onClick={() =>
                          onMtCopy?.(
                            getEditableMtActionText(mtResultTextareaRef.current, mtEditedResult)
                          )
                        }
                        className="rounded-lg px-3 py-1.5 text-xs font-medium border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                      >
                        复制
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const payload = resolveMtInsertPayload(
                            mtResultTextareaRef.current,
                            mtEditedResult
                          );
                          if (payload.text) onMtInsert?.(payload.text, payload.mode);
                        }}
                        className="rounded-lg px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700"
                        title="未划选时整句替换句段译文；划选时插入到句段光标处"
                      >
                        插入译文
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 text-center py-8">暂无结果，点击「刷新」查询。</p>
                )}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
};
