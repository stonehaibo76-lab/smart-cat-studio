
import React, { useEffect, useState } from 'react';
import { Icons } from './ui/Icons';
import { FavoriteUrl, Project } from '../types';
import { APP_DISPLAY_VERSION } from '../constants';
import { fetchLocalBackendHealth, type LocalBackendHealth } from '../services/localBackendClient';
import { isCloudDeployment } from '../services/deploymentMode';
import type { AuthUser } from '../services/authService';
import { segmentIsEffectivelyConfirmed } from '../services/segmentEffectiveStatus';
import { getProjectXliffExportCapabilities } from '../services/xliff/projectXliffDetect';
import type { SettingsPanelId } from '../pages/Settings';

function formatDataSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  const gb = mb / 1024;
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`;
}

function sqlitePathBasename(p: string): string {
  const n = p.replace(/\\/g, '/').split('/').filter(Boolean).pop();
  return n || p || '—';
}

interface SidebarLocalDbFooterProps {
  collapsed: boolean;
  health: LocalBackendHealth | null;
  onOpenSettings: () => void;
  reduceVisualEffects?: boolean;
}

function SidebarDataFooter({
  collapsed,
  health,
  onOpenSettings,
  reduceVisualEffects = false,
}: SidebarLocalDbFooterProps) {
  const cloud = isCloudDeployment();
  const connected = health?.ok === true;
  const main = health?.dbFileBytes ?? null;
  const wal = health?.walFileBytes ?? null;
  const walBytes = wal ?? 0;
  const hasSize =
    connected &&
    health &&
    !cloud &&
    (main != null || walBytes > 0);
  const totalBytes = hasSize ? (main ?? 0) + walBytes : null;

  const pathTitle = health?.dbPath?.trim() ?? '';
  const baseName = pathTitle ? sqlitePathBasename(pathTitle) : '';

  const collapsedTitle = cloud
    ? connected
      ? '云端数据库已连接\nPostgreSQL · 按账号隔离存储'
      : '云端 API 未连接\n请检查网络或稍后重试'
    : connected
      ? `本地数据库已连接${pathTitle ? `\n${pathTitle}` : ''}${totalBytes != null ? `\n约 ${formatDataSize(totalBytes)}` : ''}${walBytes > 0 ? '\n（含 WAL 文件）' : ''}`
      : '本地数据库服务未连接\n请启动本地后端（npm run dev:with-db 或 npm run server）';

  if (collapsed) {
    return (
      <div className="flex justify-center border-t border-slate-800 p-4">
        <button
          type="button"
          onClick={onOpenSettings}
          title={collapsedTitle}
          className="relative flex h-10 w-10 items-center justify-center rounded-full border border-slate-700 bg-slate-800 text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200"
        >
          <Icons.Database className="h-5 w-5" />
          <span
            className={`absolute bottom-1 right-1 h-2 w-2 rounded-full ring-2 ring-slate-800 ${
              connected ? 'bg-emerald-500' : 'bg-rose-500'
            }`}
            aria-hidden
          />
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-slate-800 p-4">
      <div
        className={`rounded-xl border border-slate-700/50 bg-slate-800/50 p-3 ${
          reduceVisualEffects ? '' : 'backdrop-blur-sm'
        }`}
      >
        <div className="mb-2 flex items-start justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
            {cloud ? '云端数据库' : '本地数据库'}
          </p>
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
              connected ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'
            }`}
          >
            {connected ? '已连接' : '未连接'}
          </span>
        </div>
        {connected && health ? (
          cloud ? (
            <>
              <p className="text-sm font-semibold leading-snug text-slate-100">PostgreSQL</p>
              <p className="mt-1 text-xs text-slate-500">项目与资源按登录账号隔离存储</p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold leading-snug text-slate-100">
                {totalBytes != null ? (
                  <>
                    约 {formatDataSize(totalBytes)}
                    {walBytes > 0 ? (
                      <span className="ml-1 text-xs font-normal text-slate-500">（含 WAL）</span>
                    ) : null}
                  </>
                ) : (
                  '—'
                )}
              </p>
              {pathTitle ? (
                <p className="mt-1 truncate text-xs text-slate-500" title={pathTitle}>
                  {baseName}
                </p>
              ) : null}
            </>
          )
        ) : (
          <p className="text-xs leading-relaxed text-slate-500">
            {cloud
              ? '无法连接云端 API 时应用无法读写数据。请检查网络连接，或稍后重试（免费托管可能需冷启动）。'
              : '无法连接本地 SQLite 服务时应用无法持久化数据。请先启动后端，或在「系统设置 → 本地数据」查看说明。'}
          </p>
        )}
        <button
          type="button"
          onClick={onOpenSettings}
          className="mt-2 text-xs font-medium text-blue-400 hover:text-blue-300"
        >
          {cloud ? '云端数据说明 →' : '本地数据设置 →'}
        </button>
      </div>
    </div>
  );
}

