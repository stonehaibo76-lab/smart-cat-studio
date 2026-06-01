import { 
  TwinTranslatorProfile, 
  StyleFeatures, 
  HabitualTranslation, 
  TrainingExample, 
  TranslationVariant,
  TranslationGenerationConfig,
  AISettings 
} from '../types';
import { translateSegment } from './geminiService';
import { DEEPSEEK_MODEL_OPTIONS } from '../constants';

// 生成唯一ID
const generateId = () => `tt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

/** 正面学习保存的训练例句（TrainingExample）最大条数，超出则丢弃最旧 */
export const MAX_STORED_TRAINING_EXAMPLES = 300;

/** 当前库内已保存的学习例句条数（与界面展示一致） */
export const twinStoredExampleCount = (profile: TwinTranslatorProfile): number =>
  Array.isArray(profile.trainingExamples) ? profile.trainingExamples.length : 0;

/** 将档案中的模型 id 规范为系统支持的 DeepSeek 模型之一 */
export const normalizeTwinBaseModel = (model?: string): string => {
  const m = (model ?? '').trim();
  if (DEEPSEEK_MODEL_OPTIONS.some((o) => o.value === m)) return m;
  return DEEPSEEK_MODEL_OPTIONS[0].value;
};

/**
 * 孪生译员推理：在已配置 DeepSeek Key 时使用 DeepSeek，模型 id 取自译员档案；
 * 其余字段继承全局 AI 设置（密钥等）。
 */
export const resolveTwinTranslatorAiSettings = (
  profile: TwinTranslatorProfile,
  aiSettings?: AISettings
): AISettings | undefined => {
  if (!aiSettings) return undefined;
  const key = aiSettings.deepSeekKey?.trim();
  if (!key) return aiSettings;
  return {
    ...aiSettings,
    provider: 'deepseek',
    model: normalizeTwinBaseModel(profile.baseModel),
    deepSeekKey: key
  };
};

/** 导出 Excel 用的扁平行（单译员） */
export const buildLearnedSegmentExportRows = (
  translator: TwinTranslatorProfile
): Record<string, string>[] => {
  const examples = Array.isArray(translator.trainingExamples) ? translator.trainingExamples : [];
  return examples.map(ex => ({
    译员名称: translator.name,
    译员ID: translator.id,
    语言对: ex.languagePair || translator.languagePair,
    原文: ex.sourceText ?? '',
    'AI建议译文': ex.originalTranslation ?? '',
    用户译文: ex.userTranslation ?? '',
    差异说明: Array.isArray(ex.differences) ? ex.differences.join('；') : '',
    学习时间: ex.learnedAt ?? '',
    领域: ex.domain ?? '',
    记录ID: ex.id ?? ''
  }));
};

/** 将学习例句格式化为知识库正文（切块前） */
export const formatTrainingExamplesAsKnowledgeBaseRawText = (
  profile: TwinTranslatorProfile
): string => {
  const examples = Array.isArray(profile.trainingExamples) ? profile.trainingExamples : [];
  if (examples.length === 0) return '';
  const lines: string[] = [
    `【孪生译员「${profile.name}」学习例句备份】`,
    `语言对：${profile.languagePair.replace('-', ' → ')}`,
    `共 ${examples.length} 条。以下为原文与用户译文，供翻译知识库检索参考。`,
    ''
  ];
  examples.forEach((ex, i) => {
    lines.push(`【例 ${i + 1} / ${examples.length}】`);
    lines.push(`原文：${ex.sourceText}`);
    lines.push(`译文：${ex.userTranslation}`);
    if (ex.originalTranslation?.trim()) {
      lines.push(`（参考）模型建议译文：${ex.originalTranslation}`);
    }
    lines.push('');
  });
  return lines.join('\n').trim();
};

/** 合并多个译员的学习例句为一份知识库正文（便于一次性粘贴到知识库） */
export const formatAllTranslatorsTrainingExamplesAsKnowledgeBaseRawText = (
  translators: TwinTranslatorProfile[]
): string => {
  const blocks = translators
    .map(t => formatTrainingExamplesAsKnowledgeBaseRawText(t).trim())
    .filter(Boolean);
  if (blocks.length === 0) return '';
  if (blocks.length === 1) return blocks[0];
  return blocks
    .map(
      (block, idx) =>
        `════════════════════════════════════\n译员区块 ${idx + 1} / ${blocks.length}\n════════════════════════════════════\n\n${block}`
    )
    .join('\n\n');
};

export type TwinTrainingCapNotice = 'first_full' | 'rotating';

/**
 * 本次正面学习后是否触达例句存储上限（300），用于提示用户备份。
 * - first_full：从 299 条增至 300 条
 * - rotating：已满 300 条后继续学习，最旧一条已被替换
 */
export const getTwinTrainingCapNotice = (
  prevProfile: TwinTranslatorProfile,
  nextProfile: TwinTranslatorProfile,
  hadPositiveExampleAppend: boolean
): TwinTrainingCapNotice | undefined => {
  if (!hadPositiveExampleAppend) return undefined;
  const prevN = twinStoredExampleCount(prevProfile);
  const nextN = twinStoredExampleCount(nextProfile);
  if (nextN !== MAX_STORED_TRAINING_EXAMPLES) return undefined;
  if (prevN === MAX_STORED_TRAINING_EXAMPLES - 1) return 'first_full';
  if (prevN === MAX_STORED_TRAINING_EXAMPLES) return 'rotating';
  return undefined;
};

/** BCP-47 或短代码 → 主语言码（小写），如 en-US → en */
export const primaryLanguageCode = (locale: string): string => {
  if (!locale || typeof locale !== 'string') return 'en';
  return locale.split('-')[0].trim().toLowerCase();
};

/** 主语言是否为中文（含 zh / cmn 等常见写法） */
export const isChinesePrimaryLocale = (locale: string): boolean => {
  const p = primaryLanguageCode(locale);
  return p === 'zh' || p === 'cmn' || p === 'yue' || p === 'wuu';
};

/** 中译外：原文为中文且译文主语言非中文 */
export const isZhToForeignProjectLocales = (sourceLocale: string, targetLocale: string): boolean =>
  isChinesePrimaryLocale(sourceLocale) && !isChinesePrimaryLocale(targetLocale);

/**
 * 将译文中首个 Unicode 字母转为大写（按译文语言区域规则），用于中译外首字母规范。
 * 不改变前导空格、标点及后续字符。
 */
export const capitalizeFirstLetterInTarget = (text: string, targetLocale: string): string => {
  if (!text) return text;
  const loc = targetLocale?.trim() || 'en';
  try {
    const m = text.match(/\p{L}/u);
    if (!m || m.index === undefined) return text;
    const i = m.index;
    const g = m[0];
    let upper: string;
    try {
      upper = g.toLocaleUpperCase(loc);
    } catch {
      upper = g.toLocaleUpperCase('en');
    }
    if (upper === g) return text;
    return text.slice(0, i) + upper + text.slice(i + g.length);
  } catch {
    return text;
  }
};

/** 与编辑器项目语言一致的语言对键，如 en-zh */
export const languagePairFromProjectLocales = (sourceLocale: string, targetLocale: string): string =>
  `${primaryLanguageCode(sourceLocale)}-${primaryLanguageCode(targetLocale)}`;

// 分析用户译文与AI译文的差异（第一阶段扩充术语库）
export const analyzeTranslationDifferences = (
  sourceText: string,
  aiTranslation: string,
  userTranslation: string
): string[] => {
  const differences: string[] = [];

  // 简单差异分析（可扩展为更复杂的NLP分析）
  if (aiTranslation !== userTranslation) {
    // 1. 长度差异
    const aiLength = aiTranslation.length;
    const userLength = userTranslation.length;
    if (Math.abs(aiLength - userLength) > aiLength * 0.2) {
      if (userLength > aiLength) {
        differences.push('用户译文更详细');
      } else {
        differences.push('用户译文更简洁');
      }
    }

    // 2. 术语检查（第一阶段扩充）
    const commonTerms = [
      // 技术术语
      'API', 'UI', 'UX', 'CPU', 'GPU', 'AI', 'SDK', 'IDE', 'CLI', 'JSON',
      'XML', 'HTML', 'CSS', 'JavaScript', 'TypeScript', 'Python', 'Java',
      'Node.js', 'React', 'Vue', 'Angular', 'Docker', 'Kubernetes',
      // 功能术语
      'button', 'menu', 'dialog', 'window', 'panel', 'tab', 'sidebar',
      'toolbar', 'statusbar', 'scrollbar', 'dropdown', 'checkbox', 'radio',
      // 操作术语
      'click', 'double-click', 'drag', 'drop', 'hover', 'focus', 'blur',
      'scroll', 'resize', 'navigate', 'browse', 'search', 'filter', 'sort',
      // 数据术语
      'database', 'table', 'column', 'row', 'field', 'record', 'index',
      'query', 'transaction', 'commit', 'rollback', 'schema',
      // 设置术语
      'configuration', 'setting', 'preference', 'option', 'parameter',
      'property', 'attribute', 'value', 'key', 'default',
      // 状态术语
      'enabled', 'disabled', 'active', 'inactive', 'visible', 'hidden',
      'locked', 'unlocked', 'selected', 'unselected', 'checked', 'unchecked'
    ];

    for (const term of commonTerms) {
      if (aiTranslation.includes(term) && !userTranslation.includes(term)) {
        differences.push(`用户不使用术语 "${term}"`);
      }
      if (!aiTranslation.includes(term) && userTranslation.includes(term)) {
        differences.push(`用户添加术语 "${term}"`);
      }
    }

    // 3. 句式差异（基于标点）
    const aiSentences = aiTranslation.split(/[。！？.!?]/).filter(s => s.trim());
    const userSentences = userTranslation.split(/[。！？.!?]/).filter(s => s.trim());
    if (aiSentences.length !== userSentences.length) {
      differences.push(`句子数量变化：${aiSentences.length} → ${userSentences.length}`);
    }
  }

  return differences.length > 0 ? differences : ['细微调整'];
};

// 提取风格特征（第二阶段：使用动态权重）
export const extractStyleFeatures = (
  sourceText: string,
  translation: string,
  existingFeatures?: StyleFeatures,
  alpha: number = 0.2 // 第四阶段：动态衰减因子
): StyleFeatures => {
  // 简单特征提取
  const sentences = translation.split(/[。！？.!?]/).filter(s => s.trim());
  const words = translation.split(/\s+/).filter(w => w);

  const newFeatures: StyleFeatures = {
    sentenceLengthAvg: sentences.length > 0
      ? translation.length / sentences.length
      : existingFeatures?.sentenceLengthAvg || 30,

    formalLevel: calculateFormality(translation),

    terminologyConsistency: calculateTerminologyConsistency(translation, sourceText),

    syntacticComplexity: calculateSyntacticComplexity(translation),

    wordChoiceNovelty: calculateWordNovelty(translation),

    translationFluency: calculateFluency(translation),

    // 第三阶段：新增特征
    wordOrderPreference: calculateWordOrderPreference(translation, existingFeatures?.wordOrderPreference),
    translationStrategy: calculateTranslationStrategy(translation, sourceText, existingFeatures?.translationStrategy),
    punctuationStyle: calculatePunctuationStyle(translation, existingFeatures?.punctuationStyle)
  };

  // 如果没有现有特征，直接返回
  if (!existingFeatures) {
    return newFeatures;
  }

  // 第四阶段：使用动态衰减因子进行加权平均
  const beta = 1 - alpha;
  return {
    sentenceLengthAvg: existingFeatures.sentenceLengthAvg * beta + newFeatures.sentenceLengthAvg * alpha,
    formalLevel: existingFeatures.formalLevel * beta + newFeatures.formalLevel * alpha,
    terminologyConsistency: existingFeatures.terminologyConsistency * beta + newFeatures.terminologyConsistency * alpha,
    syntacticComplexity: existingFeatures.syntacticComplexity * beta + newFeatures.syntacticComplexity * alpha,
    wordChoiceNovelty: existingFeatures.wordChoiceNovelty * beta + newFeatures.wordChoiceNovelty * alpha,
    translationFluency: existingFeatures.translationFluency * beta + newFeatures.translationFluency * alpha,
    wordOrderPreference: newFeatures.wordOrderPreference,
    translationStrategy: newFeatures.translationStrategy,
    punctuationStyle: newFeatures.punctuationStyle
  };
};

/** 按句切分（中英常见句末），至少返回一句以便算句长 */
const splitSentencesForFormality = (text: string): string[] => {
  const parts = text
    .split(/[。！？.!?…]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
  const trimmed = text.trim();
  return parts.length > 0 ? parts : trimmed ? [trimmed] : [];
};

/** 正式程度：公文/书面词、敬语、被动与书面结构、句长；并削弱口语、缩写与过短句 */
const calculateFormality = (text: string): number => {
  if (!text || !text.trim()) return 50;

  const t = text;
  let score = 50;

  const formalLex = [
    '兹',
    '谨',
    '阁下',
    '贵司',
    '贵方',
    '敬启',
    '特此',
    '鉴于',
    '遵循',
    '不胜感激',
    '敬请',
    '烦请',
    '恳请',
    '拨冗',
    '莅临',
    '斧正',
    '赐教',
    '见谅',
    '为荷',
    '此致',
    '敬礼',
    '顺祝',
    '商祺'
  ];
  const informalLex = [
    '吧',
    '啊',
    '呢',
    '呀',
    '咱们',
    '搞定',
    '超',
    '挺',
    '咋',
    '啥',
    '哈',
    '嘿嘿',
    '有木有',
    '贼',
    '巨',
    '老铁',
    '666',
    'emm',
    '嗯嗯',
    '哦哦'
  ];

  let formalHits = 0;
  for (const w of formalLex) {
    if (t.includes(w)) formalHits += 1;
  }
  let informalHits = 0;
  for (const w of informalLex) {
    if (t.includes(w)) informalHits += 1;
  }
  score += Math.min(22, formalHits * 5) - Math.min(22, informalHits * 4);

  const honorifics = [
    '您',
    '贵公司',
    '贵单位',
    '贵方',
    '敝公司',
    '鄙人',
    '在下',
    '承蒙',
    '蒙您',
    '劳烦',
    '有劳',
    '拜托',
    '恭候',
    '敬候',
    '谨代表',
    '谨向',
    '致以',
    '深表',
    '深表歉意',
    '深感',
    '不胜荣幸'
  ];
  let h = 0;
  for (const w of honorifics) {
    if (t.includes(w)) h += 1;
  }
  score += Math.min(16, h * 3);

  const writtenMarkers = [
    '综上所述',
    '鉴于此',
    '鉴于此种',
    '有鉴于此',
    '因此',
    '故而',
    '换言之',
    '亦即',
    '如下所示',
    '如下',
    '上述',
    '下列',
    '本条款',
    '本规定',
    '须满足',
    '须确保',
    '应当',
    '不得',
    '严禁',
    '务必',
    '均应',
    '方可',
    '予以',
    ' accordingly',
    ' hereinafter',
    ' aforementioned',
    ' pursuant to',
    ' in accordance with'
  ];
  let wm = 0;
  for (const w of writtenMarkers) {
    if (t.toLowerCase().includes(w.trim().toLowerCase())) wm += 1;
  }
  if (/若[^，。]{0,12}则/.test(t)) wm += 1;
  score += Math.min(14, wm * 2);

  const colloquialMarkers = [
    '搞定',
    '整一下',
    '弄一下',
    '瞅瞅',
    '瞧瞧',
    '玩儿',
    '咋整',
    '拉倒',
    '得了吧',
    '得了呗',
    'OK啦',
    'okay啦',
    'yeah',
    'yep',
    'nope',
    'gonna',
    'wanna',
    ' kinda ',
    ' sorta '
  ];
  let cm = 0;
  for (const w of colloquialMarkers) {
    if (t.toLowerCase().includes(w.toLowerCase())) cm += 1;
  }
  score -= Math.min(14, cm * 3);

  const zhChars = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  const totalChars = t.replace(/\s/g, '').length || 1;
  const zhRatio = zhChars / totalChars;

  const sents = splitSentencesForFormality(t);
  const nonSpaceLen = t.replace(/\s/g, '').length;
  const avgCharsPerSentence = sents.length > 0 ? nonSpaceLen / sents.length : nonSpaceLen;

  if (zhRatio >= 0.25) {
    // 书面中文常见句长略长；极短多为按钮/标签偏中性略口语
    const lenAdj = Math.max(-10, Math.min(14, (avgCharsPerSentence - 20) * 0.45));
    score += lenAdj;
  } else {
    const lenAdj = Math.max(-6, Math.min(10, (avgCharsPerSentence - 14) * 0.35));
    score += lenAdj;
  }

  const passiveZhPatterns = [
    /被[\u4e00-\u9fff]{0,10}[，。、；]/g,
    /被[\u4e00-\u9fff]{1,12}(?:于|到|为)/g,
    /由[^，。]{1,18}所(?:致|引起|决定|构成)/g,
    /得以(?:实现|执行|保存|应用|使用)/g,
    /(?:受|遭)(?:到|遇)[^，。]{1,12}[，。]/g,
    /(?:为|被)[^，。]{1,10}(?:所|而)[\u4e00-\u9fff]{0,8}[，。]/g
  ];
  let pz = 0;
  for (const re of passiveZhPatterns) {
    const m = t.match(re);
    if (m) pz += m.length;
  }
  score += Math.min(12, pz * 2);

  const latinLetters = (t.match(/[A-Za-z]/g) || []).length;
  if (latinLetters > totalChars * 0.12) {
    const contractions = t.match(/\b\w+'(?:t|s|re|ve|ll|d)\b/gi);
    if (contractions) score -= Math.min(10, contractions.length * 2);

    if (/\b(?:shall|hereby|thereof|wherein|whereby|hereto|herein|aforesaid|pursuant)\b/i.test(t)) {
      score += 10;
    }
    if (/\b(?:please note|kindly|we would appreciate|we hereby)\b/i.test(t)) {
      score += 6;
    }
  }

  return Math.max(0, Math.min(100, Math.round(score)));
};

// 计算术语一致性
const calculateTerminologyConsistency = (translation: string, sourceText: string): number => {
  // 简单实现：检查翻译中是否保留了英文术语
  const englishTerms = sourceText.match(/[A-Za-z]+/g) || [];
  const preservedTerms = englishTerms.filter(term => 
    translation.includes(term) && term.length > 2
  );
  
  return englishTerms.length > 0 
    ? preservedTerms.length / englishTerms.length * 100
    : 80; // 默认值
};

// 计算句法复杂度
const calculateSyntacticComplexity = (text: string): number => {
  const sentences = text.split(/[。！？.!?]/).filter(s => s.trim());
  if (sentences.length === 0) return 50;
  
  const avgWordsPerSentence = text.split(/\s+/).length / sentences.length;
  const hasComplexStructures = text.includes('，') || text.includes('；') || text.includes('：');
  
  let score = avgWordsPerSentence * 2; // 每词2分
  if (hasComplexStructures) score += 20;
  
  return Math.min(100, Math.max(0, score));
};

// 计算词汇新颖度
const calculateWordNovelty = (text: string): number => {
  // 简单实现：统计非常用词汇比例
  const commonWords = ['的', '是', '在', '了', '和', '与', '这', '那', '有', '没有'];
  const words = text.split('');
  const totalWords = words.length;
  
  if (totalWords === 0) return 50;
  
  let commonCount = 0;
  for (const word of words) {
    if (commonWords.includes(word)) commonCount++;
  }
  
  const noveltyRatio = 1 - (commonCount / totalWords);
  return noveltyRatio * 100;
};

// 计算译文流畅度
const calculateFluency = (text: string): number => {
  // 简单流畅度评估
  const chinesePattern = /[\u4e00-\u9fa5]/g; // 中文字符
  const englishPattern = /[A-Za-z]/g;
  const punctuationPattern = /[。，！？、；：]/g;
  
  const chineseChars = (text.match(chinesePattern) || []).length;
  const englishChars = (text.match(englishPattern) || []).length;
  const punctuationCount = (text.match(punctuationPattern) || []).length;
  
  const totalChars = text.length;
  if (totalChars === 0) return 50;
  
  // 中英混杂度（越低越好）
  const mixingRatio = englishChars > 0 ? (englishChars / totalChars) : 0;
  
  // 标点密度（适中为好）- 需要先计算句子数量
  const sentences = text.split(/[。！？\n]/).filter(s => s.trim().length > 0).length;
  const punctuationDensity = sentences > 0 ? punctuationCount / sentences : 0;
  
  let score = 60; // 基础分
  
  // 调整分数
  if (mixingRatio > 0.3) score -= 20; // 中英混杂过多扣分
  if (punctuationDensity < 0.5) score += 10; // 标点适中有加分
  
  return Math.min(100, Math.max(0, score));
};

// 更新习惯译法
export const updateHabitualTranslations = (
  sourceText: string,
  userTranslation: string,
  existingHabitual: HabitualTranslation[]
): HabitualTranslation[] => {
  const updated = [...existingHabitual];
  
  // 检查是否已有相似译法
  const existingIndex = updated.findIndex(h => 
    h.sourcePattern === sourceText || 
    h.targetPattern === userTranslation ||
    (h.sourcePattern.includes(sourceText.substring(0, 10)) && sourceText.length > 20)
  );
  
  if (existingIndex >= 0) {
    // 更新现有译法
    updated[existingIndex] = {
      ...updated[existingIndex],
      frequency: updated[existingIndex].frequency + 1,
      lastUsed: new Date().toISOString(),
      confidence: Math.min(1, updated[existingIndex].confidence + 0.05)
    };
  } else {
    // 添加新译法
    updated.push({
      id: generateId(),
      sourcePattern: sourceText,
      targetPattern: userTranslation,
      frequency: 1,
      lastUsed: new Date().toISOString(),
      confidence: 0.7
    });
  }
  
  // 按使用频率排序，限制数量
  return updated
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 100); // 最多保留100条
};

/** 从文本提取用于匹配的「关键词」：拉丁词元、CJK 单字与双字组 */
const collectKeywordLikeTokens = (text: string): Set<string> => {
  const set = new Set<string>();
  const t = text.trim();
  if (!t) return set;

  const words = t.toLowerCase().match(/[a-z0-9][a-z0-9._-]*/g) || [];
  words.forEach((w) => {
    if (w.length >= 2) set.add(w);
  });

  const cjk = t.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || [];
  cjk.forEach((c) => set.add(c));
  for (let i = 0; i < cjk.length - 1; i++) {
    set.add(cjk[i] + cjk[i + 1]);
  }

  return set;
};

/** 当前句段与某条习惯译法 sourcePattern 的相似度/关键词匹配得分（越高越相关） */
const scoreHabitualAgainstSource = (sourceText: string, pattern: string): number => {
  const s = sourceText.trim();
  const p = pattern.trim();
  if (!s || !p) return 0;

  let score = 0;
  const sLow = s.toLowerCase();
  const pLow = p.toLowerCase();

  if (p.length >= 2 && sLow.includes(pLow)) {
    score += 0.35;
  } else if (s.length >= 2 && pLow.includes(sLow)) {
    score += 0.28;
  } else {
    const shorter = p.length <= s.length ? p : s;
    const longer = p.length <= s.length ? s : p;
    if (shorter.length >= 4) {
      const chunk = shorter.slice(0, Math.min(shorter.length, 14));
      if (longer.toLowerCase().includes(chunk.toLowerCase())) {
        score += 0.15;
      }
    }
  }

  const A = collectKeywordLikeTokens(s);
  const B = collectKeywordLikeTokens(p);
  if (A.size === 0 && B.size === 0) {
    return score;
  }

  let inter = 0;
  A.forEach((tok) => {
    if (B.has(tok)) inter++;
  });
  const union = A.size + B.size - inter;
  const jaccard = union > 0 ? inter / union : 0;
  const patternHitRate = B.size > 0 ? inter / B.size : 0;
  const sourceRecall = A.size > 0 ? inter / A.size : 0;

  score += jaccard * 0.45 + patternHitRate * 0.35 + sourceRecall * 0.25;
  return score;
};

/**
 * 选取与当前句段原文最相关的习惯译法（相似度 + 关键词匹配），用于提示词。
 * 若与当前句段几乎无交集，则按使用频率回退。
 */
export const selectRelevantHabitualTranslations = (
  sourceText: string,
  habitual: HabitualTranslation[],
  topK: number = 5
): HabitualTranslation[] => {
  if (habitual.length === 0) return [];
  if (!sourceText.trim()) {
    return [...habitual].sort((a, b) => b.frequency - a.frequency).slice(0, topK);
  }

  const scored = habitual.map((ht) => ({
    ht,
    score: scoreHabitualAgainstSource(sourceText, ht.sourcePattern)
  }));

  const maxScore = Math.max(...scored.map((x) => x.score), 0);
  if (maxScore <= 0) {
    return scored
      .sort((a, b) => b.ht.frequency - a.ht.frequency)
      .slice(0, topK)
      .map((x) => x.ht);
  }

  return scored
    .sort((a, b) => {
      if (Math.abs(b.score - a.score) > 1e-6) return b.score - a.score;
      return b.ht.frequency - a.ht.frequency;
    })
    .slice(0, topK)
    .map((x) => x.ht);
};

// 创建孪生译员档案
export const createTwinTranslatorProfile = (
  name: string,
  description: string,
  languagePair: string,
  baseModel?: string
): TwinTranslatorProfile => {
  const now = new Date().toISOString();

  return {
    id: generateId(),
    name,
    description,
    languagePair,
    baseModel: normalizeTwinBaseModel(baseModel),

    styleFeatures: {
      sentenceLengthAvg: 30,
      formalLevel: 50,
      terminologyConsistency: 80,
      syntacticComplexity: 50,
      wordChoiceNovelty: 50,
      translationFluency: 70,
      // 第三阶段初始值
      wordOrderPreference: {
        conditionalPosition: 'before',
        passiveToActive: false,
        modifierPosition: 'before'
      },
      translationStrategy: {
        domestication: 50,
        explicitation: 50,
        literalness: 50
      },
      punctuationStyle: {
        fullWidthRatio: 0.9,
        commaStyle: 'clause',
        bracketUsage: 0.3
      }
    },

    learnedSegments: 0,
    trainingDataSize: 0,
    habitualTranslations: [],
    // 第二阶段初始值
    terminologyMappings: [],
    preferences: {
      preferFormality: 50,
      preferConcise: false,
      avoidRepetition: true,
      useSpecificTerms: [],
      translationSpeed: 'balanced',
      creativityLevel: 50
    },

    trainingExamples: [],
    // 第四阶段初始值
    domainWeights: {},
    negativeExamples: [],
    temporalDecayAlpha: 0.2,
    useKnowledgeBaseForSuggestions: false,

    trainingStatus: 'idle',
    lastTrained: now,
    createdAt: now,

    successRate: 0,
    averageConfidence: 0,

    twinSuggestionOfferCount: 0,
    twinSuggestionAdoptionCount: 0,
    twinSuggestionNegativeRatingCount: 0
  };
};

/** 采纳率 = 100×采纳/建议，并按差评次数减去 100×差评/建议（不低于 0） */
export const computeTwinSuggestionSuccessRate = (profile: TwinTranslatorProfile): number => {
  const offers = profile.twinSuggestionOfferCount ?? 0;
  const adoptions = profile.twinSuggestionAdoptionCount ?? 0;
  const negatives = profile.twinSuggestionNegativeRatingCount ?? 0;
  if (offers <= 0) return 0;
  const raw = (100 * adoptions) / offers;
  const penalty = (100 * negatives) / offers;
  return Math.max(0, Math.min(100, Math.round(raw - penalty)));
};

/**
 * 综合训练量、习惯译法、术语映射、风格稳定性与建议面板采纳/差评，得到 0–1 的平均置信度。
 * 用于孪生译员卡片展示，并参与「用户风格」译文变体的 confidence 计算。
 */
export const computeTwinAverageConfidence = (profile: TwinTranslatorProfile): number => {
  const n = Math.max(
    0,
    profile.trainingDataSize ??
      (Array.isArray(profile.trainingExamples) ? profile.trainingExamples.length : 0)
  );
  const habitualN = Array.isArray(profile.habitualTranslations) ? profile.habitualTranslations.length : 0;
  const termN = Array.isArray(profile.terminologyMappings) ? profile.terminologyMappings.length : 0;
  const styleTc = Math.max(
    0,
    Math.min(100, profile.styleFeatures?.terminologyConsistency ?? 0)
  );

  const offers = profile.twinSuggestionOfferCount ?? 0;
  const negatives = profile.twinSuggestionNegativeRatingCount ?? 0;
  const successPct =
    Math.max(0, Math.min(100, profile.successRate ?? computeTwinSuggestionSuccessRate(profile))) / 100;

  const negStored = Array.isArray(profile.negativeExamples) ? profile.negativeExamples.length : 0;

  let c = 0;
  c += 0.46 * (1 - Math.exp(-n / 42));
  c += 0.14 * Math.min(1, habitualN / 45);
  c += 0.12 * Math.min(1, termN / 28);
  c += 0.1 * (styleTc / 100);

  if (offers >= 1) {
    c += 0.22 * successPct;
  }

  if (offers > 0) {
    c -= 0.2 * Math.min(1, negatives / offers);
  }
  c -= 0.04 * Math.min(1, negStored / 25);

  return Math.max(0, Math.min(1, Math.round(c * 1000) / 1000));
};

/** 每次成功生成并展示一批译文建议时调用，建议数 +1 并重算采纳率 */
export const recordTwinSuggestionOffer = (profile: TwinTranslatorProfile): TwinTranslatorProfile => {
  const next: TwinTranslatorProfile = {
    ...profile,
    twinSuggestionOfferCount: (profile.twinSuggestionOfferCount ?? 0) + 1
  };
  next.successRate = computeTwinSuggestionSuccessRate(next);
  next.averageConfidence = computeTwinAverageConfidence(next);
  return next;
};

/** 构建孪生译员风格说明（作为 translateSegment 的 additionalContext，待译句单独传入） */
const buildUserStyleAdditionalContext = (
  profile: TwinTranslatorProfile,
  sourceText: string
): string => {
  let ctx = `请模仿特定译员的翻译风格进行翻译。\n\n译员风格特征：\n`;
  ctx += `- 句子平均长度：${profile.styleFeatures.sentenceLengthAvg.toFixed(1)}字符\n`;
  ctx += `- 正式程度：${profile.styleFeatures.formalLevel}/100\n`;
  ctx += `- 术语一致性：${profile.styleFeatures.terminologyConsistency}/100\n`;
  ctx += `- 偏爱${profile.preferences.preferConcise ? '简洁' : '详细'}表达\n`;

  if (profile.preferences.useSpecificTerms.length > 0) {
    ctx += `- 偏好使用这些术语：${profile.preferences.useSpecificTerms.join('、')}\n`;
  }

  if (profile.styleFeatures.wordOrderPreference) {
    ctx += `- 语序偏好：${profile.styleFeatures.wordOrderPreference.conditionalPosition === 'before' ? '条件句前置' : '条件句后置'}\n`;
  }

  if (profile.styleFeatures.translationStrategy) {
    ctx += `- 翻译策略：归化度${profile.styleFeatures.translationStrategy.domestication.toFixed(0)}，直译度${profile.styleFeatures.translationStrategy.literalness.toFixed(0)}\n`;
  }

  if (profile.terminologyMappings && profile.terminologyMappings.length > 0) {
    ctx += `\n术语表（必须严格遵循）：\n`;
    const topMappings = profile.terminologyMappings.slice(0, 10);
    topMappings.forEach((mapping, i) => {
      ctx += `${i + 1}. ${mapping.sourceTerm} → ${mapping.targetTerm}\n`;
    });
    ctx += `\n请严格按照以上术语翻译。\n`;
  }

  if (profile.trainingExamples.length > 0) {
    const similarExamples = findSimilarExamples(sourceText, profile.trainingExamples, 3);
    if (similarExamples.length > 0) {
      ctx += `\n以下是该译员对相似内容的翻译示例（请参考其风格）：\n`;
      similarExamples.forEach((ex, i) => {
        ctx += `${i + 1}. 原文: "${ex.sourceText}" → 译文: "${ex.userTranslation}"\n`;
      });
    }
  }

  if (profile.habitualTranslations.length > 0) {
    ctx += `\n常用译法示例：\n`;
    const examples = selectRelevantHabitualTranslations(sourceText, profile.habitualTranslations, 5);
    examples.forEach((ht, i) => {
      ctx += `${i + 1}. "${ht.sourcePattern}" → "${ht.targetPattern}"\n`;
    });
  }

  if (profile.negativeExamples && profile.negativeExamples.length > 0) {
    ctx += `\n请避免生成与下列不受欢迎的译文过于接近的表达：\n`;
    profile.negativeExamples.slice(-3).forEach((ex) => {
      const t = ex.text?.trim() || '';
      const snippet = t.length > 120 ? `${t.slice(0, 120)}…` : t;
      ctx += `- 「${snippet}」（${ex.reason}）\n`;
    });
  }

  ctx += `\n请严格遵循以上风格与术语要求，仅输出译文，不要解释。`;
  return ctx;
};

/** 与原先串行逻辑一致：决定需要哪几条变体（用户风格 / 标准 / 创意 / 保守），最多四种 */
type TwinVariantSlotKind = 'user' | 'base' | 'creative' | 'conservative';

const planTwinVariantSlots = (
  translatorProfile: TwinTranslatorProfile,
  config: TranslationGenerationConfig
): TwinVariantSlotKind[] => {
  const slots: TwinVariantSlotKind[] = [];
  if (translatorProfile.learnedSegments > 0) {
    slots.push('user');
  }
  if (config.includeBaseTranslation || translatorProfile.learnedSegments === 0) {
    slots.push('base');
  }
  while (slots.length < config.numberOfVariants) {
    if (!slots.includes('creative')) {
      slots.push('creative');
      continue;
    }
    if (!slots.includes('conservative')) {
      slots.push('conservative');
      continue;
    }
    break;
  }
  return slots;
};

// 生成基于用户风格的译文变体（editorLangs 与编辑器项目源/目标语一致时传入，否则回退到译员档案 languagePair）
export const generateTranslationVariants = async (
  sourceText: string,
  translatorProfile: TwinTranslatorProfile,
  config: TranslationGenerationConfig = {
    numberOfVariants: 3,
    includeBaseTranslation: true,
    temperature: 0.7,
    maxLength: 500
  },
  aiSettings?: AISettings,
  editorLangs?: { sourceLang: string; targetLang: string },
  ragContext?: string
): Promise<TranslationVariant[]> => {
  const pair = translatorProfile.languagePair.split('-');
  const sourceLang = editorLangs?.sourceLang ?? pair[0];
  const targetLang = editorLangs?.targetLang ?? pair[1];

  const resolvedAi = resolveTwinTranslatorAiSettings(translatorProfile, aiSettings);

  const slots = planTwinVariantSlots(translatorProfile, config);

  const runSlot = (kind: TwinVariantSlotKind): Promise<TranslationVariant> => {
    switch (kind) {
      case 'user':
        return generateUserStyleVariant(
          sourceText,
          translatorProfile,
          sourceLang,
          targetLang,
          resolvedAi,
          ragContext
        );
      case 'base':
        return generateBaseVariant(
          sourceText,
          sourceLang,
          targetLang,
          resolvedAi,
          ragContext
        );
      case 'creative':
        return generateCreativeVariant(
          sourceText,
          sourceLang,
          targetLang,
          resolvedAi,
          ragContext
        );
      case 'conservative':
        return generateConservativeVariant(
          sourceText,
          sourceLang,
          targetLang,
          resolvedAi,
          ragContext
        );
    }
  };

  // 各变体彼此独立，并行请求以将总耗时从「多次相加」降为「最慢一次」量级
  return Promise.all(slots.map(runSlot));
};

const generateUserStyleVariant = async (
  sourceText: string,
  profile: TwinTranslatorProfile,
  sourceLang: string,
  targetLang: string,
  aiSettings?: AISettings,
  ragContext?: string
): Promise<TranslationVariant> => {
  const additionalContext = buildUserStyleAdditionalContext(profile, sourceText);

  try {
    const translation = await translateSegment(
      sourceText,
      targetLang,
      sourceLang,
      additionalContext,
      undefined,
      aiSettings,
      ragContext
    );

    return {
      id: generateId(),
      text: translation,
      styleLabel: '用户风格',
      confidence: profile.averageConfidence * 0.8 + 0.2,
      reasoning: '基于用户历史翻译风格生成（包含相似例句和术语映射）',
      features: profile.styleFeatures
    };
  } catch (error) {
    console.error('生成用户风格译文失败:', error);
    return {
      id: generateId(),
      text: '',
      styleLabel: '用户风格',
      confidence: 0.3,
      reasoning: '风格学习不足，无法生成'
    };
  }
};

const generateBaseVariant = async (
  sourceText: string,
  sourceLang: string,
  targetLang: string,
  aiSettings?: AISettings,
  ragContext?: string
): Promise<TranslationVariant> => {
  try {
    const translation = await translateSegment(
      sourceText,
      targetLang,
      sourceLang,
      undefined,
      undefined,
      aiSettings,
      ragContext
    );

    return {
      id: generateId(),
      text: translation,
      styleLabel: '标准AI翻译',
      confidence: 0.85,
      reasoning: '基于通用AI模型翻译'
    };
  } catch (error) {
    console.error('生成基础译文失败:', error);
    return {
      id: generateId(),
      text: '',
      styleLabel: '标准AI翻译',
      confidence: 0.3,
      reasoning: '翻译服务不可用'
    };
  }
};

const generateCreativeVariant = async (
  sourceText: string,
  sourceLang: string,
  targetLang: string,
  aiSettings?: AISettings,
  ragContext?: string
): Promise<TranslationVariant> => {
  const additionalContext =
    '请以更具创意的风格翻译：使用更生动的词汇与更灵活的句式，但保持原文核心含义。仅输出译文，不要解释。';

  try {
    const translation = await translateSegment(
      sourceText,
      targetLang,
      sourceLang,
      additionalContext,
      undefined,
      aiSettings,
      ragContext
    );

    return {
      id: generateId(),
      text: translation,
      styleLabel: '创意表达',
      confidence: 0.65,
      reasoning: '采用更灵活的表达方式'
    };
  } catch (error) {
    console.error('生成创意译文失败:', error);
    return {
      id: generateId(),
      text: '',
      styleLabel: '创意表达',
      confidence: 0.3,
      reasoning: '创意翻译失败'
    };
  }
};

const generateConservativeVariant = async (
  sourceText: string,
  sourceLang: string,
  targetLang: string,
  aiSettings?: AISettings,
  ragContext?: string
): Promise<TranslationVariant> => {
  const additionalContext =
    '请采用保守、偏直译的方式，尽量贴近原文结构与常用词。仅输出译文，不要解释。';

  try {
    const translation = await translateSegment(
      sourceText,
      targetLang,
      sourceLang,
      additionalContext,
      undefined,
      aiSettings,
      ragContext
    );

    return {
      id: generateId(),
      text: translation,
      styleLabel: '保守翻译',
      confidence: 0.75,
      reasoning: '严格遵循原文结构'
    };
  } catch (error) {
    console.error('生成保守译文失败:', error);
    return {
      id: generateId(),
      text: '',
      styleLabel: '保守翻译',
      confidence: 0.3,
      reasoning: '保守翻译失败'
    };
  }
};

export type ProcessLearningFeedbackOptions = {
  /** 与当前编辑器项目一致的语言对，写入训练例句并校准档案 */
  effectiveLanguagePair?: string;
  /** 来自建议面板：用户点击「应用此译文」，采纳数 +1 */
  suggestionPanelAdoption?: boolean;
  /** 来自建议面板：用户对某条点「差评」，差评计数 +1（并拉低采纳率） */
  suggestionPanelNegativeRating?: boolean;
};

// 处理学习反馈（完整版：集成四个阶段的所有功能）
export const processLearningFeedback = (
  profile: TwinTranslatorProfile,
  sourceText: string,
  selectedVariant?: TranslationVariant,
  customTranslation?: string,
  feedback: 'positive' | 'negative' | 'neutral' = 'neutral',
  originalTranslation?: string,
  options?: ProcessLearningFeedbackOptions
): TwinTranslatorProfile => {
  const updatedProfile = { ...profile };

  // 第四阶段：计算动态衰减因子
  const alpha = calculateDecayAlpha(profile.trainingDataSize);
  updatedProfile.temporalDecayAlpha = alpha;

  // 正面反馈学习
  if (feedback === 'positive' && (selectedVariant || customTranslation)) {
    const userTranslation = customTranslation || selectedVariant?.text || '';
    const aiTranslation = originalTranslation || selectedVariant?.text || '';

    if (userTranslation) {
      // 1. 更新训练数据（第一阶段修复 + 第二阶段语义差异）
      const newExample: TrainingExample = {
        id: generateId(),
        sourceText,
        originalTranslation: aiTranslation,
        userTranslation,
        differences: analyzeTranslationDifferences(sourceText, aiTranslation, userTranslation),
        learnedAt: new Date().toISOString(),
        languagePair: options?.effectiveLanguagePair ?? profile.languagePair,
        // 第二阶段：语义级差异
        semanticDifferences: analyzeSemanticDifferences(sourceText, aiTranslation, userTranslation),
        // 第四阶段：时间衰减权重
        decayWeight: alpha
      };

      updatedProfile.trainingExamples = [...profile.trainingExamples, newExample].slice(
        -MAX_STORED_TRAINING_EXAMPLES
      );

      // 2. 更新习惯译法
      updatedProfile.habitualTranslations = updateHabitualTranslations(
        sourceText,
        userTranslation,
        profile.habitualTranslations
      );

      // 3. 更新风格特征（第三阶段 + 第四阶段动态权重）
      updatedProfile.styleFeatures = extractStyleFeatures(
        sourceText,
        userTranslation,
        profile.styleFeatures,
        alpha
      );

      // 4. 第二阶段：更新术语映射表
      const domain = detectDomain(sourceText);
      updatedProfile.terminologyMappings = updateTerminologyMappings(
        sourceText,
        userTranslation,
        profile.terminologyMappings,
        domain
      );

      // 5. 第四阶段：更新领域权重
      if (!updatedProfile.domainWeights[domain]) {
        updatedProfile.domainWeights[domain] = 0;
      }
      updatedProfile.domainWeights[domain] += 1;

      // 6. 与库内例句条数严格一致（超出上限时已丢弃最旧）
      updatedProfile.learnedSegments = updatedProfile.trainingExamples.length;
      updatedProfile.trainingDataSize = updatedProfile.trainingExamples.length;

      if (options?.effectiveLanguagePair) {
        updatedProfile.languagePair = options.effectiveLanguagePair;
      }
    }

    if (
      options?.suggestionPanelAdoption &&
      selectedVariant?.text?.trim()
    ) {
      updatedProfile.twinSuggestionAdoptionCount =
        (updatedProfile.twinSuggestionAdoptionCount ?? profile.twinSuggestionAdoptionCount ?? 0) + 1;
    }
  }

  // 第四阶段：负面反馈学习
  if (feedback === 'negative' && selectedVariant) {
    const rejectedTranslation = selectedVariant.text;
    if (rejectedTranslation) {
      const reason = '用户拒绝了该译文';
      updatedProfile.negativeExamples = [
        ...profile.negativeExamples,
        {
          text: rejectedTranslation,
          reason,
          timestamp: new Date().toISOString()
        }
      ].slice(-100); // 限制100条

      if (options?.suggestionPanelNegativeRating) {
        updatedProfile.twinSuggestionNegativeRatingCount =
          (updatedProfile.twinSuggestionNegativeRatingCount ??
            profile.twinSuggestionNegativeRatingCount ??
            0) + 1;
      }
    }
  }

  updatedProfile.lastTrained = new Date().toISOString();
  updatedProfile.successRate = computeTwinSuggestionSuccessRate(updatedProfile);
  updatedProfile.averageConfidence = computeTwinAverageConfidence(updatedProfile);

  // 如果学习了一定数量的句段，标记为就绪状态
  if (updatedProfile.learnedSegments >= 10 && updatedProfile.trainingStatus === 'idle') {
    updatedProfile.trainingStatus = 'ready';
  }

  return updatedProfile;
};

// 计算译文质量评分
export const calculateTranslationQuality = (
  sourceText: string,
  targetText: string,
  profile: TwinTranslatorProfile
): number => {
  // 简单质量评分算法
  let score = 50; // 基础分
  
  // 1. 长度合理性
  const sourceLength = sourceText.length;
  const targetLength = targetText.length;
  const lengthRatio = targetLength / sourceLength;
  
  if (lengthRatio > 0.8 && lengthRatio < 1.5) {
    score += 10; // 长度适中加分
  }
  
  // 2. 术语一致性检查
  const englishTerms = sourceText.match(/[A-Za-z]+/g) || [];
  let preservedCount = 0;
  for (const term of englishTerms) {
    if (targetText.includes(term) && term.length > 2) {
      preservedCount++;
    }
  }
  
  if (englishTerms.length > 0) {
    const preservationRate = preservedCount / englishTerms.length;
    score += preservationRate * 20; // 术语保留加分
  }
  
  // 3. 与用户风格的一致性
  const styleScore = calculateStyleSimilarity(targetText, profile.styleFeatures);
  score += styleScore * 10;
  
  return Math.min(100, Math.max(0, score));
};

// 计算与用户风格的相似度
const calculateStyleSimilarity = (
  text: string,
  styleFeatures: StyleFeatures
): number => {
  const currentFeatures = extractStyleFeatures('', text);
  
  // 计算余弦相似度（简化版，仅标量风格维度）
  type StyleScalarKey = keyof Pick<
    StyleFeatures,
    | 'sentenceLengthAvg'
    | 'formalLevel'
    | 'terminologyConsistency'
    | 'syntacticComplexity'
    | 'wordChoiceNovelty'
    | 'translationFluency'
  >;
  const keys: StyleScalarKey[] = [
    'sentenceLengthAvg',
    'formalLevel',
    'terminologyConsistency',
    'syntacticComplexity',
    'wordChoiceNovelty',
    'translationFluency'
  ];
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (const key of keys) {
    const a = Number(currentFeatures[key] ?? 50);
    const b = Number(styleFeatures[key] ?? 50);

    dotProduct += a * b;
    normA += a * a;
    normB += b * b;
  }
  
  if (normA === 0 || normB === 0) return 0.5;
  
  const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  return similarity;
};

// 查找最相似的孪生译员
export const findMostSimilarTranslator = (
  translators: TwinTranslatorProfile[],
  languagePair: string,
  domainHint?: string
): TwinTranslatorProfile | null => {
  if (translators.length === 0) return null;

  const want = languagePair.toLowerCase();
  const matchingLanguage = translators.filter(
    t => t.languagePair.toLowerCase() === want
  );
  if (matchingLanguage.length === 0) return null;

  // 2. 根据学习数据量排序（学习越多越好）
  const sortedByExperience = matchingLanguage.sort((a, b) =>
    b.learnedSegments - a.learnedSegments || b.successRate - a.successRate
  );

  return sortedByExperience[0];
};

// ================== 第二阶段：核心特征函数 ==================

// 第二阶段：自动提取术语映射
export const extractTerminologyMapping = (
  sourceText: string,
  userTranslation: string
): { sourceTerm: string; targetTerm: string }[] => {
  const mappings: { sourceTerm: string; targetTerm: string }[] = [];

  // 简单实现：从原文提取英文术语，从译文提取对应位置的中文
  const sourceTerms = sourceText.match(/\b[A-Z][a-zA-Z0-9]*\b/g) || [];
  const chinesePattern = /[\u4e00-\u9fa5]+/g;
  const targetTerms = userTranslation.match(chinesePattern) || [];

  // 建立简单映射（基于位置）
  const minLen = Math.min(sourceTerms.length, targetTerms.length);
  for (let i = 0; i < minLen; i++) {
    mappings.push({
      sourceTerm: sourceTerms[i],
      targetTerm: targetTerms[i]
    });
  }

  return mappings;
};

// 第二阶段：更新术语映射表
export const updateTerminologyMappings = (
  sourceText: string,
  userTranslation: string,
  existingMappings: any[],
  domain?: string
): any[] => {
  const newMappings = extractTerminologyMapping(sourceText, userTranslation);
  const updated = [...existingMappings];

  newMappings.forEach(mapping => {
    const existingIndex = updated.findIndex(
      m => m.sourceTerm === mapping.sourceTerm
    );

    if (existingIndex >= 0) {
      // 更新现有映射
      updated[existingIndex] = {
        ...updated[existingIndex],
        frequency: updated[existingIndex].frequency + 1,
        confidence: Math.min(1, updated[existingIndex].confidence + 0.05),
        lastUsed: new Date().toISOString()
      };
    } else {
      // 添加新映射
      updated.push({
        id: generateId(),
        sourceTerm: mapping.sourceTerm,
        targetTerm: mapping.targetTerm,
        frequency: 1,
        domain,
        confidence: 0.7,
        lastUsed: new Date().toISOString()
      });
    }
  });

  // 按使用频率排序
  return updated.sort((a, b) => b.frequency - a.frequency);
};

// 第二阶段：上下文相关的相似例句检索
export const findSimilarExamples = (
  sourceText: string,
  examples: TrainingExample[],
  topK: number = 3
): TrainingExample[] => {
  if (examples.length === 0) return [];

  // 简单实现：基于关键词重叠率计算相似度
  const sourceWords = new Set(
    sourceText.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  );

  const scored = examples.map(ex => {
    const exWords = new Set(
      ex.sourceText.toLowerCase().split(/\s+/).filter(w => w.length > 2)
    );
    let overlap = 0;
    sourceWords.forEach(w => {
      if (exWords.has(w)) overlap++;
    });
    const similarity = sourceWords.size > 0 ? overlap / sourceWords.size : 0;
    return { example: ex, similarity };
  });

  return scored
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK)
    .map(s => s.example);
};

// 第二阶段：语义级差异分析
export const analyzeSemanticDifferences = (
  sourceText: string,
  aiTranslation: string,
  userTranslation: string
): any[] => {
  const differences: any[] = [];

  if (aiTranslation !== userTranslation) {
    // 1. 长度差异判断增译/省译
    const aiLength = aiTranslation.length;
    const userLength = userTranslation.length;

    if (Math.abs(userLength - aiLength) > aiLength * 0.15) {
      if (userLength > aiLength) {
        differences.push({
          type: 'addition',
          category: 'detail',
          sourcePhrase: '',
          targetPhrase: '用户添加了详细说明'
        });
      } else {
        differences.push({
          type: 'omission',
          category: 'detail',
          sourcePhrase: '原文某些细节',
          targetPhrase: '用户进行了省略'
        });
      }
    }

    // 2. 术语替换
    const commonTerms = ['API', 'UI', 'UX', 'button', 'menu', 'setting'];
    commonTerms.forEach(term => {
      if (aiTranslation.includes(term) && !userTranslation.includes(term)) {
        differences.push({
          type: 'substitution',
          category: 'terminology',
          sourcePhrase: term,
          targetPhrase: '用户替换了术语'
        });
      }
    });

    // 3. 句子重组（基于句子数量变化）
    const aiSentences = aiTranslation.split(/[。！？.!?]/).filter(s => s.trim());
    const userSentences = userTranslation.split(/[。！？.!?]/).filter(s => s.trim());

    if (Math.abs(aiSentences.length - userSentences.length) > 0) {
      differences.push({
        type: 'restructuring',
        category: 'structure',
        sourcePhrase: `AI: ${aiSentences.length}句`,
        targetPhrase: `用户: ${userSentences.length}句`
      });
    }
  }

  return differences;
};

// ================== 第三阶段：增强层特征函数 ==================

// 第三阶段：计算语序偏好
const calculateWordOrderPreference = (
  translation: string,
  existing?: any
): any => {
  const preference = existing || {
    conditionalPosition: 'before',
    passiveToActive: false,
    modifierPosition: 'before'
  };

  // 检测条件句位置
  if (translation.includes('如果') || translation.includes('当') || translation.includes('若')) {
    const firstClause = translation.substring(0, translation.length / 2);
    if (firstClause.includes('如果') || firstClause.includes('当') || firstClause.includes('若')) {
      preference.conditionalPosition = 'before';
    } else {
      preference.conditionalPosition = 'after';
    }
  }

  // 检测被动语态转主动
  const passiveIndicators = ['被', '受到', '遭到'];
  const hasPassive = passiveIndicators.some(ind => translation.includes(ind));
  preference.passiveToActive = !hasPassive;

  return preference;
};

// 第三阶段：计算翻译策略
const calculateTranslationStrategy = (
  translation: string,
  sourceText: string,
  existing?: any
): any => {
  const strategy = existing || {
    domestication: 50,
    explicitation: 50,
    literalness: 50
  };

  // 计算归化程度（基于译文/原文长度比）
  const lengthRatio = translation.length / Math.max(sourceText.length, 1);
  strategy.domestication = Math.min(100, lengthRatio * 50);

  // 计算增译倾向
  if (lengthRatio > 1.2) {
    strategy.explicitation = Math.min(100, strategy.explicitation + 10);
  }

  // 计算直译程度（基于结构保持）
  const sourceStructure = sourceText.split(/\s+/).length;
  const targetStructure = translation.split('').length;
  strategy.literalness = Math.min(100, (targetStructure / sourceStructure) * 50);

  return strategy;
};

// 第三阶段：计算标点风格
const calculatePunctuationStyle = (
  translation: string,
  existing?: any
): any => {
  const style = existing || {
    fullWidthRatio: 0.9,
    commaStyle: 'clause',
    bracketUsage: 0.3
  };

  // 计算全角标点比例
  const fullWidthPunct = translation.match(/[。，！？、；：]/g) || [];
  const halfWidthPunct = translation.match(/[.,!?;:]/g) || [];
  const totalPunct = fullWidthPunct.length + halfWidthPunct.length;
  if (totalPunct > 0) {
    style.fullWidthRatio = fullWidthPunct.length / totalPunct;
  }

  // 检测逗号用途
  const commas = translation.split('，').length - 1;
  const periods = translation.split(/[。！？]/).length - 1;
  if (periods > 0 && commas / periods > 1.5) {
    style.commaStyle = 'enumeration';
  } else {
    style.commaStyle = 'clause';
  }

  // 计算括号使用频率
  const brackets = translation.match(/[（）\[\]【】]/g) || [];
  style.bracketUsage = Math.min(1, brackets.length / 10);

  return style;
};

// ================== 第四阶段：架构层函数 ==================

// 第四阶段：领域自适应检测
export const detectDomain = (text: string): string => {
  const domainKeywords: Record<string, string[]> = {
    technical: ['API', 'function', 'parameter', 'config', 'debug', 'deploy', 'SDK'],
    legal: ['shall', 'hereby', 'whereas', 'pursuant', 'provision', 'obligation'],
    medical: ['patient', 'dosage', 'symptom', 'diagnosis', 'treatment', 'clinical'],
    literary: ['whispered', 'gaze', 'melancholy', 'serene', 'ethereal', 'poignant'],
    business: ['revenue', 'profit', 'investment', 'stakeholder', 'quarterly', 'fiscal'],
    education: ['curriculum', 'syllabus', 'assignment', 'assessment', 'pedagogy', 'learning']
  };

  let bestDomain = 'general';
  let maxScore = 0;

  for (const [domain, keywords] of Object.entries(domainKeywords)) {
    let score = 0;
    keywords.forEach(keyword => {
      if (text.toLowerCase().includes(keyword.toLowerCase())) {
        score++;
      }
    });
    if (score > maxScore) {
      maxScore = score;
      bestDomain = domain;
    }
  }

  return bestDomain;
};

// 第四阶段：负面反馈学习
export const processNegativeFeedback = (
  profile: TwinTranslatorProfile,
  rejectedTranslation: string,
  reason?: string
): TwinTranslatorProfile => {
  const updatedProfile = { ...profile };

  // 记录负面示例
  updatedProfile.negativeExamples = [
    ...updatedProfile.negativeExamples,
    {
      text: rejectedTranslation,
      reason: reason || '用户拒绝',
      timestamp: new Date().toISOString()
    }
  ];

  // 限制负面示例数量
  updatedProfile.negativeExamples = updatedProfile.negativeExamples.slice(-100);

  return updatedProfile;
};

// 第四阶段：动态衰减因子计算
export const calculateDecayAlpha = (trainingDataSize: number): number => {
  // 数据量越大，衰减因子越小（对新数据依赖越低）
  if (trainingDataSize < 10) return 0.3;
  if (trainingDataSize < 50) return 0.25;
  if (trainingDataSize < 100) return 0.2;
  if (trainingDataSize < 200) return 0.15;
  return 0.1;
};
