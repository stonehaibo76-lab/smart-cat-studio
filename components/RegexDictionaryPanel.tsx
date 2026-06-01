import React, { useMemo, useRef, useState } from 'react';
import type { RegexDictEntry, RegexDictionaryBook } from '../types';
import { Icons } from './ui/Icons';
import * as XLSX from 'xlsx';
import { clampRegexPriority, isValidRegexPattern } from '../services/regexDictionaryService';

const newEntryId = () => `rxe-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

interface RegexDictionaryPanelProps {
  books: RegexDictionaryBook[];
  selectedBookId: string;
  onChange: (books: RegexDictionaryBook[]) => void;
}

export const RegexDictionaryPanel: React.FC<RegexDictionaryPanelProps> = ({
  books,
  selectedBookId,
  onChange,
}) => {
  const book = books.find((b) => b.id === selectedBookId);
  const importRef = useRef<HTMLInputElement>(null);

  const [entryModal, setEntryModal] = useState<{
    mode: 'add' | 'edit';
    entry: RegexDictEntry;
  } | null>(null);

  const sortedEntries = useMemo(() => {
    if (!book) return [];
    return [...book.entries].sort((a, b) => clampRegexPriority(b.priority) - clampRegexPriority(a.priority));
  }, [book]);

  const invalidEntryIds = useMemo(() => {
    if (!book) return new Set<string>();
    const bad = new Set<string>();
    for (const e of book.entries) {
      if (!e.sourcePattern.trim() || !e.targetTemplate.trim()) bad.add(e.id);
      else if (!isValidRegexPattern(e.sourcePattern)) bad.add(e.id);
    }
    return bad;
  }, [book]);

  const updateBook = (bookId: string, patch: Partial<RegexDictionaryBook>) => {
    onChange(books.map((b) => (b.id === bookId ? { ...b, ...patch } : b)));
  };

  const saveEntry = () => {
    if (!entryModal || !book) return;
    const { mode, entry } = entryModal;
    if (!entry.sourcePattern.trim() || !entry.targetTemplate.trim()) {
      alert('请填写正则与译文模板');
      return;
    }
    if (!isValidRegexPattern(entry.sourcePattern)) {
      alert('正则表达式无效，请检查语法');
      return;
    }
    const next = { ...entry, priority: clampRegexPriority(entry.priority ?? 0) };
    const list =
      mode === 'add'
        ? [...book.entries, { ...next, id: next.id || newEntryId() }]
        : book.entries.map((x) => (x.id === next.id ? next : x));
    updateBook(book.id, { entries: list });
    setEntryModal(null);
  };

  const deleteEntry = (id: string) => {
    if (!book) return;
    if (!confirm('删除此条目？')) return;
    updateBook(book.id, {
      entries: book.entries.filter((e) => e.id !== id),
    });
  };

  const exportBook = () => {
    if (!book) return;
    const header = ['原文(正则)', '译文模板', '类别', '优先级', '备注'];
    const rows = sortedEntries.map((e) => [
      e.sourcePattern,
      e.targetTemplate,
      e.category ?? '',
      clampRegexPriority(e.priority ?? 0),
      e.name ?? '',
    ]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '正则表达式');
    XLSX.writeFile(wb, `${book.name.replace(/[/\\?%*:|"<>]/g, '-')}_正则表达式词典.xlsx`);
  };

  const parseImport = (file: File) => {
    if (!book) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = new Uint8Array(reader.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
        const entries: RegexDictEntry[] = [];
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i] as unknown[];
          const a = row[0]?.toString() ?? '';
          const b = row[1]?.toString() ?? '';
          const pat = a.trim();
          const tpl = b.trim();
          if (!pat || !tpl) continue;
          if (i === 0 && (pat.includes('正则') || pat.toLowerCase().includes('regex'))) continue;
          const c = row[2]?.toString().trim() ?? '';
          const d = row[3];
          const eNote = row[4]?.toString().trim() ?? '';
          let pri = 0;
          if (typeof d === 'number' && !Number.isNaN(d)) pri = d;
          else pri = parseInt(String(d ?? '0'), 10) || 0;
          entries.push({
            id: newEntryId(),
            sourcePattern: pat,
            targetTemplate: tpl,
            category: c || undefined,
            name: eNote || undefined,
            priority: clampRegexPriority(pri),
            enabled: true,
          });
        }
        if (!confirm(`将用文件中的 ${entries.length} 条记录替换当前词典全部条目，确定吗？`)) return;
        updateBook(book.id, { entries });
      } catch {
        alert('导入失败');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  if (!book) {
    return (
      <div className="flex flex-1 items-center justify-center text-slate-400 text-sm">
        请选择或创建一个正则表达式词典
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col min-w-0 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={book.enabled !== false}
              onChange={(e) => updateBook(book.id, { enabled: e.target.checked })}
              className="rounded border-slate-300"
            />
            启用本词典
          </label>
          <span className="text-xs text-slate-500">
            {book.sourceLang} → {book.targetLang} · {book.entries.length} 条 · 建议总数小于 1000 以保证性能
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              setEntryModal({
                mode: 'add',
                entry: {
                  id: newEntryId(),
                  sourcePattern: '',
                  targetTemplate: '',
                  category: '',
                  name: '',
                  priority: 10,
                  enabled: true,
                },
              })
            }
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700"
          >
            <Icons.Plus className="h-4 w-4" />
            添加条目
          </button>
          <button
            type="button"
            onClick={exportBook}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Icons.Download className="h-4 w-4" />
            导出 Excel
          </button>
          <button
            type="button"
            onClick={() => importRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Icons.Upload className="h-4 w-4" />
            导入 Excel
          </button>
          <input
            ref={importRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) parseImport(f);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      <div className="space-y-2 text-xs leading-relaxed text-slate-600 rounded-lg bg-violet-50/80 border border-violet-100 px-3 py-2">
        <p>
          <strong className="text-violet-950">译文模板：</strong>
          <code className="text-violet-900">$1</code> <code className="text-violet-900">$2</code>… 表示正则里第几个括号捕获组；{' '}
          <code className="text-violet-900">$0</code> 或 <code className="text-violet-900">{'$&'}</code> 表示整段匹配；{' '}
          <code className="text-violet-900">$$</code> 表示字面量 <code className="text-violet-900">$</code>。
        </p>
        <p>
          <strong className="text-violet-950">类别：</strong>
          填写后可在<strong>规则词典</strong>雪人式句式中用 <code className="text-violet-900">{'{类别名}'}</code> 引用；本词典按该正则匹配并替换后的字符串会填入规则译文中的{' '}
          <code className="text-violet-900">@1</code>、<code className="text-violet-900">@2</code>… <strong>类别留空</strong>时，条目仅在句段翻译前对句段全文按优先级做替换（适合日期等），优先级高于规则词典匹配。
        </p>
      </div>

      <div className="flex-1 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2 w-14">优先级</th>
              <th className="px-4 py-2">正则</th>
              <th className="px-4 py-2">译文模板</th>
              <th className="px-4 py-2 w-24">类别</th>
              <th className="px-4 py-2 w-24">标记</th>
              <th className="px-4 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sortedEntries.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                  暂无条目。示例：正则 <code className="text-slate-600">([\d]+).([\d]+).([\d]+)</code>，译文{' '}
                  <code className="text-slate-600">$3年$2月$1日</code>
                </td>
              </tr>
            ) : (
              sortedEntries.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50/80">
                  <td className="px-4 py-2 align-top text-slate-400">{clampRegexPriority(e.priority ?? 0)}</td>
                  <td
                    className={`px-4 py-2 align-top font-mono text-xs break-all ${
                      invalidEntryIds.has(e.id) ? 'text-red-600' : 'text-slate-800'
                    }`}
                  >
                    {e.sourcePattern}
                  </td>
                  <td className="px-4 py-2 align-top font-mono text-xs text-slate-700 break-all">{e.targetTemplate}</td>
                  <td className="px-4 py-2 align-top text-xs text-slate-700">{e.category?.trim() || '—'}</td>
                  <td className="px-4 py-2 align-top text-xs">
                    {e.enabled === false ? <span className="text-slate-400">停</span> : null}
                  </td>
                  <td className="px-4 py-2 align-top text-right whitespace-nowrap">
                    <button
                      type="button"
                      className="p-1.5 text-slate-400 hover:text-violet-600"
                      onClick={() => setEntryModal({ mode: 'edit', entry: { ...e } })}
                      title="编辑"
                    >
                      <Icons.Edit className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="p-1.5 text-slate-400 hover:text-red-600"
                      onClick={() => deleteEntry(e.id)}
                      title="删除"
                    >
                      <Icons.Trash className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {entryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="mb-4 text-lg font-bold text-slate-900">
              {entryModal.mode === 'add' ? '添加正则条目' : '编辑正则条目'}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-bold uppercase text-slate-500">备注</label>
                <input
                  className="w-full rounded border border-slate-300 p-2 text-sm"
                  value={entryModal.entry.name ?? ''}
                  onChange={(e) =>
                    setEntryModal({ ...entryModal, entry: { ...entryModal.entry, name: e.target.value } })
                  }
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase text-slate-500">类别（可选，供规则词典 {'{类别}'} 引用）</label>
                <input
                  className="w-full rounded border border-slate-300 p-2 text-sm"
                  value={entryModal.entry.category ?? ''}
                  onChange={(e) =>
                    setEntryModal({ ...entryModal, entry: { ...entryModal.entry, category: e.target.value } })
                  }
                  placeholder="如：金额"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase text-slate-500">优先级（0–20）</label>
                <input
                  type="number"
                  min={0}
                  max={20}
                  className="w-full rounded border border-slate-300 p-2 text-sm"
                  value={entryModal.entry.priority ?? 0}
                  onChange={(e) =>
                    setEntryModal({
                      ...entryModal,
                      entry: {
                        ...entryModal.entry,
                        priority: clampRegexPriority(Number(e.target.value) || 0),
                      },
                    })
                  }
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={entryModal.entry.enabled !== false}
                  onChange={(e) =>
                    setEntryModal({
                      ...entryModal,
                      entry: { ...entryModal.entry, enabled: e.target.checked },
                    })
                  }
                />
                启用
              </label>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase text-slate-500">原文（正则）</label>
                <textarea
                  className="min-h-[80px] w-full rounded border border-slate-300 p-2 font-mono text-xs"
                  value={entryModal.entry.sourcePattern}
                  onChange={(e) =>
                    setEntryModal({ ...entryModal, entry: { ...entryModal.entry, sourcePattern: e.target.value } })
                  }
                  placeholder={'\\bwas born in ([0-9]+)'}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase text-slate-500">译文模板</label>
                <textarea
                  className="min-h-[72px] w-full rounded border border-slate-300 p-2 font-mono text-xs"
                  value={entryModal.entry.targetTemplate}
                  onChange={(e) =>
                    setEntryModal({ ...entryModal, entry: { ...entryModal.entry, targetTemplate: e.target.value } })
                  }
                  placeholder="生于$1年"
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
                onClick={() => setEntryModal(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
                onClick={saveEntry}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export function createEmptyRegexDictionaryBook(
  name: string,
  sourceLang: string,
  targetLang: string
): RegexDictionaryBook {
  return {
    id: `rx-${Date.now()}`,
    name: name.trim() || '未命名正则词典',
    sourceLang,
    targetLang,
    entries: [],
    enabled: true,
    createdAt: new Date().toISOString().split('T')[0],
  };
}
