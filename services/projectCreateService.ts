import {
  Project,
  SegmentStatus,
  MatchType,
  TermBase,
  TranslationMemory,
  ProjectFile,
  Segment,
  TranslationSegmentationMode,
} from '../types';
import { shouldAutoLockSegmentAtImport } from './segmentAutoLock';
import {
  applySegmentationToExtractedSegments,
  resolveSegmentationMode,
  splitPlainTextToSources,
} from './translationSegmentation';
import {
  parseBilingualDocx,
  isLikelyBilingualDocxFileName,
} from './catInterop/bilingualDocxHandler';
import { newSourceBlobId, saveSourceBlob } from './catInterop/sourceBlobStore';
import { parseSimpleXlsx, type SimpleXlsxSegment } from './catInterop/xlsxImport';
import { okapiExtractFile, isOkapiCandidateFile } from './okapiClient';
import {
  parseXliffFile,
  parseTradosPackage,
  parseMemoqPackage,
  detectXliffKind,
  buildProjectFileFromParsed,
  type ParsedXliffProject,
} from './xliff/xliffImport';

export type UploadedFilePayload = {
  name: string;
  content: string;
  isExcel?: boolean;
  segments?: Array<{
    source: string;
    target: string;
    okapiTuId?: string;
    okapiSegmentIndex?: number;
    inlineRunMeta?: import('../types').InlineRunStyle[];
  }>;
  sourceBlobId?: string;
  docxImportMode?: 'bilingual' | 'monolingual';
  docxBilingualLayout?: 'table' | 'interleaved';
  importEngine?: 'okapi-java' | 'okapi-python' | 'docx-ts';
  isXliff?: boolean;
  xliffProject?: ParsedXliffProject;
};

/** Okapi 提取失败时，仅纯文本类格式允许回退为 readAsText。 */
const OKAPI_TEXT_FALLBACK_EXTENSIONS = ['.txt', '.html', '.htm'];

