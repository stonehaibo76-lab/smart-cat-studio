import React, { useEffect, useState } from 'react';
import { Icons } from './ui/Icons';
import { APP_DISPLAY_VERSION } from '../constants';
import type { HomeLaunchTarget } from '../pages/Home';

export type WelcomeLaunchTarget = HomeLaunchTarget | 'home';

export interface WelcomeScreenProps {
  projectCount: number;
  isDataReady: boolean;
  onLaunch: (target: WelcomeLaunchTarget, skipNextStartup: boolean) => void;
}

const LAUNCH_MODULES: Array<{
  id: WelcomeLaunchTarget;
  label: string;
  short: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  accent: string;
}> = [
  { id: 'home', label: '工作台', short: '功能总览与最近项目', icon: Icons.Home, accent: 'bg-blue-600' },
  { id: 'dashboard', label: '项目管理', short: '新建与导入项目', icon: Icons.File, accent: 'bg-sky-600' },
  { id: 'resources', label: '语言资源', short: '术语库与记忆库', icon: Icons.Database, accent: 'bg-emerald-600' },
  { id: 'help', label: '使用帮助', short: '了解推荐流程', icon: Icons.HelpCircle, accent: 'bg-indigo-600' },
];

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  projectCount,
  isDataReady,
  onLaunch,
}) => {
  const [skipNextStartup, setSkipNextStartup] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isDataReady) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        onLaunch('home', skipNextStartup);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDataReady, onLaunch, skipNextStartup]);

  const handlePrimaryEnter = () => onLaunch('home', skipNextStartup);

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-y-auto bg-gradient-to-br from-slate-50 via-sky-50/80 to-indigo-50 px-6 py-10 text-slate-800">
      <div
        className="pointer-events-none absolute inset-0 opacity-90"
        style={{
          backgroundImage:
            'radial-gradient(circle at 18% 22%, rgba(59, 130, 246, 0.12), transparent 42%), radial-gradient(circle at 82% 58%, rgba(99, 102, 241, 0.1), transparent 38%), radial-gradient(circle at 50% 88%, rgba(14, 165, 233, 0.08), transparent 35%)',
        }}
      />

      <div className="relative z-10 w-full max-w-2xl rounded-3xl border border-slate-200/90 bg-white/95 p-8 shadow-xl shadow-slate-200/60 backdrop-blur-sm sm:p-10">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/25">
            <Icons.Sparkles className="h-9 w-9 text-white" strokeWidth={1.75} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Smart-CAT Studio</h1>
          <p className="mt-2 text-sm text-slate-600">计算机辅助翻译工作台 · 版本 {APP_DISPLAY_VERSION}</p>
          {!isDataReady ? (
            <p className="mt-4 flex items-center justify-center gap-2 text-sm text-blue-600">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
              正在加载本地数据…
            </p>
          ) : (
            <p className="mt-3 text-xs text-slate-500">
              已就绪 · {projectCount} 个项目 · 请选择要进入的功能
            </p>
          )}
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {LAUNCH_MODULES.map((m) => {
            const Icon = m.icon;
            return (
              <button
                key={m.id}
                type="button"
                disabled={!isDataReady}
                onClick={() => onLaunch(m.id, skipNextStartup)}
                className="flex flex-col items-center rounded-2xl border border-slate-200 bg-slate-50/80 px-3 py-4 text-center transition hover:border-blue-300 hover:bg-white hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span
                  className={`mb-2 flex h-10 w-10 items-center justify-center rounded-xl text-white ${m.accent}`}
                >
                  <Icon className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <span className="text-sm font-semibold text-slate-900">{m.label}</span>
                <span className="mt-1 text-[11px] leading-snug text-slate-500">{m.short}</span>
              </button>
            );
          })}
        </div>

        <ul className="mb-6 space-y-2.5 text-sm text-slate-600">
          <li className="flex gap-2">
            <Icons.Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" strokeWidth={2.5} />
            <span>数据保存在本机 SQLite，可随时在系统设置中查看库路径与容量。</span>
          </li>
          <li className="flex gap-2">
            <Icons.Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
            <span>首次使用建议先打开「使用帮助」，或从「项目管理」导入/新建项目。</span>
          </li>
        </ul>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={skipNextStartup}
              onChange={(e) => setSkipNextStartup(e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            下次启动不再显示此页
          </label>
          <button
            type="button"
            disabled={!isDataReady}
            onClick={handlePrimaryEnter}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3.5 text-sm font-semibold text-white shadow-md shadow-blue-600/20 transition hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            进入工作台
            <Icons.ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-4 text-center text-xs text-slate-500">数据加载完成后可按 Enter 进入工作台</p>
      </div>

      <p className="relative z-10 mt-8 text-center text-xs text-slate-500">作者 Sunny · 祝翻译顺利</p>
    </div>
  );
};
