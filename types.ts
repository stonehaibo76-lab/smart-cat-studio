export enum SegmentStatus {
  NotStarted = 'NotStarted',
  Draft = 'Draft',
  Translated = 'Translated', // AI or Human initial pass
  Confirmed = 'Confirmed',
  Review = 'Review'
}

export enum MatchType {
  None = 'None',
  Fuzzy = 'Fuzzy', // 70-99%
  Exact = 'Exact', // 100%
  CM = 'CM', // Context Match
  MT = 'MT', // Machine Translation
  AI = 'AI'  // Generative AI
}

export interface QAIssue {
    id: string;
    type: 'error' | 'warning' | 'info';
    category: string;
    message: string;
}

/** 翻译编辑器「常用符号」项；持久化于 editor-settings.quickSymbols */
export interface EditorQuickSymbol {
    id: string;
    /** 插入到译文的字符串（可为单字符或短语） */
    char: string;
    /** 下拉列表中的说明；缺省仅展示 char */
    label?: string;
}

export type InterchangeFormat = 'sdlxliff' | 'mqxliff';

export interface XliffInterchangeMeta {
  format: InterchangeFormat;
  /** trans-unit id 或 {tuId}_{mid}，SDL 导出按 ID 映射 */
  xliffSegmentId: string;
  transUnitId?: string;
  /** MQXLIFF 导出顺序索引 */
  mqIndex?: number;
  /** 包内相对路径 */
  packagePath?: string;
  /** SQLite xliff_blobs 或 IndexedDB 中的原始文件 id */
  originalBlobId: string;
  sourceLang?: string;
  targetLang?: string;
}

export interface TradosPackageMeta {
  packageBlobId: string;
  packageType: 'sdlppx' | 'sdlrpx';
  projectName: string;
  sourceLang: string;
  targetLang: string;
  xliffPaths: string[];
}

export interface Segment {
  id: string;
  sourceText: string;
  targetText: string;
  status: SegmentStatus;
  matchType: MatchType;
  matchScore?: number;
  comments?: string[];
  isLocked?: boolean;
  qaIssues?: QAIssue[];
  /** SDL/MQ 稳定句段 id，与 XliffInterchangeMeta.xliffSegmentId 同步 */
  xliffSegmentId?: string;
  sdlConf?: string;
  sdlLocked?: boolean;
  sdlOrigin?: string;
  /** 用户在本会话中修改过译文（SDL 导出时改 origin） */
  xliffModified?: boolean;
}

export interface ProjectFile {
    id: string;
    name: string;
    segments: Segment[];
    totalSegments: number;
    progress: number;
    interchangeFormat?: InterchangeFormat;
    /** 文件级 XLIFF 元数据（每文件一个 blob） */
    interchangeMeta?: Omit<XliffInterchangeMeta, 'xliffSegmentId' | 'mqIndex'>;
}

export interface Project {
  id: string;
  name: string;
  sourceLang: string;
  targetLang: string;
  createdAt: string;
  /** 交稿截止时间：`YYYY-MM-DDTHH:mm`（与 datetime-local 一致，本地时间）；未设置则不提醒 */
  deliveryDueAt?: string;
  /** @deprecated 兼容旧版仅日期 `YYYY-MM-DD`（按当日 23:59:59 截止）；请改用 deliveryDueAt */
  deliveryDueDate?: string;
  /** 为 true 时表示项目已交付/完结，不再显示交稿截止时间提醒 */
  isCompleted?: boolean;
  /** 为 false 时关闭翻译界面的截止时间横幅；未设置视为开启（兼容旧项目） */
  deliveryDueReminderEnabled?: boolean;
  progress: number; // Aggregate progress 0-100
  totalSegments: number; // Aggregate total
  files: ProjectFile[]; // Changed from direct segments to list of files
  
  // Trados style: Projects link to specific Resource IDs
  // Multi-TM/TB Support
  mainTmId?: string;       // The writable TM
  tmIds: string[];         // All mounted TMs (including main)
  
  mainTbId?: string;       // The writable/QA TB
  tbIds: string[];         // All mounted TBs (including main)

  /** 挂载的规则词典（自定义句式模板）；未设置或空数组则不应用 */
  grammarRuleBookIds?: string[];

  /** 挂载的正则表达式词典（与规则词典语言对一致）；未设置或空数组则不应用 */
  regexDictionaryBookIds?: string[];

  // AI Context
  contextDescription?: string;

  /** Trados SDLPPX/SDLRPX 包元数据 */
  tradosPackage?: TradosPackageMeta;
}

