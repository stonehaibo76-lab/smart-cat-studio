import React from 'react';
import { Icons } from '../ui/Icons';
import { WIZARD_STEPS, type WizardStepIndex } from '../../hooks/useProjectCreateWizard';

interface WizardStepperProps {
  currentStep: WizardStepIndex;
  onStepClick: (step: WizardStepIndex) => void;
}

export const WizardStepper: React.FC<WizardStepperProps> = ({ currentStep, onStepClick }) => {
  return (
    <nav className="mb-6 border-b border-slate-200 pb-4" aria-label="创建项目步骤">
      <ol className="flex items-center justify-between gap-2">
        {WIZARD_STEPS.map((step, index) => {
          const stepIndex = index as WizardStepIndex;
          const isCompleted = stepIndex < currentStep;
          const isCurrent = stepIndex === currentStep;
          const isClickable = isCompleted;

          return (
            <li key={step.id} className="flex flex-1 items-center min-w-0">
              <button
                type="button"
                onClick={() => isClickable && onStepClick(stepIndex)}
                disabled={!isClickable}
                className={`flex w-full flex-col items-center gap-1.5 transition-colors ${
                  isClickable ? 'cursor-pointer hover:opacity-80' : 'cursor-default'
                }`}
                aria-current={isCurrent ? 'step' : undefined}
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                    isCompleted
                      ? 'bg-blue-600 text-white'
                      : isCurrent
                        ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-500 ring-offset-1'
                        : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {isCompleted ? <Icons.Check className="h-3.5 w-3.5" /> : index + 1}
                </span>
                <span
                  className={`truncate text-center text-[11px] font-semibold leading-tight ${
                    isCurrent ? 'text-blue-700' : isCompleted ? 'text-slate-700' : 'text-slate-400'
                  }`}
                >
                  {step.label}
                </span>
                {isCurrent && (
                  <span className="h-0.5 w-full max-w-[4rem] rounded-full bg-blue-500" />
                )}
              </button>
              {index < WIZARD_STEPS.length - 1 && (
                <div
                  className={`mx-1 h-px w-4 shrink-0 sm:w-8 ${
                    stepIndex < currentStep ? 'bg-blue-400' : 'bg-slate-200'
                  }`}
                  aria-hidden
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
