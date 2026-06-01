import type { PerformanceSettings } from '../types';
import { setAiMaxConcurrent } from './aiConcurrency';

export const DEFAULT_PERFORMANCE_SETTINGS: PerformanceSettings = {
  performanceMode: false,
  lazyLoadHeavyCollections: false,
};

let reduceVisualEffects = false;

export function coercePerformanceSettings(raw: unknown): PerformanceSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_PERFORMANCE_SETTINGS };
  }
  const o = raw as Record<string, unknown>;
  return {
    performanceMode: o.performanceMode === true,
    lazyLoadHeavyCollections: o.lazyLoadHeavyCollections === true,
  };
}

/** 在 App 内 settings 变更或初始化时调用 */
export function applyPerformanceSettings(s: PerformanceSettings): void {
  reduceVisualEffects = s.performanceMode;
  setAiMaxConcurrent(s.performanceMode ? 1 : 2);
}

export function getReduceVisualEffects(): boolean {
  return reduceVisualEffects;
}
