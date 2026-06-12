import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  TranslationMemory,
  TermBase,
  GrammarRuleBook,
  RegexDictionaryBook,
  Project,
} from '../types';
import {
  parseProjectFile,
  createProjectFromWizard,
  getXliffLanguageHint,
  type UploadedFilePayload,
  type ProjectCreateFormState,
} from '../services/projectCreateService';

export const WIZARD_STEPS = [
  { id: 'basic', label: '基本信息' },
  { id: 'files', label: '导入文件' },
  { id: 'resources', label: '资源挂载' },
  { id: 'summary', label: '确认创建' },
] as const;

export type WizardStepIndex = 0 | 1 | 2 | 3;

interface UseProjectCreateWizardOptions {
  isOpen: boolean;
  availableTMs: TranslationMemory[];
  availableTBs: TermBase[];
  availableGrammarRuleBooks: GrammarRuleBook[];
  availableRegexDictionaryBooks: RegexDictionaryBook[];
  onCreateProject: (project: Project, newTM?: TranslationMemory, newTB?: TermBase) => void;
  onClose: () => void;
}

export function useProjectCreateWizard({
  isOpen,
  availableTMs,
  availableTBs,
  availableGrammarRuleBooks,
  availableRegexDictionaryBooks,
  onCreateProject,
  onClose,
}: UseProjectCreateWizardOptions) {
  const [currentStep, setCurrentStep] = useState<WizardStepIndex>(0);
  const [newProjectName, setNewProjectName] = useState('');
  const [sourceLang, setSourceLang] = useState('en-US');
  const [targetLang, setTargetLang] = useState('zh-CN');
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFilePayload[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [mainTmId, setMainTmId] = useState('');
  const [referenceTmIds, setReferenceTmIds] = useState<Set<string>>(new Set());
  const [mainTbId, setMainTbId] = useState('');
  const [referenceTbIds, setReferenceTbIds] = useState<Set<string>>(new Set());
  const [grammarRuleBookIds, setGrammarRuleBookIds] = useState<Set<string>>(new Set());
  const [regexDictionaryBookIds, setRegexDictionaryBookIds] = useState<Set<string>>(new Set());
  const [newTmName, setNewTmName] = useState('');
  const [newTbName, setNewTbName] = useState('');

  const reset = useCallback(() => {
    setCurrentStep(0);
    setNewProjectName('');
    setSourceLang('en-US');
    setTargetLang('zh-CN');
    setUploadedFiles([]);
    setIsParsing(false);
    setMainTmId(availableTMs.length > 0 ? availableTMs[0].id : 'create-new');
    setReferenceTmIds(new Set());
    setMainTbId(availableTBs.length > 0 ? availableTBs[0].id : 'create-new');
    setReferenceTbIds(new Set());
    setGrammarRuleBookIds(new Set());
    setRegexDictionaryBookIds(new Set());
    setNewTmName('');
    setNewTbName('');
  }, [availableTMs, availableTBs]);

  useEffect(() => {
    if (isOpen) reset();
  }, [isOpen, reset]);

  const formState: ProjectCreateFormState = useMemo(
    () => ({
      newProjectName,
      sourceLang,
      targetLang,
      uploadedFiles,
      mainTmId,
      referenceTmIds,
      mainTbId,
      referenceTbIds,
      grammarRuleBookIds,
      regexDictionaryBookIds,
      newTmName,
      newTbName,
    }),
    [
      newProjectName,
      sourceLang,
      targetLang,
      uploadedFiles,
      mainTmId,
      referenceTmIds,
      mainTbId,
      referenceTbIds,
      grammarRuleBookIds,
      regexDictionaryBookIds,
      newTmName,
      newTbName,
    ]
  );

  const stepValidators = useMemo(
    () => [
      () => newProjectName.trim().length > 0,
      () => uploadedFiles.length > 0 && !isParsing,
      () => true,
      () => newProjectName.trim().length > 0 && uploadedFiles.length > 0 && !isParsing,
    ],
    [newProjectName, uploadedFiles.length, isParsing]
  );

  const canProceed = stepValidators[currentStep]();

  const matchingGrammarBooks = useMemo(
    () =>
      availableGrammarRuleBooks.filter(
        (g) => g.sourceLang === sourceLang && g.targetLang === targetLang
      ),
    [availableGrammarRuleBooks, sourceLang, targetLang]
  );

  const matchingRegexDictionaryBooks = useMemo(
    () =>
      availableRegexDictionaryBooks.filter(
        (b) => b.sourceLang === sourceLang && b.targetLang === targetLang
      ),
    [availableRegexDictionaryBooks, sourceLang, targetLang]
  );

  const xliffLanguageHint = useMemo(
    () => getXliffLanguageHint(uploadedFiles, sourceLang, targetLang),
    [uploadedFiles, sourceLang, targetLang]
  );

  const goToStep = useCallback((step: WizardStepIndex) => {
    setCurrentStep(step);
  }, []);

  const next = useCallback(() => {
    if (!stepValidators[currentStep]()) return;
    if (currentStep < 3) setCurrentStep((s) => (s + 1) as WizardStepIndex);
  }, [currentStep, stepValidators]);

  const prev = useCallback(() => {
    if (currentStep > 0) setCurrentStep((s) => (s - 1) as WizardStepIndex);
  }, [currentStep]);

  const handleFileChange = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      if (!newProjectName.trim()) {
        const firstFileName = files[0].name;
        setNewProjectName(firstFileName.replace(/\.[^/.]+$/, ''));
      }
      setIsParsing(true);
      try {
        const results = await Promise.all(Array.from(files).map((file) => parseProjectFile(file)));
        setUploadedFiles((prev) => [...prev, ...results]);
      } catch (error) {
        console.error('File parsing error', error);
        alert('部分文件解析失败，请重试');
      } finally {
        setIsParsing(false);
      }
    },
    [newProjectName]
  );

  const handleRemoveFile = useCallback((index: number) => {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleMainTmChange = useCallback((id: string) => {
    setMainTmId(id);
    if (id !== 'none' && id !== 'create-new') {
      setReferenceTmIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, []);

  const handleMainTbChange = useCallback((id: string) => {
    setMainTbId(id);
    if (id !== 'none' && id !== 'create-new') {
      setReferenceTbIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, []);

  const toggleRefTm = useCallback((id: string) => {
    setReferenceTmIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleRefTb = useCallback((id: string) => {
    setReferenceTbIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleGrammarBook = useCallback((id: string) => {
    setGrammarRuleBookIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleRegexDictionaryBook = useCallback((id: string) => {
    setRegexDictionaryBookIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const submit = useCallback(() => {
    const ok = createProjectFromWizard(formState, onCreateProject);
    if (ok) onClose();
  }, [formState, onCreateProject, onClose]);

  const handleCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  return {
    currentStep,
    formState,
    canProceed,
    isParsing,
    matchingGrammarBooks,
    matchingRegexDictionaryBooks,
    xliffLanguageHint,
    availableTMs,
    availableTBs,
    setNewProjectName,
    setSourceLang,
    setTargetLang,
    setMainTmId: handleMainTmChange,
    setMainTbId: handleMainTbChange,
    setNewTmName,
    setNewTbName,
    goToStep,
    next,
    prev,
    handleFileChange,
    handleRemoveFile,
    toggleRefTm,
    toggleRefTb,
    toggleGrammarBook,
    toggleRegexDictionaryBook,
    submit,
    handleCancel,
  };
}
