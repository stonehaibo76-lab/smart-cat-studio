import React, { useState } from 'react';
import { TwinTranslatorProfile, TrainingExample, AISettings } from '../types';
import { DEEPSEEK_MODEL_OPTIONS } from '../constants';
import * as XLSX from 'xlsx';
import { saveTwinTranslators } from '../services/db';
import {
  createTwinTranslatorProfile,
  buildLearnedSegmentExportRows,
  MAX_STORED_TRAINING_EXAMPLES,
  computeTwinSuggestionSuccessRate,
  computeTwinAverageConfidence,
  formatTrainingExamplesAsKnowledgeBaseRawText,
  formatAllTranslatorsTrainingExamplesAsKnowledgeBaseRawText,
  languagePairFromProjectLocales,
  normalizeTwinBaseModel,
  primaryLanguageCode
} from '../services/twinTranslatorService';
import { SUPPORTED_LANGUAGES } from '../constants';
import { Icons } from '../components/ui/Icons';

const TWIN_LANGUAGE_PAIR_CUSTOM = 'custom';

const PRESET_TWIN_LANGUAGE_PAIRS = [
  { value: 'en-zh', label: '英文 → 中文' },
  { value: 'zh-en', label: '中文 → 英文' },
  { value: 'zh-es', label: '中文 → 西语' },
  { value: 'ja-zh', label: '日文 → 中文' },
  { value: 'ko-zh', label: '韩文 → 中文' },
  { value: 'fr-zh', label: '法文 → 中文' },
  { value: 'de-zh', label: '德文 → 中文' }
];

function splitTwinLanguagePairKey(pair: string): [string, string] | null {
  const i = pair.indexOf('-');
  if (i <= 0 || i >= pair.length - 1) return null;
  return [pair.slice(0, i), pair.slice(i + 1)];
}

/** 卡片/预览：预设走中文标签，否则用 SUPPORTED_LANGUAGES 解析主语言码 */
function formatTwinLanguagePairDisplay(pair: string): string {
  const preset = PRESET_TWIN_LANGUAGE_PAIRS.find((p) => p.value === pair);
  if (preset) return preset.label;
  const parts = splitTwinLanguagePairKey(pair);
  if (!parts) return pair.replace('-', ' → ');
  const labelForCode = (code: string) => {
    const low = code.toLowerCase();
    const lang = SUPPORTED_LANGUAGES.find(
      (l) => primaryLanguageCode(l.code) === low || l.code.toLowerCase() === low
    );
    return lang?.name ?? code.toUpperCase();
  };
  return `${labelForCode(parts[0])} → ${labelForCode(parts[1])}`;
}

function pickDefaultTwinBaseModel(ai: AISettings): string {
  const v = ai.model?.trim();
  if (v && DEEPSEEK_MODEL_OPTIONS.some((m) => m.value === v)) return v;
  return DEEPSEEK_MODEL_OPTIONS[0].value;
}

interface TwinTranslatorsPageProps {
  twinTranslators: TwinTranslatorProfile[];
  onTranslatorsChange: (translators: TwinTranslatorProfile[]) => void;
  aiSettings: AISettings;
}

const buildTwinTranslatorExportRow = (item: TwinTranslatorProfile) => ({
  ...item,
  styleFeatures: JSON.stringify(item.styleFeatures),
  habitualTranslations: JSON.stringify(item.habitualTranslations),
  terminologyMappings: JSON.stringify(item.terminologyMappings),
  preferences: JSON.stringify(item.preferences),
  trainingExamples: JSON.stringify(item.trainingExamples),
  domainWeights: JSON.stringify(item.domainWeights),
  negativeExamples: JSON.stringify(item.negativeExamples)
});

