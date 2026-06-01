import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Icons } from './ui/Icons';
import { 
  TwinTranslatorProfile, 
  TranslationVariant, 
  TranslationGenerationConfig,
  AISettings,
  KnowledgeBase,
  EmbeddingSettings,
  DEFAULT_EMBEDDING_SETTINGS
} from '../types';
import { 
  generateTranslationVariants, 
  findMostSimilarTranslator,
  primaryLanguageCode
} from '../services/twinTranslatorService';
import { buildRagContextStringAsync } from '../services/knowledgeRagService';

interface TwinTranslatorToolbarProps {
  sourceText: string;
  targetText: string;
  /** 与编辑器项目源语言一致的主语言码，如 en */
  sourceLang: string;
  /** 与编辑器项目目标语言一致的主语言码，如 zh */
  targetLang: string;
  twinTranslators: TwinTranslatorProfile[];
  knowledgeBases: KnowledgeBase[];
  projectId: string | null;
  embeddingSettings?: EmbeddingSettings;
  aiSettings: AISettings;
  onSelectTranslation: (translation: string) => void;
  onReceiveVariants: (
    variants: TranslationVariant[],
    meta?: { twinTranslatorId: string }
  ) => void;
  /** 点击「管理孪生译员」时跳转管理页 */
  onManageTwinTranslators?: () => void;
  onLearningFeedback: (feedback: {
    twinTranslatorId: string;
    sourceText: string;
    selectedVariant?: TranslationVariant;
    customTranslation?: string;
    feedback: 'positive' | 'negative' | 'neutral';
    suggestionPanelAdoption?: boolean;
    suggestionPanelNegativeRating?: boolean;
  }) => void;
}