/** 单条正则表达式翻译：原文为正则，译文支持 $1…、$0、$&、$$；有「类别」时可被规则词典 {类别名} 引用 */
export interface RegexDictEntry {
  id: string;
  /** 备注 */
  name?: string;
  /**
   * 类别名：非空时供规则词典雪人式 {类别} 使用；为空时表示仅在句段级优先替换（不绑定规则占位）
   */
  category?: string;
  /** 更高优先尝试（0–20） */
  priority?: number;
  enabled?: boolean;
  /** 正则表达式（不含分隔符斜杠） */
  sourcePattern: string;
  /** 替换模板，如 生于$1年、$3年$2月$1日 */
  targetTemplate: string;
}

/** 正则表达式词典（按语言对管理） */
export interface RegexDictionaryBook {
  id: string;
  name: string;
  sourceLang: string;
  targetLang: string;
  entries: RegexDictEntry[];
  enabled?: boolean;
  createdAt?: string;
}

/** 类别词条：供雪人式规则中的 {类别名} 匹配；译文模板中用 @序号 取释义 */
export interface GrammarCategoryEntry {
  id: string;
  /** 源语词语，如 January */
  source: string;
  /** 目标语释义，如 一月 */
  target: string;
  /** 类别名，如 月份、序数词、人；可与内置 digits/label 等并存 */
  category: string;
}

/** 单条语法句式规则：支持 legacy {{变量名}} 或雪人式 * # {} @ */
export interface GrammarRule {
  id: string;
  /** 说明 / Excel 备注列 */
  name?: string;
  /** Excel「类别」列等用途的可选标记 */
  ruleCategory?: string;
  /** 更高数字优先匹配（0–20） */
  priority?: number;
  enabled?: boolean;
  /** 临时规则：仅作中间规则预留，不参与句段翻译匹配 */
  temporary?: boolean;
  /**
   * 源语言句式：
   * - Legacy：`{{obj}}` 双花括号占位（仅字母数字下划线变量名）
   * - 雪人式：`*`、`{digits}`、`{：词1|词2}`、`{类别}`、`^` 句首、`\\` 转义
   */
  sourcePattern: string;
  /**
   * 译文句式：
   * - Legacy：`{{obj}}` 与源端同名变量
   * - 雪人式：`#1` 对应第 n 个 `*`；`@1` 对应第 n 个 `{}`（内置类别取字面）；多条译文用 `|` 分隔时取第一条用于自动翻译
   */
  targetTemplate: string;
}

/** 规则词典（按语言对管理的一组句式规则） */
export interface GrammarRuleBook {
  id: string;
  name: string;
  sourceLang: string;
  targetLang: string;
  rules: GrammarRule[];
  /** 类别词条表（词语 → 类别 → 释义），用于 {} / @ */
  categoryLexicon?: GrammarCategoryEntry[];
  /** 整本启用；为 false 时项目挂载也不生效 */
  enabled?: boolean;
  createdAt?: string;
}

// The actual Entry inside a Termbase
export interface TermBaseEntry {
  id: string;
  source: string;
  target: string;
  context?: string;
}

/** 条目附带其所属术语库（项目挂载的 TB），用于编辑器侧栏展示来源 */
export interface TermBaseEntryWithTb extends TermBaseEntry {
  tbId: string;
  tbName: string;
}

// The Termbase Container (Like a .sdltb file)
export interface TermBase {
  id: string;
  name: string;
  sourceLang: string; // Trados enforces lang direction
  targetLang: string;
  entries: TermBaseEntry[];
  /** ISO YYYY-MM-DD；旧数据可无此字段，界面按默认日期展示 */
  createdAt?: string;
}

// The Unit inside a TM
export interface TranslationMemoryUnit {
  id: string;
  source: string;
  target: string;
  lastUsed: string;
  usageCount: number;
}

// The Translation Memory Container (Like a .sdltm file)
export interface TranslationMemory {
  id: string;
  name: string;
  sourceLang: string;
  targetLang: string;
  units: TranslationMemoryUnit[];
  /** ISO YYYY-MM-DD；旧数据可无此字段，界面按默认日期展示 */
  createdAt?: string;
}

export interface AISettings {
  provider: 'gemini' | 'deepseek' | 'openai';
  model: string;
  customPrompt?: string;
  deepSeekKey?: string; 
}

