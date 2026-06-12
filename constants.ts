import { Project, SegmentStatus, MatchType, TermBase, TranslationMemory, ProjectFile, EditorQuickSymbol } from './types';

/** 界面与帮助文档中统一展示的发行版标签（含 V 前缀） */
export const APP_DISPLAY_VERSION = 'V1.8.1';
/** TMX creationtoolversion 等元数据（不含 V） */
export const APP_VERSION_METADATA = '1.8.1';

/** 术语库/记忆库无创建日期时的侧栏展示 */
export const RESOURCE_CREATED_DATE_FALLBACK_CN = '2026年4月24日';

/** ISO `YYYY-MM-DD`（或已有中文日期串）格式化为侧栏用创建日期；空或无法识别则用默认文案 */
export function formatResourceCreatedDateLabel(iso?: string): string {
  const raw = iso?.trim();
  if (!raw) return RESOURCE_CREATED_DATE_FALLBACK_CN;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (m) {
    return `${m[1]}年${parseInt(m[2], 10)}月${parseInt(m[3], 10)}日`;
  }
  if (/年/.test(raw) && /月/.test(raw) && /日/.test(raw)) return raw;
  return RESOURCE_CREATED_DATE_FALLBACK_CN;
}

export const SUPPORTED_LANGUAGES = [
  { code: 'en-US', name: 'English (US)' },
  { code: 'zh-CN', name: 'Chinese (Simplified)' },
  { code: 'ja-JP', name: 'Japanese' },
  { code: 'ko-KR', name: 'Korean' },
  { code: 'fr-FR', name: 'French' },
  { code: 'es-ES', name: 'Spanish' },
  { code: 'de-DE', name: 'German' },
  { code: 'ru-RU', name: 'Russian' },
  { code: 'it-IT', name: 'Italian' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)' },
  { code: 'vi-VN', name: 'Vietnamese' },
  { code: 'th-TH', name: 'Thai' },
  { code: 'ms-MY', name: 'Malay' },
  { code: 'my-MM', name: 'Burmese' },
  { code: 'lo-LA', name: 'Lao' }
];

/** DeepSeek 对话模型（与「系统设置 → AI 引擎」一致，孪生译员等复用） */
export const DEEPSEEK_MODEL_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
  { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' }
];

/** 机器翻译参考 sidecar 默认地址 */
export const DEFAULT_MT_REFERENCE_SERVICE_URL = 'http://127.0.0.1:8770';

/** translators 库引擎目录版本（升级时仅自动启用新增引擎） */
export const MT_TRANSLATOR_CATALOG_VERSION = 3;
/** v1 仅暴露的 7 个引擎（用于设置迁移） */
export const MT_TRANSLATOR_CATALOG_V1 = [
  'bing',
  'baidu',
  'youdao',
  'deepl',
  'caiyun',
  'google',
  'sogou',
] as const;
/** v2 曾暴露的全部 39 个引擎（用于设置迁移） */
export const MT_TRANSLATOR_CATALOG_V2 = [
  'alibaba', 'apertium', 'argos', 'baidu', 'bing', 'caiyun', 'cloudTranslation', 'deepl', 'elia',
  'google', 'hujiang', 'iciba', 'iflytek', 'iflyrec', 'itranslate', 'judic', 'languageWire', 'lara',
  'lingvanex', 'niutrans', 'mglip', 'mirai', 'modernMt', 'myMemory', 'papago', 'qqFanyi', 'qqTranSmart',
  'reverso', 'sogou', 'sysTran', 'tilde', 'translateCom', 'translateMe', 'utibet', 'volcEngine', 'xunjie',
  'yandex', 'yeekit', 'youdao',
] as const;

/** 编辑器 MT 参考暴露的引擎（经试用筛选的 17 个） */
export const MT_TRANSLATOR_OPTIONS: ReadonlyArray<{
  id: string;
  label: string;
  description: string;
}> = [
  { id: 'cloudTranslation', label: '云译', description: '厦大云译，28 语种' },
  { id: 'google', label: 'Google', description: '134 语种，国内常不可用' },
  { id: 'iciba', label: '金山/iciba', description: '187 语种' },
  { id: 'iflyrec', label: '讯飞听见', description: '12 语种' },
  { id: 'itranslate', label: 'iTranslate', description: '101 语种' },
  { id: 'lara', label: 'Lara', description: '211 语种' },
  { id: 'lingvanex', label: 'Lingvanex', description: '112 语种' },
  { id: 'modernMt', label: 'ModernMT', description: '开源，200 语种' },
  { id: 'papago', label: 'Papago', description: '韩语向，15 语种' },
  { id: 'qqTranSmart', label: '腾讯交互翻译', description: '22 语种' },
  { id: 'reverso', label: 'Reverso', description: '42 语种' },
  { id: 'sogou', label: '搜狗', description: '20 语种' },
  { id: 'sysTran', label: 'Systran', description: '52 语种' },
  { id: 'translateCom', label: 'Translate.com', description: '21 语种' },
  { id: 'xunjie', label: '迅捷', description: '68 语种' },
  { id: 'yandex', label: 'Yandex', description: '102 语种' },
  { id: 'youdao', label: '有道', description: '12 语种，中文较稳' },
];

