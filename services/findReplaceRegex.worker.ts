/// <reference lib="webworker" />
import { applyRegexReplacementTemplate } from './regexDictionaryService';

export type RegexWorkerInbound =
  | { id: number; kind: 'test'; text: string; pattern: string }
  | { id: number; kind: 'replace'; text: string; pattern: string; replaceWith: string };

type RegexWorkerOutbound =
  | { id: number; ok: true; result: boolean | string }
  | { id: number; ok: false; error: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<RegexWorkerInbound>) => {
  const msg = e.data;
  const reply = (payload: RegexWorkerOutbound) => ctx.postMessage(payload);

  try {
    if (msg.kind === 'test') {
      const re = new RegExp(msg.pattern, 'g');
      reply({ id: msg.id, ok: true, result: re.test(msg.text) });
      return;
    }
    const re = new RegExp(msg.pattern, 'g');
    const out = msg.text.replace(re, (...args) => {
      const match = args[0] as string;
      const groups = args.slice(1, -2) as string[];
      const arr = [match, ...groups] as unknown as RegExpMatchArray;
      return applyRegexReplacementTemplate(msg.replaceWith, arr);
    });
    reply({ id: msg.id, ok: true, result: out });
  } catch (err) {
    reply({
      id: msg.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
