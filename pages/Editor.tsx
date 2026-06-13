import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  List,
  useDynamicRowHeight,
  type ListImperativeAPI,
  type RowComponentProps,
} from 'react-window';
import { Icons } from '../components/ui/Icons';
import { Project, ProjectFile, Segment, SegmentStatus, MatchType, TermBase, TranslationMemory, TermBaseEntry, TermBaseEntryWithTb, TranslationMemoryUnit, QAIssue, AISettings, QuickPrompt, TwinTranslatorProfile, TranslationVariant, KnowledgeBase, EmbeddingSettings, DEFAULT_EMBEDDING_SETTINGS, MtReferenceSettings, DEFAULT_MT_REFERENCE_SETTINGS, GrammarRuleBook, RegexDictionaryBook, EditorQuickSymbol, CustomOnlineDictionary, PreTranslateStrategy, InlineRunStyle } from '../types';
import {
  APP_VERSION_METADATA,
  DEFAULT_EDITOR_QUICK_SYMBOLS,
  EDITOR_QUICK_SYMBOL_CHAR_MAX,
  EDITOR_QUICK_SYMBOL_LIST_MAX,
  MT_COMPARE_MAX,
  MT_TRANSLATOR_OPTIONS,
  mtTranslatorLabel,
} from '../constants';
import {
  flattenAndSortGrammarRules,
  normalizeSegmentForGrammar,
  tryGrammarRuleTranslation,
} from '../services/grammarRuleService';
import {
  applyUncategorizedRegexChain,
  buildRegexCategoryMap,
  collectUncategorizedRegexEntries,
} from '../services/regexDictionaryService';
import {
  segmentContainsFind,
  applyFindReplaceInText,
  validateFindRegex,
} from '../services/findReplaceUtils';
import {
  segmentSourceByTermHits,
  termSourceHitsSegment,
  filterTermsMatchingSource,
  targetContainsTermTranslation,
} from '../services/termQaMatch';
import { translateSegment, runDeepQACheck, polishSegment, extractProjectTerms, TermCandidate, analyzeProjectContext, sendAIChatMessage, getAIReadinessError } from '../services/geminiService';
import {
  processLearningFeedback,
  recordTwinSuggestionOffer,
  languagePairFromProjectLocales,
  primaryLanguageCode,
  capitalizeFirstLetterInTarget,
  isZhToForeignProjectLocales,
  MAX_STORED_TRAINING_EXAMPLES,
  getTwinTrainingCapNotice,
  formatTrainingExamplesAsKnowledgeBaseRawText,
  buildLearnedSegmentExportRows
} from '../services/twinTranslatorService';
import { buildRagContextStringAsync, chunkKnowledgeText } from '../services/knowledgeRagService';
import { embedTexts } from '../services/embeddingClient';
import { TwinTranslatorToolbar } from '../components/TwinTranslatorToolbar';
import {
  EditorDictionaryPanel,
  readDictionaryAutoLookupEnabled,
  writeDictionaryAutoLookupEnabled,
  type EditorBottomPanelTab,
} from '../components/EditorDictionaryPanel';
import { MtCompareModal } from '../components/MtCompareModal';
import { fetchMtReference, fetchMtReferenceCompare, segmentMayHaveInlineTags } from '../services/mtReferenceClient';
import type { MtCompareResultItem } from '../services/mtReferenceClient';
import { getAllOnlineDictionaryProviders, type OnlineDictionaryId } from '../services/onlineDictionaryUrls';
import * as XLSX from 'xlsx';
import {
  mapToSuperscript,
  mapToSubscript,
  stripScriptFormatting,
} from '../services/targetScriptFormat';
import {
  getProjectDeliveryDueRaw,
  useProjectDeliveryDueReminder,
  type DeliveryDueReminder,
} from '../services/projectDueDate';
import { segmentIsEffectivelyConfirmed } from '../services/segmentEffectiveStatus';
import { applyTagFormatQaToSegment, shouldRunTagFormatQa, withTagFormatQaIssues } from '../services/xliff/tagFormatQa';
import { hasInlineMarkers, stripInlineMarkers } from '../services/inlineFormatting/markerParse';
import {
  clearAllTargetFormatting,
  clearFormattingInPlainRange,
  pruneInlineRunMeta,
} from '../services/inlineFormatting/clearTargetFormatting';
import { applyRunStyleToTargetSelection, segmentHasCopyableSourceFormat, markerSelectionToPlainOffsets } from '../services/inlineFormatting/copySourceFormatting';
import {
  toggleBasicStyleOnTargetSelection,
  type BasicRunStyleKey,
} from '../services/inlineFormatting/targetBasicFormatting';
import {
  readActivePlainTextSelection,
  readTargetEditorPlainSelection,
} from '../services/inlineFormatting/selectionOffsets';
import { InlineMarkedText } from '../components/InlineMarkedText';
import { InlineMarkedEditor } from '../components/InlineMarkedEditor';
import { sourcesEqual } from '../utils/textNormalize';
import {
  searchTmMatches,
  prefetchTmMatches,
  type TmMatchHit,
} from '../services/tmMatchService';
import {
  runPreTranslateBatch,
  glossaryFromTerms,
  type PreTranslateBatchStats,
} from '../services/preTranslateService';
import { runProofreadBatch, type ProofreadBatchStats } from '../services/proofreadService';
import { TermLensRow } from '../components/TermLensRow';
import { QuickMtPopup } from '../components/QuickMtPopup';

function deliveryDueBannerLook(kind: DeliveryDueReminder['kind']) {
  switch (kind) {
    case 'overdue':
    case 'criticalRed':
      return { bar: 'border-red-200 bg-red-50 text-red-900', icon: 'text-red-600' };
    case 'criticalOrange':
      return { bar: 'border-orange-200 bg-orange-50 text-orange-900', icon: 'text-orange-600' };
    case 'withinDay':
    case 'urgent':
      return { bar: 'border-amber-200 bg-amber-50 text-amber-950', icon: 'text-amber-600' };
    default:
      return { bar: 'border-slate-300 bg-slate-100 text-slate-800', icon: 'text-slate-600' };
  }
}

/** 与 Dashboard 重复分析一致，用于判定同一重复组 */
function normalizeDuplicateSourceKey(text: string): string {
  return text.trim().toLowerCase();
}

function findFirstSegmentIdForDuplicateSource(project: Project, sourceNorm: string): string | null {
  for (const f of project.files) {
    for (const s of f.segments) {
      if (normalizeDuplicateSourceKey(s.sourceText) === sourceNorm) {
        return s.id;
      }
    }
  }
  return null;
}

function countSegmentsMatchingDuplicateSource(project: Project, sourceNorm: string): number {
  let n = 0;
  for (const f of project.files) {
    for (const s of f.segments) {
      if (normalizeDuplicateSourceKey(s.sourceText) === sourceNorm) n++;
    }
  }
  return n;
}

function findSegmentByIdInProject(project: Project, segmentId: string): Segment | null {
  for (const f of project.files) {
    const s = f.segments.find((seg) => seg.id === segmentId);
    if (s) return s;
  }
  return null;
}

/** 项目内同原文首句（按文件顺序）且已有译文时，作为重复句沿用来源 */
function getDuplicatePropagationSource(project: Project, sourceNorm: string): Segment | null {
  const firstId = findFirstSegmentIdForDuplicateSource(project, sourceNorm);
  if (!firstId) return null;
  const first = findSegmentByIdInProject(project, firstId);
  return first?.targetText?.trim() ? first : null;
}

function buildDuplicateAutoFilledSegment(
  target: Segment,
  source: Segment,
  file: ProjectFile
): Segment {
  const targetText = source.targetText ?? '';
  return applyTagFormatQaToSegment(
    {
      ...target,
      targetText,
      inlineRunMeta: source.inlineRunMeta ?? target.inlineRunMeta,
      matchType: MatchType.Exact,
      matchScore: 100,
      status:
        source.status === SegmentStatus.Confirmed
          ? SegmentStatus.Confirmed
          : SegmentStatus.PreTranslated,
    },
    file,
    targetText
  );
}

/** 扫描项目：对译文为空的重复句，从首句沿用已有译文（含跨文件） */
function collectDuplicateAutoFillUpdates(
  project: Project
): { fileId: string; segments: Segment[] }[] {
  const updates: { fileId: string; segments: Segment[] }[] = [];

  for (const file of project.files) {
    let touched = false;
    const nextSegs = file.segments.map((seg) => {
      if (seg.targetText?.trim()) return seg;

      const sourceNorm = normalizeDuplicateSourceKey(seg.sourceText);
      if (!sourceNorm) return seg;

      const firstDupId = findFirstSegmentIdForDuplicateSource(project, sourceNorm);
      if (!firstDupId || firstDupId === seg.id) return seg;

      const sourceSeg = getDuplicatePropagationSource(project, sourceNorm);
      if (!sourceSeg) return seg;

      touched = true;
      return buildDuplicateAutoFilledSegment(seg, sourceSeg, file);
    });

    if (touched) {
      updates.push({ fileId: file.id, segments: nextSegs });
    }
  }

  return updates;
}

/** 首句译文变更时，向全部重复句（含跨文件）同步传播 */
function collectDuplicatePropagationUpdates(
  project: Project,
  sourceNorm: string,
  firstDupId: string,
  targetText: string,
  options: {
    status: SegmentStatus;
    inlineRunMeta?: Segment['inlineRunMeta'];
    onlyEmptyTargets?: boolean;
  }
): { fileId: string; segments: Segment[] }[] {
  const updates: { fileId: string; segments: Segment[] }[] = [];

  for (const file of project.files) {
    let touched = false;
    const nextSegs = file.segments.map((seg) => {
      if (seg.id === firstDupId) return seg;
      if (normalizeDuplicateSourceKey(seg.sourceText) !== sourceNorm) return seg;
      if (options.onlyEmptyTargets && seg.targetText?.trim()) return seg;

      touched = true;
      return applyTagFormatQaToSegment(
        {
          ...seg,
          targetText,
          inlineRunMeta: options.inlineRunMeta ?? seg.inlineRunMeta,
          matchType: MatchType.Exact,
          matchScore: 100,
          status: options.status,
        },
        file,
        targetText
      );
    });

    if (touched) {
      updates.push({ fileId: file.id, segments: nextSegs });
    }
  }

  return updates;
}

/** 将文本写入系统剪贴板（Clipboard API + execCommand 回退） */
function copyTextToClipboard(text: string): void {
  if (!text) return;
  const fallback = () => {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-999999px';
      textarea.style.top = '-999999px';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      textarea.setSelectionRange(0, 99999);
      document.execCommand('copy');
      document.body.removeChild(textarea);
    } catch (err) {
      console.error('复制异常:', err);
    }
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(fallback);
  } else {
    fallback();
  }
}

export type EditorLayoutMode = 'comparison' | 'focus';

interface EditorProps {
  project: Project | null;
  activeFileId: string | null;
  onActiveFileChange: (fileId: string) => void;
  onUpdateFileSegments: (fileId: string, segments: Segment[]) => void;
  /** 一次 state 更新内同步多个文件的句段（用于跨文件自动传播等） */
  onUpdateMultipleFileSegments: (updates: { fileId: string; segments: Segment[] }[]) => void;
  
  mainTB?: TermBase;
  auxiliaryTBs: TermBase[];

  mainTM?: TranslationMemory;
  auxiliaryTMs: TranslationMemory[];

  onAddTM: (unit: TranslationMemoryUnit) => void;
  onAddTerm: (tbId: string, term: TermBaseEntry) => void;
  onUpdateTerm: (tbId: string, term: TermBaseEntry) => void;
  onDeleteTerm: (tbId: string, termId: string) => void;
  // Settings Props
  editorTheme: { sourceBg: string; targetBg: string };
  onUpdateEditorTheme: (theme: { sourceBg: string; targetBg: string }) => void;
  editorFontSize: {
      main: number;
      tm: number;
      tb: number;
      ai: number;
  };
  onUpdateEditorFontSize: (size: {
      main: number;
      tm: number;
      tb: number;
      ai: number;
  }) => void;
  autoPropagate: boolean;
  onUpdateAutoPropagate: (enabled: boolean) => void;
  /** 系统设置：中译外项目在确认句段时将译文首字母大写 */
  capitalizeTargetFirstLetterZhOut: boolean;

  editorLayoutMode: EditorLayoutMode;
  onUpdateEditorLayoutMode: (mode: EditorLayoutMode) => void;

  editorQuickSymbols: EditorQuickSymbol[];
  onUpdateEditorQuickSymbols: (symbols: EditorQuickSymbol[]) => void;
  
  aiSettings: AISettings;
  quickPrompts: QuickPrompt[];
  
  // 孪生译员相关props
  twinTranslators: TwinTranslatorProfile[];
  onTwinTranslatorsChange?: (translators: TwinTranslatorProfile[]) => void;
  onNavigateToTwinTranslators?: () => void;
  knowledgeBases: KnowledgeBase[];
  /** 将孪生译员学习例句另存为知识库时写入 */
  onKnowledgeBasesChange?: (list: KnowledgeBase[]) => void;
  embeddingSettings?: EmbeddingSettings;
  mtReferenceSettings?: MtReferenceSettings;
  onUpdateMtReferenceSettings?: (s: MtReferenceSettings) => void;
  /** 全局规则词典；项目通过 grammarRuleBookIds 挂载 */
  grammarRuleBooks?: GrammarRuleBook[];
  /** 全局正则表达式词典；项目通过 regexDictionaryBookIds 挂载 */
  regexDictionaryBooks?: RegexDictionaryBook[];
  /** 供 App 注册「在线词典」检索词：划选优先，否则当前句原文 */
  dictionaryQueryResolverRef?: React.MutableRefObject<(() => string) | null>;
  /** 在编辑页打开底部词典面板（Ctrl+D / 标题栏「在线词典」） */
  editorDictionaryOpenerRef?: React.MutableRefObject<(() => void) | null>;
  /** 在编辑页打开 MT 参考面板（Ctrl+Shift+M / 标题栏「MT 参考」） */
  editorMtReferenceOpenerRef?: React.MutableRefObject<(() => void) | null>;
  customOnlineDictionaries?: CustomOnlineDictionary[];
  /** 离开编辑页再进入时恢复到此句段（配合 resumeLayoutKey 在布局阶段读取） */
  resumeSegmentId?: string | null;
  /** App 在每次进入翻译编辑页时递增，用于触发句段恢复且不误伤句内点击切换 */
  resumeLayoutKey?: number;
  /** 同步当前文件与激活句段，供下次返回编辑页恢复位置；projectId 用于卸载时父组件已清空 currentProjectId 仍能写入 */
  onEditorPlaceChange?: (place: { fileId: string; segmentId: string; projectId?: string } | null) => void;
  /** 低配机：减弱模糊与过渡动画 */
  reduceVisualEffects?: boolean;
}

const EDITOR_THEME_PRESETS = [
  { name: '默认白', source: '#ffffff', target: '#ffffff' },
  { name: '护眼黄', source: '#faf9de', target: '#fffef9' },
  { name: '清新绿', source: '#e8f5e9', target: '#f1f8e9' },
  { name: '夜间灰', source: '#f1f5f9', target: '#f8fafc' },
] as const;

// --- Simple Diff Component for TM ---
const DiffViewer = ({ currentSource, tmSource }: { currentSource: string, tmSource: string }) => {
    const currentWords = new Set(currentSource.toLowerCase().split(/[\s,.\u3000-\u303f\uff00-\uffef]+/));
    const isAsian = /[\u4e00-\u9fa5]/.test(tmSource);
    const tmParts = isAsian 
        ? tmSource.split('') 
        : tmSource.split(/(\s+)/); 

    return (
        <span className="break-words">
            {tmParts.map((part, index) => {
                const checkPart = part.trim().toLowerCase();
                if (!checkPart) return <span key={index}>{part}</span>;
                const exists = isAsian 
                    ? currentSource.includes(part)
                    : currentWords.has(checkPart);
                
                if (!exists) {
                    return (
                        <span key={index} className="bg-red-50 text-red-700 line-through decoration-red-500 decoration-1.5">
                            {part}
                        </span>
                    );
                }
                return <span key={index}>{part}</span>;
            })}
        </span>
    );
};

// Helper component to highlight search/replace matches in target
const HighlightMatch = ({ text, match }: { text: string, match: string }) => {
    if (!match || !text) return <>{text}</>;
    
    // Escape special regex chars
    const escapedMatch = match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = text.split(new RegExp(`(${escapedMatch})`, 'gi'));
    return (
        <>
            {parts.map((part, i) =>
                part.toLowerCase() === match.toLowerCase()
                    ? <span key={i} className="bg-yellow-200 text-yellow-900 font-bold px-0.5 rounded border border-yellow-300">{part}</span>
                    : part
            )}
        </>
    );
};

/** 查找结果中高亮所有正则匹配（与查找框「使用正则」配合）；限制匹配次数以防 ReDoS/超长文本拖垮 UI */
const HIGHLIGHT_REGEX_MAX_MATCHES = 400;
const HighlightRegexInText = ({ text, pattern }: { text: string; pattern: string }) => {
  if (!pattern || !text) return <>{text}</>;
  try {
    const re = new RegExp(pattern, 'g');
    const nodes: React.ReactNode[] = [];
    let last = 0;
    let k = 0;
    let matchCount = 0;
    for (const m of text.matchAll(re)) {
      if (matchCount >= HIGHLIGHT_REGEX_MAX_MATCHES) {
        nodes.push(
          <span key="trunc" className="text-slate-400 italic">
            …（匹配过多，已截断高亮）
          </span>
        );
        break;
      }
      matchCount++;
      const start = m.index ?? 0;
      if (start > last) nodes.push(<React.Fragment key={`t-${k}`}>{text.slice(last, start)}</React.Fragment>);
      nodes.push(
        <span
          key={`m-${k++}`}
          className="bg-yellow-200 text-yellow-900 font-bold px-0.5 rounded border border-yellow-300"
        >
          {m[0]}
        </span>
      );
      last = start + m[0].length;
    }
    if (last < text.length) nodes.push(<React.Fragment key={`e-${k}`}>{text.slice(last)}</React.Fragment>);
    return <>{nodes}</>;
  } catch {
    return <>{text}</>;
  }
};

// --- NEW Helper: Highlight Terms in Source (与 QA 相同：就长 + 纯拉丁字母词边界) ---
const HighlightedSourceText = ({
  text,
  terms,
  inlineRunMeta,
  formatPickActive,
  onFormattedRunPick,
}: {
  text: string;
  terms: TermBaseEntry[];
  inlineRunMeta?: Segment['inlineRunMeta'];
  formatPickActive?: boolean;
  onFormattedRunPick?: (runId: string, style: InlineRunStyle) => void;
}) => {
  if (hasInlineMarkers(text) || (inlineRunMeta && inlineRunMeta.length > 0)) {
    return (
      <InlineMarkedText
        text={text}
        inlineRunMeta={inlineRunMeta}
        terms={terms}
        formatPickActive={formatPickActive}
        onFormattedRunPick={onFormattedRunPick}
      />
    );
  }

  if (!terms || terms.length === 0) return <>{text}</>;

    const segments = useMemo(
        () => segmentSourceByTermHits(text, terms, false),
        [text, terms]
    );

    return (
        <>
            {segments.map((seg, i) =>
                seg.term ? (
                    <span
                        key={i}
                        className="bg-yellow-200/50 text-yellow-700 border-b-2 border-yellow-400/50 cursor-help font-medium rounded-[2px] px-0.5 mx-0.5 transition-colors hover:bg-yellow-200 hover:text-yellow-900"
                        title={`术语: ${seg.term.source} -> ${seg.term.target}`}
                    >
                        {seg.text}
                    </span>
                ) : (
                    <React.Fragment key={i}>{seg.text}</React.Fragment>
                )
            )}
        </>
    );
};

/** 对照列表：先 start 对齐（控制底部留白），再上移视口，避免当前句紧贴工具栏 */
const COMPARISON_ACTIVE_ROW_TOP_CONTEXT_PX = 200;
/** 列表底部留白，避免最后一行 QA 标签被视口底边裁切 */
const COMPARISON_LIST_BOTTOM_PADDING_PX = 56;

function scrollComparisonListToActiveRow(list: ListImperativeAPI | null, index: number): void {
  if (!list || index < 0) return;
  list.scrollToRow({ index, align: 'start', behavior: 'instant' });
  const el = list.element;
  if (!el || COMPARISON_ACTIVE_ROW_TOP_CONTEXT_PX <= 0) return;
  el.scrollTop = Math.max(0, el.scrollTop - COMPARISON_ACTIVE_ROW_TOP_CONTEXT_PX);
}

// --- Segment Source Editor ---
const SegmentSourceEditorComponent = ({
    segment,
    isEditing,
    onEditStart,
    onEditEnd,
    onSourceChange,
    onSplitSource,
    editorFontSize,
    editorTheme,
    onSelectSource,
    allTerms,
    onTermInsert,
    /** 跨文件搜索结果：文件名 · 句段号，显示在原文单元格底部左侧 */
    locationCaption,
    /** 对照列表为横向格；单句模式为原文上、译文下的竖条 */
    layoutVariant = 'inline',
    formatPickActive = false,
    onSourceRunFormatPick,
}: {
    segment: Segment,
    isEditing: boolean,
    onEditStart: () => void,
    onEditEnd: () => void,
    onSourceChange: (id: string, text: string) => void,
    /** 在光标处将原文拆成两句（由父组件更新句段列表） */
    onSplitSource?: (id: string, leftSource: string, rightSource: string) => void,
    editorFontSize: number,
    editorTheme: any,
    onSelectSource: (text: string) => void,
    allTerms: TermBaseEntryWithTb[],
    onTermInsert?: (target: string) => void,
    locationCaption?: string | null,
    layoutVariant?: 'inline' | 'stacked',
    formatPickActive?: boolean,
    onSourceRunFormatPick?: (runId: string, style: InlineRunStyle) => void,
}) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const skipBlurSaveAfterSplitRef = useRef(false);
    const [localText, setLocalText] = useState(segment.sourceText);

    // Calculate terms relevant to this segment for highlighting
    const relevantTerms = useMemo(() => {
        if (!allTerms || allTerms.length === 0 || !segment.sourceText) return [];
        return filterTermsMatchingSource(segment.sourceText, allTerms, false);
    }, [allTerms, segment.sourceText]);

    useEffect(() => {
        setLocalText(segment.sourceText);
    }, [segment.sourceText]);

    useEffect(() => {
        if (isEditing && textareaRef.current) {
            textareaRef.current.focus();
            // Auto-resize
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        }
    }, [isEditing]);

    const handleSave = () => {
        if (skipBlurSaveAfterSplitRef.current) {
            skipBlurSaveAfterSplitRef.current = false;
            return;
        }
        if (localText !== segment.sourceText) {
            onSourceChange(segment.id, localText);
        }
        onEditEnd();
    };

    const handleCancel = () => {
        setLocalText(segment.sourceText);
        onEditEnd();
    };

    const reportSourceSelection = (raw: string) => {
        const selection = raw.trim();
        if (!selection) return;
        onSelectSource(selection);
    };

    const handleMouseUp = (e: React.MouseEvent) => {
         if (e.ctrlKey && formatPickActive) return;
         const selection = window.getSelection()?.toString();
         if (selection?.trim()) {
             e.stopPropagation();
             reportSourceSelection(selection);
         }
    };

    const handleSourceTextareaSelect = () => {
        const ta = textareaRef.current;
        if (!ta) return;
        const { selectionStart: start, selectionEnd: end } = ta;
        if (start !== end) {
            reportSourceSelection(ta.value.substring(start, end));
        }
    };



    const sourceShellClass =
        layoutVariant === 'stacked'
            ? 'w-full shrink-0 flex flex-col border-b border-slate-200 relative group/source min-h-[min(26vh,10rem)]'
            : 'flex-1 border-r border-slate-200 relative group/source flex flex-col min-h-[4rem]';

    return (
        <div 
            className={sourceShellClass}
            style={{ backgroundColor: editorTheme.sourceBg }}
        >
            <div className="flex-1 min-h-0 relative">
            {isEditing ? (
                <div className="h-full relative">
                    <textarea
                        ref={textareaRef}
                        className="w-full h-full p-3 leading-relaxed bg-white outline-none resize-none overflow-hidden block text-slate-900 border-2 border-blue-400 rounded-sm inset-0 z-20 absolute shadow-lg"
                        value={localText}
                        title="Enter：在光标处拆分句段；Shift+Enter：换行；Ctrl+Enter：保存"
                        onChange={(e) => {
                            setLocalText(e.target.value);
                            e.target.style.height = 'auto';
                            e.target.style.height = `${e.target.scrollHeight}px`;
                        }}
                        onBlur={handleSave}
                        onSelect={handleSourceTextareaSelect}
                        onMouseUp={handleSourceTextareaSelect}
                        onKeyUp={handleSourceTextareaSelect}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                e.preventDefault();
                                handleSave();
                                return;
                            }
                            if (e.key === 'Escape') {
                                handleCancel();
                                return;
                            }
                            if (e.key === 'Enter' && e.shiftKey) {
                                e.preventDefault();
                                const ta = e.currentTarget;
                                const start = ta.selectionStart;
                                const end = ta.selectionEnd;
                                const next = localText.slice(0, start) + '\n' + localText.slice(end);
                                setLocalText(next);
                                const pos = start + 1;
                                queueMicrotask(() => {
                                    const el = textareaRef.current;
                                    if (el) {
                                        el.focus();
                                        el.setSelectionRange(pos, pos);
                                        el.style.height = 'auto';
                                        el.style.height = `${el.scrollHeight}px`;
                                    }
                                });
                                return;
                            }
                            if (
                                e.key === 'Enter' &&
                                !e.shiftKey &&
                                onSplitSource &&
                                !segment.isLocked
                            ) {
                                e.preventDefault();
                                const pos = e.currentTarget.selectionStart;
                                const left = localText.slice(0, pos);
                                const right = localText.slice(pos);
                                if (!left.trim() || !right.trim()) {
                                    alert(
                                        '拆分点不能位于句首或句尾，且前后两段都须包含有效原文。'
                                    );
                                    return;
                                }
                                skipBlurSaveAfterSplitRef.current = true;
                                onSplitSource(segment.id, left, right);
                                return;
                            }
                        }}
                        style={{ fontSize: `${editorFontSize}px` }}
                    />
                    {/* Floating Actions */}
                    <div className="absolute top-0 right-0 z-30 flex bg-white border border-slate-200 rounded shadow-md m-1">
                         <button onClick={(e) => { e.preventDefault(); handleSave(); }} className="p-1 hover:bg-green-50 text-green-600" title="保存 (Ctrl+Enter)"><Icons.Check className="w-4 h-4"/></button>
                         <button onClick={(e) => { e.preventDefault(); handleCancel(); }} className="p-1 hover:bg-red-50 text-red-600" title="取消 (Esc)"><Icons.X className="w-4 h-4"/></button>
                    </div>
                </div>
            ) : (
                <div className="relative h-full group/inner">
                    <div 
                        className="p-3 leading-relaxed whitespace-pre-wrap text-slate-900 h-full select-text"
                        style={{ fontSize: `${editorFontSize}px` }}
                        onMouseUp={handleMouseUp}
                    >
                        {/* Use Highlighting Component here */}
                        <HighlightedSourceText
                          text={segment.sourceText}
                          terms={relevantTerms}
                          inlineRunMeta={segment.inlineRunMeta}
                          formatPickActive={formatPickActive}
                          onFormattedRunPick={onSourceRunFormatPick}
                        />
                    </div>
                    {!segment.isLocked && onTermInsert && relevantTerms.length > 0 && (
                        <TermLensRow
                            sourceText={segment.sourceText}
                            terms={relevantTerms}
                            onInsertTarget={onTermInsert}
                        />
                    )}
                    {/* Edit Button - Visible on Hover */}
                    <button 
                        onClick={(e) => {
                            e.stopPropagation();
                            onEditStart();
                        }}
                        className="absolute top-1 right-1 p-1.5 bg-white/90 hover:bg-blue-50 text-slate-400 hover:text-blue-600 rounded border border-slate-200 shadow-sm opacity-0 group-hover/source:opacity-100 transition-all z-10 hover:scale-105"
                        title="编辑原文"
                    >
                        <Icons.Edit className="w-3 h-3" />
                    </button>
                    {/* Copy Button - Visible on Hover */}
                    <button
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();

                            copyTextToClipboard(segment.sourceText);
                        }}
                        className="absolute top-1 right-10 p-1.5 bg-white/90 hover:bg-blue-50 text-slate-400 hover:text-blue-600 rounded border border-slate-200 shadow-sm opacity-0 group-hover/source:opacity-100 transition-all z-10 hover:scale-105"
                        title="复制原文到剪贴板"
                    >
                        <Icons.Copy className="w-3 h-3" />
                    </button>
                </div>
            )}
            </div>
            {locationCaption ? (
                <div
                    className="shrink-0 px-3 pb-1.5 pt-1 text-left text-[10px] leading-tight text-slate-500 border-t border-slate-200/70 truncate bg-black/[0.02]"
                    title={locationCaption}
                >
                    {locationCaption}
                </div>
            ) : null}
        </div>
    );
};

const SegmentSourceEditor = React.memo(SegmentSourceEditorComponent);

// --- Segment Target Editor ---
type SegmentTargetEditorProps = {
    segment: Segment;
    isActive: boolean;
    onChange: (id: string, val: string) => void;
    onConfirm: (seg: Segment) => void;
    onLockToggle: (id: string) => void;
    onAiTranslate: (seg: Segment) => void;
    onAiPolish: (seg: Segment) => void;
    isAiProcessing: boolean;
    isPolishing: boolean;
    editorTheme: any;
    editorFontSize: number;
    onSelectionChange: (start: number, end: number) => void;
    onDismissQA: (issueId: string) => void;
    onZoomQA: (issue: QAIssue) => void;
    onSelectTarget: (text: string) => void;
    layoutVariant?: 'inline' | 'stacked';
};

