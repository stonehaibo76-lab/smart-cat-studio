import React, { useState, useRef, useEffect, useMemo, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Icons } from '../components/ui/Icons';
import { ProjectCreateWizard } from '../components/project-wizard/ProjectCreateWizard';
import { Project, SegmentStatus, MatchType, TermBase, TranslationMemory, ProjectFile, Segment, DuplicateAnalysisResult, GrammarRuleBook, RegexDictionaryBook } from '../types';
import { SUPPORTED_LANGUAGES } from '../constants';
import { toDatetimeLocalValue, getProjectDeliveryDueRaw, parseDeliveryDeadline } from '../services/projectDueDate';
import { parseProjectFile } from '../services/projectCreateService';
import { countBillableChars, normalizeForMatching } from '../utils/textNormalize';
import type { ParsedXliffProject } from '../services/xliff/xliffImport';

type SearchField = 'name';
type DateField = 'created' | 'delivery';
type SettingsTab = 'info' | 'terminology' | 'memory' | 'dictionaries';

const LANG_ZH: Record<string, string> = {
  'en-US': '英语',
  'zh-CN': '简体中文',
  'ja-JP': '日语',
  'ko-KR': '韩语',
  'fr-FR': '法语',
  'es-ES': '西班牙语',
  'de-DE': '德语',
  'ru-RU': '俄语',
  'it-IT': '意大利语',
  'pt-BR': '葡萄牙语',
  'vi-VN': '越南语',
  'th-TH': '泰语',
  'ms-MY': '马来语',
  'my-MM': '缅甸语',
  'lo-LA': '老挝语',
};

function langLabel(code: string): string {
  return LANG_ZH[code] ?? SUPPORTED_LANGUAGES.find((l) => l.code === code)?.name ?? code;
}

function countProjectChars(project: Project): number {
  return project.files.reduce(
    (acc, f) => acc + f.segments.reduce((s, seg) => s + countBillableChars(seg.sourceText), 0),
    0
  );
}

function parseProjectCreatedAt(createdAt: string): Date | null {
  const d = new Date(createdAt);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatTableDateLines(raw: string | undefined): { date: string; time: string } {
  if (!raw) return { date: '--', time: '' };
  const d = raw.includes('T') ? parseDeliveryDeadline(raw) : parseProjectCreatedAt(raw);
  if (!d) return { date: raw.slice(0, 10), time: '' };
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return { date: `${y}-${m}-${day}`, time: `${hh}:${mm}` };
}

function projectTypeLabel(project: Project): string {
  if (project.tradosPackage) return 'Trados';
  return '人工翻译';
}

const PROJECT_MENU_WIDTH = 176;
const PROJECT_MENU_GAP = 4;

function computeProjectMenuPosition(
  anchorRect: DOMRect,
  menuHeight: number
): { top: number; left: number } {
  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const openUp = spaceBelow < menuHeight + PROJECT_MENU_GAP && anchorRect.top > menuHeight + PROJECT_MENU_GAP;
  const top = openUp
    ? anchorRect.top - menuHeight - PROJECT_MENU_GAP
    : anchorRect.bottom + PROJECT_MENU_GAP;
  let left = anchorRect.right - PROJECT_MENU_WIDTH;
  left = Math.max(8, Math.min(left, window.innerWidth - PROJECT_MENU_WIDTH - 8));
  return { top, left };
}

interface DashboardProps {
  projects: Project[];
  availableTMs: TranslationMemory[];
  availableTBs: TermBase[];
  availableGrammarRuleBooks: GrammarRuleBook[];
  availableRegexDictionaryBooks: RegexDictionaryBook[];
  onOpenProject: (id: string) => void;
  onCreateProject: (project: Project, newTM?: TranslationMemory, newTB?: TermBase) => void;
  onAddFileToProject: (
    projectId: string,
    fileName: string,
    content: string,
    isExcel?: boolean,
    excelSegments?: Array<{ source: string; target?: string; okapiTuId?: string; inlineRunMeta?: import('../types').InlineRunStyle[] }>,
    xliffProject?: ParsedXliffProject,
    sourceBlobId?: string,
    docxImportMode?: 'bilingual' | 'monolingual',
    docxBilingualLayout?: 'table' | 'interleaved'
  ) => void;
  onDeleteFileFromProject: (projectId: string, fileId: string) => void;
  onDeleteProject: (id: string) => void;
  onUpdateProject: (project: Project) => void;
  searchQuery: string;
  onTradosQuickExport?: (projectId: string, kind: 'sdlxliff' | 'sdlrpx') => void;
  onMemoqQuickExport?: (projectId: string, kind: 'mqxliff' | 'mqxlz') => void;
}

const ProjectTableRow: React.FC<{
  project: Project;
  mainTbName?: string;
  onOpen: () => void;
  onDelete: () => void;
  onManageFiles: () => void;
  onSettings: () => void;
  onAnalyzeDuplicates: () => void;
  onExportSdlxliff?: () => void;
  onExportSdlrpx?: () => void;
  onExportMqxliff?: () => void;
  onExportMqxlz?: () => void;
  menuOpen: boolean;
  onMenuToggle: () => void;
  onMenuClose: () => void;
}> = ({
  project,
  mainTbName,
  onOpen,
  onDelete,
  onManageFiles,
  onSettings,
  onAnalyzeDuplicates,
  onExportSdlxliff,
  onExportSdlrpx,
  onExportMqxliff,
  onExportMqxlz,
  menuOpen,
  onMenuToggle,
  onMenuClose,
}) => {
  const menuAnchorRef = useRef<HTMLButtonElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);

  const updateMenuPosition = useCallback(() => {
    const anchor = menuAnchorRef.current;
    const panel = menuPanelRef.current;
    if (!anchor || !panel) return;
    setMenuPosition(computeProjectMenuPosition(anchor.getBoundingClientRect(), panel.offsetHeight));
  }, []);

  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuPosition(null);
      return;
    }
    updateMenuPosition();
  }, [menuOpen, updateMenuPosition, onExportSdlxliff, onExportSdlrpx, onExportMqxliff, onExportMqxlz]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnScrollOrResize = () => onMenuClose();
    window.addEventListener('scroll', closeOnScrollOrResize, true);
    window.addEventListener('resize', closeOnScrollOrResize);
    return () => {
      window.removeEventListener('scroll', closeOnScrollOrResize, true);
      window.removeEventListener('resize', closeOnScrollOrResize);
    };
  }, [menuOpen, onMenuClose]);

  const created = formatTableDateLines(project.createdAt);
  const deliveryRaw = getProjectDeliveryDueRaw(project);
  const delivery = formatTableDateLines(deliveryRaw);
  const wordCount = countProjectChars(project);
  const progress = project.progress ?? 0;
  const isComplete = progress >= 100 || project.isCompleted;

  const menuPortal =
    menuOpen &&
    typeof document !== 'undefined' &&
    createPortal(
      <>
        <button
          type="button"
          aria-label="关闭菜单"
          className="fixed inset-0 z-[60] cursor-default"
          onClick={onMenuClose}
        />
        <div
          ref={menuPanelRef}
          style={
            menuPosition
              ? { top: menuPosition.top, left: menuPosition.left, width: PROJECT_MENU_WIDTH }
              : { top: -9999, left: -9999, width: PROJECT_MENU_WIDTH, visibility: 'hidden' as const }
          }
          className="fixed z-[70] rounded-lg border border-slate-200 bg-white py-1 shadow-lg text-left"
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button" onClick={() => { onMenuClose(); onOpen(); }} className="w-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 text-left">打开项目</button>
          <button type="button" onClick={() => { onMenuClose(); onManageFiles(); }} className="w-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 text-left">管理文件</button>
          <button type="button" onClick={() => { onMenuClose(); onSettings(); }} className="w-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 text-left">项目设置</button>
          <button type="button" onClick={() => { onMenuClose(); onAnalyzeDuplicates(); }} className="w-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 text-left">重复率分析</button>
          {onExportSdlxliff && (
            <button type="button" onClick={() => { onMenuClose(); onExportSdlxliff(); }} className="w-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 text-left">导出 SDLXLIFF</button>
          )}
          {onExportSdlrpx && (
            <button type="button" onClick={() => { onMenuClose(); onExportSdlrpx(); }} className="w-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 text-left">导出 SDLRPX</button>
          )}
          {onExportMqxliff && (
            <button type="button" onClick={() => { onMenuClose(); onExportMqxliff(); }} className="w-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 text-left">导出 MQXLIFF</button>
          )}
          {onExportMqxlz && (
            <button type="button" onClick={() => { onMenuClose(); onExportMqxlz(); }} className="w-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 text-left">导出 MQXLZ</button>
          )}
          <div className="my-1 border-t border-slate-100" />
          <button type="button" onClick={() => { onMenuClose(); onDelete(); }} className="w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50 text-left">删除项目</button>
        </div>
      </>,
      document.body
    );

  return (
    <tr
      className="border-b border-slate-100 hover:bg-slate-50/80 transition-colors cursor-pointer group"
      onClick={onOpen}
    >
      <td className="px-4 py-3.5 align-middle">
        <div className="font-medium text-slate-900 group-hover:text-blue-600 transition-colors truncate max-w-[220px]">
          {project.name}
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs">
          <span className="inline-flex items-center rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-blue-600">
            {projectTypeLabel(project)}
          </span>
          <span className="text-slate-400">{wordCount.toLocaleString()} 字</span>
        </div>
      </td>
      <td className="px-4 py-3.5 align-middle text-sm text-slate-600 whitespace-nowrap">
        {mainTbName || '--'}
      </td>
      <td className="px-4 py-3.5 align-middle text-sm text-slate-500 whitespace-nowrap">--</td>
      <td className="px-4 py-3.5 align-middle text-sm text-slate-700 whitespace-nowrap">
        {langLabel(project.sourceLang)} → {langLabel(project.targetLang)}
      </td>
      <td className="px-4 py-3.5 align-middle text-xs text-slate-500 whitespace-nowrap">
        <div>{created.date}</div>
        {created.time && <div className="text-slate-400">{created.time}</div>}
      </td>
      <td className="px-4 py-3.5 align-middle text-xs text-slate-500 whitespace-nowrap">
        {deliveryRaw ? (
          <>
            <div>{delivery.date}</div>
            {delivery.time && <div className="text-slate-400">{delivery.time}</div>}
          </>
        ) : (
          '--'
        )}
      </td>
      <td className="px-4 py-3.5 align-middle min-w-[120px]">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden min-w-[72px]">
            <div
              className={`h-full rounded-full transition-all ${
                isComplete ? 'bg-emerald-500' : progress > 0 ? 'bg-blue-500' : 'bg-slate-200'
              }`}
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          </div>
          <span className={`text-xs font-medium tabular-nums shrink-0 ${isComplete ? 'text-emerald-600' : 'text-slate-500'}`}>
            {progress}%
          </span>
        </div>
      </td>
      <td className="px-4 py-3.5 align-middle text-sm text-slate-500 whitespace-nowrap">--</td>
      <td className="px-4 py-3.5 align-middle text-right" onClick={(e) => e.stopPropagation()}>
        <button
          ref={menuAnchorRef}
          type="button"
          onClick={onMenuToggle}
          className="inline-flex items-center justify-center w-8 h-8 rounded text-blue-600 hover:bg-blue-50 transition-colors"
          aria-label="操作菜单"
          aria-expanded={menuOpen}
        >
          <Icons.More className="w-4 h-4" />
        </button>
        {menuPortal}
      </td>
    </tr>
  );
};

