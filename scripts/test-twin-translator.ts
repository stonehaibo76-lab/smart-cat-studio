import { createTwinTranslatorProfile } from '../services/twinTranslatorService';
import { processLearningFeedback } from '../services/twinTranslatorService';
import { generateTranslationVariants } from '../services/twinTranslatorService';

/**
 * 孪生译员功能测试脚本
 * 
 * 测试四个阶段的所有功能：
 * 第一阶段：修复 originalTranslation 空值、扩充术语词库、扩大习惯译法注入
 * 第二阶段：术语映射表、相似例句检索、语义差异分析
 * 第三阶段：语序偏好、翻译策略、标点风格特征
 * 第四阶段：动态权重衰减、负面反馈学习、领域自适应
 */

// ================== 测试数据 ==================

const TEST_CASES = [
  {
    description: '技术文档 - API使用说明',
    source: 'Click the API button to configure the settings.',
    aiTranslation: '点击API按钮来配置设置。',
    userTranslation: '点击 API 按钮以配置设置。'
  },
  {
    description: 'UI操作 - 菜单导航',
    source: 'Select the item from the dropdown menu and click OK.',
    aiTranslation: '从下拉菜单中选择项目并点击确定。',
    userTranslation: '从下拉菜单中选择项目，然后点击"确定"。'
  },
  {
    description: '状态描述 - 功能启用',
    source: 'The feature is enabled by default in the configuration panel.',
    aiTranslation: '该功能默认在配置面板中启用。',
    userTranslation: '配置面板中，该功能默认已启用。'
  },
  {
    description: '错误信息 - 提示用户',
    source: 'Please ensure that all parameters are valid before submitting.',
    aiTranslation: '请在提交前确保所有参数有效。',
    userTranslation: '提交前请确保所有参数均有效。'
  },
  {
    description: '技术术语 - SDK引用',
    source: 'Import the SDK and initialize the component with the API key.',
    aiTranslation: '导入SDK并使用API密钥初始化组件。',
    userTranslation: '导入 SDK，然后使用 API Key 初始化组件。'
  },
  {
    description: '条件句 - 条件前置',
    source: 'If the connection fails, retry after 5 seconds.',
    aiTranslation: '如果连接失败，5秒后重试。',
    userTranslation: '连接失败时，5秒后重试。'
  },
  {
    description: '被动语态 - 转主动',
    source: 'The data is stored in the database securely.',
    aiTranslation: '数据安全地存储在数据库中。',
    userTranslation: '系统将数据安全地存储在数据库中。'
  },
  {
    description: '复杂结构 - 长句拆分',
    source: 'Navigate to the Settings menu, select Preferences, and enable the option to activate the feature.',
    aiTranslation: '导航到设置菜单，选择首选项，并启用选项以激活功能。',
    userTranslation: '进入"设置"菜单 → 选择"偏好" → 启用该选项，即可激活功能。'
  }
];

// ================== 测试函数 ==================

/**
 * 测试第一阶段：基础增强功能
 */
export function testPhase1(profile: any) {
  console.log('\n========== 第一阶段测试：基础增强 ==========\n');
  
  const testCases = TEST_CASES.slice(0, 3);
  
  testCases.forEach((testCase, index) => {
    console.log(`测试 ${index + 1}: ${testCase.description}`);
    console.log(`原文: ${testCase.source}`);
    console.log(`AI译文: ${testCase.aiTranslation}`);
    console.log(`用户译文: ${testCase.userTranslation}`);
    
    const updatedProfile = processLearningFeedback(
      profile,
      testCase.source,
      undefined,
      testCase.userTranslation,
      'positive',
      testCase.aiTranslation // 第一阶段修复：传入AI原始译文
    );
    
    console.log('\n✓ 学习完成！');
    console.log(`  - 原始译文已记录: ${updatedProfile.trainingExamples[index].originalTranslation}`);
    console.log(`  - 差异分析: ${updatedProfile.trainingExamples[index].differences.join(', ')}`);
    console.log(`  - 习惯译法数量: ${updatedProfile.habitualTranslations.length}`);
    console.log(`  - 已学习句段: ${updatedProfile.learnedSegments}\n`);
    
    // 更新profile用于下一次测试
    Object.assign(profile, updatedProfile);
  });
  
  return profile;
}

/**
 * 测试第二阶段：核心特征
 */
