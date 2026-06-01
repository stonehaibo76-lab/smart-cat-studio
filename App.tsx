import React, { useState, useEffect, useRef, useCallback, Component, lazy, Suspense } from 'react';
import { Layout } from './components/Layout';
import { WelcomeScreen, type WelcomeLaunchTarget } from './components/WelcomeScreen';
import { LoginPage } from './pages/Login';
import { HomePage } from './pages/Home';
import { Dashboard } from './pages/Dashboard';
import { Editor, type EditorLayoutMode } from './pages/Editor';
import { SettingsPage, type SettingsPanelId } from './pages/Settings';
import {
  twinStoredExampleCount,
  computeTwinSuggestionSuccessRate,
  computeTwinAverageConfidence
} from './services/twinTranslatorService';
import { OnlineDictionaryPage } from './pages/OnlineDictionary';
import { Project, Segment, TermBase, TranslationMemory, TermBaseEntry, TranslationMemoryUnit, AISettings, SegmentStatus, MatchType, QuickPrompt, FavoriteUrl, CustomOnlineDictionary, TwinTranslatorProfile, KnowledgeBase, EmbeddingSettings, DEFAULT_EMBEDDING_SETTINGS, GrammarRuleBook, RegexDictionaryBook, EditorQuickSymbol, PerformanceSettings } from './types';
import {
  APP_VERSION_METADATA,
  DEFAULT_EDITOR_QUICK_SYMBOLS,
  coerceEditorQuickSymbols,
} from './constants';
import * as db from './services/db';
import {
  applyPerformanceSettings,
  coercePerformanceSettings,
  DEFAULT_PERFORMANCE_SETTINGS,
} from './services/performanceRuntime';
import { fetchKnowledgeBases, fetchTwinTranslators } from './services/localBackendClient';
import {
  buildProjectFileFromParsed,
  type ParsedXliffProject,
} from './services/xliff/xliffImport';
import {
  exportSdlrpxPackage,
  exportXliffFilesFromProject,
  downloadBytes,
  type XliffFileExportFormat,
} from './services/xliff/xliffExport';
import { normalizeProjectsXliffMeta } from './services/xliff/projectXliffDetect';
import { shouldAutoLockSegmentAtImport } from './services/segmentAutoLock';
import {
  recomputeProjectProgressFields,
  segmentIsEffectivelyConfirmed,
} from './services/segmentEffectiveStatus';
import { Icons } from './components/ui/Icons';
import {
  fetchCurrentUser,
  getStoredUser,
  isAuthRequired,
  logout,
  type AuthUser,
} from './services/authService';
import { isCloudDeployment } from './services/deploymentMode';

const Resources = lazy(() => import('./pages/Resources').then((m) => ({ default: m.Resources })));
const Help = lazy(() => import('./pages/Help').then((m) => ({ default: m.Help })));
const TwinTranslatorsPage = lazy(() =>
  import('./pages/TwinTranslators').then((m) => ({ default: m.TwinTranslatorsPage }))
);
const KnowledgeBasesPage = lazy(() =>
  import('./pages/KnowledgeBases').then((m) => ({ default: m.KnowledgeBasesPage }))
);

type PersistedEditorSettings = {
  theme?: { sourceBg: string; targetBg: string };
  fontSize?: number | { main?: number; tm?: number; tb?: number; ai?: number };
  autoPropagate?: boolean;
  capitalizeTargetFirstLetterZhOut?: boolean;
  layoutMode?: string;
  quickSymbols?: unknown;
};

const PageFallback: React.FC = () => (
  <div className="flex h-full min-h-[200px] items-center justify-center text-slate-500 text-sm">
    加载中…
  </div>
);

// Error Boundary component
class ErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("React render error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-screen w-screen bg-red-50 p-6">
          <div className="max-w-md bg-white rounded-lg shadow-lg p-6">
            <div className="flex items-center gap-3 mb-4">
              <Icons.AlertTriangle className="w-8 h-8 text-red-500" />
              <h2 className="text-xl font-semibold text-slate-900">应用加载出错</h2>
            </div>
            <div className="text-sm text-slate-600 mb-4 bg-red-50 p-3 rounded">
              <pre className="whitespace-pre-wrap break-all">{this.state.error?.toString()}</pre>
            </div>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              重新加载应用
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Log entry interface for delete operations
interface DeleteLogEntry {
  id: string;
  timestamp: string;
  type: 'term' | 'tmUnit' | 'resource';
  resourceType: 'tb' | 'tm';
  resourceId: string;
  resourceName: string;
  itemId: string;
  itemContent: string;
}

function parseFavoriteUrls(raw: unknown): FavoriteUrl[] {
  if (!Array.isArray(raw)) return [];
  const out: FavoriteUrl[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o.id !== 'string' || typeof o.label !== 'string' || typeof o.url !== 'string') continue;
    out.push({ id: o.id, label: o.label, url: o.url });
  }
  return out;
}

function parseCustomOnlineDictionaries(raw: unknown): CustomOnlineDictionary[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomOnlineDictionary[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o.id !== 'string') continue;
    const label = typeof o.label === 'string' ? o.label : '';
    const searchUrlTemplate =
      typeof o.searchUrlTemplate === 'string'
        ? o.searchUrlTemplate
        : typeof o.url === 'string'
          ? o.url
          : '';
    out.push({ id: o.id, label, searchUrlTemplate });
  }
  return out;
}

function parseEditorResumeByProject(
  raw: unknown
): Record<string, { fileId: string; segmentId: string }> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, { fileId: string; segmentId: string }> = {};
  for (const [projectId, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!projectId || !v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    if (typeof o.fileId !== 'string' || typeof o.segmentId !== 'string') continue;
    out[projectId] = { fileId: o.fileId, segmentId: o.segmentId };
  }
  return out;
}

const EDITOR_PLACE_SESSION_PREFIX = 'smartcat-editor-place-v1:';

function readEditorPlaceFromSession(
  projectId: string
): { fileId: string; segmentId: string } | null {
  try {
    const raw = sessionStorage.getItem(EDITOR_PLACE_SESSION_PREFIX + projectId);
    if (!raw) return null;
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (typeof o.fileId !== 'string' || typeof o.segmentId !== 'string') return null;
    return { fileId: o.fileId, segmentId: o.segmentId };
  } catch {
    return null;
  }
}

function writeEditorPlaceToSession(projectId: string, fileId: string, segmentId: string) {
  try {
    sessionStorage.setItem(
      EDITOR_PLACE_SESSION_PREFIX + projectId,
      JSON.stringify({ fileId, segmentId })
    );
  } catch {
    /* ignore */
  }
}

/** 内存 map 与 session 合并读取（session 在卸载 flush 时同步写入，避免仅靠 React state 丢一拍） */
function getEditorResumeEntry(
  projectId: string,
  map: Record<string, { fileId: string; segmentId: string }>
): { fileId: string; segmentId: string } | null {
  const fromState = map[projectId];
  if (fromState) return fromState;
  return readEditorPlaceFromSession(projectId);
}

/** 根据上次编辑位置解析应打开的文件：句段仍在原文件则用之；否则在全项目内按句段 id 查找；再退回原文件或首个未完成/第一个 */
function resolveEditorResumeFileId(
  project: Project,
  resume: { fileId: string; segmentId: string }
): string {
  const files = project.files;
  if (!files.length) return '';
  const { fileId, segmentId } = resume;
  const bySavedFile = files.find((f) => f.id === fileId);
  if (bySavedFile?.segments.some((s) => s.id === segmentId)) return bySavedFile.id;
  for (const f of files) {
    if (f.segments.some((s) => s.id === segmentId)) return f.id;
  }
  if (bySavedFile) return bySavedFile.id;
  const incomplete = files.find((f) => f.progress < 100);
  return incomplete ? incomplete.id : files[0].id;
}