export const MT_TRANSLATOR_IDS = MT_TRANSLATOR_OPTIONS.map((o) => o.id);

/** 多引擎对比：单次最多并行查询数 */
export const MT_COMPARE_MAX = 6;

/** 多引擎对比预设（与帮助「MT 引擎推荐」一致） */
export const MT_COMPARE_PRESETS: ReadonlyArray<{
  id: string;
  label: string;
  translators: readonly string[];
}> = [
  {
    id: 'zh-en-daily',
    label: '日常中英',
    translators: ['youdao', 'cloudTranslation', 'sogou', 'qqTranSmart'],
  },
  {
    id: 'zh-en-extra',
    label: '中英+备看',
    translators: ['youdao', 'cloudTranslation', 'sogou', 'qqTranSmart', 'iflyrec'],
  },
  {
    id: 'european',
    label: '欧语',
    translators: ['reverso', 'sysTran', 'modernMt'],
  },
  {
    id: 'broad',
    label: '广覆盖',
    translators: ['lara', 'iciba', 'xunjie'],
  },
];

export const DEFAULT_MT_COMPARE_TRANSLATORS = MT_COMPARE_PRESETS[0].translators;

export function mtTranslatorLabel(id: string): string {
  return MT_TRANSLATOR_OPTIONS.find((o) => o.id === id)?.label ?? id;
}

/** 本地 llama-server 默认 OpenAI 兼容根地址 */
export const DEFAULT_LOCAL_LLM_BASE_URL = 'http://127.0.0.1:8080/v1';
/** 单模型加载时 llama-server 会忽略 model 字段，占位即可 */
export const DEFAULT_LOCAL_LLM_MODEL = 'qwen-local';

// Mock Databases (Files)
export const MOCK_TBS: TermBase[] = [
    {
        id: 'tb-global',
        name: 'General Master Termbase',
        sourceLang: 'en-US',
        targetLang: 'zh-CN',
        createdAt: '2024-03-15',
        entries: [
            { id: 't-1', source: 'Smart-CAT Studio', target: 'Smart-CAT Studio' },
            { id: 't-2', source: 'Translation Memory', target: '翻译记忆库' },
            { id: 't-3', source: 'efficiency', target: '效率' },
        ]
    },
    {
        id: 'tb-marketing',
        name: 'Marketing Glossary 2024',
        sourceLang: 'en-US',
        targetLang: 'zh-CN',
        entries: [
            { id: 't-m-1', source: 'Lead', target: '线索' },
            { id: 't-m-2', source: 'Campaign', target: '营销活动' },
        ]
    }
];

export const MOCK_TMS: TranslationMemory[] = [
    {
        id: 'tm-global',
        name: 'Master Memory (EN-ZH)',
        sourceLang: 'en-US',
        targetLang: 'zh-CN',
        createdAt: '2024-05-01',
        units: [
            { id: 'tm-1', source: 'Cancel', target: '取消', lastUsed: '2024-05-01', usageCount: 42 },
            { id: 'tm-2', source: 'Confirm', target: '确认', lastUsed: '2024-05-02', usageCount: 128 },
        ]
    },
    {
        id: 'tm-legal',
        name: 'Legal Contracts TM',
        sourceLang: 'en-US',
        targetLang: 'zh-CN',
        units: [
             { id: 'tm-3', source: 'In witness whereof', target: '以资证明', lastUsed: '2024-04-20', usageCount: 5 }
        ]
    }
];

// Helper to create mock segments
const CREATE_MOCK_SEGMENTS = (): import('./types').Segment[] => [
  {
    id: 's-1',
    sourceText: 'Welcome to the Smart-CAT Studio user guide.',
    targetText: '欢迎使用 Smart-CAT Studio 用户指南。',
    status: SegmentStatus.Confirmed,
    matchType: MatchType.Exact,
    matchScore: 100
  },
  {
    id: 's-2',
    sourceText: 'This software is designed to improve translation efficiency.',
    targetText: '该软件旨在提高翻译效率。',
    status: SegmentStatus.Translated,
    matchType: MatchType.AI,
    matchScore: 0
  },
  {
    id: 's-3',
    sourceText: 'Please ensure you have configured your AI API keys in the settings.',
    targetText: '',
    status: SegmentStatus.NotStarted,
    matchType: MatchType.None
  },
  {
    id: 's-4',
    sourceText: 'The grid view allows for a traditional translation experience.',
    targetText: '',
    status: SegmentStatus.NotStarted,
    matchType: MatchType.None
  },
  {
    id: 's-5',
    sourceText: 'Shortcuts are essential for professional translators.',
    targetText: '快捷键对于专业翻译人员至关重要。',
    status: SegmentStatus.Draft,
    matchType: MatchType.Fuzzy,
    matchScore: 85,
    isLocked: true
  },
  {
    id: 's-6',
    sourceText: 'Click the "Confirm" button to save your changes to the Translation Memory.',
    targetText: '',
    status: SegmentStatus.NotStarted,
    matchType: MatchType.None
  },
  {
    id: 's-7',
    sourceText: 'Advanced features include term extraction and quality assurance checks.',
    targetText: '',
    status: SegmentStatus.NotStarted,
    matchType: MatchType.None
  },
  {
    id: 's-8',
    sourceText: 'Integration with LLMs revolutionizes the post-editing workflow.',
    targetText: '',
    status: SegmentStatus.NotStarted,
    matchType: MatchType.None
  }
];

