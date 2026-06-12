import React, { useMemo, useState } from 'react';
import { Icons } from '../../ui/Icons';
import type { TranslationMemory, TermBase, GrammarRuleBook, RegexDictionaryBook } from '../../../types';
import {
  TradosResourceTable,
  TradosCreateNewPanel,
  TradosAuxDictionaryTable,
  langPairLabel,
  type TradosResourceRow,
} from '../TradosResourceTable';

type ResourceTab = 'tm' | 'tb' | 'aux';

interface ResourceMappingStepProps {
  sourceLang: string;
  targetLang: string;
  projectName: string;
  availableTMs: TranslationMemory[];
  availableTBs: TermBase[];
  matchingGrammarBooks: GrammarRuleBook[];
  matchingRegexDictionaryBooks: RegexDictionaryBook[];
  mainTmId: string;
  referenceTmIds: Set<string>;
  mainTbId: string;
  referenceTbIds: Set<string>;
  grammarRuleBookIds: Set<string>;
  regexDictionaryBookIds: Set<string>;
  newTmName: string;
  newTbName: string;
  onMainTmChange: (value: string) => void;
  onMainTbChange: (value: string) => void;
  onNewTmNameChange: (value: string) => void;
  onNewTbNameChange: (value: string) => void;
  onToggleRefTm: (id: string) => void;
  onToggleRefTb: (id: string) => void;
  onToggleGrammarBook: (id: string) => void;
  onToggleRegexDictionaryBook: (id: string) => void;
}

const RESOURCE_TABS: { id: ResourceTab; label: string; icon: React.FC<{ className?: string }> }[] = [
  { id: 'tm', label: '翻译记忆库', icon: Icons.Database },
  { id: 'tb', label: '术语库', icon: Icons.TermBase },
  { id: 'aux', label: '辅助词典', icon: Icons.Concordance },
];

function toTmRows(
  tms: TranslationMemory[],
  sourceLang: string,
  targetLang: string,
  showOnlyMatching: boolean
): TradosResourceRow[] {
  return tms
    .filter((tm) => {
      const matches = tm.sourceLang === sourceLang && tm.targetLang === targetLang;
      return showOnlyMatching ? matches : true;
    })
    .map((tm) => ({
      id: tm.id,
      name: tm.name,
      sourceLang: tm.sourceLang,
      targetLang: tm.targetLang,
      entryCount: tm.units.length,
      matchesProjectLang: tm.sourceLang === sourceLang && tm.targetLang === targetLang,
    }));
}

function toTbRows(
  tbs: TermBase[],
  sourceLang: string,
  targetLang: string,
  showOnlyMatching: boolean
): TradosResourceRow[] {
  return tbs
    .filter((tb) => {
      const matches = tb.sourceLang === sourceLang && tb.targetLang === targetLang;
      return showOnlyMatching ? matches : true;
    })
    .map((tb) => ({
      id: tb.id,
      name: tb.name,
      sourceLang: tb.sourceLang,
      targetLang: tb.targetLang,
      entryCount: tb.entries.length,
      matchesProjectLang: tb.sourceLang === sourceLang && tb.targetLang === targetLang,
    }));
}

function selectionSummary(
  mainId: string,
  refIds: Set<string>,
  rows: TradosResourceRow[],
  newName: string,
  projectName: string,
  resourceLabel: string
): string {
  if (mainId === 'none') {
    const refCount = refIds.size;
    return refCount > 0 ? `未设主库，参考 ${refCount} 个` : `未使用${resourceLabel}`;
  }
  if (mainId === 'create-new') {
    const name = newName || `${projectName} ${resourceLabel}`;
    const refCount = refIds.size;
    return refCount > 0 ? `新建「${name}」+ 参考 ${refCount} 个` : `将新建「${name}」`;
  }
  const mainName = rows.find((r) => r.id === mainId)?.name ?? '未知';
  const refCount = refIds.size;
  return refCount > 0 ? `主库「${mainName}」+ 参考 ${refCount} 个` : `主库「${mainName}」`;
}

