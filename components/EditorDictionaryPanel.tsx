import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Icons } from './ui/Icons';
import type { CustomOnlineDictionary } from '../types';
import {
  getAllOnlineDictionaryProviders,
  type OnlineDictionaryId,
  getOnlineDictionaryProvider,
} from '../services/onlineDictionaryUrls';

const PANEL_HEIGHT_MIN = 120;
const PANEL_HEIGHT_MAX = 560;
const PANEL_HEIGHT_DEFAULT = 280;

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
}) => {
  const [panelHeight, setPanelHeight] = useState(readStoredPanelHeight);
  const resizeRef = useRef<{ startY: number; startH: number } | null>(null);

  const dictionaryProviders = useMemo(
    () => getAllOnlineDictionaryProviders(customDictionaries),
    [customDictionaries]
  );

  const provider = useMemo(
    () => getOnlineDictionaryProvider(providerId, customDictionaries),
    [providerId, customDictionaries]
  );
  const committedQuery = query.trim();

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
      aria-label="在线词典"
    >
      {!collapsed ? (
        <div
          className="h-1.5 cursor-row-resize hover:bg-blue-400/40 bg-transparent shrink-0"
          onMouseDown={onResizeMouseDown}
          title="拖动调整词典面板高度"
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
          title={collapsed ? '展开词典（显示词典源与释义区）' : '折叠词典（仅保留标题栏）'}
        >
          <Icons.ChevronDown
            className={`w-4 h-4 transition-transform ${collapsed ? '' : 'rotate-180'}`}
          />
        </button>
        <Icons.Globe className="w-4 h-4 text-blue-600 shrink-0" />
        <span className="text-xs font-bold text-slate-700 uppercase tracking-wide shrink-0">
          在线词典
        </span>
        {committedQuery ? (
          <span
            className="text-xs text-slate-600 truncate max-w-[min(40vw,16rem)]"
            title={committedQuery}
          >
            「{committedQuery}」
          </span>
        ) : (
          <span className="text-xs text-slate-400">划选可作备查；Ctrl+D 打开词典主页</span>
        )}
        {collapsed ? (
          <span className="text-[10px] text-slate-400 shrink-0">· {provider.label}</span>
        ) : null}

        <div className="flex-1 min-w-2" />

        <label className="flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer shrink-0">
          <input
            type="checkbox"
            checked={autoLookupEnabled}
            onChange={(e) => onAutoLookupEnabledChange(e.target.checked)}
            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
          />
          划词自动展开
        </label>

        <button
          type="button"
          disabled={!provider.homeUrl}
          onClick={openInBrowser}
          className="shrink-0 rounded px-2 py-1 text-[11px] font-medium text-slate-700 border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40"
        >
          浏览器打开
        </button>
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
        </div>
      ) : null}
    </div>
  );
};