function canReadAsTextFallback(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return OKAPI_TEXT_FALLBACK_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export type ParseProjectFileOptions = {
  sourceLang?: string;
  targetLang?: string;
  segmentationMode?: TranslationSegmentationMode;
};

function processExtractedSegments<T extends { source: string; target?: string; okapiTuId?: string; okapiSegmentIndex?: number; inlineRunMeta?: import('../types').InlineRunStyle[]; id?: string }>(
  segments: T[],
  opts?: ParseProjectFileOptions
): T[] {
  return applySegmentationToExtractedSegments(segments, resolveSegmentationMode(opts?.segmentationMode));
}

function buildOkapiExtractError(fileName: string, extractedError?: string): string {
  const lower = fileName.toLowerCase();
  const docxHint =
    '请确认 Python Okapi 侧车（http://127.0.0.1:8090）与本地 DB 服务（58741）均已启动。';
  const officeHint =
    '请确认 Java Okapi 侧车（http://127.0.0.1:8091）已启动：scripts/start-okapi-java-sidecar.cmd，并安装 Java 17+ 或使用便携版 bundled JRE。';
  const genericHint =
    '请确认 Okapi 侧车（http://127.0.0.1:8090）与本地 DB 服务（58741）均已启动。';
  const hint = lower.endsWith('.docx')
    ? docxHint
    : lower.endsWith('.pptx') || lower.endsWith('.xlsx')
      ? officeHint
      : genericHint;
  if (extractedError?.trim()) return `${extractedError.trim()} ${hint}`;
  return `无法从 ${fileName} 提取句段。${hint}`;
}

function buildPythonDocxImportPayload(
  fileName: string,
  sourceBlobId: string,
  extracted: { segments: Array<{
    id: string;
    source: string;
    target?: string;
    okapiTuId?: string;
    inlineRunMeta?: import('../types').InlineRunStyle[];
  }> }
): UploadedFilePayload {
  return {
    name: fileName,
    content: extracted.segments.map((s) => s.source).join('\n'),
    isExcel: true,
    sourceBlobId,
    importEngine: 'okapi-python',
    docxImportMode: 'monolingual',
    segments: extracted.segments.map((s) => ({
      source: s.source,
      target: s.target || '',
      okapiTuId: s.okapiTuId ?? s.id,
      okapiSegmentIndex: 0,
      inlineRunMeta: s.inlineRunMeta,
    })),
  };
}

function buildSimpleXlsxImportPayload(
  fileName: string,
  sourceBlobId: string,
  segments: SimpleXlsxSegment[]
): UploadedFilePayload {
  return {
    name: fileName,
    content: segments.map((s) => s.source).join('\n'),
    isExcel: true,
    sourceBlobId,
    segments: segments.map((s) => ({
      source: s.source,
      target: s.target,
    })),
  };
}

async function parseXlsxProjectFile(
  file: File,
  opts?: ParseProjectFileOptions
): Promise<UploadedFilePayload> {
  const arrayBuffer = await file.arrayBuffer();
  const sourceBlobId = newSourceBlobId();
  await saveSourceBlob(sourceBlobId, arrayBuffer);

  const extracted = await okapiExtractFile(file, undefined, {
    sourceLang: opts?.sourceLang,
    targetLang: opts?.targetLang,
    segmentationMode: opts?.segmentationMode,
  });
  if (extracted.ok && extracted.segments?.length) {
    const processed = processExtractedSegments(extracted.segments, opts);
    return buildOkapiJavaImportPayload(file.name, sourceBlobId, { segments: processed });
  }

  const simple = parseSimpleXlsx(arrayBuffer);
  if (simple?.length) {
    return buildSimpleXlsxImportPayload(file.name, sourceBlobId, simple);
  }

  throw new Error(buildOkapiExtractError(file.name, extracted.error));
}

function buildOkapiJavaImportPayload(
  fileName: string,
  sourceBlobId: string,
  extracted: { segments: Array<{
    id: string;
    source: string;
    target?: string;
    okapiTuId?: string;
    okapiSegmentIndex?: number;
    inlineRunMeta?: import('../types').InlineRunStyle[];
  }> },
  extra?: { docxImportMode?: 'monolingual' }
): UploadedFilePayload {
  return {
    name: fileName,
    content: extracted.segments.map((s) => s.source).join('\n'),
    isExcel: true,
    sourceBlobId,
    importEngine: 'okapi-java',
    docxImportMode: extra?.docxImportMode,
    segments: extracted.segments.map((s) => ({
      source: s.source,
      target: s.target || '',
      okapiTuId: s.okapiTuId ?? s.id,
      okapiSegmentIndex: s.okapiSegmentIndex ?? 0,
      inlineRunMeta: s.inlineRunMeta,
    })),
  };
}

export type ProjectCreateFormState = {
  newProjectName: string;
  sourceLang: string;
  targetLang: string;
  uploadedFiles: UploadedFilePayload[];
  mainTmId: string;
  referenceTmIds: Set<string>;
  mainTbId: string;
  referenceTbIds: Set<string>;
  grammarRuleBookIds: Set<string>;
  regexDictionaryBookIds: Set<string>;
  newTmName: string;
  newTbName: string;
  segmentationMode: TranslationSegmentationMode;
};

export async function parseProjectFile(
  file: File,
  opts?: ParseProjectFileOptions
): Promise<UploadedFilePayload> {
  const xliffKind = detectXliffKind(file.name);
  if (xliffKind === 'trados-package') {
    const xliffProject = await parseTradosPackage(file);
    return {
      name: file.name,
      content: '',
      isXliff: true,
      xliffProject,
    };
  }
  if (xliffKind === 'memoq-package') {
    const xliffProject = await parseMemoqPackage(file);
    return {
      name: file.name,
      content: '',
      isXliff: true,
      xliffProject,
    };
  }
  if (xliffKind === 'sdlxliff' || xliffKind === 'mqxliff') {
    const xliffProject = await parseXliffFile(file);
    return {
      name: file.name,
      content: '',
      isXliff: true,
      xliffProject,
    };
  }
  if (file.name.endsWith('.docx')) {
    const arrayBuffer = await file.arrayBuffer();
    const sourceBlobId = newSourceBlobId();
    await saveSourceBlob(sourceBlobId, arrayBuffer);

    const nameHint = isLikelyBilingualDocxFileName(file.name);
    const bilingual = await parseBilingualDocx(arrayBuffer, { allowAlternatingParas: nameHint });
    if (bilingual && bilingual.segments.length > 0) {
      return {
        name: file.name,
        content: bilingual.segments.map((s) => s.source).join('\n'),
        isExcel: true,
        sourceBlobId,
        docxImportMode: 'bilingual',
        docxBilingualLayout: bilingual.layout,
        importEngine: 'docx-ts',
        segments: bilingual.segments.map((s) => ({
          source: s.source,
          target: s.target,
          okapiTuId: s.okapiTuId,
          inlineRunMeta: s.inlineRunMeta,
        })),
      };
    }

    const extracted = await okapiExtractFile(file, undefined, {
      sourceLang: opts?.sourceLang,
      targetLang: opts?.targetLang,
      segmentationMode: opts?.segmentationMode,
    });
    if (!extracted.ok || !extracted.segments?.length) {
      throw new Error(buildOkapiExtractError(file.name, extracted.error));
    }
    const processed = processExtractedSegments(extracted.segments, opts);
    return buildPythonDocxImportPayload(file.name, sourceBlobId, { segments: processed });
  }
  if (isOkapiCandidateFile(file.name) && !file.name.endsWith('.docx')) {
    const arrayBuffer = await file.arrayBuffer();
    const sourceBlobId = newSourceBlobId();
    await saveSourceBlob(sourceBlobId, arrayBuffer);
    const extracted = await okapiExtractFile(file, undefined, {
      sourceLang: opts?.sourceLang,
      targetLang: opts?.targetLang,
      segmentationMode: opts?.segmentationMode,
    });
    if (extracted.ok && extracted.segments?.length) {
      const processed = processExtractedSegments(extracted.segments, opts);
      const lower = file.name.toLowerCase();
      const importEngine =
        lower.endsWith('.pptx') || lower.endsWith('.xlsx') ? ('okapi-java' as const) : undefined;
      return {
        name: file.name,
        content: processed.map((s) => s.source).join('\n'),
        isExcel: true,
        sourceBlobId,
        importEngine,
        segments: processed.map((s) => ({
          source: s.source,
          target: s.target || '',
          okapiTuId: s.okapiTuId ?? s.id,
          okapiSegmentIndex: s.okapiSegmentIndex ?? 0,
          inlineRunMeta: s.inlineRunMeta,
        })),
      };
    }
    if (!canReadAsTextFallback(file.name)) {
      throw new Error(buildOkapiExtractError(file.name, extracted.error));
    }
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        resolve({
          name: file.name,
          content: (event.target?.result as string) || '',
          sourceBlobId,
        });
      };
      reader.readAsText(file);
    });
  }
  if (
    file.name.toLowerCase().endsWith('.xlsx') ||
    file.name.toLowerCase().endsWith('.xlsm')
  ) {
    return parseXlsxProjectFile(file, opts);
  }
  if (file.name.toLowerCase().endsWith('.xls')) {
    const arrayBuffer = await file.arrayBuffer();
    const simple = parseSimpleXlsx(arrayBuffer);
    if (simple?.length) {
      const sourceBlobId = newSourceBlobId();
      await saveSourceBlob(sourceBlobId, arrayBuffer);
      return buildSimpleXlsxImportPayload(file.name, sourceBlobId, simple);
    }
    throw new Error(
      '无法解析该 Excel (.xls) 文件。请另存为 .xlsx 后重试，或使用 Trados SDLXLIFF 工作流。'
    );
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      resolve({ name: file.name, content: event.target?.result as string });
    };
    reader.readAsText(file);
  });
}

