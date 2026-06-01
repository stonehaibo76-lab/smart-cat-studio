import React, { useEffect, useRef, useState } from 'react';
import { Icons } from '../components/ui/Icons';
import {
  AISettings,
  QuickPrompt,
  FavoriteUrl,
  CustomOnlineDictionary,
  EmbeddingSettings,
  PerformanceSettings,
} from '../types';
import { isValidCustomDictionaryHomeUrl } from '../services/onlineDictionaryUrls';
import { checkEmbeddingHealth } from '../services/embeddingClient';
import { requestStartLocalEmbeddingService } from '../services/devEmbeddingLauncher';
import { testAIConnection } from '../services/geminiService';
import {
  applyLocalDataStorePath,
  downloadLocalDatabaseExport,
  fetchLocalDataStore,
  importLocalDatabaseFile,
  type LocalDataStoreInfo,
} from '../services/localBackendClient';
import { DEEPSEEK_MODEL_OPTIONS } from '../constants';
import { isCloudDeployment, saveSettingsHint, savedToDatabaseMessage } from '../services/deploymentMode';

export type SettingsPanelId =
  | 'ai'
  | 'translation'
  | 'embedding'
  | 'performance'
  | 'localDb'
  | 'quickPrompts'
  | 'favoriteUrls'
  | 'onlineDictionary';

interface SettingsPageProps {
    aiSettings: AISettings;
    onUpdateAISettings: (settings: AISettings) => void;
    quickPrompts: QuickPrompt[];
    onUpdateQuickPrompts: (prompts: QuickPrompt[]) => void;
    favoriteUrls: FavoriteUrl[];
    onUpdateFavoriteUrls: (urls: FavoriteUrl[]) => void;
    /** 将当前列表写入 SQLite settings_kv（favorite-urls） */
    onSaveFavoriteUrls: () => Promise<void>;
    customOnlineDictionaries: CustomOnlineDictionary[];
    onUpdateCustomOnlineDictionaries: (items: CustomOnlineDictionary[]) => void;
    onSaveCustomOnlineDictionaries: () => Promise<void>;
    embeddingSettings: EmbeddingSettings;
    onUpdateEmbeddingSettings: (s: EmbeddingSettings) => void;
    performanceSettings: PerformanceSettings;
    onUpdatePerformanceSettings: (s: PerformanceSettings) => void;
    /** 中译外：译文编辑区首字母自动大写 */
    capitalizeTargetFirstLetterZhOut: boolean;
    onUpdateCapitalizeTargetFirstLetterZhOut: (enabled: boolean) => void;
    /** 进入设置页时默认选中的面板（如从侧边栏「本地数据设置」进入） */
    initialPanel?: SettingsPanelId;
}

const SETTINGS_PANELS: {
  id: SettingsPanelId;
  title: string;
  subtitle: string;
  icon: typeof Icons.Sparkles;
  activeClass: string;
  idleClass: string;
}[] = [
  {
    id: 'ai',
    title: 'AI 引擎',
    subtitle: '模型与 API',
    icon: Icons.Sparkles,
    activeClass: 'border-violet-400 bg-violet-50 text-violet-900 ring-2 ring-violet-400/30',
    idleClass: 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
  },
  {
    id: 'translation',
    title: '翻译设置',
    subtitle: '译文编辑习惯',
    icon: Icons.Translate,
    activeClass: 'border-sky-400 bg-sky-50 text-sky-950 ring-2 ring-sky-400/30',
    idleClass: 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
  },
  {
    id: 'embedding',
    title: '向量检索',
    subtitle: '本地 RAG / 知识库',
    icon: Icons.BrainCircuit,
    activeClass: 'border-teal-400 bg-teal-50 text-teal-900 ring-2 ring-teal-400/30',
    idleClass: 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
  },
  {
    id: 'performance',
    title: '性能',
    subtitle: '低配机 / 卡顿',
    icon: Icons.Zap,
    activeClass: 'border-amber-500 bg-amber-50 text-amber-950 ring-2 ring-amber-400/35',
    idleClass: 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
  },
  {
    id: 'localDb',
    title: '本地数据',
    subtitle: 'SQLite 路径 / 备份',
    icon: Icons.Database,
    activeClass: 'border-slate-700 bg-slate-50 text-slate-900 ring-2 ring-slate-400/35',
    idleClass: 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
  },
  {
    id: 'quickPrompts',
    title: '快捷按钮',
    subtitle: 'AI 对话预设',
    icon: Icons.Languages,
    activeClass: 'border-blue-400 bg-blue-50 text-blue-900 ring-2 ring-blue-400/30',
    idleClass: 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
  },
  {
    id: 'favoriteUrls',
    title: '收藏网址',
    subtitle: '顶部栏快捷打开',
    icon: Icons.Bookmark,
    activeClass: 'border-amber-400 bg-amber-50 text-amber-950 ring-2 ring-amber-400/30',
    idleClass: 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
  },
  {
    id: 'onlineDictionary',
    title: '在线词典',
    subtitle: '自定义检索 URL',
    icon: Icons.Globe,
    activeClass: 'border-blue-400 bg-blue-50 text-blue-950 ring-2 ring-blue-400/30',
    idleClass: 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
  }
];