const App: React.FC = () => {
  const [authChecked, setAuthChecked] = useState(!isAuthRequired());
  const [authenticated, setAuthenticated] = useState(!isAuthRequired());
  const [authUser, setAuthUser] = useState<AuthUser | null>(getStoredUser());
  const [isLoading, setIsLoading] = useState(true);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false); // Global saving indicator
  const [activePage, setActivePage] = useState('home');
  const [settingsMountKey, setSettingsMountKey] = useState(0);
  const [settingsInitialPanel, setSettingsInitialPanel] = useState<SettingsPanelId | undefined>(undefined);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  /** 每个项目上次在编辑页停留的文件与句段，用于离开后再进入时恢复滚动位置 */
  const [editorResumeByProject, setEditorResumeByProject] = useState<
    Record<string, { fileId: string; segmentId: string }>
  >({});
  const editorResumeByProjectRef = useRef(editorResumeByProject);
  editorResumeByProjectRef.current = editorResumeByProject;
  /** 每次进入翻译编辑页递增，驱动 Editor 在 layout 阶段应用 resume，且不依赖 resumeSegmentId 依赖项误覆盖当前句 */
  const [editorResumeLayoutKey, setEditorResumeLayoutKey] = useState(0);
  const currentProjectIdRef = useRef<string | null>(null);
  currentProjectIdRef.current = currentProjectId;
  const [searchQuery, setSearchQuery] = useState('');
  
  // --- Editor Settings (Lifted Global State) ---
  const [editorTheme, setEditorTheme] = useState<{ sourceBg: string; targetBg: string }>({
      sourceBg: '#ffffff',
      targetBg: '#ffffff'
  });
  const [editorFontSizes, setEditorFontSizes] = useState<{
      main: number;
      tm: number;
      tb: number;
      ai: number;
  }>({
      main: 14,
      tm: 14,
      tb: 14,
      ai: 14
  });
  const [autoPropagate, setAutoPropagate] = useState<boolean>(true);
  /** 中译外项目：确认句段（回车或确认按钮）时将译文首字母大写 */
  const [capitalizeTargetFirstLetterZhOut, setCapitalizeTargetFirstLetterZhOut] = useState(false);
  const [editorLayoutMode, setEditorLayoutMode] = useState<EditorLayoutMode>('comparison');
  const [editorQuickSymbols, setEditorQuickSymbols] = useState<EditorQuickSymbol[]>(() =>
    DEFAULT_EDITOR_QUICK_SYMBOLS.map((e) => ({ ...e }))
  );

  // --- Global Data State ---
  const [aiSettings, setAiSettings] = useState<AISettings>({
      provider: 'gemini',
      model: 'gemini-3-flash-preview'
  });
  const [favoriteUrls, setFavoriteUrls] = useState<FavoriteUrl[]>([]);
  const [customOnlineDictionaries, setCustomOnlineDictionaries] = useState<CustomOnlineDictionary[]>([]);
  const [quickPrompts, setQuickPrompts] = useState<QuickPrompt[]>([
    { id: '1', label: '中译英', text: '请将以下内容翻译成英语：' },
    { id: '2', label: '英译中', text: '请将以下内容翻译成中文：' },
    { id: '3', label: '优化英语', text: '请优化以下英语表达：' },
    { id: '4', label: '优化中文', text: '请优化以下中文表达：' },
    { id: '5', label: '语法检查', text: '请检查以下内容的语法错误：' },
    { id: '6', label: '解释术语', text: '请解释以下术语：' }
  ]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [termBases, setTermBases] = useState<TermBase[]>([]);
  const [translationMemories, setTranslationMemories] = useState<TranslationMemory[]>([]);
  const [twinTranslators, setTwinTranslators] = useState<TwinTranslatorProfile[]>([]);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [grammarRuleBooks, setGrammarRuleBooks] = useState<GrammarRuleBook[]>([]);
  const [regexDictionaryBooks, setRegexDictionaryBooks] = useState<RegexDictionaryBook[]>([]);
  const [embeddingSettings, setEmbeddingSettings] = useState<EmbeddingSettings>(DEFAULT_EMBEDDING_SETTINGS);
  const [performanceSettings, setPerformanceSettings] = useState<PerformanceSettings>(
    DEFAULT_PERFORMANCE_SETTINGS
  );
  const [heavyCollectionsDeferred, setHeavyCollectionsDeferred] = useState(false);
  const [deleteLogs, setDeleteLogs] = useState<DeleteLogEntry[]>([]);
  const [showWelcome, setShowWelcome] = useState(true);

  /** 翻译编辑页注册：划选 / 当前句原文，供标题栏「在线词典」与 Ctrl+D 使用 */
  const dictionaryQueryResolverRef = useRef<(() => string) | null>(null);
  const editorDictionaryOpenerRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    applyPerformanceSettings(performanceSettings);
  }, [performanceSettings]);

  useEffect(() => {
    if (!isAuthRequired()) {
      setAuthChecked(true);
      setAuthenticated(true);
      return;
    }
    let cancelled = false;
    (async () => {
      const user = await fetchCurrentUser();
      if (cancelled) return;
      setAuthUser(user);
      setAuthenticated(Boolean(user));
      setAuthChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAuthSuccess = useCallback(() => {
    setAuthUser(getStoredUser());
    setAuthenticated(true);
  }, []);

  const handleLogout = useCallback(() => {
    logout();
    setAuthUser(null);
    setAuthenticated(false);
    window.location.reload();
  }, []);

  useEffect(() => {
    if (!heavyCollectionsDeferred) return;
    const needPage =
      activePage === 'editor' || activePage === 'twintranslators' || activePage === 'knowledge';
    if (!needPage) return;

    let cancelled = false;
    (async () => {
      try {
        const [twinsRaw, kbRaw] = await Promise.all([fetchTwinTranslators(), fetchKnowledgeBases()]);
        if (cancelled) return;
        const mappedTwins = (twinsRaw || []).map((t) => {
          const n = twinStoredExampleCount(t);
          const synced = { ...t, learnedSegments: n, trainingDataSize: n };
          const successRate = computeTwinSuggestionSuccessRate(synced);
          return {
            ...synced,
            successRate,
            averageConfidence: computeTwinAverageConfidence({ ...synced, successRate }),
          };
        });
        setTwinTranslators(mappedTwins);
        setKnowledgeBases(kbRaw || []);
        setHeavyCollectionsDeferred(false);
      } catch (e) {
        console.warn('[SmartCAT] 延迟加载孪生译员/知识库失败', e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activePage, heavyCollectionsDeferred]);

  // --- Initialization Effect ---
  useEffect(() => {
      if (!authChecked || !authenticated) return;
      const initializeData = async () => {
          try {
              setStartupError(null);
              console.log("开始初始化数据库...");
              const perfRaw = await db.loadSetting('performance-settings');
              const perf = coercePerformanceSettings(perfRaw);
              setPerformanceSettings(perf);
              applyPerformanceSettings(perf);
              setHeavyCollectionsDeferred(perf.lazyLoadHeavyCollections);

              const data = await db.loadAllData({
                omitHeavyCollections: perf.lazyLoadHeavyCollections,
              });
              console.log("数据加载成功:", { 
                projects: data.projects?.length, 
                termBases: data.termBases?.length,
                translationMemories: data.translationMemories?.length,
                twinTranslators: data.twinTranslators?.length,
                knowledgeBases: data.knowledgeBases?.length
              });
              
              setProjects(
                normalizeProjectsXliffMeta(data.projects || []).map(recomputeProjectProgressFields)
              );
              setTermBases(data.termBases || []);
              setTranslationMemories(data.translationMemories || []);
              setTwinTranslators(
                (data.twinTranslators || []).map((t) => {
                  const n = twinStoredExampleCount(t);
                  const synced = { ...t, learnedSegments: n, trainingDataSize: n };
                  const successRate = computeTwinSuggestionSuccessRate(synced);
                  return {
                    ...synced,
                    successRate,
                    averageConfidence: computeTwinAverageConfidence({ ...synced, successRate })
                  };
                })
              );
              setKnowledgeBases(data.knowledgeBases || []);
              setGrammarRuleBooks(data.grammarRuleBooks || []);
              setRegexDictionaryBooks(data.regexDictionaryBooks || []);
              setEmbeddingSettings({
                ...DEFAULT_EMBEDDING_SETTINGS,
                ...(data.embeddingSettings as EmbeddingSettings | null | undefined)
              });
              setAiSettings(
                (data.aiSettings ?? { provider: 'gemini', model: 'gemini-3-flash-preview' }) as AISettings
              );

              if (data.quickPrompts) {
                  setQuickPrompts(data.quickPrompts as QuickPrompt[]);
              }
              setFavoriteUrls(parseFavoriteUrls(data.favoriteUrls));
              setCustomOnlineDictionaries(parseCustomOnlineDictionaries(data.customOnlineDictionaries));

              if (data.editorSettings && typeof data.editorSettings === 'object') {
                  const editorSettings = data.editorSettings as PersistedEditorSettings;
                  setEditorTheme(editorSettings.theme || { sourceBg: '#ffffff', targetBg: '#ffffff' });
                  // Handle both old and new font size formats
                  if (typeof editorSettings.fontSize === 'number') {
                      // Old format: single font size
                      setEditorFontSizes({
                          main: editorSettings.fontSize || 14,
                          tm: editorSettings.fontSize || 14,
                          tb: editorSettings.fontSize || 14,
                          ai: editorSettings.fontSize || 14
                      });
                  } else {
                      // New format: separate font sizes for different areas
                      setEditorFontSizes({
                          main: editorSettings.fontSize?.main || 14,
                          tm: editorSettings.fontSize?.tm || 14,
                          tb: editorSettings.fontSize?.tb || 14,
                          ai: editorSettings.fontSize?.ai || 14
                      });
                  }
                  if (editorSettings.autoPropagate !== undefined) {
                      setAutoPropagate(editorSettings.autoPropagate);
                  }
                  const capZh = editorSettings.capitalizeTargetFirstLetterZhOut;
                  if (capZh !== undefined) {
                      setCapitalizeTargetFirstLetterZhOut(capZh);
                  }
                  const lm = editorSettings.layoutMode;
                  if (lm === 'comparison' || lm === 'focus') {
                      setEditorLayoutMode(lm);
                  }
                  const rawQs = editorSettings.quickSymbols;
                  if (rawQs !== undefined) {
                      setEditorQuickSymbols(coerceEditorQuickSymbols(rawQs));
                  }
              }
              try {
                const resumeRaw = await db.loadSetting('editor-resume-by-project');
                const parsed = parseEditorResumeByProject(resumeRaw);
                setEditorResumeByProject(parsed);
                for (const [pid, place] of Object.entries(parsed)) {
                  writeEditorPlaceToSession(pid, place.fileId, place.segmentId);
                }
              } catch {
                /* ignore */
              }
              setShowWelcome(!data.skipStartupScreen);
              console.log("数据初始化完成");
          } catch (error) {
              console.error("Failed to initialize database:", error);
              setStartupError(error instanceof Error ? error.message : String(error));
          } finally {
              setIsLoading(false);
          }
      };
      initializeData();
  }, [authChecked, authenticated]);

  // --- Persistence Effects (Debounced) ---
  
  // Smart debounce save hook: Skips the first run (load from DB) and tracks isSaving state.
  // saveBlocked: while true, do not save and do not consume the "initial skip" (e.g. 启动时延迟加载
  // 时内存里先是空数组）。否则在 React.StrictMode 下 effect 会跑两次：第一次把 ref 标成已挂载并
  // return，第二次会把空数组 PUT 到 SQLite，覆盖孪生译员/知识库。
  const useDebounceSave = <T,>(
    value: T,
    saveFn: (val: T) => Promise<void>,
    delay: number = 800,
    saveBlocked: boolean = false
  ) => {
      const isMounted = useRef(false);
      
      useEffect(() => {
          if (isLoading || saveBlocked) return;
          
          // Skip the very first effect run after loading, so we don't save what we just loaded
          if (!isMounted.current) {
              isMounted.current = true;
              return;
          }

          setIsSaving(true);
          const handler = setTimeout(async () => {
              try {
                  await saveFn(value);
              } catch (e) {
                  console.error("Auto-save failed", e);
              } finally {
                  setIsSaving(false);
              }
          }, delay);
          
          return () => clearTimeout(handler);
      }, [value, isLoading, saveBlocked]);
  };

  useDebounceSave(projects, db.saveProjects, 1000);
  useDebounceSave(termBases, db.saveTermBases, 1000);
  useDebounceSave(translationMemories, db.saveTMs, 1000);
  useDebounceSave(twinTranslators, db.saveTwinTranslators, 1000, heavyCollectionsDeferred);
  useDebounceSave(knowledgeBases, db.saveKnowledgeBases, 1000, heavyCollectionsDeferred);
  useDebounceSave(grammarRuleBooks, db.saveGrammarRuleBooks, 1000);
  useDebounceSave(regexDictionaryBooks, db.saveRegexDictionaryBooks, 1000);

  const grammarRuleBooksRef = useRef(grammarRuleBooks);
  const regexDictionaryBooksRef = useRef(regexDictionaryBooks);
  grammarRuleBooksRef.current = grammarRuleBooks;
  regexDictionaryBooksRef.current = regexDictionaryBooks;

  useEffect(() => {
    if (isLoading) return;
    const flushGrammarAndRegex = () => {
      Promise.all([
        db.saveGrammarRuleBooks(grammarRuleBooksRef.current),
        db.saveRegexDictionaryBooks(regexDictionaryBooksRef.current),
      ]).catch((e) => console.warn('[SmartCAT] 关闭页面前保存规则/正则词典失败', e));
    };
    window.addEventListener('pagehide', flushGrammarAndRegex);
    return () => window.removeEventListener('pagehide', flushGrammarAndRegex);
  }, [isLoading]);
  useDebounceSave(embeddingSettings, (val) => db.saveSettings('embedding-settings', val), 500);
  useDebounceSave(performanceSettings, (val) => db.saveSettings('performance-settings', val), 500);
  
  // Save settings with shorter delay
  useDebounceSave(aiSettings, (val) => db.saveSettings('ai-settings', val), 500);
  useDebounceSave(quickPrompts, (val) => db.saveSettings('quick-prompts', val), 500);
  
  const editorSettings = {
    theme: editorTheme,
    fontSize: editorFontSizes,
    autoPropagate,
    capitalizeTargetFirstLetterZhOut,
    layoutMode: editorLayoutMode,
    quickSymbols: editorQuickSymbols,
  };
  useDebounceSave(editorSettings, (val) => db.saveSettings('editor-settings', val), 500);
  useDebounceSave(editorResumeByProject, (val) => db.saveSettings('editor-resume-by-project', val), 500);

  const saveFavoriteUrlsToDb = useCallback(async () => {
    await db.saveSettings('favorite-urls', favoriteUrls);
  }, [favoriteUrls]);

  const saveCustomOnlineDictionariesToDb = useCallback(async () => {
    await db.saveSettings('custom-online-dictionaries', customOnlineDictionaries);
  }, [customOnlineDictionaries]);

  const handleEditorPlaceChange = useCallback(
    (place: { fileId: string; segmentId: string; projectId?: string } | null) => {
      if (!place) return;
      const pid = place.projectId ?? currentProjectIdRef.current;
      if (!pid) return;
      const { fileId, segmentId } = place;
      writeEditorPlaceToSession(pid, fileId, segmentId);
      setEditorResumeByProject((prev) => ({ ...prev, [pid]: { fileId, segmentId } }));
    },
    []
  );

  // --- Navigation ---
  const handleNavigate = (page: string, opts?: { settingsPanel?: SettingsPanelId }) => {
    setActivePage(page);
    setSearchQuery('');
    if (page === 'settings') {
      setSettingsInitialPanel(opts?.settingsPanel);
      setSettingsMountKey((k) => k + 1);
    }
    if (page === 'home' || page === 'dashboard') {
        setCurrentProjectId(null);
        setActiveFileId(null);
    }
    if (page === 'editor') {
      setEditorResumeLayoutKey((k) => k + 1);
      const pid = currentProjectId;
      if (pid) {
        const project = projects.find((p) => p.id === pid);
        const saved = getEditorResumeEntry(pid, editorResumeByProjectRef.current);
        if (project?.files?.length && saved) {
          setActiveFileId(resolveEditorResumeFileId(project, saved));
        }
      }
    }
  };

  const openOnlineDictionaryPage = useCallback(() => {
    if (activePage === 'editor' && editorDictionaryOpenerRef.current) {
      editorDictionaryOpenerRef.current();
      return;
    }
    setActivePage('dictionary');
    setSearchQuery('');
  }, [activePage]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key.toLowerCase() !== 'd') return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (showWelcome || isLoading || startupError) return;
      e.preventDefault();
      openOnlineDictionaryPage();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [openOnlineDictionaryPage, showWelcome, isLoading, startupError]);

  const launchFromWelcome = useCallback(async (target: WelcomeLaunchTarget, skipNextStartup: boolean) => {
    if (skipNextStartup) {
      try {
        await db.saveSettings('skip-startup-screen', true);
      } catch (e) {
        console.error('保存启动页跳过偏好失败', e);
      }
    }
    setShowWelcome(false);
    setActivePage(target);
    setSearchQuery('');
    if (target === 'home' || target === 'dashboard') {
      setCurrentProjectId(null);
      setActiveFileId(null);
    }
  }, []);

  // --- Project Management ---
  const handleOpenProject = (id: string) => {
    setCurrentProjectId(id);
    const project = projects.find(p => p.id === id);
    if (project && project.files.length > 0) {
        const saved = getEditorResumeEntry(id, editorResumeByProject);
        if (saved) {
          setActiveFileId(resolveEditorResumeFileId(project, saved));
        } else {
          const incompleteFile = project.files.find((f) => f.progress < 100);
          setActiveFileId(incompleteFile ? incompleteFile.id : project.files[0].id);
        }
    } else {
        setActiveFileId(null);
    }
    setEditorResumeLayoutKey((k) => k + 1);
    setActivePage('editor');
  };

  const handleCreateProject = (newProject: Project, newTM?: TranslationMemory, newTB?: TermBase) => {
      if (newTM) setTranslationMemories(prev => [...prev, newTM]);
      if (newTB) setTermBases(prev => [...prev, newTB]);
      setProjects((prev) => [
        recomputeProjectProgressFields(normalizeProjectsXliffMeta([newProject])[0]),
        ...prev,
      ]);
  };

  const handleDeleteProject = (id: string) => {
      setProjects(prev => prev.filter(p => p.id !== id));
  };

  // Add File to Existing Project
  const handleAddFileToProject = (
    projectId: string,
    fileName: string,
    content: string,
    isExcel: boolean = false,
    excelSegments?: Array<{ source: string; target?: string }>,
    xliffProject?: ParsedXliffProject
  ) => {
      setProjects(prev => prev.map(p => {
          if (p.id === projectId) {
              if (xliffProject) {
                const startIdx = p.files.length;
                const newFiles = xliffProject.files.map((pf, i) =>
                  buildProjectFileFromParsed(pf, startIdx + i, xliffProject.sourceLang || p.sourceLang)
                );
                const updatedFiles = [...p.files, ...newFiles];
                let totalSegs = 0;
                let totalConfirmed = 0;
                updatedFiles.forEach((f) => {
                  totalSegs += f.totalSegments;
                  totalConfirmed += f.segments.filter(segmentIsEffectivelyConfirmed).length;
                });
                const aggProgress = totalSegs > 0 ? Math.round((totalConfirmed / totalSegs) * 100) : 0;
                return {
                  ...p,
                  files: updatedFiles,
                  totalSegments: totalSegs,
                  progress: aggProgress,
                  sourceLang: xliffProject.sourceLang || p.sourceLang,
                  targetLang: xliffProject.targetLang || p.targetLang,
                  tradosPackage: xliffProject.tradosPackage ?? p.tradosPackage,
                };
              }

              const fileIdx = p.files.length;
              let segs: Segment[];

              if (isExcel && excelSegments) {
                  // 处理Excel文件：使用segments数据
                  segs = excelSegments.map((item, index) => {
                      const text = item.source.trim();
                      const translation = item.target ? item.target.trim() : '';

                      let isLocked = false;
                      let targetText = '';
                      let status = SegmentStatus.NotStarted;

                      // 如果Excel中有翻译内容，使用它
                      if (translation && translation !== text) {
                          targetText = translation;
                          status = SegmentStatus.Draft;
                      }

                      isLocked = shouldAutoLockSegmentAtImport(text, p.sourceLang);

                      // 如果已锁定，使用原文作为译文
                      if (isLocked) {
                          targetText = text;
                          status = SegmentStatus.Confirmed;
                      }

                      return {
                          id: `s-${Date.now()}-${fileIdx}-${index}`,
                          sourceText: text,
                          targetText: targetText,
                          status: status,
                          matchType: MatchType.None,
                          isLocked: isLocked
                      };
                  });
              } else {
                  // 处理文本文件（txt, docx）
                  segs = content
                    .split(/\r?\n/)
                    .map(line => line.trim())
                    .filter(line => line.length > 0)
                    .map((line, index) => {
                        let isLocked = false;
                        const text = line.trim();

                        isLocked = shouldAutoLockSegmentAtImport(text, p.sourceLang);

                        return {
                            id: `s-${Date.now()}-${fileIdx}-${index}`,
                            sourceText: line,
                            targetText: isLocked ? line : '',
                            status: isLocked ? SegmentStatus.Confirmed : SegmentStatus.NotStarted,
                            matchType: MatchType.None,
                            isLocked: isLocked
                        };
                    });
              }

              const newFileCompleted = segs.filter(segmentIsEffectivelyConfirmed).length;
              const newFile = {
                  id: `f-${Date.now()}-${fileIdx}`,
                  name: fileName,
                  segments: segs,
                  totalSegments: segs.length,
                  progress:
                      segs.length > 0 ? Math.round((newFileCompleted / segs.length) * 100) : 0,
              };

              const updatedFiles = [...p.files, newFile];
              let totalSegs = 0;
              let totalConfirmed = 0;
              updatedFiles.forEach(f => {
                 totalSegs += f.totalSegments;
                 totalConfirmed += f.segments.filter(segmentIsEffectivelyConfirmed).length;
              });
              const aggProgress = totalSegs > 0 ? Math.round((totalConfirmed / totalSegs) * 100) : 0;

              return { ...p, files: updatedFiles, totalSegments: totalSegs, progress: aggProgress };
          }
          return p;
      }));
  };

  const handleDeleteFileFromProject = (projectId: string, fileId: string) => {
    setProjects(prev => prev.map(p => {
        if (p.id === projectId) {
            const updatedFiles = p.files.filter(f => f.id !== fileId);
             let totalSegs = 0;
             let totalConfirmed = 0;
             updatedFiles.forEach(f => {
                 totalSegs += f.totalSegments;
                 totalConfirmed += f.segments.filter(segmentIsEffectivelyConfirmed).length;
             });
             const aggProgress = totalSegs > 0 ? Math.round((totalConfirmed / totalSegs) * 100) : 0;
             return { ...p, files: updatedFiles, totalSegments: totalSegs, progress: aggProgress };
        }
        return p;
    }));
  };

  const handleUpdateMultipleFileSegments = (updates: { fileId: string; segments: Segment[] }[]) => {
      if (!currentProjectId || updates.length === 0) return;

      const byFileId = new Map(updates.map((u) => [u.fileId, u.segments]));

      setProjects((prev) =>
          prev.map((p) => {
              if (p.id !== currentProjectId) return p;

              const updatedFiles = p.files.map((f) => {
                  const newSegs = byFileId.get(f.id);
                  if (!newSegs) return f;
                  const completed = newSegs.filter(segmentIsEffectivelyConfirmed).length;
                  const total = newSegs.length;
                  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
                  return { ...f, segments: newSegs, progress, totalSegments: total };
              });

              let totalSegs = 0;
              let totalConfirmed = 0;
              updatedFiles.forEach((f) => {
                  totalSegs += f.totalSegments;
                  totalConfirmed += f.segments.filter(segmentIsEffectivelyConfirmed).length;
              });

              const aggProgress =
                  totalSegs > 0 ? Math.round((totalConfirmed / totalSegs) * 100) : 0;
              return { ...p, files: updatedFiles, progress: aggProgress, totalSegments: totalSegs };
          })
      );
  };

  const handleUpdateFileSegments = (fileId: string, updatedSegments: Segment[]) => {
      handleUpdateMultipleFileSegments([{ fileId, segments: updatedSegments }]);
  };

  const handleAddToProjectTM = (projectId: string, unit: TranslationMemoryUnit) => {
      const project = projects.find(p => p.id === projectId);
      if (!project || !project.mainTmId) return;

      setTranslationMemories(prev => prev.map(tm => {
          if (tm.id === project.mainTmId) {
              const exists = tm.units.find(u => u.source === unit.source);
              if (exists) {
                  const updatedUnits = tm.units.map(u => 
                      u.id === exists.id 
                          ? { ...u, target: unit.target, usageCount: u.usageCount + 1, lastUsed: unit.lastUsed } 
                          : u
                  );
                  return { ...tm, units: updatedUnits };
              }
              return { ...tm, units: [unit, ...tm.units] };
          }
          return tm;
      }));
  };

  const handleAddTermToTB = (tbId: string, term: TermBaseEntry) => {
      setTermBases(prev => prev.map(tb => tb.id === tbId ? { ...tb, entries: [term, ...tb.entries] } : tb));
  };

  const handleUpdateTermInTB = (tbId: string, term: TermBaseEntry) => {
      setTermBases(prev => prev.map(tb => tb.id === tbId ? { 
          ...tb, 
          entries: tb.entries.map(e => e.id === term.id ? term : e)
      } : tb));
  };
  
  const handleDeleteTermInTB = (tbId: string, termId: string) => {
      setTermBases(prev => {
          const tbIndex = prev.findIndex(tb => tb.id === tbId);
          if (tbIndex === -1) return prev;
          
          const tb = prev[tbIndex];
          const termToDelete = tb.entries.find(e => e.id === termId);
          if (termToDelete) {
              // Log the deletion
              const logEntry: DeleteLogEntry = {
                  id: `log-${Date.now()}`,
                  timestamp: new Date().toISOString(),
                  type: 'term',
                  resourceType: 'tb',
                  resourceId: tbId,
                  resourceName: tb.name,
                  itemId: termId,
                  itemContent: termToDelete.source
              };
              setDeleteLogs(prevLogs => [logEntry, ...prevLogs]);
          }
          
          return prev.map(tb => tb.id === tbId ? { 
              ...tb, 
              entries: tb.entries.filter(e => e.id !== termId)
          } : tb);
      });
  };

  const handleDeleteTMUnit = (tmId: string, unitId: string) => {
      setTranslationMemories(prev => {
          const tmIndex = prev.findIndex(tm => tm.id === tmId);
          if (tmIndex === -1) return prev;
          
          const tm = prev[tmIndex];
          const unitToDelete = tm.units.find(u => u.id === unitId);
          if (unitToDelete) {
              // Log the deletion
              const logEntry: DeleteLogEntry = {
                  id: `log-${Date.now()}`,
                  timestamp: new Date().toISOString(),
                  type: 'tmUnit',
                  resourceType: 'tm',
                  resourceId: tmId,
                  resourceName: tm.name,
                  itemId: unitId,
                  itemContent: unitToDelete.source
              };
              setDeleteLogs(prevLogs => [logEntry, ...prevLogs]);
          }
          
          return prev.map(tm => tm.id === tmId ? { 
              ...tm, 
              units: tm.units.filter(u => u.id !== unitId)
          } : tm);
      });
  };

  const handleAddTMUnit = (tmId: string, unit: TranslationMemoryUnit) => {
      setTranslationMemories(prev => prev.map(tm => tm.id === tmId ? { 
          ...tm, 
          units: [unit, ...tm.units]
      } : tm));
  };

  const handleUpdateTMUnit = (tmId: string, unit: TranslationMemoryUnit) => {
      setTranslationMemories(prev => prev.map(tm => tm.id === tmId ? { 
          ...tm, 
          units: tm.units.map(u => u.id === unit.id ? unit : u)
      } : tm));
  };

  const handleTradosQuickExport = async (
    projectId: string,
    kind: 'sdlxliff' | 'sdlrpx'
  ) => {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;
    try {
      if (kind === 'sdlrpx') {
        const { bytes, fileName } = await exportSdlrpxPackage(project);
        downloadBytes(bytes, fileName, 'application/zip');
        alert(`已导出 Trados 回传包：${fileName}`);
        return;
      }
      const names = await exportXliffFilesFromProject(project, 'sdlxliff', 'project');
      alert(
        names.length === 1
          ? `已导出 SDLXLIFF：${names[0]}`
          : `已导出 ${names.length} 个 SDLXLIFF 文件`
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : '导出失败');
    }
  };

  // 导出当前文件功能
  const handleExportFile = async (options: {
    format: 'excel' | 'tmx' | 'sdlxliff' | 'mqxliff' | 'sdlrpx';
    onlyConfirmed: boolean;
    exportType?: 'all' | 'unlockedSource' | 'unlockedSourceTarget' | 'untranslated' | 'confirmed';
    exportScope?: 'currentFile' | 'project';
    sourceTargetOnly?: boolean;
  }) => {
    if (!activeProject) return;

    const activeFile = activeProject.files.find(f => f.id === activeFileId) || activeProject.files[0];
    if (!activeFile) return;

    if (options.format === 'sdlrpx') {
      try {
        const { bytes, fileName } = await exportSdlrpxPackage(activeProject);
        downloadBytes(bytes, fileName, 'application/zip');
        alert(`已导出 Trados 回传包：${fileName}\n请在 Trados Studio 中「导入返回包」完成交稿。`);
      } catch (e) {
        alert(e instanceof Error ? e.message : '导出 SDLRPX 失败');
      }
      return;
    }

    if (options.format === 'sdlxliff' || options.format === 'mqxliff') {
      try {
        const names = await exportXliffFilesFromProject(
          activeProject,
          options.format as XliffFileExportFormat,
          options.exportScope ?? 'currentFile',
          activeFileId
        );
        const label = options.format === 'sdlxliff' ? 'SDLXLIFF' : 'MQXLIFF';
        alert(
          names.length === 1
            ? `已导出 ${label}：${names[0]}`
            : `已导出 ${names.length} 个 ${label} 文件`
        );
      } catch (e) {
        alert(e instanceof Error ? e.message : '导出 XLIFF 失败');
      }
      return;
    }

    const exportType = options.exportType || 'all';
    const exportScope = options.exportScope || 'currentFile';
    const sourceTargetOnly = options.sourceTargetOnly || false;
    const filesToExport = exportScope === 'project' ? activeProject.files : [activeFile];
    const allSegments = filesToExport.flatMap(file =>
      file.segments.map(segment => ({
        ...segment,
        __fileName: file.name
      }))
    );

    // 根据导出类型过滤句段
    let filteredSegments;
    if (exportType === 'unlockedSource') {
      // 导出未锁定原文
      filteredSegments = allSegments.filter(segment => !segment.isLocked);
    } else if (exportType === 'unlockedSourceTarget') {
      // 导出未锁定原文和译文
      filteredSegments = allSegments.filter(segment => !segment.isLocked);
    } else if (exportType === 'untranslated') {
      // 导出未翻译且未锁定的句段
      filteredSegments = allSegments.filter(segment => !segment.isLocked && (!segment.targetText || segment.targetText.trim() === ''));
    } else if (exportType === 'confirmed') {
      // 导出已确认句段原文和译文
      filteredSegments = allSegments.filter(segment => segment.status === 'Confirmed');
    } else {
      // 原有逻辑：全部或仅已确认
      filteredSegments = options.onlyConfirmed
        ? allSegments.filter(segment => segment.status === 'Confirmed')
        : allSegments;
    }

    if (options.format === 'excel') {
      // 动态导入xlsx库，避免初始加载时的性能问题
      import('xlsx').then(XLSX => {
        // 准备导出数据
        let exportData;

        if (sourceTargetOnly) {
          exportData = filteredSegments.map(segment => ({
            '原文': segment.sourceText,
            '译文': segment.targetText
          }));
        } else if (exportType === 'unlockedSource') {
          // 只导出原文
          exportData = filteredSegments.map((segment, index) => {
            const row: Record<string, string | number> = {
              '序号': index + 1,
              '原文': segment.sourceText,
              '状态': segment.status === 'Confirmed' ? '已确认' : segment.status === 'Translated' ? '已翻译' : '未开始',
              '匹配类型': segment.matchType === 'Exact' ? '精确匹配' : segment.matchType === 'Fuzzy' ? '模糊匹配' : segment.matchType === 'AI' ? 'AI翻译' : '无匹配'
            };
            if (exportScope === 'project') {
              row['文件'] = segment.__fileName;
            }
            return row;
          });
        } else {
          // 导出原文和译文
          exportData = filteredSegments.map((segment, index) => {
            const row: Record<string, string | number> = {
              '序号': index + 1,
              '原文': segment.sourceText,
              '译文': segment.targetText,
              '状态': segment.status === 'Confirmed' ? '已确认' : segment.status === 'Translated' ? '已翻译' : '未开始',
              '匹配类型': segment.matchType === 'Exact' ? '精确匹配' : segment.matchType === 'Fuzzy' ? '模糊匹配' : segment.matchType === 'AI' ? 'AI翻译' : '无匹配'
            };
            if (exportScope === 'project') {
              row['文件'] = segment.__fileName;
            }
            return row;
          });
        }

        // 创建工作簿和工作表
        const worksheet = XLSX.utils.json_to_sheet(exportData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, exportScope === 'project' ? "项目翻译内容" : "翻译内容");

        // 导出为Excel文件
        const suffix = exportType === 'unlockedSource' ? '_未锁定原文' :
                       exportType === 'unlockedSourceTarget' ? '_未锁定原文译文' :
                       exportType === 'untranslated' ? '_未翻译句段' :
                       exportType === 'confirmed' ? '_已确认句段' :
                       options.onlyConfirmed ? '_已确认' : '';
        const scopeName = exportScope === 'project' ? `${activeProject.name}_整个项目` : activeFile.name;
        const fileName = `${scopeName}${suffix}_导出.xlsx`;
        XLSX.writeFile(workbook, fileName);
      });
    } else if (options.format === 'tmx') {
      // 导出为TMX文件
      const tmxContent = generateTMX(filteredSegments, activeProject);

      // 创建并下载TMX文件
      const blob = new Blob([tmxContent], { type: 'application/xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const suffix = exportType === 'unlockedSource' ? '_未锁定原文' :
                     exportType === 'unlockedSourceTarget' ? '_未锁定原文译文' :
                     exportType === 'untranslated' ? '_未翻译句段' :
                     exportType === 'confirmed' ? '_已确认句段' :
                     options.onlyConfirmed ? '_已确认' : '';
      const scopeName = exportScope === 'project' ? `${activeProject.name}_整个项目` : activeFile.name;
      a.download = `${scopeName}${suffix}_导出.tmx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  // 生成TMX文件内容
  const generateTMX = (segments: any[], project: any) => {
    // 提取语言代码（去掉国家代码部分，如 en-US -> en）
    const sourceLang = project.sourceLang.split('-')[0];
    const targetLang = project.targetLang.split('-')[0];
    
    // 生成TMX文件内容
    const tmxContent = `<?xml version="1.0" encoding="UTF-8"?>
<tmx version="1.4">
  <header
    creationtool="Smart-CAT Studio"
    creationtoolversion="${APP_VERSION_METADATA}"
    segtype="sentence"
    o-tmf="unknown"
    adminlang="en"
    srclang="${sourceLang}"
    datatype="plaintext">
  </header>
  <body>
    ${segments.map(segment => `
    <tu>
      <tuv xml:lang="${sourceLang}">
        <seg>${escapeXml(segment.sourceText)}</seg>
      </tuv>
      <tuv xml:lang="${targetLang}">
        <seg>${escapeXml(segment.targetText)}</seg>
      </tuv>
    </tu>`).join('')}
  </body>
</tmx>`;
    
    return tmxContent;
  };

  // XML转义函数
  const escapeXml = (str: string) => {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  };

  const handleImportResource = (type: 'tm' | 'tb', resource: any) => {
      if (type === 'tm') {
          setTranslationMemories(prev => {
              const existingIndex = prev.findIndex(tm => tm.id === resource.id);
              if (existingIndex >= 0) {
                  // Update existing TM
                  const updated = [...prev];
                  updated[existingIndex] = resource;
                  return updated;
              } else {
                  // Add new TM
                  return [...prev, resource];
              }
          });
      } else {
          setTermBases(prev => {
              const existingIndex = prev.findIndex(tb => tb.id === resource.id);
              if (existingIndex >= 0) {
                  // Update existing TB
                  const updated = [...prev];
                  updated[existingIndex] = resource;
                  return updated;
              } else {
                  // Add new TB
                  return [...prev, resource];
              }
          });
      }
  };

  const handleDeleteResource = (type: 'tm' | 'tb' | 'gr' | 'rx', id: string) => {
      if (type === 'gr') {
          setGrammarRuleBooks((prev) => prev.filter((b) => b.id !== id));
          setProjects((prev) =>
              prev.map((p) => ({
                  ...p,
                  grammarRuleBookIds: (p.grammarRuleBookIds ?? []).filter((gid) => gid !== id),
              }))
          );
          return;
      }
      if (type === 'rx') {
          setRegexDictionaryBooks((prev) => prev.filter((b) => b.id !== id));
          setProjects((prev) =>
              prev.map((p) => ({
                  ...p,
                  regexDictionaryBookIds: (p.regexDictionaryBookIds ?? []).filter((rid) => rid !== id),
              }))
          );
          return;
      }
      if (type === 'tm') {
          setTranslationMemories(prev => {
              const tmToDelete = prev.find(tm => tm.id === id);
              if (tmToDelete) {
                  // Log the deletion of the entire TM
                  const logEntry: DeleteLogEntry = {
                      id: `log-${Date.now()}`,
                      timestamp: new Date().toISOString(),
                      type: 'resource',
                      resourceType: 'tm',
                      resourceId: id,
                      resourceName: tmToDelete.name,
                      itemId: id,
                      itemContent: `${tmToDelete.name} (${tmToDelete.units.length} entries)`
                  };
                  setDeleteLogs(prevLogs => [logEntry, ...prevLogs]);
              }
              return prev.filter(tm => tm.id !== id);
          });
      } else {
          setTermBases(prev => {
              const tbToDelete = prev.find(tb => tb.id === id);
              if (tbToDelete) {
                  // Log the deletion of the entire TB
                  const logEntry: DeleteLogEntry = {
                      id: `log-${Date.now()}`,
                      timestamp: new Date().toISOString(),
                      type: 'resource',
                      resourceType: 'tb',
                      resourceId: id,
                      resourceName: tbToDelete.name,
                      itemId: id,
                      itemContent: `${tbToDelete.name} (${tbToDelete.entries.length} entries)`
                  };
                  setDeleteLogs(prevLogs => [logEntry, ...prevLogs]);
              }
              return prev.filter(tb => tb.id !== id);
          });
      }
  };

  const handleUpdateProject = (updatedProject: Project) => {
      setProjects((prev) =>
          prev.map((p) =>
              p.id === updatedProject.id ? recomputeProjectProgressFields(updatedProject) : p
          )
      );
  };

  const activeProject = projects.find(p => p.id === currentProjectId) || null;

  const renderContent = () => {
    switch (activePage) {
      case 'home':
        return (
          <HomePage
            projects={projects}
            onNavigate={(page) => handleNavigate(page)}
            onOpenProject={handleOpenProject}
          />
        );
      case 'dashboard':
        return (
            <Dashboard 
                projects={projects} 
                availableTMs={translationMemories}
                availableTBs={termBases}
                availableGrammarRuleBooks={grammarRuleBooks}
                availableRegexDictionaryBooks={regexDictionaryBooks}
                onOpenProject={handleOpenProject} 
                onCreateProject={handleCreateProject}
                onAddFileToProject={handleAddFileToProject}
                onDeleteFileFromProject={handleDeleteFileFromProject}
                onDeleteProject={handleDeleteProject}
                onUpdateProject={handleUpdateProject}
                searchQuery={searchQuery}
                onTradosQuickExport={handleTradosQuickExport}
            />
        );
      case 'editor':
        const mainTM = translationMemories.find(tm => tm.id === activeProject?.mainTmId);
        const auxiliaryTMs = translationMemories.filter(tm => activeProject?.tmIds?.includes(tm.id) && tm.id !== activeProject?.mainTmId);

        const mainTB = termBases.find(tb => tb.id === activeProject?.mainTbId);
        const auxiliaryTBs = termBases.filter(tb => activeProject?.tbIds?.includes(tb.id) && tb.id !== activeProject?.mainTbId);
        
        // 勿依赖 activeProject：否则 projects 尚未与 currentProjectId 对齐的一帧会传 null，导致永远无法按 resume 跳句
        const resumeEntry =
          currentProjectId != null
            ? getEditorResumeEntry(currentProjectId, editorResumeByProject)
            : null;
        const resumeSegmentId = resumeEntry?.segmentId ?? null;

        return (
            <Editor 
                project={activeProject} 
                activeFileId={activeFileId} 
                onActiveFileChange={setActiveFileId}
                resumeSegmentId={resumeSegmentId}
                resumeLayoutKey={editorResumeLayoutKey}
                onEditorPlaceChange={handleEditorPlaceChange}
                onUpdateFileSegments={handleUpdateFileSegments}
                onUpdateMultipleFileSegments={handleUpdateMultipleFileSegments}
                mainTB={mainTB}
                auxiliaryTBs={auxiliaryTBs}
                mainTM={mainTM}
                auxiliaryTMs={auxiliaryTMs}
                onAddTM={(unit) => activeProject && handleAddToProjectTM(activeProject.id, unit)}
                onAddTerm={(tbId, term) => handleAddTermToTB(tbId, term)}
                onUpdateTerm={handleUpdateTermInTB}
                onDeleteTerm={handleDeleteTermInTB}
                editorTheme={editorTheme}
                onUpdateEditorTheme={setEditorTheme}
                editorFontSize={editorFontSizes}
                onUpdateEditorFontSize={setEditorFontSizes}
                autoPropagate={autoPropagate}
                onUpdateAutoPropagate={setAutoPropagate}
                capitalizeTargetFirstLetterZhOut={capitalizeTargetFirstLetterZhOut}
                editorLayoutMode={editorLayoutMode}
                onUpdateEditorLayoutMode={setEditorLayoutMode}
                editorQuickSymbols={editorQuickSymbols}
                onUpdateEditorQuickSymbols={setEditorQuickSymbols}
                aiSettings={aiSettings} 
                quickPrompts={quickPrompts}
                twinTranslators={twinTranslators}
                onTwinTranslatorsChange={setTwinTranslators}
                onNavigateToTwinTranslators={() => handleNavigate('twintranslators')}
                knowledgeBases={knowledgeBases}
                onKnowledgeBasesChange={setKnowledgeBases}
                embeddingSettings={embeddingSettings}
                grammarRuleBooks={grammarRuleBooks}
                regexDictionaryBooks={regexDictionaryBooks}
                dictionaryQueryResolverRef={dictionaryQueryResolverRef}
                editorDictionaryOpenerRef={editorDictionaryOpenerRef}
                customOnlineDictionaries={customOnlineDictionaries}
                reduceVisualEffects={performanceSettings.performanceMode}
            />
        );
      case 'resources':
          return (
            <Suspense fallback={<PageFallback />}>
              <Resources 
                termBases={termBases}
                translationMemories={translationMemories}
                onAddTerm={handleAddTermToTB}
                onUpdateTerm={handleUpdateTermInTB}
                onDeleteTerm={handleDeleteTermInTB}
                onAddTMUnit={handleAddTMUnit}
                onUpdateTMUnit={handleUpdateTMUnit}
                onDeleteTMUnit={handleDeleteTMUnit}
                onImportResource={handleImportResource}
                onDeleteResource={handleDeleteResource}
                grammarRuleBooks={grammarRuleBooks}
                onGrammarRuleBooksChange={setGrammarRuleBooks}
                regexDictionaryBooks={regexDictionaryBooks}
                onRegexDictionaryBooksChange={setRegexDictionaryBooks}
              />
            </Suspense>
          );
      case 'settings':
        return (
            <SettingsPage 
                key={settingsMountKey}
                initialPanel={settingsInitialPanel}
                aiSettings={aiSettings} 
                onUpdateAISettings={setAiSettings} 
                quickPrompts={quickPrompts}
                onUpdateQuickPrompts={setQuickPrompts}
                favoriteUrls={favoriteUrls}
                onUpdateFavoriteUrls={setFavoriteUrls}
                onSaveFavoriteUrls={saveFavoriteUrlsToDb}
                customOnlineDictionaries={customOnlineDictionaries}
                onUpdateCustomOnlineDictionaries={setCustomOnlineDictionaries}
                onSaveCustomOnlineDictionaries={saveCustomOnlineDictionariesToDb}
                embeddingSettings={embeddingSettings}
                onUpdateEmbeddingSettings={setEmbeddingSettings}
                performanceSettings={performanceSettings}
                onUpdatePerformanceSettings={setPerformanceSettings}
                capitalizeTargetFirstLetterZhOut={capitalizeTargetFirstLetterZhOut}
                onUpdateCapitalizeTargetFirstLetterZhOut={setCapitalizeTargetFirstLetterZhOut}
            />
        );
      case 'help':
        return (
          <Suspense fallback={<PageFallback />}>
            <Help />
          </Suspense>
        );
      case 'twintranslators':
        return (
          <Suspense fallback={<PageFallback />}>
          <TwinTranslatorsPage 
            twinTranslators={twinTranslators} 
            onTranslatorsChange={setTwinTranslators}
            aiSettings={aiSettings}
          />
          </Suspense>
        );
      case 'knowledge':
        return (
          <Suspense fallback={<PageFallback />}>
          <KnowledgeBasesPage
            knowledgeBases={knowledgeBases}
            onKnowledgeBasesChange={setKnowledgeBases}
            projects={projects}
            embeddingSettings={embeddingSettings}
          />
          </Suspense>
        );
      case 'dictionary':
        return <OnlineDictionaryPage customDictionaries={customOnlineDictionaries} />;
      default:
        return (
          <div className="flex items-center justify-center h-full text-slate-400">
            功能开发中...
          </div>
        );
    }
  };

  if (isAuthRequired() && !authChecked) {
    return (
      <ErrorBoundary>
        <div className="flex h-screen w-screen items-center justify-center bg-slate-50 flex-col gap-4">
          <div className="w-16 h-16 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin shadow-lg"></div>
          <div className="text-slate-600 font-medium">正在验证登录状态…</div>
        </div>
      </ErrorBoundary>
    );
  }

  if (isAuthRequired() && !authenticated) {
    return (
      <ErrorBoundary>
        <LoginPage onSuccess={handleAuthSuccess} />
      </ErrorBoundary>
    );
  }

  if (showWelcome && !startupError) {
    return (
      <ErrorBoundary>
        <WelcomeScreen
          projectCount={projects.length}
          isDataReady={!isLoading}
          onLaunch={(target, skipNext) => void launchFromWelcome(target, skipNext)}
        />
      </ErrorBoundary>
    );
  }

  if (isLoading) {
      return (
          <ErrorBoundary>
            <div className="flex h-screen w-screen items-center justify-center bg-slate-50 flex-col gap-4">
                <div className="w-16 h-16 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin shadow-lg"></div>
                <div className="flex items-center gap-2 text-slate-600 font-medium animate-pulse">
                    <Icons.Database className="w-5 h-5 text-blue-500" />
                    <span>正在初始化数据库...</span>
                </div>
            </div>
          </ErrorBoundary>
      );
  }

  if (startupError) {
    const cloud = isCloudDeployment();
    return (
      <ErrorBoundary>
        <div className="flex h-screen w-screen items-center justify-center bg-red-50 p-6">
          <div className="w-full max-w-2xl rounded-xl border border-red-200 bg-white shadow-xl">
            <div className="border-b border-red-100 bg-red-600 px-6 py-4 text-white">
              <div className="flex items-center gap-3">
                <Icons.AlertTriangle className="h-6 w-6" />
                <h2 className="text-lg font-semibold">
                  {cloud ? '云端 API 连接失败' : 'SQLite 启动检查未通过'}
                </h2>
              </div>
              <p className="mt-1 text-sm text-red-50">
                {cloud
                  ? '无法连接云端后端，应用暂时无法加载数据。请检查网络后重试。'
                  : '当前为强制 SQLite 模式。为防止数据写入其他存储，应用已阻止继续运行。'}
              </p>
            </div>

            <div className="space-y-4 px-6 py-5 text-sm text-slate-700">
              <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-red-700">
                {startupError}
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="font-medium text-slate-900">请按以下步骤检查：</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {cloud ? (
                    <>
                      <li>确认网络连接正常，可访问云端 API</li>
                      <li>
                        打开 API 健康检查地址（如部署文档中的{' '}
                        <code>/api/health</code>），确认返回 <code>ok: true</code>
                      </li>
                      <li>若 API 长时间未访问，免费托管可能休眠，等待 30–60 秒后重试</li>
                    </>
                  ) : (
                    <>
                      <li>在项目目录启动本地后端：<code>npm run dev:with-db</code>（或 <code>npm run server</code>）</li>
                      <li>打开 <code>http://127.0.0.1:58741/api/health</code>，确认返回 <code>ok: true</code></li>
                      <li>确认数据库路径为你指定的本地库文件（例如 <code>smartcat-db-path.json</code>）</li>
                    </>
                  )}
                </ul>
              </div>

              <div className="flex items-center justify-end gap-3">
                {!cloud && (
                  <button
                    onClick={() => window.open('http://127.0.0.1:58741/api/health', '_blank')}
                    className="rounded-md border border-slate-300 bg-white px-4 py-2 text-slate-700 hover:bg-slate-50"
                  >
                    打开健康检查
                  </button>
                )}
                <button
                  onClick={() => window.location.reload()}
                  className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
                >
                  重新检查并启动应用
                </button>
              </div>
            </div>
          </div>
        </div>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <Layout
        activePage={activePage}
        onNavigate={handleNavigate}
        onSearch={setSearchQuery}
        searchQuery={searchQuery}
        currentProject={activeProject}
        activeFileId={activeFileId}
        onFileChange={setActiveFileId}
        onExportFile={handleExportFile}
        isSaving={isSaving}
        favoriteUrls={favoriteUrls}
        onOpenOnlineDictionary={openOnlineDictionaryPage}
        reduceVisualEffects={performanceSettings.performanceMode}
        authUser={isAuthRequired() ? authUser : null}
        onLogout={isAuthRequired() ? handleLogout : undefined}
      >
        {renderContent()}
      </Layout>
    </ErrorBoundary>
  );
};

export default App;