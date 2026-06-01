/**
 * 孪生译员功能测试脚本 - 浏览器控制台版本
 * 
 * 使用方法：
 * 1. 打开应用的开发者工具（F12）
 * 2. 切换到 Console 标签
 * 3. 复制粘贴此脚本
 * 4. 运行 runTwinTranslatorTest()
 */

console.log('📚 孪生译员测试脚本已加载...\n');
console.log('运行 runTwinTranslatorTest() 开始测试\n');

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

/**
 * 主测试函数
 */
async function runTwinTranslatorTest() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║     孪生译员功能测试 - 四个阶段完整测试              ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');
  
  try {
    // 动态导入孪生译员服务
    const {
      createTwinTranslatorProfile,
      processLearningFeedback,
      generateTranslationVariants,
      findSimilarExamples
    } = await import('../services/twinTranslatorService');
    
    // 创建测试用孪生译员
    console.log('📝 创建孪生译员...\n');
    const profile = createTwinTranslatorProfile(
      '测试译员',
      '用于测试四个阶段功能的孪生译员',
      'en-zh',
      'gemini-3-flash-preview'
    );
    
    console.log('✅ 创建成功！');
    console.log(`   ID: ${profile.id}`);
    console.log(`   名称: ${profile.name}`);
    console.log(`   语言对: ${profile.languagePair}`);
    console.log(`   初始状态: ${profile.trainingStatus}\n`);
    
    // ========== 第一阶段：基础增强 ==========
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('第一阶段测试：基础增强功能');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    let currentProfile = profile;
    
    TEST_CASES.slice(0, 3).forEach((testCase, index) => {
      console.log(`📌 测试 ${index + 1}: ${testCase.description}`);
      console.log(`   原文: ${testCase.source}`);
      console.log(`   AI译文: ${testCase.aiTranslation}`);
      console.log(`   用户译文: ${testCase.userTranslation}`);
      
      currentProfile = processLearningFeedback(
        currentProfile,
        testCase.source,
        undefined,
        testCase.userTranslation,
        'positive',
        testCase.aiTranslation
      );
      
      const lastExample = currentProfile.trainingExamples[currentProfile.trainingExamples.length - 1];
      
      console.log(`\n   ✅ 学习完成！`);
      console.log(`   📊 原始译文已记录: ${lastExample.originalTranslation}`);
      console.log(`   📊 差异分析: ${lastExample.differences.join(', ')}`);
      console.log(`   📊 习惯译法数量: ${currentProfile.habitualTranslations.length}`);
      console.log(`   📊 已学习句段: ${currentProfile.learnedSegments}\n`);
    });
    
    // ========== 第二阶段：核心特征 ==========
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('第二阶段测试：核心特征');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    TEST_CASES.slice(3, 5).forEach((testCase, index) => {
      console.log(`📌 测试 ${index + 1}: ${testCase.description}`);
      
      currentProfile = processLearningFeedback(
        currentProfile,
        testCase.source,
        undefined,
        testCase.userTranslation,
        'positive',
        testCase.aiTranslation
      );
      
      const lastExample = currentProfile.trainingExamples[currentProfile.trainingExamples.length - 1];
      
      console.log(`\n   ✅ 学习完成！`);
      console.log(`   📊 术语映射数量: ${currentProfile.terminologyMappings.length}`);
      
      if (currentProfile.terminologyMappings.length > 0) {
        currentProfile.terminologyMappings.slice(0, 3).forEach((mapping, i) => {
          console.log(`      ${i + 1}. ${mapping.sourceTerm} → ${mapping.targetTerm} (使用${mapping.frequency}次)`);
        });
      }
      
      if (lastExample.semanticDifferences) {
        console.log(`   📊 语义差异数量: ${lastExample.semanticDifferences.length}`);
        lastExample.semanticDifferences.forEach((diff, i) => {
          console.log(`      ${i + 1}. ${diff.type} (${diff.category})`);
        });
      }
      console.log('');
    });
    
    // ========== 第三阶段：风格增强 ==========
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('第三阶段测试：风格增强');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    TEST_CASES.slice(5, 7).forEach((testCase, index) => {
      console.log(`📌 测试 ${index + 1}: ${testCase.description}`);
      
      currentProfile = processLearningFeedback(
        currentProfile,
        testCase.source,
        undefined,
        testCase.userTranslation,
        'positive',
        testCase.aiTranslation
      );
      
      const wordOrder = currentProfile.styleFeatures.wordOrderPreference;
      const strategy = currentProfile.styleFeatures.translationStrategy;
      const punct = currentProfile.styleFeatures.punctuationStyle;
      
      console.log(`\n   ✅ 学习完成！`);
      console.log(`   📊 语序偏好:`);
      console.log(`      - 条件句位置: ${wordOrder.conditionalPosition === 'before' ? '前置' : '后置'}`);
      console.log(`      - 被转主动: ${wordOrder.passiveToActive ? '是' : '否'}`);
      console.log(`   📊 翻译策略:`);
      console.log(`      - 归化度: ${strategy.domestication.toFixed(1)}`);
      console.log(`      - 增译倾向: ${strategy.explicitation.toFixed(1)}`);
      console.log(`      - 直译度: ${strategy.literalness.toFixed(1)}`);
      console.log(`   📊 标点风格:`);
      console.log(`      - 全角标点比例: ${(punct.fullWidthRatio * 100).toFixed(1)}%`);
      console.log(`      - 逗号用途: ${punct.commaStyle === 'enumeration' ? '列举' : '分句'}`);
      console.log(`      - 括号使用: ${(punct.bracketUsage * 100).toFixed(1)}%\n`);
    });
    
    // ========== 第四阶段：架构优化 ==========
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('第四阶段测试：架构优化');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    const lastTestCase = TEST_CASES[7];
    console.log(`📌 测试: ${lastTestCase.description}\n`);
    
    console.log('📊 动态权重衰减测试:');
    console.log(`   - 当前训练数据量: ${currentProfile.trainingDataSize}`);
    console.log(`   - 当前衰减因子: ${currentProfile.temporalDecayAlpha}`);
    
    currentProfile = processLearningFeedback(
      currentProfile,
      lastTestCase.source,
      undefined,
      lastTestCase.userTranslation,
      'positive',
      lastTestCase.aiTranslation
    );
    
    console.log(`   - 学习后衰减因子: ${currentProfile.temporalDecayAlpha}\n`);
    
    console.log('📊 领域自适应测试:');
    console.log(`   - 领域权重: ${JSON.stringify(currentProfile.domainWeights)}`);
    
    const domains = Object.keys(currentProfile.domainWeights);
    if (domains.length > 0) {
      const topDomain = domains.sort((a, b) => 
        currentProfile.domainWeights[b] - currentProfile.domainWeights[a]
      )[0];
      console.log(`   - 主要领域: ${topDomain} (${currentProfile.domainWeights[topDomain]}句)\n`);
    } else {
      console.log(`   - 未检测到特定领域\n`);
    }
    
    console.log('📊 负面反馈学习测试:');
    const profileWithNegative = processLearningFeedback(
      currentProfile,
      'Test negative feedback',
      { id: 'test', text: '不好的翻译' },
      undefined,
      'negative',
      '好的翻译'
    );
    
    console.log(`   - 负面示例数量: ${profileWithNegative.negativeExamples.length}`);
    if (profileWithNegative.negativeExamples.length > 0) {
      profileWithNegative.negativeExamples.slice(-1).forEach((ex, i) => {
        console.log(`      ${i + 1}. "${ex.text}" - ${ex.reason}`);
      });
    }
    
    currentProfile = profileWithNegative;
    console.log('');
    
    // ========== 测试相似例句检索 ==========
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('测试：相似例句检索');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    const testSource = 'Click the settings button to configure your preferences.';
    console.log(`📌 测试原文: ${testSource}\n`);
    
    const similarExamples = findSimilarExamples(
      testSource,
      currentProfile.trainingExamples,
      3
    );
    
    console.log(`✅ 找到 ${similarExamples.length} 个相似例句:\n`);
    
    similarExamples.forEach((ex, index) => {
      console.log(`   ${index + 1}. 原文: ${ex.sourceText}`);
      console.log(`      译文: ${ex.userTranslation}`);
      console.log(`      学习时间: ${ex.learnedAt.split('T')[0]}\n`);
    });
    
    // ========== 最终统计 ==========
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('最终统计');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    console.log(`📊 训练数据量: ${currentProfile.trainingDataSize}`);
    console.log(`📊 已学习句段: ${currentProfile.learnedSegments}`);
    console.log(`📊 习惯译法: ${currentProfile.habitualTranslations.length}条`);
    console.log(`📊 术语映射: ${currentProfile.terminologyMappings.length}条`);
    console.log(`📊 负面示例: ${currentProfile.negativeExamples.length}条`);
    console.log(`📊 领域权重: ${JSON.stringify(currentProfile.domainWeights)}`);
    console.log(`📊 当前衰减因子: ${currentProfile.temporalDecayAlpha}`);
    console.log(`📊 训练状态: ${currentProfile.trainingStatus}`);
    console.log(`📊 成功率: ${currentProfile.successRate.toFixed(1)}%\n`);
    
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║                  测试完成 ✓                           ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');
    
    console.log('💡 提示: 你可以访问 currentProfile 查看完整的孪生译员数据\n');
    
    // 将profile暴露到全局，方便后续调试
    (window as any).testTwinTranslatorProfile = currentProfile;
    
    return currentProfile;
    
  } catch (error) {
    console.error('❌ 测试失败:', error);
    console.log('\n💡 可能的原因:');
    console.log('   1. 服务文件路径不正确');
    console.log('   2. 模块未正确导出');
    console.log('   3. TypeScript 类型错误\n');
  }
}

