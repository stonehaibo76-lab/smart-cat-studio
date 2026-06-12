import React, { useEffect, useMemo } from 'react';
import { Icons } from './ui/Icons';
import {
  BILINGUAL_EXPORT_FONT_OPTIONS,
  BILINGUAL_INTERLEAVED_ORDER_OPTIONS,
  MONOLINGUAL_EXPORT_FONT_OPTIONS,
  type BilingualExportFontPair,
  type BilingualInterleavedOrder,
  type MonolingualExportFont,
  type OriginalDocxExportMode,
  type OriginalFormatKind,
  clampPptxFontScale,
  DEFAULT_PPTX_FONT_SCALE,
  PPTX_FONT_SCALE_MAX,
  PPTX_FONT_SCALE_MIN,
  PPTX_FONT_SCALE_STEP,
  monolingualExportFontHint,
  monolingualExportStyleHint,
  monolingualExportStyleLabel,
} from '../services/catInterop/originalFormatExportTypes';

export interface ExportOptions {
  format: 'excel' | 'tmx' | 'sdlxliff' | 'mqxliff' | 'sdlrpx' | 'mqxlz' | 'original';
  onlyConfirmed: boolean;
  exportType?: 'all' | 'unlockedSource' | 'unlockedSourceTarget' | 'untranslated' | 'confirmed';
  exportScope?: 'currentFile' | 'project';
  sourceTargetOnly?: boolean;
  exportFont?: MonolingualExportFont;
  originalDocxMode?: OriginalDocxExportMode;
  bilingualExportFont?: BilingualExportFontPair;
  bilingualInterleavedOrder?: BilingualInterleavedOrder;
  /** PPTX 译文字号缩放比例（0.1–1） */
  pptxFontScale?: number;
}

export type ExportOptionsModalFlags = {
  cloud: boolean;
  showOriginalFormatExportOption: boolean;
  showOriginalFormatCloudHint: boolean;
  showDocxBilingualSubOptions: boolean;
  canMonolingualOriginalExport: boolean;
  canOriginalFormatExport: boolean;
  hasSdlxliffExport: boolean;
  hasMqxliffExport: boolean;
  hasTradosPackage: boolean;
  hasMemoqPackage: boolean;
  originalFormatFilesInScopeCount: number;
  primaryOriginalFormatKind: OriginalFormatKind | 'mixed' | null;
  hasPptxInExportScope: boolean;
};

export type ExportOptionsModalProps = {
  open: boolean;
  onClose: () => void;
  options: ExportOptions;
  onChange: (patch: Partial<ExportOptions>) => void;
  onConfirm: () => void;
  flags: ExportOptionsModalFlags;
};

const selectClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20';

const EXPORT_SCOPE_OPTIONS = [
  { value: 'currentFile' as const, label: '当前文件' },
  { value: 'project' as const, label: '整个项目（合并所有拆分文件）' },
];

const EXPORT_TYPE_OPTIONS: Array<{
  value: NonNullable<ExportOptions['exportType']>;
  label: string;
}> = [
  { value: 'all', label: '全部句段' },
  { value: 'unlockedSource', label: '未锁定原文' },
  { value: 'unlockedSourceTarget', label: '未锁定原文和译文' },
  { value: 'untranslated', label: '未翻译且未锁定句段' },
  { value: 'confirmed', label: '已确认句段原文和译文' },
];

/** Formats that lock export content to a single preset. */
function lockedExportTypeForFormat(
  format: ExportOptions['format']
): NonNullable<ExportOptions['exportType']> | null {
  if (format === 'original') return 'all';
  if (format === 'tmx') return 'confirmed';
  return null;
}

function buildFormatOptions(flags: ExportOptionsModalFlags): Array<{
  value: ExportOptions['format'];
  label: string;
}> {
  const items: Array<{ value: ExportOptions['format']; label: string }> = [
    { value: 'excel', label: 'Excel 文件 (.xlsx)' },
    { value: 'tmx', label: 'TMX 文件 (.tmx)' },
  ];
  if (flags.showOriginalFormatExportOption) {
    items.push({ value: 'original', label: '原文格式' });
  }
  if (flags.hasSdlxliffExport) {
    items.push({ value: 'sdlxliff', label: 'SDLXLIFF 双语文件 (.sdlxliff)' });
  }
  if (flags.hasMqxliffExport) {
    items.push({ value: 'mqxliff', label: 'MQXLIFF 双语文件 (.mqxliff)' });
  }
  if (flags.hasTradosPackage) {
    items.push({ value: 'sdlrpx', label: 'Trados 回传包 (.sdlrpx)' });
  }
  if (flags.hasMemoqPackage) {
    items.push({ value: 'mqxlz', label: 'memoQ 回传包 (.mqxlz)' });
  }
  return items;
}

