import React, { useState, useRef } from 'react';
import { Icons } from '../components/ui/Icons';
import { Project, SegmentStatus, MatchType, TermBase, TranslationMemory, ProjectFile, Segment, DuplicateAnalysisResult, GrammarRuleBook, RegexDictionaryBook } from '../types';
import { SUPPORTED_LANGUAGES } from '../constants';
import { shouldAutoLockSegmentAtImport } from '../services/segmentAutoLock';
import { toDatetimeLocalValue } from '../services/projectDueDate';
import * as XLSX from 'xlsx';
import { parseDocxForImport } from '../services/catInterop/bilingualDocxHandler';
import { newSourceBlobId, saveSourceBlob } from '../services/catInterop/sourceBlobStore';
import { okapiExtractFile, isOkapiCandidateFile } from '../services/okapiClient';
import { countBillableChars, normalizeForMatching } from '../utils/textNormalize';
import {
  parseXliffFile,
  parseTradosPackage,
  detectXliffKind,
  buildProjectFileFromParsed,
  type ParsedXliffProject,
} from '../services/xliff/xliffImport';

type UploadedFilePayload = {
  name: string;
  content: string;
  isExcel?: boolean;
  segments?: Array<{ source: string; target: string; okapiTuId?: string; inlineRunMeta?: import('../types').InlineRunStyle[] }>;
  sourceBlobId?: string;
  isXliff?: boolean;
  xliffProject?: ParsedXliffProject;
};

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
    sourceBlobId?: string
  ) => void;
  onDeleteFileFromProject: (projectId: string, fileId: string) => void;
  onDeleteProject: (id: string) => void;
  onUpdateProject: (project: Project) => void;
  searchQuery: string;
  onTradosQuickExport?: (projectId: string, kind: 'sdlxliff' | 'sdlrpx') => void;
}

const ProjectCard: React.FC<{
  project: Project;
  tmNames: string[];
  tbNames: string[];
  grNames: string[];
  rxNames: string[];
  onClick: () => void;
  onDelete: () => void;
  onManageFiles: () => void;
  onSettings: () => void;
  onAnalyzeDuplicates: () => void;
  onExportSdlxliff?: () => void;
  onExportSdlrpx?: () => void;
}> = ({ project, tmNames, tbNames, grNames, rxNames, onClick, onDelete, onManageFiles, onSettings, onAnalyzeDuplicates, onExportSdlxliff, onExportSdlrpx }) => {
  return (
    <div 
      onClick={onClick}
      className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 hover:shadow-xl hover:border-blue-200 transition-all cursor-pointer group relative overflow-hidden"
    >
      <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2 z-10">
         <button 
            onClick={(e) => { e.stopPropagation(); onManageFiles(); }}
            className="p-2 bg-slate-100 hover:bg-blue-50 text-slate-500 hover:text-blue-600 rounded-lg transition-colors"
            title="管理文件"
         >
             <Icons.File className="w-4 h-4" />
         </button>
         <button 
            onClick={(e) => { e.stopPropagation(); onSettings(); }}
            className="p-2 bg-slate-100 hover:bg-blue-50 text-slate-500 hover:text-blue-600 rounded-lg transition-colors"
            title="项目设置"
         >
             <Icons.Settings className="w-4 h-4" />
         </button>
         <button 
            onClick={(e) => { e.stopPropagation(); onAnalyzeDuplicates(); }}
            className="p-2 bg-slate-100 hover:bg-purple-50 text-slate-500 hover:text-purple-600 rounded-lg transition-colors"
            title="重复率分析"
         >
             <Icons.Copy className="w-4 h-4" />
         </button>
         {onExportSdlxliff && (
         <button
            onClick={(e) => { e.stopPropagation(); onExportSdlxliff(); }}
            className="p-2 bg-slate-100 hover:bg-emerald-50 text-slate-500 hover:text-emerald-600 rounded-lg transition-colors"
            title="导出 SDLXLIFF"
         >
             <Icons.Download className="w-4 h-4" />
         </button>
         )}
         {onExportSdlrpx && (
         <button
            onClick={(e) => { e.stopPropagation(); onExportSdlrpx(); }}
            className="p-2 bg-slate-100 hover:bg-amber-50 text-slate-500 hover:text-amber-600 rounded-lg transition-colors"
            title="导出 Trados 回传包 (SDLRPX)"
         >
             <Icons.Upload className="w-4 h-4" />
         </button>
         )}
         <button 
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-2 bg-slate-100 hover:bg-red-50 text-slate-500 hover:text-red-500 rounded-lg transition-colors"
            title="删除项目"
         >
             <Icons.Trash className="w-4 h-4" />
         </button>
      </div>

      <div className="mb-4">
        <div className="flex justify-between items-start mb-2">
           <div className="p-3 bg-blue-50 text-blue-600 rounded-xl mb-2 group-hover:scale-110 transition-transform origin-top-left">
             <Icons.File className="w-6 h-6" />
           </div>
        </div>
        <h3 className="font-bold text-lg text-slate-900 line-clamp-1 mb-1 group-hover:text-blue-600 transition-colors">{project.name}</h3>
        <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
           <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-600 uppercase tracking-wider">{project.sourceLang}</span>
           <Icons.ChevronRight className="w-3 h-3 text-slate-300" />
           <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-600 uppercase tracking-wider">{project.targetLang}</span>
        </div>
      </div>
      
      <div className="space-y-3">
        <div>
            <div className="flex justify-between text-xs mb-1.5">
                <span className="font-medium text-slate-500">进度 ({project.progress}%)</span>
                <span className="text-slate-400">{project.totalSegments} 句段</span>
            </div>
            <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                <div 
                    className="bg-blue-500 h-full rounded-full transition-all duration-500 ease-out group-hover:bg-blue-600" 
                    style={{ width: `${project.progress}%` }}
                />
            </div>
        </div>

        <div className="pt-4 border-t border-slate-100 grid grid-cols-2 gap-2 text-[10px] text-slate-500">
             <div className="flex flex-col gap-0.5" title={tmNames.join(', ')}>
                <div className="flex items-center gap-1.5">
                    <Icons.Database className={`w-3 h-3 ${tmNames.length > 0 ? 'text-blue-500' : 'text-slate-300'}`} />
                    <span className="font-bold text-slate-600">记忆库 ({tmNames.length})</span>
                </div>
                <span className="truncate pl-4.5 text-slate-400">{tmNames[0] || '无'} {tmNames.length > 1 ? `+${tmNames.length - 1}` : ''}</span>
             </div>
             <div className="flex flex-col gap-0.5" title={tbNames.join(', ')}>
                <div className="flex items-center gap-1.5">
                    <Icons.TermBase className={`w-3 h-3 ${tbNames.length > 0 ? 'text-red-500' : 'text-slate-300'}`} />
                    <span className="font-bold text-slate-600">术语库 ({tbNames.length})</span>
                </div>
                <span className="truncate pl-4.5 text-slate-400">{tbNames[0] || '无'} {tbNames.length > 1 ? `+${tbNames.length - 1}` : ''}</span>
             </div>
             <div className="col-span-2 grid grid-cols-2 gap-2 border-t border-slate-100 pt-2 mt-1">
                <div className="flex flex-col gap-0.5 min-w-0" title={grNames.join(', ')}>
                    <div className="flex items-center gap-1.5 min-w-0">
                        <Icons.Concordance className={`w-3 h-3 shrink-0 ${grNames.length > 0 ? 'text-amber-600' : 'text-slate-300'}`} />
                        <span className="font-bold text-slate-600">规则词典 ({grNames.length})</span>
                    </div>
                    <span className="truncate pl-4.5 text-slate-400">{grNames[0] || '无'} {grNames.length > 1 ? `+${grNames.length - 1}` : ''}</span>
                </div>
                <div className="flex flex-col gap-0.5 min-w-0" title={rxNames.join(', ')}>
                    <div className="flex items-center gap-1.5 min-w-0">
                        <Icons.RegexDict className={`w-3 h-3 shrink-0 ${rxNames.length > 0 ? 'text-violet-600' : 'text-slate-300'}`} />
                        <span className="font-bold text-slate-600">正则词典 ({rxNames.length})</span>
                    </div>
                    <span className="truncate pl-4.5 text-slate-400">{rxNames[0] || '无'} {rxNames.length > 1 ? `+${rxNames.length - 1}` : ''}</span>
                </div>
             </div>
        </div>
      </div>
    </div>
  );
};