/**
 * 简化版快速测试
 */
async function quickTest() {
  console.log('🚀 快速测试模式\n');
  
  try {
    const { createTwinTranslatorProfile, processLearningFeedback } = 
      await import('../services/twinTranslatorService');
    
    const profile = createTwinTranslatorProfile('快速测试', '', 'en-zh');
    
    console.log('✓ 创建译员成功');
    
    const testCase = TEST_CASES[0];
    
    console.log(`\n测试: ${testCase.description}`);
    console.log(`原文: ${testCase.source}`);
    console.log(`用户译文: ${testCase.userTranslation}`);
    
    const updated = processLearningFeedback(
      profile,
      testCase.source,
      undefined,
      testCase.userTranslation,
      'positive',
      testCase.aiTranslation
    );
    
    console.log(`\n✅ 学习完成！`);
    console.log(`   已学习句段: ${updated.learnedSegments}`);
    console.log(`   习惯译法: ${updated.habitualTranslations.length}条`);
    console.log(`   术语映射: ${updated.terminologyMappings.length}条`);
    console.log(`   训练状态: ${updated.trainingStatus}\n`);
    
    (window as any).quickTestProfile = updated;
    
  } catch (error) {
    console.error('❌ 快速测试失败:', error);
  }
}

/**
 * 查看孪生译员详细数据
 */