export const TwinTranslatorsPage: React.FC<TwinTranslatorsPageProps> = ({
  twinTranslators,
  onTranslatorsChange,
  aiSettings
}) => {
  const importFileInputRef = React.useRef<HTMLInputElement | null>(null);
  const singleTranslatorImportInputRef = React.useRef<HTMLInputElement | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedTranslator, setSelectedTranslator] = useState<TwinTranslatorProfile | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  /** 导出已学习句段（全部或单个）：选择 Excel 或知识库正文 */
  const [learnedExportScope, setLearnedExportScope] = useState<
    null | { kind: 'all' } | { kind: 'single'; translatorId: string }
  >(null);
  
  // 新建译员表单
  const [newTranslatorName, setNewTranslatorName] = useState('');
  const [newTranslatorDescription, setNewTranslatorDescription] = useState('');
  const [newLanguagePairSelect, setNewLanguagePairSelect] = useState('en-zh');
  const [newCustomSourceLang, setNewCustomSourceLang] = useState('en-US');
  const [newCustomTargetLang, setNewCustomTargetLang] = useState('ja-JP');
  const [newBaseModel, setNewBaseModel] = useState(DEEPSEEK_MODEL_OPTIONS[0].value);
  const [newUseKnowledgeBase, setNewUseKnowledgeBase] = useState(false);

  const resetCreateModalForm = () => {
    setNewTranslatorName('');
    setNewTranslatorDescription('');
    setNewLanguagePairSelect('en-zh');
    setNewCustomSourceLang('en-US');
    setNewCustomTargetLang('ja-JP');
    setNewBaseModel(pickDefaultTwinBaseModel(aiSettings));
    setNewUseKnowledgeBase(false);
  };

  const effectiveNewLanguagePair =
    newLanguagePairSelect === TWIN_LANGUAGE_PAIR_CUSTOM
      ? languagePairFromProjectLocales(newCustomSourceLang, newCustomTargetLang)
      : newLanguagePairSelect;

  // 创建新译员
  const handleCreateTranslator = async () => {
    if (!newTranslatorName.trim()) {
      alert('请输入译员名称');
      return;
    }

    if (newLanguagePairSelect === TWIN_LANGUAGE_PAIR_CUSTOM) {
      if (
        primaryLanguageCode(newCustomSourceLang) ===
        primaryLanguageCode(newCustomTargetLang)
      ) {
        alert('自定义语言对时，源语言与目标语言不能相同');
        return;
      }
    }

    const pairKey = effectiveNewLanguagePair;

    setIsSaving(true);
    try {
      const newTranslator: TwinTranslatorProfile = {
        ...createTwinTranslatorProfile(
          newTranslatorName.trim(),
          newTranslatorDescription.trim(),
          pairKey,
          newBaseModel
        ),
        useKnowledgeBaseForSuggestions: newUseKnowledgeBase
      };

      // 更新本地状态
      const updatedTranslators = [...twinTranslators, newTranslator];
      onTranslatorsChange(updatedTranslators);
      await saveTwinTranslators(updatedTranslators);

      resetCreateModalForm();
      setShowCreateModal(false);
      
      alert('孪生译员创建成功！');
    } catch (error) {
      console.error('创建译员失败:', error);
      alert('创建失败，请重试');
    } finally {
      setIsSaving(false);
    }
  };

  // 删除译员
  const handleDeleteTranslator = async () => {
    if (!selectedTranslator) return;

    setIsSaving(true);
    try {
      // 更新本地状态
      const updatedTranslators = twinTranslators.filter(t => t.id !== selectedTranslator.id);
      onTranslatorsChange(updatedTranslators);
      await saveTwinTranslators(updatedTranslators);

      setShowDeleteModal(false);
      setSelectedTranslator(null);
      
      alert('孪生译员已删除');
    } catch (error) {
      console.error('删除译员失败:', error);
      alert('删除失败，请重试');
    } finally {
      setIsSaving(false);
    }
  };

  // 重置译员学习数据
  const handleResetTranslator = async (translator: TwinTranslatorProfile) => {
    if (!confirm(`确定要重置译员 "${translator.name}" 的学习数据吗？这将清除所有学习记录。`)) {
      return;
    }

    setIsSaving(true);
    try {
      const now = new Date().toISOString();
      const resetTranslator: TwinTranslatorProfile = {
        ...translator,
        learnedSegments: 0,
        trainingDataSize: 0,
        habitualTranslations: [],
        trainingExamples: [],
        trainingStatus: 'idle',
        lastTrained: now,
        successRate: 0,
        averageConfidence: 0,
        twinSuggestionOfferCount: 0,
        twinSuggestionAdoptionCount: 0,
        twinSuggestionNegativeRatingCount: 0
      };

      // 更新本地状态
      const updatedTranslators = twinTranslators.map(t => 
        t.id === translator.id ? resetTranslator : t
      );
      onTranslatorsChange(updatedTranslators);
      await saveTwinTranslators(updatedTranslators);

      alert('学习数据已重置');
    } catch (error) {
      console.error('重置译员失败:', error);
      alert('重置失败，请重试');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleKnowledgeBase = async (
    translator: TwinTranslatorProfile,
    useKnowledgeBase: boolean
  ) => {
    const updated: TwinTranslatorProfile = {
      ...translator,
      useKnowledgeBaseForSuggestions: useKnowledgeBase
    };
    setIsSaving(true);
    try {
      const updatedTranslators = twinTranslators.map(t =>
        t.id === translator.id ? updated : t
      );
      onTranslatorsChange(updatedTranslators);
      await saveTwinTranslators(updatedTranslators);
    } catch (error) {
      console.error('更新译员设置失败:', error);
      alert('保存失败，请重试');
    } finally {
      setIsSaving(false);
    }
  };

  const ensureArray = <T,>(value: unknown): T[] => {
    return Array.isArray(value) ? (value as T[]) : [];
  };

  const ensureObjectRecord = (value: unknown): Record<string, number> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out: Record<string, number> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      const num = Number(raw);
      if (Number.isFinite(num)) out[key] = num;
    }
    return out;
  };

  const buildTranslatorFromImport = (
    rawItem: Record<string, unknown>,
    index: number
  ): TwinTranslatorProfile | null => {
    const parsedName = String(rawItem.name ?? rawItem['名称'] ?? '').trim();
    if (!parsedName) return null;

    const fallback = createTwinTranslatorProfile(
      parsedName,
      String(rawItem.description ?? rawItem['描述'] ?? '').trim(),
      String(rawItem.languagePair ?? rawItem['语言对'] ?? 'en-zh'),
      String(rawItem.baseModel ?? rawItem['基础模型'] ?? '')
    );

    const createdAt = String(rawItem.createdAt ?? fallback.createdAt);
    const lastTrained = String(rawItem.lastTrained ?? createdAt);
    const trainingExamples = ensureArray<TrainingExample>(rawItem.trainingExamples);
    const exampleCount = trainingExamples.length;

    const imported: TwinTranslatorProfile = {
      ...fallback,
      ...rawItem,
      id: String(rawItem.id ?? `tt-import-${Date.now()}-${index}`),
      name: parsedName,
      description: String(rawItem.description ?? rawItem['描述'] ?? ''),
      languagePair: String(rawItem.languagePair ?? rawItem['语言对'] ?? fallback.languagePair),
      baseModel: normalizeTwinBaseModel(
        String(rawItem.baseModel ?? rawItem['基础模型'] ?? fallback.baseModel)
      ),
      styleFeatures:
        rawItem.styleFeatures && typeof rawItem.styleFeatures === 'object'
          ? { ...fallback.styleFeatures, ...(rawItem.styleFeatures as Record<string, unknown>) }
          : fallback.styleFeatures,
      preferences:
        rawItem.preferences && typeof rawItem.preferences === 'object'
          ? { ...fallback.preferences, ...(rawItem.preferences as Record<string, unknown>) }
          : fallback.preferences,
      habitualTranslations: ensureArray(rawItem.habitualTranslations),
      trainingExamples,
      terminologyMappings: ensureArray(rawItem.terminologyMappings),
      domainWeights: ensureObjectRecord(rawItem.domainWeights),
      negativeExamples: ensureArray(rawItem.negativeExamples),
      learnedSegments: exampleCount,
      trainingDataSize: exampleCount,
      temporalDecayAlpha: Number(rawItem.temporalDecayAlpha ?? fallback.temporalDecayAlpha) || fallback.temporalDecayAlpha,
      successRate: Number(rawItem.successRate ?? fallback.successRate) || 0,
      averageConfidence: Number(rawItem.averageConfidence ?? fallback.averageConfidence) || 0,
      twinSuggestionOfferCount: Number(rawItem.twinSuggestionOfferCount ?? fallback.twinSuggestionOfferCount ?? 0) || 0,
      twinSuggestionAdoptionCount: Number(rawItem.twinSuggestionAdoptionCount ?? fallback.twinSuggestionAdoptionCount ?? 0) || 0,
      twinSuggestionNegativeRatingCount:
        Number(rawItem.twinSuggestionNegativeRatingCount ?? fallback.twinSuggestionNegativeRatingCount ?? 0) || 0,
      createdAt,
      lastTrained
    };
    const successRate = computeTwinSuggestionSuccessRate(imported);
    return {
      ...imported,
      successRate,
      averageConfidence: computeTwinAverageConfidence({ ...imported, successRate })
    };
  };

  const sanitizeFileNamePart = (name: string) =>
    name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().slice(0, 80) || '译员';

  const downloadUtf8TextFile = (content: string, fileName: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportLearnedSegmentsExcelAll = () => {
    const rows = twinTranslators.flatMap(t => buildLearnedSegmentExportRows(t));
    if (rows.length === 0) {
      alert('当前没有任何已学习句段可导出。');
      return;
    }
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '已学习句段');
    const fileName = `孪生译员_已学习句段_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  };

  const exportLearnedSegmentsKbTxtAll = () => {
    const text = formatAllTranslatorsTrainingExamplesAsKnowledgeBaseRawText(twinTranslators);
    if (!text) {
      alert('当前没有任何已学习句段可导出。');
      return;
    }
    const fileName = `孪生译员_已学习句段_知识库正文_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
    downloadUtf8TextFile(text, fileName);
  };

  const exportLearnedSegmentsExcelSingle = (translator: TwinTranslatorProfile) => {
    const rows = buildLearnedSegmentExportRows(translator);
    if (rows.length === 0) {
      alert(`译员「${translator.name}」暂无已学习句段。`);
      return;
    }
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '已学习句段');
    const safeName = sanitizeFileNamePart(translator.name);
    const fileName = `孪生译员_${safeName}_已学习句段_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  };

  const exportLearnedSegmentsKbTxtSingle = (translator: TwinTranslatorProfile) => {
    const text = formatTrainingExamplesAsKnowledgeBaseRawText(translator);
    if (!text) {
      alert(`译员「${translator.name}」暂无已学习句段。`);
      return;
    }
    const safeName = sanitizeFileNamePart(translator.name);
    const fileName = `孪生译员_${safeName}_知识库正文_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
    downloadUtf8TextFile(text, fileName);
  };

  const openLearnedExportModalAll = () => {
    if (twinTranslators.length === 0) {
      alert('当前没有孪生译员。');
      return;
    }
    setLearnedExportScope({ kind: 'all' });
  };

  const openLearnedExportModalSingle = (translator: TwinTranslatorProfile) => {
    if ((translator.trainingExamples?.length ?? 0) === 0) {
      alert(`译员「${translator.name}」暂无已学习句段。`);
      return;
    }
    setLearnedExportScope({ kind: 'single', translatorId: translator.id });
  };

  const handleExportBackup = () => {
    if (twinTranslators.length === 0) {
      alert('当前没有可导出的孪生译员数据。');
      return;
    }

    const exportRows = twinTranslators.map(buildTwinTranslatorExportRow);

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'TwinTranslators');
    const fileName = `孪生译员备份_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  };

  /** 导出单个译员的完整档案（与全量备份相同的 Excel 列结构，便于单独备份与还原） */
  const handleExportSingleTranslatorData = (translator: TwinTranslatorProfile) => {
    const exportRows = [buildTwinTranslatorExportRow(translator)];
    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'TwinTranslators');
    const safeName = sanitizeFileNamePart(translator.name);
    const fileName = `孪生译员_${safeName}_数据_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  };

  const tryParseJsonField = (value: unknown): unknown => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed) return value;
    if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return value;
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  };

  const handleImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
    if (!isExcel) {
      alert('仅支持 Excel 文件（.xlsx / .xls）。');
      return;
    }

    setIsSaving(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        alert('导入文件为空，请检查 Excel 内容。');
        return;
      }
      const worksheet = workbook.Sheets[firstSheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
        raw: false,
        defval: ''
      });
      if (!rows.length) {
        alert('未读取到可导入的数据行。');
        return;
      }

      const imported = rows
        .map((row, index) => {
          const normalized: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(row)) {
            normalized[key] = tryParseJsonField(value);
          }
          return buildTranslatorFromImport(normalized, index);
        })
        .filter((item): item is TwinTranslatorProfile => item !== null);

      if (!imported.length) {
        alert('导入失败：未识别到有效的孪生译员记录。');
        return;
      }

      const shouldReplace = confirm(
        `检测到 ${imported.length} 条孪生译员记录。\n点击“确定”将覆盖当前全部数据；点击“取消”将按 ID 合并导入。`
      );

      const mergedById = new Map<string, TwinTranslatorProfile>();
      if (!shouldReplace) {
        for (const t of twinTranslators) mergedById.set(t.id, t);
      }
      for (const t of imported) mergedById.set(t.id, t);
      const next = shouldReplace ? imported : Array.from(mergedById.values());

      await saveTwinTranslators(next);
      onTranslatorsChange(next);
      alert(
        shouldReplace
          ? `导入成功，已覆盖为 ${next.length} 条孪生译员。`
          : `导入成功，已合并 ${imported.length} 条记录，当前共 ${next.length} 条。`
      );
    } catch (error) {
      console.error('导入孪生译员失败:', error);
      alert('导入失败，请检查 Excel 格式是否正确。');
    } finally {
      setIsSaving(false);
    }
  };

  /** 从 Excel 导入若干译员并与当前列表按 ID 合并（同 ID 覆盖）；不删除未出现在文件中的译员 */
  const handleSingleTranslatorImportFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
    if (!isExcel) {
      alert('仅支持 Excel 文件（.xlsx / .xls）。');
      return;
    }

    setIsSaving(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        alert('导入文件为空，请检查 Excel 内容。');
        return;
      }
      const worksheet = workbook.Sheets[firstSheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
        raw: false,
        defval: ''
      });
      if (!rows.length) {
        alert('未读取到可导入的数据行。');
        return;
      }

      const imported = rows
        .map((row, index) => {
          const normalized: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(row)) {
            normalized[key] = tryParseJsonField(value);
          }
          return buildTranslatorFromImport(normalized, index);
        })
        .filter((item): item is TwinTranslatorProfile => item !== null);

      if (!imported.length) {
        alert('导入失败：未识别到有效的孪生译员记录。');
        return;
      }

      const overlapIds = imported.filter(t => twinTranslators.some(x => x.id === t.id)).map(t => t.id);
      const overlapNote =
        overlapIds.length > 0
          ? `\n其中 ${overlapIds.length} 条与当前列表中的译员 ID 相同，将覆盖对应译员。`
          : '';

      if (
        !confirm(
          `将导入 ${imported.length} 条孪生译员并与当前列表按 ID 合并（同 ID 覆盖，其余译员保留）。${overlapNote}\n确定继续？`
        )
      ) {
        return;
      }

      const mergedById = new Map<string, TwinTranslatorProfile>();
      for (const t of twinTranslators) mergedById.set(t.id, t);
      for (const t of imported) mergedById.set(t.id, t);
      const next = Array.from(mergedById.values());

      await saveTwinTranslators(next);
      onTranslatorsChange(next);
      alert(`导入成功，当前共 ${next.length} 条孪生译员。`);
    } catch (error) {
      console.error('导入孪生译员失败:', error);
      alert('导入失败，请检查 Excel 格式是否正确。');
    } finally {
      setIsSaving(false);
    }
  };

  // 格式化日期
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // 获取状态标签
  const getStatusLabel = (status: TwinTranslatorProfile['trainingStatus']) => {
    switch (status) {
      case 'idle': return '待学习';
      case 'training': return '学习中';
      case 'ready': return '就绪';
      case 'needs_update': return '需更新';
      default: return '未知';
    }
  };

  // 获取状态颜色
  const getStatusColor = (status: TwinTranslatorProfile['trainingStatus']) => {
    switch (status) {
      case 'ready': return 'text-green-600 bg-green-100';
      case 'training': return 'text-blue-600 bg-blue-100';
      case 'needs_update': return 'text-yellow-600 bg-yellow-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const learnedExportSingleTranslator =
    learnedExportScope?.kind === 'single'
      ? twinTranslators.find(t => t.id === learnedExportScope.translatorId)
      : null;

  return (
    <div className="h-full flex flex-col">
        {/* 头部 */}
        <div className="border-b border-slate-200 bg-white px-6 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-slate-900">孪生译员管理</h1>
            <div className="flex items-center gap-3">
              <input
                ref={importFileInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleImportFileChange}
              />
              <input
                ref={singleTranslatorImportInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleSingleTranslatorImportFileChange}
              />
              <button
                onClick={openLearnedExportModalAll}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                title="导出所有译员的已学习句段（Excel 或知识库正文）"
              >
                <Icons.File className="w-4 h-4 inline mr-2" />
                导出所有已学习句段
              </button>
              <button
                onClick={handleExportBackup}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                title="导出全部译员的完整档案（Excel）"
              >
                <Icons.Download className="w-4 h-4 inline mr-2" />
                导出备份
              </button>
              <button
                onClick={() => importFileInputRef.current?.click()}
                disabled={isSaving}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
                title="从 Excel 恢复：可覆盖全部或按 ID 合并"
              >
                <Icons.Upload className="w-4 h-4 inline mr-2" />
                导入备份
              </button>
              <button
                onClick={() => {
                  resetCreateModalForm();
                  setShowCreateModal(true);
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <Icons.Plus className="w-4 h-4 inline mr-2" />
                创建新译员
              </button>
            </div>
          </div>
          <p className="mt-2 text-sm text-slate-600">
            孪生译员能学习您的翻译风格，提供个性化的译文建议。每个译员可以针对不同的语言对和领域。
          </p>
        </div>

        {/* 主要内容 */}
        <div className="flex-1 overflow-y-auto p-6">
          {twinTranslators.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-4 bg-slate-100 rounded-full flex items-center justify-center">
                <Icons.User className="w-8 h-8 text-slate-400" />
              </div>
              <h3 className="text-lg font-medium text-slate-900 mb-2">暂无孪生译员</h3>
              <p className="text-slate-600 mb-6 max-w-md mx-auto">
                创建您的第一个孪生译员，让它学习您的翻译风格，提供个性化的译文建议。
              </p>
              <button
                onClick={() => {
                  resetCreateModalForm();
                  setShowCreateModal(true);
                }}
                className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                创建第一个译员
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {twinTranslators.map((translator) => {
                const exCount = translator.trainingExamples?.length ?? 0;
                const capPct = Math.min(100, (exCount / MAX_STORED_TRAINING_EXAMPLES) * 100);
                return (
                <div 
                  key={translator.id} 
                  className="bg-white border border-slate-200 rounded-xl shadow-sm hover:shadow-md transition-shadow"
                >
                  {/* 卡片头部 */}
                  <div className="p-5 border-b border-slate-100">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-lg font-semibold text-slate-900 truncate">
                          {translator.name}
                        </h3>
                        <p className="text-sm text-slate-500 truncate">
                          {translator.description || '暂无描述'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${getStatusColor(translator.trainingStatus)}`}>
                          {getStatusLabel(translator.trainingStatus)}
                        </span>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-600">
                        {formatTwinLanguagePairDisplay(translator.languagePair)}
                      </span>
                      <span className="text-slate-500">{formatDate(translator.lastTrained)}</span>
                    </div>
                  </div>

                  {/* 卡片内容 */}
                  <div className="p-5">
                    {/* 学习进度 */}
                    <div className="mb-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-slate-700">学习进度</span>
                        <span className="text-sm text-slate-600">
                          已学习 {exCount} / {MAX_STORED_TRAINING_EXAMPLES} 句段
                        </span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2">
                        <div 
                          className={`h-2 rounded-full ${
                            exCount >= 20 ? 'bg-green-500' :
                            exCount >= 10 ? 'bg-blue-500' : 'bg-yellow-500'
                          }`}
                          style={{ width: `${capPct}%` }}
                        />
                      </div>
                      {exCount >= MAX_STORED_TRAINING_EXAMPLES && (
                        <p className="text-xs text-amber-700 mt-2 leading-snug">
                          已达存储上限；继续学习将替换最旧例句。建议在编辑器学习提示或本页导出备份。
                        </p>
                      )}
                    </div>

                    {/* 关键指标 */}
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div className="bg-slate-50 p-3 rounded-lg">
                        <div className="text-xs text-slate-500 mb-1">采纳率</div>
                        <div className="text-lg font-semibold text-slate-900">
                          {translator.successRate.toFixed(1)}%
                        </div>
                      </div>
                      <div className="bg-slate-50 p-3 rounded-lg">
                        <div className="text-xs text-slate-500 mb-1">习惯译法</div>
                        <div className="text-lg font-semibold text-slate-900">
                          {translator.habitualTranslations.length}
                        </div>
                      </div>
                      <div className="bg-slate-50 p-3 rounded-lg">
                        <div className="text-xs text-slate-500 mb-1">置信度</div>
                        <div className="text-lg font-semibold text-slate-900">
                          {(translator.averageConfidence * 100).toFixed(0)}%
                        </div>
                      </div>
                      <div className="bg-slate-50 p-3 rounded-lg">
                        <div className="text-xs text-slate-500 mb-1">训练数据</div>
                        <div className="text-lg font-semibold text-slate-900">
                          {exCount}
                        </div>
                      </div>
                    </div>

                    <label className="flex items-start gap-2 cursor-pointer mb-5 pb-5 border-b border-slate-100">
                      <input
                        type="checkbox"
                        className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        checked={translator.useKnowledgeBaseForSuggestions === true}
                        disabled={isSaving}
                        onChange={e =>
                          handleToggleKnowledgeBase(translator, e.target.checked)
                        }
                      />
                      <span className="text-sm min-w-0">
                        <span className="font-medium text-slate-800">
                          生成建议时使用翻译知识库
                        </span>
                        <span className="block text-slate-500 mt-0.5 leading-snug">
                          关闭后不检索本地知识库（RAG），生成通常更快。
                        </span>
                      </span>
                    </label>

                    {/* 风格特征摘要 */}
                    <div className="mb-5">
                      <h4 className="text-sm font-medium text-slate-700 mb-2">风格特征</h4>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-slate-600">正式程度</span>
                          <span className="font-medium">{translator.styleFeatures.formalLevel.toFixed(0)}/100</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-slate-600">术语一致性</span>
                          <span className="font-medium">{translator.styleFeatures.terminologyConsistency.toFixed(0)}%</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-slate-600">句子长度</span>
                          <span className="font-medium">{translator.styleFeatures.sentenceLengthAvg.toFixed(1)}字</span>
                        </div>
                      </div>
                    </div>

                    {/* 操作按钮 */}
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => handleExportSingleTranslatorData(translator)}
                        className="w-full px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        title="导出该译员的完整档案（风格、例句、习惯译法等），与全量备份格式一致"
                      >
                        <Icons.Download className="w-4 h-4 inline mr-1" />
                        导出译员数据
                      </button>
                      <button
                        type="button"
                        onClick={() => singleTranslatorImportInputRef.current?.click()}
                        disabled={isSaving}
                        className="w-full px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
                        title="从单译员或局部 Excel 按 ID 合并到当前列表（同 ID 覆盖）"
                      >
                        <Icons.Upload className="w-4 h-4 inline mr-1" />
                        导入译员数据
                      </button>
                      <button
                        type="button"
                        onClick={() => openLearnedExportModalSingle(translator)}
                        className="w-full px-3 py-2 text-sm font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-400"
                        disabled={exCount === 0}
                        title="将该译员的已学习句段导出为 Excel 或知识库正文"
                      >
                        <Icons.File className="w-4 h-4 inline mr-1" />
                        导出已学习句段
                      </button>
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => handleResetTranslator(translator)}
                          className="flex-1 px-3 py-2 text-sm font-medium text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg hover:bg-yellow-100 focus:outline-none focus:ring-2 focus:ring-yellow-500"
                          disabled={exCount === 0}
                        >
                          <Icons.Refresh className="w-4 h-4 inline mr-1" />
                          重置
                        </button>
                        <button
                          onClick={() => {
                            setSelectedTranslator(translator);
                            setShowDeleteModal(true);
                          }}
                          className="flex-1 px-3 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500"
                        >
                          <Icons.Trash className="w-4 h-4 inline mr-1" />
                          删除
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );})}
            </div>
          )}

          {/* 创建模态框 */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-slate-900 mb-4">创建孪生译员</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    译员名称 *
                  </label>
                  <input
                    type="text"
                    value={newTranslatorName}
                    onChange={(e) => setNewTranslatorName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="如：技术文档专家、文学翻译助手"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    描述（可选）
                  </label>
                  <textarea
                    value={newTranslatorDescription}
                    onChange={(e) => setNewTranslatorDescription(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="描述该译员的特点和适用场景"
                    rows={2}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    语言对 *
                  </label>
                  <select
                    value={newLanguagePairSelect}
                    onChange={(e) => setNewLanguagePairSelect(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {PRESET_TWIN_LANGUAGE_PAIRS.map((pair) => (
                      <option key={pair.value} value={pair.value}>
                        {pair.label}
                      </option>
                    ))}
                    <option value={TWIN_LANGUAGE_PAIR_CUSTOM}>自定义…</option>
                  </select>
                  {newLanguagePairSelect === TWIN_LANGUAGE_PAIR_CUSTOM ? (
                    <div className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-600">
                            源语言
                          </label>
                          <select
                            value={newCustomSourceLang}
                            onChange={(e) => setNewCustomSourceLang(e.target.value)}
                            className="w-full px-2 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            {SUPPORTED_LANGUAGES.map((l) => (
                              <option key={l.code} value={l.code}>
                                {l.name} ({l.code})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-600">
                            目标语言
                          </label>
                          <select
                            value={newCustomTargetLang}
                            onChange={(e) => setNewCustomTargetLang(e.target.value)}
                            className="w-full px-2 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            {SUPPORTED_LANGUAGES.map((l) => (
                              <option key={l.code} value={l.code}>
                                {l.name} ({l.code})
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <p className="text-xs text-slate-600">
                        当前语言对：
                        <span className="font-medium text-slate-800">
                          {formatTwinLanguagePairDisplay(effectiveNewLanguagePair)}
                        </span>
                        <span className="text-slate-400">（{effectiveNewLanguagePair}）</span>
                      </p>
                    </div>
                  ) : null}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    基础模型 *
                  </label>
                  <select
                    value={
                      DEEPSEEK_MODEL_OPTIONS.some((m) => m.value === newBaseModel)
                        ? newBaseModel
                        : DEEPSEEK_MODEL_OPTIONS[0].value
                    }
                    onChange={(e) => setNewBaseModel(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {DEEPSEEK_MODEL_OPTIONS.map((model) => (
                      <option key={model.value} value={model.value}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                  {!aiSettings.deepSeekKey?.trim() ? (
                    <p className="mt-1 text-xs text-amber-800">
                      孪生译员推理使用 DeepSeek API，请先在「系统设置 → AI 引擎」中选择 DeepSeek 并填写 API Key。
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-slate-500">
                      选项与系统设置中的 DeepSeek 模型列表一致；密钥与全局 AI 引擎共用。
                    </p>
                  )}
                </div>

                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    checked={newUseKnowledgeBase}
                    onChange={e => setNewUseKnowledgeBase(e.target.checked)}
                    disabled={isSaving}
                  />
                  <span className="text-sm text-slate-700 leading-snug">
                    <span className="font-medium">生成建议时使用翻译知识库</span>
                    <span className="block text-slate-500 mt-0.5 text-xs">
                      若关闭，该译员在编辑器中生成译文建议时将不检索本地知识库。
                    </span>
                  </span>
                </label>
              </div>

              <div className="mt-8 flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowCreateModal(false);
                    resetCreateModalForm();
                  }}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isSaving}
                >
                  取消
                </button>
                <button
                  onClick={handleCreateTranslator}
                  disabled={isSaving || !newTranslatorName.trim()}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSaving ? '创建中...' : '创建译员'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {learnedExportScope && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-2">
              {learnedExportScope.kind === 'all'
                ? '导出所有已学习句段'
                : '导出已学习句段'}
            </h3>
            <p className="text-sm text-slate-600 mb-3">
              {learnedExportScope.kind === 'all'
                ? '将导出当前列表中全部孪生译员的已学习句段。'
                : learnedExportSingleTranslator
                  ? `将导出译员「${learnedExportSingleTranslator.name}」的已学习句段。`
                  : '所选译员已不存在，请关闭此窗口。'}
            </p>
            <p className="text-xs text-slate-500 mb-5 leading-relaxed">
              <span className="font-medium text-slate-600">Excel</span>：多列表格，便于筛选与统计。
              <br />
              <span className="font-medium text-slate-600">知识库正文</span>：UTF-8 纯文本，按「原文 / 译文」分段排版，可直接粘贴到「翻译知识库」正文中保存（系统将自动切块与可选向量化）。
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                className="w-full px-4 py-2.5 text-sm font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
                onClick={() => {
                  if (learnedExportScope.kind === 'all') {
                    exportLearnedSegmentsExcelAll();
                  } else if (learnedExportSingleTranslator) {
                    exportLearnedSegmentsExcelSingle(learnedExportSingleTranslator);
                  }
                  setLearnedExportScope(null);
                }}
                disabled={learnedExportScope.kind === 'single' && !learnedExportSingleTranslator}
              >
                <Icons.File className="w-4 h-4 inline mr-2" />
                Excel 表格（.xlsx）
              </button>
              <button
                type="button"
                className="w-full px-4 py-2.5 text-sm font-medium text-white bg-violet-600 rounded-lg hover:bg-violet-700"
                onClick={() => {
                  if (learnedExportScope.kind === 'all') {
                    exportLearnedSegmentsKbTxtAll();
                  } else if (learnedExportSingleTranslator) {
                    exportLearnedSegmentsKbTxtSingle(learnedExportSingleTranslator);
                  }
                  setLearnedExportScope(null);
                }}
                disabled={learnedExportScope.kind === 'single' && !learnedExportSingleTranslator}
              >
                <Icons.Database className="w-4 h-4 inline mr-2" />
                知识库正文（.txt）
              </button>
              <button
                type="button"
                className="w-full px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 rounded-lg"
                onClick={() => setLearnedExportScope(null)}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认模态框 */}
      {showDeleteModal && selectedTranslator && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
            <div className="p-6">
              <div className="flex items-center mb-4">
                <div className="mr-3 text-red-600">
                  <Icons.AlertTriangle className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900">确认删除</h3>
              </div>
              
              <p className="text-slate-600 mb-6">
                确定要删除孪生译员 <span className="font-semibold text-slate-900">"{selectedTranslator.name}"</span> 吗？
                {(selectedTranslator.trainingExamples?.length ?? 0) > 0 && (
                  <span className="block mt-2 text-sm text-red-600">
                    ⚠️ 该译员已学习 {selectedTranslator.trainingExamples?.length ?? 0} 个句段，删除后无法恢复学习数据！
                  </span>
                )}
              </p>

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowDeleteModal(false);
                    setSelectedTranslator(null);
                  }}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isSaving}
                >
                  取消
                </button>
                <button
                  onClick={handleDeleteTranslator}
                  disabled={isSaving}
                  className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  {isSaving ? '删除中...' : '确认删除'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};