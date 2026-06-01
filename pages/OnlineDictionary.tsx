import React, { useEffect, useMemo, useCallback } from 'react';
import { Icons } from '../components/ui/Icons';
import type { CustomOnlineDictionary } from '../types';
import {
  getAllOnlineDictionaryProviders,
  type OnlineDictionaryId,
  getOnlineDictionaryProvider,
} from '../services/onlineDictionaryUrls';

export interface OnlineDictionaryPageProps {
  customDictionaries?: CustomOnlineDictionary[];
}

export const OnlineDictionaryPage: React.FC<OnlineDictionaryPageProps> = ({
  customDictionaries = [],
}) => {
  const [providerId, setProviderId] = React.useState<OnlineDictionaryId>('youdao');

  useEffect(() => {
    const available = getAllOnlineDictionaryProviders(customDictionaries);
    if (!available.some((p) => p.id === providerId)) {
      setProviderId('youdao');
    }
  }, [customDictionaries, providerId]);

  const dictionaryProviders = useMemo(
    () => getAllOnlineDictionaryProviders(customDictionaries),
    [customDictionaries]
  );

  const provider = useMemo(
    () => getOnlineDictionaryProvider(providerId, customDictionaries),
    [providerId, customDictionaries]
  );

  const openInBrowser = useCallback(() => {
    if (!provider.homeUrl) return;
    window.open(provider.homeUrl, '_blank', 'noopener,noreferrer');
  }, [provider.homeUrl]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-slate-100">
      <div className="shrink-0 border-b border-slate-200 bg-white px-6 py-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex flex-wrap gap-2">
            {dictionaryProviders.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setProviderId(p.id)}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  providerId === p.id
                    ? 'bg-blue-600 text-white shadow'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={!provider.homeUrl}
            onClick={openInBrowser}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            浏览器打开
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          当前：{provider.label}（{provider.description}）。仅打开词典主页，不会自动带上检索词。也可使用顶部栏「在线词典」或
          Ctrl+D。
        </p>
      </div>

      <div className="flex-1 min-h-0 relative bg-white m-4 rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {provider.supportsIframeEmbed ? (
          <iframe
            key={providerId}
            title={provider.label}
            src={provider.homeUrl}
            className="w-full h-full border-0 bg-white"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex h-full min-h-[280px] items-center justify-center overflow-auto bg-gradient-to-b from-slate-50 to-white p-6">
            <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white px-8 py-10 shadow-sm text-center">
              <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-amber-600">
                <Icons.Info className="h-7 w-7" />
              </div>
              <h3 className="text-base font-semibold text-slate-900">
                「{provider.label}」需在浏览器中打开
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-slate-600">
                点击下方按钮将在系统浏览器中打开词典主页，请在站内自行检索。
              </p>
              <button
                type="button"
                onClick={openInBrowser}
                className="mt-8 inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white shadow hover:bg-blue-700"
              >
                <Icons.ExternalLink className="h-4 w-4" />
                在浏览器中打开
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