/** 本地 Embedding 服务（知识库向量 RAG），独立持久化于 settings */
export interface EmbeddingSettings {
  /** 是否使用向量检索（需服务可用且知识块已带向量） */
  enabled: boolean;
  /** 例如 http://127.0.0.1:8765 */
  serviceUrl: string;
  /** 与服务端 EMBED_API_KEY 一致时传入 X-API-Key */
  apiKey?: string;
  /** lexical=仅词法；vector=仅向量；hybrid=加权融合 */
  ragMode: 'lexical' | 'vector' | 'hybrid';
  /** hybrid 时词法分权重 0～1，其余为向量 */
  hybridLexicalWeight: number;
}

export const DEFAULT_EMBEDDING_SETTINGS: EmbeddingSettings = {
  enabled: false,
  serviceUrl: 'http://127.0.0.1:8765',
  ragMode: 'hybrid',
  hybridLexicalWeight: 0.35
};

export interface QuickPrompt {
  id: string;
  label: string;
  text: string;
}

/** 顶部栏「收藏网址」快捷项，持久化于 settings_kv favorite-urls */
export interface FavoriteUrl {
  id: string;
  /** 显示名称 */
  label: string;
  /** 链接，可省略协议（打开时自动补全 https://） */
  url: string;
}

/** 用户自定义在线词典，持久化于 settings_kv custom-online-dictionaries */
export interface CustomOnlineDictionary {
  id: string;
  /** 在词典切换栏显示的名称 */
  label: string;
  /** 词典主页地址（完整 http(s) URL），打开在线词典时仅进入此页，不会拼接检索词 */
  searchUrlTemplate: string;
}

export interface DuplicateInfo {
  segmentId: string;
  fileId: string;
  fileName: string;
  sourceText: string;
  isFirstOccurrence: boolean;
  duplicateType: 'none' | 'internal' | 'cross-file';
  duplicateCount: number;
}

export interface DuplicateAnalysisResult {
  totalSegments: number;
  uniqueSegments: number;
  duplicateSegments: number;
  duplicateRate: number;
  totalChars: number;
  duplicateChars: number;
  duplicateCharRate: number;
  internalDuplicates: number;
  crossFileDuplicates: number;
  tmExactMatches: number;
  tmMatchRate: number;
  tmMatchChars: number;
  lockedByAnalysis: number;
  fileStats: {
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
  }[];
  duplicateGroups: {
    sourceText: string;
    occurrences: {
      segmentId: string;
      fileId: string;
      fileName: string;
      isLocked: boolean;
    }[];
  }[];
  tmMatches: {
    segmentId: string;
    fileId: string;
    fileName: string;
    sourceText: string;
    tmTarget: string;
    tmName: string;
  }[];
}

// ================== 孪生译员相关类型 ==================

// 译文风格向量
export interface StyleFeatures {
  sentenceLengthAvg: number;
  formalLevel: number; // 0-100
  terminologyConsistency: number;
  syntacticComplexity: number;
  wordChoiceNovelty: number;
  translationFluency: number;
  // 第三阶段新增
  wordOrderPreference: {
    conditionalPosition: 'before' | 'after';
    passiveToActive: boolean;
    modifierPosition: 'before' | 'after';
  };
  translationStrategy: {
    domestication: number;
    explicitation: number;
    literalness: number;
  };
  punctuationStyle: {
    fullWidthRatio: number;
    commaStyle: 'enumeration' | 'clause';
    bracketUsage: number;
  };
}

// 习惯译法记录
export interface HabitualTranslation {
  id: string;
  sourcePattern: string;
  targetPattern: string;
  frequency: number;
  context?: string;
  lastUsed: string;
  confidence: number; // 0-1
}

// 第二阶段新增：术语映射表
export interface TerminologyMapping {
  sourceTerm: string;
  targetTerm: string;
  frequency: number;
  domain?: string;
  confidence: number;
}

// 第二阶段新增：语义级差异
export interface SemanticDifference {
  type: 'addition' | 'omission' | 'substitution' | 'restructuring';
  sourcePhrase: string;
  targetPhrase: string;
  category: 'terminology' | 'structure' | 'tone' | 'detail';
}

// 用户偏好设置
export interface TranslatorPreferences {
  preferFormality: number; // 0-100
  preferConcise: boolean;
  avoidRepetition: boolean;
  useSpecificTerms: string[];
  translationSpeed: 'balanced' | 'fast' | 'accurate';
  creativityLevel: number; // 0-100
}

// 译文特征片段
export interface TrainingExample {
  id: string;
  sourceText: string;
  originalTranslation: string; // AI原始译文
  userTranslation: string; // 用户修改后的译文
  differences: string[]; // 差异描述
  learnedAt: string;
  languagePair: string;
  domain?: string;
  // 第四阶段新增：负面反馈
  rejectedVariants?: {
    text: string;
    rejectReason?: string;
  }[];
  // 第四阶段新增：时间衰减因子
  decayWeight?: number;
  // 第二阶段新增：语义级差异
  semanticDifferences?: SemanticDifference[];
}

