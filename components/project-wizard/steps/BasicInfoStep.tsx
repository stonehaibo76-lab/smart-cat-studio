import React from 'react';
import { SUPPORTED_LANGUAGES } from '../../../constants';
import { SegmentationModeField } from '../../SegmentationModeField';
import type { TranslationSegmentationMode } from '../../../types';

interface BasicInfoStepProps {
  newProjectName: string;
  sourceLang: string;
  targetLang: string;
  segmentationMode: TranslationSegmentationMode;
  onNameChange: (value: string) => void;
  onSourceLangChange: (value: string) => void;
  onTargetLangChange: (value: string) => void;
  onSegmentationModeChange: (mode: TranslationSegmentationMode) => void;
}

export const BasicInfoStep: React.FC<BasicInfoStepProps> = ({
  newProjectName,
  sourceLang,
  targetLang,
  segmentationMode,
  onNameChange,
  onSourceLangChange,
  onTargetLangChange,
  onSegmentationModeChange,
}) => {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-1 text-base font-bold text-slate-900">基本信息</h3>
        <p className="text-sm text-slate-500">填写项目名称并选择翻译语言对。</p>
      </div>

      <div>
        <label className="mb-1 block text-sm font-semibold text-slate-700">项目名称</label>
        <input
          type="text"
          className="w-full rounded-lg border border-slate-300 p-2.5 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
          placeholder="例如：2024 Q4 营销文档"
          value={newProjectName}
          onChange={(e) => onNameChange(e.target.value)}
          autoFocus
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-700">源语言</label>
          <select
            value={sourceLang}
            onChange={(e) => onSourceLangChange(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white p-2.5"
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-700">目标语言</label>
          <select
            value={targetLang}
            onChange={(e) => onTargetLangChange(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white p-2.5"
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <SegmentationModeField
        value={segmentationMode}
        onChange={onSegmentationModeChange}
        hint="决定导入 TXT / Office 等文件时如何切分句段；XLIFF / CAT 包沿用文件内原有句段。"
      />
    </div>
  );
};