export function createProjectFromWizard(
  form: ProjectCreateFormState,
  onCreateProject: (project: Project, newTM?: TranslationMemory, newTB?: TermBase) => void
): boolean {
  const { newProjectName, uploadedFiles, sourceLang, targetLang } = form;
  if (!newProjectName.trim() || uploadedFiles.length === 0) return false;

  let finalMainTmId = form.mainTmId;
  let newTM: TranslationMemory | undefined;

  if (form.mainTmId === 'create-new') {
    finalMainTmId = `tm-${Date.now()}`;
    newTM = {
      id: finalMainTmId,
      name: form.newTmName || `${newProjectName} TM`,
      sourceLang,
      targetLang,
      units: [],
      createdAt: new Date().toISOString().split('T')[0],
    };
  } else if (form.mainTmId === 'none') {
    finalMainTmId = '';
  }

  let finalMainTbId = form.mainTbId;
  let newTB: TermBase | undefined;

  if (form.mainTbId === 'create-new') {
    finalMainTbId = `tb-${Date.now()}`;
    newTB = {
      id: finalMainTbId,
      name: form.newTbName || `${newProjectName} TB`,
      sourceLang,
      targetLang,
      entries: [],
      createdAt: new Date().toISOString().split('T')[0],
    };
  } else if (form.mainTbId === 'none') {
    finalMainTbId = '';
  }

  const allTmIds = new Set<string>();
  if (finalMainTmId) allTmIds.add(finalMainTmId);
  form.referenceTmIds.forEach((id) => {
    if (id && id !== finalMainTmId) allTmIds.add(id);
  });

  const allTbIds = new Set<string>();
  if (finalMainTbId) allTbIds.add(finalMainTbId);
  form.referenceTbIds.forEach((id) => {
    if (id && id !== finalMainTbId) allTbIds.add(id);
  });

  let totalSegments = 0;

  const xliffUpload = uploadedFiles.find((f) => f.isXliff && f.xliffProject);
  if (xliffUpload?.xliffProject) {
    const xp = xliffUpload.xliffProject;
    const langSrc = xp.sourceLang || sourceLang;
    const langTgt = xp.targetLang || targetLang;
    const projectFiles: ProjectFile[] = xp.files.map((pf, fileIdx) =>
      buildProjectFileFromParsed(pf, fileIdx, langSrc)
    );
    const xliffTotalSegments = projectFiles.reduce((n, f) => n + f.totalSegments, 0);
    const confirmed = projectFiles.reduce(
      (n, f) => n + f.segments.filter((s) => s.status === SegmentStatus.Confirmed).length,
      0
    );
    const newProject: Project = {
      id: `p-${Date.now()}`,
      name: newProjectName,
      sourceLang: langSrc,
      targetLang: langTgt,
      createdAt: new Date().toISOString().split('T')[0],
      progress: xliffTotalSegments > 0 ? Math.round((confirmed / xliffTotalSegments) * 100) : 0,
      totalSegments: xliffTotalSegments,
      files: projectFiles,
      mainTmId: finalMainTmId,
      tmIds: Array.from(allTmIds),
      mainTbId: finalMainTbId,
      tbIds: Array.from(allTbIds),
      grammarRuleBookIds: Array.from(form.grammarRuleBookIds),
      regexDictionaryBookIds: Array.from(form.regexDictionaryBookIds),
      contextDescription: '',
      segmentationMode: form.segmentationMode,
      tradosPackage: xp.tradosPackage,
      memoqPackage: xp.memoqPackage,
    };
    onCreateProject(newProject, newTM, newTB);
    return true;
  }

  const projectFiles: ProjectFile[] = uploadedFiles.map((file, fileIdx) => {
    let segs: Segment[];

    if (file.isExcel && file.segments) {
      segs = file.segments.map((item, index) => {
        const text = item.source.trim();
        const translation = item.target ? item.target.trim() : '';
        let isLocked = false;
        let targetText = '';
        let status = SegmentStatus.NotStarted;

        if (translation && translation !== text) {
          targetText = translation;
          status = SegmentStatus.Draft;
        }

        isLocked = shouldAutoLockSegmentAtImport(text, sourceLang);

        if (isLocked) {
          targetText = text;
          status = SegmentStatus.Confirmed;
        }

        return {
          id: `s-${Date.now()}-${fileIdx}-${index}`,
          sourceText: text,
          targetText,
          status,
          matchType: MatchType.None,
          isLocked,
          okapiTuId: item.okapiTuId ?? `p-${index}`,
          okapiSegmentIndex: item.okapiSegmentIndex ?? 0,
          inlineRunMeta: item.inlineRunMeta,
        };
      });
    } else {
      const sources = splitPlainTextToSources(
        file.content,
        resolveSegmentationMode(form.segmentationMode)
      );
      segs = sources.map((line, index) => {
        const text = line.trim();
        const isLocked = shouldAutoLockSegmentAtImport(text, sourceLang);
        return {
          id: `s-${Date.now()}-${fileIdx}-${index}`,
          sourceText: line,
          targetText: isLocked ? line : '',
          status: isLocked ? SegmentStatus.Confirmed : SegmentStatus.NotStarted,
          matchType: MatchType.None,
          isLocked,
          okapiTuId: `p-${index}`,
          okapiSegmentIndex: 0,
        };
      });
    }

    totalSegments += segs.length;
    const lockedCount = segs.filter((s) => s.isLocked).length;
    const initialProgress = segs.length > 0 ? Math.round((lockedCount / segs.length) * 100) : 0;

    return {
      id: `f-${Date.now()}-${fileIdx}`,
      name: file.name,
      segments: segs,
      totalSegments: segs.length,
      progress: initialProgress,
      sourceBlobId: file.sourceBlobId,
      docxImportMode: file.docxImportMode,
      docxBilingualLayout: file.docxBilingualLayout,
      importEngine: file.importEngine,
    };
  });

  const newProject: Project = {
    id: `p-${Date.now()}`,
    name: newProjectName,
    sourceLang,
    targetLang,
    createdAt: new Date().toISOString().split('T')[0],
    progress:
      totalSegments > 0
        ? Math.round(
            (projectFiles.reduce((acc, f) => acc + (f.progress / 100) * f.totalSegments, 0) /
              totalSegments) *
              100
          )
        : 0,
    totalSegments,
    files: projectFiles,
    mainTmId: finalMainTmId,
    tmIds: Array.from(allTmIds),
    mainTbId: finalMainTbId,
    tbIds: Array.from(allTbIds),
    grammarRuleBookIds: Array.from(form.grammarRuleBookIds),
    regexDictionaryBookIds: Array.from(form.regexDictionaryBookIds),
    contextDescription: '',
    segmentationMode: form.segmentationMode,
  };

  onCreateProject(newProject, newTM, newTB);
  return true;
}