const SegmentTargetEditorInner = React.forwardRef<HTMLTextAreaElement, SegmentTargetEditorProps>(
    function SegmentTargetEditorInner(
        {
            segment,
            isActive,
            onChange,
            onConfirm,
            onLockToggle,
            onAiTranslate,
            onAiPolish,
            isAiProcessing,
            isPolishing,
            editorTheme,
            editorFontSize,
            onSelectionChange,
            onDismissQA,
            onZoomQA,
            onSelectTarget,
            layoutVariant = 'inline'
        },
        forwardedRef
    ) {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const [targetHovered, setTargetHovered] = useState(false);

    const useMarkedEditor =
      (segment.inlineRunMeta?.length ?? 0) > 0 ||
      hasInlineMarkers(segment.sourceText) ||
      hasInlineMarkers(segment.targetText);

    const targetMeta = segment.inlineRunMeta;

    const assignTextareaRef = useCallback(
        (node: HTMLTextAreaElement | null) => {
            textareaRef.current = node;
            if (!forwardedRef) return;
            if (typeof forwardedRef === 'function') forwardedRef(node);
            else (forwardedRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
        },
        [forwardedRef]
    );

    // Auto-resize logic (plain textarea mode)
    useEffect(() => {
        if (useMarkedEditor) return;
        const target = textareaRef.current;
        if (target) {
            target.style.height = 'auto';
            target.style.height = `${target.scrollHeight}px`;
            if (isActive) {
                target.focus();
            }
        }
    }, [segment.targetText, isActive, editorFontSize, useMarkedEditor]);

    // Handle cursor/selection tracking
    const handleInputSelect = () => {
        const ta = textareaRef.current;
        if (!ta) return;
        onSelectionChange(ta.selectionStart, ta.selectionEnd);
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        if (start !== end) {
            const selection = ta.value.substring(start, end);
            if (selection.trim()) onSelectTarget(selection);
        }
    };

    const targetShellClass =
        layoutVariant === 'stacked'
            ? 'flex-1 flex flex-col relative group w-full min-h-0'
            : 'flex-1 flex flex-col relative group h-full';

    const showTargetFloatingBar = isActive || (segment.isLocked && targetHovered);
    /** 锁定但未确认：灰色待定底；锁定且已确认：沿用主题确认色。斜线与锁图标一致，锁定句段始终叠加斜线（含自动沿用后已确认）。 */
    const lockedPendingVisual = segment.isLocked && segment.status !== SegmentStatus.Confirmed;
    const lockedStripeBg =
        'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(0,0,0,0.02) 10px, rgba(0,0,0,0.02) 20px)';

    return (
        <div
            className={targetShellClass}
            onMouseEnter={() => setTargetHovered(true)}
            onMouseLeave={() => setTargetHovered(false)}
            style={{ 
            backgroundColor: lockedPendingVisual ? '#f8fafc' : editorTheme.targetBg,
            backgroundImage: segment.isLocked ? lockedStripeBg : 'none'
        }}>
            <div className="relative flex-1 min-h-0 w-full">
            {useMarkedEditor ? (
              <>
                <textarea
                  ref={assignTextareaRef}
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden
                  value={segment.targetText}
                  readOnly
                />
                {segment.isLocked ? (
                  <div
                    className="w-full p-3 leading-relaxed overflow-hidden block text-slate-900"
                    style={{
                      minHeight: '40px',
                      fontSize: `${editorFontSize}px`,
                      paddingBottom: showTargetFloatingBar ? '3rem' : '0.75rem',
                    }}
                  >
                    <InlineMarkedText text={segment.targetText} inlineRunMeta={targetMeta} />
                  </div>
                ) : (
                  <InlineMarkedEditor
                    value={segment.targetText}
                    inlineRunMeta={targetMeta}
                    readOnly={false}
                    className={`w-full p-3 leading-relaxed bg-transparent outline-none overflow-hidden block text-slate-900 ${
                      isActive ? 'ring-1 ring-blue-300/50 rounded-sm' : ''
                    }`}
                    style={{
                      minHeight: '40px',
                      fontSize: `${editorFontSize}px`,
                      paddingBottom: showTargetFloatingBar ? '3rem' : '0.75rem',
                    }}
                    onChange={(val) => onChange(segment.id, val)}
                    onSelectionChange={onSelectionChange}
                  />
                )}
              </>
            ) : (
             <textarea 
                ref={assignTextareaRef}
                tabIndex={segment.isLocked ? -1 : undefined}
                readOnly={segment.isLocked}
                spellCheck={true}
                className={`w-full p-3 leading-relaxed bg-transparent outline-none resize-none overflow-hidden block ${
                    segment.isLocked
                        ? `cursor-not-allowed ${lockedPendingVisual ? 'text-slate-500' : 'text-slate-900'}`
                        : 'text-slate-900'
                } ${/\<[A-Za-z0-9_]+[>\/]/.test(segment.targetText) ? 'font-mono text-[13px]' : ''}`}
                value={segment.targetText}
                onChange={(e) => {
                    onChange(segment.id, e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = `${e.target.scrollHeight}px`;
                }}
                onSelect={handleInputSelect}
                onClick={handleInputSelect}
                onKeyUp={handleInputSelect}
                onKeyDown={(e) => {
                    if (segment.isLocked) return;
                    if (e.key === 'Enter') {
                        if (!e.altKey && !e.shiftKey) {
                            e.preventDefault();
                            onConfirm(segment);
                        }
                    }
                    if (e.key === 'F3' && e.shiftKey) {
                        e.preventDefault();
                        if (textareaRef.current) {
                            const start = textareaRef.current.selectionStart;
                            const end = textareaRef.current.selectionEnd;
                            if (start !== end) {
                                const selectedText = textareaRef.current.value.substring(start, end);
                                let newText = '';
                                const isAllLower = selectedText === selectedText.toLowerCase();
                                const isAllUpper = selectedText === selectedText.toUpperCase();
                                if (isAllLower) {
                                    newText = selectedText.toUpperCase();
                                } else if (isAllUpper) {
                                    newText = selectedText.split(' ').map(word => 
                                        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
                                    ).join(' ');
                                } else {
                                    newText = selectedText.toLowerCase();
                                }
                                const updatedValue = textareaRef.current.value.substring(0, start) + 
                                    newText + 
                                    textareaRef.current.value.substring(end);
                                onChange(segment.id, updatedValue);
                                setTimeout(() => {
                                    if (textareaRef.current) {
                                        textareaRef.current.selectionStart = start;
                                        textareaRef.current.selectionEnd = start + newText.length;
                                    }
                                }, 0);
                            }
                        }
                    }
                }}
                placeholder={isActive && !segment.isLocked ? "在此输入译文..." : ""}
                rows={1}
                style={{ 
                    minHeight: '40px',
                    fontSize: `${editorFontSize}px`,
                    paddingBottom: showTargetFloatingBar ? '3rem' : '0.75rem'
                }}
            />
            )}

            {/* Floating Actions — scoped to editor area so QA badges below stay clickable */}
            {showTargetFloatingBar && (
                <div className="flex justify-end gap-2 px-3 py-2 absolute bottom-0 right-0 w-full z-30 pointer-events-none">
                     <div className="flex gap-2 z-40 pointer-events-auto">
                        <button 
                            onClick={(e) => { e.stopPropagation(); onLockToggle(segment.id); }}
                            className={`p-1.5 bg-white border ${segment.isLocked ? 'border-amber-200 text-amber-600 hover:bg-amber-50' : 'border-slate-200 text-slate-400 hover:text-amber-500 hover:border-amber-200'} rounded shadow-sm`}
                            title={segment.isLocked ? "解锁" : "锁定"}
                        >
                            {segment.isLocked ? <Icons.Unlock className="w-4 h-4" /> : <Icons.Lock className="w-4 h-4" />}
                        </button>
                        
                        {isActive && !segment.isLocked && (
                            <>
                                <button 
                                    onClick={(e) => { e.stopPropagation(); onAiTranslate(segment); }}
                                    className="p-1.5 bg-white border border-purple-200 text-purple-600 hover:bg-purple-50 rounded shadow-sm"
                                    title="AI 翻译"
                                    disabled={isAiProcessing}
                                >
                                    <Icons.Sparkles className={`w-4 h-4 ${isAiProcessing ? 'animate-spin' : ''}`} />
                                </button>
                                <button 
                                    onClick={(e) => { e.stopPropagation(); onAiPolish(segment); }}
                                    className="p-1.5 bg-white border border-indigo-200 text-indigo-600 hover:bg-indigo-50 rounded shadow-sm"
                                    title="AI 润色"
                                    disabled={isPolishing || !segment.targetText}
                                >
                                    <Icons.Magic className={`w-4 h-4 ${isPolishing ? 'animate-spin' : ''}`} />
                                </button>
                                <button 
                                    onClick={(e) => { e.stopPropagation(); onConfirm(segment); }}
                                    className="p-1.5 bg-blue-600 text-white border border-blue-600 rounded shadow-sm hover:bg-blue-700 hover:shadow-md transition-all"
                                    title="确认并跳转 (Enter)"
                                >
                                    <Icons.Check className="w-4 h-4" />
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )}
            </div>

            {/* QA Badges — below editor shell so floating toolbar cannot cover dismiss controls */}
            {segment.qaIssues && segment.qaIssues.length > 0 && (
                <div
                    className="relative z-40 shrink-0 px-3 pb-2 flex flex-wrap gap-2 mt-2 border-t border-slate-100 pt-2"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                >
                    {segment.qaIssues.map((issue) => (
                        <div key={issue.id} className={`text-[10px] px-2 py-1 rounded shadow-sm flex items-center gap-1.5 animate-in fade-in zoom-in-95 ${
                            issue.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-amber-50 text-amber-800 border border-amber-200'
                        }`}>
                            <Icons.Warning className="w-3 h-3 shrink-0" />
                            <span className={`font-medium ${issue.category === 'tags' ? 'max-w-[240px]' : 'max-w-[150px]'} truncate`}>{issue.message}</span>
                            
                            {/* Req 1: Zoom Button */}
                            <button 
                                type="button"
                                onClick={(e) => { e.stopPropagation(); onZoomQA(issue); }}
                                className="ml-1 p-0.5 rounded hover:bg-black/5"
                                title="放大查看"
                            >
                                <Icons.ScanSearch className="w-3 h-3" />
                            </button>

                            <button 
                                type="button"
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={(e) => { e.stopPropagation(); onDismissQA(issue.id); }}
                                className={`ml-1 p-0.5 rounded hover:bg-black/5 ${issue.type === 'error' ? 'text-red-500' : 'text-amber-600'}`}
                                title="关闭此 QA 提示"
                            >
                                <Icons.X className="w-3 h-3" />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
});

const SegmentTargetEditor = React.memo(SegmentTargetEditorInner);

/** react-window 对照模式行上下文 */
type ComparisonVirtualRowCtx = {
  filteredSegments: Segment[];
  project: Project;
  reduceMotion: boolean;
  activeSegmentId: string | null;
  selectedSegmentIds: Set<string>;
  editingSourceId: string | null;
  editorFontSizeMain: number;
  editorTheme: { sourceBg: string; targetBg: string };
  textSearchScope: 'file' | 'project';
  textSearchQuery: string;
  allTerms: TermBaseEntryWithTb[];
  activeTargetTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  handleRowClick: (e: React.MouseEvent, id: string) => void;
  handleCheckboxClick: (e: React.MouseEvent, id: string) => void;
  handleSourceChange: (id: string, text: string) => void;
  handleSplitSourceSegment: (segmentId: string, leftSource: string, rightSource: string) => void;
  handleSegmentChange: (id: string, newText: string) => void;
  handleApplySourceRunFormat: (seg: Segment, runId: string, style: InlineRunStyle) => void;
  ctrlKeyHeld: boolean;
  hasTargetTextSelection: boolean;
  confirmSegment: (segment: Segment) => void;
  toggleSegmentLock: (segmentId: string) => void;
  handleAiTranslate: (segment: Segment) => void | Promise<void>;
  handleAiPolish: (segment: Segment) => void | Promise<void>;
  isAiProcessing: boolean;
  isPolishing: boolean;
  handleDismissQA: (segmentId: string, issueId: string) => void;
  setQaZoomIssue: React.Dispatch<React.SetStateAction<QAIssue | null>>;
  handleEditorTextSelection: (text: string, role: 'source' | 'target') => void;
  setTextSelection: (r: { start: number; end: number }) => void;
  getMatchLabel: (seg: Segment) => string | null;
  getStatusIcon: (status: SegmentStatus) => React.ReactNode;
  /** 中间栏状态图标：锁定 + 100% 沿用译文时与「已确认」一致 */
  getMiddleColumnEffectiveStatus: (seg: Segment) => SegmentStatus;
  setEditingSourceId: React.Dispatch<React.SetStateAction<string | null>>;
  activeRowRef: React.RefObject<HTMLDivElement | null>;
};

function ComparisonVirtualRow({
  index,
  style,
  ariaAttributes,
  ...ctx
}: RowComponentProps<ComparisonVirtualRowCtx>) {
  const {
    filteredSegments,
    project,
    reduceMotion,
    activeSegmentId,
    selectedSegmentIds,
    editingSourceId,
    editorFontSizeMain,
    editorTheme,
    textSearchScope,
    textSearchQuery,
    allTerms,
    activeTargetTextareaRef,
    handleRowClick,
    handleCheckboxClick,
    handleSourceChange,
    handleSplitSourceSegment,
    handleSegmentChange,
    handleApplySourceRunFormat,
    ctrlKeyHeld,
    hasTargetTextSelection,
    confirmSegment,
    toggleSegmentLock,
    handleAiTranslate,
    handleAiPolish,
    isAiProcessing,
    isPolishing,
    handleDismissQA,
    setQaZoomIssue,
    handleEditorTextSelection,
    setTextSelection,
    getMatchLabel,
    getStatusIcon,
    getMiddleColumnEffectiveStatus,
    setEditingSourceId,
    activeRowRef,
  } = ctx;

  const seg = filteredSegments[index];
  if (!seg) return null;

  const isActive = seg.id === activeSegmentId;
  const isSelected = selectedSegmentIds.has(seg.id);
  const matchLabel = getMatchLabel(seg);
  const displayFile = project.files.find((f) => f.segments.some((s) => s.id === seg.id));
  const displayIndex = displayFile ? displayFile.segments.findIndex((s) => s.id === seg.id) + 1 : 0;
  const locationLabel = displayFile ? `${displayFile.name} · #${displayIndex}` : '';
  const showSourceLocationCaption =
    textSearchScope === 'project' && Boolean(textSearchQuery.trim()) && Boolean(locationLabel);
  const rowMinH = 'min-h-[4rem]';
  const motionCls = reduceMotion ? '' : 'transition-all duration-75';
  const chkAnim = reduceMotion ? '' : 'animate-in zoom-in-50 duration-200';
  const formatPickActive =
    isActive &&
    ctrlKeyHeld &&
    hasTargetTextSelection &&
    segmentHasCopyableSourceFormat(seg.sourceText, seg.inlineRunMeta);

  return (
    <div
      {...ariaAttributes}
      style={style}
      ref={isActive ? activeRowRef : undefined}
      onClick={(e) => handleRowClick(e, seg.id)}
      className={`group flex ${rowMinH} border-b border-slate-200 ${motionCls} scroll-mt-20 select-none ${
        isActive ? 'ring-2 ring-blue-500 relative z-10 shadow-lg' : 'hover:bg-slate-100/50'
      } ${isSelected && !isActive ? 'bg-blue-50/80 border-blue-200' : ''}`}
    >
      <div
        className={`w-12 shrink-0 border-r border-slate-200 flex flex-col items-center justify-center text-xs font-mono cursor-pointer transition-colors ${
          isSelected ? 'bg-blue-100 text-blue-700 font-bold' : 'bg-slate-50 text-slate-400 group-hover:bg-slate-100'
        }`}
        onClick={(e) => handleCheckboxClick(e, seg.id)}
      >
        <div
          className={`w-full h-full flex items-center justify-center ${isSelected ? 'hidden' : 'group-hover:hidden'}`}
        >
          {displayIndex}
        </div>
        <div className={`${isSelected ? 'block' : 'hidden group-hover:block'} ${chkAnim}`}>
          <div
            className={`w-4 h-4 rounded border flex items-center justify-center ${
              isSelected ? 'bg-blue-600 border-blue-600' : 'bg-white border-slate-300'
            }`}
          >
            {isSelected && <Icons.Check className="w-3 h-3 text-white" />}
          </div>
        </div>
      </div>

      <SegmentSourceEditor
        segment={seg}
        isEditing={editingSourceId === seg.id}
        onEditStart={() => setEditingSourceId(seg.id)}
        onEditEnd={() => setEditingSourceId(null)}
        onSourceChange={handleSourceChange}
        onSplitSource={seg.isLocked ? undefined : handleSplitSourceSegment}
        editorFontSize={editorFontSizeMain}
        editorTheme={editorTheme}
        onSelectSource={(text) => handleEditorTextSelection(text, 'source')}
        allTerms={allTerms}
        onTermInsert={
          isActive && !seg.isLocked
            ? (t) => {
                const cur = seg.targetText || '';
                handleSegmentChange(seg.id, cur ? `${cur} ${t}` : t);
              }
            : undefined
        }
        locationCaption={showSourceLocationCaption ? locationLabel : undefined}
        formatPickActive={formatPickActive}
        onSourceRunFormatPick={
          formatPickActive
            ? (runId, style) => handleApplySourceRunFormat(seg, runId, style)
            : undefined
        }
      />

      <div className="w-20 shrink-0 bg-slate-50 border-r border-slate-200 flex flex-col items-center justify-center gap-1.5 select-none">
        {matchLabel && (
          <span className="text-[10px] font-bold text-slate-600 bg-white px-1.5 py-0.5 rounded border border-slate-200 shadow-sm">
            {matchLabel}
          </span>
        )}
        <div title={getMiddleColumnEffectiveStatus(seg)}>
          {getStatusIcon(getMiddleColumnEffectiveStatus(seg))}
        </div>
        {seg.isLocked && <Icons.Lock className="w-3 h-3 text-slate-400 opacity-75" />}
      </div>

      <SegmentTargetEditor
        ref={isActive ? activeTargetTextareaRef : undefined}
        segment={seg}
        isActive={isActive}
        onChange={handleSegmentChange}
        onConfirm={confirmSegment}
        onLockToggle={toggleSegmentLock}
        onAiTranslate={handleAiTranslate}
        onAiPolish={handleAiPolish}
        isAiProcessing={isAiProcessing}
        isPolishing={isPolishing}
        editorTheme={editorTheme}
        editorFontSize={editorFontSizeMain}
        onSelectionChange={(start, end) => setTextSelection({ start, end })}
        onDismissQA={(issueId) => handleDismissQA(seg.id, issueId)}
        onZoomQA={setQaZoomIssue}
        onSelectTarget={(text) => handleEditorTextSelection(text, 'target')}
      />
    </div>
  );
}

// --- Sort Mode Type ---

type SortMode = 'natural' | 'status' | 'matchDesc' | 'matchAsc' | 'sourceAsc' | 'sourceDesc' | 'lengthAsc' | 'lengthDesc';

export const Editor: React.FC<EditorProps> = ({ 
    project, activeFileId, onActiveFileChange,
    onUpdateFileSegments,
    onUpdateMultipleFileSegments,
    mainTB, auxiliaryTBs,
    mainTM, auxiliaryTMs, 
    onAddTM, onAddTerm, onUpdateTerm, onDeleteTerm,
    editorTheme, onUpdateEditorTheme,
    editorFontSize, onUpdateEditorFontSize,
    autoPropagate, onUpdateAutoPropagate,
    capitalizeTargetFirstLetterZhOut,
    editorLayoutMode, onUpdateEditorLayoutMode,
    editorQuickSymbols,
    onUpdateEditorQuickSymbols,
    aiSettings,
    quickPrompts,
    twinTranslators = [],
    onTwinTranslatorsChange,
    onNavigateToTwinTranslators,
    knowledgeBases = [],
    onKnowledgeBasesChange,
    embeddingSettings = DEFAULT_EMBEDDING_SETTINGS,
    mtReferenceSettings = DEFAULT_MT_REFERENCE_SETTINGS,
    onUpdateMtReferenceSettings,
    grammarRuleBooks = [],
    regexDictionaryBooks = [],
    dictionaryQueryResolverRef,
    editorDictionaryOpenerRef,
    editorMtReferenceOpenerRef,
    customOnlineDictionaries = [],
    resumeSegmentId = null,
    resumeLayoutKey = 0,
    onEditorPlaceChange,
    reduceVisualEffects = false,
}) => {
  // 导出文件功能
  const handleExportFile = () => {
    if (!project || !activeFileId) return;
    
    const activeFile = project.files.find(f => f.id === activeFileId) || project.files[0];
    if (!activeFile) return;
    
    // 准备导出数据 - 只保留原文和译文两列
    const exportData = activeFile.segments.map(segment => ({
      '原文': segment.sourceText,
      '译文': segment.targetText
    }));
    
    // 创建工作簿和工作表
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "翻译内容");
    
    // 导出为Excel文件
    XLSX.writeFile(workbook, `${activeFile.name}_导出.xlsx`);
  };
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  /** 父组件传入的上次句段 id；用 ref 在 layout 阶段读最新值，避免 useState 初值只采一次导致永远 null */
  const resumeSegmentIdRef = useRef<string | null>(null);
  resumeSegmentIdRef.current = resumeSegmentId ?? null;
  /** 卸载时 flush 用：避免 useEffect(同步父组件) 晚于卸载导致未写入 editorResume */
  const editorPlaceFileIdRef = useRef<string | null>(null);
  const editorPlaceSegmentIdRef = useRef<string | null>(null);
  const editorPlaceProjectIdRef = useRef<string | null>(null);
  editorPlaceFileIdRef.current = activeFileId;
  editorPlaceSegmentIdRef.current = activeSegmentId;
  editorPlaceProjectIdRef.current = project?.id ?? null;
  useLayoutEffect(() => {
    return () => {
      if (!onEditorPlaceChange) return;
      const pid = editorPlaceProjectIdRef.current;
      const fid = editorPlaceFileIdRef.current;
      const sid = editorPlaceSegmentIdRef.current;
      if (pid && fid && sid) {
        onEditorPlaceChange({ fileId: fid, segmentId: sid, projectId: pid });
      }
    };
  }, [onEditorPlaceChange]);
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null); 
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [sortMode, setSortMode] = useState<SortMode>('natural');
  const [processedSegmentIds, setProcessedSegmentIds] = useState<Set<string>>(new Set());

  // --- Batch Selection State ---
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<Set<string>>(new Set());
  const [lastInteractedId, setLastInteractedId] = useState<string | null>(null);
  
  const segmentContainerRef = useRef<HTMLDivElement>(null);
  const comparisonListRef = useRef<ListImperativeAPI | null>(null);
  const comparisonListViewportRef = useRef<HTMLDivElement>(null);
  const [comparisonListSize, setComparisonListSize] = useState({ width: 0, height: 0 });
  /** 对照列表动态行高缓存 bump：重复句批量更新译文后强制重测，避免虚拟列表仍显示旧高度/旧内容 */
  const [comparisonListMeasureEpoch, setComparisonListMeasureEpoch] = useState(0);
  
  // --- Sidebar State ---
  const [sidebarWidth, setSidebarWidth] = useState(350);
  const [isResizing, setIsResizing] = useState(false);
  const [isResizingVertical, setIsResizingVertical] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);
  const [aiPanelHeight, setAiPanelHeight] = useState(35);
  const [activeSidebarTab, setActiveSidebarTab] = useState<'matches' | 'terms' | 'concordance'>('matches');
  
  // --- 孪生译员相关状态 ---
  const [twinTranslatorVariants, setTwinTranslatorVariants] = useState<any[]>([]);
  const [showTwinTranslatorPanel, setShowTwinTranslatorPanel] = useState(false);
  const [twinLearningCapModal, setTwinLearningCapModal] = useState<null | {
    translatorName: string;
    profile: TwinTranslatorProfile;
    kind: 'first_full' | 'rotating';
  }>(null);
  const [twinKbSaving, setTwinKbSaving] = useState(false);

  // --- Concordance Search State ---
  const [concordanceQuery, setConcordanceQuery] = useState('');
  const [concordanceResults, setConcordanceResults] = useState<(TranslationMemoryUnit & { sourceTM?: string })[]>([]);

  // --- Text Search State ---
  /** 输入框草稿；按 Enter 后才写入 textSearchQuery 参与筛选，避免每键重渲染虚拟列表导致失焦 */
  const [textSearchDraft, setTextSearchDraft] = useState('');
  const [textSearchQuery, setTextSearchQuery] = useState('');
  const [textSearchMode, setTextSearchMode] = useState<'source' | 'target'>('source');
  const [textSearchScope, setTextSearchScope] = useState<'file' | 'project'>('file');
  const textSearchInputRef = useRef<HTMLInputElement>(null);

  const applyTextSearch = useCallback(() => {
    setTextSearchQuery(textSearchDraft.trim());
    requestAnimationFrame(() => textSearchInputRef.current?.focus());
  }, [textSearchDraft]);

  const clearTextSearch = useCallback(() => {
    setTextSearchDraft('');
    setTextSearchQuery('');
    requestAnimationFrame(() => textSearchInputRef.current?.focus());
  }, []);
  
  // --- Sidebar TB Search ---
  const [tbSearchQuery, setTbSearchQuery] = useState('');
  const [showAddTermForm, setShowAddTermForm] = useState(false);
  const [showTermSearch, setShowTermSearch] = useState(false);
  const tbSearchInputRef = useRef<HTMLInputElement>(null);

  // --- Segment Jump State ---
  const [jumpInput, setJumpInput] = useState('');
  const [showJumpInput, setShowJumpInput] = useState(false);
  const jumpInputRef = useRef<HTMLInputElement>(null);
  const [pendingQASegmentJump, setPendingQASegmentJump] = useState<{ fileId: string; segmentId: string } | null>(null);

  const [showQuickSymbolMenu, setShowQuickSymbolMenu] = useState(false);
  const [quickSymbolNewInput, setQuickSymbolNewInput] = useState('');
  const quickSymbolMenuRef = useRef<HTMLDivElement>(null);

  // --- Find & Replace State ---
  const [isReplaceModalOpen, setIsReplaceModalOpen] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [replacedSegments, setReplacedSegments] = useState<Segment[]>([]);
  const [showReplacePanel, setShowReplacePanel] = useState(false);
  const [findType, setFindType] = useState<'source' | 'target'>('target');
  const [replaceType, setReplaceType] = useState<'source' | 'target'>('target');
  const [replaceScope, setReplaceScope] = useState<'file' | 'project'>('file');
  const [findResults, setFindResults] = useState<{fileId: string, segment: Segment}[]>([]);
  const [showFindResults, setShowFindResults] = useState(false);
  /** 查找与替换：使用 ECMAScript 正则（替换串支持 $1、$2、$&、$0、$$） */
  const [findUseRegex, setFindUseRegex] = useState(false);
  const findRegexError = useMemo(() => {
    if (!findUseRegex || !findText.trim()) return null;
    return validateFindRegex(findText);
  }, [findUseRegex, findText]);
  const [editingResultId, setEditingResultId] = useState<string | null>(null);
  const [editingSourceText, setEditingSourceText] = useState('');
  const [editingTargetText, setEditingTargetText] = useState('');

  // --- Export Dropdown (已删除导出按钮) ---
  // const [showExportMenu, setShowExportMenu] = useState(false);

  // --- Editor Settings Modal ---
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [customBgColor, setCustomBgColor] = useState('#ffffff'); 

  // QA Configuration State
  const [qaConfig, setQaConfig] = useState({
      numberAccuracy: true,
      termMatch: true,
      punctuationPair: true,
      untranslated: true,
      sourceTargetSame: true,
      repeatedWords: true,
      targetLength: false,
      inconsistency: true,
      sentenceCapitalization: true,
      ignoreCase: true,
  });
  const [showQASettings, setShowQASettings] = useState(false);
  const [showQAPanel, setShowQAPanel] = useState(false);
  const [qaZoomIssue, setQaZoomIssue] = useState<QAIssue | null>(null); 
  const [qaReportScope, setQaReportScope] = useState<'current' | 'all'>('current'); // 控制QA报告显示范围
  
  // Add Term / inline edit Term Sidebar State
  const [editingTermId, setEditingTermId] = useState<string | null>(null);
  const [editingTermTarget, setEditingTermTarget] = useState('');
  const [termSource, setTermSource] = useState('');
  const [termTarget, setTermTarget] = useState('');
  // Term Deletion Modal State
  const [termToDelete, setTermToDelete] = useState<TermBaseEntry | null>(null);

  // Term Extraction State
  const [isExtractModalOpen, setIsExtractModalOpen] = useState(false);
  const [extractStep, setExtractStep] = useState<'config' | 'processing' | 'review'>('config');
  const [extractConfig, setExtractConfig] = useState({
      types: { technical: true, person: false, location: false, org: true },
      threshold: 1
  });
  const [extractedCandidates, setExtractedCandidates] = useState<TermCandidate[]>([]);
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set());
  /** 术语提取审校导出：仅勾选行或全部候选 */
  const [extractExportScope, setExtractExportScope] = useState<'selected' | 'all'>('selected');

  // Batch Translation State
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [batchStep, setBatchStep] = useState<'mode-select' | 'analyzing' | 'review-prompt' | 'processing' | 'done'>('mode-select');
  const [batchPrompt, setBatchPrompt] = useState('');
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const [batchStats, setBatchStats] = useState({ succeeded: 0, failed: 0 });
  const [batchStrategy, setBatchStrategy] = useState<PreTranslateStrategy>('tmMtLlm');
  const [batchFuzzyThreshold, setBatchFuzzyThreshold] = useState(75);
  const [batchSourceStats, setBatchSourceStats] = useState<PreTranslateBatchStats | null>(null);
  const [isProofreadModalOpen, setIsProofreadModalOpen] = useState(false);
  const [proofreadProgress, setProofreadProgress] = useState({ current: 0, total: 0 });
  const [proofreadStats, setProofreadStats] = useState<ProofreadBatchStats | null>(null);
  const [isProofreadRunning, setIsProofreadRunning] = useState(false);
  const proofreadCancelRef = useRef(0);
  const [quickMtOpen, setQuickMtOpen] = useState(false);
  const [quickMtSource, setQuickMtSource] = useState('');
  const idlePrefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tmMatches, setTmMatches] = useState<TmMatchHit[]>([]);
  /** 关闭弹窗时递增；进行中任务捕获启动时的代数，用于可靠取消（含快速重开弹窗） */
  const batchModalCancelGenerationRef = useRef(0);

  // AI Chat State
  const [aiMode, setAiMode] = useState<'actions' | 'chat'>('actions');
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'model', text: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatSending, setIsChatSending] = useState(false);

  const [isAiProcessing, setIsAiProcessing] = useState(false);
  /** 底部多选浮动条「批量翻译」进行中，与单句 isAiProcessing 分离以免互相禁用 */
  const [isSelectionBatchTranslating, setIsSelectionBatchTranslating] = useState(false);
  const [isPolishing, setIsPolishing] = useState(false);
  const [isDeepQAProcessing, setIsDeepQAProcessing] = useState(false);
  const activeRowRef = useRef<HTMLDivElement>(null);

  // Text Selection Tracking for Replacement and Concordance
  const [textSelection, setTextSelection] = useState<{start: number, end: number}>({ start: 0, end: 0 });
  const [ctrlKeyHeld, setCtrlKeyHeld] = useState(false);
  const [currentSelectedText, setCurrentSelectedText] = useState('');
  const [dictPanelOpen, setDictPanelOpen] = useState(false);
  const [dictPanelCollapsed, setDictPanelCollapsed] = useState(false);
  const [dictQuery, setDictQuery] = useState('');
  const [dictProviderId, setDictProviderId] = useState<OnlineDictionaryId>('youdao');

  useEffect(() => {
    const available = getAllOnlineDictionaryProviders(customOnlineDictionaries);
    if (!available.some((p) => p.id === dictProviderId)) {
      setDictProviderId('youdao');
    }
  }, [customOnlineDictionaries, dictProviderId]);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey) setCtrlKeyHeld(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!e.ctrlKey) setCtrlKeyHeld(false);
    };
    const onBlur = () => setCtrlKeyHeld(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
  const [dictAutoLookup, setDictAutoLookup] = useState(readDictionaryAutoLookupEnabled);
  const dictLookupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAutoDictQueryRef = useRef('');
  const [bottomPanelTab, setBottomPanelTab] = useState<EditorBottomPanelTab>('dictionary');
  const [mtTranslatorId, setMtTranslatorId] = useState(mtReferenceSettings.defaultTranslator);
  const [mtLoading, setMtLoading] = useState(false);
  const [mtError, setMtError] = useState<string | null>(null);
  const [mtResult, setMtResult] = useState<string | null>(null);
  const [mtElapsedMs, setMtElapsedMs] = useState<number | null>(null);
  const [mtCompareResults, setMtCompareResults] = useState<MtCompareResultItem[]>([]);
  const [mtCompareSelectedId, setMtCompareSelectedId] = useState<string | null>(null);
  const [mtCompareModalOpen, setMtCompareModalOpen] = useState(false);

  const mtTranslatorOptions = useMemo(
    () => MT_TRANSLATOR_OPTIONS.filter((o) => mtReferenceSettings.enabledTranslators.includes(o.id)),
    [mtReferenceSettings.enabledTranslators]
  );

  useEffect(() => {
    if (!mtTranslatorOptions.some((o) => o.id === mtTranslatorId)) {
      const fallback =
        mtTranslatorOptions.find((o) => o.id === mtReferenceSettings.defaultTranslator) ??
        mtTranslatorOptions[0];
      if (fallback) setMtTranslatorId(fallback.id);
    }
  }, [mtTranslatorOptions, mtTranslatorId, mtReferenceSettings.defaultTranslator]);

  const resolveDictionaryQuery = useCallback((): string => {
    const sel = window.getSelection()?.toString().trim() || currentSelectedText.trim();
    if (sel) return sel;
    if (!project) return '';
    const file = project.files.find((f) => f.id === activeFileId) || project.files[0];
    const seg = file?.segments.find((s) => s.id === activeSegmentId);
    return (seg?.sourceText ?? '').trim();
  }, [project, activeFileId, activeSegmentId, currentSelectedText]);

  /** 句段切换自动 MT：始终用当前句原文，不受划选影响 */
  const resolveSegmentSourceQuery = useCallback((): string => {
    if (!project || !activeSegmentId) return '';
    const file = project.files.find((f) => f.id === activeFileId) || project.files[0];
    const seg = file?.segments.find((s) => s.id === activeSegmentId);
    return (seg?.sourceText ?? '').trim().replace(/\s+/g, ' ');
  }, [project, activeFileId, activeSegmentId]);

  const openDictionaryWithQuery = useCallback((raw: string, compact = false) => {
    const q = raw.trim().replace(/\s+/g, ' ');
    setBottomPanelTab('dictionary');
    setDictQuery(q);
    setDictPanelOpen(true);
    setDictPanelCollapsed(compact);
  }, []);

  const openMtCompareModalWithQuery = useCallback(
    (raw: string) => {
      const q = raw.trim().replace(/\s+/g, ' ');
      setDictQuery(q);
      setMtCompareModalOpen(true);
      if (!mtReferenceSettings.compareMode) {
        onUpdateMtReferenceSettings?.({
          ...mtReferenceSettings,
          compareMode: true,
        });
      }
    },
    [mtReferenceSettings, onUpdateMtReferenceSettings]
  );

  const openMtReferenceWithQuery = useCallback(
    (raw: string, compact = false) => {
      const q = raw.trim().replace(/\s+/g, ' ');
      setDictQuery(q);
      if (mtReferenceSettings.compareMode) {
        setMtCompareModalOpen(true);
        return;
      }
      setBottomPanelTab('mt');
      setDictPanelOpen(true);
      setDictPanelCollapsed(compact);
    },
    [mtReferenceSettings.compareMode]
  );

  const runMtReferenceLookup = useCallback(
    async (rawQuery?: string) => {
      if (!mtReferenceSettings.enabled) return;
      const q = (rawQuery ?? (dictQuery.trim() || resolveSegmentSourceQuery()))
        .trim()
        .replace(/\s+/g, ' ');
      if (!q || !project) {
        setMtResult(null);
        setMtError(null);
        setMtCompareResults([]);
        return;
      }

      if (mtReferenceSettings.compareMode) {
        const ids = (mtReferenceSettings.compareTranslators ?? [])
          .filter((id) => mtReferenceSettings.enabledTranslators.includes(id))
          .slice(0, MT_COMPARE_MAX);
        if (ids.length === 0) {
          setMtCompareResults([]);
          setMtError('请至少选择一个对比引擎');
          return;
        }
        setMtLoading(true);
        setMtError(null);
        setMtResult(null);
        setMtElapsedMs(null);
        setMtCompareResults(
          ids.map((id) => ({
            translatorId: id,
            label: mtTranslatorLabel(id),
            status: 'loading' as const,
          }))
        );
        try {
          const rows = await fetchMtReferenceCompare(
            q,
            ids,
            project.sourceLang,
            project.targetLang,
            mtReferenceSettings
          );
          setMtCompareResults(rows);
          const firstOk = rows.find((r) => r.status === 'ok');
          setMtCompareSelectedId((prev) =>
            prev && rows.some((r) => r.translatorId === prev && r.status === 'ok')
              ? prev
              : firstOk?.translatorId ?? ids[0]
          );
        } finally {
          setMtLoading(false);
        }
        return;
      }

      setMtCompareResults([]);
      setMtLoading(true);
      setMtError(null);
      try {
        const r = await fetchMtReference(
          q,
          mtTranslatorId,
          project.sourceLang,
          project.targetLang,
          mtReferenceSettings
        );
        if (r.ok) {
          setMtResult(r.text ?? '');
          setMtElapsedMs(r.elapsedMs ?? null);
        } else {
          setMtResult(null);
          setMtElapsedMs(null);
          setMtError(r.error ?? '查询失败');
        }
      } finally {
        setMtLoading(false);
      }
    },
    [mtReferenceSettings, mtTranslatorId, project, dictQuery, resolveSegmentSourceQuery]
  );

  const scheduleDictionaryLookup = useCallback(
    (raw: string) => {
      if (!dictAutoLookup) return;
      const q = raw.trim();
      if (!q || q.length > 80) return;
      if (dictLookupTimerRef.current) clearTimeout(dictLookupTimerRef.current);
      dictLookupTimerRef.current = setTimeout(() => {
        if (q === lastAutoDictQueryRef.current) return;
        lastAutoDictQueryRef.current = q;
        openDictionaryWithQuery(q, true);
      }, 280);
    },
    [dictAutoLookup, openDictionaryWithQuery]
  );

  const handleEditorTextSelection = useCallback(
    (text: string, role: 'source' | 'target') => {
      const t = text.trim();
      if (!t) return;
      setCurrentSelectedText(t);
      if (role === 'source') {
        setTermSource(t);
        copyTextToClipboard(t);
      } else {
        setTermTarget(t);
      }
      scheduleDictionaryLookup(t);
    },
    [scheduleDictionaryLookup]
  );

  useEffect(() => {
    return () => {
      if (dictLookupTimerRef.current) clearTimeout(dictLookupTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!mtReferenceSettings.enabled || !mtReferenceSettings.autoLookupOnSegmentChange) return;
    if (!activeSegmentId) return;
    const q = resolveSegmentSourceQuery();
    if (!q) return;
    setCurrentSelectedText('');
    openMtReferenceWithQuery(q, false);
  }, [
    activeSegmentId,
    activeFileId,
    mtReferenceSettings.enabled,
    mtReferenceSettings.autoLookupOnSegmentChange,
    resolveSegmentSourceQuery,
    openMtReferenceWithQuery,
  ]);

  useEffect(() => {
    if (!mtReferenceSettings.enabled) return;
    const modalActive = mtCompareModalOpen && mtReferenceSettings.compareMode;
    const panelActive =
      bottomPanelTab === 'mt' && dictPanelOpen && !mtReferenceSettings.compareMode;
    if (!modalActive && !panelActive) return;
    const q = dictQuery.trim() || resolveSegmentSourceQuery();
    if (q) void runMtReferenceLookup(q);
  }, [
    mtCompareModalOpen,
    bottomPanelTab,
    dictPanelOpen,
    dictQuery,
    mtTranslatorId,
    activeSegmentId,
    mtReferenceSettings.enabled,
    mtReferenceSettings.compareMode,
    mtReferenceSettings.compareTranslators,
    resolveSegmentSourceQuery,
    runMtReferenceLookup,
  ]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!mtReferenceSettings.enabled) return;
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key.toLowerCase() !== 'm' || !e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('select')) return;
      if (t instanceof HTMLInputElement && t.type !== 'checkbox' && t.type !== 'radio') return;
      e.preventDefault();
      const q = resolveSegmentSourceQuery();
      openMtReferenceWithQuery(q, false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [
    mtReferenceSettings.enabled,
    resolveSegmentSourceQuery,
    openMtReferenceWithQuery,
  ]);

  /** 标题栏「在线词典」/ Ctrl+D：解析当前宜检索的字符串 */
  useEffect(() => {
    if (!dictionaryQueryResolverRef) return;
    if (!project) {
      dictionaryQueryResolverRef.current = null;
      return;
    }
    dictionaryQueryResolverRef.current = resolveDictionaryQuery;
    return () => {
      dictionaryQueryResolverRef.current = null;
    };
  }, [dictionaryQueryResolverRef, project, resolveDictionaryQuery]);

  useEffect(() => {
    if (!editorDictionaryOpenerRef) return;
    editorDictionaryOpenerRef.current = () => {
      setBottomPanelTab('dictionary');
      setDictPanelOpen(true);
      setDictPanelCollapsed(false);
    };
    return () => {
      editorDictionaryOpenerRef.current = null;
    };
  }, [editorDictionaryOpenerRef]);

  useEffect(() => {
    if (!editorMtReferenceOpenerRef) return;
    editorMtReferenceOpenerRef.current = () => {
      if (!mtReferenceSettings.enabled) return;
      const q = resolveSegmentSourceQuery();
      openMtReferenceWithQuery(q, false);
    };
    return () => {
      editorMtReferenceOpenerRef.current = null;
    };
  }, [
    editorMtReferenceOpenerRef,
    mtReferenceSettings.enabled,
    resolveSegmentSourceQuery,
    openMtReferenceWithQuery,
  ]);

  useEffect(() => {
    if (!showQuickSymbolMenu) return;
    const onDoc = (e: MouseEvent) => {
      const node = quickSymbolMenuRef.current;
      if (!node) return;
      const t = e.target;
      if (t instanceof Node && !node.contains(t)) setShowQuickSymbolMenu(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [showQuickSymbolMenu]);

  /** 当前焦点句段的译文 textarea，用于上/下标与清除格式后恢复选区 */
  const activeTargetTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  /** 供全局快捷键调用最新的 handleSaveTerm，避免过长的 effect 依赖链 */
  const handleSaveTermRef = useRef<() => void>(() => {});

  const [collapsedMatches, setCollapsedMatches] = useState<Set<string>>(new Set());

  const toggleMatchExpansion = useCallback((matchKey: string) => {
    setCollapsedMatches(prev => {
      const newSet = new Set(prev);
      if (newSet.has(matchKey)) {
        newSet.delete(matchKey);
      } else {
        newSet.add(matchKey);
      }
      return newSet;
    });
  }, []);

  const isMatchCollapsed = useCallback((matchKey: string) => {
    return collapsedMatches.has(matchKey);
  }, [collapsedMatches]);

  // Term Base Interaction State
  const [activeTermSource, setActiveTermSource] = useState<string | null>(null);

  const findSegmentLocation = useCallback((segmentId: string) => {
      if (!project?.files) return null;
      for (const file of project.files) {
          const segmentIndex = file.segments.findIndex(s => s.id === segmentId);
          if (segmentIndex !== -1) {
              return { file, segmentIndex };
          }
      }
      return null;
  }, [project]);

  const grammarRulesSorted = useMemo(() => {
      if (!project) return [];
      const ids = new Set(project.grammarRuleBookIds ?? []);
      const mounted = grammarRuleBooks.filter(
          (b) =>
              ids.has(b.id) &&
              b.sourceLang === project.sourceLang &&
              b.targetLang === project.targetLang
      );
      return flattenAndSortGrammarRules(mounted);
  }, [project, grammarRuleBooks]);

  const mountedRegexBooks = useMemo(() => {
      if (!project) return [];
      const ids = new Set(project.regexDictionaryBookIds ?? []);
      return regexDictionaryBooks.filter(
          (b) =>
              ids.has(b.id) &&
              b.sourceLang === project.sourceLang &&
              b.targetLang === project.targetLang
      );
  }, [project, regexDictionaryBooks]);

  const regexCategoryMap = useMemo(() => buildRegexCategoryMap(mountedRegexBooks), [mountedRegexBooks]);

  const uncategorizedRegexEntries = useMemo(
      () => collectUncategorizedRegexEntries(mountedRegexBooks),
      [mountedRegexBooks]
  );

  const deliveryDueRaw = project ? getProjectDeliveryDueRaw(project) : undefined;
  const deliveryDueReminder = useProjectDeliveryDueReminder(deliveryDueRaw, {
      projectCompleted: project?.isCompleted === true,
      reminderEnabled: project?.deliveryDueReminderEnabled !== false,
  });

  if (!project) return <div className="p-8 text-center text-slate-500">未选择项目</div>;

  const activeFile = project.files.find(f => f.id === activeFileId) || project.files[0];
  if (!activeFile) return <div className="p-8 text-center text-slate-500">项目中没有文件</div>;

  const activeSegmentLoc = activeSegmentId ? findSegmentLocation(activeSegmentId) : null;
  const activeSegment = activeSegmentLoc
      ? activeSegmentLoc.file.segments[activeSegmentLoc.segmentIndex]
      : undefined;

  const hasTargetTextSelection = (() => {
    const live = readActivePlainTextSelection();
    if (live && live.start < live.end) return true;
    return textSelection.start < textSelection.end;
  })();

  // Aggregated TMs and TBs for reading
  const allTMs = useMemo(() => {
      const tms = [];
      if (mainTM) tms.push(mainTM);
      auxiliaryTMs.forEach(tm => tms.push(tm));
      return tms;
  }, [mainTM, auxiliaryTMs]);

  const allTBs = useMemo(() => {
      const tbs = [];
      if (mainTB) tbs.push(mainTB);
      auxiliaryTBs.forEach(tb => tbs.push(tb));
      return tbs;
  }, [mainTB, auxiliaryTBs]);

  const allTerms = useMemo(
      () => allTBs.flatMap(tb => tb.entries.map(e => ({ ...e, tbId: tb.id, tbName: tb.name }))),
      [allTBs]
  );

  // 术语侧栏当前列表：无搜索时为当前句命中；有搜索时为全库过滤（与侧栏展示一致，供 Ctrl+1～9）
  const tbMatches = useMemo(() => {
      if (!activeSegment || !allTerms) return [];
      return filterTermsMatchingSource(activeSegment.sourceText, allTerms, false);
  }, [activeSegment, allTerms]);

  const displayedTerms = useMemo(() => {
      if (tbSearchQuery.trim() && allTerms) {
          const q = tbSearchQuery.toLowerCase();
          return allTerms.filter(
              (e) => e.source.toLowerCase().includes(q) || e.target.toLowerCase().includes(q)
          );
      }
      return tbMatches;
  }, [tbSearchQuery, allTerms, tbMatches]);

  const translateWithOptionalGrammarRules = async (
      sourceText: string,
      contextDescription: string | undefined,
      ragContext: string | undefined
  ): Promise<string> => {
      const relevantTerms = filterTermsMatchingSource(sourceText, allTerms, false);
      const glossaryPairs = relevantTerms.map((t) => ({ source: t.source, target: t.target }));

      const normalized = normalizeSegmentForGrammar(sourceText);
      const pipelineSource = applyUncategorizedRegexChain(normalized, uncategorizedRegexEntries);

      if (grammarRulesSorted.length > 0 || regexCategoryMap.size > 0) {
          const viaRule = await tryGrammarRuleTranslation(
              pipelineSource,
              grammarRulesSorted,
              async (frag) => {
                  const slotTerms = allTerms.filter((e) => frag.toLowerCase().includes(e.source.toLowerCase()));
                  return translateSegment(
                      frag,
                      project.targetLang,
                      project.sourceLang,
                      '仅输出该片段的目标语译文，不要解释。',
                      slotTerms.map((t) => ({ source: t.source, target: t.target })),
                      aiSettings,
                      ''
                  );
              },
              regexCategoryMap
          );
          if (viaRule !== null) return viaRule;
      }

      return translateSegment(
          pipelineSource,
          project.targetLang,
          project.sourceLang,
          contextDescription,
          glossaryPairs,
          aiSettings,
          ragContext ?? ''
      );
  };

  // --- Trados Style Concordance Search Effect ---
  // Listen for F3 key to trigger Concordance Search using selected text
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'F3') {
            e.preventDefault();
            // First try to get current selection, if none, use the last selected text, then fall back to active segment source text
            const selection = window.getSelection()?.toString().trim() || currentSelectedText || activeSegment?.sourceText;
            if (selection) {
                setConcordanceQuery(selection);
                setActiveSidebarTab('concordance');
                // Trigger search immediately
                performConcordanceSearch(selection);
            }
        }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [allTMs, currentSelectedText, activeSegment]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        const text = currentSelectedText.trim() || activeSegment?.sourceText?.trim() || '';
        if (text) {
          setQuickMtSource(text);
          setQuickMtOpen(true);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentSelectedText, activeSegment?.sourceText]);

  const performConcordanceSearch = (query: string) => {
      if (!allTMs.length || !query.trim()) {
          setConcordanceResults([]);
          return;
      }
      const lowerQuery = query.toLowerCase();
      // Search all TMs
      const results = allTMs.flatMap(tm => 
          tm.units.filter(unit => 
              unit.source.toLowerCase().includes(lowerQuery) || 
              unit.target.toLowerCase().includes(lowerQuery)
          ).map(u => ({ ...u, sourceTM: tm.name }))
      );
      setConcordanceResults(results);
  };

  // TM matches loaded via indexed search API (fallback in-memory)
  // state: tmMatches — populated in effect after filteredSegments

  // --- Auto-fill Logic for 100% Matches ---
  useEffect(() => {
      if (!activeFile) return;

      let hasChanges = false;
      const newProcessedIds = new Set(processedSegmentIds);
      const newSegments = activeFile.segments.map(seg => {
          // Auto-fill when译文为空（含锁定句段）：TM 原文完全一致时写入 100% 匹配译文，仍保持锁定状态
          if (!newProcessedIds.has(seg.id) && !seg.targetText?.trim()) {
              // Check exact match in ANY TM
              for (const tm of allTMs) {
                 const exactMatch = tm.units.find(u => sourcesEqual(u.source, seg.sourceText));
                 if (exactMatch) {
                    hasChanges = true;
                    newProcessedIds.add(seg.id);
                    return applyTagFormatQaToSegment(
                      {
                        ...seg,
                        targetText: exactMatch.target,
                        status: SegmentStatus.PreTranslated,
                        matchType: MatchType.Exact,
                        matchScore: 100,
                      },
                      activeFile,
                      exactMatch.target
                    );
                 }
              }

              // 首句已有译文时，跨文件/文件内重复句沿用（自动填充开启时）
              if (autoPropagate && project) {
                  const sourceNorm = normalizeDuplicateSourceKey(seg.sourceText);
                  const sourceSeg = getDuplicatePropagationSource(project, sourceNorm);
                  if (sourceSeg && sourceSeg.id !== seg.id) {
                      hasChanges = true;
                      newProcessedIds.add(seg.id);
                      return buildDuplicateAutoFilledSegment(seg, sourceSeg, activeFile);
                  }
              }

              // Even if no match found, mark as processed to avoid rechecking
              newProcessedIds.add(seg.id);
          }
          return seg;
      });

      if (hasChanges) {
          onUpdateFileSegments(activeFile.id, newSegments);
          setProcessedSegmentIds(newProcessedIds);
      } else if (newProcessedIds.size !== processedSegmentIds.size) {
          // Update processed ids even if no changes (for segments with no match)
          setProcessedSegmentIds(newProcessedIds);
      }
  }, [activeFileId, activeFile, allTMs, processedSegmentIds, autoPropagate, project, onUpdateFileSegments]);

  useEffect(() => {
      if (!autoPropagate || !project) return;

      const updates = collectDuplicateAutoFillUpdates(project);
      if (updates.length === 0) return;

      onUpdateMultipleFileSegments(updates);
      setComparisonListMeasureEpoch((e) => e + 1);

      const filledIds = new Set<string>();
      for (const u of updates) {
          const orig = project.files.find((f) => f.id === u.fileId);
          if (!orig) continue;
          u.segments.forEach((s, i) => {
              if (!orig.segments[i]?.targetText?.trim() && s.targetText?.trim()) {
                  filledIds.add(s.id);
              }
          });
      }
      if (filledIds.size > 0) {
          setProcessedSegmentIds((prev) => {
              const next = new Set(prev);
              filledIds.forEach((id) => next.add(id));
              return next;
          });
      }
  }, [project, autoPropagate, onUpdateMultipleFileSegments]);

  useEffect(() => {
      if (activeSegmentId && activeSegment && !activeSegment.targetText?.trim()) {
          // Only auto-fill if segment is not processed yet（锁定句段同样适用：有 100% TM 则填充译文）
          if (!processedSegmentIds.has(activeSegmentId)) {
              let filled = false;

              if (allTMs.length) {
                  // Check exact match in ANY TM
                  for (const tm of allTMs) {
                     const exactMatch = tm.units.find(u => sourcesEqual(u.source, activeSegment.sourceText));
                     if (exactMatch) {
                          const loc = findSegmentLocation(activeSegmentId);
                          if (!loc) break;
                          const { file } = loc;
                          const updated = file.segments.map(s => 
                              s.id === activeSegmentId ? applyTagFormatQaToSegment(
                                  {
                                      ...s,
                                      targetText: exactMatch.target,
                                      status: SegmentStatus.PreTranslated,
                                      matchType: MatchType.Exact,
                                      matchScore: 100,
                                  },
                                  file,
                                  exactMatch.target
                              ) : s
                          );
                          onUpdateFileSegments(file.id, updated);
                          filled = true;
                          break; 
                     }
                  }
              }

              if (!filled && autoPropagate && project) {
                  const sourceNorm = normalizeDuplicateSourceKey(activeSegment.sourceText);
                  const sourceSeg = getDuplicatePropagationSource(project, sourceNorm);
                  if (sourceSeg && sourceSeg.id !== activeSegmentId) {
                      const loc = findSegmentLocation(activeSegmentId);
                      if (loc) {
                          const { file } = loc;
                          const updated = file.segments.map((s) =>
                              s.id === activeSegmentId
                                  ? buildDuplicateAutoFilledSegment(s, sourceSeg, file)
                                  : s
                          );
                          onUpdateFileSegments(file.id, updated);
                          filled = true;
                      }
                  }
              }

              // Mark segment as processed
              setProcessedSegmentIds(prev => {
                  const newSet = new Set(prev);
                  newSet.add(activeSegmentId);
                  return newSet;
              });
          }
      }
  }, [activeSegmentId, activeSegment, allTMs, onUpdateFileSegments, processedSegmentIds, findSegmentLocation, autoPropagate, project]); 

  // Backfill tag-format QA when focusing a segment (e.g. TM auto-fill or legacy data).
  useEffect(() => {
      if (!activeSegmentId || !activeFile) return;
      const loc = findSegmentLocation(activeSegmentId);
      if (!loc) return;
      const { file, segmentIndex } = loc;
      const seg = file.segments[segmentIndex];
      if (!seg?.targetText?.trim()) return;
      if (!shouldRunTagFormatQa(file, seg)) return;
      if (seg.qaIssues?.some((i) => i.category === 'tags')) return;

      const { qaIssues } = withTagFormatQaIssues(seg, file, seg.targetText);
      if (!qaIssues?.some((i) => i.category === 'tags')) return;

      const updatedSegments = [...file.segments];
      updatedSegments[segmentIndex] = { ...seg, qaIssues };
      onUpdateFileSegments(file.id, updatedSegments);
  }, [activeSegmentId, activeFile, findSegmentLocation, onUpdateFileSegments]);

  useEffect(() => {
    if (activeSegmentId && activeRowRef.current) {
        activeRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    setActiveTermSource(null);
    setTbSearchQuery(''); 
    // Reset selection when changing segments
    setTextSelection({ start: 0, end: 0 });
    // 仅当激活句段与正在编辑的原文句段不一致时退出原文编辑（避免句段拆分后立刻被清掉）
    setEditingSourceId((prev) =>
        prev != null && prev !== activeSegmentId ? null : prev
    );
    // Switch back to Matches tab when changing segment, standard behavior unless pinned
    // setActiveSidebarTab('matches'); 
  }, [activeSegmentId]);



  useEffect(() => {
    if (showJumpInput && jumpInputRef.current) {
        jumpInputRef.current.focus();
    }
  }, [showJumpInput]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizing) {
        const newWidth = document.body.clientWidth - e.clientX;
        if (newWidth > 250 && newWidth < 800) {
            setSidebarWidth(newWidth);
        }
      }
      if (isResizingVertical) {
        const sidebarRect = document.querySelector('.bg-white.border-l.border-slate-200')?.getBoundingClientRect();
        if (sidebarRect) {
          const newHeightPercent = ((sidebarRect.bottom - e.clientY) / sidebarRect.height) * 100;
          if (newHeightPercent > 20 && newHeightPercent < 80) {
            setAiPanelHeight(newHeightPercent);
          }
        }
      }
    };
    const handleMouseUp = () => {
      setIsResizing(false);
      setIsResizingVertical(false);
    };
    
    if (isResizing || isResizingVertical) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, isResizingVertical]);

  // --- Filtering & Sorting Logic ---
  const filteredSegments = useMemo(() => {
      // Check if activeFile is null
      if (!activeFile) return [];
      
      // Get all segments based on search scope
      let allSegments = textSearchScope === 'project' 
          ? project.files.flatMap(file => file.segments) 
          : activeFile.segments;
      
      let result = allSegments.filter(s => {
          let statusMatch = true;
          if (filterStatus === 'Locked') {
              statusMatch = s.isLocked === true;
          } else if (filterStatus === 'Unlocked') {
              statusMatch = !s.isLocked;
          } else if (filterStatus === 'Unlocked+Unconfirmed') {
              statusMatch = !s.isLocked && s.status !== SegmentStatus.Confirmed;
          } else if (filterStatus === 'Unconfirmed') {
              statusMatch = !segmentIsEffectivelyConfirmed(s);
          } else if (filterStatus === 'Confirmed') {
              statusMatch = segmentIsEffectivelyConfirmed(s);
          } else if (filterStatus === 'ExactMatch') {
              statusMatch = s.matchType === MatchType.Exact;
          } else if (filterStatus === 'FuzzyMatch') {
              statusMatch = s.matchType === MatchType.Fuzzy;
          } else if (filterStatus === 'AITranslation') {
              statusMatch = s.matchType === MatchType.AI;
          } else if (filterStatus === 'Translated+Draft') {
              statusMatch = s.status === SegmentStatus.Translated || s.status === SegmentStatus.Draft;
          } else if (filterStatus === 'HasQAIssues') {
              statusMatch = (s.qaIssues?.length || 0) > 0;
          } else if (filterStatus !== 'All') {
              statusMatch = s.status === filterStatus;
          }
          
          let textMatch = true;
          if (textSearchQuery.trim()) {
              const query = textSearchQuery.toLowerCase();
              const target = textSearchMode === 'source' ? s.sourceText : s.targetText;
              textMatch = target.toLowerCase().includes(query);
          }

          return statusMatch && textMatch;
      });

      if (sortMode !== 'natural') {
          result = [...result].sort((a, b) => {
              if (sortMode === 'status') {
                  const statusWeight: Record<SegmentStatus, number> = {
                      [SegmentStatus.NotStarted]: 0,
                      [SegmentStatus.Draft]: 1,
                      [SegmentStatus.PreTranslated]: 2,
                      [SegmentStatus.Translated]: 3,
                      [SegmentStatus.Review]: 4,
                      [SegmentStatus.Proofread]: 5,
                      [SegmentStatus.Confirmed]: 6,
                      [SegmentStatus.Approved]: 7,
                      [SegmentStatus.Rejected]: 8,
                  };
                  return statusWeight[a.status] - statusWeight[b.status];
              }
              if (sortMode === 'matchDesc') return (b.matchScore || 0) - (a.matchScore || 0);
              if (sortMode === 'matchAsc') return (a.matchScore || 0) - (b.matchScore || 0);
              if (sortMode === 'sourceAsc') return a.sourceText.localeCompare(b.sourceText, project.sourceLang);
              if (sortMode === 'sourceDesc') return b.sourceText.localeCompare(a.sourceText, project.sourceLang);
              if (sortMode === 'lengthAsc') return a.sourceText.length - b.sourceText.length;
              if (sortMode === 'lengthDesc') return b.sourceText.length - a.sourceText.length;
              return 0;
          });
      }
      return result;
  }, [project, project.sourceLang, activeFile, activeFile.segments, filterStatus, textSearchQuery, textSearchMode, textSearchScope, sortMode]);

  useEffect(() => {
    if (!activeSegment?.sourceText?.trim() || !allTMs.length) {
      setTmMatches([]);
      return;
    }
    let cancelled = false;
    void searchTmMatches(activeSegment.sourceText, allTMs, 50, 20).then((hits) => {
      if (!cancelled) setTmMatches(hits);
    });
    return () => {
      cancelled = true;
    };
  }, [activeSegment?.id, activeSegment?.sourceText, allTMs]);

  useEffect(() => {
    if (idlePrefetchTimerRef.current) clearTimeout(idlePrefetchTimerRef.current);
    if (!activeFile || !allTMs.length || !activeSegmentId) return;
    idlePrefetchTimerRef.current = setTimeout(() => {
      const idx = filteredSegments.findIndex((s) => s.id === activeSegmentId);
      if (idx < 0) return;
      const next = filteredSegments
        .slice(idx + 1, idx + 6)
        .map((s) => ({ id: s.id, sourceText: s.sourceText }));
      prefetchTmMatches(next, allTMs);
    }, 1500);
    return () => {
      if (idlePrefetchTimerRef.current) clearTimeout(idlePrefetchTimerRef.current);
    };
  }, [activeSegmentId, activeFile, allTMs, filteredSegments]);

  const dynamicRowHeight = useDynamicRowHeight({
    defaultRowHeight: 140,
    key: `${activeFile?.id ?? ''}-${sortMode}-${filterStatus}-${textSearchMode}-${textSearchScope}-${filteredSegments.length}-${comparisonListMeasureEpoch}`,
  });

  /** 无匹配句段时不渲染对照列表容器；若 effect 仅依赖 editorLayoutMode，observer 仍挂在已卸载节点上会把高度测成 0，切回「显示全部」后列表永远不出现 */
  const comparisonListViewportActive =
    editorLayoutMode === 'comparison' && filteredSegments.length > 0;

  useLayoutEffect(() => {
    if (!comparisonListViewportActive) return;
    const el = comparisonListViewportRef.current;
    if (!el) return;
    const update = () => {
      setComparisonListSize({ width: el.clientWidth, height: el.clientHeight });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [comparisonListViewportActive]);

  const comparisonScrollSigRef = useRef('');
  /** 从侧栏回到编辑后，在 List 真正渲染出可见行后再滚到当前句（弥补 scrollToRow 早于行高测量的问题） */
  const pendingListScrollUntilVisibleRef = useRef(false);
  /** 首帧可见后再定位一次，避免测量前行高不准导致漂移（start + 顶部留白） */
  const resumeListScrollNudgeDoneRef = useRef(false);
  /** 每次从侧栏回到编辑页会递增 resumeLayoutKey；必须清空滚动签名，否则会误判「已滚过」而不再 scrollToRow */
  useLayoutEffect(() => {
    comparisonScrollSigRef.current = '';
    pendingListScrollUntilVisibleRef.current = true;
    resumeListScrollNudgeDoneRef.current = false;
  }, [resumeLayoutKey]);

  const onComparisonRowsRendered = useCallback(
    (visible: { startIndex: number; stopIndex: number }) => {
      if (editorLayoutMode !== 'comparison' || !activeSegmentId) return;
      if (!pendingListScrollUntilVisibleRef.current) return;
      const idx = filteredSegments.findIndex((s) => s.id === activeSegmentId);
      if (idx < 0) return;
      const list = comparisonListRef.current;
      if (!list) return;

      if (idx >= visible.startIndex && idx <= visible.stopIndex) {
        if (!resumeListScrollNudgeDoneRef.current) {
          resumeListScrollNudgeDoneRef.current = true;
          scrollComparisonListToActiveRow(list, idx);
          return;
        }
        pendingListScrollUntilVisibleRef.current = false;
        return;
      }
      scrollComparisonListToActiveRow(list, idx);
    },
    [editorLayoutMode, filteredSegments, activeSegmentId]
  );

  useEffect(() => {
    if (editorLayoutMode !== 'comparison' || filteredSegments.length === 0) return;
    if (comparisonListSize.height <= 0) return;
    // 从侧栏回到编辑：仅由 onRowsRendered 滚到当前句，避免与下面 scrollToRow 叠加导致「多滚几句」
    if (pendingListScrollUntilVisibleRef.current) return;
    const idx = filteredSegments.findIndex((s) => s.id === activeSegmentId);
    const list = comparisonListRef.current;
    if (idx < 0 || !list) return;
    const sig = `${activeSegmentId}|${comparisonListSize.height}|${idx}`;
    if (sig === comparisonScrollSigRef.current) return;
    comparisonScrollSigRef.current = sig;
    const scroll = () => {
      scrollComparisonListToActiveRow(list, idx);
    };
    scroll();
    const t0 = window.setTimeout(scroll, 0);
    return () => {
      window.clearTimeout(t0);
    };
  }, [activeSegmentId, editorLayoutMode, filteredSegments, comparisonListSize.height]);

  // 仅切换文件时清空批量状态（勿随 resumeSegmentId 变化清空，否则会打断 TM 自动填充等 processed 跟踪）
  useEffect(() => {
      setSelectedSegmentIds(new Set());
      setLastInteractedId(null);
      setProcessedSegmentIds(new Set());
  }, [activeFileId]);

  const prevResumeLayoutKeyForSeg = useRef<number | null>(null);
  const prevActiveFileIdForSeg = useRef<string | null>(null);
  const prevResumeWantRef = useRef<string | null | undefined>(undefined);

  // 定位句段：优先恢复上次编辑；resume 晚一拍出现时用 prevResumeWantRef 检测，不把 resumeSegmentId 单独当作「强制当前句」以免父级滞后覆盖用户点击
  useLayoutEffect(() => {
      if (!activeFile || !activeFile.segments.length) return;

      const keyBumped =
          prevResumeLayoutKeyForSeg.current === null ||
          resumeLayoutKey !== prevResumeLayoutKeyForSeg.current;
      const fileBumped =
          prevActiveFileIdForSeg.current === null || activeFileId !== prevActiveFileIdForSeg.current;
      prevResumeLayoutKeyForSeg.current = resumeLayoutKey;
      prevActiveFileIdForSeg.current = activeFileId;

      const want = resumeSegmentId ?? resumeSegmentIdRef.current;
      const prevWantSnapshot = prevResumeWantRef.current;
      const resumeAppeared = want != null && prevWantSnapshot == null;
      prevResumeWantRef.current = want;

      if (want && activeFile.segments.some((s) => s.id === want)) {
          if (keyBumped || fileBumped || resumeAppeared) {
              setActiveSegmentId(want);
          }
          return;
      }

      if (keyBumped || fileBumped) {
          const firstUnconfirmedSegment = activeFile.segments.find(
              (seg) => !seg.isLocked && seg.status !== SegmentStatus.Confirmed
          );
          if (firstUnconfirmedSegment) {
              setActiveSegmentId(firstUnconfirmedSegment.id);
          }
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps -- activeFile 取闭包；不把 segments 列入依赖以免编辑时反复跳句
  }, [activeFileId, resumeLayoutKey, resumeSegmentId]);

  useEffect(() => {
      if (!activeFileId || !activeSegmentId || !onEditorPlaceChange) return;
      onEditorPlaceChange({
        fileId: activeFileId,
        segmentId: activeSegmentId,
        ...(project?.id ? { projectId: project.id } : {}),
      });
  }, [activeFileId, activeSegmentId, onEditorPlaceChange, project?.id]);

  useEffect(() => {
      if (editorLayoutMode !== 'focus' || filteredSegments.length === 0) return;
      // 从侧栏回到编辑首帧 activeSegmentId 常为 null，须等上层 layout 按 resume 设句；勿此时写成第一句
      if (activeSegmentId == null) return;
      const inList = filteredSegments.some((s) => s.id === activeSegmentId);
      if (!inList) {
          setActiveSegmentId(filteredSegments[0].id);
      }
  }, [editorLayoutMode, filteredSegments, activeSegmentId]);

  const focusResolved = useMemo(() => {
      if (!filteredSegments.length) return { seg: null as Segment | null, indexInFiltered: -1 };
      const idx = filteredSegments.findIndex((s) => s.id === activeSegmentId);
      if (idx >= 0) return { seg: filteredSegments[idx], indexInFiltered: idx };
      return { seg: filteredSegments[0], indexInFiltered: 0 };
  }, [filteredSegments, activeSegmentId]);

  const goToPrevFilteredSegment = useCallback(() => {
      const idx = filteredSegments.findIndex((s) => s.id === activeSegmentId);
      if (idx > 0) setActiveSegmentId(filteredSegments[idx - 1].id);
  }, [filteredSegments, activeSegmentId]);

  const goToNextFilteredSegment = useCallback(() => {
      const idx = filteredSegments.findIndex((s) => s.id === activeSegmentId);
      if (idx >= 0 && idx < filteredSegments.length - 1) {
          setActiveSegmentId(filteredSegments[idx + 1].id);
      }
  }, [filteredSegments, activeSegmentId]);

  const goToFirstFilteredSegment = useCallback(() => {
      if (filteredSegments.length === 0) return;
      const first = filteredSegments[0];
      const loc = findSegmentLocation(first.id);
      if (!loc) return;
      if (loc.file.id !== activeFileId) {
          onActiveFileChange(loc.file.id);
      }
      setActiveSegmentId(first.id);
      if (editorLayoutMode === 'comparison') {
          requestAnimationFrame(() => {
              scrollComparisonListToActiveRow(comparisonListRef.current, 0);
          });
      }
  }, [
      filteredSegments,
      findSegmentLocation,
      activeFileId,
      onActiveFileChange,
      editorLayoutMode,
  ]);

  useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
          if (
              (e.ctrlKey || e.metaKey) &&
              e.key === 'Home' &&
              !e.altKey &&
              !e.shiftKey
          ) {
              const t = e.target as HTMLElement;
              if (
                  t.closest('textarea') ||
                  t.closest('input') ||
                  t.closest('select') ||
                  t.isContentEditable
              ) {
                  return;
              }
              if (filteredSegments.length === 0) return;
              e.preventDefault();
              goToFirstFilteredSegment();
              return;
          }
          if (editorLayoutMode !== 'focus') return;
          if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
          const t = e.target as HTMLElement;
          if (t.closest('textarea') || t.closest('input') || t.isContentEditable) return;
          e.preventDefault();
          if (e.key === 'ArrowUp') goToPrevFilteredSegment();
          else goToNextFilteredSegment();
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
  }, [
      editorLayoutMode,
      goToPrevFilteredSegment,
      goToNextFilteredSegment,
      goToFirstFilteredSegment,
      filteredSegments,
  ]);

  const handleJumpFromQA = useCallback((fileId: string, segmentId: string) => {
      setPendingQASegmentJump({ fileId, segmentId });
      if (fileId !== activeFileId) {
          onActiveFileChange(fileId);
      }
  }, [activeFileId, onActiveFileChange]);

  useEffect(() => {
      if (!pendingQASegmentJump) return;
      if (activeFile.id !== pendingQASegmentJump.fileId) return;

      const targetIndex = filteredSegments.findIndex(s => s.id === pendingQASegmentJump.segmentId);
      if (targetIndex === -1) {
          setActiveSegmentId(pendingQASegmentJump.segmentId);
          setPendingQASegmentJump(null);
          return;
      }

      setActiveSegmentId(pendingQASegmentJump.segmentId);
      setPendingQASegmentJump(null);
  }, [pendingQASegmentJump, activeFile.id, filteredSegments]);

  // ... (Previous Export functions omitted for brevity, they remain same) ...
  // 导出功能已从界面移除，相关函数已注释
  /*
  const handleExport = (confirmedOnly: boolean) => {
    if (!activeFile) return;
    const segsToExport = confirmedOnly 
        ? activeFile.segments.filter(s => s.status === SegmentStatus.Confirmed)
        : activeFile.segments;
    // 只保留原文和译文两列，使用中文列名
    const data = segsToExport.map(s => ({ '原文': s.sourceText, '译文': s.targetText }));
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "翻译内容");
    const filename = `${project?.name}_${activeFile.name}${confirmedOnly ? '_已确认' : ''}.xlsx`;
    XLSX.writeFile(workbook, filename);
    setShowExportMenu(false);
  };
  
  const handleExportTMX = (confirmedOnly: boolean) => {
    // ... same as before ...
     if (!project || !activeFile) return;
    
    const segsToExport = confirmedOnly 
        ? activeFile.segments.filter(s => s.status === SegmentStatus.Confirmed)
        : activeFile.segments;

    const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    let tmxContent = `<?xml version="1.0" encoding="UTF-8"?>
<tmx version="1.4">
  <header creationtool="Smart-CAT Studio" creationtoolversion="${APP_VERSION_METADATA}" segtype="sentence" o-tmf="SmartCAT" adminlang="en-US" srclang="${project.sourceLang}" datatype="PlainText" creationdate="${now}"></header>
  <body>\n`;
    segsToExport.forEach(seg => {
        if (seg.targetText) {
            tmxContent += `    <tu>
      <tuv xml:lang="${project.sourceLang}"><seg>${seg.sourceText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</seg></tuv>
      <tuv xml:lang="${project.targetLang}"><seg>${seg.targetText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</seg></tuv>
    </tu>\n`;
        }
    });
    tmxContent += `  </body>\n</tmx>`;
    const blob = new Blob([tmxContent], { type: 'text/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name}_${activeFile.name}${confirmedOnly ? '_Confirmed' : ''}.tmx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setShowExportMenu(false);
  };
  */

  const handleSegmentChange = useCallback((id: string, newText: string) => {
      const location = findSegmentLocation(id);
      if (!location) return;

      const { file, segmentIndex } = location;
      const prev = file.segments[segmentIndex];
      const updatedSegments = [...file.segments];

      const updatedSegment = {
          ...prev,
          targetText: newText,
          status: SegmentStatus.Draft,
          matchType: MatchType.None,
          xliffModified: prev.xliffSegmentId ? true : prev.xliffModified,
          ...withTagFormatQaIssues(prev, file, newText),
      };
      updatedSegments[segmentIndex] = updatedSegment;

      if (autoPropagate && project && newText.trim()) {
          const sourceNorm = normalizeDuplicateSourceKey(prev.sourceText);
          const firstDupId = findFirstSegmentIdForDuplicateSource(project, sourceNorm);
          if (
              id === firstDupId &&
              countSegmentsMatchingDuplicateSource(project, sourceNorm) >= 2
          ) {
              const projectedProject: Project = {
                  ...project,
                  files: project.files.map((f) =>
                      f.id === file.id ? { ...f, segments: updatedSegments } : f
                  ),
              };
              const propagationUpdates = collectDuplicatePropagationUpdates(
                  projectedProject,
                  sourceNorm,
                  id,
                  newText,
                  {
                      status: SegmentStatus.Draft,
                      inlineRunMeta: updatedSegment.inlineRunMeta,
                  }
              );
              if (propagationUpdates.length > 0) {
                  const byFileId = new Map(
                      propagationUpdates.map((u) => [u.fileId, u.segments] as const)
                  );
                  byFileId.set(file.id, updatedSegments);
                  onUpdateMultipleFileSegments(
                      [...byFileId.entries()].map(([fileId, segments]) => ({ fileId, segments }))
                  );
                  if (propagationUpdates.some((u) => u.fileId !== file.id)) {
                      setComparisonListMeasureEpoch((e) => e + 1);
                  }
                  return;
              }
          }
      }

      onUpdateFileSegments(file.id, updatedSegments);
  }, [findSegmentLocation, onUpdateFileSegments, onUpdateMultipleFileSegments, autoPropagate, project]);

  const handleApplySourceRunFormat = useCallback(
    (seg: Segment, runId: string, runStyle: InlineRunStyle) => {
      const location = findSegmentLocation(seg.id);
      if (!location) return;
      const { file, segmentIndex } = location;
      const prev = file.segments[segmentIndex];
      if (!prev.targetText?.trim()) return;

      let plainSelection: { start: number; end: number } | null = null;
      const liveSel = readActivePlainTextSelection();
      if (liveSel && liveSel.start < liveSel.end) {
        const active = document.activeElement;
        if (active instanceof HTMLTextAreaElement && hasInlineMarkers(prev.targetText)) {
          plainSelection = markerSelectionToPlainOffsets(
            prev.targetText,
            liveSel.start,
            liveSel.end
          );
        } else {
          plainSelection = liveSel;
        }
      } else if (seg.id === activeSegmentId && textSelection.start < textSelection.end) {
        if (hasInlineMarkers(prev.targetText)) {
          plainSelection = markerSelectionToPlainOffsets(
            prev.targetText,
            textSelection.start,
            textSelection.end
          );
        } else {
          plainSelection = {
            start: Math.min(textSelection.start, textSelection.end),
            end: Math.max(textSelection.start, textSelection.end),
          };
        }
      }
      if (!plainSelection) return;

      const result = applyRunStyleToTargetSelection(
        prev.targetText,
        plainSelection,
        runStyle,
        prev.inlineRunMeta
      );

      const updatedSegments = [...file.segments];
      updatedSegments[segmentIndex] = {
        ...prev,
        targetText: result.targetText,
        inlineRunMeta: result.inlineRunMeta.length ? result.inlineRunMeta : prev.inlineRunMeta,
        status: SegmentStatus.Draft,
        matchType: MatchType.None,
        ...withTagFormatQaIssues(prev, file, result.targetText),
      };
      onUpdateFileSegments(file.id, updatedSegments);
    },
    [findSegmentLocation, onUpdateFileSegments, activeSegmentId, textSelection]
  );

  const handleSourceChange = useCallback((id: string, newText: string) => {
      const location = findSegmentLocation(id);
      if (!location) return;

      const { file, segmentIndex } = location;
      const updatedSegments = [...file.segments];
      const updatedSegment = { 
          ...updatedSegments[segmentIndex], 
          sourceText: newText 
      };
      updatedSegments[segmentIndex] = updatedSegment;
      onUpdateFileSegments(file.id, updatedSegments);
  }, [findSegmentLocation, onUpdateFileSegments]);

  const handleSplitSourceSegment = useCallback(
      (segmentId: string, leftSource: string, rightSource: string) => {
          const location = findSegmentLocation(segmentId);
          if (!location) return;

          const { file, segmentIndex } = location;
          const seg = file.segments[segmentIndex];
          if (seg.isLocked) return;

          const left = leftSource;
          const right = rightSource;
          if (!left.trim() || !right.trim()) {
              alert('拆分点不能位于句首或句尾，且前后两段都须包含有效原文。');
              return;
          }

          const fullT = seg.targetText ?? '';
          const sl = left.length;
          const sr = right.length;
          const cut =
              fullT.length > 0 && sl + sr > 0
                  ? Math.round((sl / (sl + sr)) * fullT.length)
                  : 0;
          const leftTarget = fullT.slice(0, cut);
          const rightTarget = fullT.slice(cut);

          const newId = () =>
              `seg-s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
          const id1 = newId();
          const id2 = newId();

          const statusForPart = (partTarget: string): SegmentStatus =>
              partTarget.trim() ? SegmentStatus.Draft : SegmentStatus.NotStarted;

          const seg1: Segment = {
              ...seg,
              id: id1,
              sourceText: left,
              targetText: leftTarget,
              status: statusForPart(leftTarget),
              matchType: MatchType.None,
              qaIssues: undefined,
          };
          const seg2: Segment = {
              ...seg,
              id: id2,
              sourceText: right,
              targetText: rightTarget,
              status: statusForPart(rightTarget),
              matchType: MatchType.None,
              qaIssues: undefined,
          };

          const newSegments = [
              ...file.segments.slice(0, segmentIndex),
              seg1,
              seg2,
              ...file.segments.slice(segmentIndex + 1),
          ];
          onUpdateFileSegments(file.id, newSegments);
          setActiveSegmentId(id2);
          setEditingSourceId(id2);
          setSelectedSegmentIds(new Set([id2]));
          setLastInteractedId(id2);
      },
      [findSegmentLocation, onUpdateFileSegments]
  );

  // --- 孪生译员相关处理函数 ---
  const handleTwinTranslatorSelect = useCallback((translation: string) => {
      if (!activeSegmentId) return;
      handleSegmentChange(activeSegmentId, translation);
  }, [activeSegmentId, handleSegmentChange]);

  const handleTwinTranslatorVariants = useCallback(
    (variants: any[], meta?: { twinTranslatorId: string }) => {
      setTwinTranslatorVariants(variants);
      setShowTwinTranslatorPanel(variants.length > 0);

      if (
        meta?.twinTranslatorId &&
        variants.length > 0 &&
        onTwinTranslatorsChange &&
        project
      ) {
        const translator = twinTranslators.find((t) => t.id === meta.twinTranslatorId);
        if (!translator) return;
        const projectPair = languagePairFromProjectLocales(
          project.sourceLang,
          project.targetLang
        );
        if (translator.languagePair.toLowerCase() !== projectPair.toLowerCase()) {
          return;
        }
        const updated = recordTwinSuggestionOffer(translator);
        onTwinTranslatorsChange(
          twinTranslators.map((t) => (t.id === translator.id ? updated : t))
        );
      }
    },
    [twinTranslators, onTwinTranslatorsChange, project]
  );

  const handleTwinTranslatorLearning = useCallback(async (feedback: {
      twinTranslatorId: string;
      sourceText: string;
      selectedVariant?: TranslationVariant;
      customTranslation?: string;
      feedback: 'positive' | 'negative' | 'neutral';
      originalTranslation?: string;
      suggestionPanelAdoption?: boolean;
      suggestionPanelNegativeRating?: boolean;
  }) => {
      if (!onTwinTranslatorsChange || !project) return;

      const translator = twinTranslators.find(t => t.id === feedback.twinTranslatorId);
      if (!translator) return;

      const projectPair = languagePairFromProjectLocales(project.sourceLang, project.targetLang);
      if (translator.languagePair.toLowerCase() !== projectPair.toLowerCase()) {
          console.warn('孪生译员学习已跳过：译员语言对与当前项目不一致');
          return;
      }

      try {
          const hadPositiveExampleAppend =
              feedback.feedback === 'positive' &&
              !!(feedback.customTranslation?.trim() || feedback.selectedVariant?.text?.trim());

          const updated = processLearningFeedback(
              translator,
              feedback.sourceText,
              feedback.selectedVariant,
              feedback.customTranslation,
              feedback.feedback,
              feedback.originalTranslation,
              {
                  effectiveLanguagePair: projectPair,
                  suggestionPanelAdoption: feedback.suggestionPanelAdoption,
                  suggestionPanelNegativeRating: feedback.suggestionPanelNegativeRating
              }
          );

          onTwinTranslatorsChange(
              twinTranslators.map(t => (t.id === translator.id ? updated : t))
          );

          const capNotice = getTwinTrainingCapNotice(
              translator,
              updated,
              hadPositiveExampleAppend
          );
          if (capNotice) {
              setTwinLearningCapModal({
                  translatorName: translator.name,
                  profile: updated,
                  kind: capNotice
              });
          }
      } catch (error) {
          console.error('处理孪生译员学习反馈失败:', error);
      }
  }, [twinTranslators, onTwinTranslatorsChange, project]);

  const sanitizeTwinExportFileNamePart = (name: string) =>
      name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().slice(0, 80) || '译员';

  const handleTwinCapModalExportExcel = useCallback(() => {
      if (!twinLearningCapModal) return;
      const rows = buildLearnedSegmentExportRows(twinLearningCapModal.profile);
      if (rows.length === 0) return;
      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, '已学习句段');
      const safe = sanitizeTwinExportFileNamePart(twinLearningCapModal.profile.name);
      const fileName = `孪生译员_${safe}_已学习句段_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.xlsx`;
      XLSX.writeFile(workbook, fileName);
  }, [twinLearningCapModal]);

  const handleTwinCapModalSaveKnowledgeBase = useCallback(async () => {
      if (!twinLearningCapModal || !onKnowledgeBasesChange) {
          alert('无法保存知识库：未连接数据保存接口。');
          return;
      }
      const profile = twinLearningCapModal.profile;
      const rawText = formatTrainingExamplesAsKnowledgeBaseRawText(profile);
      if (!rawText) {
          alert('没有可写入知识库的文本。');
          return;
      }
      setTwinKbSaving(true);
      try {
          const now = new Date().toISOString();
          const id = `kb-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
          const trimmed = rawText.replace(/\r\n/g, '\n').trim();
          let chunks = chunkKnowledgeText(trimmed, { baseId: id, maxChars: 300, overlap: 50 });

          if (embeddingSettings.enabled && embeddingSettings.serviceUrl?.trim()) {
              try {
                  const { vectors, model } = await embedTexts(
                      embeddingSettings.serviceUrl,
                      chunks.map(c => c.text),
                      embeddingSettings.apiKey?.trim() || undefined
                  );
                  chunks = chunks.map((c, i) => ({
                      ...c,
                      embedding: vectors[i],
                      embeddingModel: model
                  }));
              } catch (e) {
                  console.error(e);
                  const msg = e instanceof Error ? e.message : String(e);
                  alert(`向量生成失败，已仅保存文本块（将使用词法 RAG）。\n${msg}`);
                  chunks = chunks.map(c => ({ ...c, embedding: undefined, embeddingModel: undefined }));
              }
          } else {
              chunks = chunks.map(c => ({ ...c, embedding: undefined, embeddingModel: undefined }));
          }

          const baseName = `孪生译员-${profile.name}-学习例句-${now.slice(0, 10)}`;
          const row: KnowledgeBase = {
              id,
              name: baseName.slice(0, 120),
              description: `由译员「${profile.name}」在达到 ${MAX_STORED_TRAINING_EXAMPLES} 条例句上限时导出；语言对 ${profile.languagePair}`,
              projectIds: project?.id ? [project.id] : [],
              enabled: true,
              rawText: trimmed,
              chunks,
              createdAt: now,
              updatedAt: now
          };
          onKnowledgeBasesChange([...knowledgeBases, row]);
          alert(
              '已添加到「翻译知识库」。可在主导航「知识库」中查看；若已启用本地向量服务，可直接用于 RAG 检索。'
          );
          setTwinLearningCapModal(null);
      } finally {
          setTwinKbSaving(false);
      }
  }, [twinLearningCapModal, onKnowledgeBasesChange, embeddingSettings, knowledgeBases, project?.id]);

  const handleInsertTerm = (textToInsert: string) => {
      if (!activeSegmentId || !activeSegment) return;
      if (activeSegment.isLocked) return;

      const currentText = activeSegment.targetText || '';
      const { start, end } = textSelection;
      const safeStart = Math.min(start, currentText.length);
      const safeEnd = Math.min(end, currentText.length);
      
      const newText = currentText.substring(0, safeStart) + textToInsert + currentText.substring(safeEnd);
      const cursorPos = safeStart + textToInsert.length;
      handleSegmentChange(activeSegmentId, newText);
      setTextSelection({ start: cursorPos, end: cursorPos });
      setTimeout(() => {
          const el = activeTargetTextareaRef.current;
          if (!el) return;
          try {
              el.focus();
              el.setSelectionRange(cursorPos, cursorPos);
          } catch {
              /* ignore */
          }
      }, 0);
  };

  const handleCopyMtReference = useCallback(
    (text?: string) => {
      const t =
        text?.trim() ||
        (mtReferenceSettings.compareMode
          ? mtCompareResults.find((r) => r.translatorId === mtCompareSelectedId)?.text
          : mtResult)?.trim();
      if (t) copyTextToClipboard(t);
    },
    [mtReferenceSettings.compareMode, mtCompareResults, mtCompareSelectedId, mtResult]
  );

  const handleInsertMtReference = useCallback(
    (text?: string, mode: 'replace' | 'insert-at-cursor' = 'replace') => {
      const t =
        text?.trim() ||
        (mtReferenceSettings.compareMode
          ? mtCompareResults.find((r) => r.translatorId === mtCompareSelectedId)?.text
          : mtResult)?.trim();
      if (!t || !activeSegmentId || !activeSegment || activeSegment.isLocked) return;

      if (mode === 'insert-at-cursor') {
        const currentText = activeSegment.targetText || '';
        let { start, end } = textSelection;
        start = Math.min(Math.max(0, start), currentText.length);
        end = Math.min(Math.max(0, end), currentText.length);
        if (start > end) [start, end] = [end, start];
        const newText = currentText.slice(0, start) + t + currentText.slice(end);
        handleSegmentChange(activeSegmentId, newText);
        const newPos = start + t.length;
        setTextSelection({ start: newPos, end: newPos });
        setTimeout(() => {
          const el = activeTargetTextareaRef.current;
          if (!el) return;
          try {
            el.focus();
            el.setSelectionRange(newPos, newPos);
          } catch {
            /* ignore */
          }
        }, 0);
        return;
      }

      handleSegmentChange(activeSegmentId, t);
      const cursorPos = t.length;
      setTextSelection({ start: cursorPos, end: cursorPos });
      setTimeout(() => {
        const el = activeTargetTextareaRef.current;
        if (!el) return;
        try {
          el.focus();
          el.setSelectionRange(cursorPos, cursorPos);
        } catch {
          /* ignore */
        }
      }, 0);
    },
    [
      mtReferenceSettings.compareMode,
      mtCompareResults,
      mtCompareSelectedId,
      mtResult,
      activeSegmentId,
      activeSegment,
      textSelection,
      handleSegmentChange,
    ]
  );

  const handleAddEditorQuickSymbol = () => {
      const t = quickSymbolNewInput.trim().slice(0, EDITOR_QUICK_SYMBOL_CHAR_MAX);
      if (!t) return;
      if (editorQuickSymbols.length >= EDITOR_QUICK_SYMBOL_LIST_MAX) {
          alert(`常用符号最多 ${EDITOR_QUICK_SYMBOL_LIST_MAX} 条。`);
          return;
      }
      const id = `qs-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      onUpdateEditorQuickSymbols([...editorQuickSymbols, { id, char: t }]);
      setQuickSymbolNewInput('');
  };

  const handleRemoveEditorQuickSymbol = (id: string) => {
      const next = editorQuickSymbols.filter((s) => s.id !== id);
      onUpdateEditorQuickSymbols(
          next.length === 0 ? DEFAULT_EDITOR_QUICK_SYMBOLS.map((e) => ({ ...e })) : next
      );
  };

  const handleApplyTargetSuperscript = useCallback(() => {
      if (!activeSegmentId || !activeSegment || activeSegment.isLocked) return;
      const currentText = activeSegment.targetText || '';
      let { start, end } = textSelection;
      start = Math.min(Math.max(0, start), currentText.length);
      end = Math.min(Math.max(0, end), currentText.length);
      if (start === end) {
          alert('请先选中译文中的文字，再点击上标。');
          return;
      }
      if (start > end) [start, end] = [end, start];
      const slice = currentText.slice(start, end);
      const transformed = mapToSuperscript(slice);
      const newText = currentText.slice(0, start) + transformed + currentText.slice(end);
      handleSegmentChange(activeSegmentId, newText);
      const newEnd = start + transformed.length;
      setTextSelection({ start, end: newEnd });
      setTimeout(() => {
          const el = activeTargetTextareaRef.current;
          if (!el) return;
          try {
              el.focus();
              el.setSelectionRange(start, newEnd);
          } catch {
              /* ignore */
          }
      }, 0);
  }, [activeSegmentId, activeSegment, textSelection, handleSegmentChange]);

  const handleApplyTargetSubscript = useCallback(() => {
      if (!activeSegmentId || !activeSegment || activeSegment.isLocked) return;
      const currentText = activeSegment.targetText || '';
      let { start, end } = textSelection;
      start = Math.min(Math.max(0, start), currentText.length);
      end = Math.min(Math.max(0, end), currentText.length);
      if (start === end) {
          alert('请先选中译文中的文字，再点击下标。');
          return;
      }
      if (start > end) [start, end] = [end, start];
      const slice = currentText.slice(start, end);
      const transformed = mapToSubscript(slice);
      const newText = currentText.slice(0, start) + transformed + currentText.slice(end);
      handleSegmentChange(activeSegmentId, newText);
      const newEnd = start + transformed.length;
      setTextSelection({ start, end: newEnd });
      setTimeout(() => {
          const el = activeTargetTextareaRef.current;
          if (!el) return;
          try {
              el.focus();
              el.setSelectionRange(start, newEnd);
          } catch {
              /* ignore */
          }
      }, 0);
  }, [activeSegmentId, activeSegment, textSelection, handleSegmentChange]);

  const handleClearTargetFormatting = useCallback(() => {
      if (!activeSegmentId || !activeSegment || activeSegment.isLocked) return;
      const location = findSegmentLocation(activeSegmentId);
      if (!location) return;
      const { file, segmentIndex } = location;
      const prev = file.segments[segmentIndex];
      const currentText = prev.targetText || '';

      let plainSel: { start: number; end: number } | null = null;
      const liveSel = readTargetEditorPlainSelection(
        activeTargetTextareaRef.current,
        hasInlineMarkers(currentText)
          ? (start, end) => markerSelectionToPlainOffsets(currentText, start, end)
          : undefined
      );
      if (liveSel) {
        plainSel = liveSel;
      } else if (textSelection.start < textSelection.end) {
        if (hasInlineMarkers(currentText)) {
          plainSel = markerSelectionToPlainOffsets(
            currentText,
            textSelection.start,
            textSelection.end
          );
        } else {
          plainSel = {
            start: Math.min(textSelection.start, textSelection.end),
            end: Math.max(textSelection.start, textSelection.end),
          };
        }
      }

      let newText: string;
      let selStart: number;
      let selEnd: number;
      const plainBefore = stripInlineMarkers(currentText);

      if (plainSel) {
        newText = clearFormattingInPlainRange(currentText, plainSel);
        const clearedMiddle = stripScriptFormatting(
          plainBefore.slice(plainSel.start, plainSel.end)
        );
        selStart = plainSel.start;
        selEnd = plainSel.start + clearedMiddle.length;
      } else {
        newText = clearAllTargetFormatting(currentText);
        selStart = stripInlineMarkers(newText).length;
        selEnd = selStart;
      }

      const inlineRunMeta = pruneInlineRunMeta(
        newText,
        prev.sourceText || '',
        prev.inlineRunMeta
      );
      const updatedSegments = [...file.segments];
      updatedSegments[segmentIndex] = {
        ...prev,
        targetText: newText,
        inlineRunMeta: inlineRunMeta ?? prev.inlineRunMeta,
        status: SegmentStatus.Draft,
        matchType: MatchType.None,
        xliffModified: prev.xliffSegmentId ? true : prev.xliffModified,
        ...withTagFormatQaIssues(prev, file, newText),
      };
      onUpdateFileSegments(file.id, updatedSegments);

      setTextSelection({ start: selStart, end: selEnd });
      setTimeout(() => {
          const el = activeTargetTextareaRef.current;
          if (!el) return;
          try {
              el.focus();
              el.setSelectionRange(selStart, selEnd);
          } catch {
              /* ignore */
          }
      }, 0);
  }, [
      activeSegmentId,
      activeSegment,
      textSelection,
      findSegmentLocation,
      onUpdateFileSegments,
      activeTargetTextareaRef,
  ]);

  const handleApplyTargetBasicStyle = useCallback(
    (styleKey: BasicRunStyleKey) => {
      if (!activeSegmentId || !activeSegment || activeSegment.isLocked) return;
      const location = findSegmentLocation(activeSegmentId);
      if (!location) return;
      const { file, segmentIndex } = location;
      const prev = file.segments[segmentIndex];
      const currentText = prev.targetText || '';

      let plainSel: { start: number; end: number } | null = null;
      const liveSel = readTargetEditorPlainSelection(
        activeTargetTextareaRef.current,
        hasInlineMarkers(currentText)
          ? (start, end) => markerSelectionToPlainOffsets(currentText, start, end)
          : undefined
      );
      if (liveSel) {
        plainSel = liveSel;
      } else if (textSelection.start < textSelection.end) {
        if (hasInlineMarkers(currentText)) {
          plainSel = markerSelectionToPlainOffsets(
            currentText,
            textSelection.start,
            textSelection.end
          );
        } else {
          plainSel = {
            start: Math.min(textSelection.start, textSelection.end),
            end: Math.max(textSelection.start, textSelection.end),
          };
        }
      }

      if (!plainSel || plainSel.start >= plainSel.end) {
        const label = styleKey === 'bold' ? '加粗' : styleKey === 'italic' ? '斜体' : '下划线';
        alert(`请先选中译文中的文字，再点击${label}。`);
        return;
      }

      const result = toggleBasicStyleOnTargetSelection(
        currentText,
        plainSel,
        styleKey,
        prev.inlineRunMeta
      );

      const inlineRunMeta = pruneInlineRunMeta(
        result.targetText,
        prev.sourceText || '',
        result.inlineRunMeta.length ? result.inlineRunMeta : undefined
      );

      const updatedSegments = [...file.segments];
      updatedSegments[segmentIndex] = {
        ...prev,
        targetText: result.targetText,
        inlineRunMeta: inlineRunMeta ?? prev.inlineRunMeta,
        status: SegmentStatus.Draft,
        matchType: MatchType.None,
        xliffModified: prev.xliffSegmentId ? true : prev.xliffModified,
        ...withTagFormatQaIssues(prev, file, result.targetText),
      };
      onUpdateFileSegments(file.id, updatedSegments);

      setTextSelection({ start: plainSel.start, end: plainSel.end });
      setTimeout(() => {
        const el = activeTargetTextareaRef.current;
        if (el) {
          try {
            el.focus();
            el.setSelectionRange(plainSel!.start, plainSel!.end);
          } catch {
            /* ignore */
          }
          return;
        }
        const editable = document.activeElement;
        if (editable instanceof HTMLElement && editable.isContentEditable) {
          editable.focus();
        }
      }, 0);
    },
    [
      activeSegmentId,
      activeSegment,
      textSelection,
      findSegmentLocation,
      onUpdateFileSegments,
      activeTargetTextareaRef,
    ]
  );

  const confirmSegment = useCallback((segment: Segment) => {
      const location = findSegmentLocation(segment.id);
      if (!location || !project) return;
      const { file, segmentIndex } = location;
      const segFromFile = file.segments[segmentIndex];

      let liveTarget = segFromFile.targetText ?? '';
      if (segment.id === activeSegmentId && activeTargetTextareaRef.current) {
          liveTarget = activeTargetTextareaRef.current.value;
      }
      let finalTarget = liveTarget;
      if (
          capitalizeTargetFirstLetterZhOut &&
          isZhToForeignProjectLocales(project.sourceLang, project.targetLang)
      ) {
          finalTarget = capitalizeFirstLetterInTarget(liveTarget, project.targetLang);
      }

      const sourceNorm = normalizeDuplicateSourceKey(segFromFile.sourceText);
      const dupCount = countSegmentsMatchingDuplicateSource(project, sourceNorm);
      const firstDupId = findFirstSegmentIdForDuplicateSource(project, sourceNorm);
      const shouldPropagateDuplicates =
          autoPropagate &&
          Boolean(finalTarget && sourceNorm) &&
          dupCount >= 2 &&
          segment.id === firstDupId;

      const applyDuplicatePropagationInFile = (segs: Segment[]) =>
          segs.map((s) => {
              if (
                  s.id !== segment.id &&
                  normalizeDuplicateSourceKey(s.sourceText) === sourceNorm
              ) {
                  return {
                      ...s,
                      targetText: finalTarget,
                      status: SegmentStatus.Confirmed,
                      matchType: MatchType.Exact,
                  };
              }
              return s;
          });

      let updatedSegments = file.segments.map((s) =>
          s.id === segment.id
              ? { ...s, targetText: finalTarget, status: SegmentStatus.Confirmed }
              : s
      );
      if (shouldPropagateDuplicates) {
          updatedSegments = applyDuplicatePropagationInFile(updatedSegments);
      }

      const segmentUpdates: { fileId: string; segments: Segment[] }[] = [
          { fileId: file.id, segments: updatedSegments },
      ];
      if (shouldPropagateDuplicates) {
          for (const f of project.files) {
              if (f.id === file.id) continue;
              let touched = false;
              const nextSegs = f.segments.map((s) => {
                  if (normalizeDuplicateSourceKey(s.sourceText) === sourceNorm) {
                      touched = true;
                      return {
                          ...s,
                          targetText: finalTarget,
                          status: SegmentStatus.Confirmed,
                          matchType: MatchType.Exact,
                      };
                  }
                  return s;
              });
              if (touched) {
                  segmentUpdates.push({ fileId: f.id, segments: nextSegs });
              }
          }
      }

      if (segmentUpdates.length === 1) {
          onUpdateFileSegments(segmentUpdates[0].fileId, segmentUpdates[0].segments);
      } else {
          onUpdateMultipleFileSegments(segmentUpdates);
      }

      if (shouldPropagateDuplicates) {
          setComparisonListMeasureEpoch((e) => e + 1);
      }

      // ONLY Write to Main TM if confirmed
      if (segFromFile.sourceText && finalTarget && mainTM) {
          const unit: TranslationMemoryUnit = {
              id: `tm-u-${Date.now()}`,
              source: segFromFile.sourceText,
              target: finalTarget,
              lastUsed: new Date().toISOString().split('T')[0],
              usageCount: 1,
          };
          onAddTM(unit);
      }

      const currentViewIndex = filteredSegments.findIndex(s => s.id === segment.id);
      if (currentViewIndex !== -1) {
          let nextId: string | null = null;
          for (let i = currentViewIndex + 1; i < filteredSegments.length; i++) {
              const nextSeg = filteredSegments[i];
              if (!nextSeg.isLocked && nextSeg.status !== SegmentStatus.Confirmed) {
                  nextId = nextSeg.id;
                  break;
              }
          }
          if (nextId) setActiveSegmentId(nextId);
      }
  }, [
      findSegmentLocation,
      autoPropagate,
      onUpdateFileSegments,
      onUpdateMultipleFileSegments,
      project,
      mainTM,
      onAddTM,
      filteredSegments,
      setActiveSegmentId,
      activeSegmentId,
      capitalizeTargetFirstLetterZhOut,
      project.sourceLang,
      project.targetLang,
  ]);

  const toggleSegmentLock = useCallback((segmentId: string) => {
      const location = findSegmentLocation(segmentId);
      if (!location) return;
      const { file } = location;
      const updated = file.segments.map(s => 
          s.id === segmentId ? { ...s, isLocked: !s.isLocked } : s
      );
      onUpdateFileSegments(file.id, updated);
  }, [findSegmentLocation, onUpdateFileSegments]);

  const handleJumpToSegment = (e: React.FormEvent) => {
      e.preventDefault();
      const num = parseInt(jumpInput);
      if (isNaN(num)) return;
      const targetIndex = num - 1;
      if (targetIndex >= 0 && targetIndex < activeFile.segments.length) {
          const segId = activeFile.segments[targetIndex].id;
          setActiveSegmentId(segId);
          setJumpInput('');
          setShowJumpInput(false);
          requestAnimationFrame(() => {
            if (editorLayoutMode !== 'comparison') return;
            const idx = filteredSegments.findIndex((s) => s.id === segId);
            if (idx >= 0) {
              scrollComparisonListToActiveRow(comparisonListRef.current, idx);
            }
          });
      } else {
          alert('无效的句段编号');
      }
  };

  const handleCopySourceToTarget = () => {
      if (!activeSegmentId) return;
      const loc = findSegmentLocation(activeSegmentId);
      if (!loc) return;
      const { file } = loc;
      const segment = file.segments[loc.segmentIndex];
      if (!segment || segment.isLocked) return;

      const updated = file.segments.map(s => s.id === activeSegmentId ? {
          ...s,
          targetText: s.sourceText,
          status: SegmentStatus.Draft
      } : s);
      onUpdateFileSegments(file.id, updated);
  };

  // 备用复制方法（全局）
  const copyToClipboardFallback = (text: string) => {
      try {
          const textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.style.position = 'fixed';
          textarea.style.left = '-999999px';
          textarea.style.top = '-999999px';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          textarea.setSelectionRange(0, 99999); // 移动端兼容

          const successful = document.execCommand('copy');
          document.body.removeChild(textarea);

          if (successful) {
              console.log('内容已复制到剪贴板（备用方法）');
          } else {
              console.error('复制失败');
          }
      } catch (err) {
          console.error('复制异常:', err);
      }
  };

  const handleFind = async () => {
      if (!findText) return;
      if (findUseRegex) {
          const err = validateFindRegex(findText);
          if (err) {
              alert(`正则表达式无效：${err}`);
              return;
          }
      }

      const results: {fileId: string, segment: Segment}[] = [];

      try {
          const searchFile = async (fileId: string, fileSegments: Segment[]) => {
              for (const segment of fileSegments) {
                  if (segment.isLocked) continue;
                  const textToCheck = findType === 'source' ? segment.sourceText : segment.targetText;
                  if (await segmentContainsFind(textToCheck, findText, findUseRegex)) {
                      results.push({ fileId, segment });
                  }
              }
          };

          if (replaceScope === 'project' && project) {
              for (const file of project.files) {
                  await searchFile(file.id, file.segments);
              }
          } else {
              await searchFile(activeFile.id, activeFile.segments);
          }

          setFindResults(results);
          setShowFindResults(true);
          setIsReplaceModalOpen(false);

          if (results.length === 0) {
              alert('未找到匹配项');
          }
      } catch (e) {
          alert(e instanceof Error ? e.message : String(e));
      }
  };

  const handleReplaceAll = async () => {
      if (!findText) return;
      if (findUseRegex) {
          const err = validateFindRegex(findText);
          if (err) {
              alert(`正则表达式无效，无法替换：${err}`);
              return;
          }
      }

      const applyReplaceToFile = async (fileSegments: Segment[]): Promise<Segment[] | null> => {
           let changed = false;
           const newSegments = await Promise.all(
               fileSegments.map(async (s) => {
                if (s.isLocked) return s;

                const textToCheck = findType === 'source' ? s.sourceText : s.targetText;
                if (!(await segmentContainsFind(textToCheck, findText, findUseRegex))) return s;

                if (replaceType === 'source') {
                    const newSource = await applyFindReplaceInText(s.sourceText, findText, replaceText, findUseRegex);
                    if (newSource !== s.sourceText) {
                        changed = true;
                        return { ...s, sourceText: newSource, status: SegmentStatus.Draft };
                    }
                } else {
                    const newTarget = await applyFindReplaceInText(s.targetText, findText, replaceText, findUseRegex);
                    if (newTarget !== s.targetText) {
                        changed = true;
                        return { ...s, targetText: newTarget, status: SegmentStatus.Draft };
                    }
                }
                return s;
           }));
           return changed ? newSegments : null;
      };

      try {
      if (replaceScope === 'project' && project) {
          let totalReplaced = 0;
          let replacedPairs: {source: string, target: string}[] = [];

          for (const f of project.files) {
              const updated = await applyReplaceToFile(f.segments);
              if (updated) {
                  onUpdateFileSegments(f.id, updated);

                  updated.forEach(seg => {
                      if (seg.status === SegmentStatus.Draft && seg.sourceText && seg.targetText) {
                          replacedPairs.push({ source: seg.sourceText, target: seg.targetText });
                      }
                  });

                  totalReplaced += updated.filter(s => s.status === SegmentStatus.Draft).length;
              }
          }
          
          // 将替换后的翻译对写入TM
          if (replacedPairs.length > 0 && mainTM) {
              const uniquePairs = Array.from(new Set(replacedPairs.map(p => JSON.stringify(p)))).map(str => JSON.parse(str));
              uniquePairs.forEach(pair => {
                  const unit: TranslationMemoryUnit = {
                      id: `tm-u-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                      source: pair.source,
                      target: pair.target,
                      lastUsed: new Date().toISOString().split('T')[0],
                      usageCount: 1
                  };
                  onAddTM(unit);
              });
          }
          
          // 实现覆盖功能：对相同原文的内容进行覆盖
          if (replaceType === 'target' && project) {
              project.files.forEach(file => {
                  const updatedSegments = file.segments.map(segment => {
                      if (segment.isLocked) return segment;
                      
                      // 查找是否有相同原文的已确认翻译
                      const matchingPair = replacedPairs.find(pair => pair.source === segment.sourceText);
                      if (matchingPair && segment.status !== SegmentStatus.Confirmed) {
                          return {
                              ...segment,
                              targetText: matchingPair.target,
                              status: SegmentStatus.Translated,
                              matchType: MatchType.Exact
                          };
                      }
                      return segment;
                  });
                  
                  // 检查是否有更新
                  const hasChanges = updatedSegments.some((seg, index) => 
                      seg.targetText !== file.segments[index].targetText || 
                      seg.status !== file.segments[index].status
                  );
                  
                  if (hasChanges) {
                      onUpdateFileSegments(file.id, updatedSegments);
                  }
              });
          }
          
          if(totalReplaced > 0) {
              alert(`已在整个项目中完成替换：${totalReplaced} 处\n已写入记忆库：${replacedPairs.length} 条`);
              setIsReplaceModalOpen(false);
          } else {
              alert('未找到匹配项');
          }
      } else {
          const updated = await applyReplaceToFile(activeFile.segments);
          if (updated) {
              const changedSegs = updated.filter(s => {
                  if (replaceType === 'source') {
                      return s.sourceText !== activeFile.segments.find(old => old.id === s.id)?.sourceText;
                  } else {
                      return s.targetText !== activeFile.segments.find(old => old.id === s.id)?.targetText;
                  }
              });
              
              onUpdateFileSegments(activeFile.id, updated);
              
              // 收集替换后的翻译对并写入TM
              const replacedPairs: {source: string, target: string}[] = [];
              updated.forEach(seg => {
                  if (seg.status === SegmentStatus.Draft && seg.sourceText && seg.targetText) {
                      replacedPairs.push({ source: seg.sourceText, target: seg.targetText });
                  }
              });
              
              if (replacedPairs.length > 0 && mainTM) {
                  const uniquePairs = Array.from(new Set(replacedPairs.map(p => JSON.stringify(p)))).map(str => JSON.parse(str));
                  uniquePairs.forEach(pair => {
                      const unit: TranslationMemoryUnit = {
                          id: `tm-u-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                          source: pair.source,
                          target: pair.target,
                          lastUsed: new Date().toISOString().split('T')[0],
                          usageCount: 1
                      };
                      onAddTM(unit);
                  });
              }
              
              // 实现覆盖功能：对当前文件中相同原文的内容进行覆盖
              if (replaceType === 'target' && project) {
                  const updatedSegments = activeFile.segments.map(segment => {
                      if (segment.isLocked) return segment;
                      
                      // 查找是否有相同原文的已确认翻译
                      const matchingPair = replacedPairs.find(pair => pair.source === segment.sourceText);
                      if (matchingPair && segment.status !== SegmentStatus.Confirmed) {
                          return {
                              ...segment,
                              targetText: matchingPair.target,
                              status: SegmentStatus.Translated,
                              matchType: MatchType.Exact
                          };
                      }
                      return segment;
                  });
                  
                  // 检查是否有更新
                  const hasChanges = updatedSegments.some((seg, index) => 
                      seg.targetText !== activeFile.segments[index].targetText || 
                      seg.status !== activeFile.segments[index].status
                  );
                  
                  if (hasChanges) {
                      onUpdateFileSegments(activeFile.id, updatedSegments);
                  }
              }
              
              setReplacedSegments(changedSegs);
              setShowReplacePanel(true);
              setShowQAPanel(false); 
              setIsReplaceModalOpen(false);
          } else {
              alert('在当前文件中未找到匹配项');
          }
      }
      } catch (e) {
          alert(e instanceof Error ? e.message : String(e));
      }
  };

  const handleAiTranslate = async (segment: Segment) => {
      const readinessError = getAIReadinessError(aiSettings);
      if (readinessError) {
          alert(readinessError);
          return;
      }
      setIsAiProcessing(true);
      try {
          const ragContext = await buildRagContextStringAsync(
              segment.sourceText,
              knowledgeBases,
              project.id,
              embeddingSettings
          );

          const translated = await translateWithOptionalGrammarRules(
              segment.sourceText,
              project.contextDescription,
              ragContext
          );

          const location = findSegmentLocation(segment.id);
          if (!location) return;
          const { file } = location;
          const updated = file.segments.map(s => s.id === segment.id ? applyTagFormatQaToSegment({
              ...s,
              targetText: translated,
              status: SegmentStatus.Translated,
              matchType: MatchType.AI
          }, file, translated) : s);
          onUpdateFileSegments(file.id, updated);
      } catch (e) {
          alert(e instanceof Error ? e.message : String(e));
      } finally {
          setIsAiProcessing(false);
      }
  };

  const handleBatchTranslateSelection = async () => {
      const readinessError = getAIReadinessError(aiSettings);
      if (readinessError) {
          alert(readinessError);
          return;
      }
      const targets = activeFile.segments.filter(
          (s) => selectedSegmentIds.has(s.id) && !s.isLocked
      );
      if (targets.length === 0) {
          alert('没有可翻译的选中句段（可能均已锁定）。');
          return;
      }
      setIsSelectionBatchTranslating(true);
      const CONCURRENCY_LIMIT = 3;
      let currentIndex = 0;
      const activePromises: Promise<void>[] = [];
      let currentSegments = [...activeFile.segments];

      const processNext = async () => {
          if (currentIndex >= targets.length) return;
          const seg = targets[currentIndex];
          currentIndex++;
          try {
              const ragContext = await buildRagContextStringAsync(
                  seg.sourceText,
                  knowledgeBases,
                  project.id,
                  embeddingSettings
              );
              const result = await translateWithOptionalGrammarRules(
                  seg.sourceText,
                  project.contextDescription,
                  ragContext
              );
              const segIndex = currentSegments.findIndex((s) => s.id === seg.id);
              if (segIndex !== -1) {
                  currentSegments[segIndex] = applyTagFormatQaToSegment(
                      {
                          ...currentSegments[segIndex],
                          targetText: result,
                          status: SegmentStatus.Translated,
                          matchType: MatchType.AI,
                      },
                      activeFile,
                      result
                  );
              }
              if (currentIndex % 3 === 0 || currentIndex === targets.length) {
                  onUpdateFileSegments(activeFile.id, [...currentSegments]);
              }
          } catch (e) {
              console.error('[Editor] 批量翻译句段失败', seg.id, e);
          }
      };

      try {
          while (activePromises.length > 0 || currentIndex < targets.length) {
              while (
                  activePromises.length < CONCURRENCY_LIMIT &&
                  currentIndex < targets.length
              ) {
                  const p = processNext().then(() => {
                      const i = activePromises.indexOf(p);
                      if (i !== -1) activePromises.splice(i, 1);
                  });
                  activePromises.push(p);
              }
              if (activePromises.length === 0) break;
              await Promise.race(activePromises);
          }
          onUpdateFileSegments(activeFile.id, [...currentSegments]);
      } finally {
          setIsSelectionBatchTranslating(false);
      }
  };

  const handleAiPolish = async (segment: Segment) => {
      if (!segment.targetText) return;
      setIsPolishing(true);
      try {
          const polished = await polishSegment(
              segment.sourceText,
              segment.targetText,
              project.targetLang,
              project.contextDescription,
              aiSettings 
          );

          const location = findSegmentLocation(segment.id);
          if (!location) return;
          const { file } = location;
          const updated = file.segments.map(s => s.id === segment.id ? {
              ...s,
              targetText: polished,
              status: SegmentStatus.Draft 
          } : s);
          onUpdateFileSegments(file.id, updated);
      } finally {
          setIsPolishing(false);
      }
  };

  const handleSendChat = async () => {
      if(!chatInput.trim()) return;
      const msg = chatInput;
      setChatInput('');
      const newHistory = [...chatHistory, { role: 'user' as const, text: msg }];
      setChatHistory(newHistory);
      setIsChatSending(true);

      try {
          const response = await sendAIChatMessage(
              newHistory, 
              msg, 
              project.contextDescription,
              aiSettings
          );
          setChatHistory([...newHistory, { role: 'model', text: response }]);
      } catch(e) {
          console.error(e);
      } finally {
          setIsChatSending(false);
      }
  };

  const handleDismissQA = (segmentId: string, issueId: string) => {
    const updated = activeFile.segments.map(s => {
        if (s.id === segmentId) {
            return { ...s, qaIssues: s.qaIssues?.filter(i => i.id !== issueId) };
        }
        return s;
    });
    onUpdateFileSegments(activeFile.id, updated);
    if (editorLayoutMode === 'comparison') {
      setComparisonListMeasureEpoch((e) => e + 1);
    }
  };

  // --- Batch Pre-Translate Logic ---
  const handleOpenBatchModal = () => {
      setBatchStep('mode-select');
      setBatchSourceStats(null);
      setIsBatchModalOpen(true);
      setBatchPrompt('');
      setBatchProgress({ current: 0, total: 0 });
      setBatchStats({ succeeded: 0, failed: 0 });
  };

  const handleBatchModalClose = () => {
      batchModalCancelGenerationRef.current += 1;
      setIsBatchModalOpen(false);
  };

  const startSmartAnalysis = async () => {
      const readinessError = getAIReadinessError(aiSettings);
      if (readinessError) {
          alert(readinessError);
          handleBatchModalClose();
          return;
      }
      const runGen = batchModalCancelGenerationRef.current;
      setBatchStep('analyzing');
      try {
          const samples = activeFile.segments
            .slice(0, 100) 
            .filter(s => s.sourceText.trim().length > 5)
            .slice(0, 30)
            .map(s => s.sourceText);

          const analysis = await analyzeProjectContext(samples, project.sourceLang, project.targetLang, aiSettings);
          if (runGen !== batchModalCancelGenerationRef.current) return;
          setBatchPrompt(analysis);
          setBatchStep('review-prompt');
      } catch (e) {
          console.error("Analysis failed", e);
          if (runGen !== batchModalCancelGenerationRef.current) return;
          setBatchPrompt(project.contextDescription || "请保持专业翻译风格。");
          setBatchStep('review-prompt');
      }
  };

  const executeBatchTranslation = async (useSmartPrompt: boolean) => {
      const strategy: PreTranslateStrategy = useSmartPrompt ? 'tmMtLlm' : batchStrategy;
      if ((strategy === 'tmMtLlm' || strategy === 'tmLlm' || strategy === 'llmOnly') && getAIReadinessError(aiSettings)) {
          alert(getAIReadinessError(aiSettings));
          handleBatchModalClose();
          return;
      }
      const runGen = batchModalCancelGenerationRef.current;
      setBatchStep('processing');
      setBatchSourceStats(null);
      const targets = activeFile.segments.filter(
          (s) => (!s.targetText || s.targetText.trim() === '') && !s.isLocked
      );
      setBatchProgress({ current: 0, total: targets.length });

      if (targets.length === 0) {
          setBatchStep('done');
          return;
      }

      const contextToUse = useSmartPrompt ? batchPrompt : (project.contextDescription || '');

      try {
          const { segments: updated, stats } = await runPreTranslateBatch(
              activeFile.segments,
              {
                  strategy,
                  fuzzyThreshold: batchFuzzyThreshold,
                  contextDescription: contextToUse,
                  aiSettings,
                  mtSettings: mtReferenceSettings,
                  sourceLang: project.sourceLang,
                  targetLang: project.targetLang,
                  tms: allTMs,
                  grammarRulesSorted,
                  regexCategoryMap,
                  uncategorizedRegexEntries,
                  allTerms,
                  buildRagContext:
                      strategy === 'tmMtLlm' || strategy === 'tmLlm' || strategy === 'llmOnly'
                          ? (source) =>
                                buildRagContextStringAsync(
                                    source,
                                    knowledgeBases,
                                    project.id,
                                    embeddingSettings
                                )
                          : undefined,
              },
              (current, total) => setBatchProgress({ current, total }),
              () => runGen !== batchModalCancelGenerationRef.current
          );
          if (runGen === batchModalCancelGenerationRef.current) {
              onUpdateFileSegments(activeFile.id, updated);
              setBatchSourceStats(stats);
              setBatchStats({
                  succeeded: stats.tm + stats.fuzzy + stats.mt + stats.llm,
                  failed: stats.failed,
              });
              setBatchStep('done');
          }
      } catch (e) {
          console.error(e);
          if (runGen === batchModalCancelGenerationRef.current) {
              alert('批量预翻译失败，请重试');
              handleBatchModalClose();
          }
      }
  };

  const handleRunProofreadBatch = async () => {
      const readinessError = getAIReadinessError(aiSettings);
      if (readinessError) {
          alert(readinessError);
          return;
      }
      const runGen = proofreadCancelRef.current + 1;
      proofreadCancelRef.current = runGen;
      setIsProofreadModalOpen(true);
      setIsProofreadRunning(true);
      setProofreadStats(null);
      const targets = activeFile.segments.filter((s) => !s.isLocked && s.targetText?.trim());
      setProofreadProgress({ current: 0, total: targets.length });
      try {
          const { segments: updated, stats } = await runProofreadBatch(
              activeFile.segments,
              project.sourceLang,
              project.targetLang,
              aiSettings,
              {
                  contextDescription: project.contextDescription,
                  setProofreadStatus: true,
                  onProgress: (c, t) => setProofreadProgress({ current: c, total: t }),
                  isCancelled: () => proofreadCancelRef.current !== runGen,
              }
          );
          if (proofreadCancelRef.current === runGen) {
              onUpdateFileSegments(activeFile.id, updated);
              setProofreadStats(stats);
          }
      } finally {
          if (proofreadCancelRef.current === runGen) {
              setIsProofreadRunning(false);
          }
      }
  };

  // --- NEW: Batch Operations Logic ---
  const handleBatchOperation = (operation: 'lock' | 'unlock' | 'confirm' | 'clear' | 'copySource' | 'status-draft') => {
      if (selectedSegmentIds.size === 0) return;
      
      const tmUnitsToAdd: TranslationMemoryUnit[] = [];
      const updatedSegments = activeFile.segments.map(seg => {
          if (!selectedSegmentIds.has(seg.id)) return seg;
          
          switch(operation) {
              case 'lock': return { ...seg, isLocked: true };
              case 'unlock': return { ...seg, isLocked: false };
              case 'confirm':
                  if (seg.sourceText && seg.targetText && mainTM) {
                      tmUnitsToAdd.push({
                          id: `tm-u-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                          source: seg.sourceText,
                          target: seg.targetText,
                          lastUsed: new Date().toISOString().split('T')[0],
                          usageCount: 1
                      });
                  }
                  return seg.targetText ? { ...seg, status: SegmentStatus.Confirmed } : seg;
              case 'clear':
                   return !seg.isLocked ? { ...seg, targetText: '', status: SegmentStatus.NotStarted } : seg;
              case 'copySource':
                   return !seg.isLocked ? { ...seg, targetText: seg.sourceText, status: SegmentStatus.Draft } : seg;
              case 'status-draft':
                   return !seg.isLocked ? { ...seg, status: SegmentStatus.Draft } : seg;
              default: return seg;
          }
      });
  
      onUpdateFileSegments(activeFile.id, updatedSegments);
      if (operation === 'confirm' && mainTM && tmUnitsToAdd.length > 0) {
          tmUnitsToAdd.forEach(unit => onAddTM(unit));
      }
      // Keep selection active for visibility
  };

  const handleMergeSelectedSegments = () => {
      if (selectedSegmentIds.size < 2 || !activeFile) return;

      const segs = activeFile.segments;
      const ordered = segs.filter((s) => selectedSegmentIds.has(s.id));
      if (ordered.length < 2) return;

      if (ordered.some((s) => s.isLocked)) {
          alert('选中的句段中包含锁定句段，无法合并。');
          return;
      }

      const firstIdx = segs.findIndex((s) => s.id === ordered[0].id);
      for (let i = 0; i < ordered.length; i++) {
          if (segs[firstIdx + i]?.id !== ordered[i].id) {
              alert('只能合并文件中彼此相邻的连续句段。');
              return;
          }
      }

      const joinMergedClauseTexts = (parts: string[]) =>
          parts.map((p) => p.trim()).filter((p) => p.length > 0).join(' ');
      const mergedSource = joinMergedClauseTexts(ordered.map((s) => s.sourceText));
      const mergedTarget = joinMergedClauseTexts(ordered.map((s) => s.targetText));

      let status: SegmentStatus;
      if (!mergedTarget.trim()) {
          status = SegmentStatus.NotStarted;
      } else if (
          ordered.every(
              (s) => s.status === SegmentStatus.Confirmed && s.targetText.trim()
          )
      ) {
          status = SegmentStatus.Confirmed;
      } else {
          status = SegmentStatus.Draft;
      }

      const mergedComments = ordered.flatMap((s) => s.comments ?? []);
      const mergedQa = ordered.flatMap((s) => s.qaIssues ?? []);

      const merged: Segment = {
          id: `seg-m-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          sourceText: mergedSource,
          targetText: mergedTarget,
          status,
          matchType: MatchType.None,
          comments: mergedComments.length ? mergedComments : undefined,
          qaIssues: mergedQa.length ? mergedQa : undefined,
          isLocked: false,
      };

      const lastIdx = firstIdx + ordered.length - 1;
      const newSegments = [...segs.slice(0, firstIdx), merged, ...segs.slice(lastIdx + 1)];

      onUpdateFileSegments(activeFile.id, newSegments);
      setSelectedSegmentIds(new Set([merged.id]));
      setActiveSegmentId(merged.id);
      setLastInteractedId(merged.id);
  };

  const handleRowClick = (e: React.MouseEvent, segId: string) => {
    // Check if interacting with an input/textarea/button (incl. QA badge dismiss)
    const target = e.target as HTMLElement;
    const isInput =
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'INPUT' ||
      target.tagName === 'BUTTON' ||
      Boolean(target.closest('button'));
    
    // If typing/selecting text, don't trigger batch row selection logic
    if (isInput) {
        setActiveSegmentId(segId);
        return;
    }

    // If user has selected text, don't trigger row selection logic
    const selection = window.getSelection()?.toString().trim();
    if (selection) {
        setActiveSegmentId(segId);
        return;
    }

    // Prevent browser text selection when shift-clicking rows (UI only)
    if (e.shiftKey) {
        window.getSelection()?.removeAllRanges();
    }

    let newSet = new Set(selectedSegmentIds);
    
    // Check for Ctrl/Cmd (Mac) or Shift
    if (e.shiftKey && lastInteractedId) {
        const allIds = filteredSegments.map(s => s.id);
        const start = allIds.indexOf(lastInteractedId);
        const end = allIds.indexOf(segId);
        
        if (start !== -1 && end !== -1) {
            const low = Math.min(start, end);
            const high = Math.max(start, end);
            const range = allIds.slice(low, high + 1);
            if (e.ctrlKey || e.metaKey) {
                // Add range to existing
                range.forEach(id => newSet.add(id));
            } else {
                // Replace with range
                newSet = new Set(range);
            }
        } else {
             newSet = new Set([segId]);
        }
    } else if (e.ctrlKey || e.metaKey) {
        // Toggle selection
        if (newSet.has(segId)) newSet.delete(segId);
        else newSet.add(segId);
        setLastInteractedId(segId);
    } else {
        // Normal click: Select single & Activate
        newSet = new Set([segId]);
        setLastInteractedId(segId);
    }
    
    setSelectedSegmentIds(newSet);
    setActiveSegmentId(segId);
  };

  const handleCheckboxClick = (e: React.MouseEvent, segId: string) => {
      e.stopPropagation();

      // Allow range selection on checkbox
      if (e.shiftKey && lastInteractedId) {
           const allIds = filteredSegments.map(s => s.id);
           const start = allIds.indexOf(lastInteractedId);
           const end = allIds.indexOf(segId);
           
           if (start !== -1 && end !== -1) {
               const low = Math.min(start, end);
               const high = Math.max(start, end);
               const range = allIds.slice(low, high + 1);
               let newSet = new Set(selectedSegmentIds);
               
               if (e.ctrlKey || e.metaKey) {
                   range.forEach(id => newSet.add(id));
               } else {
                   newSet = new Set(range);
               }
               setSelectedSegmentIds(newSet);
               // Anchor remains lastInteractedId
               return; 
           }
      }

      const newSet = new Set(selectedSegmentIds);
      if (newSet.has(segId)) newSet.delete(segId);
      else newSet.add(segId);
      setSelectedSegmentIds(newSet);
      setLastInteractedId(segId);
  };


  const handleEditTerm = (term: TermBaseEntry) => {
      setEditingTermId(term.id);
      setEditingTermTarget(term.target);
  };

  const handleCancelTermEdit = () => {
      setEditingTermId(null);
      setEditingTermTarget('');
  };

  const handleUpdateTermInline = () => {
      if (!mainTB || !editingTermId) return;
      const tgt = editingTermTarget.trim();
      if (!tgt) return;
      const term = mainTB.entries.find((e) => e.id === editingTermId);
      if (!term) return;
      onUpdateTerm(mainTB.id, {
          id: editingTermId,
          source: term.source,
          target: tgt,
      });
      setEditingTermId(null);
      setEditingTermTarget('');
  };

  const handleSaveTerm = () => {
      if (editingTermId) {
          handleUpdateTermInline();
          return;
      }
      if (mainTB && termSource && termTarget) {
          onAddTerm(mainTB.id, {
              id: `t-${Date.now()}`,
              source: termSource,
              target: termTarget,
          });
          setTermSource('');
          setTermTarget('');
          setShowAddTermForm(false);
      } else if (!mainTB) {
          alert("无主术语库，无法添加术语。");
      }
  };
  handleSaveTermRef.current = handleSaveTerm;

  // F1/F4、术语栏 Ctrl+1～9（同「插入/替换译文」）、Ctrl+W 保存术语
  useEffect(() => {
      const isOtherTypingField = (el: EventTarget | null) => {
          if (!el || !(el instanceof HTMLElement)) return false;
          if (el.isContentEditable) return true;
          const tag = el.tagName;
          if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return false;
          return activeTargetTextareaRef.current !== el;
      };

      const onKey = (e: KeyboardEvent) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w') {
              if (!(showAddTermForm || editingTermId)) return;
              if (editingTermId) {
                  if (!mainTB || !editingTermTarget.trim()) return;
              } else {
                  if (!mainTB || !termSource.trim() || !termTarget.trim()) return;
              }
              e.preventDefault();
              handleSaveTermRef.current();
              return;
          }

          const digit =
              e.key >= '1' &&
              e.key <= '9' &&
              !e.altKey &&
              !e.shiftKey &&
              (e.ctrlKey || e.metaKey)
                  ? parseInt(e.key, 10)
                  : null;
          if (digit !== null && activeSidebarTab === 'terms') {
              if (isOtherTypingField(e.target)) return;
              e.preventDefault();
              if (!activeSegment || activeSegment.isLocked) return;
              const term = displayedTerms[digit - 1];
              if (!term) return;
              handleInsertTerm(term.target);
              return;
          }

          if (e.key === 'F1' || e.key === 'F4') {
              if (isOtherTypingField(e.target)) return;
              e.preventDefault();

              if (!activeSegment || activeSegment.isLocked) return;

              if (e.key === 'F1') {
                  handleSegmentChange(activeSegment.id, activeSegment.sourceText);
                  return;
              }
              const first = tmMatches[0];
              if (!first) return;
              handleSegmentChange(activeSegment.id, first.target);
          }
      };

      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
  }, [
      activeSegment,
      activeSidebarTab,
      displayedTerms,
      handleSegmentChange,
      handleInsertTerm,
      tmMatches,
      showAddTermForm,
      editingTermId,
      editingTermTarget,
      mainTB,
      termSource,
      termTarget,
  ]);

  const handleDeleteTermConfirm = () => {
      if (mainTB && termToDelete) {
          onDeleteTerm(mainTB.id, termToDelete.id);
          setTermToDelete(null); 
      }
  };

  const handleStartExtraction = async () => {
      setExtractStep('processing');
      try {
          const fullText = activeFile.segments.map(s => s.sourceText).join('\n');
          const categories = [];
          if (extractConfig.types.technical) categories.push("专业术语 (Technical Terms)");
          if (extractConfig.types.person) categories.push("人名 (Person Names)");
          if (extractConfig.types.location) categories.push("地名 (Locations)");
          if (extractConfig.types.org) categories.push("机构名 (Organizations)");

          const candidates = await extractProjectTerms(fullText, project.targetLang, categories, extractConfig.threshold, aiSettings);
          setExtractedCandidates(candidates);
          setSelectedCandidates(new Set(candidates.map(c => c.id)));
          setExtractStep('review');
      } catch (e) {
          setExtractStep('config');
          alert("提取失败，请重试");
      }
  };

  const handleCandidateChange = (index: number, field: 'source' | 'target', value: string) => {
      const updated = [...extractedCandidates];
      updated[index] = { ...updated[index], [field]: value };
      setExtractedCandidates(updated);
  };

  /** 将勾选行的原文、建议译文转为小写（拉丁字母等；中文不变） */
  const handleLowercaseSelectedExtractCandidates = () => {
      if (selectedCandidates.size === 0) {
          alert('请先勾选要变小写的术语');
          return;
      }
      setExtractedCandidates((prev) =>
          prev.map((c) =>
              selectedCandidates.has(c.id)
                  ? { ...c, source: c.source.toLowerCase(), target: c.target.toLowerCase() }
                  : c
          )
      );
  };

  const handleImportCandidates = () => {
      if (!mainTB) {
          alert("请先配置主术语库 (Main TB) 用于写入。");
          return;
      }
      const toImport = extractedCandidates.filter(c => selectedCandidates.has(c.id));
      const existingSources = new Set(mainTB.entries.map(e => e.source.toLowerCase().trim()));
      let addedCount = 0;
      let skipCount = 0;
      toImport.forEach((c, idx) => {
          if (existingSources.has(c.source.toLowerCase().trim())) {
              skipCount++;
              return;
          }
          onAddTerm(mainTB!.id, {
              id: `t-auto-${Date.now()}-${idx}`,
              source: c.source,
              target: c.target
          });
          addedCount++;
      });
      setIsExtractModalOpen(false);
      setExtractedCandidates([]);
      if (skipCount > 0) {
          alert(`导入成功: ${addedCount} 条\n已跳过重复: ${skipCount} 条 (术语库中已存在)`);
      } else {
          alert(`导入成功: ${addedCount} 条`);
      }
  };

  const getCandidatesForExtractExport = (): TermCandidate[] => {
      if (extractExportScope === 'all') return extractedCandidates;
      return extractedCandidates.filter((c) => selectedCandidates.has(c.id));
  };

  const handleExportExtractCandidates = () => {
      const list = getCandidatesForExtractExport();
      if (list.length === 0) {
          alert(
              extractExportScope === 'all'
                  ? '没有可导出的候选术语'
                  : '请先勾选要导出的术语，或将导出范围改为「全部候选」'
          );
          return;
      }
      const safePart = (s: string) => s.replace(/[/\\?%*:|"<>]/g, '-');
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const scopeLabel = extractExportScope === 'all' ? '全部' : '已选';
      const base = `${safePart(project?.name || '项目')}_${safePart(activeFile.name)}_术语候选_${scopeLabel}_${stamp}`;

      const rows = list.map((c) => ({
          Source: c.source,
          Target: c.target,
          Type: c.type,
          Confidence: c.confidence,
          审校后译文: '',
          备注: '',
      }));

      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'TermCandidates');
      XLSX.writeFile(workbook, `${base}.xlsx`);
  };

  const runLocalQAChecks = (seg: Segment, targetLang: string): QAIssue[] => {
     const issues: QAIssue[] = [];
     const s = seg.sourceText;
     const t = seg.targetText;

     if (!t) return [];

     if (qaConfig.sourceTargetSame) {
         const st = s.trim();
         const tt = t.trim();
         if (st && st === tt) {
             issues.push({ id: `qa-same-${seg.id}`, type: 'warning', category: '原文译文', message: '原文和译文相同' });
         }
     }
     if (qaConfig.numberAccuracy) {
         const getNums = (str: string) =>
             stripInlineMarkers(str).match(/\d+/g)?.sort().join(',') || '';
         if (getNums(s) !== getNums(t)) {
             issues.push({ id: `qa-num-${seg.id}`, type: 'error', category: '数字', message: '原文与译文数字不匹配' });
         }
     }
     if (qaConfig.termMatch && mainTB) {
         const tbEntries = mainTB.entries;
         for (const term of tbEntries) {
             if (
                 termSourceHitsSegment(s, term, tbEntries, qaConfig.ignoreCase) &&
                 !targetContainsTermTranslation(t, term, qaConfig.ignoreCase)
             ) {
                 issues.push({
                     id: `qa-term-${seg.id}-${term.id}`,
                     type: 'warning',
                     category: '术语',
                     message: `缺失术语翻译: ${term.source} -> ${term.target}`,
                 });
             }
         }
     }
     if (qaConfig.punctuationPair) {
         const checkPair = (charA: string, charB: string) => {
             const countA = (t.split(charA).length - 1);
             const countB = (t.split(charB).length - 1);
             return countA === countB;
         }
         if (!checkPair('(', ')') || !checkPair('（', '）')) issues.push({ id: `qa-punc-br-${seg.id}`, type: 'warning', category: '标点', message: '括号不匹配' });
         if (!checkPair('[', ']') || !checkPair('【', '】')) issues.push({ id: `qa-punc-sq-${seg.id}`, type: 'warning', category: '标点', message: '方括号不匹配' });
     }
     if (qaConfig.untranslated) {
         const sameTrimmed = s.trim() === t.trim();
         if (/[a-zA-Z]/.test(s) && sameTrimmed && !(qaConfig.sourceTargetSame && sameTrimmed)) {
             issues.push({ id: `qa-untrans-${seg.id}`, type: 'error', category: '未翻译', message: '译文与原文相同' });
         }
     }
     if (qaConfig.repeatedWords) {
         let repetitionMatches: string[] = [];
         
         // Check repetition based on target language
         if (targetLang.startsWith('zh-')) {
             // Chinese-specific repetition checks
             
             // 1. Single Chinese character repetition: 我我, 天天, 好好
             // Changed from 2+ repetitions to 1+ to catch "好好" pattern
             const chineseCharRepeatRegex = /([\u4e00-\u9fa5])\1{1,}/g;
             let charMatch;
             while ((charMatch = chineseCharRepeatRegex.exec(t)) !== null) {
                 repetitionMatches.push(charMatch[0]);
                 // Prevent infinite loop by breaking if lastIndex doesn't increase
                 if (chineseCharRepeatRegex.lastIndex === charMatch.index) {
                     break;
                 }
             }
             
             // 2. Two-character Chinese word repetition: 学习学习学习, 好好好好
             const chineseWordRepeatRegex = /([\u4e00-\u9fa5]{2})\1{1,}/g;
             let wordMatch;
             while ((wordMatch = chineseWordRepeatRegex.exec(t)) !== null) {
                 repetitionMatches.push(wordMatch[0]);
                 // Prevent infinite loop by breaking if lastIndex doesn't increase
                 if (chineseWordRepeatRegex.lastIndex === wordMatch.index) {
                     break;
                 }
             }
             
             // 3. ABAB pattern repetition: 好好学习, 天天向上
             const chineseAbabRepeatRegex = /([\u4e00-\u9fa5])([\u4e00-\u9fa5])\1\2/g;
             let ababMatch;
             while ((ababMatch = chineseAbabRepeatRegex.exec(t)) !== null) {
                 repetitionMatches.push(ababMatch[0]);
                 // Prevent infinite loop by breaking if lastIndex doesn't increase
                 if (chineseAbabRepeatRegex.lastIndex === ababMatch.index) {
                     break;
                 }
             }
             
             // 4. Three-character Chinese phrase repetition: 准备好了准备好了
             const chinesePhraseRepeatRegex = /([\u4e00-\u9fa5]{3})\1{1,}/g;
             let phraseMatch;
             while ((phraseMatch = chinesePhraseRepeatRegex.exec(t)) !== null) {
                 repetitionMatches.push(phraseMatch[0]);
                 // Prevent infinite loop by breaking if lastIndex doesn't increase
                 if (chinesePhraseRepeatRegex.lastIndex === phraseMatch.index) {
                     break;
                 }
             }
         } else {
             // English-specific repetition checks
             
             // 1. Word-level repetition with spaces: "the the", "and and"
             const englishWordRepeatRegex = /(\b\w+\b)\s+\1\b/gi;
             let wordMatch;
             while ((wordMatch = englishWordRepeatRegex.exec(t)) !== null) {
                 repetitionMatches.push(wordMatch[0]);
                 // Prevent infinite loop by breaking if lastIndex doesn't increase
                 if (englishWordRepeatRegex.lastIndex === wordMatch.index) {
                     break;
                 }
             }
             
            // 2. Capitalized word repetition: "The the", "Hello hello"（JS 不支持 (?i:\1)，用两组捕获 + 大小写无关比较）
            const englishCapWordRepeatRegex = /(\b[A-Z]\w+)\s+(\w+)\b/g;
            let capMatch;
            while ((capMatch = englishCapWordRepeatRegex.exec(t)) !== null) {
                if (capMatch[1].toLowerCase() === capMatch[2].toLowerCase()) {
                    repetitionMatches.push(capMatch[0]);
                }
                if (englishCapWordRepeatRegex.lastIndex === capMatch.index) {
                    break;
                }
            }
             
             // 3. Short phrase repetition: "in the in the", "on the on the"
             const englishPhraseRepeatRegex = /(\b\w+\s+\w+\b)\s+\1\b/gi;
             let phraseMatch;
             while ((phraseMatch = englishPhraseRepeatRegex.exec(t)) !== null) {
                 repetitionMatches.push(phraseMatch[0]);
                 // Prevent infinite loop by breaking if lastIndex doesn't increase
                 if (englishPhraseRepeatRegex.lastIndex === phraseMatch.index) {
                     break;
                 }
             }
         }
         
         // Remove duplicate matches and add issues
         if (repetitionMatches.length > 0) {
             const uniqueMatches = [...new Set(repetitionMatches)];
             const firstMatch = uniqueMatches[0];
             issues.push({ 
                 id: `qa-repeat-${seg.id}`, 
                 type: 'warning', 
                 category: '重复', 
                 message: `发现重复内容: ${firstMatch}${uniqueMatches.length > 1 ? ' 等' : ''}` 
             });
         }
     }
     if (qaConfig.targetLength) {
         if (t.length > s.length * 2.5) {
             issues.push({ id: `qa-len-${seg.id}`, type: 'warning', category: '长度', message: '译文过长 (>250%)' });
         }
     }
     if (qaConfig.inconsistency) {
         if (t && t.trim()) {
             const others = activeFile.segments.filter(other => 
                 other.id !== seg.id && 
                 other.sourceText === s && 
                 other.targetText && 
                 other.targetText.trim() !== '' &&
                 other.targetText !== t
             );
             if (others.length > 0) {
                 const uniqueOthers = Array.from(new Set(others.map(o => o.targetText)));
                 const example = uniqueOthers[0] as string;
                 const truncated = example.length > 10 ? example.substring(0, 10) + '...' : example;
                 issues.push({ 
                     id: `qa-inc-${seg.id}`, 
                     type: 'warning', 
                     category: '一致性', 
                     message: `译文不一致 (如: ${truncated})` 
                 });
             }
         }
     }
     
     if (qaConfig.sentenceCapitalization) {
         const trimmedTarget = t.trim();
         if (trimmedTarget) {
             const firstChar = trimmedTarget[0];
             if (/[a-z]/.test(firstChar)) {
                 issues.push({ 
                     id: `qa-cap-${seg.id}`, 
                     type: 'warning', 
                     category: '大小写', 
                     message: '译文句首字母应为大写' 
                 });
             }
         }
     }
     
     return issues;
  };

  const handleRunFullQA = () => {
      const updatedSegments = activeFile.segments.map(seg => ({
          ...seg,
          qaIssues: runLocalQAChecks(seg, project.targetLang)
      }));
      onUpdateFileSegments(activeFile.id, updatedSegments);
      setQaReportScope('current'); // 始终显示当前文件的QA结果
      setShowQAPanel(true);
      setShowReplacePanel(false);
      setShowQASettings(false);
  };

  const handleRunDeepAIQA = async () => {
      if (!activeSegmentId) return;
      const loc = findSegmentLocation(activeSegmentId);
      if (!loc) return;
      const { file } = loc;
      const segment = file.segments[loc.segmentIndex];
      if (!segment || !segment.targetText) return;

      setIsDeepQAProcessing(true);
      try {
          const enabledChecks = [];
          if (qaConfig.numberAccuracy) enabledChecks.push("数字一致性");
          if (qaConfig.termMatch) enabledChecks.push("术语准确性");
          enabledChecks.push("语义逻辑", "语气风格"); 

          const aiIssues = await runDeepQACheck(segment.sourceText, segment.targetText, project.targetLang, enabledChecks, aiSettings);
          
          const localIssues = runLocalQAChecks(segment, project.targetLang);
          const allIssues = [...localIssues, ...aiIssues];
          
          const updated = file.segments.map(s => s.id === segment.id ? { ...s, qaIssues: allIssues } : s);
          onUpdateFileSegments(file.id, updated);
          setQaReportScope('current'); // 始终显示当前文件的QA结果
          setShowQAPanel(true);
          setShowReplacePanel(false);
      } finally {
          setIsDeepQAProcessing(false);
      }
  };

  const handleDeleteQAIssue = (segmentId: string, issueId: string) => {
      const updated = activeFile.segments.map(s => {
          if (s.id === segmentId) {
              return { ...s, qaIssues: s.qaIssues?.filter(i => i.id !== issueId) };
          }
          return s;
      });
      onUpdateFileSegments(activeFile.id, updated);
  };

  const handleClearAllQA = () => {
      const updatedSegments = activeFile.segments.map(seg => ({
          ...seg,
          qaIssues: []
      }));
      onUpdateFileSegments(activeFile.id, updatedSegments);
      setShowQAPanel(false);
  };

  const handleExportQA = () => {
      const filesToExport = qaReportScope === 'current' 
          ? [activeFile] 
          : project.files.filter(f => f.segments.some(s => s.qaIssues && s.qaIssues.length > 0));
      
      const issuesData: any[] = [];
      
      filesToExport.forEach(file => {
          file.segments.forEach((segment, idx) => {
              if (segment.qaIssues && segment.qaIssues.length > 0) {
                  segment.qaIssues.forEach(issue => {
                      issuesData.push({
                          FileName: file.name,
                          SegmentID: idx + 1,
                          Source: segment.sourceText,
                          Target: segment.targetText,
                          Type: issue.type,
                          Category: issue.category,
                          Message: issue.message
                      });
                  });
              }
          });
      });
      
      if (issuesData.length === 0) {
          alert("无 QA 问题可导出");
          return;
      }
      
      const worksheet = XLSX.utils.json_to_sheet(issuesData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "QA Report");
      
      const fileName = qaReportScope === 'current' 
          ? `QA_Report_${activeFile.name}.xlsx`
          : `QA_Report_All_Files.xlsx`;
      
      XLSX.writeFile(workbook, fileName);
  };

  const getStatusIcon = (status: SegmentStatus) => {
    switch(status) {
        case SegmentStatus.Confirmed:
        case SegmentStatus.Approved:
            return <Icons.Check className="w-5 h-5 text-green-600" strokeWidth={3} />;
        case SegmentStatus.Proofread:
            return <Icons.ClipboardCheck className="w-4 h-4 text-purple-600" />;
        case SegmentStatus.PreTranslated:
            return <Icons.Zap className="w-4 h-4 text-cyan-600" />;
        case SegmentStatus.Rejected:
            return <Icons.X className="w-4 h-4 text-red-600" />;
        case SegmentStatus.Translated: return <Icons.Edit className="w-4 h-4 text-blue-600" />;
        case SegmentStatus.Draft: return <Icons.Edit className="w-4 h-4 text-orange-400" />; 
        case SegmentStatus.Review: return <Icons.Search className="w-4 h-4 text-purple-500" />;
        default: return <div className="w-2 h-2 rounded-full bg-slate-200" />;
    }
  };

  const getMiddleColumnEffectiveStatus = (seg: Segment): SegmentStatus =>
    segmentIsEffectivelyConfirmed(seg) ? SegmentStatus.Confirmed : seg.status;

  const getMatchLabel = (seg: Segment) => {
    if (seg.matchType === MatchType.Exact) return '100%';
    if (seg.matchType === MatchType.CM) return 'CM';
    if (seg.matchType === MatchType.AI) return 'AI';
    if (seg.matchType === MatchType.MT) return 'MT';
    if (seg.matchType === MatchType.Fuzzy) return `${seg.matchScore}%`;
    return null;
  };

  const comparisonRowProps: ComparisonVirtualRowCtx = {
    filteredSegments,
    project: project as Project,
    reduceMotion: reduceVisualEffects,
    activeSegmentId,
    selectedSegmentIds,
    editingSourceId,
    editorFontSizeMain: editorFontSize.main,
    editorTheme,
    textSearchScope,
    textSearchQuery,
    allTerms,
    activeTargetTextareaRef,
    handleRowClick,
    handleCheckboxClick,
    handleSourceChange,
    handleSplitSourceSegment,
    handleSegmentChange,
    handleApplySourceRunFormat,
    ctrlKeyHeld,
    hasTargetTextSelection,
    confirmSegment,
    toggleSegmentLock,
    handleAiTranslate,
    handleAiPolish,
    isAiProcessing,
    isPolishing,
    handleDismissQA,
    setQaZoomIssue,
    handleEditorTextSelection,
    setTextSelection,
    getMatchLabel,
    getStatusIcon,
    getMiddleColumnEffectiveStatus,
    setEditingSourceId,
    activeRowRef,
  };

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
      if (!activeFile) return { confirmed: 0, total: 0 };
      
      let confirmedWords = 0;
      let totalWords = 0;
      
      activeFile.segments.forEach(segment => {
        const wordCount = getWordCount(segment.sourceText);
        totalWords += wordCount;
        
        if (segmentIsEffectivelyConfirmed(segment)) {
          confirmedWords += wordCount;
        }
      });
      
      // Apply 0.95 coefficient
      return {
        confirmed: Math.round(confirmedWords * 0.95),
        total: Math.round(totalWords * 0.95)
      };
  };

  const wordStats = getWordStats();
  const dueBannerLook = deliveryDueReminder ? deliveryDueBannerLook(deliveryDueReminder.kind) : null;

  return (
    <div className="flex h-full bg-slate-100 overflow-hidden relative">
        <div className="flex-1 flex flex-col min-w-0 relative">
            {deliveryDueReminder && dueBannerLook ? (
                <div
                    role="status"
                    className={`flex shrink-0 items-center gap-2 border-b px-4 py-2 text-sm ${dueBannerLook.bar}`}
                >
                    <Icons.AlertTriangle className={`h-4 w-4 shrink-0 ${dueBannerLook.icon}`} />
                    <span className="font-medium">{deliveryDueReminder.message}</span>
                </div>
            ) : null}
            {/* File Header Toolbar - 包含孪生译员工具栏、排序和筛选 */}
            <div className="h-10 bg-slate-50 border-b border-slate-200 px-4 flex items-center justify-start shrink-0 gap-4 overflow-visible z-30 relative">
                {/* 孪生译员工具栏（限宽避免顶栏横向失衡） */}
                {twinTranslators.length > 0 ? (
                    <div className="min-w-0 max-w-[min(100%,22rem)] sm:max-w-[min(100%,28rem)] lg:max-w-[min(100%,34rem)] shrink">
                            <TwinTranslatorToolbar 
                                sourceText={activeSegment?.sourceText || ''}
                                targetText={activeSegment?.targetText || ''}
                                sourceLang={primaryLanguageCode(project?.sourceLang || 'en-US')}
                                targetLang={primaryLanguageCode(project?.targetLang || 'zh-CN')}
                                twinTranslators={twinTranslators}
                                knowledgeBases={knowledgeBases}
                                projectId={project?.id ?? null}
                                embeddingSettings={embeddingSettings}
                                aiSettings={aiSettings}
                                onSelectTranslation={handleTwinTranslatorSelect}
                                onReceiveVariants={handleTwinTranslatorVariants}
                                onManageTwinTranslators={onNavigateToTwinTranslators}
                                onLearningFeedback={handleTwinTranslatorLearning}
                            />
                    </div>
                ) : (
                    <div className="flex items-center">
                        <div className="flex-shrink-0">
                            <button 
                                className="px-3 py-1.5 bg-blue-50 border border-blue-200 rounded text-xs font-medium text-blue-700 hover:bg-blue-100 hover:border-blue-300 transition-colors flex items-center gap-2"
                                onClick={() => {
                                    // 提示用户创建孪生译员
                                    alert('请先创建孪生译员。您可以通过菜单栏的"AI助手" → "孪生译员"来创建。');
                                }}
                                title="创建孪生译员以使用个性化翻译功能"
                            >
                                <Icons.User className="w-3.5 h-3.5 text-blue-500" />
                                创建孪生译员
                            </button>
                        </div>
                    </div>
                )}
                
                {/* 分隔竖线 */}
                <div className="h-4 w-px bg-slate-300"></div>
                
                {/* 排序和筛选下拉框 */}
                <div className="flex items-center gap-2">
                    {/* 排序下拉框 */}
                    <div className="relative">
                        <div className="flex items-center gap-1 border border-slate-300 rounded px-2 py-1.5 bg-white cursor-pointer hover:border-blue-400 transition-colors">
                            <Icons.Sort className="w-3 h-3 text-slate-500" />
                            <select 
                                className="text-xs bg-transparent text-slate-700 focus:outline-none appearance-none pr-4 cursor-pointer"
                                value={sortMode}
                                onChange={(e) => setSortMode(e.target.value as SortMode)}
                                style={{ backgroundImage: 'none' }}
                            >
                                <option value="natural">自然顺序 (ID)</option>
                                <option value="sourceAsc">原文 A-Z</option>
                                <option value="sourceDesc">原文 Z-A</option>
                                <option value="lengthAsc">原文长度 (短-长)</option>
                                <option value="lengthDesc">原文长度 (长-短)</option>
                                <option value="status">句段状态 (Status)</option>
                                <option value="matchDesc">匹配率 (高→低)</option>
                                <option value="matchAsc">匹配率 (低→高)</option>
                            </select>
                            <Icons.ChevronDown className="w-2.5 h-2.5 text-slate-400 absolute right-2 pointer-events-none"/>
                        </div>
                    </div>
                    
                    {/* 状态筛选下拉框 */}
                    <select 
                        className="text-xs border border-slate-300 rounded px-2 py-1.5 bg-white text-slate-700 focus:ring-2 focus:ring-blue-500/20 outline-none"
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                    >
                        <option value="All">显示全部</option>
                        <option value="NotStarted">未开始</option>
                        <option value="Draft">草稿</option>
                        <option value="Translated">已翻译</option>
                        <option value="Translated+Draft">已翻译 + 草稿</option>
                        <option value="Confirmed">已确认</option>
                        <option value="Unconfirmed">未确认</option>
                        <option value="Locked">锁定</option>
                        <option value="Unlocked">已解锁</option>
                        <option value="Unlocked+Unconfirmed">已解锁+未确认</option>
                        <option value="ExactMatch">100%匹配句段</option>
                        <option value="FuzzyMatch">模糊匹配句段</option>
                        <option value="AITranslation">AI译文</option>
                        <option value="HasQAIssues">有 QA 问题</option>
                    </select>
                </div>

                <div className="flex-1 min-w-2" />

                <div
                    className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5 shrink-0"
                    title="单句模式：仅显示当前句；对照模式：列表显示全部句段。Alt+↑/↓ 切换句段；Ctrl+Home 跳到筛选后列表首句（焦点不在输入框/下拉框时；macOS 为 Cmd+Home）"
                >
                    <button
                        type="button"
                        onClick={() => onUpdateEditorLayoutMode('comparison')}
                        className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                            editorLayoutMode === 'comparison'
                                ? 'bg-blue-600 text-white shadow-sm'
                                : 'text-slate-600 hover:bg-slate-50'
                        }`}
                    >
                        对照
                    </button>
                    <button
                        type="button"
                        onClick={() => onUpdateEditorLayoutMode('focus')}
                        className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                            editorLayoutMode === 'focus'
                                ? 'bg-blue-600 text-white shadow-sm'
                                : 'text-slate-600 hover:bg-slate-50'
                        }`}
                    >
                        单句
                    </button>
                </div>
            </div>
            
            {/* Top Toolbar */}
            <div className="h-14 bg-white border-b border-slate-200 px-4 flex items-center justify-between shrink-0 z-20 relative">
               <div className="flex items-center gap-4">
                   <div className="flex items-center gap-2">
                        <div className="h-4 w-px bg-slate-300 mx-1"></div>
                        
                        {/* New Search Toolbar */}
                        <div className="relative flex items-center bg-slate-100 rounded-md border border-slate-200 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-500/10 transition-all">
                             <div className="relative">
                                <select 
                                    className="appearance-none bg-transparent pl-2 pr-6 py-1.5 text-xs font-medium text-slate-600 outline-none cursor-pointer hover:text-blue-600"
                                    value={textSearchScope}
                                    onChange={(e) => setTextSearchScope(e.target.value as 'file' | 'project')}
                                >
                                    <option value="file">当前文件</option>
                                    <option value="project">跨文件</option>
                                </select>
                                <Icons.ChevronDown className="w-3 h-3 text-slate-400 absolute right-1 top-2 pointer-events-none"/>
                             </div>
                             <div className="w-px h-4 bg-slate-300 mx-1"></div>
                             <div className="relative">
                                <select 
                                    className="appearance-none bg-transparent pl-2 pr-6 py-1.5 text-xs font-medium text-slate-600 outline-none cursor-pointer hover:text-blue-600"
                                    value={textSearchMode}
                                    onChange={(e) => setTextSearchMode(e.target.value as 'source' | 'target')}
                                >
                                    <option value="source">原文</option>
                                    <option value="target">译文</option>
                                </select>
                                <Icons.ChevronDown className="w-3 h-3 text-slate-400 absolute right-1 top-2 pointer-events-none"/>
                             </div>
                             <div className="w-px h-4 bg-slate-300 mx-1"></div>
                             <input 
                                ref={textSearchInputRef}
                                type="text" 
                                placeholder="搜索句段… (Enter)"
                                className="bg-transparent border-none outline-none text-xs w-44 px-1 py-1.5 text-slate-700 placeholder-slate-400"
                                value={textSearchDraft}
                                onChange={(e) => setTextSearchDraft(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        applyTextSearch();
                                    } else if (e.key === 'Escape') {
                                        e.preventDefault();
                                        clearTextSearch();
                                    }
                                }}
                             />
                             {(textSearchDraft || textSearchQuery) && (
                                 <button
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={clearTextSearch}
                                    className="p-1 hover:bg-slate-200 rounded-full mr-1"
                                    title="清除搜索"
                                 >
                                     <Icons.X className="w-3 h-3 text-slate-400"/>
                                 </button>
                             )}
                        </div>

                        {/* Find and Replace Trigger */}
                        <button 
                            onClick={() => setIsReplaceModalOpen(true)}
                            className="flex items-center gap-1 px-2 py-1.5 text-slate-500 hover:text-blue-600 hover:bg-slate-50 rounded-md transition-colors"
                            title="查找与替换 (仅译文)"
                        >
                            <Icons.Translate className="w-4 h-4" />
                        </button>
                        
                        {/* Jump to Segment */}
                        <div className="relative">
                            <button 
                                onClick={() => setShowJumpInput(!showJumpInput)}
                                className={`p-1.5 rounded-md transition-colors ${showJumpInput ? 'bg-slate-100 text-slate-700' : 'text-slate-500 hover:text-blue-600 hover:bg-slate-50'}`}
                                title="跳转至句段"
                            >
                                <Icons.Jump className="w-4 h-4" />
                            </button>
                            
                            {showJumpInput && (
                                <form 
                                    onSubmit={handleJumpToSegment}
                                    className="absolute top-full left-0 mt-2 bg-white border border-slate-200 shadow-xl rounded-lg p-2 flex items-center gap-1 z-50 animate-in fade-in slide-in-from-top-1"
                                >
                                    <span className="text-xs text-slate-400 font-mono">#</span>
                                    <input 
                                        ref={jumpInputRef}
                                        type="number" 
                                        className="w-16 px-2 py-1 text-xs border border-slate-200 rounded outline-none focus:border-blue-400"
                                        value={jumpInput}
                                        onChange={(e) => setJumpInput(e.target.value)}
                                        onKeyDown={(e) => {
                                            if(e.key === 'Escape') setShowJumpInput(false);
                                        }}
                                    />
                                    <button type="submit" className="p-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100">
                                        <Icons.ChevronRight className="w-3 h-3" />
                                    </button>
                                </form>
                            )}
                        </div>

                        <div className="h-4 w-px bg-slate-300 mx-2"/>
                        
                        {/* NEW BUTTON: Copy Source */}
                        <button 
                            onClick={handleCopySourceToTarget}
                            disabled={!activeSegmentId || activeSegment?.isLocked}
                            className="p-2 bg-slate-50 text-slate-600 hover:bg-slate-100 rounded-md transition-colors shadow-sm border border-slate-200 disabled:opacity-50"
                            title="复制原文到译文 (Copy Source)"
                        >
                            <Icons.Copy className="w-4 h-4" />
                        </button>
                        
                        <div className="h-4 w-px bg-slate-300 mx-1"/>

                        {/* Batch Pre-Translate Button */}
                        <button 
                            onClick={handleOpenBatchModal}
                            className="p-2 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-md transition-colors shadow-sm"
                            title="一键预翻译 (Batch Pre-translate)"
                        >
                            <Icons.Zap className="w-4 h-4" />
                        </button>
                        <button
                            onClick={handleRunProofreadBatch}
                            className="p-2 bg-purple-50 text-purple-600 hover:bg-purple-100 rounded-md transition-colors shadow-sm"
                            title="批量 AI 校对 (Batch Proofread)"
                        >
                            <Icons.ClipboardCheck className="w-4 h-4" />
                        </button>
                        
                        {/* Smart Term Extraction Button */}
                         <button 
                            onClick={() => { setIsExtractModalOpen(true); setExtractStep('config'); }}
                            disabled={!mainTB}
                            className="p-2 bg-teal-50 text-teal-600 hover:bg-teal-100 rounded-md transition-colors disabled:opacity-50"
                            title={!mainTB ? "请先配置主术语库 (Main TB)" : "智能术语提取 (Smart Extraction)"}
                        >
                            <Icons.TermExtraction className="w-4 h-4" />
                        </button>

                        <div className="h-4 w-px bg-slate-300 mx-1"/>

                        <button 
                            onClick={handleRunFullQA} 
                            className="p-2 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-md transition-colors"
                            title="本地 QA 检查 (Local QA)"
                        >
                            <Icons.QA className="w-4 h-4" />
                        </button>

                        <button 
                            onClick={handleRunDeepAIQA}
                            disabled={!activeSegmentId || isDeepQAProcessing} 
                            className="p-2 bg-purple-50 text-purple-600 hover:bg-purple-100 rounded-md transition-colors disabled:opacity-50"
                            title="AI 深度质检 (Deep AI QA)"
                        >
                            <Icons.BrainCircuit className={`w-4 h-4 ${isDeepQAProcessing ? 'animate-spin' : ''}`} />
                        </button>
                        
                        {/* Clear All QA Issues Button */}
                        <button 
                            onClick={handleClearAllQA}
                            className="p-2 bg-red-50 text-red-600 hover:bg-red-100 rounded-md transition-colors"
                            title="清除所有 QA 标签"
                        >
                            <Icons.Trash className="w-4 h-4" />
                        </button>
                        
                        {/* QA Settings Button */}
                        <div className="relative">
                            <button 
                                onClick={() => setShowQASettings(!showQASettings)}
                                className={`p-1.5 rounded-md transition-colors ${showQASettings ? 'bg-slate-100 text-slate-700' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}
                                title="QA 设置"
                            >
                                <Icons.Settings className="w-4 h-4" />
                            </button>
                            {showQASettings && (
                                <div className="absolute top-full left-0 mt-2 w-56 bg-white rounded-xl shadow-xl border border-slate-200 p-4 z-50 animate-in fade-in slide-in-from-top-2">
                                    <div className="flex justify-between items-center mb-3">
                                        <h4 className="text-xs font-bold text-slate-900 uppercase">检查配置</h4>
                                        <button onClick={() => setShowQASettings(false)}><Icons.X className="w-3 h-3 text-slate-400"/></button>
                                    </div>
                                    <div className="space-y-2.5">
                                        {[
                                            { key: 'numberAccuracy', label: '数字准确性' },
                                            { key: 'termMatch', label: '术语一致性' },
                                            { key: 'punctuationPair', label: '标点配对' },
                                            { key: 'untranslated', label: '未翻译 (漏译)' },
                                            { key: 'sourceTargetSame', label: '原文和译文相同' },
                                            { key: 'repeatedWords', label: '重复词/短语' },
                                            { key: 'sentenceCapitalization', label: '译文句首大写' },
                                            { key: 'targetLength', label: '译文长度预警' },
                                            { key: 'inconsistency', label: '译文不一致' },
                                        ].map(item => (
                                            <label key={item.key} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer hover:bg-slate-50 p-1 -mx-1 rounded">
                                                <input 
                                                    type="checkbox"
                                                    checked={(qaConfig as any)[item.key]}
                                                    onChange={(e) => setQaConfig(prev => ({ ...prev, [item.key]: e.target.checked }))}
                                                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                                                />
                                                <span>{item.label}</span>
                                            </label>
                                        ))}
                                        <div className="pt-2 border-t border-slate-200 mt-2">
                                            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer hover:bg-slate-50 p-1 -mx-1 rounded">
                                                <input 
                                                    type="checkbox"
                                                    checked={qaConfig.ignoreCase}
                                                    onChange={(e) => setQaConfig(prev => ({ ...prev, ignoreCase: e.target.checked }))}
                                                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                                                />
                                                <span>术语检查忽略大小写</span>
                                            </label>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <button 
                            onClick={() => setIsSettingsModalOpen(true)}
                            className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-1"
                            title="编辑器外观与偏好"
                        >
                            <Icons.Wrench className="w-4 h-4"/>
                        </button>

                        <div className="h-4 w-px bg-slate-300 mx-1"/>

                        <button
                            type="button"
                            onClick={() => handleApplyTargetBasicStyle('bold')}
                            disabled={!activeSegmentId || activeSegment?.isLocked}
                            className="min-w-[2rem] px-2 py-2 bg-slate-50 text-slate-700 hover:bg-slate-100 rounded-md transition-colors shadow-sm border border-slate-200 disabled:opacity-40 disabled:cursor-not-allowed font-bold text-sm leading-none"
                            title="加粗：选中译文文字后应用/取消加粗（保留 Word 导出格式）"
                        >
                            B
                        </button>
                        <button
                            type="button"
                            onClick={() => handleApplyTargetBasicStyle('italic')}
                            disabled={!activeSegmentId || activeSegment?.isLocked}
                            className="min-w-[2rem] px-2 py-2 bg-slate-50 text-slate-700 hover:bg-slate-100 rounded-md transition-colors shadow-sm border border-slate-200 disabled:opacity-40 disabled:cursor-not-allowed italic text-sm leading-none"
                            title="斜体：选中译文文字后应用/取消斜体（保留 Word 导出格式）"
                        >
                            I
                        </button>
                        <button
                            type="button"
                            onClick={() => handleApplyTargetBasicStyle('underline')}
                            disabled={!activeSegmentId || activeSegment?.isLocked}
                            className="min-w-[2rem] px-2 py-2 bg-slate-50 text-slate-700 hover:bg-slate-100 rounded-md transition-colors shadow-sm border border-slate-200 disabled:opacity-40 disabled:cursor-not-allowed underline text-sm leading-none"
                            title="下划线：选中译文文字后应用/取消下划线（保留 Word 导出格式）"
                        >
                            U
                        </button>

                        <button
                            type="button"
                            onClick={handleApplyTargetSuperscript}
                            disabled={!activeSegmentId || activeSegment?.isLocked}
                            className="p-2 bg-slate-50 text-slate-600 hover:bg-slate-100 rounded-md transition-colors shadow-sm border border-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
                            title="上标：选中译文中的字符（如指数、角标），转为 Unicode 上标（导出 Excel 保留）"
                        >
                            <Icons.Superscript className="w-4 h-4" />
                        </button>
                        <button
                            type="button"
                            onClick={handleApplyTargetSubscript}
                            disabled={!activeSegmentId || activeSegment?.isLocked}
                            className="p-2 bg-slate-50 text-slate-600 hover:bg-slate-100 rounded-md transition-colors shadow-sm border border-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
                            title="下标：选中译文中的字符，转为 Unicode 下标（导出 Excel 保留）"
                        >
                            <Icons.Subscript className="w-4 h-4" />
                        </button>
                        <button
                            type="button"
                            onClick={handleClearTargetFormatting}
                            disabled={!activeSegmentId || activeSegment?.isLocked}
                            className="p-2 bg-slate-50 text-slate-600 hover:bg-slate-100 rounded-md transition-colors shadow-sm border border-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
                            title="清除译文格式：有选区则清除译文选区内的所有格式；无选区则清除整句译文（不影响原文）"
                        >
                            <Icons.Eraser className="w-4 h-4" />
                        </button>

                        <div className="h-4 w-px bg-slate-300 mx-1" />

                        <div ref={quickSymbolMenuRef} className="relative shrink-0">
                            <button
                                type="button"
                                onClick={() => setShowQuickSymbolMenu((o) => !o)}
                                className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 rounded-md border border-slate-200 shadow-sm"
                                title="下拉选择符号插入译文；底部可新增自定义符号（与术语插入相同：有选区则替换选区）"
                            >
                                <span>常用符号</span>
                                <Icons.ChevronDown
                                    className={`w-3.5 h-3.5 text-slate-500 transition-transform shrink-0 ${showQuickSymbolMenu ? 'rotate-180' : ''}`}
                                />
                            </button>
                            {showQuickSymbolMenu && (
                                <div className="absolute right-0 top-full mt-1 z-[60] w-64 max-h-80 flex flex-col rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-1">
                                    <div className="overflow-y-auto flex-1 min-h-0 max-h-52 py-1 border-b border-slate-100">
                                        {editorQuickSymbols.map((sym) => (
                                            <div
                                                key={sym.id}
                                                className="flex items-stretch border-b border-slate-50 last:border-b-0 group"
                                            >
                                                <button
                                                    type="button"
                                                    disabled={!activeSegmentId || activeSegment?.isLocked}
                                                    onClick={() => {
                                                        if (!activeSegmentId || activeSegment?.isLocked) return;
                                                        handleInsertTerm(sym.char);
                                                        setShowQuickSymbolMenu(false);
                                                    }}
                                                    className="flex-1 min-w-0 flex flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-violet-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                                                    title={
                                                        sym.label
                                                            ? `${sym.label} — 插入「${sym.char}」`
                                                            : `插入「${sym.char}」`
                                                    }
                                                >
                                                    <span className="font-sans text-base leading-none text-slate-900">
                                                        {sym.char}
                                                    </span>
                                                    {sym.label ? (
                                                        <span className="text-[11px] text-slate-500 leading-snug line-clamp-2">
                                                            {sym.label}
                                                        </span>
                                                    ) : null}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleRemoveEditorQuickSymbol(sym.id)}
                                                    className="shrink-0 px-2 text-slate-400 hover:text-red-600 hover:bg-red-50 opacity-70 group-hover:opacity-100"
                                                    title="从列表中删除"
                                                >
                                                    <Icons.X className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="p-2 flex gap-1.5 items-center shrink-0 bg-slate-50/80">
                                        <input
                                            type="text"
                                            value={quickSymbolNewInput}
                                            onChange={(e) =>
                                                setQuickSymbolNewInput(
                                                    e.target.value.slice(0, EDITOR_QUICK_SYMBOL_CHAR_MAX)
                                                )
                                            }
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    handleAddEditorQuickSymbol();
                                                }
                                            }}
                                            placeholder="输入符号或短语…"
                                            className="flex-1 min-w-0 px-2 py-1.5 text-xs border border-slate-200 rounded-md bg-white text-slate-800 outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
                                        />
                                        <button
                                            type="button"
                                            onClick={handleAddEditorQuickSymbol}
                                            disabled={
                                                !quickSymbolNewInput.trim() ||
                                                editorQuickSymbols.length >= EDITOR_QUICK_SYMBOL_LIST_MAX
                                            }
                                            className="shrink-0 px-2.5 py-1.5 text-xs font-medium text-white bg-violet-600 rounded-md hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                            添加
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                   </div>
               </div>
               
               <div className="flex items-center gap-2">
                    

                    

               </div>
            </div>

            {/* Segment Grid */}
            <div
                ref={segmentContainerRef}
                className={`flex-1 bg-slate-50 pb-4 relative ${
                  editorLayoutMode === 'comparison'
                    ? 'flex flex-col min-h-0 overflow-hidden'
                    : 'overflow-y-auto'
                }`}
            >
                {filteredSegments.length > 0 ? (
                    <>
                        {editorLayoutMode === 'focus' && (
                            <div
                                className={`sticky top-0 z-20 flex items-center justify-center gap-3 py-2 px-4 border-b border-slate-200 ${
                                  reduceVisualEffects
                                    ? 'bg-slate-100'
                                    : 'bg-slate-100/95 backdrop-blur-sm'
                                }`}
                            >
                                <button
                                    type="button"
                                    onClick={goToPrevFilteredSegment}
                                    disabled={focusResolved.indexInFiltered <= 0}
                                    className="p-2 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                                    title="上一句（Alt+↑）"
                                >
                                    <Icons.ChevronLeft className="w-4 h-4" />
                                </button>
                                <span className="text-xs font-mono text-slate-600 tabular-nums min-w-[4.5rem] text-center">
                                    {focusResolved.indexInFiltered + 1} / {filteredSegments.length}
                                </span>
                                <button
                                    type="button"
                                    onClick={goToNextFilteredSegment}
                                    disabled={focusResolved.indexInFiltered >= filteredSegments.length - 1}
                                    className="p-2 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                                    title="下一句（Alt+↓）"
                                >
                                    <Icons.ChevronRight className="w-4 h-4" />
                                </button>
                            </div>
                        )}
                        {editorLayoutMode === 'comparison' ? (
                          <div
                            ref={comparisonListViewportRef}
                            className="flex-1 min-h-0 w-full min-h-[160px]"
                          >
                            {comparisonListSize.height > 0 ? (
                              <List
                                listRef={comparisonListRef}
                                rowHeight={dynamicRowHeight}
                                rowCount={filteredSegments.length}
                                rowComponent={ComparisonVirtualRow}
                                rowProps={comparisonRowProps}
                                onRowsRendered={onComparisonRowsRendered}
                                overscanCount={reduceVisualEffects ? 2 : 5}
                                style={{
                                  height: comparisonListSize.height,
                                  width: comparisonListSize.width || '100%',
                                  paddingBottom: COMPARISON_LIST_BOTTOM_PADDING_PX,
                                  boxSizing: 'border-box',
                                }}
                              />
                            ) : null}
                          </div>
                        ) : (
                        (focusResolved.seg ? [focusResolved.seg] : []).map((seg) => {
                            const isActive = seg.id === activeSegmentId;
                            const isSelected = selectedSegmentIds.has(seg.id);
                            const matchLabel = getMatchLabel(seg);
                            const displayFile = project.files.find(f => f.segments.some(s => s.id === seg.id));
                            const displayIndex = displayFile ? (displayFile.segments.findIndex(s => s.id === seg.id) + 1) : 0;
                            const locationLabel = displayFile ? `${displayFile.name} · #${displayIndex}` : '';
                            const showSourceLocationCaption =
                                textSearchScope === 'project' && Boolean(textSearchQuery.trim()) && Boolean(locationLabel);
                            const rowMinH = 'min-h-[min(70vh,28rem)]';
                            const formatPickActive =
                              isActive &&
                              ctrlKeyHeld &&
                              hasTargetTextSelection &&
                              segmentHasCopyableSourceFormat(seg.sourceText, seg.inlineRunMeta);

                            return (
                                    <div
                                        key={seg.id}
                                        ref={isActive ? activeRowRef : null}
                                        onClick={(e) => handleRowClick(e, seg.id)}
                                        className={`group flex flex-col ${rowMinH} border-b border-slate-200 transition-all duration-75 scroll-mt-20 select-none bg-white
                                            ${isActive ? 'ring-2 ring-blue-500 relative z-10 shadow-lg' : 'hover:bg-slate-50/80'}
                                            ${isSelected && !isActive ? 'bg-blue-50/80 border-blue-200' : ''}
                                        `}
                                    >
                                        <div className="flex items-center gap-3 px-3 py-2 border-b border-slate-200 bg-slate-50 shrink-0">
                                            <div
                                                className={`flex items-center justify-center gap-1 min-w-[3rem] shrink-0 text-xs font-mono cursor-pointer rounded px-1 py-1 transition-colors
                                                    ${isSelected ? 'bg-blue-100 text-blue-700 font-bold' : 'bg-slate-100/80 text-slate-400 group-hover:bg-slate-100'}`}
                                                onClick={(e) => handleCheckboxClick(e, seg.id)}
                                            >
                                                <span className={`tabular-nums ${isSelected ? 'hidden' : 'group-hover:hidden'}`}>#{displayIndex}</span>
                                                <div className={`${isSelected ? 'flex' : 'hidden group-hover:flex'} items-center justify-center`}>
                                                    <div
                                                        className={`w-4 h-4 rounded border flex items-center justify-center ${isSelected ? 'bg-blue-600 border-blue-600' : 'bg-white border-slate-300'}`}
                                                    >
                                                        {isSelected && <Icons.Check className="w-3 h-3 text-white" />}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 flex-wrap ml-auto text-xs">
                                                {matchLabel && (
                                                    <span className="text-[10px] font-bold text-slate-600 bg-white px-1.5 py-0.5 rounded border border-slate-200">
                                                        {matchLabel}
                                                    </span>
                                                )}
                                                <span className="text-slate-400" title={getMiddleColumnEffectiveStatus(seg)}>
                                                    {getStatusIcon(getMiddleColumnEffectiveStatus(seg))}
                                                </span>
                                                {seg.isLocked && <Icons.Lock className="w-3.5 h-3.5 text-slate-400" />}
                                            </div>
                                        </div>

                                        <div className="flex flex-col flex-1 min-h-0">
                                            <div className="px-3 pt-2 pb-1 text-[10px] font-bold text-slate-400 uppercase tracking-wide shrink-0 bg-slate-50/50 border-b border-slate-100">
                                                原文
                                            </div>
                                            <SegmentSourceEditor
                                                segment={seg}
                                                layoutVariant="stacked"
                                                isEditing={editingSourceId === seg.id}
                                                onEditStart={() => setEditingSourceId(seg.id)}
                                                onEditEnd={() => setEditingSourceId(null)}
                                                onSourceChange={handleSourceChange}
                                                onSplitSource={
                                                    seg.isLocked ? undefined : handleSplitSourceSegment
                                                }
                                                editorFontSize={editorFontSize.main}
                                                editorTheme={editorTheme}
                                                onSelectSource={(text) => handleEditorTextSelection(text, 'source')}
                                                allTerms={allTerms}
                                                locationCaption={showSourceLocationCaption ? locationLabel : undefined}
                                                formatPickActive={formatPickActive}
                                                onSourceRunFormatPick={
                                                  formatPickActive
                                                    ? (runId, style) =>
                                                        handleApplySourceRunFormat(seg, runId, style)
                                                    : undefined
                                                }
                                            />
                                            <div className="px-3 pt-2 pb-1 text-[10px] font-bold text-slate-400 uppercase tracking-wide shrink-0 bg-slate-50/50 border-b border-slate-100">
                                                译文
                                            </div>
                                            <SegmentTargetEditor
                                                ref={isActive ? activeTargetTextareaRef : undefined}
                                                segment={seg}
                                                layoutVariant="stacked"
                                                isActive={isActive}
                                                onChange={handleSegmentChange}
                                                onConfirm={confirmSegment}
                                                onLockToggle={toggleSegmentLock}
                                                onAiTranslate={handleAiTranslate}
                                                onAiPolish={handleAiPolish}
                                                isAiProcessing={isAiProcessing}
                                                isPolishing={isPolishing}
                                                editorTheme={editorTheme}
                                                editorFontSize={editorFontSize.main}
                                                onSelectionChange={(start, end) => setTextSelection({ start, end })}
                                                onDismissQA={(issueId) => handleDismissQA(seg.id, issueId)}
                                                onZoomQA={setQaZoomIssue}
                                                onSelectTarget={(text) => handleEditorTextSelection(text, 'target')}
                                            />
                                        </div>
                                    </div>
                                );
                        })
                        )}
                    </>
                ) : (
                    <div className="flex flex-col items-center justify-center py-20 text-slate-400 opacity-50">
                        <Icons.Search className="w-12 h-12 mb-2" />
                        <p>未找到匹配的句段</p>
                    </div>
                )}
            </div>

            {/* Batch Action Bar (Floating) */}
            {selectedSegmentIds.size > 1 && (
                <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4 fade-in duration-300">
                    <div className="bg-slate-900 text-white rounded-full shadow-2xl px-6 py-3 flex flex-nowrap items-center gap-6 border border-slate-700 w-max max-w-[calc(100vw-2rem)]">
                        <div className="flex shrink-0 items-center gap-2 border-r border-slate-700 pr-4">
                            <span className="bg-blue-600 text-[10px] font-bold px-2 py-0.5 rounded-full">
                                {selectedSegmentIds.size}
                            </span>
                            <span className="text-sm font-medium whitespace-nowrap">已选择</span>
                        </div>

                        <button
                            type="button"
                            onClick={handleMergeSelectedSegments}
                            className="shrink-0 p-2 hover:bg-slate-800 rounded-lg transition-colors flex flex-col items-center gap-0.5 group"
                            title="合并为一句"
                        >
                            <Icons.Merge className="w-4 h-4 text-cyan-400 group-hover:scale-110 transition-transform" />
                            <span className="text-[9px] text-slate-400 whitespace-nowrap">合并句段</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => void handleBatchTranslateSelection()}
                            disabled={isSelectionBatchTranslating || isAiProcessing}
                            className="shrink-0 p-2 hover:bg-slate-800 rounded-lg transition-colors flex flex-col items-center gap-0.5 group disabled:opacity-40 disabled:pointer-events-none"
                            title="对选中未锁定句段执行 AI 翻译（先应用已挂载正则/规则词典）"
                        >
                            <Icons.Sparkles
                                className={`w-4 h-4 text-purple-400 group-hover:scale-110 transition-transform ${isSelectionBatchTranslating ? 'animate-spin' : ''}`}
                            />
                            <span className="text-[9px] text-slate-400 whitespace-nowrap">批量翻译</span>
                        </button>

                        <div className="flex shrink-0 flex-nowrap items-center gap-2">
                             <button onClick={() => handleBatchOperation('confirm')} className="shrink-0 p-2 hover:bg-slate-800 rounded-lg transition-colors flex flex-col items-center gap-0.5 group" title="批量确认">
                                 <Icons.Check className="w-4 h-4 text-green-500 group-hover:scale-110 transition-transform"/>
                                 <span className="text-[9px] text-slate-400 whitespace-nowrap">确认句段</span>
                             </button>
                             <button onClick={() => handleBatchOperation('lock')} className="shrink-0 p-2 hover:bg-slate-800 rounded-lg transition-colors flex flex-col items-center gap-0.5 group" title="批量锁定">
                                 <Icons.Lock className="w-4 h-4 text-amber-500 group-hover:scale-110 transition-transform"/>
                                 <span className="text-[9px] text-slate-400 whitespace-nowrap">锁定句段</span>
                             </button>
                             <button onClick={() => handleBatchOperation('unlock')} className="shrink-0 p-2 hover:bg-slate-800 rounded-lg transition-colors flex flex-col items-center gap-0.5 group" title="批量解锁">
                                <Icons.Unlock className="w-4 h-4 text-emerald-500 group-hover:scale-110 transition-transform"/>
                                <span className="text-[9px] text-slate-400 whitespace-nowrap">解锁句段</span>
                             </button>
                             <button onClick={() => handleBatchOperation('copySource')} className="shrink-0 p-2 hover:bg-slate-800 rounded-lg transition-colors flex flex-col items-center gap-0.5 group" title="复制原文">
                                 <Icons.Download className="w-4 h-4 text-blue-400 group-hover:scale-110 transition-transform"/>
                                 <span className="text-[9px] text-slate-400 whitespace-nowrap">复制原文</span>
                             </button>
                             <button onClick={() => handleBatchOperation('clear')} className="shrink-0 p-2 hover:bg-slate-800 rounded-lg transition-colors flex flex-col items-center gap-0.5 group" title="清空译文">
                                 <Icons.X className="w-4 h-4 text-red-400 group-hover:scale-110 transition-transform"/>
                                 <span className="text-[9px] text-slate-400 whitespace-nowrap">清除译文</span>
                             </button>
                             <div className="w-px h-8 bg-slate-700 mx-1 shrink-0"/>
                            <button onClick={() => { setSelectedSegmentIds(new Set()); setLastInteractedId(null); }} className="shrink-0 whitespace-nowrap text-slate-500 hover:text-white text-xs font-medium px-2">
                                关闭
                             </button>
                        </div>
                    </div>
                </div>
            )}

            <EditorDictionaryPanel
              open={dictPanelOpen}
              collapsed={dictPanelCollapsed}
              onCollapsedChange={setDictPanelCollapsed}
              onClose={() => setDictPanelOpen(false)}
              query={dictQuery}
              providerId={dictProviderId}
              onProviderChange={setDictProviderId}
              autoLookupEnabled={dictAutoLookup}
              onAutoLookupEnabledChange={(enabled) => {
                setDictAutoLookup(enabled);
                writeDictionaryAutoLookupEnabled(enabled);
              }}
              customDictionaries={customOnlineDictionaries}
              bottomTab={bottomPanelTab}
              onBottomTabChange={(tab) => {
                setBottomPanelTab(tab);
                if (tab === 'mt') {
                  const q = resolveSegmentSourceQuery();
                  setDictQuery(q);
                  if (q) void runMtReferenceLookup(q);
                }
              }}
              mtReferenceEnabled={mtReferenceSettings.enabled}
              mtTranslators={mtTranslatorOptions}
              mtTranslatorId={mtTranslatorId}
              onMtTranslatorChange={setMtTranslatorId}
              mtAutoLookup={mtReferenceSettings.autoLookupOnSegmentChange}
              onMtAutoLookupChange={(enabled) =>
                onUpdateMtReferenceSettings?.({
                  ...mtReferenceSettings,
                  autoLookupOnSegmentChange: enabled,
                })
              }
              mtLoading={mtLoading}
              mtError={mtError}
              mtResult={mtResult}
              mtElapsedMs={mtElapsedMs}
              onOpenMtCompareModal={() => {
                const q = resolveSegmentSourceQuery();
                openMtCompareModalWithQuery(q);
              }}
              mtTagWarning={segmentMayHaveInlineTags(
                activeSegment?.sourceText || dictQuery
              )}
              mtLangPair={
                project ? `${project.sourceLang} → ${project.targetLang}` : ''
              }
              onMtRefresh={() => void runMtReferenceLookup()}
              onMtCopy={handleCopyMtReference}
              onMtInsert={handleInsertMtReference}
            />
        </div>

        {/* Right Sidebar: Resources & Tools (Resizable) */}
        <div 
            className="bg-white border-l border-slate-200 flex flex-col shadow-[0_0_15px_rgba(0,0,0,0.05)] z-20 relative"
            style={{ width: `${sidebarWidth}px` }}
        >
            {/* Drag Handle */}
            <div 
                className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 hover:w-1.5 transition-all z-50 bg-transparent"
                onMouseDown={() => setIsResizing(true)}
            />

            {activeSegment ? (
                <>
                    <div className="flex-1 flex flex-col border-b border-slate-100 overflow-hidden" style={{ height: `calc(100% - ${aiPanelHeight}% - 8px)` }}>
                        {/* Translation Memory Tabs (Trados Style) */}
                        <div className="flex border-b border-slate-200">
                             <button 
                                onClick={() => setActiveSidebarTab('matches')}
                                className={`flex-1 py-2.5 text-xs font-bold uppercase transition-colors flex items-center justify-center gap-1.5 ${activeSidebarTab === 'matches' ? 'bg-white text-blue-600 border-b-2 border-blue-500' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}
                             >
                                 <Icons.Database className="w-3.5 h-3.5" />
                                 匹配
                             </button>
                             <button 
                                onClick={() => setActiveSidebarTab('terms')}
                                className={`flex-1 py-2.5 text-xs font-bold uppercase transition-colors flex items-center justify-center gap-1.5 ${activeSidebarTab === 'terms' ? 'bg-white text-blue-600 border-b-2 border-blue-500' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}
                             >
                                 <Icons.TermBase className="w-3.5 h-3.5" />
                                 术语
                             </button>
                             <button 
                                onClick={() => setActiveSidebarTab('concordance')}
                                className={`flex-1 py-2.5 text-xs font-bold uppercase transition-colors flex items-center justify-center gap-1.5 ${activeSidebarTab === 'concordance' ? 'bg-white text-blue-600 border-b-2 border-blue-500' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}
                             >
                                 <Icons.Concordance className="w-3.5 h-3.5" />
                                 搜索(F3)
                             </button>
                        </div>

                        {activeSidebarTab === 'matches' && (
                            /* --- Match Mode View --- */
                            <div className="flex-1 flex flex-col min-h-0">
                                <div className="px-4 pt-4 pb-2 border-b border-slate-50 shrink-0">
                                    <div className="flex items-center gap-2 mb-2">
                                        <span className="text-xs text-slate-500">
                                            当前句匹配结果: <b>{tmMatches.length}</b> 条
                                        </span>
                                    </div>
                                    {tmMatches.length > 0 ? (
                                        <div className="space-y-2 max-h-[calc(100vh-250px)] overflow-y-auto pr-1" style={{ fontSize: `${editorFontSize.tm}px` }}>
                                            {tmMatches.map((tm, idx) => {
                                                const matchKey = `${tm.id}-${idx}`;
                                                const isFirstMatch = idx === 0;
                                                const collapsed = isMatchCollapsed(matchKey);
                                                const expanded = isFirstMatch ? !collapsed : collapsed;
                                                
                                                return (
                                                    <div 
                                                        key={matchKey} 
                                                        className="bg-slate-50 p-2 rounded border border-slate-100 cursor-pointer hover:bg-blue-50 group transition-colors relative" 
                                                        onClick={() => !activeSegment.isLocked && handleSegmentChange(activeSegment.id, tm.target)}
                                                    >
                                                        <div className="text-slate-500 mb-1 leading-relaxed">
                                                            <div className={expanded ? '' : 'line-clamp-2'}>
                                                                <DiffViewer currentSource={activeSegment.sourceText} tmSource={tm.source} />
                                                            </div>
                                                        </div>
                                                        <div className="relative">
                                                            <div className={`text-slate-900 font-medium group-hover:text-blue-700 ${expanded ? '' : 'line-clamp-2'}`}>
                                                                {tm.target}
                                                            </div>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    toggleMatchExpansion(matchKey);
                                                                }}
                                                                className="absolute bottom-0 right-0 bg-slate-50/90 hover:bg-blue-100 text-blue-600 text-xs px-2 py-0.5 rounded-t border border-slate-200 border-b-0 transition-colors"
                                                            >
                                                                {expanded ? '收起' : '展开'}
                                                            </button>
                                                        </div>
                                                        <div className="mt-1 flex justify-between text-slate-400 items-center">
                                                            <div className="flex gap-1.5">
                                                                <span>{tm.usageCount} 次</span>
                                                                {tm.sourceTM && <span className="bg-slate-200 px-1 rounded truncate max-w-[80px] text-slate-600">{tm.sourceTM}</span>}
                                                            </div>
                                                            <span className={`${tm.score >= 100 ? 'text-green-600 font-bold' : tm.score >= 70 ? 'text-orange-500 font-semibold' : 'text-slate-400'}`}>
                                                                {tm.score}%
                                                            </span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <div className="text-xs text-slate-400 italic pl-2 pb-2 h-32 flex items-center justify-center">无匹配结果</div>
                                    )}
                                </div>
                            </div>
                        )}

                        {activeSidebarTab === 'terms' && (
                            /* --- Term Base Mode View (New Separate Tab) --- */
                            <div className="flex-1 flex flex-col min-h-0 bg-slate-50/30">
                                <div className="px-4 pt-3 pb-2 border-b border-slate-100 bg-white shadow-sm z-10">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                            <Icons.TermBase className="w-4 h-4 text-red-500" />
                                            <span className="text-sm font-semibold text-slate-700">
                                                术语库 <span className="text-slate-400 font-normal">{allTerms.length > 0 ? `(${allTerms.length})` : ''}</span>
                                            </span>
                                        </div>
                                        {/* Toggle Buttons */}
                                        <div className="flex gap-1">
                                             <button 
                                                onClick={() => {
                                                    setShowTermSearch(!showTermSearch);
                                                    if (!showTermSearch) setTimeout(() => tbSearchInputRef.current?.focus(), 50);
                                                }}
                                                className={`p-1.5 rounded-md transition-colors ${showTermSearch ? 'bg-slate-100 text-blue-600' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}
                                                title="搜索术语"
                                             >
                                                 <Icons.Search className="w-3.5 h-3.5" />
                                             </button>
                                             <button 
                                                onClick={() => {
                                                    if(!mainTB) { alert("无主术语库 (Main TB)，无法添加术语。"); return; }
                                                    handleCancelTermEdit();
                                                    setShowAddTermForm(!showAddTermForm);
                                                }}
                                                disabled={!mainTB}
                                                className={`p-1.5 rounded-md transition-colors ${showAddTermForm ? 'bg-slate-100 text-blue-600' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50 disabled:opacity-30'}`}
                                                title={mainTB ? "添加术语" : "无主术语库"}
                                             >
                                                 <Icons.Plus className="w-3.5 h-3.5" />
                                             </button>
                                        </div>
                                    </div>
                                    <p className="text-[10px] text-slate-500 mb-2 leading-snug">
                                        左侧数字为顺序；在「术语」标签下按 <kbd className="px-1 py-0.5 rounded border border-slate-200 bg-slate-50 font-mono text-[9px]">Ctrl</kbd>
                                        +<kbd className="px-1 py-0.5 rounded border border-slate-200 bg-slate-50 font-mono text-[9px]">1–9</kbd>
                                        可将对应术语译文插入译文光标处；若已划选译文则替换选区（支持第 1～9 条）。
                                    </p>

                                    {/* Inline Add Form (Toggleable) */}
                                    {showAddTermForm && mainTB && (
                                        <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 mb-3 shadow-inner animate-in slide-in-from-top-1 fade-in duration-200">
                                            <div className="grid grid-cols-1 gap-2 mb-2">
                                                <input 
                                                    value={termSource} 
                                                    onChange={e => setTermSource(e.target.value)}
                                                    placeholder="输入原文..."
                                                    className="text-xs p-2 border border-slate-200 rounded outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50"
                                                    autoFocus
                                                />
                                                <input 
                                                    value={termTarget} 
                                                    onChange={e => setTermTarget(e.target.value)}
                                                    placeholder="输入译文..."
                                                    className="text-xs p-2 border border-slate-200 rounded outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50"
                                                />
                                            </div>
                                            <button 
                                                onClick={handleSaveTerm}
                                                disabled={!termSource || !termTarget}
                                                className="w-full bg-blue-600 text-white text-xs py-1.5 rounded font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
                                                title="快捷键 Ctrl+W"
                                            >
                                                添加至主术语库
                                            </button>
                                        </div>
                                    )}
                                    
                                    {showTermSearch && (
                                        <div className="relative animate-in slide-in-from-top-1 fade-in duration-200 mb-2">
                                            <input 
                                                ref={tbSearchInputRef}
                                                type="text" 
                                                className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 pl-9 pr-6 text-xs outline-none focus:border-blue-400 focus:bg-white transition-colors placeholder-slate-400"
                                                placeholder="搜索术语..."
                                                value={tbSearchQuery}
                                                onChange={(e) => setTbSearchQuery(e.target.value)}
                                            />
                                            <Icons.Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                                            {tbSearchQuery && (
                                                <button 
                                                    onClick={() => setTbSearchQuery('')}
                                                    className="absolute right-2 top-2 text-slate-400 hover:text-slate-600"
                                                >
                                                    <Icons.X className="w-3.5 h-3.5" />
                                                </button>
                                            )}
                                        </div>
                                    )}
                                    
                                    {allTBs.length === 0 && <div className="text-xs text-slate-400 italic p-2 text-center bg-slate-50 rounded">未关联术语库</div>}
                                </div>
                                
                                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2" style={{ fontSize: `${editorFontSize.tb}px` }}>
                                    {allTBs.length > 0 && displayedTerms.length > 0 ? (
                                        displayedTerms.map((term, idx) => (
                                            <div 
                                                key={`${term.tbId}-${term.id}-${idx}`} 
                                                className={`
                                                    p-3 rounded-lg border transition-all flex flex-col gap-1 group relative
                                                    ${editingTermId === term.id
                                                        ? 'bg-blue-50/80 border-blue-300 ring-1 ring-blue-100 cursor-default'
                                                        : activeTermSource === term.source 
                                                        ? 'bg-blue-50 border-blue-300 shadow-md ring-1 ring-blue-100 cursor-pointer' 
                                                        : 'bg-white border-slate-200 hover:bg-slate-50 hover:border-blue-300 cursor-pointer'}
                                                `}
                                                onClick={() => {
                                                    if (editingTermId === term.id) return;
                                                    setActiveTermSource(term.source === activeTermSource ? null : term.source);
                                                }}
                                                onDoubleClick={() => {
                                                    if (editingTermId === term.id) return;
                                                    if (!activeSegment?.isLocked) handleInsertTerm(term.target);
                                                }}
                                            >
                                                <div className="flex justify-between items-start gap-2">
                                                    <div className="flex items-start gap-2 min-w-0 flex-1">
                                                        <span
                                                            className="shrink-0 mt-0.5 flex h-6 min-w-[1.5rem] items-center justify-center rounded-md bg-slate-100 text-[11px] font-bold tabular-nums text-slate-600 border border-slate-200"
                                                            title={idx < 9 ? `快捷键 Ctrl+${idx + 1}` : undefined}
                                                        >
                                                            {idx + 1}
                                                        </span>
                                                        <span className={`font-bold leading-tight break-words min-w-0 ${activeTermSource === term.source ? 'text-blue-700' : 'text-slate-800'}`}>
                                                            {term.source}
                                                        </span>
                                                    </div>
                                                    <div className={`flex gap-1 shrink-0 transition-opacity ${activeTermSource === term.source ? 'opacity-100 pointer-events-auto' : 'opacity-0 group-hover:opacity-100 pointer-events-auto'} z-10 -mr-1 -mt-1`}>
                                                        <button 
                                                            type="button"
                                                            onClick={(e) => { 
                                                                e.preventDefault();
                                                                e.stopPropagation(); 
                                                                handleInsertTerm(term.target); 
                                                            }}
                                                            className="p-1.5 bg-green-50 text-green-600 hover:bg-green-100 rounded border border-green-200"
                                                            title={idx < 9 ? `插入/替换译文（Ctrl+${idx + 1}）` : '插入/替换译文'}
                                                        >
                                                            <Icons.CornerDownRight className="w-3 h-3" />
                                                        </button>
                                                        {mainTB && mainTB.entries.some(e => e.id === term.id) && editingTermId !== term.id && (
                                                            <>
                                                                <button 
                                                                    type="button"
                                                                    onClick={(e) => { 
                                                                        e.preventDefault();
                                                                        e.stopPropagation(); 
                                                                        setShowAddTermForm(false);
                                                                        handleEditTerm(term); 
                                                                    }}
                                                                    className="p-1.5 bg-slate-50 text-slate-500 hover:bg-blue-50 hover:text-blue-600 rounded border border-slate-200"
                                                                    title="编辑"
                                                                >
                                                                    <Icons.Edit className="w-3 h-3"/>
                                                                </button>
                                                                <button 
                                                                    type="button"
                                                                    onClick={(e) => { 
                                                                        e.preventDefault();
                                                                        e.stopPropagation(); 
                                                                        setTermToDelete(term); 
                                                                    }}
                                                                    className="p-1.5 bg-slate-50 text-slate-500 hover:bg-red-50 hover:text-red-600 rounded border border-slate-200"
                                                                    title="删除"
                                                                >
                                                                    <Icons.Trash className="w-3 h-3"/>
                                                                </button>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                                {editingTermId === term.id ? (
                                                    <div className="mt-1 space-y-2" onClick={(e) => e.stopPropagation()}>
                                                        <input
                                                            type="text"
                                                            value={editingTermTarget}
                                                            onChange={(e) => setEditingTermTarget(e.target.value)}
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter') {
                                                                    e.preventDefault();
                                                                    handleUpdateTermInline();
                                                                } else if (e.key === 'Escape') {
                                                                    e.preventDefault();
                                                                    handleCancelTermEdit();
                                                                }
                                                            }}
                                                            className="w-full text-xs p-2 border border-blue-300 rounded outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 bg-white text-slate-800"
                                                            autoFocus
                                                        />
                                                        <div className="flex gap-2">
                                                            <button
                                                                type="button"
                                                                onClick={handleUpdateTermInline}
                                                                disabled={!editingTermTarget.trim()}
                                                                className="flex-1 bg-blue-600 text-white text-xs py-1.5 rounded font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                                                                title="快捷键 Ctrl+W"
                                                            >
                                                                更新
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={handleCancelTermEdit}
                                                                className="px-3 text-xs py-1.5 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
                                                            >
                                                                取消
                                                            </button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <span className={`mt-1 ${activeTermSource === term.source ? 'text-blue-600 font-medium' : 'text-slate-600'}`}>
                                                        {term.target}
                                                    </span>
                                                )}
                                                <div
                                                    className="mt-1.5 pt-1.5 border-t border-slate-100 flex items-center gap-1.5 text-[10px] text-slate-400"
                                                    title={`来源术语库：${term.tbName}`}
                                                >
                                                    <Icons.TermBase className="w-3 h-3 shrink-0 text-slate-400" />
                                                    <span className="truncate min-w-0">
                                                        {mainTB?.id === term.tbId ? (
                                                            <span className="text-slate-500">主术语库 · {term.tbName}</span>
                                                        ) : (
                                                            <span>参考库 · {term.tbName}</span>
                                                        )}
                                                    </span>
                                                </div>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="flex flex-col items-center justify-center h-40 text-slate-400 text-xs">
                                            {tbSearchQuery ? (
                                                <>
                                                    <Icons.Search className="w-8 h-8 mb-2 opacity-20" />
                                                    <p>未找到 "{tbSearchQuery}"</p>
                                                </>
                                            ) : (
                                                allTBs.length > 0 ? (
                                                    <>
                                                        <Icons.TermBase className="w-8 h-8 mb-2 opacity-20" />
                                                        <p>当前句无相关术语</p>
                                                    </>
                                                ) : null
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {activeSidebarTab === 'concordance' && (
                            /* --- Concordance Search Mode (Trados Style) --- */
                            <div className="flex-1 flex flex-col min-h-0 bg-slate-50/50">
                                <div className="p-4 border-b border-slate-100 bg-white">
                                    <div className="relative mb-2">
                                        <input 
                                            type="text" 
                                            className="w-full pl-9 pr-12 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 placeholder-slate-400"
                                            placeholder="搜索 TM 全文..."
                                            value={concordanceQuery}
                                            onChange={(e) => setConcordanceQuery(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && performConcordanceSearch(concordanceQuery)}
                                            autoFocus
                                        />
                                        <Icons.Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                                        <button 
                                            onClick={() => performConcordanceSearch(concordanceQuery)}
                                            className="absolute right-1 top-1 p-1.5 bg-blue-50 text-blue-600 rounded-md hover:bg-blue-100"
                                        >
                                            <Icons.ChevronRight className="w-4 h-4" />
                                        </button>
                                    </div>
                                    <div className="flex justify-between items-center text-[10px] text-slate-400">
                                        <span>提示: 选中文字按 <b>F3</b> 快速搜索</span>
                                    </div>
                                </div>

                                <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ fontSize: `${editorFontSize.tm}px` }}>
                                    {concordanceResults.length > 0 ? (
                                        concordanceResults.map((result, idx) => (
                                            <div 
                                                key={`${result.id}-${idx}`} 
                                                className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm hover:border-blue-400 cursor-pointer group transition-all"
                                                onDoubleClick={() => handleInsertTerm(result.target)} // Insert on double click
                                            >
                                                <div className="text-slate-500 mb-1.5 flex justify-between">
                                                    <span className="bg-slate-100 px-1.5 py-0.5 rounded text-[10px]">Source {result.sourceTM ? `(${result.sourceTM})` : ''}</span>
                                                    {/* Insert Button */}
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); handleInsertTerm(result.target); }}
                                                        className="opacity-0 group-hover:opacity-100 text-[10px] flex items-center gap-1 text-blue-600 bg-blue-50 px-2 py-0.5 rounded hover:bg-blue-100 transition-opacity"
                                                    >
                                                        <Icons.CornerDownRight className="w-3 h-3" /> 插入
                                                    </button>
                                                </div>
                                                <div className="text-slate-800 mb-2 leading-relaxed">
                                                    <HighlightMatch text={result.source} match={concordanceQuery} />
                                                </div>
                                                
                                                <div className="h-px bg-slate-100 my-2" />
                                                
                                                <div className="text-slate-500 mb-1.5">
                                                    <span className="bg-slate-100 px-1.5 py-0.5 rounded text-[10px]">Target</span>
                                                </div>
                                                <div className="text-blue-700 font-medium leading-relaxed">
                                                    <HighlightMatch text={result.target} match={concordanceQuery} />
                                                </div>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="flex flex-col items-center justify-center h-full text-slate-400">
                                            {concordanceQuery ? (
                                                <>
                                                    <Icons.Search className="w-8 h-8 mb-2 opacity-20" />
                                                    <p>未找到 "{concordanceQuery}" 相关结果</p>
                                                </>
                                            ) : (
                                                <>
                                                    <Icons.Concordance className="w-8 h-8 mb-2 opacity-20" />
                                                    <p>输入关键词或按 F3 搜索记忆库</p>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Resizable Divider */}
                    <div 
                        className="h-2 border-t border-b border-slate-200 bg-slate-50 cursor-row-resize hover:bg-slate-100 transition-all flex items-center justify-center"
                        onMouseDown={() => setIsResizingVertical(true)}
                    >
                        <div className="w-6 h-0.5 bg-slate-300 rounded-full transition-all hover:bg-slate-400"></div>
                    </div>
                    
                    {/* AI Actions / Chat Panel (Resizable) */}
                    <div className="border-t border-slate-200 bg-slate-50/50 flex flex-col" style={{ height: `${aiPanelHeight}%` }}>
                         {/* Header / Tabs */}
                         <div className="flex border-b border-slate-200">
                             <button 
                                onClick={() => setAiMode('actions')}
                                className={`flex-1 py-2 text-xs font-bold uppercase transition-colors ${aiMode === 'actions' ? 'bg-purple-50 text-purple-600 border-b-2 border-purple-500' : 'text-slate-500 hover:bg-slate-100'}`}
                             >
                                 AI 快捷操作
                             </button>
                             <button 
                                onClick={() => setAiMode('chat')}
                                className={`flex-1 py-2 text-xs font-bold uppercase transition-colors ${aiMode === 'chat' ? 'bg-purple-50 text-purple-600 border-b-2 border-purple-500' : 'text-slate-500 hover:bg-slate-100'}`}
                             >
                                 AI 对话助手
                             </button>
                         </div>

                         <div className="flex-1 overflow-y-auto p-4">
                             {aiMode === 'actions' ? (
                                <div className="space-y-2">
                                    <div className="flex justify-between items-center mb-2">
                                        <span className="text-[10px] font-bold text-slate-400">CONTEXT AWARE</span>
                                        {project.contextDescription && <span className="text-[10px] text-green-600 bg-green-50 px-1 rounded">Active</span>}
                                    </div>
                                    <button 
                                        onClick={() => handleAiTranslate(activeSegment)}
                                        disabled={isAiProcessing || activeSegment.isLocked || isPolishing}
                                        className="w-full text-left p-2.5 bg-white border border-purple-100 rounded-lg hover:border-purple-300 hover:shadow-sm transition-all text-xs flex items-center gap-2 text-purple-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <Icons.Sparkles className={`w-3.5 h-3.5 ${isAiProcessing ? 'animate-spin' : ''}`} />
                                        {isAiProcessing ? '正在翻译...' : '智能翻译当前句'}
                                    </button>
                                    <button 
                                        onClick={() => handleAiPolish(activeSegment)}
                                        disabled={!activeSegment.targetText || isPolishing || activeSegment.isLocked || isAiProcessing}
                                        className="w-full text-left p-2.5 bg-white border border-purple-100 rounded-lg hover:border-purple-300 hover:shadow-sm transition-all text-xs flex items-center gap-2 text-purple-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <Icons.Magic className={`w-3.5 h-3.5 ${isPolishing ? 'animate-spin' : ''}`} />
                                        {isPolishing ? '正在润色...' : 'AI 智能润色 (优化表达)'}
                                    </button>
                                    <button 
                                        onClick={handleRunDeepAIQA}
                                        disabled={!activeSegment.targetText || isDeepQAProcessing}
                                        className="w-full text-left p-2.5 bg-white border border-purple-100 rounded-lg hover:border-purple-300 hover:shadow-sm transition-all text-xs flex items-center gap-2 text-purple-700 font-medium disabled:opacity-50"
                                    >
                                        <Icons.BrainCircuit className={`w-3.5 h-3.5 ${isDeepQAProcessing ? 'animate-spin' : ''}`} />
                                        {isDeepQAProcessing ? '正在检查...' : '深度 QA 检查 (当前句)'}
                                    </button>
                                </div>
                             ) : (
                                 <div className="flex flex-col h-full">
                                     <div className="flex-1 overflow-y-auto space-y-3 mb-2 pr-1" style={{ fontSize: `${editorFontSize.ai}px` }}>
                                         {chatHistory.length === 0 && (
                                             <div className="text-center text-slate-400 mt-4">
                                                 可以向我询问术语、语法或背景知识。
                                             </div>
                                         )}
                                         {chatHistory.map((msg, idx) => (
                                             <div key={idx} className={`flex items-start ${msg.role === 'user' ? 'justify-end' : 'justify-start'} gap-1`}>
                                                 <div className={`max-w-[85%] p-2 rounded-lg leading-relaxed ${msg.role === 'user' ? 'bg-purple-100 text-purple-900' : 'bg-white border border-slate-200 text-slate-700'} relative group`}>
                                                     {msg.text}
                                                     {/* Copy Button - Visible on Hover */}
                                                     <button
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            e.stopPropagation();

                                                            // 方法1：使用现代 Clipboard API
                                                            if (navigator.clipboard && navigator.clipboard.writeText) {
                                                                navigator.clipboard.writeText(msg.text)
                                                                    .then(() => {
                                                                        console.log('AI对话内容已复制到剪贴板');
                                                                    })
                                                                    .catch((err) => {
                                                                        console.error('Clipboard API 失败，尝试备用方法:', err);
                                                                        copyToClipboardFallback(msg.text);
                                                                    });
                                                            } else {
                                                                // 方法2：使用传统方法
                                                                copyToClipboardFallback(msg.text);
                                                            }
                                                        }}
                                                        className="absolute top-1 right-1 p-1 bg-white/80 hover:bg-blue-50 text-slate-400 hover:text-blue-600 rounded opacity-0 group-hover:opacity-100 transition-all"
                                                        title="复制内容"
                                                    >
                                                        <Icons.Copy className="w-3 h-3" />
                                                    </button>
                                                 </div>
                                             </div>
                                         ))}
                                     </div>
                                     {/* Quick Prompts */}
                                    <div className="flex flex-wrap gap-1 mb-2">
                                        {quickPrompts.map((prompt, idx) => (
                                            <button 
                                                key={prompt.id}
                                                onClick={() => setChatInput(prev => prev + prompt.text)}
                                                className="text-xs px-2 py-0.5 bg-slate-100 text-slate-700 rounded hover:bg-slate-200 transition-colors"
                                            >
                                                {prompt.label}
                                            </button>
                                        ))}
                                    </div>
                                     
                                     <div className="relative">
                                         <input 
                                            type="text" 
                                            className="w-full border border-slate-300 rounded-lg py-2 pl-2 pr-8 focus:ring-2 focus:ring-purple-200 outline-none"
                                            placeholder="输入问题..."
                                            value={chatInput}
                                            onChange={(e) => setChatInput(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
                                            disabled={isChatSending}
                                            style={{ fontSize: `${editorFontSize.ai}px` }}
                                         />
                                         <button 
                                            onClick={handleSendChat}
                                            disabled={isChatSending || !chatInput}
                                            className="absolute right-1 top-1 p-1 text-purple-600 hover:bg-purple-50 rounded disabled:opacity-50"
                                         >
                                             {isChatSending ? <Icons.Refresh className="w-3.5 h-3.5 animate-spin"/> : <Icons.ChevronRight className="w-4 h-4"/>}
                                         </button>
                                     </div>
                                 </div>
                             )}
                         </div>
                    </div>
                </>
            ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8 text-center bg-slate-50/50">
                    <Icons.File className="w-12 h-12 mb-4 opacity-20" />
                    <p className="text-sm">点击左侧句段<br/>开始翻译工作</p>
                </div>
            )}
            
            {/* QA Panel Overlay */}
            {showQAPanel && (
                <div className="absolute inset-0 z-50 flex flex-col bg-white">
                    <div className="flex justify-between items-center p-3 border-b border-slate-200 bg-slate-50">
                        <h3 className="text-xs font-bold text-slate-900 uppercase flex items-center gap-2">
                            <Icons.QA className="w-4 h-4 text-slate-500"/>
                            QA 报告 {qaReportScope === 'current' ? `- ${activeFile.name}` : '- 所有文件'}
                        </h3>
                        <div className="flex items-center gap-2">
                            {/* QA范围切换按钮 */}
                            <div className="flex items-center gap-1 bg-slate-100 rounded-md p-0.5">
                                <button 
                                    onClick={() => setQaReportScope('current')}
                                    className={`px-2 py-1 text-xs rounded transition-colors ${qaReportScope === 'current' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
                                    title="当前文件"
                                >
                                    当前文件
                                </button>
                                <button 
                                    onClick={() => setQaReportScope('all')}
                                    className={`px-2 py-1 text-xs rounded transition-colors ${qaReportScope === 'all' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
                                    title="所有文件"
                                >
                                    所有文件
                                </button>
                            </div>
                             <button onClick={handleExportQA} className="p-1 hover:bg-slate-200 rounded text-slate-500" title="导出 Excel">
                                <Icons.Download className="w-4 h-4"/>
                            </button>
                            <button onClick={() => setShowQAPanel(false)} className="text-slate-400 hover:text-slate-600">
                                <Icons.X className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 bg-slate-50/30">
                        {(() => {
                            // 根据qaReportScope确定要显示的文件
                            const filesToShow = qaReportScope === 'current' 
                                ? [activeFile] 
                                : project.files.filter(f => f.segments.some(s => s.qaIssues && s.qaIssues.length > 0));
                            
                            const allIssues = filesToShow.flatMap(f => f.segments.flatMap(s => s.qaIssues || []));
                            
                            if (allIssues.length === 0) {
                                return (
                                    <div className="h-32 flex flex-col items-center justify-center text-green-600 gap-2">
                                        <Icons.Check className="w-8 h-8 opacity-50" /> 
                                        <span className="text-xs font-medium">太棒了！未发现 QA 问题</span>
                                    </div>
                                );
                            }
                            
                            return (
                                <div className="space-y-2.5">
                                    {filesToShow.map(f => {
                                        const fileHasIssues = f.segments.some(s => s.qaIssues && s.qaIssues.length > 0);
                                        if (!fileHasIssues) return null;
                                        
                                        return (
                                            <div key={f.id}>
                                                {/* 只有在显示所有文件时才显示文件名标题 */}
                                                {qaReportScope === 'all' && (
                                                    <div className="text-xs font-bold text-slate-400 uppercase mb-1 mt-2">
                                                        {f.name === activeFile.name ? `${f.name} (当前)` : f.name}
                                                    </div>
                                                )}
                                                {f.segments.filter(s => s.qaIssues && s.qaIssues.length > 0).map(s => (
                                                    <div key={s.id} className="border border-slate-200 rounded-lg p-2.5 bg-white shadow-sm mb-2">
                                                        <div className="text-xs font-bold text-slate-700 mb-2 flex justify-between cursor-pointer hover:text-blue-600" onClick={() => handleJumpFromQA(f.id, s.id)}>
                                                            <span>Segment #{f.segments.findIndex(x => x.id === s.id) + 1}</span>
                                                            {f.id !== activeFile.id && (
                                                                <span className="text-[10px] text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded">切换</span>
                                                            )}
                                                        </div>
                                                        <div className="space-y-1.5">
                                                            {s.qaIssues?.map(issue => (
                                                                <div key={issue.id} className={`text-[11px] p-2 rounded flex items-start gap-2 justify-between group ${issue.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-yellow-50 text-yellow-700'}`}>
                                                                    <div className="flex gap-2">
                                                                        <Icons.Warning className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                                                        <span className="leading-tight">{issue.message}</span>
                                                                    </div>
                                                                    <button 
                                                                        onClick={(e) => { e.stopPropagation(); handleDeleteQAIssue(s.id, issue.id); }}
                                                                        className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500"
                                                                    >
                                                                        <Icons.X className="w-3 h-3"/>
                                                                    </button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })()}
                    </div>
                </div>
            )}

            {/* Replace Results Modal */}
            {showReplacePanel && createPortal(
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[80vh] flex flex-col animate-in zoom-in-95 duration-200">
                        <div className="flex justify-between items-center p-4 border-b border-slate-200 bg-slate-50 rounded-t-2xl">
                            <h3 className="text-base font-bold text-slate-900 uppercase flex items-center gap-2">
                                <Icons.Edit className="w-5 h-5 text-slate-500"/>
                                替换结果 ({replacedSegments.length})
                            </h3>
                            <button onClick={() => setShowReplacePanel(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-200">
                                <Icons.X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-5 space-y-4">
                             {replacedSegments.map((seg, idx) => (
                                 <div 
                                    key={seg.id} 
                                    onClick={() => { onActiveFileChange(activeFile.id); setActiveSegmentId(seg.id); setShowReplacePanel(false); }}
                                    className="bg-white border border-slate-200 p-4 rounded-lg shadow-sm cursor-pointer hover:border-blue-400 transition-colors hover:shadow-md"
                                 >
                                     <div className="flex justify-between items-center mb-3">
                                         <span className="text-xs font-mono text-slate-400">ID: {idx + 1}</span>
                                         <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded">草稿</span>
                                     </div>
                                     <div className="text-sm text-slate-800 line-clamp-3 mb-3" title={seg.targetText}>
                                         <span className="text-slate-500 font-medium">原文:</span> <HighlightMatch text={seg.sourceText} match={findText} />
                                     </div>
                                     <div className="text-sm text-slate-800 line-clamp-3" title={seg.targetText}>
                                         <span className="text-slate-500 font-medium">译文:</span> <HighlightMatch text={seg.targetText} match={replaceText} />
                                     </div>
                                     <div className="mt-3 flex justify-end gap-2">
                                         <button 
                                             onClick={(e) => {
                                                 e.stopPropagation();
                                                 onActiveFileChange(activeFile.id);
                                                 setActiveSegmentId(seg.id);
                                                 setShowReplacePanel(false);
                                             }}
                                             className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                                         >
                                             编辑
                                         </button>
                                     </div>
                                 </div>
                             ))}
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Find Results Modal */}
            {showFindResults && findResults.length > 0 && createPortal(
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[80vh] flex flex-col animate-in zoom-in-95 duration-200">
                        <div className="flex justify-between items-center p-4 border-b border-slate-200 bg-slate-50 rounded-t-2xl">
                            <h3 className="text-base font-bold text-slate-900 uppercase flex items-center gap-2">
                                <Icons.ScanSearch className="w-5 h-5 text-blue-600"/>
                                查找结果 ({findResults.length})
                            </h3>
                            <div className="flex gap-2">
                                <button 
                                    onClick={() => {
                                        setShowFindResults(false);
                                        setIsReplaceModalOpen(true);
                                    }}
                                    className="text-sm text-blue-600 hover:text-blue-800 px-3 py-1 rounded hover:bg-blue-50"
                                >
                                    继续替换
                                </button>
                                <button onClick={() => setShowFindResults(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-200">
                                    <Icons.X className="w-5 h-5" />
                                </button>
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto p-5 space-y-4">
                            {findResults.map((result, idx) => {
                                const file = project?.files.find(f => f.id === result.fileId);
                                const isEditing = editingResultId === result.segment.id;
                                return (
                                    <div 
                                        key={result.segment.id} 
                                        className={`bg-white border ${isEditing ? 'border-blue-500 shadow-md' : 'border-slate-200'} p-4 rounded-lg shadow-sm transition-colors hover:shadow-md`}
                                    >
                                        <div className="flex justify-between items-center mb-3">
                                            <span className="text-xs font-medium text-slate-500">{file?.name || '未知文件'}</span>
                                            <span className="text-xs font-mono text-slate-400">#{idx + 1}</span>
                                        </div>
                                        
                                        {isEditing ? (
                                            <div className="space-y-3">
                                                <div>
                                                    <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">原文</label>
                                                    <textarea
                                                        value={editingSourceText}
                                                        onChange={(e) => setEditingSourceText(e.target.value)}
                                                        className="w-full border border-slate-300 rounded-lg p-2.5 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm resize-y min-h-[60px]"
                                                        rows={2}
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">译文</label>
                                                    <textarea
                                                        value={editingTargetText}
                                                        onChange={(e) => setEditingTargetText(e.target.value)}
                                                        className="w-full border border-slate-300 rounded-lg p-2.5 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm resize-y min-h-[60px]"
                                                        rows={2}
                                                    />
                                                </div>
                                                <div className="flex gap-2 mt-3">
                                                    <button 
                                                        onClick={() => {
                                                            const file = project?.files.find(f => f.id === result.fileId);
                                                            if (file) {
                                                                const updatedSegments = file.segments.map(s => {
                                                                    if (s.id === result.segment.id && !s.isLocked) {
                                                                        return { 
                                                                            ...s, 
                                                                            sourceText: editingSourceText,
                                                                            targetText: editingTargetText,
                                                                            status: SegmentStatus.Draft 
                                                                        };
                                                                    }
                                                                    return s;
                                                                });
                                                                onUpdateFileSegments(result.fileId, updatedSegments);
                                                                setFindResults(prev => prev.map(r => {
                                                                    if (r.segment.id === result.segment.id) {
                                                                        return {
                                                                            ...r,
                                                                            segment: {
                                                                                ...r.segment,
                                                                                sourceText: editingSourceText,
                                                                                targetText: editingTargetText,
                                                                                status: SegmentStatus.Draft
                                                                            }
                                                                        };
                                                                    }
                                                                    return r;
                                                                }));
                                                                setEditingResultId(null);
                                                                setEditingSourceText('');
                                                                setEditingTargetText('');
                                                            }
                                                        }}
                                                        className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors flex-1"
                                                    >
                                                        保存
                                                    </button>
                                                    <button 
                                                        onClick={() => {
                                                            setEditingResultId(null);
                                                            setEditingSourceText('');
                                                            setEditingTargetText('');
                                                        }}
                                                        className="text-sm px-3 py-1.5 bg-slate-200 text-slate-700 rounded hover:bg-slate-300 transition-colors flex-1"
                                                    >
                                                        取消
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div>
                                                <div className="text-sm text-slate-800 line-clamp-3 mb-3" title={result.segment.sourceText}>
                                                    <span className="text-slate-500 font-medium">原文:</span>{' '}
                                                    {findUseRegex ? (
                                                        <HighlightRegexInText text={result.segment.sourceText} pattern={findText} />
                                                    ) : (
                                                        <HighlightMatch text={result.segment.sourceText} match={findText} />
                                                    )}
                                                </div>
                                                <div className="text-sm text-slate-800 line-clamp-3 mb-3" title={result.segment.targetText}>
                                                    <span className="text-slate-500 font-medium">译文:</span>{' '}
                                                    {findUseRegex ? (
                                                        <HighlightRegexInText text={result.segment.targetText} pattern={findText} />
                                                    ) : (
                                                        <HighlightMatch text={result.segment.targetText} match={findText} />
                                                    )}
                                                </div>
                                                <div className="mt-3 flex gap-2">
                                                    <button 
                                                        onClick={() => {
                                                            setEditingResultId(result.segment.id);
                                                            setEditingSourceText(result.segment.sourceText);
                                                            setEditingTargetText(result.segment.targetText);
                                                        }}
                                                        className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors flex-1"
                                                    >
                                                        编辑
                                                    </button>
                                                    <button 
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            void (async () => {
                                                                try {
                                                                    if (findUseRegex) {
                                                                        const err = validateFindRegex(findText);
                                                                        if (err) {
                                                                            alert(`正则表达式无效：${err}`);
                                                                            return;
                                                                        }
                                                                    }
                                                                    const file = project?.files.find(f => f.id === result.fileId);
                                                                    if (!file) return;
                                                                    const updatedSegments = await Promise.all(
                                                                        file.segments.map(async (s) => {
                                                                            if (s.id !== result.segment.id || s.isLocked) return s;
                                                                            if (replaceType === 'source') {
                                                                                const sourceText = await applyFindReplaceInText(
                                                                                    s.sourceText,
                                                                                    findText,
                                                                                    replaceText,
                                                                                    findUseRegex
                                                                                );
                                                                                return {
                                                                                    ...s,
                                                                                    sourceText,
                                                                                    status: SegmentStatus.Draft,
                                                                                };
                                                                            }
                                                                            const targetText = await applyFindReplaceInText(
                                                                                s.targetText,
                                                                                findText,
                                                                                replaceText,
                                                                                findUseRegex
                                                                            );
                                                                            return {
                                                                                ...s,
                                                                                targetText,
                                                                                status: SegmentStatus.Draft,
                                                                            };
                                                                        })
                                                                    );
                                                                    onUpdateFileSegments(result.fileId, updatedSegments);
                                                                    setFindResults(prev => prev.filter(r => r.segment.id !== result.segment.id));
                                                                    if (findResults.length === 1) {
                                                                        setShowFindResults(false);
                                                                    }
                                                                } catch (err) {
                                                                    alert(err instanceof Error ? err.message : String(err));
                                                                }
                                                            })();
                                                        }}
                                                        disabled={!findText || (findUseRegex && !!findRegexError)}
                                                        className="text-sm px-3 py-1.5 bg-green-600 text-white rounded hover:bg-green-700 transition-colors flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        替换
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
        
        {/* Req 1: Zoom QA Modal - USING PORTAL */}
        {qaZoomIssue && createPortal(
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
                 <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6 animate-in zoom-in-95 duration-200">
                     <div className="flex justify-between items-center mb-6">
                         <div className={`flex items-center gap-3 px-3 py-1.5 rounded-lg ${qaZoomIssue.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                             <Icons.Warning className="w-6 h-6" />
                             <h2 className="text-xl font-bold uppercase">{qaZoomIssue.category}</h2>
                         </div>
                         <button onClick={() => setQaZoomIssue(null)} className="p-2 hover:bg-slate-100 rounded-full">
                             <Icons.X className="w-6 h-6 text-slate-500" />
                         </button>
                     </div>
                     <div className="p-6 bg-slate-50 rounded-xl border border-slate-200 mb-6">
                         <p className="text-2xl font-medium text-slate-800 leading-relaxed">
                             {qaZoomIssue.message}
                         </p>
                     </div>
                     <div className="flex justify-end">
                         <button 
                            onClick={() => setQaZoomIssue(null)}
                            className="px-6 py-2 bg-slate-900 text-white rounded-lg font-bold"
                         >
                             关闭
                         </button>
                     </div>
                 </div>
            </div>,
            document.body
        )}

        {/* Editor Settings Modal - USING PORTAL */}
        {isSettingsModalOpen && createPortal(
            <div className="fixed inset-0 bg-slate-900/20 backdrop-blur-[1px] z-[100] flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-sm p-5 animate-in zoom-in-95 duration-200">
                    <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-100">
                        <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                            <Icons.Settings className="w-4 h-4 text-slate-500" />
                            编辑器偏好
                        </h2>
                        <button onClick={() => setIsSettingsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                            <Icons.X className="w-4 h-4" />
                        </button>
                    </div>

                    <div className="space-y-6">
                        {/* Font Size Settings */}
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase mb-3 block">字号大小</label>
                            
                            {/* Main Editor Font Size */}
                            <div className="mb-4">
                                <div className="flex justify-between items-center mb-2">
                                    <label className="text-xs text-slate-600">原文译文列</label>
                                    <span className="text-xs font-mono text-slate-600 bg-slate-100 px-1.5 rounded">{editorFontSize.main}px</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="text-xs text-slate-400">A</span>
                                    <input 
                                        type="range" 
                                        min="12" 
                                        max="24" 
                                        step="1"
                                        value={editorFontSize.main}
                                        onChange={(e) => onUpdateEditorFontSize({...editorFontSize, main: Number(e.target.value)})}
                                        className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                                    />
                                    <span className="text-base text-slate-600 font-bold">A</span>
                                </div>
                            </div>
                            
                            {/* Translation Memory Font Size */}
                            <div className="mb-4">
                                <div className="flex justify-between items-center mb-2">
                                    <label className="text-xs text-slate-600">记忆库显示</label>
                                    <span className="text-xs font-mono text-slate-600 bg-slate-100 px-1.5 rounded">{editorFontSize.tm}px</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="text-xs text-slate-400">A</span>
                                    <input 
                                        type="range" 
                                        min="12" 
                                        max="24" 
                                        step="1"
                                        value={editorFontSize.tm}
                                        onChange={(e) => onUpdateEditorFontSize({...editorFontSize, tm: Number(e.target.value)})}
                                        className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                                    />
                                    <span className="text-base text-slate-600 font-bold">A</span>
                                </div>
                            </div>
                            
                            {/* Term Base Font Size */}
                            <div className="mb-4">
                                <div className="flex justify-between items-center mb-2">
                                    <label className="text-xs text-slate-600">术语显示</label>
                                    <span className="text-xs font-mono text-slate-600 bg-slate-100 px-1.5 rounded">{editorFontSize.tb}px</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="text-xs text-slate-400">A</span>
                                    <input 
                                        type="range" 
                                        min="12" 
                                        max="24" 
                                        step="1"
                                        value={editorFontSize.tb}
                                        onChange={(e) => onUpdateEditorFontSize({...editorFontSize, tb: Number(e.target.value)})}
                                        className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                                    />
                                    <span className="text-base text-slate-600 font-bold">A</span>
                                </div>
                            </div>
                            
                            {/* AI Chat Font Size */}
                            <div>
                                <div className="flex justify-between items-center mb-2">
                                    <label className="text-xs text-slate-600">AI对话窗口</label>
                                    <span className="text-xs font-mono text-slate-600 bg-slate-100 px-1.5 rounded">{editorFontSize.ai}px</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="text-xs text-slate-400">A</span>
                                    <input 
                                        type="range" 
                                        min="12" 
                                        max="24" 
                                        step="1"
                                        value={editorFontSize.ai}
                                        onChange={(e) => onUpdateEditorFontSize({...editorFontSize, ai: Number(e.target.value)})}
                                        className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                                    />
                                    <span className="text-base text-slate-600 font-bold">A</span>
                                </div>
                            </div>
                        </div>

                        {/* Theme Presets */}
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">护眼模式 (背景)</label>
                            <div className="grid grid-cols-2 gap-2">
                                {EDITOR_THEME_PRESETS.map((preset) => {
                                    const isActive = editorTheme.sourceBg === preset.source;
                                    return (
                                        <button
                                            key={preset.name}
                                            onClick={() => {
                                                onUpdateEditorTheme({ sourceBg: preset.source, targetBg: preset.target }); 
                                                setCustomBgColor(preset.source);
                                            }}
                                            className={`
                                                flex items-center gap-2 p-2 rounded-lg border text-left transition-all
                                                ${isActive ? 'border-blue-500 bg-blue-50/50 text-blue-700' : 'border-slate-200 hover:border-slate-300 text-slate-600'}
                                            `}
                                        >
                                            <div className="w-4 h-4 rounded-full border border-black/10 shrink-0" style={{ backgroundColor: preset.source }} />
                                            <span className="text-xs font-medium">{preset.name}</span>
                                        </button>
                                    )
                                })}
                            </div>
                             {/* Custom Color Picker */}
                             <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
                                <label className="text-xs text-slate-600">自定义颜色</label>
                                <div className="flex items-center gap-2">
                                    <input 
                                        type="color" 
                                        value={customBgColor}
                                        onChange={(e) => {
                                            setCustomBgColor(e.target.value);
                                            onUpdateEditorTheme({ sourceBg: e.target.value, targetBg: e.target.value });
                                        }}
                                        className="w-8 h-8 rounded cursor-pointer border-0 p-0"
                                    />
                                </div>
                             </div>
                        </div>

                        {/* 对照 / 单句 */}
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">编辑视图</label>
                            <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 gap-0.5">
                                <button
                                    type="button"
                                    onClick={() => onUpdateEditorLayoutMode('comparison')}
                                    className={`flex-1 py-2 text-xs font-medium rounded-md transition-colors ${
                                        editorLayoutMode === 'comparison'
                                            ? 'bg-white text-blue-700 shadow-sm border border-slate-200/80'
                                            : 'text-slate-600 hover:bg-white/60'
                                    }`}
                                >
                                    对照模式
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onUpdateEditorLayoutMode('focus')}
                                    className={`flex-1 py-2 text-xs font-medium rounded-md transition-colors ${
                                        editorLayoutMode === 'focus'
                                            ? 'bg-white text-blue-700 shadow-sm border border-slate-200/80'
                                            : 'text-slate-600 hover:bg-white/60'
                                    }`}
                                >
                                    单句模式
                                </button>
                            </div>
                            <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
                                单句模式仅显示当前句；Alt+↑ / Alt+↓ 切换句段；Ctrl+Home 跳到筛选后首句（焦点不在输入框内时；macOS 为 Cmd+Home）。
                            </p>
                        </div>

                        {/* Auto-Propagate Toggle */}
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-bold text-slate-500 uppercase">自动填充 (Auto-propagate)</label>
                            <button 
                                onClick={() => onUpdateAutoPropagate(!autoPropagate)}
                                className={`w-10 h-5 rounded-full relative transition-colors ${autoPropagate ? 'bg-blue-600' : 'bg-slate-300'}`}
                            >
                                <div className={`absolute top-1 w-3 h-3 bg-white rounded-full shadow-sm transition-transform ${autoPropagate ? 'left-6' : 'left-1'}`} />
                            </button>
                        </div>
                    </div>
                </div>
            </div>,
            document.body
        )}

        {/* Find & Replace Modal - USING PORTAL */}
        {isReplaceModalOpen && createPortal(
            <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 animate-in zoom-in-95 duration-200">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                            <Icons.Translate className="w-5 h-5 text-blue-600"/>
                            查找与替换
                        </h2>
                        <button onClick={() => setIsReplaceModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                            <Icons.X className="w-5 h-5" />
                        </button>
                    </div>
                    
                    <div className="space-y-4">
                        <div>
                            <div className="flex justify-between items-center mb-1">
                                <label className="block text-xs font-semibold text-slate-500 uppercase">查找内容</label>
                                <select 
                                    className="text-xs border border-slate-300 rounded p-1 outline-none focus:ring-1 focus:ring-blue-500"
                                    value={findType}
                                    onChange={(e) => setFindType(e.target.value as 'source' | 'target')}
                                >
                                    <option value="source">原文</option>
                                    <option value="target">译文</option>
                                </select>
                            </div>
                            <input 
                                type="text" 
                                className={`w-full border rounded-lg p-2.5 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm font-mono ${findRegexError ? 'border-red-400' : 'border-slate-300'}`}
                                placeholder={findUseRegex ? '正则表达式，如 \\d+、foo|bar' : '输入要查找的文本...'}
                                value={findText}
                                onChange={(e) => setFindText(e.target.value)}
                                autoFocus
                            />
                            <label className="mt-2 flex items-center gap-2 cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                    checked={findUseRegex}
                                    onChange={(e) => setFindUseRegex(e.target.checked)}
                                />
                                <span className="text-xs text-slate-600">使用正则匹配（全局 g；替换为支持 $1、$2、$&、$$）</span>
                            </label>
                            {findRegexError && (
                                <p className="text-[11px] text-red-600 mt-1">{findRegexError}</p>
                            )}
                        </div>
                        <div>
                            <div className="flex justify-between items-center mb-1">
                                <label className="block text-xs font-semibold text-slate-500 uppercase">替换为</label>
                                <select 
                                    className="text-xs border border-slate-300 rounded p-1 outline-none focus:ring-1 focus:ring-blue-500"
                                    value={replaceType}
                                    onChange={(e) => setReplaceType(e.target.value as 'source' | 'target')}
                                >
                                    <option value="source">原文</option>
                                    <option value="target">译文</option>
                                </select>
                            </div>
                            <input 
                                type="text" 
                                className="w-full border border-slate-300 rounded-lg p-2.5 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm font-mono"
                                placeholder={findUseRegex ? '替换模板，如 $1年$2月' : '输入替换后的文本...'}
                                value={replaceText}
                                onChange={(e) => setReplaceText(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <input 
                                    type="radio"
                                    id="scope-file"
                                    name="scope"
                                    checked={replaceScope === 'file'}
                                    onChange={() => setReplaceScope('file')}
                                    className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                                />
                                <label htmlFor="scope-file" className="text-sm text-slate-700">当前文件</label>
                            </div>
                            <div className="flex items-center gap-2">
                                <input 
                                    type="radio"
                                    id="scope-project"
                                    name="scope"
                                    checked={replaceScope === 'project'}
                                    onChange={() => setReplaceScope('project')}
                                    className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                                />
                                <label htmlFor="scope-project" className="text-sm text-slate-700">整个项目 (所有文件)</label>
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 mt-6">
                        <button 
                            onClick={handleFind}
                            disabled={!findText || (findUseRegex && !!findRegexError)}
                            className="px-4 py-2 text-slate-700 hover:bg-slate-100 border border-slate-300 rounded-lg"
                        >
                            查找
                        </button>
                        <button 
                            onClick={() => setIsReplaceModalOpen(false)}
                            className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg"
                        >
                            取消
                        </button>
                        <button 
                            onClick={handleReplaceAll}
                            disabled={!findText || (findUseRegex && !!findRegexError)}
                            className="px-4 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-md shadow-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            全部替换
                        </button>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-4 text-center">
                        注意：仅替换未锁定的句段。替换后状态将变为“草稿”。
                    </p>
                </div>
            </div>,
            document.body
        )}
        
        {/* Term Delete Modal (NEW) - USING PORTAL */}
        {termToDelete && createPortal(
            <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-in zoom-in-95 duration-200">
                    <div className="flex flex-col items-center text-center">
                        <div className="w-12 h-12 bg-red-100 text-red-500 rounded-full flex items-center justify-center mb-4">
                            <Icons.Trash className="w-6 h-6" />
                        </div>
                        <h2 className="text-lg font-bold text-slate-900 mb-2">删除术语</h2>
                        <p className="text-sm text-slate-500 mb-6">
                            您确定要删除术语 <b>"{termToDelete.source}"</b> 吗？<br/>此操作无法撤销。
                        </p>
                        <div className="flex gap-3 w-full">
                            <button 
                                onClick={() => setTermToDelete(null)}
                                className="flex-1 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
                            >
                                取消
                            </button>
                            <button 
                                onClick={handleDeleteTermConfirm}
                                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg shadow-md shadow-red-500/20"
                            >
                                确认删除
                            </button>
                        </div>
                    </div>
                </div>
            </div>,
            document.body
        )}

        {/* Smart Term Extraction Modal - USING PORTAL */}
        {isExtractModalOpen && createPortal(
            <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 animate-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col">
                    <div className="flex justify-between items-center mb-4 shrink-0">
                        <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                            <Icons.TermExtraction className="w-5 h-5 text-teal-600"/>
                            智能术语提取向导
                        </h2>
                        <button onClick={() => setIsExtractModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                            <Icons.X className="w-5 h-5" />
                        </button>
                    </div>

                    {extractStep === 'config' && (
                        <div className="space-y-6">
                            <div className="bg-teal-50 p-4 rounded-xl border border-teal-100 text-sm text-teal-800">
                                AI 将分析整个文档，自动识别并提取潜在的术语候选词。
                            </div>
                            
                            {/* Threshold */}
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-2">最小词频阈值</label>
                                <div className="flex items-center gap-4">
                                    <input 
                                        type="range" 
                                        min="1" max="10" 
                                        value={extractConfig.threshold}
                                        onChange={(e) => setExtractConfig({...extractConfig, threshold: Number(e.target.value)})}
                                        className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-teal-600"
                                    />
                                    <span className="font-mono bg-slate-100 px-2 py-1 rounded text-slate-600 text-sm font-bold min-w-[2rem] text-center">
                                        {extractConfig.threshold}
                                    </span>
                                </div>
                                <p className="text-xs text-slate-500 mt-1">仅提取在文中出现次数大于等于该值的词汇。</p>
                            </div>

                            {/* Categories */}
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-2">提取类型 (多选)</label>
                                <div className="grid grid-cols-2 gap-3">
                                    {[
                                        { id: 'technical', label: '专业术语 (Technical)' },
                                        { id: 'person', label: '人名 (Person)' },
                                        { id: 'location', label: '地名 (Location)' },
                                        { id: 'org', label: '机构名 (Organization)' }
                                    ].map(type => (
                                        <label key={type.id} className="flex items-center gap-2 p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors">
                                            <input 
                                                type="checkbox"
                                                checked={(extractConfig.types as any)[type.id]}
                                                onChange={(e) => setExtractConfig({
                                                    ...extractConfig, 
                                                    types: { ...extractConfig.types, [type.id]: e.target.checked }
                                                })}
                                                className="w-4 h-4 text-teal-600 rounded focus:ring-teal-500 border-gray-300"
                                            />
                                            <span className="text-sm font-medium text-slate-700">{type.label}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                            
                            <div className="pt-4 flex justify-end">
                                <button 
                                    onClick={handleStartExtraction}
                                    className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white px-6 py-2.5 rounded-lg font-bold shadow-lg shadow-teal-500/20 transition-all"
                                >
                                    <Icons.Sparkles className="w-4 h-4" />
                                    开始分析
                                </button>
                            </div>
                        </div>
                    )}

                    {extractStep === 'processing' && (
                        <div className="py-12 flex flex-col items-center text-center">
                             <div className="relative mb-6">
                                <div className="w-20 h-20 border-4 border-teal-100 border-t-teal-500 rounded-full animate-spin"></div>
                                <Icons.Sparkles className="w-8 h-8 text-teal-500 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 animate-pulse" />
                             </div>
                             <h3 className="text-lg font-bold text-slate-900 mb-2">AI 正在深度分析文档...</h3>
                             <p className="text-slate-500 max-w-xs">正在识别专业术语、人名、地名及机构名称。这可能需要几十秒钟，请稍候。</p>
                        </div>
                    )}

                    {extractStep === 'review' && (
                        <div className="flex flex-col h-full overflow-hidden">
                             <div className="bg-teal-50 border border-teal-100 rounded-lg p-3 mb-4 flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-center">
                                 <span className="text-sm text-teal-800 font-medium">
                                     共提取到 <b>{extractedCandidates.length}</b> 个候选术语
                                 </span>
                                 <div className="flex flex-wrap items-center gap-2 text-xs text-teal-700">
                                     <span className="text-teal-600">已选中 {Array.from(selectedCandidates).length} 个</span>
                                     <label className="flex items-center gap-1.5 font-medium">
                                         <span className="text-teal-800 shrink-0">导出范围</span>
                                         <select
                                             value={extractExportScope}
                                             onChange={(e) => setExtractExportScope(e.target.value as 'selected' | 'all')}
                                             className="rounded border border-teal-200 bg-white px-2 py-1 text-xs text-slate-800 focus:ring-1 focus:ring-teal-500"
                                         >
                                             <option value="selected">仅已勾选</option>
                                             <option value="all">全部候选</option>
                                         </select>
                                     </label>
                                 </div>
                             </div>
                             
                             <div className="flex-1 overflow-y-auto border border-slate-200 rounded-xl mb-4">
                                 <table className="w-full text-left text-sm">
                                     <thead className="bg-slate-50 sticky top-0 z-10 text-xs font-bold text-slate-500 uppercase">
                                         <tr>
                                             <th className="px-4 py-2 w-10">
                                                 <input 
                                                    type="checkbox" 
                                                    checked={selectedCandidates.size === extractedCandidates.length && extractedCandidates.length > 0}
                                                    onChange={(e) => {
                                                        if (e.target.checked) {
                                                            setSelectedCandidates(new Set(extractedCandidates.map(c => c.id)));
                                                        } else {
                                                            setSelectedCandidates(new Set());
                                                        }
                                                    }}
                                                    className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                                                 />
                                             </th>
                                             <th className="px-4 py-2">原文 (Source)</th>
                                             <th className="px-4 py-2">建议译文 (Target)</th>
                                             <th className="px-4 py-2 w-24">类型</th>
                                         </tr>
                                     </thead>
                                     <tbody className="divide-y divide-slate-100">
                                         {extractedCandidates.map((candidate, idx) => (
                                             <tr key={candidate.id} className="hover:bg-slate-50 group">
                                                 <td className="px-4 py-2">
                                                     <input 
                                                        type="checkbox"
                                                        checked={selectedCandidates.has(candidate.id)}
                                                        onChange={(e) => {
                                                            const newSet = new Set(selectedCandidates);
                                                            if (e.target.checked) newSet.add(candidate.id);
                                                            else newSet.delete(candidate.id);
                                                            setSelectedCandidates(newSet);
                                                        }}
                                                        className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                                                     />
                                                 </td>
                                                 <td className="px-4 py-2">
                                                     <input 
                                                        type="text" 
                                                        value={candidate.source}
                                                        onChange={(e) => handleCandidateChange(idx, 'source', e.target.value)}
                                                        className="w-full bg-transparent border-none outline-none focus:ring-1 focus:ring-blue-200 rounded px-1"
                                                     />
                                                 </td>
                                                 <td className="px-4 py-2">
                                                     <input 
                                                        type="text" 
                                                        value={candidate.target}
                                                        onChange={(e) => handleCandidateChange(idx, 'target', e.target.value)}
                                                        className="w-full bg-transparent border-none outline-none focus:ring-1 focus:ring-blue-200 rounded px-1 font-medium text-blue-700"
                                                     />
                                                 </td>
                                                 <td className="px-4 py-2">
                                                     <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
                                                         {candidate.type}
                                                     </span>
                                                 </td>
                                             </tr>
                                         ))}
                                     </tbody>
                                 </table>
                             </div>

                             <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-slate-100">
                                     <button
                                         type="button"
                                         onClick={handleLowercaseSelectedExtractCandidates}
                                         disabled={selectedCandidates.size === 0}
                                         className="inline-flex items-center justify-center px-4 py-2 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 rounded-lg text-sm font-medium disabled:opacity-50"
                                     >
                                         一键变小写
                                     </button>
                                     <button
                                         type="button"
                                         onClick={handleExportExtractCandidates}
                                         disabled={
                                             extractExportScope === 'all'
                                                 ? extractedCandidates.length === 0
                                                 : selectedCandidates.size === 0
                                         }
                                         className="inline-flex items-center justify-center gap-1.5 px-4 py-2 border border-teal-200 bg-teal-50 hover:bg-teal-100 text-teal-800 rounded-lg text-sm font-medium disabled:opacity-50"
                                     >
                                         <Icons.Download className="w-4 h-4" />
                                         导出 Excel
                                     </button>
                                     <button 
                                        type="button"
                                        onClick={handleImportCandidates}
                                        disabled={selectedCandidates.size === 0}
                                        className="px-6 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-bold shadow-lg shadow-teal-500/20 disabled:opacity-50"
                                     >
                                         将选定术语存入术语库 ({selectedCandidates.size})
                                     </button>
                             </div>
                        </div>
                    )}
                </div>
            </div>,
            document.body
        )}

        {mtCompareModalOpen &&
          createPortal(
            <MtCompareModal
              open={mtCompareModalOpen}
              onClose={() => setMtCompareModalOpen(false)}
              query={dictQuery}
              langPair={project ? `${project.sourceLang} → ${project.targetLang}` : ''}
              tagWarning={segmentMayHaveInlineTags(
                currentSelectedText.trim() || activeSegment?.sourceText || dictQuery
              )}
              autoLookup={mtReferenceSettings.autoLookupOnSegmentChange}
              onAutoLookupChange={(enabled) =>
                onUpdateMtReferenceSettings?.({
                  ...mtReferenceSettings,
                  autoLookupOnSegmentChange: enabled,
                })
              }
              translators={mtTranslatorOptions}
              compareTranslators={mtReferenceSettings.compareTranslators ?? []}
              onCompareTranslatorsChange={(ids) =>
                onUpdateMtReferenceSettings?.({
                  ...mtReferenceSettings,
                  compareTranslators: ids,
                })
              }
              onSwitchToSingleEngine={() => {
                onUpdateMtReferenceSettings?.({
                  ...mtReferenceSettings,
                  compareMode: false,
                });
                setBottomPanelTab('mt');
                setDictPanelOpen(true);
                setDictPanelCollapsed(false);
                const q = resolveSegmentSourceQuery();
                setDictQuery(q);
                if (q) void runMtReferenceLookup(q);
              }}
              results={mtCompareResults}
              selectedId={mtCompareSelectedId}
              onSelect={setMtCompareSelectedId}
              loading={mtLoading}
              error={mtError}
              onRefresh={() => void runMtReferenceLookup()}
              onCopy={handleCopyMtReference}
              onInsert={handleInsertMtReference}
            />,
            document.body
          )}

        {/* Batch Translation Modal - USING PORTAL */}
        {isBatchModalOpen && createPortal(
            <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
                     <div className="flex justify-between items-center mb-6 shrink-0">
                        <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                            <Icons.Zap className="w-5 h-5 text-indigo-600"/>
                            批量预翻译
                        </h2>
                        <button onClick={handleBatchModalClose} className="text-slate-400 hover:text-slate-600">
                            <Icons.X className="w-5 h-5" />
                        </button>
                    </div>

                    {batchStep === 'mode-select' && (
                        <div className="space-y-4">
                            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
                                <label className="text-xs font-semibold text-slate-600 block">快速模式策略</label>
                                <select
                                    value={batchStrategy}
                                    onChange={(e) => setBatchStrategy(e.target.value as PreTranslateStrategy)}
                                    className="w-full text-sm border border-slate-300 rounded-lg px-2 py-1.5"
                                >
                                    <option value="tmOnly">仅 TM（100% / 模糊）</option>
                                    <option value="tmMt">TM + MT 参考</option>
                                    <option value="tmLlm">TM + LLM</option>
                                    <option value="tmMtLlm">TM + MT + LLM</option>
                                    <option value="llmOnly">仅 LLM</option>
                                </select>
                                <label className="text-xs text-slate-500 flex items-center gap-2">
                                    TM 模糊阈值
                                    <input
                                        type="number"
                                        min={50}
                                        max={100}
                                        value={batchFuzzyThreshold}
                                        onChange={(e) => setBatchFuzzyThreshold(Number(e.target.value) || 75)}
                                        className="w-16 border border-slate-300 rounded px-1 py-0.5 text-sm"
                                    />
                                    %
                                </label>
                            </div>
                            <button 
                                onClick={() => executeBatchTranslation(false)}
                                className="w-full flex items-start gap-4 p-4 rounded-xl border border-slate-200 hover:border-blue-400 hover:bg-blue-50 transition-all text-left group"
                            >
                                <div className="p-3 bg-blue-100 text-blue-600 rounded-lg group-hover:bg-blue-200">
                                    <Icons.Zap className="w-6 h-6" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-800 mb-1">快速模式 (Fast)</h3>
                                    <p className="text-xs text-slate-500 leading-relaxed">
                                        按所选策略（TM / MT / LLM）填充未锁定的空句段。
                                    </p>
                                </div>
                            </button>

                            <button 
                                onClick={startSmartAnalysis}
                                className="w-full flex items-start gap-4 p-4 rounded-xl border border-slate-200 hover:border-purple-400 hover:bg-purple-50 transition-all text-left group"
                            >
                                <div className="p-3 bg-purple-100 text-purple-600 rounded-lg group-hover:bg-purple-200">
                                    <Icons.Sparkles className="w-6 h-6" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-800 mb-1">智能模式 (Context-Aware)</h3>
                                    <p className="text-xs text-slate-500 leading-relaxed">
                                        先分析文档风格，生成专属 Prompt，再进行翻译。质量更高，适合专业文档。
                                    </p>
                                </div>
                            </button>
                        </div>
                    )}

                    {batchStep === 'analyzing' && (
                        <div className="py-12 flex flex-col items-center text-center">
                            <Icons.Sparkles className="w-12 h-12 text-purple-500 animate-spin mb-4" />
                            <h3 className="text-lg font-bold text-slate-900 mb-2">正在分析文档风格...</h3>
                            <p className="text-slate-500 text-sm mb-6">读取采样句段，生成最佳翻译策略。</p>
                            <button
                                type="button"
                                onClick={handleBatchModalClose}
                                className="px-5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg border border-slate-200"
                            >
                                取消
                            </button>
                        </div>
                    )}

                    {batchStep === 'review-prompt' && (
                        <div className="flex flex-col h-full">
                            <label className="block text-sm font-semibold text-slate-700 mb-2">确认 AI 翻译指令</label>
                            <textarea 
                                value={batchPrompt}
                                onChange={(e) => setBatchPrompt(e.target.value)}
                                className="w-full flex-1 min-h-[150px] border border-slate-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-purple-200 outline-none resize-none mb-4"
                            />
                            <button 
                                onClick={() => executeBatchTranslation(true)}
                                className="w-full py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-bold shadow-lg shadow-purple-500/20"
                            >
                                开始翻译
                            </button>
                        </div>
                    )}

                    {batchStep === 'processing' && (
                        <div className="py-8">
                             <div className="mb-4 flex justify-between text-sm font-bold text-slate-700">
                                 <span>翻译进度</span>
                                 <span>{batchProgress.current} / {batchProgress.total}</span>
                             </div>
                             <div className="w-full bg-slate-100 h-4 rounded-full overflow-hidden mb-6">
                                 <div 
                                    className="h-full bg-gradient-to-r from-blue-500 to-indigo-600 transition-all duration-300 ease-out"
                                    style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
                                 />
                             </div>
                             <div className="grid grid-cols-2 gap-4 text-center">
                                 <div className="bg-green-50 p-3 rounded-lg border border-green-100">
                                     <div className="text-xl font-bold text-green-600">{batchStats.succeeded}</div>
                                     <div className="text-xs text-green-800">成功</div>
                                 </div>
                                 <div className="bg-red-50 p-3 rounded-lg border border-red-100">
                                     <div className="text-xl font-bold text-red-600">{batchStats.failed}</div>
                                     <div className="text-xs text-red-800">失败</div>
                                 </div>
                             </div>
                             <button
                                 type="button"
                                 onClick={handleBatchModalClose}
                                 className="mt-6 w-full py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg border border-slate-200"
                             >
                                 取消翻译
                             </button>
                        </div>
                    )}

                    {batchStep === 'done' && (
                        <div className="py-8 flex flex-col items-center text-center">
                            <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-4">
                                <Icons.Check className="w-8 h-8" strokeWidth={3} />
                            </div>
                            <h3 className="text-xl font-bold text-slate-900 mb-2">处理完成</h3>
                            <p className="text-slate-500 mb-6">
                                共处理 {batchProgress.total} 个句段。<br/>
                                成功: {batchStats.succeeded} | 失败: {batchStats.failed}
                                {batchSourceStats && (
                                  <>
                                    <br />
                                    TM: {batchSourceStats.tm} · 模糊: {batchSourceStats.fuzzy} · MT: {batchSourceStats.mt} · LLM: {batchSourceStats.llm}
                                  </>
                                )}
                            </p>
                            <button 
                                onClick={handleBatchModalClose}
                                className="px-8 py-2 bg-slate-900 text-white rounded-lg font-bold hover:bg-slate-800"
                            >
                                关闭
                            </button>
                        </div>
                    )}
                </div>
            </div>,
            document.body
        )}

        <QuickMtPopup
            open={quickMtOpen}
            sourceText={quickMtSource}
            sourceLang={project.sourceLang}
            targetLang={project.targetLang}
            mtSettings={mtReferenceSettings}
            onClose={() => setQuickMtOpen(false)}
            onInsert={(text) => {
                if (activeSegmentId) {
                    const cur = activeSegment?.targetText || '';
                    handleSegmentChange(activeSegmentId, cur ? `${cur} ${text}` : text);
                }
            }}
        />

        {isProofreadModalOpen && createPortal(
            <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
                    <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                        <Icons.ClipboardCheck className="w-5 h-5 text-purple-600" />
                        批量 AI 校对
                    </h2>
                    {isProofreadRunning ? (
                        <>
                            <p className="text-sm text-slate-600 mb-3">
                                进度 {proofreadProgress.current} / {proofreadProgress.total}
                            </p>
                            <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden mb-4">
                                <div
                                    className="h-full bg-purple-500 transition-all"
                                    style={{
                                        width: `${proofreadProgress.total ? (proofreadProgress.current / proofreadProgress.total) * 100 : 0}%`,
                                    }}
                                />
                            </div>
                            <button
                                type="button"
                                onClick={() => { proofreadCancelRef.current += 1; setIsProofreadRunning(false); setIsProofreadModalOpen(false); }}
                                className="w-full py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50"
                            >
                                取消
                            </button>
                        </>
                    ) : (
                        <>
                            {proofreadStats && (
                                <p className="text-sm text-slate-600 mb-4">
                                    已校对 {proofreadStats.processed} 句；发现问题 {proofreadStats.withIssues} 句；失败 {proofreadStats.failed} 句。
                                </p>
                            )}
                            <button
                                type="button"
                                onClick={() => setIsProofreadModalOpen(false)}
                                className="w-full py-2 bg-slate-900 text-white rounded-lg font-medium"
                            >
                                关闭
                            </button>
                        </>
                    )}
                </div>
            </div>,
            document.body
        )}

        {twinLearningCapModal && (
            <div
                className="fixed inset-0 z-[400] flex items-center justify-center p-4 bg-black/50"
                role="dialog"
                aria-modal="true"
                aria-labelledby="twin-cap-modal-title"
            >
                <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6">
                    <h3 id="twin-cap-modal-title" className="text-lg font-semibold text-slate-900 mb-2">
                        孪生译员学习例句已达上限
                    </h3>
                    <p className="text-slate-600 text-sm mb-4 leading-relaxed">
                        译员「{twinLearningCapModal.translatorName}」在库中最多保留{' '}
                        <span className="font-semibold text-slate-800">{MAX_STORED_TRAINING_EXAMPLES}</span>{' '}
                        条学习例句，界面上的「已学习」数字与库内条数一致。
                        {twinLearningCapModal.kind === 'first_full' ? (
                            <>
                                <br />
                                <br />
                                现已存满；之后若继续学习，新例句将自动替换最旧的一条。
                            </>
                        ) : (
                            <>
                                <br />
                                <br />
                                本次新学的一条已写入，最早的一条已被移除。
                            </>
                        )}
                        <br />
                        <br />
                        建议您导出 Excel 备份，或按需将当前全部例句另存为「翻译知识库」，以免重要语料丢失。
                    </p>
                    <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                        <button
                            type="button"
                            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50"
                            onClick={() => setTwinLearningCapModal(null)}
                            disabled={twinKbSaving}
                        >
                            稍后
                        </button>
                        <button
                            type="button"
                            className="px-4 py-2 text-sm font-medium text-slate-800 bg-slate-100 border border-slate-200 rounded-lg hover:bg-slate-200 disabled:opacity-50"
                            onClick={handleTwinCapModalExportExcel}
                            disabled={twinKbSaving}
                        >
                            导出 Excel 备份
                        </button>
                        <button
                            type="button"
                            className="px-4 py-2 text-sm font-medium text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            title={
                                onKnowledgeBasesChange
                                    ? undefined
                                    : '当前页面未接入知识库保存，请从项目编辑器进入。'
                            }
                            disabled={twinKbSaving || !onKnowledgeBasesChange}
                            onClick={() => {
                                if (!onKnowledgeBasesChange) return;
                                const bindHint = project?.id
                                    ? `新知识库将绑定当前项目「${project.name}」。`
                                    : '当前未打开具体项目，将以「全局」知识库保存（对所有项目生效）。';
                                if (
                                    !confirm(
                                        `${bindHint}\n\n将把当前 ${MAX_STORED_TRAINING_EXAMPLES} 条学习例句写入知识库正文并自动切块；若已在系统设置中启用本地向量服务，将尝试生成向量。\n\n确定继续？`
                                    )
                                ) {
                                    return;
                                }
                                void handleTwinCapModalSaveKnowledgeBase();
                            }}
                        >
                            {twinKbSaving ? '保存中…' : '另存为知识库'}
                        </button>
                    </div>
                </div>
            </div>
        )}
    </div>
  );
};