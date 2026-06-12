import * as XLSX from 'xlsx';
import {
  Project,
  SegmentStatus,
  MatchType,
  TermBase,
  TranslationMemory,
  ProjectFile,
  Segment,
} from '../types';
import { shouldAutoLockSegmentAtImport } from './segmentAutoLock';
import { parseDocxForImport } from './catInterop/bilingualDocxHandler';
import { newSourceBlobId, saveSourceBlob } from './catInterop/sourceBlobStore';
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
    inlineRunMeta?: import('../types').InlineRunStyle[];
  }>;
  sourceBlobId?: string;
  docxImportMode?: 'bilingual' | 'monolingual';
  docxBilingualLayout?: 'table' | 'interleaved';
  isXliff?: boolean;
  xliffProject?: ParsedXliffProject;
};

/** Okapi 提取失败时，仅纯文本类格式允许回退为 readAsText。 */
const OKAPI_TEXT_FALLBACK_EXTENSIONS = ['.txt', '.html', '.htm'];

function canReadAsTextFallback(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return OKAPI_TEXT_FALLBACK_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function buildOkapiExtractError(fileName: string, extractedError?: string): string {
  const lower = fileName.toLowerCase();
  const pptxHint =
    '请关闭 SmartCAT-Okapi 窗口后重新运行启动脚本（或 scripts/start-okapi-sidecar.cmd），以加载 PPTX 解析模块。';
  const genericHint = '请确认 Okapi 侧车（http://127.0.0.1:8090）与本地 DB 服务（58741）均已启动。';
  const hint = lower.endsWith('.pptx') ? pptxHint : genericHint;
  if (extractedError?.trim()) return `${extractedError.trim()} ${hint}`;
  return `无法从 ${fileName} 提取句段。${hint}`;
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
};

export async function parseProjectFile(file: File): Promise<UploadedFilePayload> {
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
    const parsedDocx = await parseDocxForImport(arrayBuffer, file.name);
    const { segments: docxSegments } = parsedDocx;
    if (docxSegments.length > 0) {
      return {
        name: file.name,
        content: docxSegments.map((s) => s.source).join('\n'),
        isExcel: true,
        sourceBlobId,
        docxImportMode: parsedDocx.mode,
        docxBilingualLayout: parsedDocx.docxBilingualLayout,
        segments: docxSegments.map((s) => ({
          source: s.source,
          target: s.target,
          okapiTuId: s.okapiTuId,
          inlineRunMeta: s.inlineRunMeta,
        })),
      };
    }
    return { name: file.name, content: '', sourceBlobId };
  }
  if (isOkapiCandidateFile(file.name) && !file.name.endsWith('.docx')) {
    const arrayBuffer = await file.arrayBuffer();
    const sourceBlobId = newSourceBlobId();
    await saveSourceBlob(sourceBlobId, arrayBuffer);
    const extracted = await okapiExtractFile(file);
    if (extracted.ok && extracted.segments?.length) {
      return {
        name: file.name,
        content: extracted.segments.map((s) => s.source).join('\n'),
        isExcel: true,
        sourceBlobId,
        segments: extracted.segments.map((s) => ({
          source: s.source,
          target: s.target || '',
          okapiTuId: s.okapiTuId ?? s.id,
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
  } else if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][];
    const hasMultipleColumns = jsonData.length > 0 && jsonData[0] && jsonData[0].length >= 2;

    if (hasMultipleColumns) {
      const segments = jsonData
        .map((row) => {
          if (!row || row.length < 1) return null;
          const firstCell = String(row[0] || '').trim().toLowerCase();
          if (firstCell === 'source' || firstCell === '原文') {
            const secondCell = String(row[1] || '').trim().toLowerCase();
            if (secondCell === 'target' || secondCell === '译文') {
              return null;
            }
          }
          const source = String(row[0] || '').trim();
          const target = row[1] ? String(row[1] || '').trim() : '';
          if (!source) return null;
          return { source, target };
        })
        .filter((item): item is { source: string; target: string } => item !== null);

      return {
        name: file.name,
        content: segments.map((s) => s.source).join('\n'),
        isExcel: true,
        segments,
      };
    }

    const segments = jsonData
      .map((row) => {
        if (!row || row.length < 1) return null;
        const cellValue = row[0];
        if (cellValue === undefined || cellValue === null || cellValue === '') return null;
        const text = String(cellValue).trim();
        if (!text) return null;
        return { source: text, target: '' };
      })
      .filter((item): item is { source: string; target: string } => item !== null);

    return {
      name: file.name,
      content: segments.map((s) => s.source).join('\n'),
      isExcel: true,
      segments,
    };
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
  form.referenceTmIds.forEach((id) => allTmIds.add(id));

  const allTbIds = new Set<string>();
  if (finalMainTbId) allTbIds.add(finalMainTbId);
  form.referenceTbIds.forEach((id) => allTbIds.add(id));

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
          inlineRunMeta: item.inlineRunMeta,
        };
      });
    } else {
      segs = file.content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line, index) => {
          const text = line.trim();
          const isLocked = shouldAutoLockSegmentAtImport(text, sourceLang);
          return {
            id: `s-${Date.now()}-${fileIdx}-${index}`,
            sourceText: line,
            targetText: isLocked ? line : '',
            status: isLocked ? SegmentStatus.Confirmed : SegmentStatus.NotStarted,
            matchType: MatchType.None,
            isLocked,
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

export function countFileSegments(file: UploadedFilePayload): number | null {
  if (file.isXliff && file.xliffProject) {
    return file.xliffProject.files.reduce((n, f) => n + f.segments.length, 0);
  }
  if (file.isExcel && file.segments) return file.segments.length;
  if (file.content) {
    return file.content.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0).length;
  }
  return null;
}
