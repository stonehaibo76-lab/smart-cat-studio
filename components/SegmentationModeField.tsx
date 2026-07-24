import React from 'react';
import type { TranslationSegmentationMode } from '../../types';

interface SegmentationModeFieldProps {
  value: TranslationSegmentationMode;
  onChange: (mode: TranslationSegmentationMode) => void;
  /** 项目设置中变更仅影响后续导入 */
  hint?: string;
}

export const SegmentationModeField: React.FC<SegmentationModeFieldProps> = ({
  value,
  onChange,
  hint,
}) => (
  <div>
    <span className="mb-2 block text-sm font-semibold text-slate-700">翻译模式</span>
    <div className="flex flex-wrap items-center gap-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
      <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-800">
        <input
          type="radio"
          name="segmentationMode"
          checked={value === 'sentence'}
          onChange={() => onChange('sentence')}
          className="text-blue-600"
        />
        按句翻译
      </label>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-800">
        <input
          type="radio"
          name="segmentationMode"
          checked={value === 'paragraph'}
          onChange={() => onChange('paragraph')}
          className="text-blue-600"
        />
        按段翻译
      </label>
    </div>
    {hint ? <p className="mt-1.5 text-xs text-slate-500">{hint}</p> : null}
  </div>
);
