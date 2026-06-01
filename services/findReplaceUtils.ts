/** 正则在线程中运行；超时则终止 Worker，避免 ReDoS 卡死主线程 */
const REGEX_WORKER_TIMEOUT_MS = 12_000;

let regexWorker: Worker | null = null;
let regexWorkerListenerAttached = false;
let reqSeq = 1;
const pendingRegexJobs = new Map<
  number,
  { resolve: (v: boolean | string) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
>();

function terminateRegexWorker() {
  if (regexWorker) {
    regexWorker.terminate();
    regexWorker = null;
    regexWorkerListenerAttached = false;
  }
}

function ensureRegexWorker(): Worker {
  if (!regexWorker) {
    regexWorker = new Worker(new URL('./findReplaceRegex.worker.ts', import.meta.url), { type: 'module' });
  }
  if (!regexWorkerListenerAttached) {
    regexWorkerListenerAttached = true;
    regexWorker.addEventListener(
      'message',
      (ev: MessageEvent<{ id: number; ok: boolean; result?: boolean | string; error?: string }>) => {
        const { id, ok, result, error } = ev.data;
        const job = pendingRegexJobs.get(id);
        if (!job) return;
        pendingRegexJobs.delete(id);
        clearTimeout(job.timer);
        if (ok && (typeof result === 'boolean' || typeof result === 'string')) {
          job.resolve(result);
        } else {
          job.reject(new Error(error || '正则处理失败'));
        }
      }
    );
    regexWorker.addEventListener('error', () => {
      terminateRegexWorker();
      for (const [, job] of pendingRegexJobs) {
        clearTimeout(job.timer);
        job.reject(new Error('正则 Worker 异常'));
      }
      pendingRegexJobs.clear();
    });
  }
  return regexWorker;
}

function runRegexWorkerTest(text: string, pattern: string): Promise<boolean> {
  const w = ensureRegexWorker();
  const id = reqSeq++;
  return new Promise<boolean>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRegexJobs.delete(id);
      terminateRegexWorker();
      reject(
        new Error(
          '正则运算超时，可能是灾难性回溯（ReDoS）。请简化表达式或缩小查找范围。'
        )
      );
    }, REGEX_WORKER_TIMEOUT_MS);
    pendingRegexJobs.set(id, {
      resolve: (v) => resolve(Boolean(v)),
      reject,
      timer,
    });
    w.postMessage({ id, kind: 'test', text, pattern });
  });
}

function runRegexWorkerReplace(text: string, pattern: string, replaceWith: string): Promise<string> {
  const w = ensureRegexWorker();
  const id = reqSeq++;
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRegexJobs.delete(id);
      terminateRegexWorker();
      reject(
        new Error(
          '正则替换超时，可能是灾难性回溯（ReDoS）。请简化表达式或缩小替换范围。'
        )
      );
    }, REGEX_WORKER_TIMEOUT_MS);
    pendingRegexJobs.set(id, {
      resolve: (v) => resolve(typeof v === 'string' ? v : String(v)),
      reject,
      timer,
    });
    w.postMessage({ id, kind: 'replace', text, pattern, replaceWith });
  });
}

/** 校验查找框中的正则是否合法（不抛错） */
export function validateFindRegex(pattern: string): string | null {
  if (!pattern.trim()) return null;
  try {
    new RegExp(pattern);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** 查找匹配；正则模式在 Worker 中执行并带超时 */
export async function segmentContainsFind(
  text: string,
  findPattern: string,
  useRegex: boolean
): Promise<boolean> {
  if (!findPattern) return false;
  if (!useRegex) return text.includes(findPattern);
  return runRegexWorkerTest(text, findPattern);
}

/**
 * 在一段文本中执行查找替换。
 * 非正则：字面量全文替换（与 String.split/join 一致）。
 * 正则：全局替换；替换串支持 $1、$2、$&、$0、$$（与正则词典一致）。
 */
export async function applyFindReplaceInText(
  original: string,
  findPattern: string,
  replaceWith: string,
  useRegex: boolean
): Promise<string> {
  if (!findPattern) return original;
  if (!useRegex) {
    return original.split(findPattern).join(replaceWith);
  }
  return runRegexWorkerReplace(original, findPattern, replaceWith);
}