export function getXliffLanguageHint(
  uploadedFiles: UploadedFilePayload[],
  sourceLang: string,
  targetLang: string
): { sourceLang: string; targetLang: string; differsFromForm: boolean } | null {
  const xliff = uploadedFiles.find((f) => f.isXliff && f.xliffProject);
  if (!xliff?.xliffProject) return null;
  const xlSrc = xliff.xliffProject.sourceLang || sourceLang;
  const xlTgt = xliff.xliffProject.targetLang || targetLang;
  const differsFromForm =
    (xliff.xliffProject.sourceLang && xliff.xliffProject.sourceLang !== sourceLang) ||
    (xliff.xliffProject.targetLang && xliff.xliffProject.targetLang !== targetLang);
  return { sourceLang: xlSrc, targetLang: xlTgt, differsFromForm };
}

export function getEffectiveLanguages(
  form: Pick<ProjectCreateFormState, 'sourceLang' | 'targetLang' | 'uploadedFiles'>
): { sourceLang: string; targetLang: string } {
  const hint = getXliffLanguageHint(form.uploadedFiles, form.sourceLang, form.targetLang);
  if (hint) return { sourceLang: hint.sourceLang, targetLang: hint.targetLang };
  return { sourceLang: form.sourceLang, targetLang: form.targetLang };
}

export function countFileSegments(
  file: UploadedFilePayload,
  segmentationMode?: TranslationSegmentationMode
): number | null {
  if (file.isXliff && file.xliffProject) {
    return file.xliffProject.files.reduce((n, f) => n + f.segments.length, 0);
  }
  if (file.isExcel && file.segments) return file.segments.length;
  if (file.content) {
    return splitPlainTextToSources(file.content, resolveSegmentationMode(segmentationMode)).length;
  }
  return null;
}
