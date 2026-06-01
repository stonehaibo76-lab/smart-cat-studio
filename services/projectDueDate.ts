import { useEffect, useMemo, useState } from 'react';

const MS_MIN = 60_000;
const MS_H = 3_600_000;
const MS_D = 86_400_000;

/** 读取项目中的交稿字段（新字段优先，兼容旧版仅日期） */
export function getProjectDeliveryDueRaw(p: {
  deliveryDueAt?: string;
  deliveryDueDate?: string;
}): string | undefined {
  const a = p.deliveryDueAt?.trim();
  if (a) return a;
  const d = p.deliveryDueDate?.trim();
  return d || undefined;
}

/**
 * 解析交稿截止时间（本地时区）。
 * - `YYYY-MM-DDTHH:mm`：datetime-local
 * - `YYYY-MM-DD`：兼容旧版，视为当日 23:59:59.999
 */
export function parseDeliveryDeadline(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) {
    const [datePart, timePart] = s.split('T');
    const [y, m, d] = datePart.split('-').map(Number);
    const [hh, mm] = timePart.split(':').map(Number);
    if (!y || m < 1 || m > 12 || d < 1 || d > 31 || hh > 23 || mm > 59) return null;
    const dt = new Date(y, m - 1, d, hh, mm, 0, 0);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
    return dt;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
    const dt = new Date(y, m - 1, d, 23, 59, 59, 999);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
    return dt;
  }

  return null;
}

export function formatDeadlineLabel(deadline: Date): string {
  const y = deadline.getFullYear();
  const m = String(deadline.getMonth() + 1).padStart(2, '0');
  const d = String(deadline.getDate()).padStart(2, '0');
  const hh = String(deadline.getHours()).padStart(2, '0');
  const mm = String(deadline.getMinutes()).padStart(2, '0');
  return `${y}/${m}/${d} ${hh}:${mm}`;
}

/** 将已存字符串转为 `<input type="datetime-local" />` 的 value；无效则 `''` */
export function toDatetimeLocalValue(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T23:59`;
  return '';
}

/** 剩余时间文案：≤1h 用分钟；≤24h 用小时；更长用天 */
function formatRemainShort(msLeft: number): string {
  if (msLeft <= 0) return '';
  if (msLeft < MS_H) {
    return `剩余约 ${Math.max(1, Math.ceil(msLeft / MS_MIN))} 分钟`;
  }
  if (msLeft <= 24 * MS_H) {
    return `剩余约 ${Math.ceil(msLeft / MS_H)} 小时`;
  }
  return `剩余约 ${Math.ceil(msLeft / MS_D)} 天`;
}

export type DeliveryDueReminder =
  | { kind: 'overdue'; message: string }
  /** ≤1 小时：红色 */
  | { kind: 'criticalRed'; message: string }
  /** (1h, 2h]：橙色 */
  | { kind: 'criticalOrange'; message: string }
  /** (2h, 24h] */
  | { kind: 'withinDay'; message: string }
  /** (24h, 72h]，琥珀色 */
  | { kind: 'urgent'; message: string }
  /** (72h, 7d] */
  | { kind: 'soon'; message: string };

export type DeliveryDueReminderOptions = {
  /** 为 true 时不显示任何交稿提醒 */
  projectCompleted?: boolean;
  /** 为 false 时不显示（项目设置中关闭预警）；未传或 true 则照常计算 */
  reminderEnabled?: boolean;
};

export function getProjectDeliveryDueReminder(
  raw: string | undefined,
  opts?: DeliveryDueReminderOptions
): DeliveryDueReminder | null {
  if (opts?.projectCompleted) return null;
  if (opts?.reminderEnabled === false) return null;
  if (!raw?.trim()) return null;
  const deadline = parseDeliveryDeadline(raw);
  if (!deadline) return null;

  const label = formatDeadlineLabel(deadline);
  const now = Date.now();
  const msLeft = deadline.getTime() - now;

  const imminent = (detail: string) => `即将截止：${detail}（截止 ${label}）`;

  if (msLeft < 0) {
    const overdueMs = -msLeft;
    let desc: string;
    if (overdueMs < MS_H) {
      desc = `已超过截止约 ${Math.max(1, Math.ceil(overdueMs / MS_MIN))} 分钟`;
    } else if (overdueMs < MS_D) {
      desc = `已超过截止约 ${Math.ceil(overdueMs / MS_H)} 小时`;
    } else {
      desc = `已超过截止约 ${Math.ceil(overdueMs / MS_D)} 天`;
    }
    return { kind: 'overdue', message: `${desc}（原定 ${label}）` };
  }

  if (msLeft <= MS_H) {
    return { kind: 'criticalRed', message: imminent(formatRemainShort(msLeft)) };
  }

  if (msLeft <= 2 * MS_H) {
    return { kind: 'criticalOrange', message: imminent(formatRemainShort(msLeft)) };
  }

  if (msLeft <= 24 * MS_H) {
    return {
      kind: 'withinDay',
      message: `交稿提醒：${formatRemainShort(msLeft)}（截止 ${label}）`,
    };
  }

  if (msLeft <= 3 * MS_D) {
    const detail =
      msLeft <= 48 * MS_H
        ? `约 ${Math.ceil(msLeft / MS_H)} 小时`
        : `约 ${Math.ceil(msLeft / MS_D)} 天`;
    return {
      kind: 'urgent',
      message: `交稿临近：${detail}（截止 ${label}）`,
    };
  }

  if (msLeft <= 7 * MS_D) {
    return {
      kind: 'soon',
      message: `交稿提醒：距离截止还有 ${Math.ceil(msLeft / MS_D)} 天（${label}）`,
    };
  }

  return null;
}

/** @deprecated 使用 getProjectDeliveryDueReminder；不支持「项目已完成」选项 */
export function getProjectDueDateReminder(raw?: string): DeliveryDueReminder | null {
  return getProjectDeliveryDueReminder(raw);
}

/** 根据剩余时间选择下一次刷新间隔（用于横幅倒计时实时更新） */
function deliveryDueReminderTickDelayMs(deadline: Date, nowMs: number): number {
  const msLeft = deadline.getTime() - nowMs;
  if (msLeft < 0) return MS_MIN;
  if (msLeft > 7 * MS_D) return Math.min(msLeft - 7 * MS_D, MS_D);
  if (msLeft <= MS_H) return 10_000;
  if (msLeft <= 24 * MS_H) return 30_000;
  return MS_MIN;
}

/**
 * 交稿截止横幅提醒（随当前时间自动刷新，无需整页重载）。
 */
export function useProjectDeliveryDueReminder(
  raw: string | undefined,
  opts?: DeliveryDueReminderOptions
): DeliveryDueReminder | null {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (opts?.projectCompleted || opts?.reminderEnabled === false || !raw?.trim()) {
      return;
    }
    const deadline = parseDeliveryDeadline(raw);
    if (!deadline) return;

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const scheduleNext = () => {
      if (cancelled) return;
      const delay = deliveryDueReminderTickDelayMs(deadline, Date.now());
      timeoutId = window.setTimeout(() => {
        setTick((n) => n + 1);
        scheduleNext();
      }, delay);
    };

    scheduleNext();
    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [raw, opts?.projectCompleted, opts?.reminderEnabled]);

  return useMemo(
    () => getProjectDeliveryDueReminder(raw, opts),
    [raw, opts?.projectCompleted, opts?.reminderEnabled, tick]
  );
}
