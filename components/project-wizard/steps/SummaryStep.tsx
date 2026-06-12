import React from 'react';
import { Icons } from '../../ui/Icons';
import { SUPPORTED_LANGUAGES } from '../../../constants';
import type { TranslationMemory, TermBase, GrammarRuleBook, RegexDictionaryBook } from '../../../types';
import type { ProjectCreateFormState } from '../../../services/projectCreateService';
import {
  countFileSegments,
  getEffectiveLanguages,
} from '../../../services/projectCreateService';

interface SummaryStepProps {
  formState: ProjectCreateFormState;
  availableTMs: TranslationMemory[];
  availableTBs: TermBase[];
  matchingGrammarBooks: GrammarRuleBook[];
  matchingRegexDictionaryBooks: RegexDictionaryBook[];
}

function langLabel(code: string): string {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code)?.name ?? code;
}

function resolveTmLabel(
  mainTmId: string,
  newTmName: string,
  projectName: string,
  availableTMs: TranslationMemory[]
): string {
  if (mainTmId === 'none') return '无';
  if (mainTmId === 'create-new') return `${newTmName || `${projectName} TM`}（新建）`;
  return availableTMs.find((tm) => tm.id === mainTmId)?.name ?? '未知';
}

function resolveTbLabel(
  mainTbId: string,
  newTbName: string,
  projectName: string,
  availableTBs: TermBase[]
): string {
  if (mainTbId === 'none') return '无';
  if (mainTbId === 'create-new') return `${newTbName || `${projectName} TB`}（新建）`;
  return availableTBs.find((tb) => tb.id === mainTbId)?.name ?? '未知';
}

export const SummaryStep: React.FC<SummaryStepProps> = ({
  formState,
  availableTMs,
  availableTBs,
  matchingGrammarBooks,
  matchingRegexDictionaryBooks,
}) => {
  const { sourceLang, targetLang } = getEffectiveLanguages(formState);
  const totalSegments = formState.uploadedFiles.reduce((sum, f) => {
    const n = countFileSegments(f);
    return sum + (n ?? 0);
  }, 0);

  const refTmCount = formState.referenceTmIds.size;
  const refTbCount = formState.referenceTbIds.size;
  const grammarCount = formState.grammarRuleBookIds.size;
  const regexCount = formState.regexDictionaryBookIds.size;

  const selectedGrammarNames = matchingGrammarBooks
    .filter((g) => formState.grammarRuleBookIds.has(g.id))
    .map((g) => g.name);
  const selectedRegexNames = matchingRegexDictionaryBooks
    .filter((b) => formState.regexDictionaryBookIds.has(b.id))
    .map((b) => b.name);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-1 text-base font-bold text-slate-900">确认创建</h3>
        <p className="text-sm text-slate-500">请核对以下信息，确认无误后点击「创建项目」。</p>
      </div>

      <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm">
        <SummaryRow label="项目名称" value={formState.newProjectName} />
        <SummaryRow
          label="语言对"
          value={
            <span className="flex items-center gap-2">
              <span className="rounded bg-white px-2 py-0.5 text-xs font-medium uppercase text-slate-600">
                {langLabel(sourceLang)}
              </span>
              <Icons.ChevronRight className="h-3.5 w-3.5 text-slate-400" />
              <span className="rounded bg-white px-2 py-0.5 text-xs font-medium uppercase text-slate-600">
                {langLabel(targetLang)}
              </span>
            </span>
          }
        />

        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
            文件 ({formState.uploadedFiles.length} 个，约 {totalSegments} 句段)
          </p>
          <ul className="max-h-32 space-y-1 overflow-y-auto">
            {formState.uploadedFiles.map((f, i) => {
              const segCount = countFileSegments(f);
              return (
                <li
                  key={`${f.name}-${i}`}
                  className="flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-xs text-slate-700"
                >
                  <Icons.File className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span className="truncate">{f.name}</span>
                  {segCount !== null && (
                    <span className="shrink-0 text-slate-400">{segCount} 句段</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <SummaryRow
          label="主记忆库"
          value={resolveTmLabel(
            formState.mainTmId,
            formState.newTmName,
            formState.newProjectName,
            availableTMs
          )}
        />
        {refTmCount > 0 && (
          <SummaryRow label="参考记忆库" value={`${refTmCount} 个`} />
        )}
        <SummaryRow
          label="主术语库"
          value={resolveTbLabel(
            formState.mainTbId,
            formState.newTbName,
            formState.newProjectName,
            availableTBs
          )}
        />
        {refTbCount > 0 && <SummaryRow label="参考术语库" value={`${refTbCount} 个`} />}
        {grammarCount > 0 && (
          <SummaryRow
            label="规则词典"
            value={selectedGrammarNames.join('、') || `${grammarCount} 个`}
          />
        )}
        {regexCount > 0 && (
          <SummaryRow
            label="正则词典"
            value={selectedRegexNames.join('、') || `${regexCount} 个`}
          />
        )}
      </div>
    </div>
  );
};

const SummaryRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 pb-3 last:border-0 last:pb-0">
    <span className="shrink-0 text-xs font-bold text-slate-500">{label}</span>
    <span className="text-right font-medium text-slate-800">{value}</span>
  </div>
);