export const ExportOptionsModal: React.FC<ExportOptionsModalProps> = ({
  open,
  onClose,
  options,
  onChange,
  onConfirm,
  flags,
}) => {
  const {
    cloud,
    showOriginalFormatCloudHint,
    showDocxBilingualSubOptions,
    canMonolingualOriginalExport,
    canOriginalFormatExport,
    originalFormatFilesInScopeCount,
    primaryOriginalFormatKind,
    hasPptxInExportScope,
  } = flags;

  const isInteropExport =
    options.format === 'sdlxliff' ||
    options.format === 'mqxliff' ||
    options.format === 'sdlrpx' ||
    options.format === 'mqxlz';

  const isOriginalFormatExport = options.format === 'original';
  const isTmxExport = options.format === 'tmx';
  const lockedExportType = lockedExportTypeForFormat(options.format);
  const isExportTypeLocked = lockedExportType !== null;
  const isBilingualDocxExport =
    isOriginalFormatExport &&
    (options.originalDocxMode === 'interleaved' || options.originalDocxMode === 'table');

  const showPptxFontScale =
    isOriginalFormatExport &&
    options.originalDocxMode === 'monolingual' &&
    canMonolingualOriginalExport &&
    hasPptxInExportScope;

  const formatOptions = useMemo(() => buildFormatOptions(flags), [flags]);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!lockedExportType) return;
    const patch: Partial<ExportOptions> = {};
    if (options.exportType !== lockedExportType) patch.exportType = lockedExportType;
    if (options.onlyConfirmed) patch.onlyConfirmed = false;
    if (Object.keys(patch).length > 0) onChange(patch);
  }, [lockedExportType, options.exportType, options.onlyConfirmed, onChange]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="导出"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-bold text-slate-900">导出</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            aria-label="关闭"
          >
            <Icons.X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-3">
            <label htmlFor="exportScope" className="mb-1 block text-xs font-medium text-slate-700">
              导出范围
            </label>
            <select
              id="exportScope"
              className={selectClass}
              value={options.exportScope ?? 'currentFile'}
              onChange={(e) =>
                onChange({ exportScope: e.target.value as 'currentFile' | 'project' })
              }
            >
              {EXPORT_SCOPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="mb-3">
            <label htmlFor="exportType" className="mb-1 block text-xs font-medium text-slate-700">
              导出内容
            </label>
            <select
              id="exportType"
              className={`${selectClass} disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500`}
              value={lockedExportType ?? options.exportType ?? 'all'}
              disabled={isExportTypeLocked}
              onChange={(e) =>
                onChange({
                  exportType: e.target.value as ExportOptions['exportType'],
                  onlyConfirmed: false,
                })
              }
            >
              {EXPORT_TYPE_OPTIONS.map((opt) => (
                <option
                  key={opt.value}
                  value={opt.value}
                  disabled={isExportTypeLocked && opt.value !== lockedExportType}
                >
                  {opt.label}
                </option>
              ))}
            </select>
            {isOriginalFormatExport && (
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                原文格式导出固定为全部句段。
              </p>
            )}
            {isTmxExport && (
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                TMX 导出固定为已确认句段原文和译文。
              </p>
            )}
          </div>

          {options.exportType === 'all' && !isExportTypeLocked && (
            <div className="mb-3">
              <label className="flex cursor-pointer items-center gap-2 rounded p-1.5 text-xs text-slate-600 hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={options.onlyConfirmed}
                  onChange={(e) => onChange({ onlyConfirmed: e.target.checked })}
                  className="h-3 w-3 text-blue-600"
                />
                <span>仅导出已确认句段</span>
              </label>
            </div>
          )}

          <div className="mb-4">
            <label htmlFor="exportFormat" className="mb-1 block text-xs font-medium text-slate-700">
              导出格式
            </label>
            <select
              id="exportFormat"
              className={selectClass}
              value={options.format}
              onChange={(e) => {
                const format = e.target.value as ExportOptions['format'];
                const locked = lockedExportTypeForFormat(format);
                if (locked) {
                  onChange({ format, exportType: locked, onlyConfirmed: false });
                } else {
                  onChange({ format });
                }
              }}
            >
              {formatOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            {showOriginalFormatCloudHint && (
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                当前范围无 DOCX 文件。DOCX / PPTX / TXT / HTML 保真导出需在本地版完成；云端请使用 Excel / TMX。
              </p>
            )}
            {!cloud && originalFormatFilesInScopeCount > 0 && !canOriginalFormatExport && showDocxBilingualSubOptions && (
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                纯译文（保真）需原文件备份；段段/并列对照可直接从句段生成。
              </p>
            )}
            {!cloud && originalFormatFilesInScopeCount > 0 && !canOriginalFormatExport && !showDocxBilingualSubOptions && (
              <p className="mt-2 text-[11px] leading-relaxed text-amber-700">
                当前文件尚无原文件备份，请重新导入文档后再使用保真导出。
              </p>
            )}

            {isInteropExport && (
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                {options.format === 'sdlrpx'
                  ? '将包内全部 SDLXLIFF 写回译文后打包，供 Trados「导入返回包」。'
                  : options.format === 'mqxlz'
                    ? '将包内 MQXLIFF 写回译文后打包，供 memoQ 导入完成交稿。'
                    : options.format === 'sdlxliff'
                      ? '按句段 ID 写回 SDLXLIFF，保留内联标签。'
                      : '按句段顺序写回 MQXLIFF。'}
                {options.format !== 'sdlrpx' && options.format !== 'mqxlz' && (
                  <span className="mt-1 block">导出范围选「整个项目」时将依次下载各双语文件。</span>
                )}
              </p>
            )}
          </div>

          {isOriginalFormatExport && (
            <div className="mb-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">原文格式样式</label>
                <div className="ml-1 space-y-1 border-l-2 border-slate-100 pl-1">
                  {(showDocxBilingualSubOptions || !cloud) && (
                    <label
                      className={`flex items-center gap-2 rounded p-1.5 text-xs ${
                        canMonolingualOriginalExport
                          ? 'cursor-pointer text-slate-600 hover:bg-slate-50'
                          : 'cursor-not-allowed text-slate-400'
                      }`}
                    >
                      <input
                        type="radio"
                        name="originalDocxMode"
                        value="monolingual"
                        checked={options.originalDocxMode === 'monolingual'}
                        disabled={!canMonolingualOriginalExport}
                        onChange={() => onChange({ originalDocxMode: 'monolingual' })}
                        className="h-3 w-3 text-blue-600 disabled:opacity-50"
                      />
                      <span>{monolingualExportStyleLabel(primaryOriginalFormatKind)}</span>
                    </label>
                  )}
                  {showDocxBilingualSubOptions && (
                    <>
                      <label className="flex cursor-pointer items-center gap-2 rounded p-1.5 text-xs text-slate-600 hover:bg-slate-50">
                        <input
                          type="radio"
                          name="originalDocxMode"
                          value="interleaved"
                          checked={options.originalDocxMode === 'interleaved'}
                          onChange={() => onChange({ originalDocxMode: 'interleaved' })}
                          className="h-3 w-3 text-blue-600"
                        />
                        <span>段段对照（双语 DOCX）</span>
                      </label>
                      <label className="flex cursor-pointer items-center gap-2 rounded p-1.5 text-xs text-slate-600 hover:bg-slate-50">
                        <input
                          type="radio"
                          name="originalDocxMode"
                          value="table"
                          checked={options.originalDocxMode === 'table'}
                          onChange={() => onChange({ originalDocxMode: 'table' })}
                          className="h-3 w-3 text-blue-600"
                        />
                        <span>并列对照（双语 DOCX）</span>
                      </label>
                    </>
                  )}
                </div>
                {!canMonolingualOriginalExport && showDocxBilingualSubOptions && (
                  <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                    纯译文需在本地版运行且导入时已保存原文件（Okapi 侧车）。双语对照可在浏览器直接生成。
                  </p>
                )}
                {options.originalDocxMode === 'monolingual' && canMonolingualOriginalExport && (
                  <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                    {monolingualExportStyleHint(primaryOriginalFormatKind)}
                  </p>
                )}
                {isBilingualDocxExport && (
                  <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                    {options.originalDocxMode === 'interleaved' && canOriginalFormatExport
                      ? '在原 DOCX 上保留目录、表格、文本框等版式，每段原文与译文相邻排列；字符格式同步保留。'
                      : options.originalDocxMode === 'table'
                        ? '生成新的两列表格对照稿，不保留原文档中的表格/目录结构。'
                        : '从句段生成新 DOCX（无原文件备份时不保留段落版式）；未译句段译文留空。'}
                  </p>
                )}
              </div>

              {options.originalDocxMode === 'monolingual' && canMonolingualOriginalExport && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">导出字体</label>
                  <div className="space-y-1">
                    {MONOLINGUAL_EXPORT_FONT_OPTIONS.map((opt) => (
                      <label
                        key={opt.id}
                        className="flex cursor-pointer items-center gap-2 rounded p-1.5 text-xs text-slate-600 hover:bg-slate-50"
                      >
                        <input
                          type="radio"
                          name="exportFont"
                          value={opt.id}
                          checked={options.exportFont === opt.id}
                          onChange={() => onChange({ exportFont: opt.id })}
                          className="h-3 w-3 text-blue-600"
                        />
                        <span style={{ fontFamily: opt.previewFamily }}>{opt.label}</span>
                      </label>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                    {monolingualExportFontHint(primaryOriginalFormatKind)}
                  </p>
                </div>
              )}

              {showPptxFontScale && (
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label htmlFor="pptxFontScale" className="text-xs font-medium text-slate-700">
                      译文字号缩放比例
                    </label>
                    <span className="text-xs font-semibold tabular-nums text-blue-600">
                      {Math.round(clampPptxFontScale(options.pptxFontScale ?? DEFAULT_PPTX_FONT_SCALE) * 100)}%
                    </span>
                  </div>
                  <input
                    id="pptxFontScale"
                    type="range"
                    min={PPTX_FONT_SCALE_MIN}
                    max={PPTX_FONT_SCALE_MAX}
                    step={PPTX_FONT_SCALE_STEP}
                    className="h-2 w-full cursor-pointer accent-blue-600"
                    value={clampPptxFontScale(options.pptxFontScale ?? DEFAULT_PPTX_FONT_SCALE)}
                    onChange={(e) =>
                      onChange({ pptxFontScale: clampPptxFontScale(Number(e.target.value)) })
                    }
                  />
                  <div className="mt-1 flex justify-between text-[10px] text-slate-400">
                    <span>{PPTX_FONT_SCALE_MIN}</span>
                    <span>{PPTX_FONT_SCALE_MAX}</span>
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                    相对原文字号的缩放比例（例如 0.7 表示 70%）。
                    {primaryOriginalFormatKind === 'mixed' && ' 仅应用于 PPTX 文件。'}
                  </p>
                </div>
              )}

              {isBilingualDocxExport && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">双语字体组合</label>
                  <div className="space-y-1">
                    {BILINGUAL_EXPORT_FONT_OPTIONS.map((opt) => (
                      <label
                        key={opt.id}
                        className="flex cursor-pointer items-center gap-2 rounded p-1.5 text-xs text-slate-600 hover:bg-slate-50"
                      >
                        <input
                          type="radio"
                          name="bilingualExportFont"
                          value={opt.id}
                          checked={options.bilingualExportFont === opt.id}
                          onChange={() => onChange({ bilingualExportFont: opt.id })}
                          className="h-3 w-3 text-blue-600"
                        />
                        <span style={{ fontFamily: opt.previewFamily }}>{opt.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {options.originalDocxMode === 'interleaved' && isBilingualDocxExport && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">段段顺序</label>
                  <div className="space-y-1">
                    {BILINGUAL_INTERLEAVED_ORDER_OPTIONS.map((opt) => (
                      <label
                        key={opt.id}
                        className="flex cursor-pointer items-center gap-2 rounded p-1.5 text-xs text-slate-600 hover:bg-slate-50"
                      >
                        <input
                          type="radio"
                          name="bilingualInterleavedOrder"
                          value={opt.id}
                          checked={options.bilingualInterleavedOrder === opt.id}
                          onChange={() => onChange({ bilingualInterleavedOrder: opt.id })}
                          className="h-3 w-3 text-blue-600"
                        />
                        <span>{opt.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {isOriginalFormatExport &&
            options.originalDocxMode === 'monolingual' &&
            !canMonolingualOriginalExport &&
            showDocxBilingualSubOptions && (
              <div className="mb-4">
                <p className="text-[11px] leading-relaxed text-amber-700">
                  当前无法使用纯译文导出。请选择段段或并列对照，或在本地版重新导入后导出保真译文。
                </p>
              </div>
            )}

          {!isInteropExport && !isOriginalFormatExport && (
            <div className="mb-4">
              <label className="flex cursor-pointer items-center gap-2 rounded p-1.5 text-xs text-slate-600 hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={options.sourceTargetOnly ?? true}
                  onChange={(e) => onChange({ sourceTargetOnly: e.target.checked })}
                  className="h-3 w-3 text-blue-600"
                />
                <span>仅导出原文和译文列（不含附加信息）</span>
              </label>
            </div>
          )}
        </div>

        <div className="flex shrink-0 gap-2 border-t border-slate-200 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-200"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700"
          >
            确认导出
          </button>
        </div>
      </div>
    </div>
  );
};