// Helper to create a mock file
const createMockFile = (id: string, name: string): ProjectFile => {
    const segments = CREATE_MOCK_SEGMENTS();
    return {
        id,
        name,
        segments,
        totalSegments: segments.length,
        progress: 35 // Arbitrary mock progress matching segments
    };
};

export const MOCK_PROJECTS: Project[] = [
  {
    id: 'p-001',
    name: '2024年Q3财务报告',
    sourceLang: 'en-US',
    targetLang: 'zh-CN',
    createdAt: '2024-05-10',
    progress: 35,
    totalSegments: 16,
    files: [
        createMockFile('f-001-a', 'Financial_Summary.docx'),
        {
            id: 'f-001-b',
            name: 'Appendix_Data.txt',
            segments: [
                { id: 's-b-1', sourceText: 'Table 1: Revenue Stream', targetText: '', status: SegmentStatus.NotStarted, matchType: MatchType.None },
                { id: 's-b-2', sourceText: 'Table 2: Operational Costs', targetText: '', status: SegmentStatus.NotStarted, matchType: MatchType.None }
            ],
            totalSegments: 2,
            progress: 0
        }
    ],
    mainTmId: 'tm-global',
    tmIds: ['tm-global'],
    mainTbId: 'tb-global',
    tbIds: ['tb-global']
  },
  {
    id: 'p-002',
    name: '夏季营销活动方案',
    sourceLang: 'en-US',
    targetLang: 'zh-CN',
    createdAt: '2024-05-14',
    progress: 0,
    totalSegments: 12,
    files: [
        {
            id: 'f-002-a',
            name: 'Campaign_Brief.docx',
            segments: [], // Empty for brevity in mock
            totalSegments: 0,
            progress: 0
        }
    ],
    mainTmId: 'tm-marketing', 
    tmIds: ['tm-marketing', 'tm-global'],
    mainTbId: 'tb-marketing',
    tbIds: ['tb-marketing']
  }
];

export const SYSTEM_PROMPT = `你是一个专业的CAT（计算机辅助翻译）工具的AI翻译引擎。
你的任务是准确翻译用户输入的文本，保持语气和风格。
忽略 HTML 标签或 {0}, {1} 等占位符。
仅输出翻译结果，不要包含任何解释。`;

/** 常用符号单条「插入内容」最大字符数 */
export const EDITOR_QUICK_SYMBOL_CHAR_MAX = 32;
/** 常用符号列表最大条数 */
export const EDITOR_QUICK_SYMBOL_LIST_MAX = 100;

export const DEFAULT_EDITOR_QUICK_SYMBOLS: EditorQuickSymbol[] = [
  { id: 'qs-per-mille', char: '‰', label: '千分号 ‰' },
  { id: 'qs-celsius', char: '℃', label: '摄氏度 ℃' },
  { id: 'qs-fahrenheit', char: '℉', label: '华氏度 ℉' },
  { id: 'qs-degree', char: '°', label: '度符号 °' },
  { id: 'qs-plus-minus', char: '±', label: '正负号 ±' },
  { id: 'qs-times', char: '×', label: '乘号 ×' },
  { id: 'qs-divide', char: '÷', label: '除号 ÷' },
  { id: 'qs-ellipsis', char: '…', label: '省略号 …' },
];

export function coerceEditorQuickSymbols(raw: unknown): EditorQuickSymbol[] {
  if (!Array.isArray(raw)) {
    return DEFAULT_EDITOR_QUICK_SYMBOLS.map((e) => ({ ...e }));
  }
  const out: EditorQuickSymbol[] = [];
  const usedIds = new Set<string>();
  for (const el of raw) {
    if (!el || typeof el !== 'object') continue;
    const o = el as Record<string, unknown>;
    let id = typeof o.id === 'string' ? o.id.trim() : '';
    const charRaw = typeof o.char === 'string' ? o.char : '';
    const char = charRaw.slice(0, EDITOR_QUICK_SYMBOL_CHAR_MAX).trim();
    if (!char) continue;
    if (!id) id = `qs-mig-${out.length}-${Math.random().toString(36).slice(2, 9)}`;
    if (usedIds.has(id)) id = `${id}-${out.length}`;
    usedIds.add(id);
    const labelRaw =
      typeof o.label === 'string'
        ? o.label
        : typeof o.title === 'string'
          ? o.title
          : '';
    const label = labelRaw.trim().slice(0, 120) || undefined;
    out.push(label ? { id, char, label } : { id, char });
    if (out.length >= EDITOR_QUICK_SYMBOL_LIST_MAX) break;
  }
  return out.length > 0 ? out : DEFAULT_EDITOR_QUICK_SYMBOLS.map((e) => ({ ...e }));
}