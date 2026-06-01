import React from 'react';
import { Icons } from '../components/ui/Icons';
import { APP_DISPLAY_VERSION } from '../constants';
import type { Project } from '../types';

export type HomeLaunchTarget =
  | 'dashboard'
  | 'resources'
  | 'twintranslators'
  | 'knowledge'
  | 'settings'
  | 'help'
  | 'dictionary';

export interface HomePageProps {
  projects: Project[];
  onNavigate: (page: HomeLaunchTarget) => void;
  onOpenProject: (id: string) => void;
}

const MODULES: Array<{
  id: HomeLaunchTarget;
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  accent: string;
}> = [
  {
    id: 'dashboard',
    label: '项目管理',
    desc: '新建、导入与管理翻译项目',
    icon: Icons.Dashboard,
    accent: 'from-blue-500 to-blue-600',
  },
  {
    id: 'resources',
    label: '语言资源',
    desc: '术语库、记忆库与规则词典',
    icon: Icons.Database,
    accent: 'from-emerald-500 to-teal-600',
  },
  {
    id: 'twintranslators',
    label: '孪生译员',
    desc: '个性化 AI 译员与示例训练',
    icon: Icons.User,
    accent: 'from-violet-500 to-purple-600',
  },
  {
    id: 'knowledge',
    label: '知识库',
    desc: 'RAG 文档与向量检索辅助',
    icon: Icons.Sparkles,
    accent: 'from-amber-500 to-orange-600',
  },
  {
    id: 'dictionary',
    label: '在线词典',
    desc: '收藏站点与自定义词典入口',
    icon: Icons.Globe,
    accent: 'from-cyan-500 to-sky-600',
  },
  {
    id: 'settings',
    label: '系统设置',
    desc: 'AI、性能与本地数据配置',
    icon: Icons.Settings,
    accent: 'from-slate-600 to-slate-700',
  },
  {
    id: 'help',
    label: '使用帮助',
    desc: '功能说明与推荐工作流程',
    icon: Icons.HelpCircle,
    accent: 'from-indigo-500 to-indigo-600',
  },
];

export const HomePage: React.FC<HomePageProps> = ({ projects, onNavigate, onOpenProject }) => {
  const recent = [...projects]
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, 4);

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-b from-slate-50 to-white px-6 py-8 sm:px-10">
      <div className="mx-auto max-w-5xl">
        <header className="mb-10">
          <p className="text-sm font-medium text-blue-600">Smart-CAT Studio · {APP_DISPLAY_VERSION}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">工作台</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            从下方选择要进入的功能模块。需要继续翻译时，可在「最近项目」中直接打开，或前往项目管理。
          </p>
        </header>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m) => {
            const Icon = m.icon;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onNavigate(m.id)}
                className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-blue-200 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              >
                <div
                  className={`mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${m.accent} text-white shadow-sm`}
                >
                  <Icon className="h-5 w-5" strokeWidth={1.75} />
                </div>
                <span className="text-base font-semibold text-slate-900 group-hover:text-blue-700">{m.label}</span>
                <span className="mt-1 text-sm leading-relaxed text-slate-500">{m.desc}</span>
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-blue-600 opacity-0 transition group-hover:opacity-100">
                  进入
                  <Icons.ChevronRight className="h-3.5 w-3.5" />
                </span>
              </button>
            );
          })}
        </div>

        {recent.length > 0 && (
          <section className="mt-12">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500">最近项目</h2>
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              {recent.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onOpenProject(p.id)}
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-slate-50 focus:outline-none focus-visible:bg-blue-50/80"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">{p.name}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {p.files?.length ?? 0} 个文件 · 进度 {Math.round(p.progress ?? 0)}%
                      </p>
                    </div>
                    <Icons.ChevronRight className="h-5 w-5 shrink-0 text-slate-400" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
};
