import React, { useRef } from 'react';
import { Icons } from '../../ui/Icons';
import type { UploadedFilePayload } from '../../../services/projectCreateService';
import { countFileSegments } from '../../../services/projectCreateService';
import type { TranslationSegmentationMode } from '../../../types';

interface FileImportStepProps {
  uploadedFiles: UploadedFilePayload[];
  segmentationMode: TranslationSegmentationMode;
  isParsing: boolean;
  xliffLanguageHint: { sourceLang: string; targetLang: string; differsFromForm: boolean } | null;
  onFileChange: (files: FileList | null) => void;
  onRemoveFile: (index: number) => void;
}

export const FileImportStep: React.FC<FileImportStepProps> = ({
  uploadedFiles,
  segmentationMode,
  isParsing,
  xliffLanguageHint,
  onFileChange,
  onRemoveFile,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-1 text-base font-bold text-slate-900">导入文件</h3>
        <p className="text-sm text-slate-500">
          上传需要翻译的原文文件，支持多文件批量导入（含 .pptx / .sdlxliff / .mqxliff / .mqxlz / .sdlppx）。
        </p>
      </div>

      {xliffLanguageHint && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            xliffLanguageHint.differsFromForm
              ? 'border-amber-200 bg-amber-50 text-amber-800'
              : 'border-blue-200 bg-blue-50 text-blue-800'
          }`}
        >
          <div className="flex items-start gap-2">
            <Icons.Info className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">检测到 XLIFF 语言元数据</p>
              <p className="mt-0.5 text-xs opacity-90">
                创建时将优先采用文件内语言对：{xliffLanguageHint.sourceLang} →{' '}
                {xliffLanguageHint.targetLang}
                {xliffLanguageHint.differsFromForm && '（与步骤 1 所选语言不同）'}
              </p>
            </div>
          </div>
        </div>
      )}

      <div>
        <div
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 transition-colors ${
            isParsing
              ? 'cursor-wait border-blue-400 bg-slate-50'
              : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50'
          }`}
          onClick={() => !isParsing && fileInputRef.current?.click()}
        >
          {isParsing ? (
            <Icons.Refresh className="mb-2 h-8 w-8 animate-spin text-blue-500" />
          ) : (
            <Icons.Upload className="mb-2 h-8 w-8 text-slate-400" />
          )}
          <span className="text-sm text-slate-500">
            {uploadedFiles.length > 0
              ? `已选择 ${uploadedFiles.length} 个文件，点击继续添加`
              : '点击批量上传文件'}
          </span>
          <input
            type="file"
            accept=".txt,.docx,.pptx,.xlsx,.html,.htm,.idml,.sdlxliff,.mqxliff,.mqxlz,.sdlppx,.sdlrpx,.xlf"
            ref={fileInputRef}
            onChange={(e) => {
              onFileChange(e.target.files);
              if (fileInputRef.current) fileInputRef.current.value = '';
            }}
            className="hidden"
            multiple
          />
        </div>

        {uploadedFiles.length > 0 && (
          <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
            {uploadedFiles.map((f, i) => {
              const segCount = countFileSegments(f, segmentationMode);
              return (
                <div
                  key={`${f.name}-${i}`}
                  className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Icons.File className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="truncate">{f.name}</span>
                    {segCount !== null && (
                      <span className="shrink-0 text-slate-400">({segCount} 句段)</span>
                    )}
                    {f.isXliff && (
                      <span className="shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                        XLIFF
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemoveFile(i)}
                    className="shrink-0 text-slate-400 hover:text-red-500"
                    aria-label={`移除 ${f.name}`}
                  >
                    <Icons.X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
