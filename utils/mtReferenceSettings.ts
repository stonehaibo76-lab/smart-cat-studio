import {
  DEFAULT_MT_COMPARE_TRANSLATORS,
  MT_COMPARE_MAX,
  MT_TRANSLATOR_CATALOG_V1,
  MT_TRANSLATOR_CATALOG_V2,
  MT_TRANSLATOR_CATALOG_VERSION,
  MT_TRANSLATOR_IDS,
  MT_TRANSLATOR_OPTIONS,
} from '../constants';
import type { MtReferenceSettings } from '../types';

const CATALOGS: Record<number, readonly string[]> = {
  1: MT_TRANSLATOR_CATALOG_V1,
  2: MT_TRANSLATOR_CATALOG_V2,
  3: MT_TRANSLATOR_IDS,
};

/** 合并目录升级；v3 起仅保留经筛选的 17 个引擎 */
export function normalizeMtReferenceSettings(settings: MtReferenceSettings): MtReferenceSettings {
  const allIds = MT_TRANSLATOR_IDS;
  const version = settings.engineCatalogVersion ?? 1;
  let enabled = new Set(settings.enabledTranslators.filter((id) => allIds.includes(id)));

  if (version !== MT_TRANSLATOR_CATALOG_VERSION) {
    if (MT_TRANSLATOR_CATALOG_VERSION === 3 && version < 3) {
      const kept = settings.enabledTranslators.filter((id) => allIds.includes(id));
      enabled = new Set(kept.length > 0 ? kept : allIds);
    } else {
      const previousIds = CATALOGS[version] ?? CATALOGS[1];
      for (const id of allIds) {
        if (!previousIds.includes(id)) {
          enabled.add(id);
        }
      }
    }
  }

  if (enabled.size === 0) {
    for (const id of allIds) enabled.add(id);
  }

  let defaultTranslator = settings.defaultTranslator;
  if (!allIds.includes(defaultTranslator)) {
    defaultTranslator = 'youdao';
  }
  if (!enabled.has(defaultTranslator)) {
    defaultTranslator = allIds.find((id) => enabled.has(id)) ?? 'youdao';
  }

  let compareTranslators = (settings.compareTranslators ?? DEFAULT_MT_COMPARE_TRANSLATORS).filter((id) =>
    allIds.includes(id)
  );
  compareTranslators = compareTranslators.filter((id) => enabled.has(id));
  if (compareTranslators.length === 0) {
    compareTranslators = DEFAULT_MT_COMPARE_TRANSLATORS.filter((id) => enabled.has(id));
  }
  if (compareTranslators.length === 0) {
    compareTranslators = [defaultTranslator];
  }
  compareTranslators = compareTranslators.slice(0, MT_COMPARE_MAX);

  return {
    ...settings,
    enabledTranslators: MT_TRANSLATOR_OPTIONS.filter((o) => enabled.has(o.id)).map((o) => o.id),
    defaultTranslator,
    compareMode: settings.compareMode ?? false,
    compareTranslators,
    engineCatalogVersion: MT_TRANSLATOR_CATALOG_VERSION,
    disableStartupPreaccelerate: settings.disableStartupPreaccelerate ?? false,
  };
}
