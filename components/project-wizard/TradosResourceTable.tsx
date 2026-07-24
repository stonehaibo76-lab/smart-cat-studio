import React from 'react';
import { Icons } from '../ui/Icons';
import { SUPPORTED_LANGUAGES } from '../../constants';

export type TradosResourceRow = {
  id: string;
  name: string;
  sourceLang: string;
  targetLang: string;
  entryCount: number;
  matchesProjectLang: boolean;
};

type TradosResourceTableProps = {
  rows: TradosResourceRow[];
  mainId: string;
  referenceIds: Set<string>;
  mainColumnLabel: string;
  referenceColumnLabel: string;
  emptyLabel: string;
  accentColor: 'blue' | 'red';
  onMainChange: (id: string) => void;
  onToggleReference: (id: string) => void;
};

function langLabel(code: string): string {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code)?.name ?? code;
}

export const TradosResourceTable: React.FC<TradosResourceTableProps> = ({
  rows,
  mainId,
  referenceIds,
  mainColumnLabel,
  referenceColumnLabel,
  emptyLabel,
  accentColor,
  onMainChange,
  onToggleReference,
}) => {
  const accent =
    accentColor === 'blue'
      ? { radio: 'text-blue-600', row: 'bg-blue-50/60', badge: 'bg-blue-100 text-blue-700' }
      : { radio: 'text-red-600', row: 'bg-red-50/60', badge: 'bg-red-100 text-red-700' };

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-100 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            <th className="w-14 px-3 py-2.5 text-center">{mainColumnLabel}</th>
            <th className="w-14 px-3 py-2.5 text-center">{referenceColumnLabel}</th>
            <th className="px-3 py-2.5">名称</th>
            <th className="w-24 px-3 py-2.5">源语言</th>
            <th className="w-24 px-3 py-2.5">目标语言</th>
            <th className="w-16 px-3 py-2.5 text-right">条目</th>
          </tr>
        </thead>
        <tbody>
          <tr
            className={`border-b border-slate-100 transition-colors hover:bg-slate-50 ${
              mainId === 'none' ? accent.row : ''
            }`}
          >
            <td className="px-3 py-2 text-center">
              <input
                type="radio"
                name={`main-${accentColor}`}
                checked={mainId === 'none'}
                onChange={() => onMainChange('none')}
                className={accent.radio}
              />
            </td>
            <td className="px-3 py-2 text-center text-slate-300">—</td>
            <td className="px-3 py-2 font-medium text-slate-500">（不使用）</td>
            <td className="px-3 py-2 text-slate-400">—</td>
            <td className="px-3 py-2 text-slate-400">—</td>
            <td className="px-3 py-2 text-right text-slate-400">—</td>
          </tr>

          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-3 py-8 text-center text-sm text-slate-400">
                {emptyLabel}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const isMain = mainId === row.id;
              const isRef = referenceIds.has(row.id);
              const refDisabled = isMain || mainId === 'none' || mainId === 'create-new';

              return (
                <tr
                  key={row.id}
                  className={`border-b border-slate-100 transition-colors hover:bg-slate-50 ${
                    isMain ? accent.row : isRef ? 'bg-slate-50/80' : ''
                  } ${!row.matchesProjectLang ? 'opacity-60' : ''}`}
                >
                  <td className="px-3 py-2 text-center">
                    <input
                      type="radio"
                      name={`main-${accentColor}`}
                      checked={isMain}
                      onChange={() => onMainChange(row.id)}
                      className={accent.radio}
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    {isMain ? (
                      <span className="text-xs text-slate-400" title="主库不可同时作为参考库">
                        —
                      </span>
                    ) : (
                      <input
                        type="checkbox"
                        checked={isRef}
                        disabled={refDisabled}
                        onChange={() => onToggleReference(row.id)}
                        className={`rounded border-slate-300 ${accent.radio} disabled:opacity-30`}
                      />
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium text-slate-800">{row.name}</span>
                      {isMain && (
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${accent.badge}`}>
                          主库
                        </span>
                      )}
                      {!row.matchesProjectLang && (
                        <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                          语言不匹配
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{langLabel(row.sourceLang)}</td>
                  <td className="px-3 py-2 text-slate-600">{langLabel(row.targetLang)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                    {row.entryCount.toLocaleString()}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
};

type CreateNewPanelProps = {
  label: string;
  value: string;
  placeholder: string;
  isActive: boolean;
  accentColor: 'blue' | 'red';
  onActivate: () => void;
  onNameChange: (value: string) => void;
};

export const TradosCreateNewPanel: React.FC<CreateNewPanelProps> = ({
  label,
  value,
  placeholder,
  isActive,
  accentColor,
  onActivate,
  onNameChange,
}) => {
  const btnClass =
    accentColor === 'blue'
      ? 'border-blue-200 text-blue-700 hover:bg-blue-50'
      : 'border-red-200 text-red-700 hover:bg-red-50';
  const panelClass =
    accentColor === 'blue' ? 'border-blue-200 bg-blue-50/40' : 'border-red-200 bg-red-50/40';

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onActivate}
        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${btnClass} ${
          isActive ? 'ring-2 ring-offset-1 ring-blue-300' : ''
        }`}
      >
        <Icons.Plus className="h-3.5 w-3.5" />
        {label}
      </button>
      {isActive && (
        <div className={`rounded-lg border p-3 ${panelClass}`}>
          <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
            新建资源名称
          </label>
          <input
            type="text"
            value={value}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder={placeholder}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            autoFocus
          />
          <p className="mt-1.5 text-[10px] text-slate-500">将使用项目语言对创建空白资源库</p>
        </div>
      )}
    </div>
  );
};

type AuxDictionaryTableProps = {
  grammarBooks: Array<{ id: string; name: string; rulesCount: number }>;
  regexBooks: Array<{ id: string; name: string; entriesCount: number }>;
  grammarIds: Set<string>;
  regexIds: Set<string>;
  onToggleGrammar: (id: string) => void;
  onToggleRegex: (id: string) => void;
};

export const TradosAuxDictionaryTable: React.FC<AuxDictionaryTableProps> = ({
  grammarBooks,
  regexBooks,
  grammarIds,
  regexIds,
  onToggleGrammar,
  onToggleRegex,
}) => {
  const hasAny = grammarBooks.length > 0 || regexBooks.length > 0;

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-100 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            <th className="w-14 px-3 py-2.5 text-center">启用</th>
            <th className="px-3 py-2.5">名称</th>
            <th className="w-20 px-3 py-2.5">类型</th>
            <th className="w-16 px-3 py-2.5 text-right">条目</th>
          </tr>
        </thead>
        <tbody>
          {!hasAny ? (
            <tr>
              <td colSpan={4} className="px-3 py-8 text-center text-sm text-slate-400">
                无匹配语言对的辅助词典，可在「语言资源」中创建
              </td>
            </tr>
          ) : (
            <>
              {grammarBooks.map((g) => (
                <tr key={g.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={grammarIds.has(g.id)}
                      onChange={() => onToggleGrammar(g.id)}
                      className="rounded border-slate-300 text-amber-600"
                    />
                  </td>
                  <td className="px-3 py-2 font-medium text-slate-800">{g.name}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1 text-amber-700">
                      <Icons.Concordance className="h-3 w-3" />
                      规则词典
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                    {g.rulesCount}
                  </td>
                </tr>
              ))}
              {regexBooks.map((b) => (
                <tr key={b.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={regexIds.has(b.id)}
                      onChange={() => onToggleRegex(b.id)}
                      className="rounded border-slate-300 text-violet-600"
                    />
                  </td>
                  <td className="px-3 py-2 font-medium text-slate-800">{b.name}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1 text-violet-700">
                      <Icons.RegexDict className="h-3 w-3" />
                      正则词典
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                    {b.entriesCount}
                  </td>
                </tr>
              ))}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
};

export function langPairLabel(sourceLang: string, targetLang: string): string {
  return `${langLabel(sourceLang)} → ${langLabel(targetLang)}`;
}
