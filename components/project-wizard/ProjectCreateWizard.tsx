import React from 'react';
import { Icons } from '../ui/Icons';
import { WizardStepper } from './WizardStepper';
import { BasicInfoStep } from './steps/BasicInfoStep';
import { FileImportStep } from './steps/FileImportStep';
import { ResourceMappingStep } from './steps/ResourceMappingStep';
import { SummaryStep } from './steps/SummaryStep';
import { useProjectCreateWizard } from '../../hooks/useProjectCreateWizard';
import type {
  TranslationMemory,
  TermBase,
  GrammarRuleBook,
  RegexDictionaryBook,
  Project,
} from '../../types';

interface ProjectCreateWizardProps {
  isOpen: boolean;
  availableTMs: TranslationMemory[];
  availableTBs: TermBase[];
  availableGrammarRuleBooks: GrammarRuleBook[];
  availableRegexDictionaryBooks: RegexDictionaryBook[];
  onCreateProject: (project: Project, newTM?: TranslationMemory, newTB?: TermBase) => void;
  onClose: () => void;
}

export const ProjectCreateWizard: React.FC<ProjectCreateWizardProps> = ({
  isOpen,
  availableTMs,
  availableTBs,
  availableGrammarRuleBooks,
  availableRegexDictionaryBooks,
  onCreateProject,
  onClose,
}) => {
  const wizard = useProjectCreateWizard({
    isOpen,
    availableTMs,
    availableTBs,
    availableGrammarRuleBooks,
    availableRegexDictionaryBooks,
    onCreateProject,
    onClose,
  });

  if (!isOpen) return null;

  const isLastStep = wizard.currentStep === 3;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="animate-in zoom-in-95 flex max-h-[95vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl duration-200">
        <div className="shrink-0 border-b border-slate-100 px-6 pb-0 pt-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-bold text-slate-900">创建新项目向导</h2>
            <button
              type="button"
              onClick={wizard.handleCancel}
              className="text-slate-400 hover:text-slate-600"
              aria-label="关闭"
            >
              <Icons.X className="h-5 w-5" />
            </button>
          </div>
          <WizardStepper currentStep={wizard.currentStep} onStepClick={wizard.goToStep} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {wizard.currentStep === 0 && (
            <BasicInfoStep
              newProjectName={wizard.formState.newProjectName}
              sourceLang={wizard.formState.sourceLang}
              targetLang={wizard.formState.targetLang}
              onNameChange={wizard.setNewProjectName}
              onSourceLangChange={wizard.setSourceLang}
              onTargetLangChange={wizard.setTargetLang}
            />
          )}
          {wizard.currentStep === 1 && (
            <FileImportStep
              uploadedFiles={wizard.formState.uploadedFiles}
              isParsing={wizard.isParsing}
              xliffLanguageHint={wizard.xliffLanguageHint}
              onFileChange={wizard.handleFileChange}
              onRemoveFile={wizard.handleRemoveFile}
            />
          )}
          {wizard.currentStep === 2 && (
            <ResourceMappingStep
              sourceLang={wizard.formState.sourceLang}
              targetLang={wizard.formState.targetLang}
              projectName={wizard.formState.newProjectName}
              availableTMs={wizard.availableTMs}
              availableTBs={wizard.availableTBs}
              matchingGrammarBooks={wizard.matchingGrammarBooks}
              matchingRegexDictionaryBooks={wizard.matchingRegexDictionaryBooks}
              mainTmId={wizard.formState.mainTmId}
              referenceTmIds={wizard.formState.referenceTmIds}
              mainTbId={wizard.formState.mainTbId}
              referenceTbIds={wizard.formState.referenceTbIds}
              grammarRuleBookIds={wizard.formState.grammarRuleBookIds}
              regexDictionaryBookIds={wizard.formState.regexDictionaryBookIds}
              newTmName={wizard.formState.newTmName}
              newTbName={wizard.formState.newTbName}
              onMainTmChange={wizard.setMainTmId}
              onMainTbChange={wizard.setMainTbId}
              onNewTmNameChange={wizard.setNewTmName}
              onNewTbNameChange={wizard.setNewTbName}
              onToggleRefTm={wizard.toggleRefTm}
              onToggleRefTb={wizard.toggleRefTb}
              onToggleGrammarBook={wizard.toggleGrammarBook}
              onToggleRegexDictionaryBook={wizard.toggleRegexDictionaryBook}
            />
          )}
          {wizard.currentStep === 3 && (
            <SummaryStep
              formState={wizard.formState}
              availableTMs={wizard.availableTMs}
              availableTBs={wizard.availableTBs}
              matchingGrammarBooks={wizard.matchingGrammarBooks}
              matchingRegexDictionaryBooks={wizard.matchingRegexDictionaryBooks}
            />
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-100 px-6 py-4">
          <button
            type="button"
            onClick={wizard.handleCancel}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            取消
          </button>
          <div className="flex gap-3">
            {wizard.currentStep > 0 && (
              <button
                type="button"
                onClick={wizard.prev}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                上一步
              </button>
            )}
            {isLastStep ? (
              <button
                type="button"
                onClick={wizard.submit}
                disabled={!wizard.canProceed}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-md shadow-blue-500/20 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                创建项目
              </button>
            ) : (
              <button
                type="button"
                onClick={wizard.next}
                disabled={!wizard.canProceed}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-md shadow-blue-500/20 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                下一步
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
