import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icons } from './ui/Icons';

export type BatchSegmentScope = 'selected' | 'filtered' | 'all';

export type BatchSegmentOperation =
  | 'confirm'
  | 'lock'
  | 'unlock'
  | 'clear'
  | 'copySource'
  | 'translate';

const OPERATION_META: Record<
  BatchSegmentOperation,
  { question: (count: number) => string; warning: string }
> = {
  confirm: {
    question: (n) => `已选 ${n} 个句段，确认批量确认翻译吗？`,
    warning: '已选句段将被确认，请慎重操作',
  },
  lock: {
    question: (n) => `已选 ${n} 个句段，确认批量锁定吗？`,
    warning: '已选句段将被锁定，请慎重操作',
  },
  unlock: {
    question: (n) => `已选 ${n} 个句段，确认批量解锁吗？`,
    warning: '已选句段将被解锁，请慎重操作',
  },
  clear: {
    question: (n) => `已选 ${n} 个句段，确认批量清空译文吗？`,
    warning: '已选句段译文将被清空，请慎重操作',
  },
  copySource: {
    question: (n) => `已选 ${n} 个句段，确认批量复制原文到译文吗？`,
    warning: '未锁定句段的译文将被原文覆盖，请慎重操作',
  },
  translate: {
    question: (n) => `已选 ${n} 个句段，确认批量 AI 翻译吗？`,
    warning: '未锁定句段将调用 AI 翻译，请慎重操作',
  },
};

export type BatchSegmentScopeModalProps = {
  open: boolean;
  operation: BatchSegmentOperation;
  selectedCount: number;
  filteredCount: number;
  allCount: number;
  onClose: () => void;
  onConfirm: (scope: BatchSegmentScope) => void;
  confirming?: boolean;
};

export function BatchSegmentScopeModal({
  open,
  operation,
  selectedCount,
  filteredCount,
  allCount,
  onClose,
  onConfirm,
  confirming = false,
}: BatchSegmentScopeModalProps) {
  const [scope, setScope] = useState<BatchSegmentScope>('selected');

  useEffect(() => {
    if (open) setScope('selected');
  }, [open, operation]);

  const effectiveCount = useMemo(() => {
    switch (scope) {
      case 'selected':
        return selectedCount;
      case 'filtered':
        return filteredCount;
      case 'all':
        return allCount;
      default:
        return selectedCount;
    }
  }, [scope, selectedCount, filteredCount, allCount]);

  const meta = OPERATION_META[operation];
  const questionText = meta.question(effectiveCount);
  const questionParts = questionText.split(String(effectiveCount));

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/45"
      role="dialog"
      aria-modal="true"
      aria-labelledby="batch-scope-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !confirming) onClose();
      }}
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-[520px] overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
          <h3 id="batch-scope-modal-title" className="text-base font-semibold text-slate-800">
            提示
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={confirming}
            className="text-slate-400 hover:text-slate-600 disabled:opacity-40 p-1 rounded"
            aria-label="关闭"
          >
            <Icons.X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-6 flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-sky-300 to-blue-500 flex items-center justify-center mb-5 shadow-sm">
            <Icons.Check className="w-7 h-7 text-white stroke-[2.5]" />
          </div>

          <div className="w-full mb-5">
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm text-slate-600">
              <span className="text-slate-500 shrink-0">应用范围：</span>
              <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="radio"
                  name="batch-scope"
                  className="text-blue-500 focus:ring-blue-500"
                  checked={scope === 'selected'}
                  onChange={() => setScope('selected')}
                  disabled={confirming || selectedCount === 0}
                />
                <span>勾选句</span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="radio"
                  name="batch-scope"
                  className="text-blue-500 focus:ring-blue-500"
                  checked={scope === 'filtered'}
                  onChange={() => setScope('filtered')}
                  disabled={confirming || filteredCount === 0}
                />
                <span>当前筛选后的{filteredCount}句</span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="radio"
                  name="batch-scope"
                  className="text-blue-500 focus:ring-blue-500"
                  checked={scope === 'all'}
                  onChange={() => setScope('all')}
                  disabled={confirming || allCount === 0}
                />
                <span>全部{allCount}句</span>
              </label>
            </div>
          </div>

          <p className="text-[15px] text-slate-700 leading-relaxed mb-2">
            {questionParts.length === 2 ? (
              <>
                {questionParts[0]}
                <span className="text-blue-500 font-semibold mx-0.5">{effectiveCount}</span>
                {questionParts[1]}
              </>
            ) : (
              questionText
            )}
          </p>
          <p className="text-xs text-slate-400">{meta.warning}</p>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-slate-100 bg-slate-50/50">
          <button
            type="button"
            onClick={onClose}
            disabled={confirming}
            className="px-5 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-40"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => onConfirm(scope)}
            disabled={confirming || effectiveCount === 0}
            className="px-5 py-2 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded disabled:opacity-40 disabled:cursor-not-allowed min-w-[72px]"
          >
            {confirming ? '处理中…' : '确认'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