/** 孪生译员负面反馈示例（持久化于档案） */
export interface TwinNegativeExample {
  text: string;
  reason: string;
  timestamp: string;
}

// 孪生译员风格档案
export interface TwinTranslatorProfile {
  id: string;
  name: string;
  description?: string;
  languagePair: string; // "en-zh", "zh-en"等
  baseModel: string; // DeepSeek API 模型 id，与系统设置一致，如 deepseek-v4-flash

  // 风格特征
  styleFeatures: StyleFeatures;
  learnedSegments: number;
  trainingDataSize: number;

  // 习惯译法库
  habitualTranslations: HabitualTranslation[];

  // 第二阶段新增：术语映射表
  terminologyMappings: TerminologyMapping[];

  // 偏好设置
  preferences: TranslatorPreferences;

  // 训练数据
  trainingExamples: TrainingExample[];

  // 第四阶段新增：领域自适应
  domainWeights: {
    [domain: string]: number;
  };

  // 第四阶段新增：负面反馈列表
  negativeExamples: TwinNegativeExample[];

  // 第四阶段新增：动态衰减参数
  temporalDecayAlpha: number;

  /** 生成译文建议时是否使用翻译知识库（本地 RAG）；为 false 或未设置时不检索知识库，可加快生成。缺省为 false */
  useKnowledgeBaseForSuggestions?: boolean;

  // 状态
  trainingStatus: 'idle' | 'training' | 'ready' | 'needs_update';
  lastTrained: string;
  createdAt: string;

  // 性能指标
  /** 采纳率（0–100）：由 twinSuggestionAdoptionCount / twinSuggestionOfferCount 与差评惩罚重算，见 twinTranslatorService */
  successRate: number;
  /** 平均置信度（0–1）：由 twinTranslatorService.computeTwinAverageConfidence 根据训练量、习惯译法、术语、风格与建议面板统计重算并持久化 */
  averageConfidence: number;

  /** 「生成译文建议」成功且至少有一条非空建议的次数 */
  twinSuggestionOfferCount?: number;
  /** 用户在建议面板中通过「应用此译文」采纳的次数 */
  twinSuggestionAdoptionCount?: number;
  /** 用户在建议面板中对某条点「差评」的次数 */
  twinSuggestionNegativeRatingCount?: number;
}

// 译文选项
export interface TranslationVariant {
  id: string;
  text: string;
  styleLabel: string; // "用户风格", "保守翻译", "创意表达"
  confidence: number; // 0-1
  reasoning?: string; // 生成理由
  features?: Partial<StyleFeatures>; // 风格特征
}

// 译文生成配置
export interface TranslationGenerationConfig {
  numberOfVariants: number; // 生成几个选项
  includeBaseTranslation: boolean; // 是否包含基础AI译文
  temperature: number; // 采样温度
  maxLength: number;
}

// 学习反馈
export interface LearningFeedback {
  twinTranslatorId: string;
  sourceText: string;
  presentedVariants: TranslationVariant[];
  selectedVariant?: TranslationVariant;
  customTranslation?: string; // 用户自定义翻译
  feedback: 'positive' | 'negative' | 'neutral';
  feedbackDetail?: string;
  timestamp: string;
}

// ================== 知识库（RAG）==================

export interface KnowledgeChunk {
  id: string;
  text: string;
  /** 块标签，如「块3」 */
  sourceLabel: string;
  /** 本地服务生成的归一化向量（可选） */
  embedding?: number[];
  /** 与 embedding 对应的模型名，变更时需重算 */
  embeddingModel?: string;
}

/** 知识库：绑定项目；projectIds 为空表示对所有项目生效 */
export interface KnowledgeBase {
  id: string;
  name: string;
  description?: string;
  /** 绑定的项目 id；空数组 = 全局知识库 */
  projectIds: string[];
  enabled: boolean;
  /** 编辑用原文，保存时重新切块写入 chunks */
  rawText: string;
  chunks: KnowledgeChunk[];
  createdAt: string;
  updatedAt: string;
}

/** 低配机优化：持久化于 SQLite settings_kv「performance-settings」 */
export interface PerformanceSettings {
  /** 降低模糊与过渡动画，并将大模型 / 向量请求的并发限制为 1 */
  performanceMode: boolean;
  /** 启动时不加载孪生译员与知识库，进入相关页面或翻译编辑页时再请求 */
  lazyLoadHeavyCollections: boolean;
}