export const SettingsPage: React.FC<SettingsPageProps> = ({ 
    aiSettings, onUpdateAISettings, quickPrompts, onUpdateQuickPrompts,
    favoriteUrls, onUpdateFavoriteUrls, onSaveFavoriteUrls,
    customOnlineDictionaries, onUpdateCustomOnlineDictionaries, onSaveCustomOnlineDictionaries,
    embeddingSettings, onUpdateEmbeddingSettings,
    performanceSettings, onUpdatePerformanceSettings,
    capitalizeTargetFirstLetterZhOut, onUpdateCapitalizeTargetFirstLetterZhOut,
    initialPanel,
}) => {
  const cloud = isCloudDeployment();
  const [activePanel, setActivePanel] = useState<SettingsPanelId>(() => initialPanel ?? 'ai');
  const [favSaving, setFavSaving] = useState(false);
  const [favSaveHint, setFavSaveHint] = useState<{ ok: boolean; text: string } | null>(null);
  const [dictSaving, setDictSaving] = useState(false);
  const [dictSaveHint, setDictSaveHint] = useState<{ ok: boolean; text: string } | null>(null);
  const [embedTesting, setEmbedTesting] = useState(false);
  const [embedTestMsg, setEmbedTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [embedLaunchBusy, setEmbedLaunchBusy] = useState(false);
  const [embedLaunchHint, setEmbedLaunchHint] = useState<string | null>(null);
  const [embedLaunchLogs, setEmbedLaunchLogs] = useState<string[]>([]);
  const [embedLaunchProgress, setEmbedLaunchProgress] = useState<number | null>(null);
  const embedLogRef = useRef<HTMLPreElement>(null);
  const [aiTesting, setAiTesting] = useState(false);
  const [aiTestMsg, setAiTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [localDbInfo, setLocalDbInfo] = useState<LocalDataStoreInfo | null>(null);
  const [localDbLoading, setLocalDbLoading] = useState(false);
  const [localDbErr, setLocalDbErr] = useState<string | null>(null);
  const [localDbPathDraft, setLocalDbPathDraft] = useState('');
  const [localDbBusy, setLocalDbBusy] = useState(false);
  const [localDbMsg, setLocalDbMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const localDbImportRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (activePanel !== 'favoriteUrls') {
      setFavSaveHint(null);
    }
    if (activePanel !== 'onlineDictionary') {
      setDictSaveHint(null);
    }
  }, [activePanel]);

  useEffect(() => {
    if (activePanel !== 'localDb') return;
    let cancelled = false;
    (async () => {
      setLocalDbLoading(true);
      setLocalDbErr(null);
      setLocalDbMsg(null);
      try {
        const info = await fetchLocalDataStore();
        if (!cancelled) {
          setLocalDbInfo(info);
          setLocalDbPathDraft(info.dbPath);
        }
      } catch (e) {
        if (!cancelled) {
          setLocalDbErr(e instanceof Error ? e.message : String(e));
          setLocalDbInfo(null);
        }
      } finally {
        if (!cancelled) setLocalDbLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activePanel]);

  const handleApplyDbPath = async () => {
    setLocalDbBusy(true);
    setLocalDbMsg(null);
    try {
      await applyLocalDataStorePath(localDbPathDraft.trim());
      window.location.reload();
    } catch (e) {
      setLocalDbMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setLocalDbBusy(false);
    }
  };

  const handleExportDb = async () => {
    setLocalDbBusy(true);
    setLocalDbMsg(null);
    try {
      await downloadLocalDatabaseExport();
      setLocalDbMsg({ ok: true, text: '已开始下载数据库文件，可用于备份或在更换安装路径后导入恢复。' });
    } catch (e) {
      setLocalDbMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setLocalDbBusy(false);
    }
  };

  const handleImportDbPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!window.confirm('导入将把所选 SQLite 文件替换当前数据库（会先备份现有文件）。页面将刷新，确定继续？')) {
      return;
    }
    setLocalDbBusy(true);
    setLocalDbMsg(null);
    try {
      await importLocalDatabaseFile(file);
      window.location.reload();
    } catch (err) {
      setLocalDbMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setLocalDbBusy(false);
    }
  };

  const appendEmbedLog = (line: string) => {
    setEmbedLaunchLogs((prev) => {
      const next = [...prev, line];
      const max = 400;
      return next.length > max ? next.slice(-max) : next;
    });
  };

  useEffect(() => {
    const el = embedLogRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [embedLaunchLogs]);

  const handleStartEmbeddingProcess = async () => {
    setEmbedLaunchBusy(true);
    setEmbedLaunchHint(null);
    setEmbedLaunchLogs([]);
    setEmbedLaunchProgress(null);
    try {
      const r = await requestStartLocalEmbeddingService({
        onLogLine: appendEmbedLog,
        onProgress: (pct) => setEmbedLaunchProgress(pct)
      });
      if (!r.ok) {
        setEmbedLaunchHint(r.error);
        return;
      }
      if (r.alreadyRunning) {
        setEmbedLaunchProgress(100);
        setEmbedLaunchHint('检测到 8765 已在运行。可直接「测试连接」。已为你勾选「启用本地向量服务」。');
      } else {
        setEmbedLaunchProgress(100);
        setEmbedLaunchHint(
          '向量服务已在后台启动（本页显示日志）。首次下载模型可能较慢；就绪后请点击「测试连接」。已勾选「启用本地向量服务」。'
        );
      }
      onUpdateEmbeddingSettings({ ...embeddingSettings, enabled: true });
    } finally {
      setEmbedLaunchBusy(false);
    }
  };

  const runEmbeddingConnectionTest = async () => {
    const url = embeddingSettings.serviceUrl?.trim();
    if (!url) {
      setEmbedTestMsg({ ok: false, text: '请先填写服务地址' });
      return;
    }
    setEmbedTesting(true);
    setEmbedTestMsg(null);
    try {
      const r = await checkEmbeddingHealth(url, embeddingSettings.apiKey?.trim() || undefined);
      if (r.ok) {
        setEmbedTestMsg({
          ok: true,
          text: `连接成功：${r.model ?? '—'}，维度 ${r.dimension ?? '—'}`
        });
      } else {
        setEmbedTestMsg({ ok: false, text: r.error || '连接失败' });
      }
    } catch (e) {
      setEmbedTestMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setEmbedTesting(false);
    }
  };

  const runAIConnectionTest = async () => {
    setAiTesting(true);
    setAiTestMsg(null);
    try {
      const result = await testAIConnection(aiSettings);
      setAiTestMsg(result);
    } catch (e) {
      setAiTestMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setAiTesting(false);
    }
  };

  const handleProviderChange = (provider: string) => {
      const p = provider === 'Google Gemini' ? 'gemini' : provider === 'DeepSeek' ? 'deepseek' : 'openai';
      const nextSettings: AISettings = { ...aiSettings, provider: p as any };
      if (p === 'deepseek') {
        const hasValidDeepSeekModel = DEEPSEEK_MODEL_OPTIONS.some((m) => m.value === aiSettings.model);
        nextSettings.model = hasValidDeepSeekModel ? aiSettings.model : DEEPSEEK_MODEL_OPTIONS[0].value;
      }
      onUpdateAISettings(nextSettings);
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-4xl mx-auto h-full overflow-y-auto">
      <h1 className="text-3xl font-black text-slate-900 mb-2 tracking-tight">系统设置</h1>
      <p className="text-sm text-slate-500 mb-6">点击下方卡片切换要修改的配置项</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 mb-8">
        {SETTINGS_PANELS.map(({ id, title, subtitle, icon: Icon, activeClass, idleClass }) => {
          const isOn = activePanel === id;
          const panelTitle = id === 'localDb' ? (cloud ? '云端数据' : '本地数据') : title;
          const panelSubtitle =
            id === 'localDb'
              ? cloud
                ? 'PostgreSQL · 账号隔离'
                : 'SQLite 路径 / 备份'
              : subtitle;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActivePanel(id)}
              className={`
                flex items-start gap-3 text-left rounded-2xl border-2 p-4 transition-all shadow-sm
                ${isOn ? activeClass : idleClass}
              `}
            >
              <div
                className={`p-2 rounded-xl shrink-0 ${isOn ? 'bg-white/80' : 'bg-slate-100 text-slate-500'}`}
              >
                <Icon className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1 overflow-hidden">
                <div className="font-bold text-sm sm:text-base leading-tight">{panelTitle}</div>
                <div className="text-xs mt-1 opacity-80 leading-snug whitespace-nowrap overflow-hidden text-ellipsis">
                  {panelSubtitle}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="min-h-0">
        {/* AI Configuration Section */}
        {activePanel === 'ai' && (
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 lg:p-6 min-w-0 animate-in fade-in duration-200">
          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
            <div className="p-2 bg-purple-100 text-purple-600 rounded-lg">
              <Icons.Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">AI 引擎配置</h2>
              <p className="text-sm text-slate-500">管理 Gemini、DeepSeek 等模型的连接设置。</p>
            </div>
          </div>

          <div className="space-y-5">
            {/* Default Provider */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">默认翻译引擎</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
                {['Google Gemini', 'DeepSeek', 'OpenAI'].map((provider) => {
                  const isActive = (provider === 'Google Gemini' && aiSettings.provider === 'gemini') || 
                                   (provider === 'DeepSeek' && aiSettings.provider === 'deepseek') ||
                                   (provider === 'OpenAI' && aiSettings.provider === 'openai');
                  return (
                    <button 
                      key={provider} 
                      onClick={() => handleProviderChange(provider)}
                      className={`
                      py-3 px-4 rounded-xl border text-sm font-medium transition-all
                      ${isActive
                        ? 'border-blue-500 bg-blue-50 text-blue-700 ring-1 ring-blue-500/20' 
                        : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-white'}
                    `}>
                      {provider}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={aiTesting}
                onClick={() => void runAIConnectionTest()}
                className="px-4 py-2 text-sm font-medium text-white bg-violet-600 rounded-xl hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {aiTesting ? '检测中…' : '测试引擎连接'}
              </button>
              {aiTestMsg && (
                <span className={`text-sm ${aiTestMsg.ok ? 'text-green-700' : 'text-red-600'}`}>
                  {aiTestMsg.text}
                </span>
              )}
            </div>

            {/* DeepSeek Key */}
            {aiSettings.provider === 'deepseek' && (
                <div className="animate-in fade-in slide-in-from-top-2">
                <label className="block text-sm font-semibold text-slate-700 mb-2">DeepSeek 模型</label>
                <select
                  value={DEEPSEEK_MODEL_OPTIONS.some((m) => m.value === aiSettings.model) ? aiSettings.model : DEEPSEEK_MODEL_OPTIONS[0].value}
                  onChange={(e) => onUpdateAISettings({ ...aiSettings, model: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 bg-white text-sm mb-4"
                >
                  {DEEPSEEK_MODEL_OPTIONS.map((model) => (
                    <option key={model.value} value={model.value}>
                      {model.label}
                    </option>
                  ))}
                </select>
                <label className="block text-sm font-semibold text-slate-700 mb-2">DeepSeek API Key</label>
                <div className="relative">
                    <input 
                    type="password" 
                    placeholder="sk-..." 
                    value={aiSettings.deepSeekKey || ''}
                    onChange={(e) => onUpdateAISettings({ ...aiSettings, deepSeekKey: e.target.value })}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-sm font-mono"
                    />
                    <Icons.Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                </div>
                <p className="text-xs text-slate-400 mt-1.5">请输入 DeepSeek 提供的 API Key。我们会自动保存到本地浏览器的 LocalStorage 中。</p>
                </div>
            )}
            
            {aiSettings.provider === 'openai' && (
                <div className="animate-in fade-in slide-in-from-top-2">
                <label className="block text-sm font-semibold text-slate-700 mb-2">OpenAI API Key (暂未完全支持)</label>
                <div className="relative">
                    <input 
                    type="password" 
                    placeholder="sk-..." 
                    disabled
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-slate-100 cursor-not-allowed text-sm font-mono"
                    />
                    <Icons.Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                </div>
                </div>
            )}

             {/* Gemini Key */}
             {aiSettings.provider === 'gemini' && (
                <div className="animate-in fade-in slide-in-from-top-2">
                    <label className="block text-sm font-semibold text-slate-700 mb-2">Google Gemini API Key</label>
                    <div className="relative">
                        <input 
                        type="password" 
                        value="************************"
                        disabled
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-slate-100 text-slate-500 cursor-not-allowed text-sm font-mono"
                        />
                        <Icons.Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    </div>
                    <p className="text-xs text-green-600 mt-1.5 flex items-center gap-1">
                        <Icons.Check className="w-3 h-3" />
                        已通过环境变量安全加载。
                    </p>
                </div>
             )}
          </div>
        </section>
        )}

        {activePanel === 'translation' && (
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 lg:p-6 min-w-0 animate-in fade-in duration-200">
          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
            <div className="p-2 bg-sky-100 text-sky-800 rounded-lg">
              <Icons.Translate className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">翻译设置</h2>
              <p className="text-sm text-slate-500">影响翻译编辑页中的译文输入与替换行为（与 AI 模型无关）。</p>
            </div>
          </div>

          <div className="space-y-4 max-w-xl">
            <label className="flex items-start gap-3 cursor-pointer rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3">
              <input
                type="checkbox"
                checked={capitalizeTargetFirstLetterZhOut}
                onChange={(e) => onUpdateCapitalizeTargetFirstLetterZhOut(e.target.checked)}
                className="mt-1 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
              />
              <span>
                <span className="font-semibold text-slate-800">译文首字母大写</span>
                <span className="block text-sm text-slate-600 mt-0.5 leading-relaxed">
                  仅在
                  <span className="font-medium text-slate-700">中译外</span>
                  项目（原文语言为中文、译文为非中文）中生效：仅在点击译文区「确认」或按回车确认句段时，将译文中第一个字母字符按译文语言区域规则转为大写；编辑输入过程中不自动改写；前导空格与标点不变。
                </span>
              </span>
            </label>
          </div>
        </section>
        )}

        {/* 本地 Embedding / RAG */}
        {activePanel === 'embedding' && (
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 lg:p-6 min-w-0 animate-in fade-in duration-200">
          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
            <div className="p-2 bg-teal-100 text-teal-700 rounded-lg">
              <Icons.BrainCircuit className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">知识库向量检索（本地）</h2>
              <p className="text-sm text-slate-500">
                在 Windows 下使用 npm run dev 启动 CAT 时，可在下方一键后台启动向量服务并查看日志；服务就绪后再启用开关并保存知识库向量。
              </p>
            </div>
          </div>

          <div className="space-y-5">
            <div className="rounded-xl border border-teal-200 bg-teal-50/60 p-4 space-y-3">
              <div className="text-sm font-semibold text-teal-900">启动向量服务</div>
              <p className="text-xs text-teal-800/90 leading-relaxed">
                开发模式下由本页后台启动 Python / uvicorn（端口 8765），并在此显示日志与下载进度；效果与手动运行{' '}
                <span className="font-mono">scripts\start-embedding.cmd</span> 相同。打包预览或离线部署时请仍手动运行该脚本。
              </p>
              <button
                type="button"
                disabled={embedLaunchBusy}
                onClick={() => void handleStartEmbeddingProcess()}
                className="px-4 py-2 text-sm font-medium text-white bg-teal-700 rounded-xl hover:bg-teal-800 disabled:opacity-50"
              >
                {embedLaunchBusy ? '正在启动…' : '启动本地向量服务'}
              </button>
              {embedLaunchBusy && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] text-teal-900/80">
                    <span>进度</span>
                    <span>{embedLaunchProgress != null ? `${embedLaunchProgress}%` : '准备中 / 安装依赖…'}</span>
                  </div>
                  {embedLaunchProgress != null ? (
                    <progress
                      className="w-full h-2 rounded overflow-hidden accent-teal-600"
                      value={embedLaunchProgress}
                      max={100}
                    />
                  ) : (
                    <div className="w-full h-2 rounded bg-teal-200/80 overflow-hidden">
                      <div className="h-full w-full bg-teal-400/50 rounded animate-pulse" />
                    </div>
                  )}
                </div>
              )}
              {embedLaunchLogs.length > 0 && (
                <div className="rounded-lg border border-teal-200/80 bg-white/90 overflow-hidden">
                  <div className="px-2 py-1 text-[10px] font-medium text-teal-900/70 border-b border-teal-100 bg-teal-50/50">
                    启动日志
                  </div>
                  <pre
                    ref={embedLogRef}
                    className="max-h-52 overflow-auto p-2 text-[11px] leading-snug font-mono text-slate-800 whitespace-pre-wrap break-all"
                  >
                    {embedLaunchLogs.join('\n')}
                  </pre>
                </div>
              )}
              {embedLaunchHint && (
                <p className="text-xs text-slate-700 whitespace-pre-wrap">{embedLaunchHint}</p>
              )}
            </div>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={embeddingSettings.enabled}
                onChange={(e) =>
                  onUpdateEmbeddingSettings({ ...embeddingSettings, enabled: e.target.checked })
                }
                className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              />
              <span className="text-sm font-medium text-slate-800">启用本地向量服务</span>
            </label>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">服务地址</label>
              <input
                type="url"
                placeholder="http://127.0.0.1:8765"
                value={embeddingSettings.serviceUrl}
                onChange={(e) =>
                  onUpdateEmbeddingSettings({ ...embeddingSettings, serviceUrl: e.target.value })
                }
                disabled={!embeddingSettings.enabled}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition-all text-sm font-mono disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                API Key（可选，与服务端 EMBED_API_KEY 一致时填写）
              </label>
              <input
                type="password"
                placeholder="留空表示无需鉴权"
                value={embeddingSettings.apiKey || ''}
                onChange={(e) =>
                  onUpdateEmbeddingSettings({ ...embeddingSettings, apiKey: e.target.value || undefined })
                }
                disabled={!embeddingSettings.enabled}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition-all text-sm font-mono disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">RAG 检索模式</label>
              <select
                value={embeddingSettings.ragMode}
                onChange={(e) =>
                  onUpdateEmbeddingSettings({
                    ...embeddingSettings,
                    ragMode: e.target.value as EmbeddingSettings['ragMode']
                  })
                }
                disabled={!embeddingSettings.enabled}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 bg-white text-sm disabled:opacity-50"
              >
                <option value="lexical">仅词法（关键句匹配）</option>
                <option value="vector">仅向量（语义）</option>
                <option value="hybrid">混合（语义 + 词法）</option>
              </select>
            </div>

            {embeddingSettings.ragMode === 'hybrid' && (
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  混合模式 · 词法权重{' '}
                  <span className="font-mono text-slate-600">
                    {(embeddingSettings.hybridLexicalWeight ?? 0.35).toFixed(2)}
                  </span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={embeddingSettings.hybridLexicalWeight ?? 0.35}
                  onChange={(e) =>
                    onUpdateEmbeddingSettings({
                      ...embeddingSettings,
                      hybridLexicalWeight: parseFloat(e.target.value)
                    })
                  }
                  disabled={!embeddingSettings.enabled}
                  className="w-full disabled:opacity-50"
                />
                <p className="text-xs text-slate-500 mt-1">越大越偏向字面匹配，越小越偏向语义相似。</p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={!embeddingSettings.enabled || embedTesting}
                onClick={() => void runEmbeddingConnectionTest()}
                className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-xl hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {embedTesting ? '检测中…' : '测试连接'}
              </button>
              {embedTestMsg && (
                <span
                  className={`text-sm ${embedTestMsg.ok ? 'text-green-700' : 'text-red-600'}`}
                >
                  {embedTestMsg.text}
                </span>
              )}
            </div>
          </div>
        </section>
        )}

        {activePanel === 'performance' && (
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 lg:p-6 min-w-0 animate-in fade-in duration-200">
          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
            <div className="p-2 bg-amber-100 text-amber-800 rounded-lg">
              <Icons.Zap className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">性能模式（低配机）</h2>
              <p className="text-sm text-slate-500">
                减轻界面合成开销，并将<strong className="font-medium text-slate-700">大模型与向量接口</strong>
                的<strong className="font-medium text-slate-700">同时进行请求数限制为 1</strong>，降低内存与 CPU 峰值。
                若系统盘空间极小或内存紧张，建议同时开启下方延迟加载。
              </p>
            </div>
          </div>

          <div className="space-y-5 max-w-xl">
            <label className="flex items-start gap-3 cursor-pointer rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3">
              <input
                type="checkbox"
                checked={performanceSettings.performanceMode}
                onChange={(e) =>
                  onUpdatePerformanceSettings({
                    ...performanceSettings,
                    performanceMode: e.target.checked,
                  })
                }
                className="mt-1 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
              />
              <span>
                <span className="font-semibold text-slate-800">启用性能模式</span>
                <span className="block text-sm text-slate-600 mt-0.5">
                  减少顶部栏/侧栏模糊效果；翻译编辑「对照模式」使用虚拟列表；AI 与 embedding 请求排队串行（至多 1 路同时进行）。
                </span>
              </span>
            </label>

            <label className="flex items-start gap-3 cursor-pointer rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3">
              <input
                type="checkbox"
                checked={performanceSettings.lazyLoadHeavyCollections}
                onChange={(e) =>
                  onUpdatePerformanceSettings({
                    ...performanceSettings,
                    lazyLoadHeavyCollections: e.target.checked,
                  })
                }
                className="mt-1 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
              />
              <span>
                <span className="font-semibold text-slate-800">启动时延迟加载孪生译员与知识库</span>
                <span className="block text-sm text-slate-600 mt-0.5">
                  首次打开应用不读取这两项大块数据；进入「翻译编辑」「孪生译员」或「知识库」页时再加载，可缩短首屏时间与内存占用。
                  <span className="block mt-1 text-amber-800/90">
                    修改此项后需<strong className="font-medium">重新加载页面</strong>后才能在下次启动生效。
                  </span>
                </span>
              </span>
            </label>
          </div>
        </section>
        )}

        {activePanel === 'localDb' && (
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 lg:p-6 min-w-0 animate-in fade-in duration-200">
          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
            <div className="p-2 bg-slate-100 text-slate-700 rounded-lg">
              <Icons.Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                {cloud ? '云端数据库（PostgreSQL）' : '本地数据库（SQLite）'}
              </h2>
              <p className="text-sm text-slate-500">
                {cloud
                  ? '项目、记忆库、术语库、知识库及各项设置均保存在云端 PostgreSQL，按登录账号（组织）隔离。换设备登录同一账号即可继续工作。'
                  : '数据由本机后台服务写入磁盘，可与浏览器缓存分离。请先运行 npm run server 或使用启动脚本。默认数据库在应用程序所在目录下的 data/smartcat-local.db（随文件夹拷贝即可迁移，勿写死其他盘符）。'}
              </p>
            </div>
          </div>

          <div className="space-y-5">
            {cloud ? (
              <>
                {localDbLoading && (
                  <p className="text-sm text-slate-500">正在检查云端连接…</p>
                )}
                {localDbErr && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    <span className="font-semibold">无法连接云端 API：</span> {localDbErr}
                    <p className="text-xs mt-2 opacity-90">
                      请检查网络连接。托管 API 在长时间无访问后可能休眠，首次请求需等待约 30–60 秒唤醒。
                    </p>
                  </div>
                )}
                {(localDbInfo || (!localDbLoading && !localDbErr)) && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 px-4 py-4 space-y-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
                      <span className="font-semibold text-emerald-900">云端模式已启用</span>
                    </div>
                    <ul className="space-y-2 text-slate-600 text-sm leading-relaxed">
                      <li>• 数据库类型：PostgreSQL（Supabase）</li>
                      <li>• 数据按账号隔离，仅本人可见</li>
                      <li>• 建议定期在「语言资源」页导出 Excel 备份术语库与记忆库</li>
                      <li>• SQLite 路径切换、整库导入导出仅在本地版可用</li>
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <>
            {localDbLoading && (
              <p className="text-sm text-slate-500">正在读取本地服务配置…</p>
            )}
            {localDbErr && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <span className="font-semibold">无法连接本地数据库服务：</span> {localDbErr}
                <p className="text-xs mt-2 opacity-90">
                  确认已在本机启动端口 58741 的后台（默认），或设置环境变量{' '}
                  <code className="bg-white/80 px-1 rounded">VITE_LOCAL_DB_URL</code> 指向正确地址。
                </p>
              </div>
            )}
            {localDbInfo && (
              <>
                <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 space-y-2 text-sm">
                  <div>
                    <span className="font-semibold text-slate-700">当前数据库文件：</span>
                    <span className="ml-2 font-mono text-xs text-slate-600 break-all">{localDbInfo.dbPath}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-slate-700">路径配置文件：</span>
                    <span className="ml-2 font-mono text-xs text-slate-600 break-all">{localDbInfo.configPath}</span>
                  </div>
                  <div className="text-xs text-slate-500">
                    路径来源：
                    <span className="font-medium text-slate-700 ml-1">
                      {localDbInfo.resolvedFrom === 'env'
                        ? '环境变量 SMARTCAT_DB_PATH（界面不可改）'
                        : localDbInfo.resolvedFrom === 'config'
                          ? 'smartcat-db-path.json'
                          : '默认（项目下 data/smartcat-local.db）'}
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-slate-700">
                    指定独立的 .db 文件路径（绝对路径推荐）
                  </label>
                  <textarea
                    value={localDbPathDraft}
                    onChange={(e) => setLocalDbPathDraft(e.target.value)}
                    disabled={localDbInfo.envLocked || localDbBusy}
                    rows={3}
                    placeholder="例如 D:\SmartCAT_Data\my-studio.db"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-sm font-mono focus:ring-2 focus:ring-slate-400/30 focus:border-slate-500 outline-none disabled:bg-slate-100 disabled:text-slate-500"
                  />
                  <p className="text-xs text-slate-500 leading-relaxed">
                    保存后将写入项目根目录的 <code className="bg-slate-100 px-1 rounded">smartcat-db-path.json</code>
                    ，并立即切换到该文件（不存在会自动创建）。
                    更换软件安装目录时，可把之前的 .db 拷到新位置，在此处填写路径或使用下方「导入数据库」。
                  </p>
                  <button
                    type="button"
                    disabled={localDbInfo.envLocked || localDbBusy || !localDbPathDraft.trim()}
                    onClick={() => void handleApplyDbPath()}
                    className="px-4 py-2 text-sm font-medium text-white bg-slate-800 rounded-xl hover:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {localDbBusy ? '处理中…' : '保存路径并切换'}
                  </button>
                  {localDbInfo.envLocked && (
                    <p className="text-xs text-amber-700">
                      当前由环境变量锁定数据库路径；若要改用配置文件，请移除 SMARTCAT_DB_PATH 后重启{' '}
                      <code className="bg-amber-100 px-1 rounded">npm run server</code>。
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap gap-3 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    disabled={localDbBusy}
                    onClick={() => void handleExportDb()}
                    className="px-4 py-2 text-sm font-medium rounded-xl border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50"
                  >
                    导出数据库备份
                  </button>
                  <button
                    type="button"
                    disabled={localDbBusy}
                    onClick={() => localDbImportRef.current?.click()}
                    className="px-4 py-2 text-sm font-medium rounded-xl border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50"
                  >
                    导入数据库…
                  </button>
                  <input
                    ref={localDbImportRef}
                    type="file"
                    accept=".db,.sqlite,.sqlite3,application/octet-stream,*/*"
                    className="hidden"
                    onChange={(ev) => void handleImportDbPick(ev)}
                  />
                </div>
                <p className="text-xs text-slate-500">
                  导入文件须为有效的 SQLite 数据库（例如此前在本页导出的备份）。导入成功后页面会自动刷新。
                </p>
              </>
            )}
              </>
            )}
            {localDbMsg && (
              <p className={`text-sm ${localDbMsg.ok ? 'text-green-700' : 'text-red-600'}`}>{localDbMsg.text}</p>
            )}
          </div>
        </section>
        )}

        {/* Quick Prompts Section */}
        {activePanel === 'quickPrompts' && (
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 lg:p-6 min-w-0 flex flex-col max-h-[min(calc(100vh-14rem),48rem)] animate-in fade-in duration-200">
          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
            <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
              <Icons.Languages className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">AI 快捷按钮</h2>
              <p className="text-sm text-slate-500">自定义 AI 对话窗口中的快捷按钮名称和提示词。</p>
            </div>
          </div>

          <div className="space-y-4 flex-1 min-h-0 overflow-y-auto pr-1 -mr-1">
            {quickPrompts.map((prompt, index) => (
              <div key={prompt.id} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-center p-3 bg-slate-50 rounded-lg border border-slate-200">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-500">{index + 1}.</span>
                  <input
                    type="text"
                    placeholder="按钮名称"
                    value={prompt.label}
                    onChange={(e) => {
                      const updated = [...quickPrompts];
                      updated[index] = { ...updated[index], label: e.target.value };
                      onUpdateQuickPrompts(updated);
                    }}
                    className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
                  />
                </div>
                <div className="md:col-span-2">
                  <input
                    type="text"
                    placeholder="提示词内容"
                    value={prompt.text}
                    onChange={(e) => {
                      const updated = [...quickPrompts];
                      updated[index] = { ...updated[index], text: e.target.value };
                      onUpdateQuickPrompts(updated);
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
                  />
                </div>
                <div className="flex justify-end md:col-span-3">
                  <button
                    onClick={() => {
                      const updated = quickPrompts.filter((_, i) => i !== index);
                      onUpdateQuickPrompts(updated);
                    }}
                    className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    title="删除按钮"
                  >
                    <Icons.Trash className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}

            {/* Add New Prompt Button */}
            <button
              onClick={() => {
                const newPrompt: QuickPrompt = {
                  id: `prompt-${Date.now()}`,
                  label: '新按钮',
                  text: '请输入提示词内容'
                };
                onUpdateQuickPrompts([...quickPrompts, newPrompt]);
              }}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-slate-50 text-slate-600 hover:bg-slate-100 rounded-lg border border-dashed border-slate-300 transition-colors"
            >
              <Icons.Plus className="w-4 h-4" />
              <span className="text-sm font-medium">添加新快捷按钮</span>
            </button>
          </div>
        </section>
        )}

        {activePanel === 'onlineDictionary' && (
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 lg:p-6 min-w-0 flex flex-col max-h-[min(calc(100vh-14rem),48rem)] animate-in fade-in duration-200">
          <div className="flex flex-wrap items-start gap-3 mb-6 pb-4 border-b border-slate-100">
            <div className="p-2 bg-blue-100 text-blue-700 rounded-lg">
              <Icons.Globe className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold text-slate-900">自定义在线词典</h2>
              <p className="text-sm text-slate-500">
                在翻译编辑页与「在线词典」页中，自定义项会出现在内置词典旁。填写词典<strong>主页</strong>完整网址；任何时候打开在线词典均仅进入该主页，不会自动拼接检索词。示例：
                <span className="font-mono text-xs text-slate-600 block mt-1 break-all">
                  https://dict.youdao.com/
                </span>
                {saveSettingsHint('custom-online-dictionaries')}
              </p>
            </div>
            <div className="flex flex-col items-stretch sm:items-end gap-2 shrink-0">
              <button
                type="button"
                disabled={dictSaving}
                onClick={() => {
                  void (async () => {
                    setDictSaving(true);
                    setDictSaveHint(null);
                    try {
                      await onSaveCustomOnlineDictionaries();
                      setDictSaveHint({ ok: true, text: savedToDatabaseMessage() });
                    } catch (e) {
                      setDictSaveHint({
                        ok: false,
                        text: e instanceof Error ? e.message : String(e),
                      });
                    } finally {
                      setDictSaving(false);
                    }
                  })();
                }}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                {dictSaving ? (
                  <>
                    <Icons.Refresh className="w-4 h-4 animate-spin" />
                    保存中…
                  </>
                ) : (
                  <>
                    <Icons.Save className="w-4 h-4" />
                    保存到数据库
                  </>
                )}
              </button>
              {dictSaveHint && (
                <p
                  className={`text-xs sm:text-right max-w-xs ${dictSaveHint.ok ? 'text-green-700' : 'text-red-600'}`}
                >
                  {dictSaveHint.text}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-4 flex-1 min-h-0 overflow-y-auto pr-1 -mr-1">
            {customOnlineDictionaries.map((item, index) => {
              const urlOk =
                !item.searchUrlTemplate.trim() || isValidCustomDictionaryHomeUrl(item.searchUrlTemplate);
              return (
                <div
                  key={item.id}
                  className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start p-3 bg-slate-50 rounded-lg border border-slate-200"
                >
                  <div className="md:col-span-3 flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-500 shrink-0 pt-2">{index + 1}.</span>
                    <input
                      type="text"
                      placeholder="显示名称"
                      value={item.label}
                      onChange={(e) => {
                        const next = [...customOnlineDictionaries];
                        next[index] = { ...next[index], label: e.target.value };
                        onUpdateCustomOnlineDictionaries(next);
                      }}
                      className="flex-1 min-w-0 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
                    />
                  </div>
                  <div className="md:col-span-7">
                    <input
                      type="text"
                      placeholder="https://dict.youdao.com/"
                      value={item.searchUrlTemplate}
                      onChange={(e) => {
                        const next = [...customOnlineDictionaries];
                        next[index] = { ...next[index], searchUrlTemplate: e.target.value };
                        onUpdateCustomOnlineDictionaries(next);
                      }}
                      className={`w-full px-3 py-2 border rounded-lg text-sm font-mono focus:ring-2 outline-none ${
                        urlOk
                          ? 'border-slate-300 focus:ring-blue-500/20 focus:border-blue-500'
                          : 'border-red-300 focus:ring-red-500/20 focus:border-red-500'
                      }`}
                    />
                    {!urlOk && (
                      <p className="mt-1 text-xs text-red-600">
                        须为有效的 http(s) 网址
                      </p>
                    )}
                  </div>
                  <div className="md:col-span-2 flex flex-wrap justify-end gap-1">
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => {
                        if (index === 0) return;
                        const next = [...customOnlineDictionaries];
                        [next[index - 1], next[index]] = [next[index], next[index - 1]];
                        onUpdateCustomOnlineDictionaries(next);
                      }}
                      className="px-2 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                      title="上移"
                    >
                      上移
                    </button>
                    <button
                      type="button"
                      disabled={index >= customOnlineDictionaries.length - 1}
                      onClick={() => {
                        if (index >= customOnlineDictionaries.length - 1) return;
                        const next = [...customOnlineDictionaries];
                        [next[index], next[index + 1]] = [next[index + 1], next[index]];
                        onUpdateCustomOnlineDictionaries(next);
                      }}
                      className="px-2 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                      title="下移"
                    >
                      下移
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateCustomOnlineDictionaries(
                          customOnlineDictionaries.filter((_, i) => i !== index)
                        )
                      }
                      className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      title="删除"
                    >
                      <Icons.Trash className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}

            <button
              type="button"
              onClick={() => {
                const row: CustomOnlineDictionary = {
                  id: `cdict-${Date.now()}`,
                  label: '自定义词典',
                  searchUrlTemplate: '',
                };
                onUpdateCustomOnlineDictionaries([...customOnlineDictionaries, row]);
              }}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-slate-50 text-slate-600 hover:bg-slate-100 rounded-lg border border-dashed border-slate-300 transition-colors"
            >
              <Icons.Plus className="w-4 h-4" />
              <span className="text-sm font-medium">添加自定义词典</span>
            </button>
          </div>
        </section>
        )}

        {activePanel === 'favoriteUrls' && (
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 lg:p-6 min-w-0 flex flex-col max-h-[min(calc(100vh-14rem),48rem)] animate-in fade-in duration-200">
          <div className="flex flex-wrap items-start gap-3 mb-6 pb-4 border-b border-slate-100">
            <div className="p-2 bg-amber-100 text-amber-700 rounded-lg">
              <Icons.Bookmark className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold text-slate-900">收藏网址</h2>
              <p className="text-sm text-slate-500">
                在顶部栏点击「收藏」即可在新标签页打开。地址可写完整 URL，也可省略协议（将自动使用 https）。
                {saveSettingsHint('favorite-urls')}
              </p>
            </div>
            <div className="flex flex-col items-stretch sm:items-end gap-2 shrink-0">
              <button
                type="button"
                disabled={favSaving}
                onClick={() => {
                  void (async () => {
                    setFavSaving(true);
                    setFavSaveHint(null);
                    try {
                      await onSaveFavoriteUrls();
                      setFavSaveHint({ ok: true, text: savedToDatabaseMessage() });
                    } catch (e) {
                      setFavSaveHint({
                        ok: false,
                        text: e instanceof Error ? e.message : String(e)
                      });
                    } finally {
                      setFavSaving(false);
                    }
                  })();
                }}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                {favSaving ? (
                  <>
                    <Icons.Refresh className="w-4 h-4 animate-spin" />
                    保存中…
                  </>
                ) : (
                  <>
                    <Icons.Save className="w-4 h-4" />
                    保存到数据库
                  </>
                )}
              </button>
              {favSaveHint && (
                <p
                  className={`text-xs sm:text-right max-w-xs ${favSaveHint.ok ? 'text-green-700' : 'text-red-600'}`}
                >
                  {favSaveHint.text}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-4 flex-1 min-h-0 overflow-y-auto pr-1 -mr-1">
            {favoriteUrls.map((item, index) => (
              <div
                key={item.id}
                className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center p-3 bg-slate-50 rounded-lg border border-slate-200"
              >
                <div className="md:col-span-3 flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-500 shrink-0">{index + 1}.</span>
                  <input
                    type="text"
                    placeholder="显示名称"
                    value={item.label}
                    onChange={(e) => {
                      const next = [...favoriteUrls];
                      next[index] = { ...next[index], label: e.target.value };
                      onUpdateFavoriteUrls(next);
                    }}
                    className="flex-1 min-w-0 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none"
                  />
                </div>
                <div className="md:col-span-7">
                  <input
                    type="text"
                    placeholder="https:// 或 example.com"
                    value={item.url}
                    onChange={(e) => {
                      const next = [...favoriteUrls];
                      next[index] = { ...next[index], url: e.target.value };
                      onUpdateFavoriteUrls(next);
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none"
                  />
                </div>
                <div className="md:col-span-2 flex flex-wrap justify-end gap-1">
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => {
                      if (index === 0) return;
                      const next = [...favoriteUrls];
                      [next[index - 1], next[index]] = [next[index], next[index - 1]];
                      onUpdateFavoriteUrls(next);
                    }}
                    className="px-2 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                    title="上移"
                  >
                    上移
                  </button>
                  <button
                    type="button"
                    disabled={index >= favoriteUrls.length - 1}
                    onClick={() => {
                      if (index >= favoriteUrls.length - 1) return;
                      const next = [...favoriteUrls];
                      [next[index], next[index + 1]] = [next[index + 1], next[index]];
                      onUpdateFavoriteUrls(next);
                    }}
                    className="px-2 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                    title="下移"
                  >
                    下移
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateFavoriteUrls(favoriteUrls.filter((_, i) => i !== index))}
                    className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    title="删除"
                  >
                    <Icons.Trash className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={() => {
                const row: FavoriteUrl = {
                  id: `fav-${Date.now()}`,
                  label: '新收藏',
                  url: ''
                };
                onUpdateFavoriteUrls([...favoriteUrls, row]);
              }}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-slate-50 text-slate-600 hover:bg-slate-100 rounded-lg border border-dashed border-slate-300 transition-colors"
            >
              <Icons.Plus className="w-4 h-4" />
              <span className="text-sm font-medium">添加收藏网址</span>
            </button>
          </div>
        </section>
        )}
      </div>
    </div>
  );
};