export const Dashboard: React.FC<DashboardProps> = ({ 
    projects, availableTMs, availableTBs, availableGrammarRuleBooks, availableRegexDictionaryBooks,
    onOpenProject, onCreateProject, onAddFileToProject, onDeleteFileFromProject, onDeleteProject, onUpdateProject, searchQuery,
    onTradosQuickExport,
    onMemoqQuickExport,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null);
  
  // File Management Modal State
  const [isFilesModalOpen, setIsFilesModalOpen] = useState(false);
  const [targetProjectId, setTargetProjectId] = useState<string | null>(null);
  const [parsingFileName, setParsingFileName] = useState<string | null>(null);
  const [importFeedback, setImportFeedback] = useState<string | null>(null);

  // Project Settings Modal State
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [settingsProjectId, setSettingsProjectId] = useState<string | null>(null);
  const [settingsProject, setSettingsProject] = useState<Project | null>(null);
  
  // Settings Form State
  const [settingsMainTbId, setSettingsMainTbId] = useState<string>('');
  const [settingsReferenceTbIds, setSettingsReferenceTbIds] = useState<Set<string>>(new Set());
  const [settingsMainTmId, setSettingsMainTmId] = useState<string>('');
  const [settingsReferenceTmIds, setSettingsReferenceTmIds] = useState<Set<string>>(new Set());
  const [settingsGrammarRuleBookIds, setSettingsGrammarRuleBookIds] = useState<Set<string>>(new Set());
  const [settingsRegexDictionaryBookIds, setSettingsRegexDictionaryBookIds] = useState<Set<string>>(new Set());
  const [settingsProjectName, setSettingsProjectName] = useState('');
  const [settingsDeliveryDueAt, setSettingsDeliveryDueAt] = useState('');
  const [settingsProjectCompleted, setSettingsProjectCompleted] = useState(false);
  const [settingsDeliveryReminderEnabled, setSettingsDeliveryReminderEnabled] = useState(true);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('info');

  const [isParsing, setIsParsing] = useState(false);

  // File Split State
  const [isSplitModalOpen, setIsSplitModalOpen] = useState(false);
  const [fileToSplit, setFileToSplit] = useState<ProjectFile | null>(null);
  const [splitMode, setSplitMode] = useState<'parts' | 'chars'>('parts');
  const [splitPartsCount, setSplitPartsCount] = useState(2);
  const [splitCharsCount, setSplitCharsCount] = useState(5000);

  // Duplicate Analysis State
  const [isDuplicateModalOpen, setIsDuplicateModalOpen] = useState(false);
  const [duplicateProjectId, setDuplicateProjectId] = useState<string | null>(null);
  const [duplicateResult, setDuplicateResult] = useState<DuplicateAnalysisResult | null>(null);
  const [isAnalyzingDuplicates, setIsAnalyzingDuplicates] = useState(false);

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [searchField, setSearchField] = useState<SearchField>('name');
  const [localSearchInput, setLocalSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [dateField, setDateField] = useState<DateField>('created');
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [appliedDateField, setAppliedDateField] = useState<DateField>('created');
  const [appliedDateStart, setAppliedDateStart] = useState('');
  const [appliedDateEnd, setAppliedDateEnd] = useState('');

  const addFileInputRef = useRef<HTMLInputElement>(null);

  const combinedSearch = appliedSearch || searchQuery;

  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      if (combinedSearch && searchField === 'name') {
        if (!p.name.toLowerCase().includes(combinedSearch.toLowerCase())) return false;
      }
      if (appliedDateStart || appliedDateEnd) {
        const raw =
          appliedDateField === 'delivery'
            ? getProjectDeliveryDueRaw(p)
            : p.createdAt;
        if (!raw) return false;
        const d = appliedDateField === 'delivery' ? parseDeliveryDeadline(raw) : parseProjectCreatedAt(raw);
        if (!d) return false;
        const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (appliedDateStart && day < appliedDateStart) return false;
        if (appliedDateEnd && day > appliedDateEnd) return false;
      }
      return true;
    });
  }, [projects, combinedSearch, searchField, appliedDateStart, appliedDateEnd, appliedDateField]);

  useEffect(() => {
    setOpenMenuId(null);
  }, [filteredProjects.length]);

  const handleApplyFilters = () => {
    setAppliedSearch(localSearchInput.trim());
    setAppliedDateField(dateField);
    setAppliedDateStart(dateStart);
    setAppliedDateEnd(dateEnd);
  };

  const handleResetFilters = () => {
    setLocalSearchInput('');
    setAppliedSearch('');
    setDateField('created');
    setDateStart('');
    setDateEnd('');
    setAppliedDateField('created');
    setAppliedDateStart('');
    setAppliedDateEnd('');
  };

  const handleOpenCreateModal = () => {
      setIsModalOpen(true);
  };
  
  const handleOpenFilesModal = (projectId: string) => {
      setTargetProjectId(projectId);
      setParsingFileName(null);
      setImportFeedback(null);
      setIsFilesModalOpen(true);
  };

  const handleOpenSettingsModal = (projectId: string) => {
      const project = projects.find(p => p.id === projectId);
      if (project) {
          setSettingsProjectId(projectId);
          setSettingsProject(project);
          setSettingsMainTbId(project.mainTbId || '');
          setSettingsMainTmId(project.mainTmId || '');
          
          // Set reference TBs (exclude main)
          const refTBs = new Set(project.tbIds.filter(id => id !== project.mainTbId));
          setSettingsReferenceTbIds(refTBs);
          
          // Set reference TMs (exclude main)
          const refTMs = new Set(project.tmIds.filter(id => id !== project.mainTmId));
          setSettingsReferenceTmIds(refTMs);

          setSettingsGrammarRuleBookIds(new Set(project.grammarRuleBookIds ?? []));
          setSettingsRegexDictionaryBookIds(new Set(project.regexDictionaryBookIds ?? []));
          setSettingsProjectName(project.name);
          setSettingsDeliveryDueAt(
              toDatetimeLocalValue(project.deliveryDueAt ?? project.deliveryDueDate ?? '')
          );
          setSettingsProjectCompleted(project.isCompleted === true);
          setSettingsDeliveryReminderEnabled(project.deliveryDueReminderEnabled !== false);

          setSettingsTab('info');
          setIsSettingsModalOpen(true);
      }
  };

  const handleSingleFileAddChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !targetProjectId) return;

      setImportFeedback(null);
      setParsingFileName(file.name);
      setIsParsing(true);
      try {
          const result = await parseProjectFile(file);
          onAddFileToProject(
            targetProjectId,
            result.name,
            result.content,
            result.isExcel,
            result.segments,
            result.xliffProject,
            result.sourceBlobId,
            result.docxImportMode,
            result.docxBilingualLayout
          );
          setImportFeedback(`已导入「${result.name}」`);
      } catch {
          alert('解析失败');
      } finally {
          setIsParsing(false);
          setParsingFileName(null);
          if (addFileInputRef.current) addFileInputRef.current.value = '';
      }
  };

  const handleCloseFilesModal = () => {
      setParsingFileName(null);
      setImportFeedback(null);
      setIsFilesModalOpen(false);
  };

  const handleConfirmFilesModal = () => {
      setIsFilesModalOpen(false);
  };

  const handleDeleteFile = (projectId: string, fileId: string) => {
      if (confirm('确定要删除此文件吗？相关句段数据将丢失。')) {
          onDeleteFileFromProject(projectId, fileId);
      }
  }

  const handleOpenSplitModal = (file: ProjectFile) => {
      setFileToSplit(file);
      setSplitMode('parts');
      setSplitPartsCount(2);
      setSplitCharsCount(5000);
      setIsSplitModalOpen(true);
  };

  const handleSplitFile = () => {
      if (!fileToSplit || !targetProjectId) return;

      const project = projects.find(p => p.id === targetProjectId);
      if (!project) return;

      const segments = fileToSplit.segments;
      if (segments.length === 0) return;

      let splitSegments: Segment[][] = [];

      if (splitMode === 'parts') {
          const partsCount = Math.max(2, Math.min(10, splitPartsCount));
          const segmentCount = segments.length;
          const baseSize = Math.floor(segmentCount / partsCount);
          const remainder = segmentCount % partsCount;

          let startIndex = 0;
          for (let i = 0; i < partsCount; i++) {
              const size = baseSize + (i < remainder ? 1 : 0);
              splitSegments.push(segments.slice(startIndex, startIndex + size));
              startIndex += size;
          }
      } else {
          const charsPerFile = Math.max(100, splitCharsCount);
          let currentGroup: Segment[] = [];
          let currentCharCount = 0;

          for (const seg of segments) {
              const segCharCount = seg.sourceText.length;
              if (currentCharCount + segCharCount > charsPerFile && currentGroup.length > 0) {
                  splitSegments.push(currentGroup);
                  currentGroup = [];
                  currentCharCount = 0;
              }
              currentGroup.push(seg);
              currentCharCount += segCharCount;
          }

          if (currentGroup.length > 0) {
              splitSegments.push(currentGroup);
          }
      }

      const newFiles: ProjectFile[] = splitSegments.map((segs, idx) => {
          const lockedCount = segs.filter(s => s.isLocked).length;
          const progress = segs.length > 0 ? Math.round((lockedCount / segs.length) * 100) : 0;
          const baseName = fileToSplit.name.replace(/\.[^/.]+$/, '');
          const ext = fileToSplit.name.match(/\.[^/.]+$/)?.[0] || '';
          return {
              id: `f-${Date.now()}-${idx}`,
              name: `${baseName}_part${idx + 1}${ext}`,
              segments: segs.map((s, sIdx) => ({
                  ...s,
                  id: `s-${Date.now()}-${idx}-${sIdx}`
              })),
              totalSegments: segs.length,
              progress: progress
          };
      });

      const updatedFiles = project.files
          .filter(f => f.id !== fileToSplit.id)
          .concat(newFiles);

      const totalSegments = updatedFiles.reduce((acc, f) => acc + f.totalSegments, 0);
      const totalProgress = updatedFiles.reduce((acc, f) => acc + (f.progress / 100 * f.totalSegments), 0);

      const updatedProject: Project = {
          ...project,
          files: updatedFiles,
          totalSegments: totalSegments,
          progress: totalSegments > 0 ? Math.round((totalProgress / totalSegments) * 100) : 0
      };

      onUpdateProject(updatedProject);
      setIsSplitModalOpen(false);
      setFileToSplit(null);
  };

  const analyzeDuplicates = (project: Project, tms: TranslationMemory[]): DuplicateAnalysisResult => {
      const normalizeKey = (text: string) => normalizeForMatching(text).toLowerCase();

      const textToLocations = new Map<string, { segmentId: string; fileId: string; fileName: string; isLocked: boolean; charCount: number }[]>();

      project.files.forEach(file => {
          file.segments.forEach(segment => {
              const normalizedText = normalizeKey(segment.sourceText);
              if (!normalizedText) return;

              if (!textToLocations.has(normalizedText)) {
                  textToLocations.set(normalizedText, []);
              }
              textToLocations.get(normalizedText)!.push({
                  segmentId: segment.id,
                  fileId: file.id,
                  fileName: file.name,
                  isLocked: segment.isLocked || false,
                  charCount: countBillableChars(segment.sourceText)
              });
          });
      });

      const tmSourceMap = new Map<string, { target: string; tmName: string }>();
      tms.forEach(tm => {
          if (!project.tmIds.includes(tm.id)) return;
          tm.units.forEach(unit => {
              const normalizedSource = normalizeKey(unit.source);
              if (!tmSourceMap.has(normalizedSource)) {
                  tmSourceMap.set(normalizedSource, { target: unit.target, tmName: tm.name });
              }
          });
      });

      const duplicateGroups: DuplicateAnalysisResult['duplicateGroups'] = [];
      const tmMatches: DuplicateAnalysisResult['tmMatches'] = [];
      let totalSegments = 0;
      let duplicateSegments = 0;
      let internalDuplicates = 0;
      let crossFileDuplicates = 0;
      let tmExactMatches = 0;
      let totalChars = 0;
      let duplicateChars = 0;
      let tmMatchChars = 0;

      const fileStatsMap = new Map<string, {
          fileId: string;
          fileName: string;
          totalSegments: number;
          totalChars: number;
          internalDuplicates: number;
          internalDuplicateChars: number;
          crossFileDuplicates: number;
          crossFileDuplicateChars: number;
          tmExactMatches: number;
          tmMatchChars: number;
          uniqueSegments: number;
          uniqueChars: number;
      }>();

      project.files.forEach(file => {
          const fileTotalChars = file.segments.reduce((acc, s) => acc + countBillableChars(s.sourceText), 0);
          fileStatsMap.set(file.id, {
              fileId: file.id,
              fileName: file.name,
              totalSegments: file.segments.length,
              totalChars: fileTotalChars,
              internalDuplicates: 0,
              internalDuplicateChars: 0,
              crossFileDuplicates: 0,
              crossFileDuplicateChars: 0,
              tmExactMatches: 0,
              tmMatchChars: 0,
              uniqueSegments: 0,
              uniqueChars: 0
          });
          totalSegments += file.segments.length;
          totalChars += fileTotalChars;
      });

      textToLocations.forEach((locations) => {
          if (locations.length > 1) {
              duplicateGroups.push({
                  sourceText: project.files.find(f => f.id === locations[0].fileId)?.segments.find(s => s.id === locations[0].segmentId)?.sourceText || '',
                  occurrences: locations.map(l => ({
                      segmentId: l.segmentId,
                      fileId: l.fileId,
                      fileName: l.fileName,
                      isLocked: l.isLocked
                  }))
              });
          }
      });

      // 译马网口径：按文件独立计新字；仅扣减「文件内第 2 次及以后」重复与 TM 匹配。
      // 跨文件重复仅作参考，不从新字中扣除。
      const projectTextCounts = new Map<string, number>();

      project.files.forEach(file => {
          const stats = fileStatsMap.get(file.id);
          if (!stats) return;

          const fileTextCounts = new Map<string, number>();

          file.segments.forEach(segment => {
              const normalizedText = normalizeKey(segment.sourceText);
              if (!normalizedText) return;

              const charLen = countBillableChars(segment.sourceText);
              const fileOccurrence = fileTextCounts.get(normalizedText) ?? 0;
              fileTextCounts.set(normalizedText, fileOccurrence + 1);

              const projectOccurrence = projectTextCounts.get(normalizedText) ?? 0;
              projectTextCounts.set(normalizedText, projectOccurrence + 1);

              const tmMatch = tmSourceMap.get(normalizedText);
              if (tmMatch) {
                  tmExactMatches++;
                  tmMatchChars += charLen;
                  stats.tmExactMatches++;
                  stats.tmMatchChars += charLen;
                  tmMatches.push({
                      segmentId: segment.id,
                      fileId: file.id,
                      fileName: file.name,
                      sourceText: segment.sourceText,
                      tmTarget: tmMatch.target,
                      tmName: tmMatch.tmName
                  });
                  return;
              }

              if (fileOccurrence > 0) {
                  internalDuplicates++;
                  duplicateSegments++;
                  duplicateChars += charLen;
                  stats.internalDuplicates++;
                  stats.internalDuplicateChars += charLen;
                  return;
              }

              stats.uniqueSegments++;
              stats.uniqueChars += charLen;

              if (projectOccurrence > 0) {
                  crossFileDuplicates++;
                  stats.crossFileDuplicates++;
                  stats.crossFileDuplicateChars += charLen;
              }
          });
      });

      const fileStats = Array.from(fileStatsMap.values());

      const uniqueSegments = totalSegments - duplicateSegments - tmExactMatches;
      const duplicateRate = totalSegments > 0 ? Math.round((duplicateSegments / totalSegments) * 100) : 0;
      const duplicateCharRate = totalChars > 0 ? Math.round((duplicateChars / totalChars) * 100) : 0;
      const tmMatchRate = totalSegments > 0 ? Math.round((tmExactMatches / totalSegments) * 100) : 0;

      return {
          totalSegments,
          uniqueSegments,
          duplicateSegments,
          duplicateRate,
          totalChars,
          duplicateChars,
          duplicateCharRate,
          internalDuplicates,
          crossFileDuplicates,
          tmExactMatches,
          tmMatchRate,
          tmMatchChars,
          lockedByAnalysis: 0,
          fileStats,
          duplicateGroups,
          tmMatches
      };
  };

  const exportDuplicateReport = (result: DuplicateAnalysisResult, projectName: string) => {
      const lines: string[] = [];
      
      lines.push('重复率分析报告');
      lines.push(`项目名称: ${projectName}`);
      lines.push(`导出时间: ${new Date().toLocaleString()}`);
      lines.push('');
      lines.push('=== 总体统计 ===');
      lines.push(`总句段数: ${result.totalSegments}`);
      lines.push(`总字数: ${result.totalChars.toLocaleString()}`);
      lines.push(`唯一句段: ${result.uniqueSegments}`);
      lines.push(`重复句段: ${result.duplicateSegments}`);
      lines.push(`重复句段率: ${result.duplicateRate}%`);
      lines.push(`重复字数: ${result.duplicateChars.toLocaleString()}`);
      lines.push(`重复字数率: ${result.duplicateCharRate}%`);
      lines.push(`文件内重复句段: ${result.internalDuplicates}`);
      lines.push(`跨文件重复句段: ${result.crossFileDuplicates}`);
      lines.push(`TM匹配句段: ${result.tmExactMatches}`);
      lines.push(`TM匹配率: ${result.tmMatchRate}%`);
      lines.push(`TM匹配字数: ${result.tmMatchChars.toLocaleString()}`);
      lines.push('');
      
      if (result.fileStats.length > 0) {
          lines.push('=== 各文件统计 ===');
          lines.push('文件名\t总句段\t字数\t文件内重复(字)\t跨文件重复(字)\tTM匹配(字)\t新字(字)');
          result.fileStats.forEach(stat => {
              lines.push(`${stat.fileName}\t${stat.totalSegments}\t${stat.totalChars.toLocaleString()}\t${stat.internalDuplicateChars.toLocaleString()}\t${stat.crossFileDuplicateChars.toLocaleString()}\t${stat.tmMatchChars.toLocaleString()}\t${stat.uniqueChars.toLocaleString()}`);
          });
          lines.push('');
      }
      
      if (result.duplicateGroups.length > 0) {
          lines.push('=== 重复句段详情 ===');
          lines.push(`共 ${result.duplicateGroups.length} 组重复内容`);
          result.duplicateGroups.slice(0, 50).forEach((group, idx) => {
              lines.push(`\n[组 ${idx + 1}] 出现 ${group.occurrences.length} 次`);
              lines.push(`原文: ${group.sourceText.substring(0, 100)}${group.sourceText.length > 100 ? '...' : ''}`);
              group.occurrences.forEach(occ => {
                  lines.push(`  - ${occ.fileName} (ID: ${occ.segmentId})${occ.isLocked ? ' [已锁定]' : ''}`);
              });
          });
          if (result.duplicateGroups.length > 50) {
              lines.push(`\n... 还有 ${result.duplicateGroups.length - 50} 组重复内容未显示`);
          }
          lines.push('');
      }
      
      if (result.tmMatches.length > 0) {
          lines.push('=== TM匹配详情 ===');
          lines.push(`共 ${result.tmMatches.length} 个TM匹配句段`);
          result.tmMatches.slice(0, 30).forEach((match, idx) => {
              lines.push(`\n[匹配 ${idx + 1}]`);
              lines.push(`文件: ${match.fileName}`);
              lines.push(`原文: ${match.sourceText.substring(0, 80)}${match.sourceText.length > 80 ? '...' : ''}`);
              lines.push(`译文: ${match.tmTarget.substring(0, 80)}${match.tmTarget.length > 80 ? '...' : ''}`);
              lines.push(`来源: ${match.tmName}`);
          });
          if (result.tmMatches.length > 30) {
              lines.push(`\n... 还有 ${result.tmMatches.length - 30} 个TM匹配未显示`);
          }
      }
      
      const content = lines.join('\n');
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `重复率分析报告_${projectName}_${new Date().toISOString().slice(0, 10)}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
  };

  const handleOpenDuplicateModal = (projectId: string) => {
      const project = projects.find(p => p.id === projectId);
      if (project) {
          setDuplicateProjectId(projectId);
          setIsAnalyzingDuplicates(true);
          setIsDuplicateModalOpen(true);
          
          setTimeout(() => {
              const result = analyzeDuplicates(project, availableTMs);
              setDuplicateResult(result);
              setIsAnalyzingDuplicates(false);
          }, 100);
      }
  };

  const handleApplyDuplicateLocks = () => {
      if (!duplicateProjectId || !duplicateResult) return;

      const project = projects.find(p => p.id === duplicateProjectId);
      if (!project) return;

      const segmentsToLock = new Set<string>();
      const segmentsToLockWithTM = new Map<string, { target: string }>();
      const textToFirstSegment = new Map<string, string>();

      duplicateResult.duplicateGroups.forEach(group => {
          const firstOccurrence = group.occurrences[0];
          textToFirstSegment.set(group.sourceText.trim().toLowerCase(), firstOccurrence.segmentId);
          
          group.occurrences.forEach((occ, index) => {
              if (index > 0 && !occ.isLocked) {
                  segmentsToLock.add(occ.segmentId);
              }
          });
      });

      duplicateResult.tmMatches.forEach(match => {
          const segment = project.files
              .flatMap(f => f.segments)
              .find(s => s.id === match.segmentId);
          
          if (segment && !segment.isLocked && !segment.targetText.trim()) {
              segmentsToLockWithTM.set(match.segmentId, { target: match.tmTarget });
          }
      });

      if (segmentsToLock.size === 0 && segmentsToLockWithTM.size === 0) {
          alert('没有需要锁定的句段');
          return;
      }

      const updatedFiles = project.files.map(file => ({
          ...file,
          segments: file.segments.map(segment => {
              if (segmentsToLock.has(segment.id)) {
                  const firstSegId = textToFirstSegment.get(segment.sourceText.trim().toLowerCase());
                  const firstSegment = project.files
                      .flatMap(f => f.segments)
                      .find(s => s.id === firstSegId);
                  
                  return {
                      ...segment,
                      isLocked: true,
                      targetText: firstSegment?.targetText || segment.targetText,
                      status: firstSegment?.status || segment.status
                  };
              }
              
              if (segmentsToLockWithTM.has(segment.id)) {
                  const tmData = segmentsToLockWithTM.get(segment.id)!;
                  return {
                      ...segment,
                      isLocked: true,
                      targetText: tmData.target,
                      status: SegmentStatus.Confirmed,
                      matchType: MatchType.Exact
                  };
              }
              
              return segment;
          })
      }));

      let lockedCount = 0;
      let tmLockedCount = 0;
      updatedFiles.forEach(file => {
          file.segments.forEach(seg => {
              if (segmentsToLock.has(seg.id)) lockedCount++;
              if (segmentsToLockWithTM.has(seg.id)) tmLockedCount++;
          });
      });

      updatedFiles.forEach(file => {
          const confirmedCount = file.segments.filter(s => s.isLocked || s.status === SegmentStatus.Confirmed).length;
          file.progress = file.segments.length > 0 ? Math.round((confirmedCount / file.segments.length) * 100) : 0;
      });

      const totalSegments = updatedFiles.reduce((acc, f) => acc + f.totalSegments, 0);
      const totalProgress = updatedFiles.reduce((acc, f) => acc + (f.progress / 100 * f.totalSegments), 0);

      const updatedProject: Project = {
          ...project,
          files: updatedFiles,
          totalSegments,
          progress: totalSegments > 0 ? Math.round((totalProgress / totalSegments) * 100) : 0
      };

      onUpdateProject(updatedProject);
      
      const newResult = analyzeDuplicates(updatedProject, availableTMs);
      setDuplicateResult(newResult);
      
      const messages = [];
      if (lockedCount > 0) messages.push(`已锁定 ${lockedCount} 个重复句段`);
      if (tmLockedCount > 0) messages.push(`已锁定 ${tmLockedCount} 个TM匹配句段并填充翻译`);
      alert(messages.join('；'));
  };

  const confirmDelete = () => {
      if (projectToDelete) {
          onDeleteProject(projectToDelete);
          setDeleteModalOpen(false);
          setProjectToDelete(null);
      }
  };

  const handleSaveSettings = () => {
      if (!settingsProjectId || !settingsProject || !onUpdateProject) return;

      const trimmedName = settingsProjectName.trim();
      if (!trimmedName) {
          alert('请输入项目名称');
          return;
      }

      // Combine main + reference IDs
      const allTbIds = new Set<string>();
      if (settingsMainTbId) allTbIds.add(settingsMainTbId);
      settingsReferenceTbIds.forEach(id => allTbIds.add(id));

      const allTmIds = new Set<string>();
      if (settingsMainTmId) allTmIds.add(settingsMainTmId);
      settingsReferenceTmIds.forEach(id => allTmIds.add(id));

      // Create updated project
      const updatedProject: Project = {
          ...settingsProject,
          name: trimmedName,
          isCompleted: settingsProjectCompleted,
          deliveryDueReminderEnabled: settingsDeliveryReminderEnabled,
          mainTbId: settingsMainTbId,
          tbIds: Array.from(allTbIds),
          mainTmId: settingsMainTmId,
          tmIds: Array.from(allTmIds),
          grammarRuleBookIds: Array.from(settingsGrammarRuleBookIds),
          regexDictionaryBookIds: Array.from(settingsRegexDictionaryBookIds)
      };

      const dueTrim = settingsDeliveryDueAt.trim();
      if (dueTrim) {
          updatedProject.deliveryDueAt = dueTrim;
          delete updatedProject.deliveryDueDate;
      } else {
          delete updatedProject.deliveryDueAt;
          delete updatedProject.deliveryDueDate;
      }

      // Update project using callback
      onUpdateProject(updatedProject);
      
      // Close modal
      setIsSettingsModalOpen(false);
      setSettingsProjectId(null);
      setSettingsProject(null);
  };

  const promptDelete = (id: string) => {
      setProjectToDelete(id);
      setDeleteModalOpen(true);
  };

  const targetProjectForFiles = projects.find(p => p.id === targetProjectId);

  const settingsMatchingGrammarBooks = settingsProject
      ? availableGrammarRuleBooks.filter(
            (g) => g.sourceLang === settingsProject.sourceLang && g.targetLang === settingsProject.targetLang
        )
      : [];

  const toggleSettingsGrammarBook = (id: string) => {
      const next = new Set(settingsGrammarRuleBookIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSettingsGrammarRuleBookIds(next);
  };

  const settingsMatchingRegexDictionaryBooks = settingsProject
      ? availableRegexDictionaryBooks.filter(
            (b) => b.sourceLang === settingsProject.sourceLang && b.targetLang === settingsProject.targetLang
        )
      : [];

  const toggleSettingsRegexDictionaryBook = (id: string) => {
      const next = new Set(settingsRegexDictionaryBookIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSettingsRegexDictionaryBookIds(next);
  };

  return (
    <div className="h-full overflow-y-auto bg-white">
      {/* Header */}
      <div className="border-b border-slate-200 px-6">
        <div className="py-4 text-sm font-medium text-blue-600">
          我创建的项目 ({projects.length})
        </div>
      </div>

      {/* Toolbar */}
      <div className="px-6 py-4 border-b border-slate-100">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleOpenCreateModal}
            className="inline-flex items-center gap-1.5 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors shrink-0"
          >
            <Icons.Plus className="w-4 h-4" />
            创建项目
          </button>

          <select
            value={searchField}
            onChange={(e) => setSearchField(e.target.value as SearchField)}
            className="h-9 rounded border border-slate-200 bg-white px-2 text-sm text-slate-700 outline-none focus:border-blue-400"
          >
            <option value="name">项目名称</option>
          </select>

          <input
            type="text"
            value={localSearchInput}
            onChange={(e) => setLocalSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleApplyFilters()}
            placeholder="请输入项目名称"
            className="h-9 w-44 rounded border border-slate-200 px-3 text-sm text-slate-700 outline-none focus:border-blue-400 sm:w-52"
          />

          <select
            value={dateField}
            onChange={(e) => setDateField(e.target.value as DateField)}
            className="h-9 rounded border border-slate-200 bg-white px-2 text-sm text-slate-700 outline-none focus:border-blue-400"
          >
            <option value="created">创建日期</option>
            <option value="delivery">交付日期</option>
          </select>

          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={dateStart}
              onChange={(e) => setDateStart(e.target.value)}
              className="h-9 rounded border border-slate-200 px-2 text-sm text-slate-600 outline-none focus:border-blue-400"
              title="开始日期"
            />
            <span className="text-slate-400 text-sm">至</span>
            <input
              type="date"
              value={dateEnd}
              onChange={(e) => setDateEnd(e.target.value)}
              className="h-9 rounded border border-slate-200 px-2 text-sm text-slate-600 outline-none focus:border-blue-400"
              title="结束日期"
            />
          </div>

          <button
            type="button"
            onClick={handleResetFilters}
            className="h-9 rounded border border-slate-200 bg-white px-4 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
          >
            重置
          </button>
          <button
            type="button"
            onClick={handleApplyFilters}
            className="h-9 rounded bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            确定
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="px-6 pb-8">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-sm text-slate-500">
                <th className="px-4 py-3 font-normal whitespace-nowrap">
                  <span className="inline-flex items-center gap-1">
                    项目名称 (类型)
                    <Icons.ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                  </span>
                </th>
                <th className="px-4 py-3 font-normal whitespace-nowrap">LQA标准</th>
                <th className="px-4 py-3 font-normal whitespace-nowrap">项目经理</th>
                <th className="px-4 py-3 font-normal whitespace-nowrap">
                  <span className="inline-flex items-center gap-1">
                    语言对
                    <Icons.ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                  </span>
                </th>
                <th className="px-4 py-3 font-normal whitespace-nowrap">日期</th>
                <th className="px-4 py-3 font-normal whitespace-nowrap">交付日期</th>
                <th className="px-4 py-3 font-normal whitespace-nowrap">完成进度</th>
                <th className="px-4 py-3 font-normal whitespace-nowrap">参与人</th>
                <th className="px-4 py-3 font-normal whitespace-nowrap text-right">
                  <span className="inline-flex items-center gap-2 justify-end">
                    操作
                    <button type="button" className="text-slate-400 hover:text-slate-600" title="列设置" aria-label="列设置">
                      <Icons.Settings className="w-4 h-4" />
                    </button>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredProjects.length > 0 ? (
                filteredProjects.map((project) => {
                  const mainTb = project.mainTbId
                    ? availableTBs.find((t) => t.id === project.mainTbId)
                    : undefined;
                  const hasXliff =
                    project.tradosPackage?.packageBlobId ||
                    project.files.some(
                      (f) =>
                        f.interchangeFormat === 'sdlxliff' ||
                        f.name.toLowerCase().includes('.sdlxliff') ||
                        f.segments.some((s) => s.xliffSegmentId)
                    );
                  const hasMqXliff =
                    project.memoqPackage?.packageBlobId ||
                    project.files.some(
                      (f) =>
                        f.interchangeFormat === 'mqxliff' ||
                        f.name.toLowerCase().includes('.mqxliff')
                    );
                  return (
                    <ProjectTableRow
                      key={project.id}
                      project={project}
                      mainTbName={mainTb?.name}
                      onOpen={() => onOpenProject(project.id)}
                      onDelete={() => promptDelete(project.id)}
                      onManageFiles={() => handleOpenFilesModal(project.id)}
                      onSettings={() => handleOpenSettingsModal(project.id)}
                      onAnalyzeDuplicates={() => handleOpenDuplicateModal(project.id)}
                      onExportSdlxliff={
                        onTradosQuickExport && hasXliff
                          ? () => onTradosQuickExport(project.id, 'sdlxliff')
                          : undefined
                      }
                      onExportSdlrpx={
                        onTradosQuickExport && project.tradosPackage
                          ? () => onTradosQuickExport(project.id, 'sdlrpx')
                          : undefined
                      }
                      onExportMqxliff={
                        onMemoqQuickExport && hasMqXliff
                          ? () => onMemoqQuickExport(project.id, 'mqxliff')
                          : undefined
                      }
                      onExportMqxlz={
                        onMemoqQuickExport && project.memoqPackage
                          ? () => onMemoqQuickExport(project.id, 'mqxlz')
                          : undefined
                      }
                      menuOpen={openMenuId === project.id}
                      onMenuToggle={() =>
                        setOpenMenuId((id) => (id === project.id ? null : project.id))
                      }
                      onMenuClose={() => setOpenMenuId(null)}
                    />
                  );
                })
              ) : (
                <tr>
                  <td colSpan={9} className="px-4 py-16 text-center text-slate-400">
                    <Icons.Search className="w-10 h-10 mx-auto mb-3 opacity-20" />
                    <p className="text-sm">
                      {combinedSearch || appliedDateStart || appliedDateEnd
                        ? '未找到匹配的项目'
                        : '暂无项目，点击「创建项目」开始'}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ProjectCreateWizard
        isOpen={isModalOpen}
        availableTMs={availableTMs}
        availableTBs={availableTBs}
        availableGrammarRuleBooks={availableGrammarRuleBooks}
        availableRegexDictionaryBooks={availableRegexDictionaryBooks}
        onCreateProject={onCreateProject}
        onClose={() => setIsModalOpen(false)}
      />

      {/* Files Manager Modal (List + Add) */}
      {isFilesModalOpen && targetProjectForFiles && (
           <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
               <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 animate-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col overflow-hidden">
                    <div className="flex justify-between items-center mb-4 shrink-0">
                        <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                            <Icons.File className="w-5 h-5 text-blue-600"/>
                            项目文件管理
                        </h2>
                        <button onClick={handleCloseFilesModal} className="text-slate-400 hover:text-slate-600" type="button" aria-label="关闭">
                            <Icons.X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Existing Files List */}
                    <div className="flex-1 min-h-0 overflow-y-auto bg-slate-50 border border-slate-200 rounded-xl p-3 mb-4">
                        <h3 className="text-xs font-bold text-slate-400 uppercase mb-3">现有文件 ({targetProjectForFiles.files.length})</h3>
                        <div className="space-y-2">
                            {targetProjectForFiles.files.map((file, idx) => (
                                <div key={file.id} className="bg-white p-3 rounded-lg border border-slate-200 flex justify-between items-center shadow-sm">
                                    <div className="flex items-center gap-3 overflow-hidden">
                                        <div className="bg-blue-50 p-1.5 rounded text-blue-600">
                                            <Icons.File className="w-4 h-4" />
                                        </div>
                                        <div className="flex flex-col min-w-0">
                                            <span className="text-sm font-medium text-slate-700 truncate">{file.name}</span>
                                            <span className="text-[10px] text-slate-400">{file.totalSegments} 句段 • {file.progress}% 完成</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <button 
                                            onClick={() => handleOpenSplitModal(file)}
                                            className="p-1.5 text-slate-400 hover:bg-amber-50 hover:text-amber-500 rounded transition-colors"
                                            title="拆分文件"
                                        >
                                            <Icons.Scissors className="w-4 h-4" />
                                        </button>
                                        <button 
                                            onClick={() => handleDeleteFile(targetProjectId!, file.id)}
                                            className="p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 rounded transition-colors"
                                            title="删除文件"
                                        >
                                            <Icons.Trash className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                            {targetProjectForFiles.files.length === 0 && (
                                <p className="text-center text-slate-400 text-sm py-4">暂无文件</p>
                            )}
                        </div>
                    </div>

                    {/* Add New File Section */}
                    <div className="shrink-0 border-t border-slate-100 pt-4">
                        <h3 className="text-xs font-bold text-slate-500 uppercase mb-2">上传新文件</h3>
                        <div
                            className={`border-2 border-dashed rounded-xl p-4 flex flex-col items-center justify-center cursor-pointer transition-colors ${
                                isParsing ? 'bg-slate-50 border-blue-400 cursor-wait' : 'border-slate-300 hover:bg-slate-50 hover:border-blue-400'
                            }`}
                            onClick={() => !isParsing && addFileInputRef.current?.click()}
                        >
                            {isParsing ? (
                                <Icons.Refresh className="w-5 h-5 mb-1 text-blue-500 animate-spin" />
                            ) : (
                                <Icons.Upload className="w-5 h-5 mb-1 text-slate-400" />
                            )}
                            <span className="text-xs text-slate-500 text-center truncate max-w-full px-2">
                                {isParsing && parsingFileName ? (
                                    <span className="text-blue-700 font-medium">正在导入 {parsingFileName}…</span>
                                ) : (
                                    '点击上传（含 XLIFF / SDLPPX）'
                                )}
                            </span>
                            <input
                                type="file"
                                accept=".txt,.docx,.pptx,.xlsx,.xls,.html,.htm,.idml,.sdlxliff,.mqxliff,.mqxlz,.sdlppx,.sdlrpx,.xlf"
                                ref={addFileInputRef}
                                onChange={handleSingleFileAddChange}
                                className="hidden"
                            />
                        </div>
                        {importFeedback && (
                            <p className="text-[10px] text-green-600 mt-2 flex items-center gap-1">
                                <Icons.Check className="w-3 h-3" />
                                {importFeedback}
                            </p>
                        )}
                        <p className="text-[10px] text-slate-400 mt-2">新导入文件将自动执行锁重与非译元素锁定。</p>
                    </div>

                    <div className="flex gap-3 shrink-0 pt-4 border-t border-slate-200">
                        <button
                            type="button"
                            onClick={handleCloseFilesModal}
                            className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                        >
                            取消
                        </button>
                        <button
                            type="button"
                            onClick={handleConfirmFilesModal}
                            className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-md transition-colors"
                        >
                            确定
                        </button>
                    </div>
               </div>
           </div>
      )}

      {/* File Split Modal */}
      {isSplitModalOpen && fileToSplit && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 animate-in zoom-in-95 duration-200">
                  <div className="flex justify-between items-center mb-4">
                      <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                          <Icons.Scissors className="w-5 h-5 text-amber-500"/>
                          拆分文件
                      </h2>
                      <button onClick={() => setIsSplitModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                          <Icons.X className="w-5 h-5" />
                      </button>
                  </div>

                  <div className="mb-4 p-3 bg-slate-50 rounded-lg">
                      <div className="flex items-center gap-2">
                          <Icons.File className="w-4 h-4 text-blue-500" />
                          <span className="text-sm font-medium text-slate-700">{fileToSplit.name}</span>
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                          共 {fileToSplit.totalSegments} 句段，约 {fileToSplit.segments.reduce((acc, s) => acc + s.sourceText.length, 0).toLocaleString()} 字符
                      </div>
                  </div>

                  <div className="space-y-4">
                      <div>
                          <label className="block text-sm font-medium text-slate-700 mb-2">拆分方式</label>
                          <div className="flex gap-2">
                              <button
                                  onClick={() => setSplitMode('parts')}
                                  className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                                      splitMode === 'parts' 
                                          ? 'bg-amber-500 text-white' 
                                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                  }`}
                              >
                                  按份数
                              </button>
                              <button
                                  onClick={() => setSplitMode('chars')}
                                  className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                                      splitMode === 'chars' 
                                          ? 'bg-amber-500 text-white' 
                                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                  }`}
                              >
                                  按字数
                              </button>
                          </div>
                      </div>

                      {splitMode === 'parts' ? (
                          <div>
                              <label className="block text-sm font-medium text-slate-700 mb-2">
                                  拆分份数: <span className="text-amber-600 font-bold">{splitPartsCount}</span> 份
                              </label>
                              <input
                                  type="range"
                                  min="2"
                                  max="10"
                                  value={splitPartsCount}
                                  onChange={(e) => setSplitPartsCount(parseInt(e.target.value))}
                                  className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-amber-500"
                              />
                              <div className="flex justify-between text-xs text-slate-400 mt-1">
                                  <span>2份</span>
                                  <span>10份</span>
                              </div>
                              <p className="text-xs text-slate-500 mt-2">
                                  每份约 {Math.ceil(fileToSplit.totalSegments / splitPartsCount)} 句段
                              </p>
                          </div>
                      ) : (
                          <div>
                              <label className="block text-sm font-medium text-slate-700 mb-2">
                                  每份字数上限
                              </label>
                              <input
                                  type="number"
                                  min="100"
                                  max="100000"
                                  step="500"
                                  value={splitCharsCount}
                                  onChange={(e) => setSplitCharsCount(parseInt(e.target.value) || 5000)}
                                  className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                              />
                              <p className="text-xs text-slate-500 mt-2">
                                  预计拆分为约 {Math.ceil(fileToSplit.segments.reduce((acc, s) => acc + s.sourceText.length, 0) / splitCharsCount)} 份
                              </p>
                          </div>
                      )}
                  </div>

                  <div className="flex gap-3 mt-6">
                      <button 
                          onClick={() => setIsSplitModalOpen(false)}
                          className="flex-1 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
                      >
                          取消
                      </button>
                      <button 
                          onClick={handleSplitFile}
                          className="flex-1 px-4 py-2 text-sm font-medium text-white bg-amber-500 hover:bg-amber-600 rounded-lg shadow-md shadow-amber-500/20"
                      >
                          确认拆分
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* Duplicate Analysis Modal */}
      {isDuplicateModalOpen && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl p-6 animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
                  <div className="flex justify-between items-center mb-6">
                      <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                          <Icons.Copy className="w-5 h-5 text-purple-600"/>
                          重复率分析报告
                      </h2>
                      <button onClick={() => setIsDuplicateModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                          <Icons.X className="w-5 h-5" />
                      </button>
                  </div>

                  {isAnalyzingDuplicates ? (
                      <div className="flex flex-col items-center justify-center py-12">
                          <Icons.Refresh className="w-8 h-8 text-purple-500 animate-spin mb-4" />
                          <p className="text-slate-500">正在分析重复内容...</p>
                      </div>
                  ) : duplicateResult ? (
                      <div className="space-y-6">
                          {/* Summary Stats */}
                          <div className="grid grid-cols-5 gap-3">
                              <div className="bg-slate-50 rounded-xl p-4 text-center">
                                  <div className="text-2xl font-bold text-slate-900">{duplicateResult.totalSegments}</div>
                                  <div className="text-xs text-slate-500 mt-1">总句段数</div>
                                  <div className="text-xs text-slate-400 mt-0.5">{duplicateResult.totalChars.toLocaleString()} 字</div>
                              </div>
                              <div className="bg-green-50 rounded-xl p-4 text-center">
                                  <div className="text-2xl font-bold text-green-600">{duplicateResult.uniqueSegments}</div>
                                  <div className="text-xs text-slate-500 mt-1">唯一句段</div>
                              </div>
                              <div className="bg-amber-50 rounded-xl p-4 text-center">
                                  <div className="text-2xl font-bold text-amber-600">{duplicateResult.duplicateSegments}</div>
                                  <div className="text-xs text-slate-500 mt-1">重复句段</div>
                                  <div className="text-xs text-amber-500 mt-0.5">{duplicateResult.duplicateChars.toLocaleString()} 字</div>
                              </div>
                              <div className="bg-teal-50 rounded-xl p-4 text-center">
                                  <div className="text-2xl font-bold text-teal-600">{duplicateResult.tmExactMatches}</div>
                                  <div className="text-xs text-slate-500 mt-1">TM匹配</div>
                                  <div className="text-xs text-teal-500 mt-0.5">{duplicateResult.tmMatchChars.toLocaleString()} 字</div>
                              </div>
                              <div className="bg-purple-50 rounded-xl p-4 text-center">
                                  <div className="text-2xl font-bold text-purple-600">{duplicateResult.duplicateRate}%</div>
                                  <div className="text-xs text-slate-500 mt-1">句段重复率</div>
                                  <div className="text-xs text-purple-400 mt-0.5">字数 {duplicateResult.duplicateCharRate}%</div>
                              </div>
                          </div>

                          {/* Duplicate Type Breakdown */}
                          <div className="bg-slate-50 rounded-xl p-4">
                              <h3 className="text-sm font-bold text-slate-700 mb-3">内容分析</h3>
                              <div className="grid grid-cols-3 gap-4">
                                  <div className="flex items-center gap-3">
                                      <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                                      <div>
                                          <div className="text-sm font-medium text-slate-700">文件内重复</div>
                                          <div className="text-xs text-slate-500">{duplicateResult.internalDuplicates} 个句段</div>
                                      </div>
                                  </div>
                                  <div className="flex items-center gap-3">
                                      <div className="w-3 h-3 bg-orange-500 rounded-full"></div>
                                      <div>
                                          <div className="text-sm font-medium text-slate-700">跨文件重复</div>
                                          <div className="text-xs text-slate-500">{duplicateResult.crossFileDuplicates} 个句段</div>
                                      </div>
                                  </div>
                                  <div className="flex items-center gap-3">
                                      <div className="w-3 h-3 bg-teal-500 rounded-full"></div>
                                      <div>
                                          <div className="text-sm font-medium text-slate-700">TM 100%匹配</div>
                                          <div className="text-xs text-slate-500">{duplicateResult.tmExactMatches} 个句段 ({duplicateResult.tmMatchRate}%)</div>
                                      </div>
                                  </div>
                              </div>
                          </div>

                          {/* File Stats Table */}
                          {duplicateResult.fileStats.length > 1 && (
                              <div>
                                  <h3 className="text-sm font-bold text-slate-700 mb-3">各文件统计</h3>
                                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                                      <table className="w-full text-sm">
                                          <thead className="bg-slate-50">
                                              <tr>
                                                  <th className="text-left p-3 font-medium text-slate-600">文件名</th>
                                                  <th className="text-center p-3 font-medium text-slate-600">总句段</th>
                                                  <th className="text-center p-3 font-medium text-slate-600">字数</th>
                                                  <th className="text-center p-3 font-medium text-slate-600">文件内重复(字)</th>
                                                  <th className="text-center p-3 font-medium text-slate-600">跨文件重复(字)</th>
                                                  <th className="text-center p-3 font-medium text-slate-600">TM匹配(字)</th>
                                                  <th className="text-center p-3 font-medium text-slate-600">新字(字)</th>
                                              </tr>
                                          </thead>
                                          <tbody>
                                              {duplicateResult.fileStats.map((stat, idx) => (
                                                  <tr key={stat.fileId} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                                                      <td className="p-3 text-slate-700 truncate max-w-[150px]">{stat.fileName}</td>
                                                      <td className="p-3 text-center text-slate-600">{stat.totalSegments}</td>
                                                      <td className="p-3 text-center text-slate-500 text-xs">{stat.totalChars.toLocaleString()}</td>
                                                      <td className="p-3 text-center text-blue-600 text-xs">{stat.internalDuplicateChars.toLocaleString()}</td>
                                                      <td className="p-3 text-center text-orange-600 text-xs">{stat.crossFileDuplicateChars.toLocaleString()}</td>
                                                      <td className="p-3 text-center text-teal-600 text-xs">{stat.tmMatchChars.toLocaleString()}</td>
                                                      <td className="p-3 text-center text-green-600 text-xs">{stat.uniqueChars.toLocaleString()}</td>
                                                  </tr>
                                              ))}
                                          </tbody>
                                      </table>
                                  </div>
                              </div>
                          )}

                          {/* TM Matches Preview */}
                          {duplicateResult.tmMatches.length > 0 && (
                              <div>
                                  <h3 className="text-sm font-bold text-slate-700 mb-3">
                                      TM匹配预览 
                                      <span className="text-slate-400 font-normal ml-2">({duplicateResult.tmMatches.length} 个)</span>
                                  </h3>
                                  <div className="border border-slate-200 rounded-xl max-h-48 overflow-y-auto">
                                      {duplicateResult.tmMatches.slice(0, 15).map((match, idx) => (
                                          <div key={idx} className="p-3 border-b border-slate-100 last:border-b-0">
                                              <div className="text-sm text-slate-700 line-clamp-1 mb-1">
                                                  <span className="text-teal-600 font-medium">源:</span> {match.sourceText}
                                              </div>
                                              <div className="text-sm text-slate-600 line-clamp-1 mb-1">
                                                  <span className="text-green-600 font-medium">译:</span> {match.tmTarget}
                                              </div>
                                              <div className="flex items-center gap-2 text-[10px]">
                                                  <span className="bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full">{match.tmName}</span>
                                                  <span className="text-slate-400">{match.fileName}</span>
                                              </div>
                                          </div>
                                      ))}
                                      {duplicateResult.tmMatches.length > 15 && (
                                          <div className="p-3 text-center text-slate-400 text-sm">
                                              还有 {duplicateResult.tmMatches.length - 15} 个匹配未显示...
                                          </div>
                                      )}
                                  </div>
                              </div>
                          )}

                          {/* Duplicate Groups Preview */}
                          {duplicateResult.duplicateGroups.length > 0 && (
                              <div>
                                  <h3 className="text-sm font-bold text-slate-700 mb-3">
                                      重复内容预览 
                                      <span className="text-slate-400 font-normal ml-2">({duplicateResult.duplicateGroups.length} 组)</span>
                                  </h3>
                                  <div className="border border-slate-200 rounded-xl max-h-60 overflow-y-auto">
                                      {duplicateResult.duplicateGroups.slice(0, 20).map((group, idx) => (
                                          <div key={idx} className="p-3 border-b border-slate-100 last:border-b-0">
                                              <div className="text-sm text-slate-700 line-clamp-2 mb-2">{group.sourceText}</div>
                                              <div className="flex flex-wrap gap-1">
                                                  {group.occurrences.map((occ, occIdx) => (
                                                      <span 
                                                          key={occIdx}
                                                          className={`text-[10px] px-2 py-0.5 rounded-full ${
                                                              occIdx === 0 
                                                                  ? 'bg-green-100 text-green-700' 
                                                                  : occ.isLocked 
                                                                      ? 'bg-slate-200 text-slate-500' 
                                                                      : 'bg-amber-100 text-amber-700'
                                                          }`}
                                                      >
                                                          {occ.fileName}
                                                          {occIdx === 0 ? ' (首次)' : occ.isLocked ? ' (已锁定)' : ''}
                                                      </span>
                                                  ))}
                                              </div>
                                          </div>
                                      ))}
                                      {duplicateResult.duplicateGroups.length > 20 && (
                                          <div className="p-3 text-center text-slate-400 text-sm">
                                              还有 {duplicateResult.duplicateGroups.length - 20} 组未显示...
                                          </div>
                                      )}
                                  </div>
                              </div>
                          )}

                          {/* Action Buttons */}
                          <div className="flex gap-3 pt-4 border-t border-slate-200">
                              <button 
                                  onClick={() => setIsDuplicateModalOpen(false)}
                                  className="flex-1 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
                              >
                                  关闭
                              </button>
                              <button 
                                  onClick={() => {
                                      const project = projects.find(p => p.id === duplicateProjectId);
                                      if (project && duplicateResult) {
                                          exportDuplicateReport(duplicateResult, project.name);
                                      }
                                  }}
                                  className="flex-1 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg flex items-center justify-center gap-2"
                              >
                                  <Icons.Download className="w-4 h-4" />
                                  导出报告
                              </button>
                              <button 
                                  onClick={handleApplyDuplicateLocks}
                                  className="flex-1 px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg shadow-md shadow-purple-500/20 flex items-center justify-center gap-2"
                              >
                                  <Icons.Lock className="w-4 h-4" />
                                  锁定重复句段
                              </button>
                          </div>
                      </div>
                  ) : null}
              </div>
          </div>
      )}

      {/* Delete Project Confirmation Modal */}
      {deleteModalOpen && (
           <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-in zoom-in-95 duration-200">
                <div className="flex flex-col items-center text-center">
                    <div className="w-12 h-12 bg-red-100 text-red-500 rounded-full flex items-center justify-center mb-4">
                        <Icons.Trash className="w-6 h-6" />
                    </div>
                    <h2 className="text-lg font-bold text-slate-900 mb-2">删除项目</h2>
                    <p className="text-sm text-slate-500 mb-6">
                        您确定要删除此项目吗？项目关联的记忆库和术语库数据<b>保留</b>。
                    </p>
                    <div className="flex gap-3 w-full">
                        <button 
                            onClick={() => setDeleteModalOpen(false)}
                            className="flex-1 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
                        >
                            取消
                        </button>
                        <button 
                            onClick={confirmDelete}
                            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg shadow-md shadow-red-500/20"
                        >
                            确认删除
                        </button>
                    </div>
                </div>
            </div>
           </div>
      )}

      {/* Project Settings Modal */}
      {isSettingsModalOpen && settingsProject && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
                  <div className="flex justify-between items-center px-6 pt-6 pb-0 shrink-0">
                      <h2 className="text-xl font-bold text-slate-900">项目设置</h2>
                      <button onClick={() => setIsSettingsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                          <Icons.X className="w-5 h-5" />
                      </button>
                  </div>

                  <div className="flex gap-6 px-6 border-b border-slate-200 shrink-0 mt-4">
                      {(
                          [
                              { id: 'info' as const, label: '项目信息' },
                              { id: 'terminology' as const, label: '术语库' },
                              { id: 'memory' as const, label: '记忆库' },
                              { id: 'dictionaries' as const, label: '词典' },
                          ] as const
                      ).map((tab) => (
                          <button
                              key={tab.id}
                              type="button"
                              onClick={() => setSettingsTab(tab.id)}
                              className={`relative pb-3 text-sm font-medium transition-colors ${
                                  settingsTab === tab.id
                                      ? 'text-blue-600'
                                      : 'text-slate-600 hover:text-slate-900'
                              }`}
                          >
                              {tab.label}
                              {settingsTab === tab.id && (
                                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 rounded-full" />
                              )}
                          </button>
                      ))}
                  </div>

                  <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
                      {settingsTab === 'info' && (
                          <div className="space-y-4">
                              <div>
                                  <label className="mb-2 block text-sm font-semibold text-slate-700">项目名称</label>
                                  <input
                                      type="text"
                                      value={settingsProjectName}
                                      onChange={(e) => setSettingsProjectName(e.target.value)}
                                      className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                      placeholder="输入项目名称"
                                      autoComplete="off"
                                  />
                              </div>
                              <div className="flex flex-wrap items-start gap-4">
                                  <div className="min-w-[200px] flex-1">
                                      <label className="mb-2 block text-sm font-semibold text-slate-700">交稿时间</label>
                                      <input
                                          type="datetime-local"
                                          step={60}
                                          value={settingsDeliveryDueAt}
                                          onChange={(e) => setSettingsDeliveryDueAt(e.target.value)}
                                          className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                      />
                                      <p className="mt-1 text-xs text-slate-400">
                                          留空表示未设置。开启「截止时间预警」且未勾选「项目已完成」时，翻译界面将按该时刻在截止前 7 天内分级提醒。
                                      </p>
                                  </div>
                                  <div className="flex shrink-0 flex-col gap-2 pt-8">
                                      <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                                          <input
                                              type="checkbox"
                                              checked={settingsDeliveryReminderEnabled}
                                              onChange={(e) => setSettingsDeliveryReminderEnabled(e.target.checked)}
                                              className="text-blue-600"
                                          />
                                          <span className="text-sm font-medium text-slate-800 whitespace-nowrap">
                                              截止时间预警
                                          </span>
                                      </label>
                                      {settingsDeliveryDueAt ? (
                                          <button
                                              type="button"
                                              onClick={() => setSettingsDeliveryDueAt('')}
                                              className="rounded-lg px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 self-start"
                                          >
                                              清除时间
                                          </button>
                                      ) : null}
                                  </div>
                              </div>
                              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                                  <input
                                      type="checkbox"
                                      checked={settingsProjectCompleted}
                                      onChange={(e) => setSettingsProjectCompleted(e.target.checked)}
                                      className="mt-0.5 text-emerald-600"
                                  />
                                  <span>
                                      <span className="block text-sm font-medium text-slate-800">项目已完成</span>
                                      <span className="mt-0.5 block text-xs text-slate-500">
                                          适用于已交稿或无需再跟进的任务；开启后翻译界面不再显示交稿倒计时提醒。
                                      </span>
                                  </span>
                              </label>
                          </div>
                      )}

                      {settingsTab === 'terminology' && (
                          <div className="space-y-4">
                              <div className="flex items-center gap-2 mb-1">
                                  <Icons.TermBase className="w-4 h-4 text-red-500" />
                                  <h3 className="text-sm font-semibold text-slate-800">术语库管理</h3>
                              </div>
                              <div>
                                  <label className="block text-xs font-bold text-red-600 mb-2">QA术语库 (唯一)</label>
                                  <select
                                      value={settingsMainTbId}
                                      onChange={(e) => setSettingsMainTbId(e.target.value)}
                                      className="w-full border border-slate-300 rounded-lg p-2.5 bg-white text-sm"
                                  >
                                      <option value="">无 (None)</option>
                                      {availableTBs.map((tb) => (
                                          <option key={tb.id} value={tb.id}>{tb.name}</option>
                                      ))}
                                  </select>
                                  <p className="text-xs text-slate-400 mt-1">QA检查时仅使用此术语库</p>
                              </div>
                              <div>
                                  <label className="block text-xs font-bold text-slate-500 mb-2">参考术语库</label>
                                  <div className="border border-slate-200 rounded-lg bg-white max-h-64 overflow-y-auto">
                                      {availableTBs.map((tb) => (
                                          <label key={tb.id} className="flex items-center gap-3 p-3 hover:bg-slate-50 border-b border-slate-100 last:border-b-0 cursor-pointer">
                                              <input
                                                  type="checkbox"
                                                  checked={settingsReferenceTbIds.has(tb.id)}
                                                  onChange={(e) => {
                                                      const newSet = new Set(settingsReferenceTbIds);
                                                      if (e.target.checked) newSet.add(tb.id);
                                                      else newSet.delete(tb.id);
                                                      setSettingsReferenceTbIds(newSet);
                                                  }}
                                                  className="text-slate-600"
                                                  disabled={tb.id === settingsMainTbId}
                                              />
                                              <div className="flex-1 min-w-0">
                                                  <div className="text-sm font-medium text-slate-800">{tb.name}</div>
                                                  <div className="text-xs text-slate-400">{tb.entries.length} 个条目</div>
                                              </div>
                                              {tb.id === settingsMainTbId && (
                                                  <span className="text-xs bg-red-100 text-red-600 px-2 py-1 rounded-full font-medium shrink-0">QA</span>
                                              )}
                                          </label>
                                      ))}
                                  </div>
                              </div>
                          </div>
                      )}

                      {settingsTab === 'memory' && (
                          <div className="space-y-4">
                              <div className="flex items-center gap-2 mb-1">
                                  <Icons.Database className="w-4 h-4 text-blue-500" />
                                  <h3 className="text-sm font-semibold text-slate-800">记忆库管理</h3>
                              </div>
                              <div>
                                  <label className="block text-xs font-bold text-blue-600 mb-2">可更新记忆库</label>
                                  <select
                                      value={settingsMainTmId}
                                      onChange={(e) => setSettingsMainTmId(e.target.value)}
                                      className="w-full border border-slate-300 rounded-lg p-2.5 bg-white text-sm"
                                  >
                                      <option value="">无 (None)</option>
                                      {availableTMs.map((tm) => (
                                          <option key={tm.id} value={tm.id}>{tm.name}</option>
                                      ))}
                                  </select>
                                  <p className="text-xs text-slate-400 mt-1">翻译过程中会更新此记忆库</p>
                              </div>
                              <div>
                                  <label className="block text-xs font-bold text-slate-500 mb-2">参考记忆库</label>
                                  <div className="border border-slate-200 rounded-lg bg-white max-h-64 overflow-y-auto">
                                      {availableTMs.map((tm) => (
                                          <label key={tm.id} className="flex items-center gap-3 p-3 hover:bg-slate-50 border-b border-slate-100 last:border-b-0 cursor-pointer">
                                              <input
                                                  type="checkbox"
                                                  checked={settingsReferenceTmIds.has(tm.id)}
                                                  onChange={(e) => {
                                                      const newSet = new Set(settingsReferenceTmIds);
                                                      if (e.target.checked) newSet.add(tm.id);
                                                      else newSet.delete(tm.id);
                                                      setSettingsReferenceTmIds(newSet);
                                                  }}
                                                  className="text-slate-600"
                                                  disabled={tm.id === settingsMainTmId}
                                              />
                                              <div className="flex-1 min-w-0">
                                                  <div className="text-sm font-medium text-slate-800">{tm.name}</div>
                                                  <div className="text-xs text-slate-400">{tm.units.length} 个条目</div>
                                              </div>
                                              {tm.id === settingsMainTmId && (
                                                  <span className="text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded-full font-medium shrink-0">可更新</span>
                                              )}
                                          </label>
                                      ))}
                                  </div>
                              </div>
                          </div>
                      )}

                      {settingsTab === 'dictionaries' && (
                          <div className="space-y-6">
                              <div>
                                  <div className="mb-3 flex items-center gap-2">
                                      <Icons.Concordance className="h-4 w-4 text-amber-600" />
                                      <h3 className="text-sm font-semibold text-slate-800">规则词典</h3>
                                  </div>
                                  <p className="mb-3 text-xs text-slate-500">
                                      勾选要在本项目中启用的规则词典（语言对须与项目一致）。未勾选则句段翻译不使用句式模板。
                                  </p>
                                  <div className="max-h-52 overflow-y-auto rounded-lg border border-slate-200 bg-white">
                                      {settingsMatchingGrammarBooks.length > 0 ? (
                                          settingsMatchingGrammarBooks.map((g) => (
                                              <label
                                                  key={g.id}
                                                  className="flex cursor-pointer items-center gap-3 border-b border-slate-100 p-3 last:border-b-0 hover:bg-slate-50"
                                              >
                                                  <input
                                                      type="checkbox"
                                                      checked={settingsGrammarRuleBookIds.has(g.id)}
                                                      onChange={() => toggleSettingsGrammarBook(g.id)}
                                                      className="text-amber-600"
                                                  />
                                                  <div className="min-w-0 flex-1">
                                                      <div className="text-sm font-medium text-slate-800">{g.name}</div>
                                                      <div className="text-xs text-slate-400">{g.rules.length} 条规则</div>
                                                  </div>
                                              </label>
                                          ))
                                      ) : (
                                          <p className="p-4 text-sm text-slate-400">无匹配语言对的规则词典</p>
                                      )}
                                  </div>
                              </div>

                              <div>
                                  <div className="mb-3 flex items-center gap-2">
                                      <Icons.RegexDict className="h-4 w-4 text-violet-600" />
                                      <h3 className="text-sm font-semibold text-slate-800">正则表达式词典</h3>
                                  </div>
                                  <p className="mb-3 text-xs text-slate-500">
                                      勾选要在本项目中启用的正则词典（语言对须与项目一致）。
                                  </p>
                                  <div className="max-h-52 overflow-y-auto rounded-lg border border-slate-200 bg-white">
                                      {settingsMatchingRegexDictionaryBooks.length > 0 ? (
                                          settingsMatchingRegexDictionaryBooks.map((g) => (
                                              <label
                                                  key={g.id}
                                                  className="flex cursor-pointer items-center gap-3 border-b border-slate-100 p-3 last:border-b-0 hover:bg-slate-50"
                                              >
                                                  <input
                                                      type="checkbox"
                                                      checked={settingsRegexDictionaryBookIds.has(g.id)}
                                                      onChange={() => toggleSettingsRegexDictionaryBook(g.id)}
                                                      className="text-violet-600"
                                                  />
                                                  <div className="min-w-0 flex-1">
                                                      <div className="text-sm font-medium text-slate-800">{g.name}</div>
                                                      <div className="text-xs text-slate-400">{g.entries.length} 条表达式</div>
                                                  </div>
                                              </label>
                                          ))
                                      ) : (
                                          <p className="p-4 text-sm text-slate-400">无匹配语言对的正则词典</p>
                                      )}
                                  </div>
                              </div>
                          </div>
                      )}
                  </div>

                  <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200 shrink-0">
                      <button
                        onClick={() => setIsSettingsModalOpen(false)}
                        className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
                      >
                          取消
                      </button>
                      <button
                        onClick={handleSaveSettings}
                        className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-md shadow-blue-500/20"
                      >
                          保存设置
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};