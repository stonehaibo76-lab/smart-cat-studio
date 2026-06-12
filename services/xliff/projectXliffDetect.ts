import type { InterchangeFormat, Project, ProjectFile } from '../../types';

export interface ProjectXliffExportCapabilities {
  hasTradosPackage: boolean;
  hasMemoqPackage: boolean;
  hasSdlxliff: boolean;
  hasMqxliff: boolean;
  sdlxliffFileCount: number;
  mqxliffFileCount: number;
}

/** Infer bilingual interchange type from file name, meta, or segment ids. */
export function inferFileInterchangeFormat(file: ProjectFile): InterchangeFormat | null {
  if (file.interchangeFormat === 'sdlxliff' || file.interchangeFormat === 'mqxliff') {
    return file.interchangeFormat;
  }

  const metaFmt = file.interchangeMeta?.format;
  if (metaFmt === 'sdlxliff' || metaFmt === 'mqxliff') return metaFmt;

  const lower = file.name.toLowerCase();
  if (lower.endsWith('.mqxliff')) return 'mqxliff';
  if (lower.endsWith('.sdlxliff') || lower.endsWith('.xlf') || lower.endsWith('.xliff')) {
    return 'sdlxliff';
  }

  if (file.interchangeMeta?.packagePath && file.interchangeMeta?.format) {
    return file.interchangeMeta.format;
  }

  if (file.interchangeMeta?.packagePath || file.interchangeMeta?.originalBlobId) {
    return 'sdlxliff';
  }

  if (file.segments.some((s) => s.xliffSegmentId)) {
    return 'sdlxliff';
  }

  return null;
}

export function getProjectXliffExportCapabilities(
  project: Project | null | undefined
): ProjectXliffExportCapabilities {
  if (!project) {
    return {
      hasTradosPackage: false,
      hasMemoqPackage: false,
      hasSdlxliff: false,
      hasMqxliff: false,
      sdlxliffFileCount: 0,
      mqxliffFileCount: 0,
    };
  }

  const hasTradosPackage = Boolean(project.tradosPackage?.packageBlobId);
  const hasMemoqPackage = Boolean(project.memoqPackage?.packageBlobId);
  let sdlxliffFileCount = 0;
  let mqxliffFileCount = 0;

  for (const file of project.files) {
    const fmt = inferFileInterchangeFormat(file);
    if (fmt === 'sdlxliff') sdlxliffFileCount++;
    if (fmt === 'mqxliff') mqxliffFileCount++;
  }

  return {
    hasTradosPackage,
    hasMemoqPackage,
    hasSdlxliff: sdlxliffFileCount > 0 || hasTradosPackage,
    hasMqxliff: mqxliffFileCount > 0 || hasMemoqPackage,
    sdlxliffFileCount,
    mqxliffFileCount,
  };
}

/** Backfill interchangeFormat on files when missing (e.g. projects saved before XLIFF metadata). */
export function normalizeProjectXliffMeta(project: Project): Project {
  let changed = false;
  const files = project.files.map((file) => {
    const inferred = inferFileInterchangeFormat(file);
    if (inferred && file.interchangeFormat !== inferred) {
      changed = true;
      return { ...file, interchangeFormat: inferred };
    }
    return file;
  });
  return changed ? { ...project, files } : project;
}

export function normalizeProjectsXliffMeta(projects: Project[]): Project[] {
  return projects.map(normalizeProjectXliffMeta);
}