export const ResourceMappingStep: React.FC<ResourceMappingStepProps> = ({
  sourceLang,
  targetLang,
  projectName,
  availableTMs,
  availableTBs,
  matchingGrammarBooks,
  matchingRegexDictionaryBooks,
  mainTmId,
  referenceTmIds,
  mainTbId,
  referenceTbIds,
  grammarRuleBookIds,
  regexDictionaryBookIds,
  newTmName,
  newTbName,
  onMainTmChange,
  onMainTbChange,
  onNewTmNameChange,
  onNewTbNameChange,
  onToggleRefTm,
  onToggleRefTb,
  onToggleGrammarBook,
  onToggleRegexDictionaryBook,
}) => {
  const [activeTab, setActiveTab] = useState<ResourceTab>('tm');
  const [showOnlyMatching, setShowOnlyMatching] = useState(true);

  const tmRows = useMemo(
    () => toTmRows(availableTMs, sourceLang, targetLang, showOnlyMatching),
    [availableTMs, sourceLang, targetLang, showOnlyMatching]
  );
  const tbRows = useMemo(
    () => toTbRows(availableTBs, sourceLang, targetLang, showOnlyMatching),
    [availableTBs, sourceLang, targetLang, showOnlyMatching]
  );

  const tmSummary = selectionSummary(
    mainTmId,
    referenceTmIds,
    tmRows,
    newTmName,
    projectName,
    'TM'
  );
  const tbSummary = selectionSummary(
    mainTbId,
    referenceTbIds,
    tbRows,
    newTbName,
    projectName,
    'TB'
  );
  const auxCount = grammarRuleBookIds.size + regexDictionaryBookIds.size;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-900">资源挂载</h3>
          <p className="mt-0.5 text-sm text-slate-500">
            为项目指定记忆库与术语库，Trados 风格：主库单选写入，参考库多选查库。
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
          <Icons.Globe className="h-3.5 w-3.5 text-slate-400" />
          <span className="font-medium">{langPairLabel(sourceLang, targetLang)}</span>
        </div>
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
        <input
          type="checkbox"
          checked={showOnlyMatching}
          onChange={(e) => setShowOnlyMatching(e.target.checked)}
          className="rounded border-slate-300 text-blue-600"
        />
        仅显示与项目语言对匹配的资源（Trados 默认）
      </label>

      <div className="flex min-h-[320px] overflow-hidden rounded-xl border border-slate-200 bg-white">
        <nav className="flex w-36 shrink-0 flex-col border-r border-slate-200 bg-slate-50 py-2">
          {RESOURCE_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            const badge =
              tab.id === 'tm'
                ? mainTmId !== 'none'
                  ? '●'
                  : referenceTmIds.size > 0
                    ? '○'
                    : null
                : tab.id === 'tb'
                  ? mainTbId !== 'none'
                    ? '●'
                    : referenceTbIds.size > 0
                      ? '○'
                      : null
                  : auxCount > 0
                    ? String(auxCount)
                    : null;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-3 py-2.5 text-left text-xs font-semibold transition-colors ${
                  isActive
                    ? 'border-r-2 border-blue-600 bg-white text-blue-700'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Icon className={`h-3.5 w-3.5 shrink-0 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
                <span className="flex-1 leading-tight">{tab.label}</span>
                {badge && (
                  <span
                    className={`shrink-0 text-[10px] ${
                      isActive ? 'text-blue-500' : 'text-slate-400'
                    }`}
                  >
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col p-4">
          {activeTab === 'tm' && (
            <>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                项目翻译记忆库
              </p>
              <div className="mb-3">
                <TradosCreateNewPanel
                  label="新建记忆库"
                  value={newTmName}
                  placeholder={`${projectName || '项目'} TM`}
                  isActive={mainTmId === 'create-new'}
                  accentColor="blue"
                  onActivate={() => onMainTmChange('create-new')}
                  onNameChange={onNewTmNameChange}
                />
              </div>
              <TradosResourceTable
                rows={tmRows}
                mainId={mainTmId}
                referenceIds={referenceTmIds}
                mainColumnLabel="更新"
                referenceColumnLabel="查库"
                emptyLabel={
                  showOnlyMatching
                    ? '无匹配语言对的记忆库，可取消过滤或点击「新建记忆库」'
                    : '暂无记忆库，请点击「新建记忆库」'
                }
                accentColor="blue"
                onMainChange={onMainTmChange}
                onToggleReference={onToggleRefTm}
              />
              <p className="mt-2 text-[10px] text-slate-500">
                <strong>更新</strong>：翻译确认后写入；<strong>查库</strong>：仅用于匹配参考，不写入。
              </p>
            </>
          )}

          {activeTab === 'tb' && (
            <>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                项目术语库
              </p>
              <div className="mb-3">
                <TradosCreateNewPanel
                  label="新建术语库"
                  value={newTbName}
                  placeholder={`${projectName || '项目'} TB`}
                  isActive={mainTbId === 'create-new'}
                  accentColor="red"
                  onActivate={() => onMainTbChange('create-new')}
                  onNameChange={onNewTbNameChange}
                />
              </div>
              <TradosResourceTable
                rows={tbRows}
                mainId={mainTbId}
                referenceIds={referenceTbIds}
                mainColumnLabel="写入"
                referenceColumnLabel="查库"
                emptyLabel={
                  showOnlyMatching
                    ? '无匹配语言对的术语库，可取消过滤或点击「新建术语库」'
                    : '暂无术语库，请点击「新建术语库」'
                }
                accentColor="red"
                onMainChange={onMainTbChange}
                onToggleReference={onToggleRefTb}
              />
              <p className="mt-2 text-[10px] text-slate-500">
                <strong>写入</strong>：术语 QA 与项目术语更新；<strong>查库</strong>：仅用于术语识别参考。
              </p>
            </>
          )}

          {activeTab === 'aux' && (
            <>
              <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                辅助词典（可选）
              </p>
              <TradosAuxDictionaryTable
                grammarBooks={matchingGrammarBooks.map((g) => ({
                  id: g.id,
                  name: g.name,
                  rulesCount: g.rules.length,
                }))}
                regexBooks={matchingRegexDictionaryBooks.map((b) => ({
                  id: b.id,
                  name: b.name,
                  entriesCount: b.entries.length,
                }))}
                grammarIds={grammarRuleBookIds}
                regexIds={regexDictionaryBookIds}
                onToggleGrammar={onToggleGrammarBook}
                onToggleRegex={onToggleRegexDictionaryBook}
              />
              <p className="mt-2 text-[10px] text-slate-500">
                规则词典用于整句模板匹配；正则词典用于句段翻译前的优先替换。
              </p>
            </>
          )}

          <div className="mt-auto border-t border-slate-100 pt-3 text-[10px] text-slate-500">
            <span className="font-bold text-slate-600">已选摘要：</span>
            记忆库 {tmSummary}；术语库 {tbSummary}
            {auxCount > 0 && `；辅助词典 ${auxCount} 个`}
          </div>
        </div>
      </div>
    </div>
  );
};
