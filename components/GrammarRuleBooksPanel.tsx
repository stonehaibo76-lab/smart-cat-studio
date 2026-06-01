import React, { useMemo, useRef, useState } from 'react';
import type { GrammarCategoryEntry, GrammarRule, GrammarRuleBook, RegexDictionaryBook } from '../types';
import { Icons } from './ui/Icons';
import * as XLSX from 'xlsx';
import { grammarRulePairLooksValid } from '../services/grammarRuleService';
import { buildRegexCategoryMap } from '../services/regexDictionaryService';

const newRuleId = () => `grr-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const newCatId = () => `gce-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

function clampPri(p: number): number {
  const n = Number.isFinite(p) ? Math.round(p) : 0;
  return Math.max(0, Math.min(20, n));
}

interface GrammarRuleBooksPanelProps {
  books: GrammarRuleBook[];
  selectedBookId: string;
  onChange: (books: GrammarRuleBook[]) => void;
  /** 用于校验规则中 {类别} 是否与正则词典类别呼应 */
  regexDictionaryBooks?: RegexDictionaryBook[];
}

export const GrammarRuleBooksPanel: React.FC<GrammarRuleBooksPanelProps> = ({
  books,
  selectedBookId,
  onChange,
  regexDictionaryBooks = [],
}) => {
  const book = books.find((b) => b.id === selectedBookId);
  const [subTab, setSubTab] = useState<'rules' | 'categories'>('rules');
  const importRef = useRef<HTMLInputElement>(null);

  const [ruleModal, setRuleModal] = useState<{
    mode: 'add' | 'edit';
    rule: GrammarRule;
  } | null>(null);

  const [catModal, setCatModal] = useState<{
    mode: 'add' | 'edit';
    entry: GrammarCategoryEntry;
  } | null>(null);

  const sortedRules = useMemo(() => {
    if (!book) return [];
    return [...book.rules].sort((a, b) => clampPri(b.priority ?? 0) - clampPri(a.priority ?? 0));
  }, [book]);

  const regexCategoryMap = useMemo(() => buildRegexCategoryMap(regexDictionaryBooks), [regexDictionaryBooks]);

  const invalidRuleIds = useMemo(() => {
    if (!book) return new Set<string>();
    const bad = new Set<string>();
    const l = book.categoryLexicon ?? [];
    for (const r of book.rules) {
      if (!grammarRulePairLooksValid(r, l, regexCategoryMap)) bad.add(r.id);
    }
    return bad;
  }, [book, regexCategoryMap]);

  const sortedCats = useMemo(() => {
    if (!book) return [];
    return [...(book.categoryLexicon ?? [])].sort((a, b) => {
      const ca = a.category.localeCompare(b.category, 'zh');
      if (ca !== 0) return ca;
      return a.source.localeCompare(b.source, 'zh');
    });
  }, [book]);

  const updateBook = (bookId: string, patch: Partial<GrammarRuleBook>) => {
    onChange(books.map((b) => (b.id === bookId ? { ...b, ...patch } : b)));
  };

  const saveRule = () => {
    if (!ruleModal || !book) return;
    const { mode, rule } = ruleModal;
    if (!rule.sourcePattern.trim() || !rule.targetTemplate.trim()) {
      alert('请填写原文句式与译文句式');
      return;
    }
    const nextRule = { ...rule, priority: clampPri(rule.priority ?? 0) };
    if (!grammarRulePairLooksValid(nextRule, book.categoryLexicon ?? [], regexCategoryMap)) {
      alert(
        '规则无效：若为 Legacy 句式，请使用 {{变量}} 且译文含同名变量；雪人式请检查 * / {} 占位、类别词条是否齐全（内置 digits、label 等除外）。'
      );
      return;
    }
    const nextRules =
      mode === 'add'
        ? [...book.rules, { ...nextRule, id: nextRule.id || newRuleId() }]
        : book.rules.map((r) => (r.id === nextRule.id ? nextRule : r));
    updateBook(book.id, { rules: nextRules });
    setRuleModal(null);
  };

  const deleteRule = (ruleId: string) => {
    if (!book) return;
    if (!confirm('删除此规则？')) return;
    updateBook(book.id, {
      rules: book.rules.filter((r) => r.id !== ruleId),
    });
  };

  const saveCategoryEntry = () => {
    if (!catModal || !book) return;
    const { mode, entry } = catModal;
    if (!entry.source.trim() || !entry.category.trim()) {
      alert('请填写原文与类别名');
      return;
    }
    const list = [...(book.categoryLexicon ?? [])];
    const next =
      mode === 'add'
        ? [...list, { ...entry, id: entry.id || newCatId() }]
        : list.map((e) => (e.id === entry.id ? entry : e));
    updateBook(book.id, { categoryLexicon: next });
    setCatModal(null);
  };

  const deleteCategoryEntry = (id: string) => {
    if (!book) return;
    if (!confirm('删除此类别词条？')) return;
    updateBook(book.id, {
      categoryLexicon: (book.categoryLexicon ?? []).filter((e) => e.id !== id),
    });
  };

  const exportBook = () => {
    if (!book) return;
    const header = ['原文', '译文', '类别', '优先级', '备注', '属性'];
    const ruleRows = sortedRules.map((r) => [
      r.sourcePattern,
      r.targetTemplate,
      r.ruleCategory ?? '',
      clampPri(r.priority ?? 0),
      r.name ?? '',
      r.temporary ? 1 : '',
    ]);
    const wsRules = XLSX.utils.aoa_to_sheet([header, ...ruleRows]);
    const catHeader = ['原文', '译文', '类别'];
    const catRows = (book.categoryLexicon ?? []).map((e) => [e.source, e.target, e.category]);
    const wsCats = XLSX.utils.aoa_to_sheet([catHeader, ...catRows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsRules, '规则');
    XLSX.utils.book_append_sheet(wb, wsCats, '类别词条');
    XLSX.writeFile(wb, `${book.name.replace(/[/\\?%*:|"<>]/g, '-')}_规则词典.xlsx`);
  };

  const parseImportFile = (file: File) => {
    if (!book) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = new Uint8Array(reader.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const sheet0 = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet0, { header: 1 }) as unknown[][];

        const rules: GrammarRule[] = [];
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i] as unknown[];
          const a = row[0]?.toString().trim() ?? '';
          const b = row[1]?.toString().trim() ?? '';
          if (!a || !b) continue;
          if (i === 0 && (a === '原文' || a.toLowerCase() === 'sourcepattern' || a === 'Source')) continue;

          const c = row[2]?.toString().trim() ?? '';
          const d = row[3];
          const e = row[4]?.toString().trim() ?? '';
          const f = row[5];
          let pri = 0;
          if (typeof d === 'number' && !Number.isNaN(d)) pri = d;
          else pri = parseInt(String(d ?? '0'), 10) || 0;
          const temp = f === 1 || f === '1' || String(f ?? '').trim() === '1';

          rules.push({
            id: newRuleId(),
            sourcePattern: a,
            targetTemplate: b,
            ruleCategory: c || undefined,
            name: e || undefined,
            priority: clampPri(pri),
            temporary: temp,
            enabled: true,
          });
        }

        let categoryLexicon: GrammarCategoryEntry[] = [];
        if (wb.SheetNames.length > 1) {
          const sh1 = wb.Sheets[wb.SheetNames[1]];
          const rows2 = XLSX.utils.sheet_to_json(sh1, { header: 1 }) as unknown[][];
          for (let i = 0; i < rows2.length; i++) {
            const row = rows2[i] as unknown[];
            const s = row[0]?.toString().trim() ?? '';
            const t = row[1]?.toString().trim() ?? '';
            const cat = row[2]?.toString().trim() ?? '';
            if (!s || !cat) continue;
            if (i === 0 && s === '原文') continue;
            categoryLexicon.push({
              id: newCatId(),
              source: s,
              target: t,
              category: cat,
            });
          }
        }

        if (
          !confirm(
            `将用文件中的 ${rules.length} 条规则与 ${categoryLexicon.length} 条类别词条替换当前词典内容，确定吗？`
          )
        ) {
          return;
        }
        updateBook(book.id, { rules, categoryLexicon });
      } catch {
        alert('导入失败：无法解析 Excel');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  if (!book) {
    return (
      <div className="flex flex-1 items-center justify-center text-slate-400 text-sm">
        请选择或创建一个规则词典
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
            {book.sourceLang} → {book.targetLang} · {book.rules.length} 条规则 · {(book.categoryLexicon ?? []).length}{' '}
            条类别词条
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSubTab('rules')}
            className={`rounded-lg px-3 py-2 text-sm font-medium ${
              subTab === 'rules' ? 'bg-amber-100 text-amber-900' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            句式规则
          </button>
          <button
            type="button"
            onClick={() => setSubTab('categories')}
            className={`rounded-lg px-3 py-2 text-sm font-medium ${
              subTab === 'categories' ? 'bg-amber-100 text-amber-900' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            类别词条
          </button>
        </div>
      </div>

      {subTab === 'rules' ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  setRuleModal({
                    mode: 'add',
                    rule: {
                      id: newRuleId(),
                      name: '',
                      priority: 10,
                      enabled: true,
                      temporary: false,
                      sourcePattern: '',
                      targetTemplate: '',
                    },
                  })
                }
                className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700"
              >
                <Icons.Plus className="h-4 w-4" />
                添加规则
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
                  if (f) parseImportFile(f);
                  e.target.value = '';
                }}
              />
            </div>
          </div>

          <div className="text-xs leading-relaxed text-slate-600 rounded-lg bg-amber-50/80 border border-amber-100 px-3 py-2 space-y-2">
            <p>
              <strong className="text-amber-950">Legacy：</strong>
              双花括号 <code className="text-amber-900">{`{{变量名}}`}</code>，译文须含同名变量；可变段送 AI 翻译后填入。
            </p>
            <p>
              <strong className="text-amber-950">雪人式（句段整句匹配）：</strong>
              <code className="text-amber-900">*</code> 可变片段（译文用 <code className="text-amber-900">#1</code>{' '}
              或单独 <code className="text-amber-900">#</code>）；
              <code className="text-amber-900">{'{}'}</code> 类别（内置{' '}
              <code className="text-amber-900">digits</code>、<code className="text-amber-900">label</code>、
              <code className="text-amber-900">label:digit_</code>、<code className="text-amber-900">label:letter_</code>
              ）；译文用 <code className="text-amber-900">@1</code>、<code className="text-amber-900">@2</code>… 取类别释义；
              词语多选一条写 <code className="text-amber-900">{`{：a|b|c}`}</code>（冒号可用半角或全角）；类别多选用{' '}
              <code className="text-amber-900">{`{甲|乙}`}</code>。
              <code className="text-amber-900">\</code> 转义特殊符号；优先级 0–20；译文多条用{' '}
              <code className="text-amber-900">|</code> 分隔时自动翻译取第一条。
            </p>
            <p className="text-slate-500">
              临时规则仅占位（不参与翻译）。Excel：A 原文 · B 译文 · C 类别 · D 优先级 · E 备注 · F 填 1 表示临时规则；第二工作表「类别词条」列为 A 原文 · B 译文 · C 类别名。
            </p>
          </div>

          <div className="flex-1 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2 w-14">优先级</th>
                  <th className="px-4 py-2">原文句式</th>
                  <th className="px-4 py-2">译文句式</th>
                  <th className="px-4 py-2 w-20">标记</th>
                  <th className="px-4 py-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedRules.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                      暂无规则，点击「添加规则」或导入 Excel
                    </td>
                  </tr>
                ) : (
                  sortedRules.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-2 align-top text-slate-400">{clampPri(r.priority ?? 0)}</td>
                      <td
                        className={`px-4 py-2 align-top font-mono text-xs break-all ${
                          invalidRuleIds.has(r.id) ? 'text-red-600' : 'text-slate-800'
                        }`}
                      >
                        {r.sourcePattern}
                      </td>
                      <td
                        className={`px-4 py-2 align-top font-mono text-xs break-all ${
                          invalidRuleIds.has(r.id) ? 'text-red-600' : 'text-slate-700'
                        }`}
                      >
                        {r.targetTemplate}
                      </td>
                      <td className="px-4 py-2 align-top text-xs">
                        {r.temporary ? <span className="text-blue-600 font-medium">临时</span> : null}
                        {r.enabled === false ? <span className="text-slate-400 ml-1">停</span> : null}
                      </td>
                      <td className="px-4 py-2 align-top text-right whitespace-nowrap">
                        <button
                          type="button"
                          className="p-1.5 text-slate-400 hover:text-blue-600"
                          onClick={() => setRuleModal({ mode: 'edit', rule: { ...r } })}
                          title="编辑"
                        >
                          <Icons.Edit className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          className="p-1.5 text-slate-400 hover:text-red-600"
                          onClick={() => deleteRule(r.id)}
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
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() =>
                setCatModal({
                  mode: 'add',
                  entry: { id: newCatId(), source: '', target: '', category: '' },
                })
              }
              className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700"
            >
              <Icons.Plus className="h-4 w-4" />
              添加类别词条
            </button>
            <p className="text-xs text-slate-500 max-w-xl">
              与雪人式规则中的 <code className="text-slate-700">{'{类别名}'}</code> 对应；译文模板里用{' '}
              <code className="text-slate-700">@序号</code> 插入该词条的「译文」列。
            </p>
          </div>

          <div className="flex-1 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2">类别</th>
                  <th className="px-4 py-2">原文</th>
                  <th className="px-4 py-2">译文</th>
                  <th className="px-4 py-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedCats.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-slate-400">
                      暂无词条；例如类别「月份」下添加 January → 一月
                    </td>
                  </tr>
                ) : (
                  sortedCats.map((e) => (
                    <tr key={e.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-2 align-top text-slate-800 font-medium">{e.category}</td>
                      <td className="px-4 py-2 align-top font-mono text-xs text-slate-800 break-all">{e.source}</td>
                      <td className="px-4 py-2 align-top text-slate-700 break-all">{e.target}</td>
                      <td className="px-4 py-2 align-top text-right whitespace-nowrap">
                        <button
                          type="button"
                          className="p-1.5 text-slate-400 hover:text-blue-600"
                          onClick={() => setCatModal({ mode: 'edit', entry: { ...e } })}
                          title="编辑"
                        >
                          <Icons.Edit className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          className="p-1.5 text-slate-400 hover:text-red-600"
                          onClick={() => deleteCategoryEntry(e.id)}
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
        </>
      )}

      {ruleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="mb-4 text-lg font-bold text-slate-900">
              {ruleModal.mode === 'add' ? '添加规则' : '编辑规则'}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-bold uppercase text-slate-500">备注（可选，对应 Excel E 列）</label>
                <input
                  className="w-full rounded border border-slate-300 p-2 text-sm"
                  value={ruleModal.rule.name ?? ''}
                  onChange={(e) =>
                    setRuleModal({ ...ruleModal, rule: { ...ruleModal.rule, name: e.target.value } })
                  }
                  placeholder="如：图号、日期"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase text-slate-500">规则类别标记（可选，Excel C 列）</label>
                <input
                  className="w-full rounded border border-slate-300 p-2 text-sm"
                  value={ruleModal.rule.ruleCategory ?? ''}
                  onChange={(e) =>
                    setRuleModal({ ...ruleModal, rule: { ...ruleModal.rule, ruleCategory: e.target.value } })
                  }
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase text-slate-500">优先级（0–20，越大越先）</label>
                <input
                  type="number"
                  min={0}
                  max={20}
                  className="w-full rounded border border-slate-300 p-2 text-sm"
                  value={ruleModal.rule.priority ?? 0}
                  onChange={(e) =>
                    setRuleModal({
                      ...ruleModal,
                      rule: { ...ruleModal.rule, priority: clampPri(Number(e.target.value) || 0) },
                    })
                  }
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={ruleModal.rule.enabled !== false}
                  onChange={(e) =>
                    setRuleModal({
                      ...ruleModal,
                      rule: { ...ruleModal.rule, enabled: e.target.checked },
                    })
                  }
                />
                启用
              </label>
              <label className="flex items-center gap-2 text-sm text-blue-800">
                <input
                  type="checkbox"
                  checked={ruleModal.rule.temporary === true}
                  onChange={(e) =>
                    setRuleModal({
                      ...ruleModal,
                      rule: { ...ruleModal.rule, temporary: e.target.checked },
                    })
                  }
                />
                临时规则（不参与句段翻译，仅占位）
              </label>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase text-slate-500">原文句式</label>
                <textarea
                  className="min-h-[72px] w-full rounded border border-slate-300 p-2 font-mono text-xs"
                  value={ruleModal.rule.sourcePattern}
                  onChange={(e) =>
                    setRuleModal({ ...ruleModal, rule: { ...ruleModal.rule, sourcePattern: e.target.value } })
                  }
                  placeholder={`meet with *  或  Fig- {digits}  或  be satisfied with {{obj}}`}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase text-slate-500">译文句式</label>
                <textarea
                  className="min-h-[72px] w-full rounded border border-slate-300 p-2 font-mono text-xs"
                  value={ruleModal.rule.targetTemplate}
                  onChange={(e) =>
                    setRuleModal({ ...ruleModal, rule: { ...ruleModal.rule, targetTemplate: e.target.value } })
                  }
                  placeholder={`与#1会晤  或  图- @1  或  对{{obj}}感到满意`}
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
                onClick={() => setRuleModal(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
                onClick={saveRule}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {catModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="mb-4 text-lg font-bold text-slate-900">
              {catModal.mode === 'add' ? '添加类别词条' : '编辑类别词条'}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-bold uppercase text-slate-500">类别名</label>
                <input
                  className="w-full rounded border border-slate-300 p-2 text-sm"
                  value={catModal.entry.category}
                  onChange={(e) =>
                    setCatModal({ ...catModal, entry: { ...catModal.entry, category: e.target.value } })
                  }
                  placeholder="月份、序数词、人 …"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase text-slate-500">原文（源语）</label>
                <input
                  className="w-full rounded border border-slate-300 p-2 text-sm font-mono"
                  value={catModal.entry.source}
                  onChange={(e) =>
                    setCatModal({ ...catModal, entry: { ...catModal.entry, source: e.target.value } })
                  }
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase text-slate-500">译文（目标语）</label>
                <input
                  className="w-full rounded border border-slate-300 p-2 text-sm"
                  value={catModal.entry.target}
                  onChange={(e) =>
                    setCatModal({ ...catModal, entry: { ...catModal.entry, target: e.target.value } })
                  }
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
                onClick={() => setCatModal(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
                onClick={saveCategoryEntry}
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

/** 创建空规则词典（语言对在弹层中已选） */
export function createEmptyGrammarRuleBook(
  name: string,
  sourceLang: string,
  targetLang: string
): GrammarRuleBook {
  return {
    id: `gr-${Date.now()}`,
    name: name.trim() || '未命名规则词典',
    sourceLang,
    targetLang,
    rules: [],
    categoryLexicon: [],
    enabled: true,
    createdAt: new Date().toISOString().split('T')[0],
  };
}