export function testPhase2(profile: any) {
  console.log('\n========== 第二阶段测试：核心特征 ==========\n');
  
  const testCases = TEST_CASES.slice(3, 5);
  
  testCases.forEach((testCase, index) => {
    console.log(`测试 ${index + 1}: ${testCase.description}`);
    
    const updatedProfile = processLearningFeedback(
      profile,
      testCase.source,
      undefined,
      testCase.userTranslation,
      'positive',
      testCase.aiTranslation
    );
    
    console.log('\n✓ 学习完成！');
    
    // 第二阶段：术语映射表
    const lastExample = updatedProfile.trainingExamples[updatedProfile.trainingExamples.length - 1];
    console.log(`  - 术语映射数量: ${updatedProfile.terminologyMappings.length}`);
    if (updatedProfile.terminologyMappings.length > 0) {
      updatedProfile.terminologyMappings.slice(0, 3).forEach((mapping: any) => {
        console.log(`    * ${mapping.sourceTerm} → ${mapping.targetTerm} (使用${mapping.frequency}次)`);
      });
    }
    
    // 第二阶段：语义差异分析
    if (lastExample.semanticDifferences) {
      console.log(`  - 语义差异数量: ${lastExample.semanticDifferences.length}`);
      lastExample.semanticDifferences.forEach((diff: any) => {
        console.log(`    * ${diff.type} (${diff.category})`);
      });
    }
    
    console.log('\n');
  });
  
  return profile;
}

/**
 * 测试第三阶段：风格增强
 */
export function testPhase3(profile: any) {
  console.log('\n========== 第三阶段测试：风格增强 ==========\n');
  
  const testCases = TEST_CASES.slice(5, 7);
  
  testCases.forEach((testCase, index) => {
    console.log(`测试 ${index + 1}: ${testCase.description}`);
    
    const updatedProfile = processLearningFeedback(
      profile,
      testCase.source,
      undefined,
      testCase.userTranslation,
      'positive',
      testCase.aiTranslation
    );
    
    console.log('\n✓ 学习完成！');
    
    // 第三阶段：语序偏好
    const wordOrder = updatedProfile.styleFeatures.wordOrderPreference;
    console.log(`  - 语序偏好:`);
    console.log(`    * 条件句位置: ${wordOrder.conditionalPosition === 'before' ? '前置' : '后置'}`);
    console.log(`    * 被转主动: ${wordOrder.passiveToActive ? '是' : '否'}`);
    
    // 第三阶段：翻译策略
    const strategy = updatedProfile.styleFeatures.translationStrategy;
    console.log(`  - 翻译策略:`);
    console.log(`    * 归化度: ${strategy.domestication.toFixed(1)}`);
    console.log(`    * 增译倾向: ${strategy.explicitation.toFixed(1)}`);
    console.log(`    * 直译度: ${strategy.literalness.toFixed(1)}`);
    
    // 第三阶段：标点风格
    const punct = updatedProfile.styleFeatures.punctuationStyle;
    console.log(`  - 标点风格:`);
    console.log(`    * 全角标点比例: ${(punct.fullWidthRatio * 100).toFixed(1)}%`);
    console.log(`    * 逗号用途: ${punct.commaStyle === 'enumeration' ? '列举' : '分句'}`);
    console.log(`    * 括号使用: ${(punct.bracketUsage * 100).toFixed(1)}%\n`);
  });
  
  return profile;
}

/**
 * 测试第四阶段：架构优化
 */
export function testPhase4(profile: any) {
  console.log('\n========== 第四阶段测试：架构优化 ==========\n');
  
  const testCase = TEST_CASES[7];
  console.log(`测试: ${testCase.description}\n`);
  
  // 第四阶段：动态权重衰减
  console.log('动态权重衰减测试:');
  console.log(`  - 当前训练数据量: ${profile.trainingDataSize}`);
  console.log(`  - 当前衰减因子: ${profile.temporalDecayAlpha}`);
  
  const updatedProfile = processLearningFeedback(
    profile,
    testCase.source,
    undefined,
    testCase.userTranslation,
    'positive',
    testCase.aiTranslation
  );
  
  console.log(`  - 学习后衰减因子: ${updatedProfile.temporalDecayAlpha}\n`);
  
  // 第四阶段：领域自适应
  console.log('领域自适应测试:');
  console.log(`  - 领域权重: ${JSON.stringify(updatedProfile.domainWeights)}`);
  
  const domains = Object.keys(updatedProfile.domainWeights);
  if (domains.length > 0) {
    const topDomain = domains.sort((a, b) => 
      updatedProfile.domainWeights[b] - updatedProfile.domainWeights[a]
    )[0];
    console.log(`  - 主要领域: ${topDomain} (${updatedProfile.domainWeights[topDomain]}句)\n`);
  }
  
  // 第四阶段：负面反馈学习
  console.log('负面反馈学习测试:');
  const profileWithNegative = processLearningFeedback(
    updatedProfile,
    'Test negative feedback',
    { id: 'test', text: '不好的翻译' },
    undefined,
    'negative',
    '好的翻译'
  );
  
  console.log(`  - 负面示例数量: ${profileWithNegative.negativeExamples.length}`);
  if (profileWithNegative.negativeExamples.length > 0) {
    profileWithNegative.negativeExamples.slice(-1).forEach((ex: any) => {
      console.log(`    * "${ex.text}" - ${ex.reason}`);
    });
  }
  
  console.log('\n');
  
  return profileWithNegative;
}