function openFavoriteInBrowser(raw: string) {
  const t = raw.trim();
  if (!t) return;
  let candidate = t;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate.replace(/^\/+/, '')}`;
  }
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      console.warn('[SmartCAT] 已阻止非 http(s) 收藏链接:', parsed.protocol);
      return;
    }
    window.open(parsed.href, '_blank', 'noopener,noreferrer');
  } catch {
    console.warn('[SmartCAT] 无效的收藏 URL:', t);
  }
}

interface ExportOptions {
  format: 'excel' | 'tmx' | 'sdlxliff' | 'mqxliff' | 'sdlrpx';
  onlyConfirmed: boolean;
  exportType?: 'all' | 'unlockedSource' | 'unlockedSourceTarget' | 'untranslated' | 'confirmed';
  exportScope?: 'currentFile' | 'project';
  sourceTargetOnly?: boolean;
}

interface LayoutProps {
  children: React.ReactNode;
  activePage: string;
  onNavigate: (page: string, opts?: { settingsPanel?: SettingsPanelId }) => void;
  onSearch: (query: string) => void;
  searchQuery: string;
  currentProject?: Project | null;
  activeFileId?: string | null;
  onFileChange?: (fileId: string) => void;
  onExportFile?: (options: ExportOptions) => void;
  isSaving?: boolean;
  favoriteUrls?: FavoriteUrl[];
  /** 打开在线词典页（标题栏入口，与 Ctrl+D 一致） */
  onOpenOnlineDictionary?: () => void;
  /** 低配机：减少标题栏与侧栏模糊合成 */
  reduceVisualEffects?: boolean;
  authUser?: AuthUser | null;
  onLogout?: () => void;
}

export const Layout: React.FC<LayoutProps> = ({ 
    children, activePage, onNavigate, 
    onSearch, searchQuery, currentProject,
    activeFileId, onFileChange, onExportFile, isSaving = false,
    favoriteUrls = [],
    onOpenOnlineDictionary,
    reduceVisualEffects = false,
    authUser = null,
    onLogout,
}) => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [showFavoriteMenu, setShowFavoriteMenu] = useState(false);
  const [localDbHealth, setLocalDbHealth] = useState<LocalBackendHealth | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void fetchLocalBackendHealth().then((h) => {
        if (!cancelled) setLocalDbHealth(h);
      });
    };
    refresh();
    const id = window.setInterval(refresh, 45000);
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, []);
  // 导出选项对话框状态
  const [showExportOptions, setShowExportOptions] = useState(false);
  const xliffExport = getProjectXliffExportCapabilities(currentProject);
  const hasTradosPackage = xliffExport.hasTradosPackage;
  const sdlxliffFileCount = xliffExport.sdlxliffFileCount;
  const mqxliffFileCount = xliffExport.mqxliffFileCount;
  const hasSdlxliffExport = xliffExport.hasSdlxliff;
  const hasMqxliffExport = xliffExport.hasMqxliff;

  // 导出选项
  const [exportOptions, setExportOptions] = useState({
    format: 'excel' as ExportOptions['format'],
    onlyConfirmed: false,
    exportType: 'all' as 'all' | 'unlockedSource' | 'unlockedSourceTarget' | 'untranslated' | 'confirmed',
    exportScope: 'currentFile' as 'currentFile' | 'project',
    sourceTargetOnly: true
  });

  const isInteropExport =
    exportOptions.format === 'sdlxliff' ||
    exportOptions.format === 'mqxliff' ||
    exportOptions.format === 'sdlrpx';

  const openExportOptions = () => {
    setExportOptions((prev) => {
      const next = { ...prev };
      if (hasTradosPackage) next.format = 'sdlrpx';
      else if (hasSdlxliffExport) next.format = 'sdlxliff';
      else if (hasMqxliffExport) next.format = 'mqxliff';
      else next.format = 'excel';
      return next;
    });
    setShowExportOptions(true);
  };

  const navItems = [
    { id: 'home', icon: Icons.Home, label: '工作台' },
    { id: 'dashboard', icon: Icons.Dashboard, label: '项目管理' },
    { id: 'editor', icon: Icons.File, label: '翻译编辑' },
    { id: 'resources', icon: Icons.Database, label: '语言资源' },
    { id: 'twintranslators', icon: Icons.User, label: '孪生译员' },
    { id: 'knowledge', icon: Icons.Sparkles, label: '知识库' },
    { id: 'settings', icon: Icons.Settings, label: '系统设置' },
    { id: 'help', icon: Icons.HelpCircle, label: '使用帮助' },
  ];

  // Helper to safely get progress
  // const currentFileProgress = currentProject?.files.find(f => f.id === activeFileId)?.progress || 0;

  // Word-like character count function
  const getWordCount = (text: string): number => {
    // Word count method similar to Microsoft Word
    // For Chinese: count characters including punctuation
    // For English: count words separated by spaces
    if (!text) return 0;
    
    // Remove extra whitespace
    const trimmedText = text.trim();
    if (!trimmedText) return 0;
    
    // Check if text is primarily Chinese (contains Chinese characters)
    const hasChinese = /[\u4e00-\u9fa5]/.test(trimmedText);
    
    if (hasChinese) {
      // For Chinese: count each character as 1 word
      return trimmedText.length;
    } else {
      // For English: count words separated by spaces
      return trimmedText.split(/\s+/).length;
    }
  };

  // Calculate confirmed words and total words for current file
  const getWordStats = () => {
    const currentFile = currentProject?.files.find(f => f.id === activeFileId);
    if (!currentFile) return { confirmed: 0, total: 0, progress: 0 };
    
    let confirmedWords = 0;
    let totalWords = 0;
    
    currentFile.segments.forEach(segment => {
      const wordCount = getWordCount(segment.sourceText);
      totalWords += wordCount;
      
      if (segmentIsEffectivelyConfirmed(segment)) {
        confirmedWords += wordCount;
      }
    });
    
    // Apply 0.95 coefficient
    const confirmed = Math.round(confirmedWords * 0.95);
    const total = Math.round(totalWords * 0.95);
    const progress = total > 0 ? Math.round((confirmed / total) * 100) : 0;
    
    return {
      confirmed,
      total,
      progress
    };
  };

  const { confirmed: confirmedWords, total: totalWords, progress: currentFileProgress } = getWordStats();

  const favoriteLinks = favoriteUrls.filter((f) => f.url.trim().length > 0);

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans text-slate-900">
      {/* Sidebar */}
      <aside 
        className={`${
          isSidebarCollapsed ? 'w-20' : 'w-64'
        } bg-slate-900 flex flex-col shadow-2xl z-40 transition-all duration-300 ease-in-out relative`}
      >
        {/* Toggle Button - Made more prominent */}
        <button 
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            className="absolute -right-4 top-20 z-[100] p-1.5 rounded-full bg-blue-600 text-white shadow-[0_4px_12px_rgba(37,99,235,0.4)] border-2 border-slate-50 hover:bg-blue-700 hover:scale-110 transition-all flex items-center justify-center cursor-pointer scale-80"
            title={isSidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
        >
            {isSidebarCollapsed ? <Icons.SidebarOpen className="w-4 h-4"/> : <Icons.SidebarClose className="w-4 h-4"/>}
        </button>

        <div
          className={`flex shrink-0 border-b border-slate-800 ${
            isSidebarCollapsed
              ? 'h-16 items-center justify-center px-0'
              : 'min-h-16 items-start gap-2 px-6 py-3'
          }`}
        >
          <div className="bg-blue-600 p-1.5 rounded-lg shadow-[0_0_15px_rgba(37,99,235,0.5)] shrink-0">
            <Icons.Languages className="w-5 h-5" />
          </div>
          {!isSidebarCollapsed && (
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-white">
              <span className="font-bold text-lg tracking-tight leading-snug">Smart-CAT Studio</span>
              <span className="break-words font-semibold text-base leading-snug text-blue-200/90">
                {APP_DISPLAY_VERSION}
              </span>
            </div>
          )}
        </div>

        <nav className="flex-1 py-6 px-3 space-y-2">
          {navItems.map((item) => {
            const isActive = activePage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`group relative w-full flex items-center rounded-xl transition-all duration-200 ${
                  isSidebarCollapsed ? 'justify-center py-3' : 'gap-3 px-3 py-2.5'
                } ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
                }`}
              >
                <item.icon className={`w-5 h-5 shrink-0 ${isActive ? 'text-white' : 'text-slate-500 group-hover:text-slate-300'}`} />
                
                <span className={`font-medium text-sm whitespace-nowrap overflow-hidden transition-all duration-300 ${isSidebarCollapsed ? 'w-0 opacity-0 hidden' : 'w-auto opacity-100'}`}>
                    {item.label}
                </span>

                {isActive && !isSidebarCollapsed && (
                  <div className="ml-auto w-1.5 h-1.5 bg-white rounded-full shadow-[0_0_8px_white]" />
                )}

                {/* Tooltip for collapsed mode */}
                {isSidebarCollapsed && (
                    <div className="absolute left-full ml-4 px-2 py-1 bg-slate-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 shadow-xl border border-slate-700">
                        {item.label}
                        {/* Triangle arrow */}
                        <div className="absolute top-1/2 -left-1 -mt-1 border-4 border-transparent border-r-slate-800"></div>
                    </div>
                )}
              </button>
            );
          })}
        </nav>

        <SidebarDataFooter
          collapsed={isSidebarCollapsed}
          health={localDbHealth}
          onOpenSettings={() => onNavigate('settings', { settingsPanel: 'localDb' })}
          reduceVisualEffects={reduceVisualEffects}
        />
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-h-0 h-full overflow-hidden relative transition-all">
        {/* Topbar */}
        <header
          className={`h-16 border-b border-slate-200 flex items-center justify-between px-8 z-50 sticky top-0 ${
            reduceVisualEffects ? 'bg-white' : 'bg-white/80 backdrop-blur-xl'
          }`}
        >
          <div className="flex items-center gap-4">
             {activePage === 'editor' && currentProject && (
                <div className="flex items-center gap-4 text-sm text-slate-500">
                    <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900">当前项目:</span>
                        <span className="font-medium truncate max-w-[150px]">{currentProject.name}</span>
                        <Icons.ChevronRight className="w-4 h-4" />
                        <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs font-bold border border-blue-100 uppercase">
                            {currentProject.sourceLang} &gt; {currentProject.targetLang}
                        </span>
                    </div>

                    {/* Separator */}
                    {currentProject.files.length > 0 && <div className="h-4 w-px bg-slate-300" />}

                    {/* File Switcher in Header */}
                    {currentProject.files.length > 0 && activeFileId && onFileChange && (
                        <>
                            <div className="relative z-50">
                                <button onClick={() => setShowFileMenu(!showFileMenu)} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-100 text-slate-700 font-semibold text-sm border border-transparent hover:border-slate-200 transition-all">
                                    <Icons.File className="w-4 h-4 text-slate-400" />
                                    <span className="max-w-[150px] truncate">
                                        {currentProject.files.find(f => f.id === activeFileId)?.name}
                                    </span>
                                    <Icons.ChevronDown className="w-3 h-3 text-slate-400" />
                                </button>
                                {/* Dropdown Menu */}
                                <div className={`absolute top-full left-0 mt-1 w-64 bg-white rounded-xl shadow-xl border border-slate-200 p-1 animate-in fade-in slide-in-from-top-1 ${showFileMenu ? 'block' : 'hidden'}`}>
                                    {currentProject.files.map(f => (
                                        <button 
                                            key={f.id}
                                            onClick={() => {
                                                onFileChange(f.id);
                                                setShowFileMenu(false);
                                            }}
                                            className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between ${f.id === activeFileId ? 'bg-blue-50 text-blue-700' : 'hover:bg-slate-50 text-slate-700'}`}
                                        >
                                            <span className="truncate">{f.name}</span>
                                            <span className="text-[10px] text-slate-400">{f.progress}%</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                            
                            {/* NEW PROGRESS DISPLAY */}
                            <div className="flex items-center gap-2.5 ml-2 pl-4 border-l border-slate-200">
                                <span className="text-xs font-medium text-slate-400">进度</span>
                                <div className="w-24 h-2.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200 shadow-inner">
                                    <div 
                                        className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-500 ease-out" 
                                        style={{ width: `${currentFileProgress}%` }} 
                                    />
                                </div>
                                <span className="text-xs font-bold text-slate-700 w-8">
                                    {currentFileProgress}%
                                </span>
                                
                                {/* Word Count Display */}
                                <span className="h-3 w-px bg-slate-300 mx-2"></span>
                                <span className="text-xs text-slate-600">
                                    {confirmedWords}/{totalWords}
                                </span>
                                
                                {/* Export Button */}
                                <span className="h-3 w-px bg-slate-300 mx-2"></span>
                                <div className="relative">
                                    <button 
                                        onClick={openExportOptions}
                                        disabled={!onExportFile}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-md text-xs font-semibold transition-colors border border-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                        title="导出文件"
                                    >
                                        <Icons.Download className="w-4 h-4" />
                                        导出
                                        <Icons.ChevronDown className="w-3 h-3 text-slate-500" />
                                    </button>
                                    
                                    {/* Export Options Dialog */}
                                    {showExportOptions && (
                                        <div className="absolute right-0 top-full mt-1 w-72 bg-white rounded-xl shadow-xl border border-slate-200 p-3 z-50 animate-in fade-in slide-in-from-top-1">
                                            <h4 className="text-xs font-bold text-slate-900 uppercase mb-3">导出选项</h4>

                                            {/* Export Scope Selection */}
                                            <div className="mb-3">
                                                <label className="block text-xs font-medium text-slate-700 mb-1">导出范围</label>
                                                <div className="space-y-1">
                                                    <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer hover:bg-slate-50 p-1.5 rounded">
                                                        <input
                                                            type="radio"
                                                            name="exportScope"
                                                            value="currentFile"
                                                            checked={exportOptions.exportScope === 'currentFile'}
                                                            onChange={(e) => setExportOptions(prev => ({ ...prev, exportScope: e.target.value as 'currentFile' | 'project' }))}
                                                            className="w-3 h-3 text-blue-600"
                                                        />
                                                        <span>当前文件</span>
                                                    </label>
                                                    <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer hover:bg-slate-50 p-1.5 rounded">
                                                        <input
                                                            type="radio"
                                                            name="exportScope"
                                                            value="project"
                                                            checked={exportOptions.exportScope === 'project'}
                                                            onChange={(e) => setExportOptions(prev => ({ ...prev, exportScope: e.target.value as 'currentFile' | 'project' }))}
                                                            className="w-3 h-3 text-blue-600"
                                                        />
                                                        <span>整个项目（合并所有拆分文件）</span>
                                                    </label>
                                                </div>
                                            </div>

                                            {/* Export Type Selection */}
                                            <div className="mb-3">
                                                <label className="block text-xs font-medium text-slate-700 mb-1">导出内容</label>
                                                <div className="space-y-1">
                                                    <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer hover:bg-slate-50 p-1.5 rounded">
                                                        <input
                                                            type="radio"
                                                            name="exportType"
                                                            value="all"
                                                            checked={exportOptions.exportType === 'all'}
                                                            onChange={(e) => setExportOptions(prev => ({ ...prev, exportType: e.target.value as 'all' | 'unlockedSource' | 'unlockedSourceTarget', onlyConfirmed: false }))}
                                                            className="w-3 h-3 text-blue-600"
                                                        />
                                                        <span>全部句段</span>
                                                    </label>
                                                    <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer hover:bg-slate-50 p-1.5 rounded">
                                                        <input
                                                            type="radio"
                                                            name="exportType"
                                                            value="unlockedSource"
                                                            checked={exportOptions.exportType === 'unlockedSource'}
                                                            onChange={(e) => setExportOptions(prev => ({ ...prev, exportType: e.target.value as 'all' | 'unlockedSource' | 'unlockedSourceTarget', onlyConfirmed: false }))}
                                                            className="w-3 h-3 text-blue-600"
                                                        />
                                                        <span>未锁定原文</span>
                                                    </label>
                                                    <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer hover:bg-slate-50 p-1.5 rounded">
                                                        <input
                                                            type="radio"
                                                            name="exportType"
                                                            value="unlockedSourceTarget"
                                                            checked={exportOptions.exportType === 'unlockedSourceTarget'}
                                                            onChange={(e) => setExportOptions(prev => ({ ...prev, exportType: e.target.value as 'all' | 'unlockedSource' | 'unlockedSourceTarget' | 'untranslated', onlyConfirmed: false }))}
                                                            className="w-3 h-3 text-blue-600"
                                                        />
                                                        <span>未锁定原文和译文</span>
                                                    </label>
                                                    <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer hover:bg-slate-50 p-1.5 rounded">
                                                        <input
                                                            type="radio"
                                                            name="exportType"
                                                            value="untranslated"
                                                            checked={exportOptions.exportType === 'untranslated'}
                                                            onChange={(e) => setExportOptions(prev => ({ ...prev, exportType: e.target.value as 'all' | 'unlockedSource' | 'unlockedSourceTarget' | 'untranslated' | 'confirmed', onlyConfirmed: false }))}
                                                            className="w-3 h-3 text-blue-600"
                                                        />
                                                        <span>未翻译且未锁定句段</span>
                                                    </label>
                                                    <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer hover:bg-slate-50 p-1.5 rounded">
                                                        <input
                                                            type="radio"
                                                            name="exportType"
                                                            value="confirmed"
                                                            checked={exportOptions.exportType === 'confirmed'}
                                                            onChange={(e) => setExportOptions(prev => ({ ...prev, exportType: e.target.value as 'all' | 'unlockedSource' | 'unlockedSourceTarget' | 'untranslated' | 'confirmed', onlyConfirmed: false }))}
                                                            className="w-3 h-3 text-blue-600"
                                                        />
                                                        <span>已确认句段原文和译文</span>
                                                    </label>
                                                </div>
                                            </div>

                                            {/* Only Confirmed Option - Only visible when exportType is 'all' */}
                                            {exportOptions.exportType === 'all' && (
                                                <div className="mb-3">
                                                    <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer hover:bg-slate-50 p-1.5 rounded">
                                                        <input
                                                            type="checkbox"
                                                            checked={exportOptions.onlyConfirmed}
                                                            onChange={(e) => setExportOptions(prev => ({ ...prev, onlyConfirmed: e.target.checked }))}
                                                            className="w-3 h-3 text-blue-600"
                                                        />
                                                        <span>仅导出已确认句段</span>
                                                    </label>
                                                </div>
                                            )}

                                            {/* Format Selection */}
                                            <div className="mb-4">
                                                <label className="block text-xs font-medium text-slate-700 mb-1">导出格式</label>
                                                <div className="space-y-1">
                                                    <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer hover:bg-slate-50 p-1.5 rounded">
                                                        <input
                                                            type="radio"
                                                            name="exportFormat"
                                                            value="excel"
                                                            checked={exportOptions.format === 'excel'}
                                                            onChange={(e) => setExportOptions(prev => ({ ...prev, format: e.target.value as 'excel' | 'tmx' }))}
                                                            className="w-3 h-3 text-blue-600"
                                                        />
                                                        <span>Excel 文件 (.xlsx)</span>
                                                    </label>
                                                    <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer hover:bg-slate-50 p-1.5 rounded">
                                                        <input
                                                            type="radio"
                                                            name="exportFormat"
                                                            value="tmx"
                                                            checked={exportOptions.format === 'tmx'}
                                                            onChange={(e) => setExportOptions(prev => ({ ...prev, format: e.target.value as 'excel' | 'tmx' }))}
                                                            className="w-3 h-3 text-blue-600"
                                                        />
                                                        <span>TMX 文件 (.tmx)</span>
                                                    </label>
                                                    {hasSdlxliffExport && (
                                                      <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer hover:bg-slate-50 p-1.5 rounded">
                                                        <input type="radio" name="exportFormat" value="sdlxliff" checked={exportOptions.format === 'sdlxliff'} onChange={() => setExportOptions(prev => ({ ...prev, format: 'sdlxliff' }))} className="w-3 h-3 text-blue-600" />
                                                        <span>SDLXLIFF 双语文件 (.sdlxliff)</span>
                                                      </label>
                                                    )}
                                                    {hasMqxliffExport && (
                                                      <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer hover:bg-slate-50 p-1.5 rounded">
                                                        <input type="radio" name="exportFormat" value="mqxliff" checked={exportOptions.format === 'mqxliff'} onChange={() => setExportOptions(prev => ({ ...prev, format: 'mqxliff' }))} className="w-3 h-3 text-blue-600" />
                                                        <span>MQXLIFF 双语文件 (.mqxliff)</span>
                                                      </label>
                                                    )}
                                                    {hasTradosPackage && (
                                                      <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer hover:bg-slate-50 p-1.5 rounded">
                                                        <input type="radio" name="exportFormat" value="sdlrpx" checked={exportOptions.format === 'sdlrpx'} onChange={() => setExportOptions(prev => ({ ...prev, format: 'sdlrpx' }))} className="w-3 h-3 text-blue-600" />
                                                        <span>Trados 回传包 (.sdlrpx)</span>
                                                      </label>
                                                    )}
                                                </div>
                                                {isInteropExport && (
                                                  <p className="mt-2 text-[11px] text-slate-500 leading-relaxed">
                                                    {exportOptions.format === 'sdlrpx'
                                                      ? '将包内全部 SDLXLIFF 写回译文后打包，供 Trados「导入返回包」。'
                                                      : exportOptions.format === 'sdlxliff'
                                                        ? '按句段 ID 写回 SDLXLIFF，保留内联标签。'
                                                        : '按句段顺序写回 MQXLIFF。'}
                                                    {exportOptions.format !== 'sdlrpx' && (
                                                      <span className="block mt-1">导出范围选「整个项目」时将依次下载各双语文件。</span>
                                                    )}
                                                  </p>
                                                )}
                                            </div>

                                            {/* Column Selection */}
                                            {!isInteropExport && (
                                            <div className="mb-4">
                                                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer hover:bg-slate-50 p-1.5 rounded">
                                                    <input
                                                        type="checkbox"
                                                        checked={exportOptions.sourceTargetOnly}
                                                        onChange={(e) => setExportOptions(prev => ({ ...prev, sourceTargetOnly: e.target.checked }))}
                                                        className="w-3 h-3 text-blue-600"
                                                    />
                                                    <span>仅导出原文和译文列（不含附加信息）</span>
                                                </label>
                                            </div>
                                            )}

                                            {/* Action Buttons */}
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => setShowExportOptions(false)}
                                                    className="flex-1 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors"
                                                >
                                                    取消
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        // 调用导出函数，并传递选项
                                                        if (onExportFile) {
                                                            onExportFile(exportOptions);
                                                        }
                                                        setShowExportOptions(false);
                                                    }}
                                                    className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors"
                                                >
                                                    确认导出
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </div>
             )}
          </div>
          <div className="flex items-center gap-4">
             {/* Saving Indicator Removed Here */}

            {/* Global Search - Hidden in Editor and Help */}
            {activePage !== 'editor' && activePage !== 'help' && (
                <div className="relative group">
                    <div className={`flex items-center bg-slate-100 rounded-full px-3 py-1.5 transition-all duration-300 border border-transparent focus-within:border-blue-500 focus-within:bg-white focus-within:ring-4 focus-within:ring-blue-500/10 focus-within:w-64 w-48`}>
                        <Icons.Search className="w-4 h-4 text-slate-400 mr-2" />
                        <input 
                            type="text" 
                            placeholder={activePage === 'dashboard' ? "搜索项目..." : "全局搜索..."}
                            className="bg-transparent border-none outline-none text-sm text-slate-700 w-full placeholder-slate-400"
                            value={searchQuery}
                            onChange={(e) => onSearch(e.target.value)}
                        />
                    </div>
                </div>
            )}

            <div className="relative flex items-center gap-1 pl-2 border-l border-slate-200">
              {onOpenOnlineDictionary && (
                <button
                  type="button"
                  onClick={() => onOpenOnlineDictionary()}
                  className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-transparent px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-200 hover:bg-slate-100"
                  title="在线词典（Ctrl+D）"
                >
                  <Icons.Globe className="h-4 w-4 shrink-0 text-blue-600" />
                  <span className="hidden sm:inline">在线词典</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowFavoriteMenu((v) => !v)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 border border-transparent hover:border-slate-200 transition-colors"
                title="收藏网址"
              >
                <Icons.Bookmark className="w-4 h-4 text-amber-600 shrink-0" />
                <span className="hidden sm:inline">收藏</span>
                <Icons.ChevronDown className={`w-3 h-3 text-slate-400 shrink-0 transition-transform ${showFavoriteMenu ? 'rotate-180' : ''}`} />
              </button>
              {showFavoriteMenu && (
                <>
                  <button
                    type="button"
                    aria-label="关闭收藏菜单"
                    className="fixed inset-0 z-[45] cursor-default bg-transparent"
                    onClick={() => setShowFavoriteMenu(false)}
                  />
                  <div className="absolute right-0 top-full mt-1 w-64 max-h-72 overflow-y-auto rounded-xl bg-white shadow-xl border border-slate-200 py-1 z-[50] animate-in fade-in slide-in-from-top-1">
                    {favoriteLinks.length === 0 ? (
                      <div className="px-3 py-4 text-xs text-slate-500 leading-relaxed">
                        暂无可用链接。请在「系统设置 → 收藏网址」中添加名称与地址。
                      </div>
                    ) : (
                      favoriteLinks.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => {
                            openFavoriteInBrowser(f.url);
                            setShowFavoriteMenu(false);
                          }}
                          className="w-full text-left px-3 py-2.5 text-sm text-slate-800 hover:bg-slate-50 flex items-center gap-2 group"
                        >
                          <Icons.ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0 group-hover:text-blue-600" />
                          <span className="truncate font-medium">{f.label.trim() || f.url}</span>
                        </button>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
            
            <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-500 to-indigo-600 shadow-md ring-2 ring-white shrink-0" />
                <span className="text-sm font-medium text-slate-700 max-w-[120px] truncate hidden md:inline">
                  {authUser?.email?.split('@')[0] ?? 'Admin'}
                </span>
                {onLogout && (
                  <button
                    type="button"
                    onClick={onLogout}
                    className="rounded-lg px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    title="退出登录"
                  >
                    退出
                  </button>
                )}
            </div>
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 min-h-0 overflow-hidden relative">
          {children}
        </div>
      </main>
    </div>
  );
};