function showProfileDetails(profile: any) {
  console.log('\n📋 孪生译员详细信息:\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  console.log('基本信息:');
  console.log(`  名称: ${profile.name}`);
  console.log(`  ID: ${profile.id}`);
  console.log(`  语言对: ${profile.languagePair}`);
  console.log(`  基础模型: ${profile.baseModel}`);
  console.log(`  训练状态: ${profile.trainingStatus}\n`);
  
  console.log('统计信息:');
  console.log(`  已学习句段: ${profile.learnedSegments}`);
  console.log(`  训练数据量: ${profile.trainingDataSize}`);
  console.log(`  成功率: ${profile.successRate.toFixed(1)}%`);
  console.log(`  平均置信度: ${profile.averageConfidence.toFixed(2)}\n`);
  
  console.log('风格特征:');
  console.log(`  句子平均长度: ${profile.styleFeatures.sentenceLengthAvg.toFixed(1)}字符`);
  console.log(`  正式程度: ${profile.styleFeatures.formalLevel}/100`);
  console.log(`  术语一致性: ${profile.styleFeatures.terminologyConsistency.toFixed(1)}/100`);
  console.log(`  句法复杂度: ${profile.styleFeatures.syntacticComplexity.toFixed(1)}/100`);
  console.log(`  词汇新颖度: ${profile.styleFeatures.wordChoiceNovelty.toFixed(1)}/100`);
  console.log(`  译文流畅度: ${profile.styleFeatures.translationFluency.toFixed(1)}/100\n`);
  
  if (profile.styleFeatures.wordOrderPreference) {
    console.log('语序偏好:');
    console.log(`  条件句位置: ${profile.styleFeatures.wordOrderPreference.conditionalPosition}`);
    console.log(`  被转主动: ${profile.styleFeatures.wordOrderPreference.passiveToActive}`);
    console.log(`  修饰语位置: ${profile.styleFeatures.wordOrderPreference.modifierPosition}\n`);
  }
  
  if (profile.styleFeatures.translationStrategy) {
    console.log('翻译策略:');
    console.log(`  归化度: ${profile.styleFeatures.translationStrategy.domestication.toFixed(1)}`);
    console.log(`  增译倾向: ${profile.styleFeatures.translationStrategy.explicitation.toFixed(1)}`);
    console.log(`  直译度: ${profile.styleFeatures.translationStrategy.literalness.toFixed(1)}\n`);
  }
  
  if (profile.terminologyMappings && profile.terminologyMappings.length > 0) {
    console.log(`术语映射 (${profile.terminologyMappings.length}条):`);
    profile.terminologyMappings.slice(0, 5).forEach((m: any, i: number) => {
      console.log(`  ${i + 1}. ${m.sourceTerm} → ${m.targetTerm} (${m.frequency}次)`);
    });
    console.log('');
  }
  
  if (profile.habitualTranslations && profile.habitualTranslations.length > 0) {
    console.log(`习惯译法 (${profile.habitualTranslations.length}条):`);
    profile.habitualTranslations.slice(0, 5).forEach((h: any, i: number) => {
      console.log(`  ${i + 1}. "${h.sourcePattern}" → "${h.targetPattern}"`);
    });
    console.log('');
  }
  
  console.log('训练示例:');
  profile.trainingExamples.slice(-3).forEach((ex: any, i: number) => {
    console.log(`  ${i + 1}. ${ex.sourceText}`);
    console.log(`     → ${ex.userTranslation}`);
    console.log(`     学习时间: ${ex.learnedAt.split('T')[0]}`);
  });
  console.log('');
}

// 导出函数到全局作用域
(window as any).runTwinTranslatorTest = runTwinTranslatorTest;
(window as any).quickTest = quickTest;
(window as any).showProfileDetails = showProfileDetails;
(window as any).TEST_CASES = TEST_CASES;

console.log('✅ 测试脚本加载完成！');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
console.log('可用命令:');
console.log('  • runTwinTranslatorTest()  - 运行完整测试');
console.log('  • quickTest()             - 快速测试');
console.log('  • showProfileDetails(p)   - 查看译员详细信息');
console.log('  • TEST_CASES              - 测试用例数据\n');