/**
 * 测试生成译文变体
 */
export async function testVariantGeneration(profile: any) {
  console.log('\n========== 测试生成译文变体 ==========\n');
  
  const testSource = 'Click the button to save your changes and continue.';
  console.log(`测试原文: ${testSource}\n`);
  
  try {
    const variants = await generateTranslationVariants(
      testSource,
      profile,
      {
        numberOfVariants: 3,
        includeBaseTranslation: true,
        temperature: 0.7,
        maxLength: 500
      },
      undefined // 不传AI设置，使用默认
    );
    
    console.log(`生成了 ${variants.length} 个译文变体:\n`);
    
    variants.forEach((variant, index) => {
      console.log(`${index + 1}. ${variant.styleLabel}`);
      console.log(`   译文: ${variant.text || '(未生成)'}`);
      console.log(`   置信度: ${(variant.confidence * 100).toFixed(0)}%`);
      console.log(`   理由: ${variant.reasoning}\n`);
    });
    
  } catch (error) {
    console.log('⚠️ 生成译文变体失败 (可能需要配置AI服务):');
    console.log(`   ${error}\n`);
  }
}

/**
 * 测试相似例句检索
 */
export function testSimilarExamplesRetrieval(profile: any) {
  console.log('\n========== 测试相似例句检索 ==========\n');
  
  // 这里需要动态导入findSimilarExamples
  import('../services/twinTranslatorService').then(({ findSimilarExamples }) => {
    const testSource = 'Click the settings button to configure your preferences.';
    console.log(`测试原文: ${testSource}\n`);
    
    const similarExamples = findSimilarExamples(
      testSource,
      profile.trainingExamples,
      3
    );
    
    console.log(`找到 ${similarExamples.length} 个相似例句:\n`);
    
    similarExamples.forEach((ex, index) => {
      console.log(`${index + 1}. 原文: ${ex.sourceText}`);
      console.log(`   译文: ${ex.userTranslation}`);
      console.log(`   学习时间: ${ex.learnedAt.split('T')[0]}\n`);
    });
  });
}

/**
 * 完整测试流程
 */
export async function runFullTest() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║     孪生译员功能测试 - 四个阶段完整测试              ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');
  
  // 创建测试用孪生译员
  const profile = createTwinTranslatorProfile(
    '测试译员',
    '用于测试四个阶段功能的孪生译员',
    'en-zh',
    'gemini-3-flash-preview'
  );
  
  console.log('✓ 创建孪生译员成功');
  console.log(`  - ID: ${profile.id}`);
  console.log(`  - 名称: ${profile.name}`);
  console.log(`  - 语言对: ${profile.languagePair}\n`);
  
  // 运行四个阶段测试
  let testProfile = testPhase1(profile);
  testProfile = testPhase2(testProfile);
  testProfile = testPhase3(testProfile);
  testProfile = testPhase4(testProfile);
  
  // 测试生成译文
  await testVariantGeneration(testProfile);
  
  // 测试相似例句检索
  testSimilarExamplesRetrieval(testProfile);
  
  // 最终统计
  console.log('\n========== 最终统计 ==========\n');
  console.log(`训练数据量: ${testProfile.trainingDataSize}`);
  console.log(`已学习句段: ${testProfile.learnedSegments}`);
  console.log(`习惯译法: ${testProfile.habitualTranslations.length}条`);
  console.log(`术语映射: ${testProfile.terminologyMappings.length}条`);
  console.log(`负面示例: ${testProfile.negativeExamples.length}条`);
  console.log(`领域权重: ${JSON.stringify(testProfile.domainWeights)}`);
  console.log(`当前衰减因子: ${testProfile.temporalDecayAlpha}`);
  console.log(`训练状态: ${testProfile.trainingStatus}`);
  console.log(`成功率: ${testProfile.successRate.toFixed(1)}%\n`);
  
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║                  测试完成 ✓                           ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');
  
  return testProfile;
}

// 导出测试数据供其他文件使用
export { TEST_CASES };
