/**
 * 限制同时进行的上游 AI / embedding HTTP 请求数量，避免低配机内存与主线程压力过大。
 */
let maxConcurrent = 2;
let active = 0;
const waiters: Array<() => void> = [];

export function setAiMaxConcurrent(n: number): void {
  maxConcurrent = Math.max(1, Math.min(8, Math.floor(Number(n)) || 2));
}

export function getAiMaxConcurrent(): number {
  return maxConcurrent;
}

async function acquire(): Promise<() => void> {
  while (active >= maxConcurrent) {
    await new Promise<void>((resolve) => {
      waiters.push(resolve);
    });
  }
  active++;
  return () => {
    active--;
    waiters.shift()?.();
  };
}

export async function withAiConcurrency<T>(fn: () => Promise<T>): Promise<T> {
  const release = await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}
