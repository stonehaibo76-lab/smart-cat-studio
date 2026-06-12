import React, { useState } from 'react';
import { Icons } from '../components/ui/Icons';
import { APP_DISPLAY_VERSION } from '../constants';
import { isCloudDeployment } from '../services/deploymentMode';

export const Help: React.FC = () => {
  const [activeSection, setActiveSection] = useState<string>('overview');

  const sections = [
    { id: 'overview', icon: Icons.Info, label: '应用简介' },
    { id: 'whatsnew', icon: Icons.Lightbulb, label: '更新说明' },
    { id: 'quickstart', icon: Icons.Sparkles, label: '快速入门' },
    { id: 'dashboard', icon: Icons.Dashboard, label: '项目管理' },
    { id: 'editor', icon: Icons.File, label: '翻译编辑' },
    { id: 'twintranslators', icon: Icons.Brain, label: '孪生译员' },
    { id: 'resources', icon: Icons.Database, label: '语言资源' },
    { id: 'knowledge', icon: Icons.Sparkles, label: '知识库' },
    { id: 'settings', icon: Icons.Settings, label: '系统设置' },
    { id: 'faq', icon: Icons.HelpCircle, label: '常见问题' },
  ];

  return (
    <div className="flex h-full min-h-0 bg-slate-50 overflow-hidden">
      {/* Sidebar Navigation */}
      <aside className="w-72 min-h-0 bg-white border-r border-slate-200 flex flex-col shadow-sm">
        <div className="p-6 border-b border-slate-100">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
              <Icons.HelpCircle className="w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold text-slate-900">使用帮助</h1>
          </div>
          <p className="text-sm text-slate-500">Smart-CAT Studio {APP_DISPLAY_VERSION} 使用指南</p>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {sections.map((section) => {
            const isActive = activeSection === section.id;
            return (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <section.icon className={`w-5 h-5 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
                <span>{section.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-100">
          <div className="bg-gradient-to-r from-blue-500 to-indigo-500 rounded-xl p-4 text-white">
            <div className="flex items-center gap-2 mb-2">
              <Icons.Sparkles className="w-4 h-4" />
              <span className="text-sm font-semibold">需要更多帮助？</span>
            </div>
            <p className="text-xs text-blue-100 mb-3">查看我们的在线文档获取详细信息</p>
            <button className="w-full py-2 bg-white/20 hover:bg-white/30 rounded-lg text-xs font-medium transition-colors">
              访问在线文档
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-8 pb-16">
          {activeSection === 'overview' && <OverviewSection />}
          {activeSection === 'whatsnew' && <WhatsNewSection />}
          {activeSection === 'quickstart' && <QuickStartSection />}
          {activeSection === 'dashboard' && <DashboardSection />}
          {activeSection === 'editor' && <EditorSection />}
          {activeSection === 'twintranslators' && <TwinTranslatorsSection />}
          {activeSection === 'resources' && <ResourcesSection />}
          {activeSection === 'knowledge' && <KnowledgeSection />}
          {activeSection === 'settings' && <SettingsSection />}
          {activeSection === 'faq' && <FAQSection />}
        </div>
      </main>
    </div>
  );
};

const OverviewSection = () => {
  const cloud = isCloudDeployment();
  return (
  <div className="space-y-8">
    <div>
      <h2 className="text-3xl font-bold text-slate-900 mb-4">欢迎使用 Smart-CAT Studio</h2>
      <p className="text-lg text-slate-600 leading-relaxed">
        Smart-CAT Studio 是一款专业的计算机辅助翻译（CAT）工具，旨在帮助翻译人员提高工作效率，
        确保翻译质量和一致性。本工具集成了翻译记忆库、术语库、可检索的翻译知识库（RAG）、AI 辅助翻译等功能，
        让您的翻译工作更加轻松高效。
        {cloud ? ' 当前为云端版：项目与资源保存在 PostgreSQL，登录同一账号可在任意设备继续工作。' : ''}
      </p>
    </div>

<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <FeatureCard
            icon={Icons.Database}
            title="翻译记忆库"
            description="自动保存翻译历史，智能匹配相似句段，避免重复翻译，提高效率。"
          />
          <FeatureCard
            icon={Icons.TermBase}
            title="术语库管理"
            description="集中管理专业术语，确保术语翻译的一致性和准确性。"
          />
          <FeatureCard
            icon={Icons.Sparkles}
            title="AI 智能翻译"
            description="集成 Google Gemini、DeepSeek、本地 llama.cpp 等 AI 模型，提供智能翻译建议和优化。"
          />
          <FeatureCard
            icon={Icons.File}
            title="多格式支持"
            description="项目可导入 TXT、DOCX、PPTX、Excel、SDLXLIFF、MQXLIFF、MQXLZ、SDLPPX/SDLRPX；导出 Excel、TMX、原文格式（纯译文 / 段段对照 / 并列对照 DOCX / PPTX），以及可回写 Trados/memoQ 的双语 XLIFF 或回传包。"
          />
          <FeatureCard
            icon={Icons.Brain}
            title="孪生译员"
            description="创建专属数字分身，学习你的翻译风格，生成个性化的译文建议。"
          />
          <FeatureCard
            icon={Icons.Sparkles}
            title="翻译知识库"
            description="收录风格指南与背景材料等长文资料，按句段自动检索相关片段，为 AI 与孪生译员提供上下文。"
          />
          <FeatureCard
            icon={Icons.File}
            title="DOCX 格式保留"
            description="导入 Word 时保留加粗、斜体、颜色、高亮、上下标、删除线等 run 级样式；编辑器 WYSIWYG 显示，导出写回原文件版式。"
          />
          <FeatureCard
            icon={Icons.MessageSquare}
            title="AI 对话助手"
            description="内置智能对话系统，提供实时翻译咨询、术语解释和质量检查。"
          />
        </div>

    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl p-6 border border-blue-100">
      <div className="flex items-start gap-4">
        <div className="p-3 bg-blue-100 text-blue-600 rounded-xl">
          <Icons.Info className="w-6 h-6" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-900 mb-2">适用人群</h3>
          <ul className="space-y-2 text-slate-600">
            <li className="flex items-center gap-2">
              <Icons.Check className="w-4 h-4 text-blue-500" />
              专业翻译人员
            </li>
            <li className="flex items-center gap-2">
              <Icons.Check className="w-4 h-4 text-blue-500" />
              本地化团队
            </li>
            <li className="flex items-center gap-2">
              <Icons.Check className="w-4 h-4 text-blue-500" />
              企业内部翻译部门
            </li>
            <li className="flex items-center gap-2">
              <Icons.Check className="w-4 h-4 text-blue-500" />
              自由职业译者
            </li>
          </ul>
        </div>
      </div>
    </div>

    <div className="bg-gradient-to-r from-slate-50 to-slate-100 rounded-2xl p-6 border border-slate-200">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-slate-200 text-slate-600 rounded-xl">
            <Icons.Info className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 mb-1">版本信息</h3>
            <p className="text-sm text-slate-600">Smart-CAT Studio {APP_DISPLAY_VERSION}</p>
            <p className="text-xs text-slate-500 mt-1">版本亮点请见左侧「更新说明」。</p>
          </div>
        </div>
        <div className="text-right max-w-md md:ml-auto">
          <p className="text-sm font-semibold text-slate-900 mb-1">作者：Sunny</p>
          <p className="text-sm text-slate-600">Email: 52352604@qq.com</p>
          <p className="text-sm text-slate-600 mt-3 leading-relaxed">
            特别鸣谢：感谢 Selina 对本应用开发的大力支持
          </p>
        </div>
      </div>
    </div>
  </div>
  );
};

const WhatsNewSection = () => {
  const cloud = isCloudDeployment();
  return (
  <div className="space-y-8">
    <div>
      <h2 className="text-3xl font-bold text-slate-900 mb-4">更新说明 · {APP_DISPLAY_VERSION}</h2>
      <p className="text-lg text-slate-600 leading-relaxed">
        本页汇总当前版本的可见变更与文档更新。各功能的详细操作仍请参考对应章节（项目管理、翻译编辑、孪生译员、语言资源、知识库、系统设置）。
      </p>
    </div>

    <div className="bg-gradient-to-r from-teal-50 to-emerald-50 rounded-2xl p-6 border border-teal-200">
      <div className="flex items-start gap-4">
        <div className="p-3 bg-teal-100 text-teal-700 rounded-xl">
          <Icons.Lightbulb className="w-6 h-6" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-900 mb-3">V1.8.1 · 项目向导与 CAT 包</h3>
          <ul className="space-y-2 text-slate-700 text-sm">
            <li className="flex gap-2">
              <Icons.Check className="w-4 h-4 text-teal-600 flex-shrink-0 mt-0.5" />
              <span><strong className="text-slate-900">创建项目向导</strong>：四步流程（基本信息 → 导入文件 → 资源挂载 → 确认创建）；记忆库 / 术语库 / 辅助词典采用 Trados 风格表格，支持主库、参考库与新建库。</span>
            </li>
            <li className="flex gap-2">
              <Icons.Check className="w-4 h-4 text-teal-600 flex-shrink-0 mt-0.5" />
              <span><strong className="text-slate-900">CAT 包导入</strong>：支持 Trados 项目包（.sdlppx / .sdlrpx）、memoQ 包（.mqxlz）及 SDLXLIFF / MQXLIFF；导入时自动识别语言对，可批量上传多文件。</span>
            </li>
            <li className="flex gap-2">
              <Icons.Check className="w-4 h-4 text-teal-600 flex-shrink-0 mt-0.5" />
              <span><strong className="text-slate-900">PPTX 格式保留</strong>：通过 Okapi 侧车（8090）导入 / 导出 PowerPoint，保留字符级样式；原文格式导出写回 .pptx。</span>
            </li>
            <li className="flex gap-2">
              <Icons.Check className="w-4 h-4 text-teal-600 flex-shrink-0 mt-0.5" />
              <span><strong className="text-slate-900">XLIFF 回写增强</strong>：导出 MQXLZ 回传包时写回包内 MQXLIFF 并保留 skeleton.xml，便于 memoQ 交稿；Trados 包项目可在列表中识别类型。</span>
            </li>
            <li className="flex gap-2">
              <Icons.Check className="w-4 h-4 text-teal-600 flex-shrink-0 mt-0.5" />
              <span>本地开发请使用根目录 <code className="bg-white/80 px-1 rounded">启动Smart CAT Studio V 1.8.1.bat</code> 一并启动 Okapi、数据库与前端。</span>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-2xl p-6 border border-amber-200">
      <div className="flex items-start gap-4">
        <div className="p-3 bg-amber-100 text-amber-700 rounded-xl">
          <Icons.Lightbulb className="w-6 h-6" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-900 mb-3">V1.8.0 · DOCX 格式保留</h3>
          <ul className="space-y-2 text-slate-700 text-sm">
            <li className="flex gap-2">
              <Icons.Check className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <span><strong className="text-slate-900">原文格式导出</strong>：纯译文在原 DOCX / PPTX / TXT / HTML 上写回译文并保留版式；DOCX 另支持段段对照、并列对照双语导出（仿云译客 iCAT），多文件打包为 ZIP。</span>
            </li>
            <li className="flex gap-2">
              <Icons.Check className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <span><strong className="text-slate-900">WYSIWYG 编辑</strong>：带格式的句段在编辑器中近似 Word 显示；译文可所见即所得编辑，内部以标签串保存以便回写。</span>
            </li>
            <li className="flex gap-2">
              <Icons.Check className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <span><strong className="text-slate-900">复制原文格式</strong>：在译文中选中文字 → 按住 <kbd className="bg-white/80 px-1 rounded text-xs">Ctrl</kbd> → 点击原文中带格式的片段，将该 run 样式应用到选区（可多次叠加不同样式）。</span>
            </li>
            <li className="flex gap-2">
              <Icons.Check className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <span><strong className="text-slate-900">标签 QA</strong>：编辑带 inline 标签的 DOCX / SDL 句段时，若译文标签数量与原文不一致会提示警告，便于导出前自查。</span>
            </li>
            <li className="flex gap-2">
              <Icons.Check className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <span>导入时自动保存原文件副本；需 <strong className="text-slate-900">Okapi 侧车</strong>（8090）运行。</span>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm md:col-span-2">
        <h3 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
          <Icons.File className="w-5 h-5 text-indigo-600" />
          DOCX 格式保留（自 V1.8.0 起）
        </h3>
        <ul className="space-y-2 text-slate-600 text-sm">
          <li>• 支持 run 级样式：加粗、斜体、下划线、删除线、字体颜色、高亮、上标、下标；段落级删除线等也会继承识别。</li>
          <li>• 导出时选择「原文格式」→ 纯译文（保真）、段段对照或并列对照；双语 DOCX 可在浏览器直接生成，纯译文需 Okapi 侧车。</li>
          <li>• 多文件打包为 <code className="bg-slate-50 px-1 rounded">项目原文格式导出_…</code> 或 <code className="bg-slate-50 px-1 rounded">项目双语导出_…</code> ZIP。</li>
          <li>• 若提示缺少原文件备份，请重新导入该 DOCX（导入时会自动保存原文件）。详细操作见「翻译编辑 → DOCX 格式保留」。</li>
        </ul>
      </div>
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
        <h3 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
          <Icons.Database className="w-5 h-5 text-blue-600" />
          翻译记忆与术语
        </h3>
        <ul className="space-y-2 text-slate-600 text-sm">
          <li>• 记忆库 / 术语库的导入导出、搜索与项目关联流程保持不变；建议在语言资源页定期备份 Excel。</li>
          <li>• 编辑器侧「添加条目」可将当前句段快速写入记忆库或术语库（详见「翻译编辑 → 核心功能」）。</li>
        </ul>
      </div>
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
        <h3 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
          <Icons.Sparkles className="w-5 h-5 text-teal-600" />
          知识库与 RAG
        </h3>
        <ul className="space-y-2 text-slate-600 text-sm">
          <li>• 支持正文编辑与 DOCX 导入、项目绑定与全局库；启用后可在 AI 翻译与孪生译员推理时自动附带检索片段。</li>
          <li>• 向量服务异常或未配置时自动回退为词法检索，无需打断工作流（参见「翻译知识库」与「系统设置 → 向量检索」）。</li>
        </ul>
      </div>
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
        <h3 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
          <Icons.Brain className="w-5 h-5 text-purple-600" />
          孪生译员
        </h3>
        <ul className="space-y-2 text-slate-600 text-sm">
          <li>• 支持「边翻边学」与对建议的反馈训练；卡片展示学习句段量、采纳率与风格维度说明。</li>
          <li>• 可与知识库 RAG 同时使用，使个性化建议更贴合客户规范与背景材料。</li>
        </ul>
      </div>
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
        <h3 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
          <Icons.Settings className="w-5 h-5 text-slate-600" />
          {cloud ? '云端数据与 AI' : '本地数据与 AI'}
        </h3>
        <ul className="space-y-2 text-slate-600 text-sm">
          <li>
            •{' '}
            {cloud
              ? '项目与资源统一保存在云端 PostgreSQL，按登录账号隔离；可在「系统设置 → 云端数据」查看说明。'
              : '项目与资源统一由本机 SQLite 持久化；「本地数据」面板可查看路径、导出备份与恢复。'}
          </li>
          <li>
            • AI 引擎（Gemini / DeepSeek / 本地 LLM 等）、快捷按钮与编辑器偏好均写入{cloud ? '云端' : '同一本地后端'}，{cloud ? '换设备登录同一账号即可同步。' : '换机请先备份数据库文件。'}
          </li>
        </ul>
      </div>
    </div>

    <div className="bg-blue-50 rounded-2xl p-6 border border-blue-100">
      <div className="flex items-start gap-4">
        <div className="p-3 bg-blue-100 text-blue-600 rounded-xl">
          <Icons.Info className="w-6 h-6" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-900 mb-2">后续版本</h3>
          <p className="text-slate-600 text-sm">
            {cloud
              ? '云端版数据随账号保存在服务器，无需手动迁移数据库文件。建议在语言资源页定期导出 Excel 备份。'
              : '若您从旧版本升级，建议在完成数据库备份后覆盖安装或替换前端资源包；首次启动后可在「本地数据」确认路径无误。'}
            更细分的变更日志如有需要可单独维护在外部文档或发行说明中。
          </p>
        </div>
      </div>
    </div>
  </div>
  );
};

const QuickStartSection = () => (
  <div className="space-y-8">
    <div>
      <h2 className="text-3xl font-bold text-slate-900 mb-4">快速入门指南</h2>
      <p className="text-lg text-slate-600">
        按照以下步骤，您将能够在几分钟内开始使用 Smart-CAT Studio 进行翻译工作。
      </p>
    </div>

    <div className="space-y-6">
      <StepCard
        step={1}
        title="创建翻译项目"
        description="在项目管理页面点击「新建项目」，按向导步骤填写：基本信息 → 导入文件 → 资源挂载 → 确认创建。"
        icon={Icons.Plus}
      />
      <StepCard
        step={2}
        title="导入翻译文件"
        description="在向导第 2 步上传需要翻译的文件：TXT、DOCX、PPTX、Excel（.xlsx / .xls）；Trados 的 .sdlxliff / .sdlppx / .sdlrpx；memoQ 的 .mqxliff / .mqxlz（压缩包，内含 MQXLIFF 与 skeleton.xml）。DOCX / PPTX 导入时会保存原文件并提取 run 级格式（PPTX 含演讲者备注，需 Okapi 侧车）；XLIFF 会保留句段 ID 以便回写；SDLXLIFF 在编辑器中以 <标签ID> 形式显示内联标记。"
        icon={Icons.Upload}
      />
      <StepCard
        step={3}
        title="配置语言资源"
        description="在向导第 3 步选择或创建翻译记忆库和术语库，这些资源将帮助您提高翻译效率和一致性。"
        icon={Icons.Database}
      />
      <StepCard
        step={4}
        title="开始翻译"
        description="进入翻译编辑页面，逐句翻译。系统会自动提供记忆库匹配、术语高亮和 AI 翻译建议。"
        icon={Icons.File}
      />
      <StepCard
        step={5}
        title="导出翻译结果"
        description="翻译完成后可导出 Excel、TMX；XLIFF 项目可导出 SDLXLIFF / MQXLIFF，或 Trados SDLRPX / memoQ MQXLZ 回传包。DOCX / PPTX / TXT / HTML 可选「原文格式」纯译文（保真）；DOCX 另支持段段对照、并列对照双语导出（仿云译客 iCAT）。"
        icon={Icons.Download}
      />
    </div>

    <div className="bg-amber-50 rounded-2xl p-6 border border-amber-200">
      <div className="flex items-start gap-4">
        <div className="p-3 bg-amber-100 text-amber-600 rounded-xl">
          <Icons.Lightbulb className="w-6 h-6" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-900 mb-2">新手提示</h3>
          <ul className="space-y-2 text-slate-600 text-sm">
            <li>• 首次使用时，建议先创建一个测试项目熟悉界面和功能</li>
            <li>• 翻译记忆库和术语库可以跨项目复用，建议按领域分类管理</li>
            <li>• 使用 AI 翻译功能前，请确保已正确配置 API Key</li>
            <li>• 定期导出备份您的翻译记忆库和术语库</li>
          </ul>
        </div>
      </div>
    </div>
  </div>
);

const DashboardSection = () => (
  <div className="space-y-8">
    <div>
      <h2 className="text-3xl font-bold text-slate-900 mb-4">项目管理页面</h2>
      <p className="text-lg text-slate-600">
        项目管理页面是您管理所有翻译项目的中心。在这里您可以创建、编辑、删除项目，以及查看项目进度。
      </p>
    </div>

    <div className="space-y-6">
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
        <h3 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
          <Icons.Plus className="w-5 h-5 text-blue-500" />
          创建新项目
        </h3>
        <p className="text-slate-600 mb-4">
          点击「新建项目」后将打开分步向导，顶部步骤条显示当前进度；可使用「上一步 / 下一步」逐步填写，已完成步骤可点击回跳修改。
        </p>
        <ol className="space-y-3 text-slate-600">
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-sm font-bold">1</span>
            <span><strong className="text-slate-900">基本信息</strong>：填写项目名称，选择源语言和目标语言</span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-sm font-bold">2</span>
            <span><strong className="text-slate-900">导入文件</strong>：上传需要翻译的文件（支持多文件）；导入 XLIFF 时若语言与步骤 1 不同，将提示并以文件内语言为准</span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-sm font-bold">3</span>
            <span><strong className="text-slate-900">资源挂载</strong>：左侧切换「翻译记忆库 / 术语库 / 辅助词典」，表格中「更新/写入」设主库、「查库」勾选参考库；默认仅显示匹配项目语言对的资源</span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-sm font-bold">4</span>
            <span><strong className="text-slate-900">确认创建</strong>：核对项目摘要后点击「创建项目」完成</span>
          </li>
        </ol>
      </div>

      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
        <h3 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
          <Icons.File className="w-5 h-5 text-blue-500" />
          项目卡片说明
        </h3>
        <ul className="space-y-3 text-slate-600">
          <li className="flex items-start gap-2">
            <Icons.ChevronRight className="w-4 h-4 text-slate-400 mt-1" />
            <div>
              <strong className="text-slate-900">项目名称和语言对：</strong>显示项目名称及源语言到目标语言
            </div>
          </li>
          <li className="flex items-start gap-2">
            <Icons.ChevronRight className="w-4 h-4 text-slate-400 mt-1" />
            <div>
              <strong className="text-slate-900">进度条：</strong>显示项目的整体翻译进度百分比
            </div>
          </li>
          <li className="flex items-start gap-2">
            <Icons.ChevronRight className="w-4 h-4 text-slate-400 mt-1" />
            <div>
              <strong className="text-slate-900">记忆库/术语库：</strong>显示项目关联的记忆库和术语库数量
            </div>
          </li>
          <li className="flex items-start gap-2">
            <Icons.ChevronRight className="w-4 h-4 text-slate-400 mt-1" />
            <div>
              <strong className="text-slate-900">管理文件：</strong>点击文件图标可添加或删除项目文件
            </div>
          </li>
          <li className="flex items-start gap-2">
            <Icons.ChevronRight className="w-4 h-4 text-slate-400 mt-1" />
            <div>
              <strong className="text-slate-900">删除项目：</strong>点击垃圾桶图标可删除项目（谨慎操作）
            </div>
          </li>
        </ul>
      </div>

      <div className="bg-blue-50 rounded-2xl p-6 border border-blue-100">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-blue-100 text-blue-600 rounded-xl">
            <Icons.Lightbulb className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 mb-2">使用技巧</h3>
            <ul className="space-y-2 text-slate-600 text-sm">
              <li>• 使用搜索框快速查找项目</li>
              <li>• 点击项目卡片可直接进入翻译编辑页面</li>
              <li>• 可以为不同客户或领域创建独立的项目</li>
              <li>• 项目进度会实时更新，方便跟踪工作状态</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </div>
);

const EditorSection = () => (
  <div className="space-y-8">
    <div>
      <h2 className="text-3xl font-bold text-slate-900 mb-4">翻译编辑页面</h2>
      <p className="text-lg text-slate-600">
        翻译编辑页面是您进行翻译工作的主要界面。这里提供了丰富的辅助功能，帮助您高效完成翻译任务。
      </p>
    </div>

    <div className="space-y-6">
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
        <h3 className="text-xl font-bold text-slate-900 mb-4">界面布局</h3>
        <div className="space-y-4 text-slate-600">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
              <span className="font-bold">1</span>
            </div>
            <div>
              <strong className="text-slate-900">句段列表：</strong>
              左侧显示所有翻译句段，可滚动查看。已翻译的句段会显示不同颜色标记。
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
              <span className="font-bold">2</span>
            </div>
            <div>
              <strong className="text-slate-900">编辑区域：</strong>
              中央是主要的翻译编辑区，包含原文、译文输入框和各种辅助信息。
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
              <span className="font-bold">3</span>
            </div>
            <div>
              <strong className="text-slate-900">辅助面板：</strong>
              右侧显示翻译记忆库匹配、术语库信息、AI 对话等辅助功能。
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
        <h3 className="text-xl font-bold text-slate-900 mb-4">核心功能</h3>
        <div className="grid gap-4">
          <FunctionItem
            icon={Icons.Database}
            title="翻译记忆库匹配"
            description="系统会自动查找记忆库中与当前句段相似的翻译，显示匹配度和译文。支持精确匹配（100%）和模糊匹配。"
          />
          <FunctionItem
            icon={Icons.TermBase}
            title="术语高亮"
            description="原文中的术语会以黄色高亮显示，鼠标悬停可查看术语翻译。确保术语翻译的一致性。"
          />
          <FunctionItem
            icon={Icons.Sparkles}
            title="AI 翻译"
            description="点击 AI 翻译按钮，系统会使用配置的 AI 模型生成翻译建议。可以接受、修改或忽略建议。"
          />
          <FunctionItem
            icon={Icons.MessageSquare}
            title="AI 对话"
            description="打开 AI 对话窗口，可以与 AI 进行交互，获取翻译建议、语法检查、术语解释等帮助。"
          />
          <FunctionItem
            icon={Icons.Check}
            title="确认句段"
            description="翻译完成后，点击确认按钮将句段标记为'已确认'。确认后的句段会自动保存到记忆库。"
          />
          <FunctionItem
            icon={Icons.Copy}
            title="复制译文"
            description="快速复制当前译文到剪贴板，方便粘贴使用。"
          />
        </div>
      </div>

      <div className="bg-gradient-to-r from-indigo-50 to-blue-50 rounded-2xl p-6 border border-indigo-100">
        <h3 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
          <Icons.File className="w-5 h-5 text-indigo-600" />
          DOCX 格式保留
        </h3>
        <div className="space-y-4 text-slate-600 text-sm leading-relaxed">
          <p>
            从 <strong className="text-slate-900">V1.8.0</strong> 起，导入 DOCX 时会解析 Word 的 run 级样式（加粗、斜体、下划线、删除线、颜色、高亮、上标、下标等），
            原文列以近似 Word 的方式显示；导入同时会在本地保存原文件，供后续「原文格式」纯译文（保真）导出写回。
          </p>
          <div>
            <strong className="text-slate-900">复制格式到译文</strong>
            <ol className="mt-2 space-y-1 list-decimal list-inside">
              <li>在译文框中选中需要加格式的文字；</li>
              <li>按住 <kbd className="bg-white px-1.5 py-0.5 rounded border border-indigo-200 text-xs">Ctrl</kbd>，原文中带格式的片段会显示手形光标；</li>
              <li>点击该片段，即可将其 run 样式应用到译文选区；可对同一译文多次操作以叠加不同片段的样式。</li>
            </ol>
          </div>
          <div>
            <strong className="text-slate-900">导出</strong>
            <ul className="mt-2 space-y-1">
              <li>• 点击右上角「导出」→「原文格式」→ 选择纯译文（保真）、段段对照或并列对照；段段对照可选「原文在上/译文在上」。</li>
              <li>• 纯译文需在本地版运行 Okapi 侧车（8090）；段段/并列对照双语 DOCX 可在浏览器直接下载。</li>
              <li>• 若纯译文不可用，请重新导入 DOCX（导入时会保存原文件备份）。</li>
            </ul>
          </div>
          <div>
            <strong className="text-slate-900">标签 QA</strong>
            <p className="mt-1">
              编辑带 inline 标签的句段时，若译文标签与原文数量不一致，句段下方会出现警告，便于导出前修正。
              AI 翻译在原文含标签时也会提示保留标签结构。
            </p>
          </div>
          <p className="text-slate-500 text-xs">
            同一段落内若译文长度与原文差异较大，个别字符级样式位置可能需手动调整；复杂版式（文本框、形状内文字等）以实际 Word 结构为准。
          </p>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
        <h3 className="text-xl font-bold text-slate-900 mb-4">编辑器图标说明</h3>
        <div className="space-y-6">
          <div>
            <h4 className="text-lg font-semibold text-slate-900 mb-3 flex items-center gap-2">
              <Icons.Check className="w-5 h-5 text-green-600" />
              句段状态图标
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                <Icons.Check className="w-5 h-5 text-green-600" strokeWidth={3} />
                <div>
                  <div className="font-medium text-slate-900">已确认</div>
                  <div className="text-xs text-slate-500">句段已完成并确认</div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                <Icons.Edit className="w-4 h-4 text-blue-600" />
                <div>
                  <div className="font-medium text-slate-900">已翻译</div>
                  <div className="text-xs text-slate-500">句段已翻译但未确认</div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                <Icons.Edit className="w-4 h-4 text-orange-400" />
                <div>
                  <div className="font-medium text-slate-900">草稿</div>
                  <div className="text-xs text-slate-500">句段有草稿内容</div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                <Icons.Search className="w-4 h-4 text-purple-500" />
                <div>
                  <div className="font-medium text-slate-900">待审核</div>
                  <div className="text-xs text-slate-500">句段等待审核</div>
                </div>
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-lg font-semibold text-slate-900 mb-3 flex items-center gap-2">
              <Icons.Lock className="w-5 h-5 text-slate-600" />
              句段操作图标
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                <Icons.Check className="w-4 h-4 text-green-600" />
                <div>
                  <div className="font-medium text-slate-900">确认句段</div>
                  <div className="text-xs text-slate-500">保存当前译文并标记为已确认</div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                <Icons.X className="w-4 h-4 text-red-600" />
                <div>
                  <div className="font-medium text-slate-900">取消编辑</div>
                  <div className="text-xs text-slate-500">放弃当前修改</div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                <Icons.Lock className="w-4 h-4 text-slate-600" />
                <div>
                  <div className="font-medium text-slate-900">锁定句段</div>
                  <div className="text-xs text-slate-500">锁定句段，防止误编辑</div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                <Icons.Unlock className="w-4 h-4 text-emerald-600" />
                <div>
                  <div className="font-medium text-slate-900">解锁句段</div>
                  <div className="text-xs text-slate-500">解锁句段，允许编辑</div>
                </div>
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-lg font-semibold text-slate-900 mb-3 flex items-center gap-2">
              <Icons.Sparkles className="w-5 h-5 text-purple-600" />
              AI 辅助图标
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                <Icons.Sparkles className="w-4 h-4 text-purple-600" />
                <div>
                  <div className="font-medium text-slate-900">AI 翻译</div>
                  <div className="text-xs text-slate-500">使用 AI 模型生成翻译建议</div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                <Icons.Magic className="w-4 h-4 text-indigo-600" />
                <div>
                  <div className="font-medium text-slate-900">AI 优化</div>
                  <div className="text-xs text-slate-500">优化当前译文质量</div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                <Icons.MessageSquare className="w-4 h-4 text-blue-600" />
                <div>
                  <div className="font-medium text-slate-900">AI 对话</div>
                  <div className="text-xs text-slate-500">打开 AI 对话窗口获取帮助</div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                <Icons.BrainCircuit className="w-4 h-4 text-teal-600" />
                <div>
                  <div className="font-medium text-slate-900">深度质量检查</div>
                  <div className="text-xs text-slate-500">使用 AI 进行深度质量检查</div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                <Icons.Brain className="w-4 h-4 text-purple-600" />
                <div>
                  <div className="font-medium text-slate-900">孪生译员</div>
                  <div className="text-xs text-slate-500">学习翻译风格生成个性化建议</div>
                </div>
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-lg font-semibold text-slate-900 mb-3 flex items-center gap-2">
              <Icons.Database className="w-5 h-5 text-blue-600" />
              记忆库和术语库图标
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                <Icons.Database className="w-4 h-4 text-blue-600" />
                <div>
                  <div className="font-medium text-slate-900">翻译记忆库</div>
                  <div className="text-xs text-slate-500">查看记忆库匹配结果</div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                <Icons.TermBase className="w-4 h-4 text-red-600" />
                <div>
                  <div className="font-medium text-slate-900">术语库</div>
                  <div className="text-xs text-slate-500">查看术语库匹配结果</div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                <Icons.Concordance className="w-4 h-4 text-amber-600" />
                <div>
                  <div className="font-medium text-slate-900">一致性检查</div>
                  <div className="text-xs text-slate-500">检查翻译一致性</div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                <Icons.CornerDownRight className="w-3 h-3 text-slate-600" />
                <div>
                  <div className="font-medium text-slate-900">插入到译文</div>
                  <div className="text-xs text-slate-500">将匹配内容插入到译文框</div>
                </div>
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-lg font-semibold text-slate-900 mb-3 flex items-center gap-2">
              <Icons.Wrench className="w-5 h-5 text-slate-600" />
              其他工具图标
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                <Icons.Copy className="w-4 h-4 text-slate-600" />
                <div>
                  <div className="font-medium text-slate-900">复制译文</div>
                  <div className="text-xs text-slate-500">复制当前译文到剪贴板</div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                <Icons.Zap className="w-4 h-4 text-indigo-600" />
                <div>
                  <div className="font-medium text-slate-900">自动填充</div>
                  <div className="text-xs text-slate-500">自动填充相似句段的译文</div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                <Icons.TermExtraction className="w-4 h-4 text-teal-600" />
                <div>
                  <div className="font-medium text-slate-900">术语提取</div>
                  <div className="text-xs text-slate-500">从当前文件提取术语</div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                <Icons.QA className="w-4 h-4 text-purple-600" />
                <div>
                  <div className="font-medium text-slate-900">质量检查</div>
                  <div className="text-xs text-slate-500">执行质量检查</div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                <Icons.Jump className="w-4 h-4 text-blue-600" />
                <div>
                  <div className="font-medium text-slate-900">跳转到句段</div>
                  <div className="text-xs text-slate-500">快速跳转到指定句段</div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                <Icons.Sort className="w-3.5 h-3.5 text-slate-600" />
                <div>
                  <div className="font-medium text-slate-900">排序</div>
                  <div className="text-xs text-slate-500">对句段进行排序</div>
                </div>
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-lg font-semibold text-slate-900 mb-3 flex items-center gap-2">
              <Icons.Settings className="w-5 h-5 text-slate-600" />
              设置和搜索图标
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                <Icons.Settings className="w-4 h-4 text-slate-600" />
                <div>
                  <div className="font-medium text-slate-900">编辑器设置</div>
                  <div className="text-xs text-slate-500">打开编辑器设置面板</div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                <Icons.Search className="w-4 h-4 text-slate-600" />
                <div>
                  <div className="font-medium text-slate-900">搜索</div>
                  <div className="text-xs text-slate-500">在句段中搜索内容</div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                <Icons.ScanSearch className="w-4 h-4 text-blue-600" />
                <div>
                  <div className="font-medium text-slate-900">搜索并替换</div>
                  <div className="text-xs text-slate-500">在句段中搜索并替换内容</div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                <Icons.Plus className="w-4 h-4 text-green-600" />
                <div>
                  <div className="font-medium text-slate-900">添加条目</div>
                  <div className="text-xs text-slate-500">添加新的记忆库或术语库条目</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
        <h3 className="text-xl font-bold text-slate-900 mb-2">快捷键</h3>
        <p className="text-sm text-slate-500 mb-6">
          下文 <kbd className="px-1.5 py-0.5 bg-slate-100 rounded text-xs font-mono">Ctrl</kbd> 在 macOS 上对应{' '}
          <kbd className="px-1.5 py-0.5 bg-slate-100 rounded text-xs font-mono">⌘ Cmd</kbd>。部分快捷键在焦点位于其他输入框、句段锁定或未满足条件时不会触发。
        </p>

        <h4 className="text-sm font-bold text-slate-800 uppercase tracking-wide mb-3">译文框（当前句译文）</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm mb-8">
          <ShortcutRow label="确认当前句段（写入已翻译等状态）" keys={['Enter']} />
          <ShortcutRow label="译文内换行" keys={['Alt', 'Enter']} />
          <ShortcutRow label="对选中译文切换大小写（小写 → 大写 → 首字母大写 → 小写）" keys={['Shift', 'F3']} />
        </div>

        <h4 className="text-sm font-bold text-slate-800 uppercase tracking-wide mb-3">原文拆分编辑（双击原文进入编辑）</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm mb-8">
          <ShortcutRow label="保存原文并退出编辑" keys={['Ctrl', 'Enter']} />
          <ShortcutRow label="放弃修改" keys={['Esc']} />
          <ShortcutRow label="原文内换行" keys={['Shift', 'Enter']} />
          <ShortcutRow label="在光标处拆成两个句段（勿在句首/句尾；锁定句不可用）" keys={['Enter']} />
        </div>

        <h4 className="text-sm font-bold text-slate-800 uppercase tracking-wide mb-3">记忆库与一致性</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm mb-8">
          <ShortcutRow label="打开一致性侧栏并搜索（选中文字 → 上次选中 → 当前句原文）" keys={['F3']} />
          <ShortcutRow label="用当前句原文填入译文" keys={['F1']} />
          <ShortcutRow label="插入 TM 列表中第一条匹配译文（最高分）" keys={['F4']} />
        </div>

        <h4 className="text-sm font-bold text-slate-800 uppercase tracking-wide mb-3">术语侧栏</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm mb-8">
          <ShortcutRow label="插入列表第 1～9 条术语译文（侧栏须在「术语」标签；焦点勿在其他小型输入框）" keys={['Ctrl', '1 … 9']} />
          <ShortcutRow label="保存正在添加/编辑的术语（须已填写原文与译文且有主术语库）" keys={['Ctrl', 'W']} />
        </div>

        <h4 className="text-sm font-bold text-slate-800 uppercase tracking-wide mb-3">单句模式与列表</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm mb-6">
          <ShortcutRow label="上一句 / 下一句（仅「单句」布局；焦点不在输入框或 contenteditable 内）" keys={['Alt', '↑ / ↓']} />
          <ShortcutRow label="句段列表多选 / 范围选" keys={['Ctrl', '点击']} hint="Shift + 点击框选范围" />
        </div>

        <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-xs text-slate-600">
          <strong className="text-slate-800">说明：</strong>
          AI 翻译、润色、孪生译员等请使用编辑器工具栏与侧栏按钮；列表上下键导航取决于当前焦点是否在句段列表上。
        </div>
      </div>

      <div className="bg-green-50 rounded-2xl p-6 border border-green-200">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-green-100 text-green-600 rounded-xl">
            <Icons.Check className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 mb-2">翻译质量保证</h3>
            <ul className="space-y-2 text-slate-600 text-sm">
              <li>• 使用深度质量检查功能，自动检测潜在问题</li>
              <li>• 定期查看术语一致性，确保术语翻译准确</li>
              <li>• 利用 AI 优化功能提升译文质量</li>
              <li>• 完成后导出 TMX 格式，便于后续项目复用</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </div>
);

const ResourcesSection = () => (
  <div className="space-y-8">
    <div>
      <h2 className="text-3xl font-bold text-slate-900 mb-4">语言资源页面</h2>
      <p className="text-lg text-slate-600">
        语言资源页面用于管理<strong className="text-slate-800">翻译记忆库</strong>、<strong className="text-slate-800">术语库</strong>、<strong className="text-slate-800">规则词典</strong>与<strong className="text-slate-800">正则表达式词典</strong>（后两项为独立标签）。记忆库与术语库提供句段级匹配与术语高亮；规则词典在<strong className="text-slate-900">整句</strong>匹配成功时固定句式并由 AI 翻译可变部分；正则词典则用正则捕获与替换处理<strong className="text-slate-900">模式化片段</strong>，并可把「类别」提供给规则词典引用。
      </p>
    </div>

    <div className="space-y-6">
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
        <h3 className="text-xl font-bold text-slate-900 mb-4">翻译记忆库（TM）</h3>
        <div className="space-y-4 text-slate-600">
          <p>
            翻译记忆库存储您之前翻译过的句段对（原文和译文）。当您翻译新内容时，
            系统会自动在记忆库中查找相似的句段，提供翻译参考。
          </p>
          <div className="grid gap-3">
            <div className="flex items-start gap-2">
              <Icons.Plus className="w-4 h-4 text-blue-500 mt-0.5" />
              <div>
                <strong className="text-slate-900">添加条目：</strong>
                点击"添加条目"按钮，输入原文和译文，保存到记忆库。
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Icons.Edit className="w-4 h-4 text-blue-500 mt-0.5" />
              <div>
                <strong className="text-slate-900">编辑条目：</strong>
                点击条目右侧的编辑图标，修改原文或译文。
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Icons.Upload className="w-4 h-4 text-blue-500 mt-0.5" />
              <div>
                <strong className="text-slate-900">导入记忆库：</strong>
                支持从 Excel 文件导入翻译记忆库，选择覆盖或合并模式。
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Icons.Download className="w-4 h-4 text-blue-500 mt-0.5" />
              <div>
                <strong className="text-slate-900">导出记忆库：</strong>
                将记忆库导出为 Excel 文件，便于备份或共享。
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
        <h3 className="text-xl font-bold text-slate-900 mb-4">术语库（TB）</h3>
        <div className="space-y-4 text-slate-600">
          <p>
            术语库存储专业术语及其标准翻译。在翻译过程中，术语会自动高亮显示，
            帮助您保持术语翻译的一致性。
          </p>
          <div className="grid gap-3">
            <div className="flex items-start gap-2">
              <Icons.Plus className="w-4 h-4 text-red-500 mt-0.5" />
              <div>
                <strong className="text-slate-900">添加术语：</strong>
                点击"添加术语"按钮，输入术语原文和译文。
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Icons.Edit className="w-4 h-4 text-red-500 mt-0.5" />
              <div>
                <strong className="text-slate-900">编辑术语：</strong>
                点击术语右侧的编辑图标，修改术语内容。
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Icons.Upload className="w-4 h-4 text-red-500 mt-0.5" />
              <div>
                <strong className="text-slate-900">导入术语库：</strong>
                支持从 Excel 文件导入术语库。
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Icons.Download className="w-4 h-4 text-red-500 mt-0.5" />
              <div>
                <strong className="text-slate-900">导出术语库：</strong>
                将术语库导出为 Excel 文件。
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-6 border border-amber-200 shadow-sm ring-1 ring-amber-100">
        <h3 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
          <Icons.Concordance className="w-5 h-5 text-amber-600" />
          规则词典（句式模板）— 详细教程
        </h3>
        <div className="space-y-5 text-slate-600 text-sm leading-relaxed">
          <p>
            规则词典用于定义<strong className="text-slate-900">源语言整句模式</strong>与<strong className="text-slate-900">目标语译文骨架</strong>。只有当当前句段原文（经空白规范化后）<strong className="text-slate-900">整句</strong>匹配某条规则的「原文句式」时才会启用该规则：可变部分送 AI 翻译或用类别释义替换，再写入译文模板。
          </p>

          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 space-y-3">
            <h4 className="text-sm font-bold text-slate-900">一、界面结构</h4>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong className="text-slate-800">句式规则：</strong>维护规则列表（原文句式、译文句式、优先级、备注、是否临时规则等）。</li>
              <li><strong className="text-slate-800">类别词条：</strong>为雪人式中的 <code className="bg-white px-1 rounded text-xs">{`{类别名}`}</code> 提供「词语 → 译文」对照（如月份、序数词）。内置类别 <code className="bg-white px-1 rounded text-xs">digits</code>、<code className="bg-white px-1 rounded text-xs">label</code> 等可直接用于模式，无需在此表填词。</li>
              <li>支持<strong className="text-slate-800">导出 / 导入 Excel</strong>（规则工作表 + 「类别词条」工作表）、整库 JSON 导出（侧栏「导出」）。</li>
            </ul>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 space-y-3">
            <h4 className="text-sm font-bold text-slate-900">二、写法 A：Legacy（双花括号）</h4>
            <p>
              在「原文句式」「译文句式」中使用同名占位符 <code className="bg-amber-50 px-1 rounded border border-amber-100 text-xs">{`{{变量名}}`}</code>，变量名仅允许英文字母、数字与下划线。整句匹配后，每个占位符对应片段<strong className="text-slate-900">单独调用 AI</strong>翻译，再填入译文句式；若某段<strong className="text-slate-900">整段仅为阿拉伯数字</strong>（可选小数点、千分位逗号），则<strong className="text-slate-900">不送译、原样保留</strong>。
            </p>
            <div className="rounded-lg bg-amber-50/90 border border-amber-100 px-3 py-2 font-mono text-xs text-amber-950">
              原文句式：<code className="bg-white/80 px-1 rounded">{'be satisfied with {{obj}}'}</code>
              <br />
              译文句式：<code className="bg-white/80 px-1 rounded">{'对{{obj}}感到满意'}</code>
              <br />
              <span className="text-amber-900/90 not-italic font-sans text-[11px]">输入句示例：<span className="font-mono">be satisfied with the result</span> → 占位符内送 AI → 骨架写成「对……感到满意」。</span>
            </div>
            <div className="rounded-lg border border-amber-100 bg-white p-3 space-y-2 text-xs">
              <p className="font-semibold text-slate-900">更多 Legacy 例句</p>
              <ul className="space-y-2 font-mono text-[11px] text-amber-950 leading-relaxed">
                <li>
                  <span className="text-slate-600 not-italic font-sans">① 单占位：</span>
                  <br />
                  原文句式 <code className="bg-amber-50 px-1 rounded">{'The {{n}} is unavailable.'}</code>
                  <br />
                  译文句式 <code className="bg-amber-50 px-1 rounded">{'{{n}}不可用。'}</code>
                  <br />
                  <span className="text-slate-600 not-italic font-sans">句段：<span className="font-mono text-slate-800">The API is unavailable.</span> → <span className="font-mono text-slate-800">API不可用。</span>（仅示意；实际以 AI 译名为准）</span>
                </li>
                <li>
                  <span className="text-slate-600 not-italic font-sans">② 双占位（顺序与命名一致）：</span>
                  <br />
                  原文句式 <code className="bg-amber-50 px-1 rounded">{'{{subject}} exceeds {{limit}}.'}</code>
                  <br />
                  译文句式 <code className="bg-amber-50 px-1 rounded">{'{{subject}}超过{{limit}}。'}</code>
                  <br />
                  <span className="text-slate-600 not-italic font-sans">句段：<span className="font-mono text-slate-800">CPU usage exceeds 90%.</span> → 两处片段分别译后填入。</span>
                </li>
                <li>
                  <span className="text-slate-600 not-italic font-sans">③ 同一占位符重复：</span>
                  <br />
                  原文句式 <code className="bg-amber-50 px-1 rounded">{'{{x}} and {{x}} are consistent.'}</code>
                  <br />
                  译文句式 <code className="bg-amber-50 px-1 rounded">{'{{x}}与{{x}}一致。'}</code>
                  <br />
                  <span className="text-slate-600 not-italic font-sans">两处 <span className="font-mono">{'{{x}}'}</span> 捕获同一段原文，通常得到同一译文填入。</span>
                </li>
              </ul>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 space-y-3">
            <h4 className="text-sm font-bold text-slate-900">三、写法 B：雪人式（单花括号、星号、井号、艾特）</h4>
            <p>当原文句式<strong className="text-slate-900">不</strong>使用 <code className="bg-white px-1 rounded text-xs">{`{{...}}`}</code> 时，按雪人式解析（与 Legacy 勿混用在同一条原文句式中）。常用符号如下：</p>

            <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2.5 space-y-1.5 text-xs text-slate-800">
              <p className="font-bold text-slate-900">关键理解点</p>
              <ul className="list-disc pl-4 space-y-1 leading-relaxed">
                <li>
                  <strong className="text-slate-900"><code className="bg-white/90 px-1 rounded">#</code> 是「原文引用」：</strong>
                  把 <code className="bg-white/90 px-1 rounded">*</code> 匹配到的原文字词，按占位顺序<strong className="text-slate-900">直接搬到</strong>译文句式里 <code className="bg-white/90 px-1 rounded">#</code> / <code className="bg-white/90 px-1 rounded">#1</code>… 的位置（引用对象是原文侧捕获的那段）。
                  <span className="text-slate-600">
                    若捕获整段仅为<strong className="text-slate-800">阿拉伯数字</strong>（可选小数点、千分位逗号，如 <code className="bg-white/90 px-1 rounded">1990</code>、<code className="bg-white/90 px-1 rounded">1,234.5</code>），则<strong className="text-slate-800">不送 AI</strong>，原样写入 <code className="bg-white/90 px-1 rounded">#</code>，避免年份等被译成中文数字；其余片段仍<strong className="text-slate-800">先 AI 翻译</strong>再写入。亦可改用内置 <code className="bg-white/90 px-1 rounded">{'{digits}'}</code> + <code className="bg-white/90 px-1 rounded">@1</code> 显式约束数字位。与 <code className="bg-white/90 px-1 rounded">@</code> 的词条路径不同。
                  </span>
                </li>
                <li>
                  <strong className="text-slate-900"><code className="bg-white/90 px-1 rounded">@</code> 是「译文引用」：</strong>
                  把 <code className="bg-white/90 px-1 rounded">{`{}`}</code> 类别对应的<strong className="text-slate-900">预定义译文</strong>拿过来填入 <code className="bg-white/90 px-1 rounded">@</code> / <code className="bg-white/90 px-1 rounded">@1</code>…（类别词条、内置类别或正则词典替换串），<strong className="text-slate-900">而不是</strong>原文词本身。
                </li>
                <li className="text-slate-600">
                  <strong className="text-slate-900">句末标点与 <code className="bg-white/90 px-1 rounded">*</code>：</strong>
                  原文句式若在最后一个 <code className="bg-white/90 px-1 rounded">*</code> 之后<strong className="text-slate-800">没有</strong>写出句末的 <code className="bg-white/90 px-1 rounded">.</code> <code className="bg-white/90 px-1 rounded">?</code> <code className="bg-white/90 px-1 rounded">!</code> 等字面量，整句结尾的标点会被 <code className="bg-white/90 px-1 rounded">*</code> 一并吃进，译入 <code className="bg-white/90 px-1 rounded">#</code> 后易出现「…坏小子。为伍」错位。
                  引擎在送 AI 前会<strong className="text-slate-800">剥除</strong>各 <code className="bg-white/90 px-1 rounded">*</code> 捕获段尾部的常见句末标点；若必须让标点参与匹配，请把它写进规则字面量（例如 <code className="bg-white/90 px-1 rounded">…with *.</code>）。
                </li>
              </ul>
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white text-xs">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-slate-700">
                    <th className="p-2 border-b border-slate-200 w-28">符号</th>
                    <th className="p-2 border-b border-slate-200">含义（原文句式）</th>
                    <th className="p-2 border-b border-slate-200">含义（译文句式）</th>
                  </tr>
                </thead>
                <tbody className="text-slate-700">
                  <tr className="border-b border-slate-100">
                    <td className="p-2 font-mono whitespace-nowrap"><code>*</code></td>
                    <td className="p-2">匹配一个词或一段短语（勿放在句式最开头）</td>
                    <td className="p-2">
                      <strong className="text-slate-900">原文引用：</strong>用 <code className="bg-slate-50 px-1 rounded">#1</code> <code className="bg-slate-50 px-1 rounded">#2</code>… 对应第几个星号；单独 <code className="bg-slate-50 px-1 rounded">#</code> 视为第一个星号。
                      占位符引用 <code className="bg-slate-50 px-1 rounded">*</code> 捕获的原文片段；非纯数字时写入前<strong className="text-slate-900">送 AI</strong>译为目标语。纯阿拉伯数字整段（含可选小数、千分位逗号）<strong className="text-slate-900">不送译、原样填入</strong>（见上文「关键理解点」）。
                    </td>
                  </tr>
                  <tr className="border-b border-slate-100">
                    <td className="p-2 font-mono whitespace-nowrap"><code>{`{类别}`}</code></td>
                    <td className="p-2">引用「类别词条」表或内置类别；若该类别在<strong className="text-slate-900">正则表达式词典</strong>中有同名类别，则优先按正则匹配并替换（见下文联动）</td>
                    <td className="p-2">
                      <strong className="text-slate-900">译文引用：</strong>用 <code className="bg-slate-50 px-1 rounded">@1</code> <code className="bg-slate-50 px-1 rounded">@2</code>… 按原文中左起第几个花括号块，填入该块的<strong className="text-slate-900">预定义译文</strong>（非原文词形）。
                    </td>
                  </tr>
                  <tr className="border-b border-slate-100">
                    <td className="p-2 font-mono whitespace-nowrap"><code>{`{：a|b|c}`}</code></td>
                    <td className="p-2">冒号为半角或全角均可；匹配列举词语之一</td>
                    <td className="p-2">
                      仍用 <code className="bg-slate-50 px-1 rounded">@序号</code> 做<strong className="text-slate-900">译文引用</strong>：填入该列举块对应的<strong className="text-slate-900">预定译文</strong>（来自词条表或与列举项关联的释义），不是字面照搬匹配到的原文词。
                    </td>
                  </tr>
                  <tr className="border-b border-slate-100">
                    <td className="p-2 font-mono whitespace-nowrap"><code>{`{甲|乙}`}</code></td>
                    <td className="p-2">匹配多个类别之一（无冒号时用竖线表示类别并集）</td>
                    <td className="p-2">同上</td>
                  </tr>
                  <tr className="border-b border-slate-100">
                    <td className="p-2 font-mono whitespace-nowrap"><code>^</code></td>
                    <td className="p-2" colSpan={2}>
                      可写在句式开头表示句首语义（本应用仍按整句匹配）
                    </td>
                  </tr>
                  <tr>
                    <td className="p-2 font-mono whitespace-nowrap"><code>\</code></td>
                    <td className="p-2" colSpan={2}>转义下一字符；译文中的竖线可用 <code className="bg-slate-50 px-1 rounded">\|</code> 表示字面量</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500">
              译文可用竖线分隔多条备选译法（如 <code className="bg-slate-100 px-1 rounded">译法A|译法B</code>）；自动翻译时取<strong className="text-slate-800">第一条</strong>。
            </p>
          </div>

          <div className="rounded-xl border border-amber-200 bg-white p-4 space-y-3">
            <h4 className="text-sm font-bold text-slate-900">雪人式 — 多条对照例句</h4>
            <p className="text-xs text-slate-600">
              下列均为「原文句式 / 译文句式」与「若输入句段为……则大致如何套用」的示意；星号段与部分词条仍可能再走 AI 或类别表。
            </p>
            <ul className="space-y-3 text-xs leading-relaxed">
              <li className="rounded-lg border border-slate-100 bg-slate-50/80 p-3 font-mono text-[11px] text-slate-800">
                <span className="font-sans font-semibold text-slate-900 block mb-1">例 1 · 单个 <code className="bg-white px-1 rounded">*</code>（可变段送 AI）</span>
                原文句式：<code className="bg-white px-1 rounded">The total is * .</code>
                <br />
                译文句式：<code className="bg-white px-1 rounded">合计为#。</code>
                <br />
                <span className="font-sans text-slate-600">输入句：<span className="font-mono text-slate-800">The total is 3,580 USD.</span> → # 对应「3,580 USD」送译后写入译文。</span>
              </li>
              <li className="rounded-lg border border-slate-100 bg-slate-50/80 p-3 font-mono text-[11px] text-slate-800">
                <span className="font-sans font-semibold text-slate-900 block mb-1">例 2 · 两个 <code className="bg-white px-1 rounded">*</code> 与 <code className="bg-white px-1 rounded">#1</code> <code className="bg-white px-1 rounded">#2</code></span>
                原文句式：<code className="bg-white px-1 rounded">* stated that * .</code>
                <br />
                译文句式：<code className="bg-white px-1 rounded">#1表示，#2。</code>
                <br />
                <span className="font-sans text-slate-600">输入句：<span className="font-mono text-slate-800">The report stated that risks remain.</span></span>
              </li>
              <li className="rounded-lg border border-slate-100 bg-slate-50/80 p-3 font-mono text-[11px] text-slate-800">
                <span className="font-sans font-semibold text-slate-900 block mb-1">例 3 · 列举词 <code className="bg-white px-1 rounded">{'{：a|b|c}'}</code></span>
                原文句式：<code className="bg-white px-1 rounded">{'Shipped on {：Mon|Tue|Wed} .'}</code>
                <br />
                译文句式：<code className="bg-white px-1 rounded">{'已于@1发货。'}</code>
                <br />
                <span className="font-sans text-slate-600">输入句：<span className="font-mono text-slate-800">Shipped on Tue .</span> → @1 取「Tue」在类别或内置映射中的译文（若无则需类别词条表补全）。</span>
              </li>
              <li className="rounded-lg border border-slate-100 bg-slate-50/80 p-3 font-mono text-[11px] text-slate-800">
                <span className="font-sans font-semibold text-slate-900 block mb-1">例 4 · 类别词条表 <code className="bg-white px-1 rounded">{'{month}'}</code></span>
                在「类别词条」表：<span className="font-sans text-slate-600"> January → 一月（类别名 month）；February → 二月（同上）</span>
                <br />
                原文句式：<code className="bg-white px-1 rounded">{'Due in {month} .'}</code>
                <br />
                译文句式：<code className="bg-white px-1 rounded">{'截止日期为@1。'}</code>
                <br />
                <span className="font-sans text-slate-600">输入句：<span className="font-mono text-slate-800">Due in January .</span> → @1 为词条表中 January 对应译文（如「一月」）。</span>
              </li>
              <li className="rounded-lg border border-slate-100 bg-slate-50/80 p-3 font-mono text-[11px] text-slate-800">
                <span className="font-sans font-semibold text-slate-900 block mb-1">例 5 · 与正则词典同名类别联动（摘要）</span>
                正则词典中建类别 <code className="bg-white px-1 rounded">金额</code>，条目把「12 thousand」一类改成「1.2万」等字符串。
                <br />
                原文句式：<code className="bg-white px-1 rounded">{'Price: {金额}'}</code>
                <br />
                译文句式：<code className="bg-white px-1 rounded">{'价格：@1'}</code>
                <br />
                <span className="font-sans text-slate-600">输入句：<span className="font-mono text-slate-800">Price: 12 thousand</span> → 先由该类正则生成替换串，再写入译文骨架。</span>
              </li>
            </ul>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 space-y-2">
            <h4 className="text-sm font-bold text-slate-900">四、优先级与临时规则</h4>
            <ul className="list-disc pl-5 space-y-1">
              <li>优先级范围为 <strong className="text-slate-800">0～20</strong>，数字<strong className="text-slate-900">越大越先</strong>尝试匹配。</li>
              <li><strong className="text-slate-800">临时规则：</strong>勾选后不参与句段翻译匹配，仅占位（便于后续扩展或自用标注）。</li>
              <li>无效规则（如雪人式缺少可用的类别或词条、Legacy 译文漏写占位符）在列表中以<strong className="text-red-600">红色</strong>提示。</li>
            </ul>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 space-y-2">
            <h4 className="text-sm font-bold text-slate-900">五、Excel 列说明（规则工作表）</h4>
            <p className="text-xs text-slate-600">A 原文句式 · B 译文句式 · C 规则类别标记（可选）· D 优先级 · E 备注 · F 填 1 表示临时规则。第二工作表「类别词条」：A 原文 · B 译文 · C 类别名。</p>
          </div>

          <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-4 space-y-2">
            <h4 className="text-sm font-bold text-slate-900">六、挂载与生效条件</h4>
            <ul className="grid gap-2">
              <li className="flex items-start gap-2">
                <Icons.Check className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                <span>在<strong className="text-slate-900">新建项目</strong>或<strong className="text-slate-900">项目设置</strong>中勾选规则词典；语言对必须与项目一致。</span>
              </li>
              <li className="flex items-start gap-2">
                <Icons.Sparkles className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                <span>执行<strong className="text-slate-900"> AI 翻译当前句</strong>时：句段会先经过已挂载的<strong className="text-slate-900">正则词典中「无类别」条目</strong>链式替换，再尝试规则词典；命中规则则返回模板译文，否则对替换后的全文继续走 AI。术语库仍以原文句段参与提示；Legacy / 星号片段翻译时会带上相关术语。</span>
              </li>
              <li className="flex items-start gap-2">
                <Icons.Download className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                <span>备份：规则词典可用面板内 Excel、侧栏 JSON 导出；勿与 TM/TB 的导入模板混用。</span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-6 border border-violet-200 shadow-sm ring-1 ring-violet-100">
        <h3 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
          <Icons.RegexDict className="w-5 h-5 text-violet-600" />
          正则表达式词典 — 详细教程
        </h3>
        <div className="space-y-5 text-slate-600 text-sm leading-relaxed">
          <p>
            正则表达式词典用于按<strong className="text-slate-900">模式</strong>匹配原文片段，并用<strong className="text-slate-900">译文模板</strong>替换（支持捕获组反引用）。适合日期、金额、「数字 + thousand」类结构等 TM 难以覆盖的情形。
          </p>

          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 space-y-3">
            <h4 className="text-sm font-bold text-slate-900">一、条目字段</h4>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong className="text-slate-800">原文（正则）：</strong>JavaScript 正则字面量中间的写法，<strong className="text-slate-900">不要</strong>写两侧的斜杠。示例：<code className="bg-white px-1 rounded text-xs">\b([0-9]+)th July</code></li>
              <li>
                <strong className="text-slate-800">译文模板：</strong>
                <code className="bg-white px-1 rounded text-xs">$1</code> <code className="bg-white px-1 rounded text-xs">$2</code>… 表示第几捕获组；<code className="bg-white px-1 rounded text-xs">$0</code> 或 <code className="bg-white px-1 rounded text-xs">{'$&'}</code> 表示整段匹配；<code className="bg-white px-1 rounded text-xs">$$</code> 表示字面量美元符号。
              </li>
              <li><strong className="text-slate-800">类别（可选）：</strong>见下文「两种用法」。</li>
              <li><strong className="text-slate-800">优先级：</strong>0～20，全局规则下同类别或无类别条目均按<strong className="text-slate-900">数字越大越优先</strong>排序执行。</li>
            </ul>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 space-y-3">
            <h4 className="text-sm font-bold text-slate-900">二、两种用法：类别留空 vs 填写类别</h4>
            <div className="space-y-3">
              <div className="rounded-lg bg-white border border-violet-100 p-3">
                <p className="font-semibold text-slate-900 mb-1">1）类别留空 — 句段级优先替换</p>
                <p className="text-xs leading-relaxed">
                  在<strong className="text-slate-900"> AI 翻译当前句</strong>之前，对<strong className="text-slate-900">整句原文</strong>（先做空白规范化）按优先级依次执行：每条规则用带 <code className="bg-slate-50 px-1 rounded">g</code> 标志的正则做全局替换。多条规则顺序执行，适合把句中的日期、数字格式整体改写后再交给规则词典或 AI。
                </p>
              </div>
              <div className="rounded-lg bg-white border border-violet-100 p-3">
                <p className="font-semibold text-slate-900 mb-1">2）填写类别 — 供规则词典引用</p>
                <p className="text-xs leading-relaxed">
                  在<strong className="text-slate-900">规则词典</strong>的雪人式原文里写 <code className="bg-slate-50 px-1 rounded">{`{类别名}`}</code>，类别名须与本词典某条（或多条）条目的「类别」一致。匹配时按该类别下条目优先级依次尝试正则；命中后对捕获组套用译文模板得到字符串，再填入规则译文中的 <code className="bg-slate-50 px-1 rounded">@1</code>、<code className="bg-slate-50 px-1 rounded">@2</code>…（与规则里花括号块从左到右顺序对应）。
                </p>
                <p className="text-xs text-slate-500 mt-2">
                  示例思路：正则词典建类别「金额」，正则 <code className="bg-slate-50 px-1 rounded">\b([0-9]+)([0-9]) thousand</code>，译文 <code className="bg-slate-50 px-1 rounded">$1.$2万</code>；规则词典写原文 <code className="bg-slate-50 px-1 rounded">{'Price: {金额}'}</code>、译文 <code className="bg-slate-50 px-1 rounded">{'价格: @1'}</code>，即可处理 「Price: 123 thousand」一类句子。
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-violet-200 bg-white p-4 space-y-3">
            <h4 className="text-sm font-bold text-slate-900">示例：多条典型条目与句段效果</h4>
            <p className="text-xs text-slate-600">
              下表便于对照「正则 → 译文模板 → 句子里怎样变」。引擎使用 JavaScript <code className="bg-slate-50 px-1 rounded">RegExp</code>（默认仅加全局标志 <code className="bg-slate-50 px-1 rounded">g</code>，无 <code className="bg-slate-50 px-1 rounded">i</code>），大小写不敏感时请用 <code className="bg-slate-50 px-1 rounded">[Jj]uly</code> 一类写法或拆成多条规则；同时注意 <code className="bg-slate-50 px-1 rounded">\b</code> 与中英文邻接时的边界。
            </p>
            <div className="overflow-x-auto rounded-lg border border-slate-200 text-xs">
              <table className="w-full text-left border-collapse min-w-[520px]">
                <thead>
                  <tr className="bg-violet-50 text-slate-700">
                    <th className="p-2 border-b border-slate-200 w-24">类别</th>
                    <th className="p-2 border-b border-slate-200">原文（正则）</th>
                    <th className="p-2 border-b border-slate-200">译文模板</th>
                    <th className="p-2 border-b border-slate-200">句段示例（节选）</th>
                  </tr>
                </thead>
                <tbody className="text-slate-700 font-mono text-[11px]">
                  <tr className="border-b border-slate-100 align-top">
                    <td className="p-2 text-slate-500 whitespace-nowrap font-sans">（留空）</td>
                    <td className="p-2"><code className="whitespace-pre-wrap break-all">\b[Jj]uly\b</code></td>
                    <td className="p-2">七月</td>
                    <td className="p-2 font-sans text-slate-600"><span className="font-mono text-slate-800">… on 15 July …</span> → <span className="font-mono text-slate-800">… on 15 七月 …</span>（可与日期数字规则组合）</td>
                  </tr>
                  <tr className="border-b border-slate-100 align-top">
                    <td className="p-2 text-slate-500 whitespace-nowrap font-sans">（留空）</td>
                    <td className="p-2"><code className="whitespace-pre-wrap break-all">\b(\d+)\s+thousand\b</code></td>
                    <td className="p-2">$1千</td>
                    <td className="p-2 font-sans text-slate-600"><span className="font-mono text-slate-800">budget of 5 thousand</span> → <span className="font-mono text-slate-800">budget of 5千</span></td>
                  </tr>
                  <tr className="border-b border-slate-100 align-top">
                    <td className="p-2 text-slate-500 whitespace-nowrap font-sans">（留空）</td>
                    <td className="p-2"><code className="whitespace-pre-wrap break-all">\$\s*([\d,]+(?:\.\d+)?)</code></td>
                    <td className="p-2">{'$$'}$1</td>
                    <td className="p-2 font-sans text-slate-600"><span className="font-mono text-slate-800">costs $ 1,200.50</span> → 保留货币符号并抽出数字（示意）</td>
                  </tr>
                  <tr className="border-b border-slate-100 align-top">
                    <td className="p-2 whitespace-nowrap font-sans text-violet-800">金额</td>
                    <td className="p-2"><code className="whitespace-pre-wrap break-all">\b(\d+)\s+thousand\b</code></td>
                    <td className="p-2">$1千</td>
                    <td className="p-2 font-sans text-slate-600">不在句段级单独替换；供规则 <span className="font-mono text-slate-800">{'Price: {金额}'}</span> 命中时填入 <span className="font-mono text-slate-800">@1</span> → 如 <span className="font-mono text-slate-800">价格：12千</span></td>
                  </tr>
                  <tr className="border-b border-slate-100 align-top">
                    <td className="p-2 whitespace-nowrap font-sans text-violet-800">日期</td>
                    <td className="p-2"><code className="whitespace-pre-wrap break-all">{'\\b(\\d{1,2})\\s+July\\s+(\\d{4})\\b'}</code></td>
                    <td className="p-2">$2年7月$1日</td>
                    <td className="p-2 font-sans text-slate-600">规则写 <span className="font-mono text-slate-800">{'Expires: {日期}'}</span>，句段 <span className="font-mono text-slate-800">Expires: 15 July 2026</span> → @1 为 <span className="font-mono text-slate-800">2026年7月15日</span></td>
                  </tr>
                  <tr className="align-top">
                    <td className="p-2 whitespace-nowrap font-sans text-violet-800">—</td>
                    <td className="p-2 font-sans text-slate-600 text-[11px]" colSpan={3}>
                      <strong className="text-slate-800">整条流水线示意：</strong>
                      句段原文 <span className="font-mono text-slate-800">Price: 3 thousand (valid until 15 July)</span> → 先执行<strong className="text-slate-900">无类别</strong>条目（如 thousand、July）得到改写句 → 再尝试<strong className="text-slate-900">规则词典</strong>；若规则中含 <span className="font-mono">{'{金额}'}</span> 等同名类别，再走<strong className="text-slate-900">有类别</strong>正则生成 @ 片段。
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 space-y-2">
            <h4 className="text-sm font-bold text-slate-900">三、与规则词典的执行顺序（摘要）</h4>
            <ol className="list-decimal pl-5 space-y-1 text-xs">
              <li>规范化句段空白 → 应用已挂载正则词典中<strong className="text-slate-900">所有「类别为空」</strong>的条目（全局替换链）。</li>
              <li>用<strong className="text-slate-900">规则词典</strong>对当前字符串做整句匹配（雪人式中若某花括号类别仅存在于正则词典，则用正则替换结果作为该块的 @ 值）。</li>
              <li>若规则未命中，则对第 1 步得到的字符串进行<strong className="text-slate-900">整句 AI 翻译</strong>。</li>
            </ol>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 space-y-2">
            <h4 className="text-sm font-bold text-slate-900">四、管理与备份</h4>
            <ul className="list-disc pl-5 space-y-1">
              <li>在「语言资源 → 正则表达式词典」中新建词典、添加条目；面板支持 Excel 导入/导出。</li>
              <li>在<strong className="text-slate-900">项目设置</strong>中勾选挂载；语言对须与项目一致。</li>
              <li>侧栏「导出」可将当前库导出为 JSON；建议复杂规则在 Excel 中编辑后再导入。</li>
              <li>正则条目过多会影响性能，建议<strong className="text-slate-900">总数控制在千条以内</strong>（界面亦有提示）。</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="bg-purple-50 rounded-2xl p-6 border border-purple-200">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-purple-100 text-purple-600 rounded-xl">
            <Icons.Lightbulb className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 mb-2">最佳实践</h3>
            <ul className="space-y-2 text-slate-600 text-sm">
              <li>• 按领域或客户分类创建不同的记忆库和术语库</li>
              <li>• 定期更新和维护术语库，确保术语翻译的准确性</li>
              <li>• 导出备份重要的记忆库和术语库，防止数据丢失</li>
              <li>• 在创建项目时，正确关联相关的记忆库和术语库</li>
              <li>• 规则词典适合固定句式 + AI 译可变段；正则词典适合强模式（日期、金额等）；二者可同时挂载，注意「无类别」正则会先改写句段再匹配规则</li>
              <li>• 正则条目建议控制在千条以内；规则与正则均在项目设置中勾选且语言对一致后才生效</li>
              <li>• 使用搜索功能快速查找特定的条目</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </div>
);

const KnowledgeSection = () => (
  <div className="space-y-8">
    <div>
      <h2 className="text-3xl font-bold text-slate-900 mb-4">翻译知识库</h2>
      <p className="text-lg text-slate-600">
        在侧边栏进入「知识库」（页面标题为「翻译知识库」），可为项目或全局提供可检索的参考资料。翻译与孪生译员生成时，
        系统会根据当前句段原文自动选取最相关的文本片段（RAG）写入模型上下文，帮助输出贴合规程与领域背景。
      </p>
    </div>

    <div className="space-y-6">
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
        <h3 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
          <Icons.File className="w-5 h-5 text-teal-600" />
          内容与导入
        </h3>
        <div className="space-y-4 text-slate-600">
          <p>
            每个知识库包含名称、可选说明、正文与支持 DOCX（.docx）导入。保存时正文会按固定规则切成多个文本块用于检索；
            列表中会显示切块数量、原文长度以及已向量化块数。
          </p>
          <div className="grid gap-3">
            <div className="flex items-start gap-2">
              <Icons.Plus className="w-4 h-4 text-teal-600 mt-0.5" />
              <div>
                <strong className="text-slate-900">新建 / 编辑：</strong>
                填写正文或从 Word 导入后保存；可多选绑定项目，不选任何项目则为「全局」知识库。
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Icons.Check className="w-4 h-4 text-teal-600 mt-0.5" />
              <div>
                <strong className="text-slate-900">启用：</strong>
                仅「已启用」且作用范围包含当前项目的知识库会参与检索；停用后不参与。
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Icons.Refresh className="w-4 h-4 text-teal-600 mt-0.5" />
              <div>
                <strong className="text-slate-900">重算向量：</strong>
                在已启用本地向量服务的前提下，可按当前正文重新切块并请求服务生成向量；失败时可仍使用词法检索。
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
        <h3 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
          <Icons.Settings className="w-5 h-5 text-blue-600" />
          与「向量检索」设置配合
        </h3>
        <div className="space-y-4 text-slate-600">
          <p>
            在「系统设置 → 向量检索（本地 RAG / 知识库）」中可启动本机向量服务、填写地址与 API Key，并选择 RAG 模式：
            仅词法（关键句匹配）、仅向量（语义）或混合（语义 + 词法）。未配置向量、无向量数据或服务异常时，会自动回退为词法检索，仍可检索知识库文本。
          </p>
        </div>
      </div>

      <div className="bg-teal-50 rounded-2xl p-6 border border-teal-200">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-teal-100 text-teal-700 rounded-xl">
            <Icons.Lightbulb className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 mb-2">使用建议</h3>
            <ul className="space-y-2 text-slate-600 text-sm">
              <li>• 适合放入风格指南、产品背景、禁止表述等「说明性」内容，与句段级 TM、术语级 TB 形成互补</li>
              <li>• 按客户或领域拆分多个知识库并绑定对应项目，避免无关片段混入上下文</li>
              <li>• 修改正文或服务地址后，可视需要执行「重算向量」以保持语义检索质量</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </div>
);

const SettingsSection = () => {
  const cloud = isCloudDeployment();
  return (
  <div className="space-y-8">
    <div>
      <h2 className="text-3xl font-bold text-slate-900 mb-4">系统设置页面</h2>
      <p className="text-lg text-slate-600">
        系统设置分为多个面板：AI 引擎、MT 参考、向量检索（知识库 RAG）、{cloud ? '云端数据' : '本地数据（SQLite 路径与备份导入导出）'}、以及 AI 对话快捷按钮。
        {cloud
          ? ' 云端版登录后即可读写项目数据，无需在本机启动数据库服务。'
          : ' 使用前需已启动本地数据服务（见下方说明），否则应用无法读写项目数据。'}
      </p>
    </div>

    <div className="space-y-6">
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
        <h3 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
          <Icons.Sparkles className="w-5 h-5 text-purple-500" />
          AI 引擎配置
        </h3>
        <div className="space-y-4 text-slate-600">
          <p>
            Smart-CAT Studio 支持多种 AI 翻译引擎，您可以根据需要选择默认引擎。
          </p>
          <div className="space-y-3">
            <div className="p-4 bg-slate-50 rounded-lg">
              <strong className="text-slate-900">Google Gemini：</strong>
              <p className="text-sm mt-1">Google 提供的先进 AI 模型，翻译质量高，支持多种语言对。</p>
            </div>
            <div className="p-4 bg-slate-50 rounded-lg">
              <strong className="text-slate-900">DeepSeek：</strong>
              <p className="text-sm mt-1">国产 AI 模型，性能优秀，特别适合中英翻译。</p>
            </div>
            <div className="p-4 bg-slate-50 rounded-lg">
              <strong className="text-slate-900">本地 LLM (llama.cpp)：</strong>
              <p className="text-sm mt-1">
                在本机运行 llama-server（如千问 GGUF 模型），通过 OpenAI 兼容接口调用。需在设置中填写服务地址（默认
                {' '}
                <code className="text-xs bg-slate-200 px-1 rounded">http://127.0.0.1:8080/v1</code>
                ），并先启动 llama-server 与 Smart-CAT 本地后端（
                <code className="text-xs bg-slate-200 px-1 rounded">npm run dev:with-db</code>
                ）。仅适用于本机使用；孪生译员仍走 DeepSeek。
              </p>
            </div>
            <div className="p-4 bg-slate-50 rounded-lg">
              <strong className="text-slate-900">OpenAI：</strong>
              <p className="text-sm mt-1">业界领先的 AI 模型，功能强大（暂未完全支持）。</p>
            </div>
          </div>
          <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-200 mt-4">
            <strong className="text-slate-900">机器翻译参考（translators，独立于 AI 引擎）：</strong>
            <p className="text-sm mt-1">
              在「系统设置 → MT 参考」中启用本地 Python sidecar（默认{' '}
              <code className="text-xs bg-slate-200 px-1 rounded">http://127.0.0.1:8770</code>
              ）。单引擎对照在编辑页底部「MT 参考」Tab；多引擎对比在编辑页内全屏弹层（设置中勾选「默认使用多引擎对比」，或底部面板点「多引擎对比…」）。
              打开方式：<strong className="text-slate-800">Ctrl+Shift+M</strong>（译文框内也可用）、标题栏「MT 参考」、或勾选设置里的「句段切换时自动查询」后切换句段（对比模式开弹层，单引擎开底部面板）。
              快捷键{' '}
              <kbd className="px-1 py-0.5 bg-white border border-slate-300 rounded text-xs">Ctrl+Shift+M</kbd>
              。有划选时用划选内容，否则用当前句原文。译文<strong>不会自动写入</strong>，需手动复制或点击「插入译文」（会<strong>清空当前句段译文</strong>后整句写入参考结果）。
            </p>
            <p className="text-xs mt-2 text-slate-600">
              基于开源库{' '}
              <a
                href="https://github.com/UlionTse/translators"
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-700 hover:underline"
              >
                translators
              </a>{' '}
             （UlionTse，GPL-3.0），通过抓取第三方站点实现，稳定性与合规性有限，仅供个人参考对照，不建议商用批量调用。各引擎按场景选用见下方「MT 引擎推荐」。
            </p>
          </div>
          <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
            <strong className="text-slate-900">配置 API Key：</strong>
            <p className="text-sm mt-1">
              DeepSeek 等需在设置中填写 API Key，与 AI 设置、快捷按钮等一并由<strong className="text-slate-900">{cloud ? '云端 API 持久化到 PostgreSQL' : '本地后端写入 SQLite'}</strong>（非浏览器 IndexedDB）。
              Google Gemini 的调用密钥由运行环境提供（界面显示为已通过环境变量加载），请按部署说明配置。
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
        <h3 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
          <Icons.Globe className="w-5 h-5 text-indigo-600" />
          MT 引擎推荐
        </h3>
        <div className="space-y-4 text-slate-600">
          <p className="text-sm">
            当前 MT 参考面板内置经试用的 <strong className="text-slate-900">17 个引擎</strong>，可在编辑页底部切换对照。
            下列按<strong className="text-slate-900">翻译场景</strong>给出优先顺序；同一原文可多开 2～3 个引擎比对，比只盯一个更可靠。
            结果仅供参考，专业领域（法律、医学等）仍需人工判断。
          </p>
          <div className="space-y-3">
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-100">
              <strong className="text-slate-900">日常英译中 / 中译英对照</strong>
              <ul className="mt-2 space-y-1 text-sm list-disc list-inside">
                <li>
                  <strong className="text-slate-800">主看：</strong>有道、云译、搜狗、腾讯交互翻译
                </li>
                <li>
                  <strong className="text-slate-800">备看：</strong>讯飞听见（中文侧）
                </li>
              </ul>
            </div>
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-100">
              <strong className="text-slate-900">韩日项目</strong>
              <p className="mt-2 text-sm">
                <strong className="text-slate-800">Papago</strong>（韩）；日译中仍建议以有道、云译为主，Papago 作韩日相关句参考。
              </p>
            </div>
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-100">
              <strong className="text-slate-900">欧语（法德西意等）</strong>
              <p className="mt-2 text-sm">Reverso、Systran、ModernMT</p>
            </div>
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-100">
              <strong className="text-slate-900">俄乌 / 东欧</strong>
              <p className="mt-2 text-sm">Yandex</p>
            </div>
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-100">
              <strong className="text-slate-900">区分美式 / 英式、巴葡 / 欧葡等</strong>
              <p className="mt-2 text-sm">Lingvanex、iTranslate</p>
            </div>
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-100">
              <strong className="text-slate-900">小语种或 Google 不可用时的广覆盖备选</strong>
              <p className="mt-2 text-sm">Lara、金山/iciba、迅捷</p>
            </div>
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-100">
              <strong className="text-slate-900">多引擎对比</strong>
              <p className="mt-2 text-sm">
                在对比弹层中并行对照有道、云译、搜狗等引擎（最多 6 个）；支持预设「日常中英 / 欧语 / 广覆盖」。
                弹层内每张卡片可单独复制或插入译文；底部栏「复制选中 / 插入选中」作用于当前选中卡片。Esc 或「关闭」退出弹层，不影响对比模式设置。
              </p>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            面板中另有 Google、Translate.com 等引擎，可在网络可用时作广语种对照；若某引擎报错，多为网页接口变更或限流，请换同场景下的其它推荐项重试。
          </p>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
        <h3 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
          <Icons.Database className="w-5 h-5 text-slate-700" />
          {cloud ? '云端数据（PostgreSQL）' : '本地数据（SQLite）'}
        </h3>
        <div className="space-y-4 text-slate-600">
          {cloud ? (
            <>
              <p>
                项目、记忆库、术语库、知识库、孪生译员及上述 AI 设置等均保存在云端 PostgreSQL 数据库中，按登录账号（组织）隔离。
                换设备、换浏览器，只要登录同一账号即可访问全部数据。
              </p>
              <p className="text-sm">
                在「云端数据」面板可查看连接状态与存储说明。SQLite 路径切换、整库导入导出仅在本地开发版可用。
                建议定期在「语言资源」页导出 Excel 备份术语库与记忆库。
              </p>
            </>
          ) : (
            <>
              <p>
                项目、记忆库、术语库、知识库、孪生译员及上述 AI 设置等均保存在本机 SQLite 数据库中。在「本地数据」面板可查看或修改数据库路径、导出备份文件、或从备份恢复。
              </p>
              <p className="text-sm">
                请使用带本地后端的启动方式（例如开发环境中的 <code className="px-1 py-0.5 bg-slate-100 rounded text-xs">npm run dev:with-db</code> 或文档中的 <code className="px-1 py-0.5 bg-slate-100 rounded text-xs">npm run server</code>），确保前端能连上本地 API；未连接后端时应用会阻止写入，避免数据落到非预期位置。
              </p>
            </>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
        <h3 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
          <Icons.BrainCircuit className="w-5 h-5 text-teal-600" />
          向量检索（与知识库配合）
        </h3>
        <div className="space-y-4 text-slate-600">
          <p>
            在「向量检索」面板可启用本地向量服务、填写服务地址与可选 API Key、选择 RAG 模式；开发模式下可一键后台启动向量服务并在界面查看日志与进度（默认端口 8765，与手动运行 <code className="px-1 py-0.5 bg-slate-100 rounded text-xs">scripts\start-embedding.cmd</code> 等效）。详细与知识库页面的说明互补。
          </p>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
        <h3 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
          <Icons.Languages className="w-5 h-5 text-blue-500" />
          AI 快捷按钮
        </h3>
        <div className="space-y-4 text-slate-600">
          <p>
            自定义 AI 对话窗口中的快捷按钮，让常用的 AI 操作更加便捷。
          </p>
          <div className="grid gap-3">
            <div className="flex items-start gap-2">
              <Icons.Plus className="w-4 h-4 text-blue-500 mt-0.5" />
              <div>
                <strong className="text-slate-900">添加按钮：</strong>
                点击"添加新快捷按钮"，设置按钮名称和提示词内容。
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Icons.Edit className="w-4 h-4 text-blue-500 mt-0.5" />
              <div>
                <strong className="text-slate-900">编辑按钮：</strong>
                直接修改按钮名称或提示词内容，系统会自动保存。
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Icons.Trash className="w-4 h-4 text-red-500 mt-0.5" />
              <div>
                <strong className="text-slate-900">删除按钮：</strong>
                点击按钮右侧的删除图标即可删除。
              </div>
            </div>
          </div>
          <div className="bg-amber-50 p-4 rounded-lg border border-amber-200">
            <strong className="text-slate-900">预设按钮示例：</strong>
            <ul className="text-sm mt-2 space-y-1">
              <li>• 中译英：请将以下内容翻译成英语</li>
              <li>• 英译中：请将以下内容翻译成中文</li>
              <li>• 优化英语：请优化以下英语表达</li>
              <li>• 语法检查：请检查以下内容的语法错误</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="bg-green-50 rounded-2xl p-6 border border-green-200">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-green-100 text-green-600 rounded-xl">
            <Icons.Check className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 mb-2">设置建议</h3>
            <ul className="space-y-2 text-slate-600 text-sm">
              <li>• 根据翻译需求选择合适的 AI 引擎</li>
              <li>• 定期更新 API Key，确保服务正常使用</li>
              <li>• 根据工作习惯自定义快捷按钮</li>
              <li>• 编辑器主题、字体与句段自动传播等可在翻译编辑器的设置中调整，并会随「编辑器设置」一并保存到{cloud ? '云端' : '本地数据库'}</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </div>
  );
};

const FAQSection = () => {
  const cloud = isCloudDeployment();
  const faqs = [
    {
      question: `${APP_DISPLAY_VERSION} 有哪些新内容？`,
      answer: `${APP_DISPLAY_VERSION} 重点新增创建项目向导（四步流程、Trados 风格资源挂载）、Trados / memoQ 项目包与 XLIFF 导入、PPTX 格式保留，以及 MQXLZ 回传包导出。DOCX 格式保留与双语导出自 V1.8.0 延续可用。详见「更新说明」。`
    },
    {
      question: "如何开始使用 Smart-CAT Studio？",
      answer: "首先创建一个翻译项目，上传需要翻译的文件，配置记忆库和术语库，然后进入翻译编辑页面开始翻译。详细步骤请参考'快速入门'部分。"
    },
    {
      question: "支持哪些文件格式？",
      answer: "新建项目时支持导入 TXT、DOCX、PPTX 以及 Excel（.xlsx / .xls）：表格至少两列时按「原文 / 译文」拆成句段，单列则每行作为原文句段。DOCX / PPTX 会保存原文件并提取字符级格式（PPTX 需 Okapi 侧车）。导出支持 Excel (.xlsx)、TMX、原文格式（纯译文 DOCX/PPTX/TXT/HTML，及 DOCX 段段/并列对照），以及 SDLXLIFF / MQXLIFF / SDLRPX / MQXLZ 等 CAT 回写格式。"
    },
    {
      question: "翻译记忆库和术语库有什么区别？",
      answer: "翻译记忆库存储完整的句段对（原文和译文），用于匹配相似的句子。术语库存储专业术语及其翻译，用于确保术语翻译的一致性。"
    },
    {
      question: "规则词典是什么？和术语库有什么不同？",
      answer: "术语库是「词条—译文」对照，用于高亮与一致性检查。规则词典定义整句级「源语言句式」与「目标语译文骨架」：支持 Legacy 写法（双花括号 {{变量}}，可变段送 AI）与雪人式（*、#、单花括号类别、@ 等，详见帮助「语言资源 → 规则词典」全文）。须在「语言资源 → 规则词典」维护，并在项目设置中勾选挂载且语言对一致。"
    },
    {
      question: "正则表达式词典做什么用？和规则词典怎么配合？",
      answer: "正则词典按正则匹配片段并用 $1、$2、$0、$&、$$ 等模板替换。类别留空的条目在 AI 翻译当前句之前对整句做全局链式替换（适合日期格式等）；填写类别后，可在规则词典雪人式中用 {类别名} 引用，由正则先算出替换串再填入规则的 @1、@2…。请在「语言资源 → 正则表达式词典」维护，并在项目设置中勾选挂载。完整顺序与字段说明见帮助「语言资源 → 正则表达式词典」。"
    },
    {
      question: "编辑器快捷键在哪里查看？",
      answer: "打开使用帮助中的「翻译编辑」章节，滚动至「快捷键」分组（译文框、原文拆分编辑、记忆库与一致性 F3/F1/F4、术语 Ctrl+1～9 与 Ctrl+W、单句模式 Alt+方向键等）。Windows 为 Ctrl，macOS 对应 ⌘。"
    },
    {
      question: "翻译知识库是什么？和记忆库、术语库有什么不同？",
      answer: "翻译知识库用于存放参考资料性质的长文本（如客户风格说明、背景材料、内部规范摘要等）。系统会按当前句段自动检索最相关的片段（RAG），把内容提供给 AI 翻译与孪生译员作补充上下文；它不替代句段级的翻译记忆匹配，也不是术语对表。"
    },
    {
      question: "知识库如何生效？需要做哪些设置？",
      answer: "在「翻译知识库」页面新建或编辑库：粘贴正文或导入 .docx，勾选「启用」，并按需绑定项目（不勾选任何项目即为全局知识库，对所有项目生效）。在「系统设置 → 向量检索」中可启用本地向量服务并选择检索模式；若未启用向量或向量失败，会自动回退为词法检索。保存或「重算向量」后，在编辑器中调用 AI 时会自动携带检索到的片段。"
    },
    {
      question: "如何配置 AI 翻译功能？",
      answer: cloud
        ? "打开「系统设置 → AI 引擎」，选择默认引擎。DeepSeek 需在页面中填写 API Key（保存到云端 PostgreSQL）；本地 LLM 需先在本机启动 llama-server 并填写服务地址；Gemini 由运行环境提供密钥（界面提示已通过环境变量加载）。可使用「测试引擎连接」确认配置。"
        : "打开「系统设置 → AI 引擎」，选择默认引擎。DeepSeek 需在页面中填写 API Key（写入本地 SQLite）；本地 LLM 需先启动 llama-server（如 run.bat）并填写 http://127.0.0.1:8080/v1，同时运行 npm run dev:with-db 以启用代理；Gemini 由运行环境提供密钥。可使用「测试引擎连接」确认配置。"
    },
    {
      question: "翻译进度如何计算？",
      answer: "翻译进度基于已确认的句段数量占总句段数量的百分比。只有标记为'已确认'状态的句段才会计入进度。"
    },
    {
      question: "如何导出翻译结果？",
      answer: "在翻译编辑页面点击右上角「导出」：可选 Excel、TMX、原文格式（纯译文 DOCX/PPTX/TXT/HTML，及 DOCX 段段/并列对照）、SDLXLIFF / MQXLIFF / SDLRPX / MQXLZ 等（视项目文件类型而定）。MQXLZ 回传包会将包内 MQXLIFF 写回译文并保留 skeleton.xml，供 memoQ 导入交稿。纯译文在原文件上写回并保留版式，需 Okapi 侧车；双语对照 DOCX 可在浏览器直接生成。可勾选「仅导出已确认句段」。"
    },
    {
      question: "能否跨项目复用记忆库和术语库？",
      answer: "可以。记忆库和术语库是独立于项目的资源，可以在创建多个项目时重复使用。建议按领域或客户分类管理。"
    },
    {
      question: "数据存储在哪里？",
      answer: cloud
        ? "项目、文件句段、翻译记忆库、术语库、知识库、孪生译员以及 AI / 编辑器相关设置等，均保存在云端 PostgreSQL，按登录账号隔离。换设备登录同一账号即可继续工作。建议定期在「语言资源」页导出 Excel 备份。"
        : "项目、文件句段、翻译记忆库、术语库、知识库、孪生译员以及 AI / 编辑器相关设置等，均通过本地后端持久化到本机 SQLite 数据库（路径可在「系统设置 → 本地数据」查看与调整）。请保持本地数据服务可用，并定期在该面板或语言资源页导出备份，以防磁盘损坏或换机。"
    },
    {
      question: "孪生译员和普通 AI 翻译有什么区别？",
      answer: "普通 AI 翻译提供通用建议，孪生译员会学习您的个人翻译风格，生成更符合您习惯的译文建议。它通过观察您的翻译选择，逐步理解您的偏好。"
    },
    {
      question: "如何快速训练孪生译员？",
      answer: "建议先手动翻译 10-20 个句段并点击'学习此翻译'按钮，让译员积累基础数据。也可以导入您之前的翻译文档，快速建立风格模型。"
    },
    {
      question: "孪生译员可以学习哪些翻译风格？",
      answer: "孪生译员学习您的句子长度偏好、正式程度、术语一致性、习惯译法等特征。在管理页面可以查看详细的风格特征数据。"
    },
    {
      question: "如何提高翻译效率？",
      answer: "充分利用翻译记忆库匹配、术语高亮、孪生译员和 AI 翻译功能；使用快捷键快速操作；定期维护记忆库和术语库以提高匹配率。"
    },
    {
      question: "遇到问题如何获取帮助？",
      answer: "您可以查看本帮助文档，或访问在线文档获取更多信息。如仍有疑问，可以联系技术支持团队。"
    }
  ];

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold text-slate-900 mb-4">常见问题解答</h2>
        <p className="text-lg text-slate-600">
          这里汇总了用户常见的问题和解答，帮助您快速解决使用中遇到的问题。
        </p>
      </div>

      <div className="space-y-4">
        {faqs.map((faq, index) => (
          <FAQItem key={index} question={faq.question} answer={faq.answer} />
        ))}
      </div>

      <div className="bg-blue-50 rounded-2xl p-6 border border-blue-100">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-blue-100 text-blue-600 rounded-xl">
            <Icons.MessageSquare className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 mb-2">仍有疑问？</h3>
            <p className="text-slate-600 text-sm">
              如果您的问题没有在这里找到答案，欢迎联系我们的技术支持团队，
              我们会尽快为您解答。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

const ShortcutRow = ({
  label,
  keys,
  hint,
}: {
  label: string;
  keys: string[];
  hint?: string;
}) => (
  <div className="flex flex-col gap-2 p-3 bg-slate-50 rounded-lg md:flex-row md:items-start md:justify-between md:gap-4">
    <span className="text-slate-600">{label}</span>
    <div className="flex flex-wrap items-center gap-1 shrink-0">
      {keys.map((k, i) => (
        <React.Fragment key={`${k}-${i}`}>
          {i > 0 ? <span className="text-slate-400 select-none">+</span> : null}
          <kbd className="px-2 py-1 bg-slate-200 rounded text-xs font-mono whitespace-nowrap">{k}</kbd>
        </React.Fragment>
      ))}
      {hint ? <span className="text-slate-400 text-xs w-full md:w-auto md:ml-1">{hint}</span> : null}
    </div>
  </div>
);

const FeatureCard = ({ icon: Icon, title, description }: { icon: any; title: string; description: string }) => (
  <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
    <div className="p-3 bg-blue-100 text-blue-600 rounded-xl w-fit mb-4">
      <Icon className="w-6 h-6" />
    </div>
    <h3 className="text-lg font-bold text-slate-900 mb-2">{title}</h3>
    <p className="text-slate-600 text-sm">{description}</p>
  </div>
);

const StepCard = ({ step, title, description, icon: Icon }: { step: number; title: string; description: string; icon: any }) => (
  <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex gap-4">
    <div className="flex-shrink-0 w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-xl flex items-center justify-center text-white font-bold text-lg shadow-lg">
      {step}
    </div>
    <div className="flex-1">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-5 h-5 text-blue-500" />
        <h3 className="text-lg font-bold text-slate-900">{title}</h3>
      </div>
      <p className="text-slate-600">{description}</p>
    </div>
  </div>
);

const FunctionItem = ({ icon: Icon, title, description }: { icon: any; title: string; description: string }) => (
  <div className="flex gap-3 p-4 bg-slate-50 rounded-lg">
    <div className="flex-shrink-0 p-2 bg-white rounded-lg shadow-sm">
      <Icon className="w-5 h-5 text-blue-500" />
    </div>
    <div>
      <h4 className="font-semibold text-slate-900 mb-1">{title}</h4>
      <p className="text-sm text-slate-600">{description}</p>
    </div>
  </div>
);

const FAQItem = ({ question, answer }: { question: string; answer: string }) => (
  <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
    <h3 className="font-bold text-slate-900 mb-2 flex items-start gap-2">
      <Icons.HelpCircle className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
      {question}
    </h3>
    <p className="text-slate-600 ml-7">{answer}</p>
  </div>
);

const TwinTranslatorsSection = () => (
  <div className="space-y-8">
    <div>
      <h2 className="text-3xl font-bold text-slate-900 mb-4">孪生译员：你的数字翻译分身</h2>
      <p className="text-lg text-slate-600 leading-relaxed">
        孪生译员是一个能够学习你的翻译风格的 AI 助手。它会在你翻译时观察你的选择，
        逐步理解你的偏好，最终为你生成个性化的译文建议。用得越多，学得越像你。
      </p>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-2xl p-6 border border-purple-200">
        <h3 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
          <Icons.Brain className="w-5 h-5 text-purple-600" />
          一、创建孪生译员
        </h3>
        <ol className="space-y-3 text-slate-700">
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-sm font-bold">1</span>
            <span>在应用左侧<strong>主导航</strong>中点击「孪生译员」（与「项目管理」并列，不在项目页内部）</span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-sm font-bold">2</span>
            <span>点击右上角"创建新译员"按钮</span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-sm font-bold">3</span>
            <span>填写译员名称、描述、语言对和基础模型</span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-sm font-bold">4</span>
            <span>建议为不同领域创建不同译员（如技术文档、营销文案）</span>
          </li>
        </ol>
      </div>

      <div className="bg-gradient-to-br from-blue-50 to-cyan-50 rounded-2xl p-6 border border-blue-200">
        <h3 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
          <Icons.Edit className="w-5 h-5 text-blue-600" />
          二、在翻译中使用
        </h3>
        <ol className="space-y-3 text-slate-700">
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-sm font-bold">1</span>
            <span>进入翻译编辑器页面</span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-sm font-bold">2</span>
            <span>在孪生译员工具栏中选择对应的译员</span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-sm font-bold">3</span>
            <span>点击"生成译文建议"按钮</span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-sm font-bold">4</span>
            <span>选择你喜欢的译文版本，直接应用到当前句段</span>
          </li>
        </ol>
      </div>
    </div>

    <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
      <h3 className="text-xl font-bold text-slate-900 mb-4">如何训练孪生译员？</h3>
      <p className="text-slate-600 mb-4">
        训练有两种方式，建议结合使用效果最佳：
      </p>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-blue-50 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
              <Icons.BookOpen className="w-5 h-5" />
            </div>
            <h4 className="font-bold text-slate-900">方式一：边翻边训练</h4>
          </div>
          <p className="text-slate-700 text-sm">
            在翻译编辑器中翻译一个句段后，点击孪生译员工具栏中的"学习此翻译"按钮（📖图标）。
            译员会记录你选择的译文，学习你的翻译风格。
          </p>
        </div>

        <div className="bg-purple-50 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-purple-100 text-purple-600 rounded-lg">
              <Icons.Check className="w-5 h-5" />
            </div>
            <h4 className="font-bold text-slate-900">方式二：通过建议反馈训练</h4>
          </div>
          <p className="text-slate-700 text-sm">
            点击"生成译文建议"后，在建议面板中对喜欢的译文进行好评或采纳。
            这种反馈帮助译员理解你的偏好，优化未来的建议。
          </p>
        </div>
      </div>

      <div className="bg-amber-50 rounded-xl p-5 mt-4 border border-amber-200">
        <div className="flex items-start gap-3">
          <Icons.Lightbulb className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="font-bold text-slate-900 mb-2">训练建议</h4>
            <ul className="space-y-1 text-slate-700 text-sm">
              <li>• 先手动翻译 10-20 个句段，让译员有足够的基础数据</li>
              <li>• 不同领域的翻译风格差异很大，建议按领域创建专用译员</li>
              <li>• 定期查看译员卡片上的"已学习句段"数量，了解学习进度</li>
              <li>• 可以随时重置译员的学习数据，从零开始重新训练</li>
            </ul>
          </div>
        </div>
      </div>
    </div>

    <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
      <h3 className="text-xl font-bold text-slate-900 mb-4">孪生译员学到什么？</h3>
      <p className="text-slate-600 mb-4">
        译员从你的翻译中提取多种风格特征，让你了解自己的翻译习惯：
      </p>
      
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="p-4 bg-slate-50 rounded-lg">
          <div className="font-medium text-slate-900 mb-1">正式程度</div>
          <div className="text-xs text-slate-500">偏正式或口语化（0-100分）</div>
        </div>
        <div className="p-4 bg-slate-50 rounded-lg">
          <div className="font-medium text-slate-900 mb-1">习惯译法</div>
          <div className="text-xs text-slate-500">积累的固定翻译方式</div>
        </div>
        <div className="p-4 bg-slate-50 rounded-lg">
          <div className="font-medium text-slate-900 mb-1">句长偏好</div>
          <div className="text-xs text-slate-500">倾向长句或短句</div>
        </div>
        <div className="p-4 bg-slate-50 rounded-lg">
          <div className="font-medium text-slate-900 mb-1">术语一致性</div>
          <div className="text-xs text-slate-500">保留英文术语的比例</div>
        </div>
        <div className="p-4 bg-slate-50 rounded-lg">
          <div className="font-medium text-slate-900 mb-1">采纳率</div>
          <div className="text-xs text-slate-500">
            采纳次数 ÷ 生成建议次数（每次成功「生成译文建议」计 1 次建议；仅在面板中「应用此译文」计采纳；差评按次数拉低显示比率）
          </div>
        </div>
        <div className="p-4 bg-slate-50 rounded-lg">
          <div className="font-medium text-slate-900 mb-1">置信度</div>
          <div className="text-xs text-slate-500">译员对自己建议的信心</div>
        </div>
      </div>
    </div>

    <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
      <h3 className="text-xl font-bold text-slate-900 mb-4">译文建议的三种风格</h3>
      <div className="space-y-4">
        <div className="flex gap-3 p-4 bg-blue-50 rounded-xl">
          <div className="flex-shrink-0 p-2 bg-white rounded-lg">
            <Icons.User className="w-4 h-4 text-blue-600" />
          </div>
          <div>
            <h4 className="font-semibold text-slate-900 mb-1">用户风格</h4>
            <p className="text-sm text-slate-700">
              基于你的历史翻译风格生成，学习越多越接近你的习惯。这是孪生译员的核心理念。
            </p>
          </div>
        </div>

        <div className="flex gap-3 p-4 bg-slate-50 rounded-xl">
          <div className="flex-shrink-0 p-2 bg-white rounded-lg">
            <Icons.Sparkles className="w-4 h-4 text-slate-600" />
          </div>
          <div>
            <h4 className="font-semibold text-slate-900 mb-1">标准AI翻译</h4>
            <p className="text-sm text-slate-700">
              通用 AI 翻译，不包含特定风格。适合作为基准参考。
            </p>
          </div>
        </div>

        <div className="flex gap-3 p-4 bg-purple-50 rounded-xl">
          <div className="flex-shrink-0 p-2 bg-white rounded-lg">
            <Icons.Magic className="w-4 h-4 text-purple-600" />
          </div>
          <div>
            <h4 className="font-semibold text-slate-900 mb-1">创意表达/保守翻译</h4>
            <p className="text-sm text-slate-700">
              根据不同场景提供更多选择，满足不同翻译需求。
            </p>
          </div>
        </div>
      </div>
    </div>

    <div className="bg-gradient-to-r from-purple-50 to-pink-50 rounded-2xl p-6 border border-purple-200">
      <div className="flex items-start gap-4">
        <div className="p-3 bg-purple-100 text-purple-600 rounded-xl">
          <Icons.Zap className="w-6 h-6" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-900 mb-2">最佳实践建议</h3>
          <ul className="space-y-2 text-slate-700 text-sm">
            <li>• <strong>专译员专用</strong>：技术、法律、营销等不同领域创建不同译员</li>
            <li>• <strong>先练后用</strong>：先翻译 10-20 句让译员学习基本风格</li>
            <li>• <strong>持续反馈</strong>：定期对译文建议进行好评/差评，帮助校准</li>
            <li>• <strong>查看统计</strong>：在孪生译员管理页面查看学习和性能指标</li>
            <li>• <strong>定期重置</strong>：如果译员学偏了，可以重置学习数据重新开始</li>
          </ul>
        </div>
      </div>
    </div>
  </div>
);