export const Dashboard: React.FC<DashboardProps> = ({ 
    projects, availableTMs, availableTBs, availableGrammarRuleBooks, availableRegexDictionaryBooks,
    onOpenProject, onCreateProject, onAddFileToProject, onDeleteFileFromProject, onDeleteProject, onUpdateProject, searchQuery,
    onTradosQuickExport,
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

  // Form State
  const [newProjectName, setNewProjectName] = useState('');
  const [sourceLang, setSourceLang] = useState('en-US');
  const [targetLang, setTargetLang] = useState('zh-CN');
  
  // File State
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFilePayload[]>([]);
  const [isParsing, setIsParsing] = useState(false);

  // Resource Association State (Multi Select)
  const [mainTmId, setMainTmId] = useState<string>(''); 
  const [referenceTmIds, setReferenceTmIds] = useState<Set<string>>(new Set());

  const [mainTbId, setMainTbId] = useState<string>(''); 
  const [referenceTbIds, setReferenceTbIds] = useState<Set<string>>(new Set());

  const [grammarRuleBookIds, setGrammarRuleBookIds] = useState<Set<string>>(new Set());
  const [regexDictionaryBookIds, setRegexDictionaryBookIds] = useState<Set<string>>(new Set());
  
  // "Create New Resource" State
  const [newTmName, setNewTmName] = useState('');
  const [newTbName, setNewTbName] = useState('');

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

  const fileInputRef = useRef<HTMLInputElement>(null);
  const addFileInputRef = useRef<HTMLInputElement>(null);

  const filteredProjects = projects.filter(p => 
      p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleOpenCreateModal = () => {
      // Default to the first available or empty
      setMainTmId(availableTMs.length > 0 ? availableTMs[0].id : 'create-new');
      setReferenceTmIds(new Set());
      
      setMainTbId(availableTBs.length > 0 ? availableTBs[0].id : 'create-new');
      setReferenceTbIds(new Set());
      setGrammarRuleBookIds(new Set());
      setRegexDictionaryBookIds(new Set());

      setNewProjectName('');
      setUploadedFiles([]);
      setIsModalOpen(true);
  }
  
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

          setIsSettingsModalOpen(true);
      }
  };

  const parseFile = async (file: File): Promise<UploadedFilePayload> => {
       const xliffKind = detectXliffKind(file.name);
       if (xliffKind === 'package') {
          const xliffProject = await parseTradosPackage(file);
          return {
            name: file.name,
            content: '',
            isXliff: true,
            xliffProject,
          };
       }
       if (xliffKind === 'sdlxliff' || xliffKind === 'mqxliff') {
          const xliffProject = await parseXliffFile(file);
          return {
            name: file.name,
            content: '',
            isXliff: true,
            xliffProject,
          };
       }
       if (file.name.endsWith('.docx')) {
          const arrayBuffer = await file.arrayBuffer();
          const sourceBlobId = newSourceBlobId();
          await saveSourceBlob(sourceBlobId, arrayBuffer);
          const { segments: docxSegments } = await parseDocxForImport(arrayBuffer, file.name);
          if (docxSegments.length > 0) {
            return {
              name: file.name,
              content: docxSegments.map((s) => s.source).join('\n'),
              isExcel: true,
              sourceBlobId,
              segments: docxSegments.map((s) => ({
                source: s.source,
                target: s.target,
                okapiTuId: s.okapiTuId,
                inlineRunMeta: s.inlineRunMeta,
              })),
            };
          }
          return { name: file.name, content: '', sourceBlobId };
       }
       if (isOkapiCandidateFile(file.name) && !file.name.endsWith('.docx')) {
          const arrayBuffer = await file.arrayBuffer();
          const sourceBlobId = newSourceBlobId();
          await saveSourceBlob(sourceBlobId, arrayBuffer);
          const extracted = await okapiExtractFile(file);
          if (extracted.ok && extracted.segments?.length) {
            return {
              name: file.name,
              content: extracted.segments.map((s) => s.source).join('\n'),
              isExcel: true,
              sourceBlobId,
              segments: extracted.segments.map((s) => ({
                source: s.source,
                target: s.target || '',
                okapiTuId: s.okapiTuId ?? s.id,
                inlineRunMeta: s.inlineRunMeta,
              })),
            };
          }
       } else if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
          // 解析Excel文件
          const arrayBuffer = await file.arrayBuffer();
          const workbook = XLSX.read(arrayBuffer, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];

          // 获取原始数据
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

          // 检测是否是双语对照表（有两列及以上）
          const hasMultipleColumns = jsonData.length > 0 && jsonData[0] && jsonData[0].length >= 2;

          if (hasMultipleColumns) {
              // 双语对照表：提取原文和译文
              const segments = jsonData.map((row) => {
                  if (!row || row.length < 1) return null;

                  // 跳过可能的标题行
                  const firstCell = String(row[0] || '').trim().toLowerCase();
                  if (firstCell === 'source' || firstCell === '原文') {
                      const secondCell = String(row[1] || '').trim().toLowerCase();
                      if (secondCell === 'target' || secondCell === '译文') {
                          return null;
                      }
                  }

                  const source = String(row[0] || '').trim();
                  const target = row[1] ? String(row[1] || '').trim() : '';

                  if (!source) return null;

                  return { source, target };
              }).filter((item): item is { source: string, target: string } => item !== null);

              return {
                  name: file.name,
                  content: segments.map(s => s.source).join('\n'),
                  isExcel: true,
                  segments
              };
          } else {
              // 单列数据：只提取原文
              const segments = jsonData.map((row) => {
                  if (!row || row.length < 1) return null;

                  const cellValue = row[0];
                  if (cellValue === undefined || cellValue === null || cellValue === '') return null;

                  const text = String(cellValue).trim();
                  if (!text) return null;

                  return { source: text, target: '' };
              }).filter((item): item is { source: string, target: string } => item !== null);

              return {
                  name: file.name,
                  content: segments.map(s => s.source).join('\n'),
                  isExcel: true,
                  segments
              };
          }
       } else {
          return new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = (event) => {
                  resolve({ name: file.name, content: event.target?.result as string });
              };
              reader.readAsText(file);
          });
       }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      if (!newProjectName.trim()) {
        const firstFileName = files[0].name;
        const autoProjectName = firstFileName.replace(/\.[^/.]+$/, '');
        setNewProjectName(autoProjectName);
      }
      setIsParsing(true);
      try {
          const promises = Array.from(files).map((file: File) => parseFile(file));
          const results = await Promise.all(promises);
          setUploadedFiles(prev => [...prev, ...results]);
      } catch (error) {
          console.error("File parsing error", error);
          alert("部分文件解析失败，请重试");
      } finally {
          setIsParsing(false);
      }
    }
  };

  const handleSingleFileAddChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !targetProjectId) return;

      setImportFeedback(null);
      setParsingFileName(file.name);
      setIsParsing(true);
      try {
          const result = await parseFile(file);
          onAddFileToProject(
            targetProjectId,
            result.name,
            result.content,
            result.isExcel,
            result.segments,
            result.xliffProject,
            result.sourceBlobId
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

  const handleRemoveFile = (index: number) => {
      setUploadedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const parseAndCreateProject = () => {
    if (!newProjectName || uploadedFiles.length === 0) return;

    // 1. Handle Resources
    let finalMainTmId = mainTmId;
    let newTM: TranslationMemory | undefined;

    if (mainTmId === 'create-new') {
        finalMainTmId = `tm-${Date.now()}`;
        newTM = {
            id: finalMainTmId,
            name: newTmName || `${newProjectName} TM`,
            sourceLang,
            targetLang,
            units: [],
            createdAt: new Date().toISOString().split('T')[0]
        };
    } else if (mainTmId === 'none') {
        finalMainTmId = '';
    }

    let finalMainTbId = mainTbId;
    let newTB: TermBase | undefined;

    if (mainTbId === 'create-new') {
        finalMainTbId = `tb-${Date.now()}`;
        newTB = {
            id: finalMainTbId,
            name: newTbName || `${newProjectName} TB`,
            sourceLang,
            targetLang,
            entries: [],
            createdAt: new Date().toISOString().split('T')[0]
        };
    } else if (mainTbId === 'none') {
        finalMainTbId = '';
    }

    // Combine Main + Refs
    const allTmIds = new Set<string>();
    if (finalMainTmId) allTmIds.add(finalMainTmId);
    referenceTmIds.forEach(id => allTmIds.add(id));

    const allTbIds = new Set<string>();
    if (finalMainTbId) allTbIds.add(finalMainTbId);
    referenceTbIds.forEach(id => allTbIds.add(id));

    // 2. Create Project Files with Auto-Lock Logic
    let totalSegments = 0;

    const xliffUpload = uploadedFiles.find((f) => f.isXliff && f.xliffProject);
    if (xliffUpload?.xliffProject) {
      const xp = xliffUpload.xliffProject;
      const langSrc = xp.sourceLang || sourceLang;
      const langTgt = xp.targetLang || targetLang;
      const projectFiles: ProjectFile[] = xp.files.map((pf, fileIdx) =>
        buildProjectFileFromParsed(pf, fileIdx, langSrc)
      );
      const totalSegments = projectFiles.reduce((n, f) => n + f.totalSegments, 0);
      const confirmed = projectFiles.reduce(
        (n, f) => n + f.segments.filter((s) => s.status === SegmentStatus.Confirmed).length,
        0
      );
      const newProject: Project = {
        id: `p-${Date.now()}`,
        name: newProjectName,
        sourceLang: langSrc,
        targetLang: langTgt,
        createdAt: new Date().toISOString().split('T')[0],
        progress: totalSegments > 0 ? Math.round((confirmed / totalSegments) * 100) : 0,
        totalSegments,
        files: projectFiles,
        mainTmId: finalMainTmId,
        tmIds: Array.from(allTmIds),
        mainTbId: finalMainTbId,
        tbIds: Array.from(allTbIds),
        grammarRuleBookIds: Array.from(grammarRuleBookIds),
        regexDictionaryBookIds: Array.from(regexDictionaryBookIds),
        contextDescription: '',
        tradosPackage: xp.tradosPackage,
      };
      onCreateProject(newProject, newTM, newTB);
      setIsModalOpen(false);
      return;
    }

    const projectFiles: ProjectFile[] = uploadedFiles.map((file, fileIdx) => {
        let segs: Segment[];

        if (file.isExcel && file.segments) {
            // 处理Excel文件：使用segments数据
            segs = file.segments.map((item, index) => {
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

                isLocked = shouldAutoLockSegmentAtImport(text, sourceLang);

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
                    isLocked: isLocked,
                    okapiTuId: item.okapiTuId ?? `p-${index}`,
                    inlineRunMeta: item.inlineRunMeta,
                };
            });
        } else {
            // 处理文本文件（txt, docx）
            segs = file.content
                .split(/\r?\n/)
                .map(line => line.trim())
                .filter(line => line.length > 0)
                .map((line, index) => {
                    let isLocked = false;
                    const text = line.trim();

                    isLocked = shouldAutoLockSegmentAtImport(text, sourceLang);

                    return {
                        id: `s-${Date.now()}-${fileIdx}-${index}`,
                        sourceText: line,
                        targetText: isLocked ? line : '', // Auto-fill
                        status: isLocked ? SegmentStatus.Confirmed : SegmentStatus.NotStarted,
                        matchType: MatchType.None,
                        isLocked: isLocked
                    };
                });
        }

        totalSegments += segs.length;

        // Calculate initial progress based on locked segments
        const lockedCount = segs.filter(s => s.isLocked).length;
        const initialProgress = segs.length > 0 ? Math.round((lockedCount / segs.length) * 100) : 0;

        return {
            id: `f-${Date.now()}-${fileIdx}`,
            name: file.name,
            segments: segs,
            totalSegments: segs.length,
            progress: initialProgress,
            sourceBlobId: file.sourceBlobId,
        };
    });

    const newProject: Project = {
        id: `p-${Date.now()}`,
        name: newProjectName,
        sourceLang: sourceLang,
        targetLang: targetLang,
        createdAt: new Date().toISOString().split('T')[0],
        progress: totalSegments > 0 ? Math.round((projectFiles.reduce((acc, f) => acc + (f.progress/100 * f.totalSegments), 0) / totalSegments) * 100) : 0,
        totalSegments: totalSegments,
        files: projectFiles,
        mainTmId: finalMainTmId,
        tmIds: Array.from(allTmIds),
        mainTbId: finalMainTbId,
        tbIds: Array.from(allTbIds),
        grammarRuleBookIds: Array.from(grammarRuleBookIds),
        regexDictionaryBookIds: Array.from(regexDictionaryBookIds),
        contextDescription: ''
    };

    onCreateProject(newProject, newTM, newTB);
    setIsModalOpen(false);
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

  // Toggle Ref Helper
  const toggleRefTm = (id: string) => {
      const next = new Set(referenceTmIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setReferenceTmIds(next);
  }

  const toggleRefTb = (id: string) => {
      const next = new Set(referenceTbIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setReferenceTbIds(next);
  };

  const matchingGrammarBooks = availableGrammarRuleBooks.filter(
      (g) => g.sourceLang === sourceLang && g.targetLang === targetLang
  );
  const settingsMatchingGrammarBooks = settingsProject
      ? availableGrammarRuleBooks.filter(
            (g) => g.sourceLang === settingsProject.sourceLang && g.targetLang === settingsProject.targetLang
        )
      : [];

  const toggleGrammarBook = (id: string) => {
      const next = new Set(grammarRuleBookIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setGrammarRuleBookIds(next);
  };

  const toggleSettingsGrammarBook = (id: string) => {
      const next = new Set(settingsGrammarRuleBookIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSettingsGrammarRuleBookIds(next);
  };

  const matchingRegexDictionaryBooks = availableRegexDictionaryBooks.filter(
      (b) => b.sourceLang === sourceLang && b.targetLang === targetLang
  );
  const settingsMatchingRegexDictionaryBooks = settingsProject
      ? availableRegexDictionaryBooks.filter(
            (b) => b.sourceLang === settingsProject.sourceLang && b.targetLang === settingsProject.targetLang
        )
      : [];

  const toggleRegexDictionaryBook = (id: string) => {
      const next = new Set(regexDictionaryBookIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setRegexDictionaryBookIds(next);
  };

  const toggleSettingsRegexDictionaryBook = (id: string) => {
      const next = new Set(settingsRegexDictionaryBookIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSettingsRegexDictionaryBookIds(next);
  };

  return (
    <div className="p-8 h-full overflow-y-auto relative">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">项目管理</h1>
          <p className="text-slate-500 mt-1">
            {searchQuery ? `搜索 "${searchQuery}" 的结果` : '管理您的翻译项目与任务进度。'}
          </p>
        </div>
        <button 
          onClick={handleOpenCreateModal}
          className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-5 py-2.5 rounded-full font-medium shadow-lg shadow-slate-900/20 transition-all hover:scale-110 active:scale-95"
        >
          <Icons.File className="w-4 h-4" />
          <span>新建项目</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredProjects.length > 0 ? (
            filteredProjects.map((project) => (
            <ProjectCard 
                key={project.id} 
                project={project}
                tmNames={project.tmIds.map(id => availableTMs.find(t => t.id === id)?.name).filter(Boolean) as string[]}
                tbNames={project.tbIds.map(id => availableTBs.find(t => t.id === id)?.name).filter(Boolean) as string[]}
                grNames={(project.grammarRuleBookIds ?? [])
                    .map((id) => availableGrammarRuleBooks.find((g) => g.id === id)?.name)
                    .filter(Boolean) as string[]}
                rxNames={(project.regexDictionaryBookIds ?? [])
                    .map((id) => availableRegexDictionaryBooks.find((g) => g.id === id)?.name)
                    .filter(Boolean) as string[]}
                onClick={() => onOpenProject(project.id)} 
                onDelete={() => promptDelete(project.id)}
                onManageFiles={() => handleOpenFilesModal(project.id)}
                onSettings={() => handleOpenSettingsModal(project.id)}
                onAnalyzeDuplicates={() => handleOpenDuplicateModal(project.id)}
                onExportSdlxliff={
                  onTradosQuickExport &&
                  (project.tradosPackage?.packageBlobId ||
                    project.files.some(
                      (f) =>
                        f.interchangeFormat === 'sdlxliff' ||
                        f.name.toLowerCase().includes('.sdlxliff') ||
                        f.segments.some((s) => s.xliffSegmentId)
                    ))
                    ? () => onTradosQuickExport(project.id, 'sdlxliff')
                    : undefined
                }
                onExportSdlrpx={
                  onTradosQuickExport && project.tradosPackage
                    ? () => onTradosQuickExport(project.id, 'sdlrpx')
                    : undefined
                }
            />
            ))
        ) : (
            <div className="col-span-full flex flex-col items-center justify-center py-20 text-slate-400">
                <Icons.Search className="w-12 h-12 mb-4 opacity-20" />
                <p>未找到匹配的项目</p>
            </div>
        )}
      </div>

      {/* New Project Modal */}
      {isModalOpen && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6 animate-in zoom-in-95 duration-200 max-h-[95vh] overflow-y-auto">
                  <div className="flex justify-between items-center mb-6">
                      <h2 className="text-xl font-bold text-slate-900">创建新项目向导</h2>
                      <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                          <Icons.X className="w-5 h-5" />
                      </button>
                  </div>
                  
                  <div className="space-y-6">
                      {/* Step 1: Basic Info */}
                      <div className="space-y-4">
                          <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1">1. 项目名称</label>
                            <input 
                                type="text" 
                                className="w-full border border-slate-300 rounded-lg p-2.5 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                placeholder="例如：2024 Q4 营销文档"
                                value={newProjectName}
                                onChange={(e) => setNewProjectName(e.target.value)}
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                              <div>
                                  <label className="block text-sm font-semibold text-slate-700 mb-1">源语言</label>
                                  <select 
                                    value={sourceLang}
                                    onChange={(e) => setSourceLang(e.target.value)}
                                    className="w-full border border-slate-300 rounded-lg p-2.5 bg-white"
                                  >
                                      {SUPPORTED_LANGUAGES.map(lang => (
                                          <option key={lang.code} value={lang.code}>{lang.name}</option>
                                      ))}
                                  </select>
                              </div>
                              <div>
                                  <label className="block text-sm font-semibold text-slate-700 mb-1">目标语言</label>
                                  <select 
                                    value={targetLang}
                                    onChange={(e) => setTargetLang(e.target.value)}
                                    className="w-full border border-slate-300 rounded-lg p-2.5 bg-white"
                                  >
                                      {SUPPORTED_LANGUAGES.map(lang => (
                                          <option key={lang.code} value={lang.code}>{lang.name}</option>
                                      ))}
                                  </select>
                              </div>
                          </div>
                      </div>

                      {/* Step 2: Resource Mapping */}
                      <div className="bg-slate-50 p-5 rounded-xl border border-slate-200">
                          <div className="flex items-center gap-2 mb-4">
                             <Icons.Settings className="w-4 h-4 text-slate-500"/>
                             <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">2. 资源挂载 (Resource Mapping)</h3>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-6">
                                {/* Translation Memory Column */}
                                <div>
                                    <div className="mb-3">
                                        <label className="block text-xs font-bold text-blue-600 mb-1">主记忆库 (Main TM) <span className="font-normal text-slate-400">- 写入/更新</span></label>
                                        <select 
                                            value={mainTmId}
                                            onChange={(e) => setMainTmId(e.target.value)}
                                            className="w-full border border-slate-300 rounded-lg p-2 bg-white text-sm"
                                        >
                                            <option value="none">无 (None)</option>
                                            {availableTMs.map(tm => (
                                                <option key={tm.id} value={tm.id}>{tm.name}</option>
                                            ))}
                                            <option value="create-new" className="text-blue-600 font-bold">+ 新建空白 TM</option>
                                        </select>
                                        {mainTmId === 'create-new' && (
                                            <input 
                                                type="text" 
                                                placeholder="输入新 TM 名称"
                                                value={newTmName}
                                                onChange={(e) => setNewTmName(e.target.value)}
                                                className="w-full mt-2 border border-blue-300 bg-blue-50/50 rounded-lg p-2 text-sm focus:bg-white"
                                            />
                                        )}
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 mb-1">参考记忆库 (Reference TMs)</label>
                                        <div className="border border-slate-200 rounded-lg bg-white max-h-32 overflow-y-auto p-1">
                                            {availableTMs.filter(tm => tm.id !== mainTmId).length > 0 ? (
                                                availableTMs.filter(tm => tm.id !== mainTmId).map(tm => (
                                                    <label key={tm.id} className="flex items-center gap-2 p-1.5 hover:bg-slate-50 rounded cursor-pointer">
                                                        <input 
                                                            type="checkbox" 
                                                            checked={referenceTmIds.has(tm.id)}
                                                            onChange={() => toggleRefTm(tm.id)}
                                                            className="rounded border-slate-300 text-blue-600"
                                                        />
                                                        <span className="text-xs truncate">{tm.name}</span>
                                                    </label>
                                                ))
                                            ) : (
                                                <p className="text-xs text-slate-400 p-2">无其他可用 TM</p>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Term Base Column */}
                                <div>
                                    <div className="mb-3">
                                        <label className="block text-xs font-bold text-red-600 mb-1">主术语库 (Main TB) <span className="font-normal text-slate-400">- 写入/QA</span></label>
                                        <select 
                                            value={mainTbId}
                                            onChange={(e) => setMainTbId(e.target.value)}
                                            className="w-full border border-slate-300 rounded-lg p-2 bg-white text-sm"
                                        >
                                            <option value="none">无 (None)</option>
                                            {availableTBs.map(tb => (
                                                <option key={tb.id} value={tb.id}>{tb.name}</option>
                                            ))}
                                            <option value="create-new" className="text-blue-600 font-bold">+ 新建空白 TB</option>
                                        </select>
                                        {mainTbId === 'create-new' && (
                                            <input 
                                                type="text" 
                                                placeholder="输入新 TB 名称"
                                                value={newTbName}
                                                onChange={(e) => setNewTbName(e.target.value)}
                                                className="w-full mt-2 border border-blue-300 bg-blue-50/50 rounded-lg p-2 text-sm focus:bg-white"
                                            />
                                        )}
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 mb-1">参考术语库 (Reference TBs)</label>
                                        <div className="border border-slate-200 rounded-lg bg-white max-h-32 overflow-y-auto p-1">
                                            {availableTBs.filter(tb => tb.id !== mainTbId).length > 0 ? (
                                                availableTBs.filter(tb => tb.id !== mainTbId).map(tb => (
                                                    <label key={tb.id} className="flex items-center gap-2 p-1.5 hover:bg-slate-50 rounded cursor-pointer">
                                                        <input 
                                                            type="checkbox" 
                                                            checked={referenceTbIds.has(tb.id)}
                                                            onChange={() => toggleRefTb(tb.id)}
                                                            className="rounded border-slate-300 text-red-600"
                                                        />
                                                        <span className="text-xs truncate">{tb.name}</span>
                                                    </label>
                                                ))
                                            ) : (
                                                <p className="text-xs text-slate-400 p-2">无其他可用 TB</p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                          </div>

                          <div className="mt-4 border-t border-slate-200 pt-4">
                              <div className="mb-2 flex items-center gap-2">
                                  <Icons.Concordance className="h-4 w-4 text-amber-600" />
                                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">规则词典（可选）</h4>
                              </div>
                              <p className="mb-2 text-[10px] text-slate-500">
                                  仅列出与上方源/目标语言一致的词典。整句匹配句式后，可变部分单独送 AI 翻译，再填入译文模板。
                              </p>
                              <div className="max-h-28 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1">
                                  {matchingGrammarBooks.length > 0 ? (
                                      matchingGrammarBooks.map((g) => (
                                          <label
                                              key={g.id}
                                              className="flex cursor-pointer items-center gap-2 rounded p-1.5 hover:bg-slate-50"
                                          >
                                              <input
                                                  type="checkbox"
                                                  checked={grammarRuleBookIds.has(g.id)}
                                                  onChange={() => toggleGrammarBook(g.id)}
                                                  className="rounded border-slate-300 text-amber-600"
                                              />
                                              <span className="truncate text-xs">{g.name}</span>
                                              <span className="shrink-0 text-[10px] text-slate-400">({g.rules.length})</span>
                                          </label>
                                      ))
                                  ) : (
                                      <p className="p-2 text-xs text-slate-400">无匹配语言对的规则词典，可在「语言资源」中创建</p>
                                  )}
                              </div>
                          </div>

                          <div className="mt-4 border-t border-slate-200 pt-4">
                              <div className="mb-2 flex items-center gap-2">
                                  <Icons.RegexDict className="h-4 w-4 text-violet-600" />
                                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                                      正则表达式词典（可选）
                                  </h4>
                              </div>
                              <p className="mb-2 text-[10px] text-slate-500">
                                  无「类别」的条目在句段翻译前优先替换；有「类别」的可被规则词典 {'{类别}'} 引用。建议规则总数小于 1000。
                              </p>
                              <div className="max-h-28 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1">
                                  {matchingRegexDictionaryBooks.length > 0 ? (
                                      matchingRegexDictionaryBooks.map((g) => (
                                          <label
                                              key={g.id}
                                              className="flex cursor-pointer items-center gap-2 rounded p-1.5 hover:bg-slate-50"
                                          >
                                              <input
                                                  type="checkbox"
                                                  checked={regexDictionaryBookIds.has(g.id)}
                                                  onChange={() => toggleRegexDictionaryBook(g.id)}
                                                  className="rounded border-slate-300 text-violet-600"
                                              />
                                              <span className="truncate text-xs">{g.name}</span>
                                              <span className="shrink-0 text-[10px] text-slate-400">
                                                  ({g.entries.length})
                                              </span>
                                          </label>
                                      ))
                                  ) : (
                                      <p className="p-2 text-xs text-slate-400">
                                          无匹配语言对的正则词典，可在「语言资源」中创建
                                      </p>
                                  )}
                              </div>
                          </div>
                      </div>

                      {/* Step 3: File Upload */}
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1">3. 导入原文 (支持多文件)</label>
                        <div 
                            className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer transition-colors ${
                                isParsing ? 'bg-slate-50 border-blue-400 cursor-wait' : 'border-slate-300 hover:bg-slate-50 hover:border-blue-400'
                            }`}
                            onClick={() => !isParsing && fileInputRef.current?.click()}
                        >
                            {isParsing ? (
                                <Icons.Refresh className="w-6 h-6 mb-2 text-blue-500 animate-spin" />
                            ) : (
                                <Icons.Upload className="w-6 h-6 mb-2 text-slate-400" />
                            )}
                            <span className="text-sm text-slate-500">
                                {uploadedFiles.length > 0 ? `已选择 ${uploadedFiles.length} 个文件` : '点击批量上传（含 .sdlxliff / .mqxliff / .sdlppx）'}
                            </span>
                            <input
                                type="file"
                                accept=".txt,.docx,.xlsx,.xls,.html,.htm,.idml,.sdlxliff,.mqxliff,.sdlppx,.sdlrpx,.xlf"
                                ref={fileInputRef}
                                onChange={handleFileChange}
                                className="hidden"
                                multiple
                            />
                        </div>
                        
                        {/* File List */}
                        {uploadedFiles.length > 0 && (
                            <div className="mt-3 space-y-2 max-h-32 overflow-y-auto">
                                {uploadedFiles.map((f, i) => (
                                    <div key={i} className="flex justify-between items-center bg-slate-50 px-3 py-2 rounded-lg border border-slate-100 text-xs">
                                        <div className="flex items-center gap-2 truncate">
                                            <Icons.File className="w-3 h-3 text-slate-400"/>
                                            <span className="truncate max-w-[200px]">{f.name}</span>
                                        </div>
                                        <button onClick={() => handleRemoveFile(i)} className="text-slate-400 hover:text-red-500">
                                            <Icons.X className="w-3 h-3" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                      </div>

                  </div>

                  <div className="flex justify-end gap-3 mt-8">
                      <button 
                        onClick={() => setIsModalOpen(false)}
                        className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
                      >
                          取消
                      </button>
                      <button 
                        onClick={parseAndCreateProject}
                        disabled={!newProjectName || uploadedFiles.length === 0 || isParsing}
                        className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-md shadow-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                          创建项目
                      </button>
                  </div>
              </div>
          </div>
      )}

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
                                accept=".txt,.docx,.xlsx,.xls,.html,.htm,.idml,.sdlxliff,.mqxliff,.sdlppx,.sdlrpx,.xlf"
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
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6 animate-in zoom-in-95 duration-200 max-h-[95vh] overflow-y-auto">
                  <div className="flex justify-between items-center mb-6">
                      <h2 className="text-xl font-bold text-slate-900">项目设置</h2>
                      <button onClick={() => setIsSettingsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                          <Icons.X className="w-5 h-5" />
                      </button>
                  </div>

                  <div className="mb-8 rounded-xl border border-slate-200 bg-slate-50 p-5">
                      <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-500">
                          项目名称
                      </label>
                      <input
                          type="text"
                          value={settingsProjectName}
                          onChange={(e) => setSettingsProjectName(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                          placeholder="输入项目名称"
                          autoComplete="off"
                      />
                      <div className="mt-4 flex flex-wrap items-start gap-4">
                          <div className="min-w-[200px] flex-1">
                              <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-500">
                                  交稿时间
                              </label>
                              <input
                                  type="datetime-local"
                                  step={60}
                                  value={settingsDeliveryDueAt}
                                  onChange={(e) => setSettingsDeliveryDueAt(e.target.value)}
                                  className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                              />
                              <p className="mt-1 text-[10px] text-slate-400">
                                  留空表示未设置。开启「截止时间预警」且未勾选「项目已完成」时，翻译界面将按该时刻在截止前 7 天内分级提醒。
                              </p>
                          </div>
                          <div className="flex shrink-0 flex-col gap-2 pt-8">
                              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
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
                                      className="rounded-lg px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-200 self-start"
                                  >
                                      清除时间
                                  </button>
                              ) : null}
                          </div>
                      </div>
                      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white p-3">
                          <input
                              type="checkbox"
                              checked={settingsProjectCompleted}
                              onChange={(e) => setSettingsProjectCompleted(e.target.checked)}
                              className="mt-0.5 text-emerald-600"
                          />
                          <span>
                              <span className="block text-sm font-medium text-slate-800">项目已完成</span>
                              <span className="mt-0.5 block text-[11px] text-slate-500">
                                  适用于已交稿或无需再跟进的任务；开启后翻译界面不再显示交稿倒计时提醒。
                              </span>
                          </span>
                      </label>
                  </div>
                  
                  <div className="space-y-8">
                      {/* Term Base Management */}
                      <div className="bg-slate-50 p-5 rounded-xl border border-slate-200">
                          <div className="flex items-center gap-2 mb-4">
                             <Icons.TermBase className="w-4 h-4 text-red-500"/>
                             <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">术语库管理</h3>
                          </div>
                          
                          <div className="space-y-4">
                              {/* QA Term Base Selection */}
                              <div>
                                  <label className="block text-xs font-bold text-red-600 mb-2">QA术语库 (唯一)</label>
                                  <select 
                                      value={settingsMainTbId}
                                      onChange={(e) => setSettingsMainTbId(e.target.value)}
                                      className="w-full border border-slate-300 rounded-lg p-2 bg-white text-sm"
                                  >
                                      <option value="">无 (None)</option>
                                      {availableTBs.map(tb => (
                                          <option key={tb.id} value={tb.id}>{tb.name}</option>
                                      ))}
                                  </select>
                                  <p className="text-[10px] text-slate-400 mt-1">QA检查时仅使用此术语库</p>
                              </div>
                              
                              {/* Reference Term Bases */}
                              <div>
                                  <label className="block text-xs font-bold text-slate-500 mb-2">参考术语库</label>
                                  <div className="border border-slate-200 rounded-lg bg-white max-h-48 overflow-y-auto">
                                      {availableTBs.map(tb => (
                                          <label key={tb.id} className="flex items-center gap-3 p-3 hover:bg-slate-50 border-b border-slate-100 last:border-b-0">
                                              <input 
                                                  type="checkbox" 
                                                  checked={settingsReferenceTbIds.has(tb.id)}
                                                  onChange={(e) => {
                                                      const newSet = new Set(settingsReferenceTbIds);
                                                      if (e.target.checked) {
                                                          newSet.add(tb.id);
                                                      } else {
                                                          newSet.delete(tb.id);
                                                      }
                                                      setSettingsReferenceTbIds(newSet);
                                                  }}
                                                  className="text-slate-600"
                                                  disabled={tb.id === settingsMainTbId}
                                              />
                                              <div className="flex-1">
                                                  <div className="text-sm font-medium text-slate-800">{tb.name}</div>
                                                  <div className="text-xs text-slate-400">{tb.entries.length} 个条目</div>
                                              </div>
                                              {tb.id === settingsMainTbId && (
                                                  <span className="text-xs bg-red-100 text-red-600 px-2 py-1 rounded-full font-medium">QA</span>
                                              )}
                                          </label>
                                      ))}
                                  </div>
                              </div>
                          </div>
                      </div>
                      
                      {/* Translation Memory Management */}
                      <div className="bg-slate-50 p-5 rounded-xl border border-slate-200">
                          <div className="flex items-center gap-2 mb-4">
                             <Icons.Database className="w-4 h-4 text-blue-500"/>
                             <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">记忆库管理</h3>
                          </div>
                          
                          <div className="space-y-4">
                              {/* Main TM Selection */}
                              <div>
                                  <label className="block text-xs font-bold text-blue-600 mb-2">可更新记忆库</label>
                                  <select 
                                      value={settingsMainTmId}
                                      onChange={(e) => setSettingsMainTmId(e.target.value)}
                                      className="w-full border border-slate-300 rounded-lg p-2 bg-white text-sm"
                                  >
                                      <option value="">无 (None)</option>
                                      {availableTMs.map(tm => (
                                          <option key={tm.id} value={tm.id}>{tm.name}</option>
                                      ))}
                                  </select>
                                  <p className="text-[10px] text-slate-400 mt-1">翻译过程中会更新此记忆库</p>
                              </div>
                              
                              {/* Reference TMs */}
                              <div>
                                  <label className="block text-xs font-bold text-slate-500 mb-2">参考记忆库</label>
                                  <div className="border border-slate-200 rounded-lg bg-white max-h-48 overflow-y-auto">
                                      {availableTMs.map(tm => (
                                          <label key={tm.id} className="flex items-center gap-3 p-3 hover:bg-slate-50 border-b border-slate-100 last:border-b-0">
                                              <input 
                                                  type="checkbox" 
                                                  checked={settingsReferenceTmIds.has(tm.id)}
                                                  onChange={(e) => {
                                                      const newSet = new Set(settingsReferenceTmIds);
                                                      if (e.target.checked) {
                                                          newSet.add(tm.id);
                                                      } else {
                                                          newSet.delete(tm.id);
                                                      }
                                                      setSettingsReferenceTmIds(newSet);
                                                  }}
                                                  className="text-slate-600"
                                                  disabled={tm.id === settingsMainTmId}
                                              />
                                              <div className="flex-1">
                                                  <div className="text-sm font-medium text-slate-800">{tm.name}</div>
                                                  <div className="text-xs text-slate-400">{tm.units.length} 个条目</div>
                                              </div>
                                              {tm.id === settingsMainTmId && (
                                                  <span className="text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded-full font-medium">可更新</span>
                                              )}
                                          </label>
                                      ))}
                                  </div>
                              </div>
                          </div>
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
                          <div className="mb-4 flex items-center gap-2">
                              <Icons.Concordance className="h-4 w-4 text-amber-600" />
                              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">规则词典</h3>
                          </div>
                          <p className="mb-3 text-[10px] text-slate-500">
                              勾选要在本项目中启用的规则词典（语言对须与项目一致）。未勾选则句段翻译不使用句式模板。
                          </p>
                          <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white">
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

                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
                          <div className="mb-4 flex items-center gap-2">
                              <Icons.RegexDict className="h-4 w-4 text-violet-600" />
                              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                                  正则表达式词典
                              </h3>
                          </div>
                          <p className="mb-3 text-[10px] text-slate-500">
                              勾选要在本项目中启用的正则词典（语言对须与项目一致）。
                          </p>
                          <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white">
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

                  <div className="flex justify-end gap-3 mt-8">
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