import { isAuthRequired } from './authService';

/** 云端 SaaS 部署（API 非 localhost 且需登录） */
export function isCloudDeployment(): boolean {
  return isAuthRequired();
}

/** MT 参考（translators sidecar）仅本地/便携版可用；云端无内置侧车 */
export function isMtReferenceSupported(): boolean {
  return !isCloudDeployment();
}

export function dataStorageLabel(): string {
  return isCloudDeployment() ? '云端数据库' : '本地 SQLite';
}

export function savedToDatabaseMessage(): string {
  return isCloudDeployment() ? '已保存到云端。' : '已保存到本地数据库。';
}

export function saveSettingsHint(collection: string): string {
  const target = isCloudDeployment() ? '云端数据库' : '本地 SQLite';
  return `编辑后请点击「保存到数据库」写入${target}（settings_kv · ${collection}）。`;
}