export const TwinTranslatorToolbar: React.FC<TwinTranslatorToolbarProps> = ({
  sourceText,
  targetText,
  sourceLang,
  targetLang,
  twinTranslators,
  knowledgeBases,
  projectId,
  embeddingSettings = DEFAULT_EMBEDDING_SETTINGS,
  aiSettings,
  onSelectTranslation,
  onReceiveVariants,
  onManageTwinTranslators,
  onLearningFeedback
}) => {
  const [selectedTranslator, setSelectedTranslator] = useState<TwinTranslatorProfile | null>(null);
  const [showVariantsPanel, setShowVariantsPanel] = useState(false);
  const [variants, setVariants] = useState<TranslationVariant[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showTranslatorSelect, setShowTranslatorSelect] = useState(false);
  const [variantsError, setVariantsError] = useState<string | null>(null);
  const [variantFeedbackBanner, setVariantFeedbackBanner] = useState<{
    message: string;
    tone: 'positive' | 'negative';
  } | null>(null);
  const [modalDragOffset, setModalDragOffset] = useState({ x: 0, y: 0 });
  /** 建议面板内可编辑的当前译文 */
  const [editableTargetText, setEditableTargetText] = useState('');
  /** 建议面板内各条建议的可编辑译文，key 为 variant.id */
  const [editableVariantTexts, setEditableVariantTexts] = useState<Record<string, string>>({});
  const modalDragOffsetRef = useRef(modalDragOffset);
  const variantFeedbackBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const variantModalDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const languagePair = useMemo(
    () => `${primaryLanguageCode(sourceLang)}-${primaryLanguageCode(targetLang)}`,
    [sourceLang, targetLang]
  );

  const matchingTranslators = useMemo(
    () =>
      twinTranslators.filter(
        t => t.languagePair.toLowerCase() === languagePair.toLowerCase()
      ),
    [twinTranslators, languagePair]
  );

  // 自动选择：仅在与当前项目语言对一致的译员中选经验最丰富者；无匹配则不选
  useEffect(() => {
    const findMostSimilar = async () => {
      if (matchingTranslators.length === 0) {
        setSelectedTranslator(null);
        return;
      }

      let findSimilarFunc = findMostSimilarTranslator;
      if (typeof findSimilarFunc !== 'function') {
        try {
          const twinTranslatorModule = await import('../services/twinTranslatorService');
          findSimilarFunc = twinTranslatorModule.findMostSimilarTranslator;
          if (typeof findSimilarFunc !== 'function') {
            throw new Error('动态导入后函数仍然不可用');
          }
        } catch (dynamicImportError) {
          console.error('动态导入失败:', dynamicImportError);
          setSelectedTranslator(null);
          return;
        }
      }

      const mostSimilar = findSimilarFunc(matchingTranslators, languagePair);
      setSelectedTranslator(mostSimilar ?? matchingTranslators[0] ?? null);
    };

    findMostSimilar();
  }, [matchingTranslators, languagePair]);

  useEffect(() => {
    if (
      selectedTranslator &&
      !matchingTranslators.some(t => t.id === selectedTranslator.id)
    ) {
      setSelectedTranslator(null);
    }
  }, [matchingTranslators, selectedTranslator]);

  // 管理页修改译员选项后，与 props 中的最新档案同步
  useEffect(() => {
    setSelectedTranslator(prev => {
      if (!prev) return prev;
      const fresh = twinTranslators.find(t => t.id === prev.id);
      return fresh ?? prev;
    });
  }, [twinTranslators]);

  useEffect(() => {
    modalDragOffsetRef.current = modalDragOffset;
  }, [modalDragOffset]);

  useEffect(() => {
    if (showVariantsPanel) {
      setModalDragOffset({ x: 0, y: 0 });
      setEditableTargetText(targetText);
    }
  }, [showVariantsPanel, targetText]);

  useEffect(() => {
    setEditableVariantTexts(
      Object.fromEntries(variants.map(v => [v.id, v.text]))
    );
  }, [variants]);

  const getVariantDisplayText = useCallback(
    (variant: TranslationVariant) =>
      editableVariantTexts[variant.id] ?? variant.text,
    [editableVariantTexts]
  );

  const variantWithEditedText = useCallback(
    (variant: TranslationVariant): TranslationVariant => ({
      ...variant,
      text: getVariantDisplayText(variant)
    }),
    [getVariantDisplayText]
  );

  const clearVariantFeedbackBannerTimer = useCallback(() => {
    if (variantFeedbackBannerTimerRef.current) {
      clearTimeout(variantFeedbackBannerTimerRef.current);
      variantFeedbackBannerTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => clearVariantFeedbackBannerTimer();
  }, [clearVariantFeedbackBannerTimer]);

  useEffect(() => {
    if (!showVariantsPanel) {
      clearVariantFeedbackBannerTimer();
      setVariantFeedbackBanner(null);
    }
  }, [showVariantsPanel, clearVariantFeedbackBannerTimer]);

  const onVariantModalHeaderPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const t = e.currentTarget;
    const o = modalDragOffsetRef.current;
    variantModalDragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origX: o.x,
      origY: o.y
    };
    t.setPointerCapture(e.pointerId);
    (t as HTMLElement).style.cursor = 'grabbing';
  }, []);

  const onVariantModalHeaderPointerMove = useCallback((e: React.PointerEvent) => {
    const d = variantModalDragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    setModalDragOffset({
      x: d.origX + e.clientX - d.startX,
      y: d.origY + e.clientY - d.startY
    });
  }, []);

  const onVariantModalHeaderPointerUp = useCallback((e: React.PointerEvent) => {
    const d = variantModalDragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    variantModalDragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    (e.currentTarget as HTMLElement).style.cursor = 'grab';
  }, []);

  // 生成译文变体
  const handleGenerateVariants = async () => {
    if (!selectedTranslator || !sourceText.trim()) return;
    
    // 检查服务函数是否可用，如果不可用尝试动态导入
    let generateVariantsFunc = generateTranslationVariants;
    if (typeof generateVariantsFunc !== 'function') {
      console.warn('静态导入的generateTranslationVariants不可用，尝试动态导入');
      try {
        const twinTranslatorModule = await import('../services/twinTranslatorService');
        generateVariantsFunc = twinTranslatorModule.generateTranslationVariants;
        
        if (typeof generateVariantsFunc !== 'function') {
          throw new Error('动态导入后函数仍然不可用');
        }
      } catch (dynamicImportError) {
        console.error('动态导入失败:', dynamicImportError);
        alert('孪生译员服务暂时不可用，请刷新页面或检查网络连接');
        return;
      }
    }
    
    setIsGenerating(true);
    setVariantsError(null);
    clearVariantFeedbackBannerTimer();
    setVariantFeedbackBanner(null);
    try {
      const config: TranslationGenerationConfig = {
        numberOfVariants: 3,
        includeBaseTranslation: true,
        temperature: 0.7,
        maxLength: 500
      };
      
      const useKb = selectedTranslator.useKnowledgeBaseForSuggestions === true;
      const ragContext = useKb
        ? await buildRagContextStringAsync(
            sourceText,
            knowledgeBases,
            projectId,
            embeddingSettings
          )
        : undefined;

      const generatedVariants = await generateVariantsFunc(
        sourceText,
        selectedTranslator,
        config,
        aiSettings,
        {
          sourceLang: primaryLanguageCode(sourceLang),
          targetLang: primaryLanguageCode(targetLang)
        },
        ragContext
      );
      
      // 过滤空译文
      const validVariants = generatedVariants.filter(v => v.text && v.text.trim());
      setVariants(validVariants);
      setShowVariantsPanel(true);
      
      // 通知父组件（有非空建议时顺带记录「建议次数」）
      onReceiveVariants(
        validVariants,
        selectedTranslator && validVariants.length > 0
          ? { twinTranslatorId: selectedTranslator.id }
          : undefined
      );
      
      console.log(`生成了 ${validVariants.length} 个译文变体`);
      if (validVariants.length === 0) {
        setVariantsError(
          '未得到任何非空译文。请打开浏览器开发者工具 (F12) → Console 查看报错；并检查系统设置中的 AI 密钥与网络。'
        );
      }
    } catch (error) {
      console.error('生成译文变体失败:', error);
      const msg = error instanceof Error ? error.message : String(error);
      setVariants([]);
      setVariantsError(msg || '生成失败');
      setShowVariantsPanel(true);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApplyCurrentTranslation = () => {
    const text = editableTargetText.trim();
    if (!text) return;
    onSelectTranslation(text);
  };

  // 选择译文变体（使用面板内编辑后的文本）
  const handleSelectVariant = (variant: TranslationVariant) => {
    const effective = variantWithEditedText(variant);
    onSelectTranslation(effective.text);
    
    // 发送学习反馈（正面）
    if (selectedTranslator) {
      const learningData = {
        twinTranslatorId: selectedTranslator.id,
        sourceText,
        selectedVariant: effective,
        feedback: 'positive' as const,
        suggestionPanelAdoption: true
      };

      onLearningFeedback(learningData);
    }
    
    // 关闭面板
    setShowVariantsPanel(false);
    setVariantsError(null);
  };

  /** 对指定条目的译文记录学习反馈（不应用、不关面板） */
  const handleProvideFeedback = (
    variant: TranslationVariant,
    feedback: 'positive' | 'negative'
  ) => {
    if (!selectedTranslator) return;

    onLearningFeedback({
      twinTranslatorId: selectedTranslator.id,
      sourceText,
      selectedVariant: variantWithEditedText(variant),
      feedback,
      ...(feedback === 'negative'
        ? { suggestionPanelNegativeRating: true as const }
        : {})
    });

    clearVariantFeedbackBannerTimer();
    const message =
      feedback === 'positive'
        ? '已记录好评，孪生译员会参考该条更新风格与术语。'
        : '已记录差评，后续生成将尽量避免与此条过于接近的译文。';
    setVariantFeedbackBanner({ message, tone: feedback });
    variantFeedbackBannerTimerRef.current = setTimeout(() => {
      setVariantFeedbackBanner(null);
      variantFeedbackBannerTimerRef.current = null;
    }, 2800);
  };

  // 训练当前译员
  const handleTrainCurrent = () => {
    if (!selectedTranslator || !sourceText.trim() || !targetText.trim()) {
      alert('请先提供原文和译文以进行训练');
      return;
    }
    
    const learningData = {
      twinTranslatorId: selectedTranslator.id,
      sourceText,
      customTranslation: targetText,
      feedback: 'positive' as const
    };
    
    onLearningFeedback(learningData);
    console.log('已训练译员学习当前翻译');
  };

  // 获取状态颜色
  const getStatusColor = (status: TwinTranslatorProfile['trainingStatus']) => {
    switch (status) {
      case 'ready': return 'bg-green-100 text-green-800';
      case 'training': return 'bg-blue-100 text-blue-800';
      case 'needs_update': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  // 获取状态标签
  const getStatusLabel = (status: TwinTranslatorProfile['trainingStatus']) => {
    switch (status) {
      case 'ready': return '就绪';
      case 'training': return '学习中';
      case 'needs_update': return '需更新';
      default: return '待学习';
    }
  };

  return (
    <div className="relative min-w-0 max-w-full">
      {/* 主要工具栏 */}
      <div className="flex min-w-0 max-w-full items-center gap-1.5 p-1.5 bg-white border border-slate-200 rounded-lg shadow-sm">
        {/* 译员选择器 */}
        <div className="relative shrink-0 min-w-0 max-w-[10.5rem] sm:max-w-[12.5rem]">
          <button
            onClick={() => setShowTranslatorSelect(!showTranslatorSelect)}
            className="flex w-full min-w-0 max-w-full items-center gap-1.5 px-2 py-1.5 text-sm text-slate-700 bg-slate-50 hover:bg-slate-100 rounded-md border border-slate-200 transition-colors"
          >
            {selectedTranslator ? (
              <>
                <Icons.User className="w-4 h-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-left">{selectedTranslator.name}</span>
                {selectedTranslator.trainingStatus !== 'idle' && (
                  <span className={`text-xs px-1.5 py-0.5 rounded ${getStatusColor(selectedTranslator.trainingStatus)}`}>
                    {getStatusLabel(selectedTranslator.trainingStatus)}
                  </span>
                )}
              </>
            ) : (
              <>
                <Icons.UserPlus className="w-4 h-4 shrink-0" />
                <span className="min-w-0 truncate">选择孪生译员</span>
              </>
            )}
            <Icons.ChevronDown className="w-3 h-3 shrink-0" />
          </button>

          {/* 译员下拉菜单 */}
          {showTranslatorSelect && (
            <div className="absolute left-0 top-full mt-1 w-64 bg-white rounded-lg shadow-lg border border-slate-200 z-50">
              <div className="p-2 border-b border-slate-100">
                <h4 className="text-xs font-semibold text-slate-700">选择孪生译员</h4>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  当前项目：{languagePair.replace('-', ' → ')}
                </p>
              </div>
              
              <div className="max-h-64 overflow-y-auto">
                {twinTranslators.length === 0 ? (
                  <div className="p-3 text-center text-slate-500 text-sm">
                    暂无孪生译员
                  </div>
                ) : matchingTranslators.length === 0 ? (
                  <div className="p-3 text-center text-slate-500 text-sm">
                    没有语言对为「{languagePair.replace('-', ' → ')}」的译员。
                    <br />
                    请在「孪生译员」管理中创建同语言对的译员。
                  </div>
                ) : (
                  matchingTranslators.map(translator => (
                    <button
                      key={translator.id}
                      onClick={() => {
                        setSelectedTranslator(translator);
                        setShowTranslatorSelect(false);
                      }}
                      className={`w-full text-left p-2 hover:bg-slate-50 flex items-center justify-between ${
                        selectedTranslator?.id === translator.id ? 'bg-blue-50 border-blue-100 border-r-2 border-r-blue-500' : ''
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm text-slate-900 truncate">
                          {translator.name}
                        </div>
                        <div className="text-xs text-slate-500 flex items-center gap-2">
                          <span>{translator.languagePair.replace('-', ' → ')}</span>
                          •
                          <span>已学习 {translator.trainingExamples?.length ?? 0} 句段</span>
                        </div>
                      </div>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${getStatusColor(translator.trainingStatus)}`}>
                        {getStatusLabel(translator.trainingStatus)}
                      </span>
                    </button>
                  ))
                )}
              </div>
              
              <div className="p-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setShowTranslatorSelect(false);
                    onManageTwinTranslators?.();
                  }}
                  className="w-full text-center text-sm text-blue-600 hover:text-blue-700 py-1.5 hover:bg-blue-50 rounded"
                >
                  管理孪生译员 →
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 生成按钮 */}
        <button
          onClick={handleGenerateVariants}
          disabled={isGenerating || !selectedTranslator || !sourceText.trim()}
          className="flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed sm:px-3"
        >
          {isGenerating ? (
            <>
              <span className="animate-spin">⟳</span>
              <span>生成中...</span>
            </>
          ) : (
            <>
              <Icons.Brain className="w-4 h-4 shrink-0" />
              <span className="hidden lg:inline">生成译文建议</span>
              <span className="hidden sm:inline lg:hidden">生成建议</span>
              <span className="sm:hidden">建议</span>
            </>
          )}
        </button>

        {/* 训练按钮 */}
        <button
          onClick={handleTrainCurrent}
          disabled={!selectedTranslator || !sourceText.trim() || !targetText.trim()}
          className="flex shrink-0 items-center gap-1.5 px-2 py-1.5 text-sm text-slate-700 bg-slate-50 hover:bg-slate-100 rounded-md border border-slate-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed sm:px-2.5"
          title="训练译员学习当前翻译"
        >
          <Icons.BookOpen className="w-4 h-4 shrink-0" />
          <span className="hidden md:inline">学习此翻译</span>
          <span className="md:hidden">学习</span>
        </button>

        {/* 信息提示 */}
        {selectedTranslator &&
          ((selectedTranslator.trainingExamples?.length ?? 0) > 0 ||
            (selectedTranslator.twinSuggestionOfferCount ?? 0) > 0) && (
          <div
            className="flex min-w-0 flex-1 items-center gap-1 text-xs text-slate-500"
            title={`建议 ${selectedTranslator.twinSuggestionOfferCount ?? 0} 次 · 采纳 ${selectedTranslator.twinSuggestionAdoptionCount ?? 0} 次 · 差评 ${selectedTranslator.twinSuggestionNegativeRatingCount ?? 0} 次 · 已学习 ${selectedTranslator.trainingExamples?.length ?? 0} 句段 · ${selectedTranslator.successRate.toFixed(0)}% 采纳率`}
          >
            <Icons.Info className="w-3 h-3 shrink-0" />
            <span className="min-w-0 truncate">
              已学习 {selectedTranslator.trainingExamples?.length ?? 0} 句段 •{' '}
              {selectedTranslator.successRate.toFixed(0)}% 采纳率
            </span>
          </div>
        )}

        {twinTranslators.length > 0 && matchingTranslators.length === 0 && (
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-xs text-amber-700">
            <Icons.Info className="w-3 h-3 shrink-0" />
            <span
              className="min-w-0 flex-1 truncate"
              title={`当前项目需「${languagePair.replace('-', ' → ')}」译员，请新建或切换项目语言。`}
            >
              当前项目需「{languagePair.replace('-', ' → ')}」译员，请新建或切换项目语言。
            </span>
          </div>
        )}
      </div>

      {/* 译文建议：用 Portal + 固定层，避免被编辑器 overflow/z-index 遮挡 */}
      {showVariantsPanel &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[260] p-4 bg-slate-900/50 backdrop-blur-[1px]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="twin-variant-panel-title"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) {
                setShowVariantsPanel(false);
                setVariantsError(null);
              }
            }}
          >
            <div
              className="fixed left-1/2 top-1/2 w-full max-w-2xl max-h-[85vh] flex flex-col bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden"
              style={{
                transform: `translate(calc(-50% + ${modalDragOffset.x}px), calc(-50% + ${modalDragOffset.y}px))`
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div
                className="p-3 border-b border-slate-100 flex items-center justify-between shrink-0 cursor-grab select-none bg-slate-50/80 active:cursor-grabbing"
                onPointerDown={onVariantModalHeaderPointerDown}
                onPointerMove={onVariantModalHeaderPointerMove}
                onPointerUp={onVariantModalHeaderPointerUp}
                onPointerCancel={onVariantModalHeaderPointerUp}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1 pr-2">
                  <Icons.Sparkles className="w-4 h-4 text-blue-500 shrink-0" />
                  <h4 id="twin-variant-panel-title" className="font-semibold text-slate-900 truncate">
                    孪生译员建议
                  </h4>
                  <span className="text-xs text-slate-500 truncate hidden sm:inline" title="按住此处拖动窗口">
                    {selectedTranslator?.name}
                  </span>
                </div>
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    setShowVariantsPanel(false);
                    setVariantsError(null);
                  }}
                  className="p-1.5 hover:bg-slate-100 rounded-lg shrink-0 cursor-default"
                  aria-label="关闭"
                >
                  <Icons.X className="w-4 h-4 text-slate-400" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-3 min-h-0">
                <div className="mb-3 space-y-3">
                  <div>
                    <div className="text-xs font-medium text-slate-500 mb-1">原文</div>
                    <div className="text-sm text-slate-900 whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                      {sourceText.trim() ? sourceText : '（无原文）'}
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div
                        className="text-xs font-medium text-slate-500"
                        title="编辑器中当前句段的目标文，可直接编辑后应用到句段"
                      >
                        当前译文
                      </div>
                      <button
                        type="button"
                        onClick={handleApplyCurrentTranslation}
                        disabled={!editableTargetText.trim()}
                        className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                      >
                        应用此译文
                      </button>
                    </div>
                    <textarea
                      value={editableTargetText}
                      onChange={(e) => setEditableTargetText(e.target.value)}
                      placeholder="（当前句段尚无译文，可在此输入）"
                      rows={3}
                      className="w-full text-sm text-slate-900 whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-white p-2.5 resize-y min-h-[4.5rem] focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                    />
                  </div>
                </div>

                {variantsError ? (
                  <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm p-4">
                    {variantsError}
                  </div>
                ) : variants.length === 0 ? (
                  <p className="text-sm text-slate-600">暂无建议条目。</p>
                ) : (
                  <div className="grid grid-cols-1 gap-3">
                    {variants.map((variant) => (
                      <div
                        key={variant.id}
                        className="p-3 border border-slate-200 rounded-lg hover:border-blue-200 transition-colors group"
                      >
                        <div className="flex items-start justify-between mb-2 gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-medium px-2 py-0.5 rounded bg-blue-100 text-blue-800">
                              {variant.styleLabel}
                            </span>
                            <span className="text-xs text-slate-500">
                              置信度 {(variant.confidence * 100).toFixed(0)}%
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleSelectVariant(variant)}
                            disabled={!getVariantDisplayText(variant).trim()}
                            className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                          >
                            应用此译文
                          </button>
                        </div>
                        <textarea
                          value={editableVariantTexts[variant.id] ?? variant.text}
                          onChange={(e) =>
                            setEditableVariantTexts(prev => ({
                              ...prev,
                              [variant.id]: e.target.value
                            }))
                          }
                          rows={3}
                          className="w-full text-sm text-slate-900 mb-2 whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-white p-2 resize-y min-h-[4.5rem] focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                        />
                        {variant.reasoning && (
                          <div className="text-xs text-slate-500 italic">{variant.reasoning}</div>
                        )}
                        <div
                          className="flex flex-wrap items-center justify-end gap-2 mt-3 pt-2 border-t border-slate-100"
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => handleProvideFeedback(variant, 'positive')}
                            className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200"
                          >
                            好评
                          </button>
                          <button
                            type="button"
                            onClick={() => handleProvideFeedback(variant, 'negative')}
                            className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                          >
                            差评
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {variantFeedbackBanner && (
                <div
                  role="status"
                  aria-live="polite"
                  className={
                    variantFeedbackBanner.tone === 'positive'
                      ? 'shrink-0 px-3 py-2.5 text-sm border-t border-emerald-200 bg-emerald-50 text-emerald-900'
                      : 'shrink-0 px-3 py-2.5 text-sm border-t border-rose-200 bg-rose-50 text-rose-900'
                  }
                >
                  {variantFeedbackBanner.message}
                </div>
              )}

              {variants.length > 0 && (
                <div className="p-3 border-t border-slate-100 shrink-0">
                  <div className="text-xs text-slate-500">
                    各条译文均可直接编辑；点「应用此译文」写入当前句段；可对各条建议单独点「好评 / 差评」以训练孪生译员。
                  </div>
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};