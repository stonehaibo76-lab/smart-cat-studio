import type { KnowledgeBase, KnowledgeChunk, EmbeddingSettings } from '../types';
import { embedTexts } from './embeddingClient';

const ragCollectTokens = (text: string): Set<string> => {
  const set = new Set<string>();
  const t = text.trim();
  if (!t) return set;

  const words = t.toLowerCase().match(/[a-z0-9][a-z0-9._-]*/g) || [];
  words.forEach((w) => {
    if (w.length >= 2) set.add(w);
  });

  const cjk = t.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || [];
  cjk.forEach((c) => set.add(c));
  for (let i = 0; i < cjk.length - 1; i++) {
    set.add(cjk[i] + cjk[i + 1]);
  }

  return set;
};

/** 句段原文与知识块文本的相似度得分（词法 / 关键词） */
const scoreQueryAgainstChunkText = (query: string, chunkText: string): number => {
  const s = query.trim();
  const p = chunkText.trim();
  if (!s || !p) return 0;

  let score = 0;
  const sLow = s.toLowerCase();
  const pLow = p.toLowerCase();

  if (p.length >= 2 && sLow.includes(pLow)) score += 0.35;
  else if (s.length >= 2 && pLow.includes(sLow)) score += 0.28;
  else {
    const shorter = p.length <= s.length ? p : s;
    const longer = p.length <= s.length ? s : p;
    if (shorter.length >= 4) {
      const chunk = shorter.slice(0, Math.min(shorter.length, 14));
      if (longer.toLowerCase().includes(chunk.toLowerCase())) score += 0.15;
    }
  }

  const A = ragCollectTokens(s);
  const B = ragCollectTokens(p);
  if (A.size === 0 && B.size === 0) return score;

  let inter = 0;
  A.forEach((tok) => {
    if (B.has(tok)) inter++;
  });
  const union = A.size + B.size - inter;
  const jaccard = union > 0 ? inter / union : 0;
  const chunkHitRate = B.size > 0 ? inter / B.size : 0;
  const queryRecall = A.size > 0 ? inter / A.size : 0;

  score += jaccard * 0.45 + chunkHitRate * 0.35 + queryRecall * 0.25;
  return score;
};

export type ChunkForRetrieval = {
  id: string;
  text: string;
  sourceLabel: string;
  embedding?: number[];
  embeddingModel?: string;
};

/** 滑动窗口切块（导入或保存时调用） */
export const chunkKnowledgeText = (
  raw: string,
  options?: { maxChars?: number; overlap?: number; baseId?: string }
): KnowledgeChunk[] => {
  const maxChars = options?.maxChars ?? 300;
  const overlap = options?.overlap ?? 50;
  const baseId = options?.baseId ?? 'kc';
  const text = raw.replace(/\r\n/g, '\n').trim();
  if (!text) return [];

  const out: KnowledgeChunk[] = [];
  let start = 0;
  let i = 0;
  while (start < text.length) {
    const end = Math.min(start + maxChars, text.length);
    const slice = text.slice(start, end).trim();
    if (slice.length > 0) {
      out.push({
        id: `${baseId}-${i}-${Math.random().toString(36).slice(2, 9)}`,
        text: slice,
        sourceLabel: `块${i + 1}`
      });
      i++;
    }
    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return out;
};

/**
 * 取出对当前项目生效且已启用的知识块（扁平列表）。
 * projectId 为 null 时仅包含「全局」知识库（projectIds 为空）。
 */
export const flattenKnowledgeChunksForProject = (
  knowledgeBases: KnowledgeBase[],
  projectId: string | null
): ChunkForRetrieval[] => {
  const out: ChunkForRetrieval[] = [];
  for (const kb of knowledgeBases) {
    if (!kb.enabled || kb.chunks.length === 0) continue;
    const globalKb = kb.projectIds.length === 0;
    const matchesProject =
      projectId != null && kb.projectIds.includes(projectId);
    if (projectId == null && !globalKb) continue;
    if (projectId != null && !globalKb && !matchesProject) continue;

    for (const c of kb.chunks) {
      out.push({
        id: c.id,
        text: c.text,
        sourceLabel: `${kb.name} · ${c.sourceLabel}`,
        embedding: c.embedding,
        embeddingModel: c.embeddingModel
      });
    }
  }
  return out;
};

/** 按与 query 的相似度取 topK 块 */
export const retrieveTopKnowledgeChunks = (
  query: string,
  flatChunks: ChunkForRetrieval[],
  topK: number = 5
): ChunkForRetrieval[] => {
  if (flatChunks.length === 0 || !query.trim()) return [];
  const scored = flatChunks.map((c) => ({
    c,
    score: scoreQueryAgainstChunkText(query, c.text)
  }));
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]?.score ?? 0;
  if (best < 1e-6) return [];
  return scored.slice(0, topK).map((x) => x.c);
};

const dotProduct = (a: number[], b: number[]): number => {
  if (!a?.length || !b?.length || a.length !== b.length) return -1;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

/** 仅向量（句段与块均已 L2 归一化时点积=余弦相似度） */
export const retrieveTopKnowledgeChunksVector = (
  queryVec: number[],
  flatChunks: ChunkForRetrieval[],
  topK: number = 5
): ChunkForRetrieval[] => {
  const dim = queryVec.length;
  const candidates = flatChunks.filter(
    (c) => c.embedding && c.embedding.length === dim
  );
  if (candidates.length === 0) return [];
  const scored = candidates.map((c) => ({
    c,
    score: dotProduct(queryVec, c.embedding as number[])
  }));
  scored.sort((a, b) => b.score - a.score);
  if ((scored[0]?.score ?? -2) < 0.05) return [];
  return scored.slice(0, topK).map((x) => x.c);
};

/** 向量 + 词法加权 */
export const retrieveTopKnowledgeChunksHybrid = (
  query: string,
  queryVec: number[],
  flatChunks: ChunkForRetrieval[],
  topK: number,
  lexicalWeight: number
): ChunkForRetrieval[] => {
  const dim = queryVec.length;
  const wLex = Math.max(0, Math.min(1, lexicalWeight));
  const wVec = 1 - wLex;
  const candidates = flatChunks.filter(
    (c) => c.embedding && c.embedding.length === dim
  );
  if (candidates.length === 0) return [];

  const lexList = candidates.map((c) => scoreQueryAgainstChunkText(query, c.text));
  const maxLex = Math.max(...lexList, 1e-6);

  const scored = candidates.map((c, i) => {
    const dot = dotProduct(queryVec, c.embedding as number[]);
    const vecN = (dot + 1) / 2;
    const lexN = lexList[i] / maxLex;
    return { c, score: wVec * vecN + wLex * lexN };
  });
  scored.sort((a, b) => b.score - a.score);
  if ((scored[0]?.score ?? 0) < 1e-6) return [];
  return scored.slice(0, topK).map((x) => x.c);
};

/** 拼成送入模型的参考资料段落（控制总长度） */
export const formatKnowledgeRagContext = (
  chunks: ChunkForRetrieval[],
  maxTotalChars: number = 2800
): string => {
  if (chunks.length === 0) return '';
  const lines: string[] = [];
  let used = 0;
  chunks.forEach((c, idx) => {
    const header = `${idx + 1}. （来源: ${c.sourceLabel}）\n`;
    let body = c.text;
    if (used + header.length + body.length > maxTotalChars) {
      body = body.slice(0, Math.max(0, maxTotalChars - used - header.length - 20)) + '…';
    }
    if (body.trim().length === 0) return;
    const block = header + body;
    if (used + block.length > maxTotalChars) return;
    lines.push(block);
    used += block.length + 1;
  });
  return lines.join('\n\n');
};

/** 从知识库列表构建 RAG 字符串；无可用内容时返回 undefined */
export const buildRagContextString = (
  sourceQuery: string,
  knowledgeBases: KnowledgeBase[],
  projectId: string | null,
  topK: number = 5,
  maxTotalChars: number = 2800
): string | undefined => {
  const flat = flattenKnowledgeChunksForProject(knowledgeBases, projectId);
  if (flat.length === 0) return undefined;
  const top = retrieveTopKnowledgeChunks(sourceQuery, flat, topK);
  if (top.length === 0) return undefined;
  const body = formatKnowledgeRagContext(top, maxTotalChars);
  if (!body.trim()) return undefined;
  return body;
};

/**
 * 异步 RAG：启用向量/hybrid 且存在块向量时先调本地 embedding，失败或无向量则词法回退。
 */
export const buildRagContextStringAsync = async (
  sourceQuery: string,
  knowledgeBases: KnowledgeBase[],
  projectId: string | null,
  embeddingSettings: EmbeddingSettings | null | undefined,
  topK: number = 5,
  maxTotalChars: number = 2800
): Promise<string | undefined> => {
  const flat = flattenKnowledgeChunksForProject(knowledgeBases, projectId);
  if (flat.length === 0 || !sourceQuery.trim()) return undefined;

  const es = embeddingSettings;
  const useEmbed =
    es?.enabled &&
    es.serviceUrl?.trim() &&
    (es.ragMode === 'vector' || es.ragMode === 'hybrid');

  let top: ChunkForRetrieval[] = [];

  if (useEmbed) {
    const withVec = flat.filter((c) => c.embedding && c.embedding.length > 0);
    if (withVec.length > 0) {
      try {
        const { vectors } = await embedTexts(es.serviceUrl, [sourceQuery], es.apiKey);
        const qv = vectors[0];
        if (!qv?.length) throw new Error('query 向量为空');

        if (es.ragMode === 'vector') {
          top = retrieveTopKnowledgeChunksVector(qv, withVec, topK);
        } else {
          top = retrieveTopKnowledgeChunksHybrid(
            sourceQuery,
            qv,
            withVec,
            topK,
            es.hybridLexicalWeight ?? 0.35
          );
        }
      } catch (e) {
        console.warn('Embedding RAG 失败，回退词法检索', e);
      }
    }
  }

  if (top.length === 0) {
    top = retrieveTopKnowledgeChunks(sourceQuery, flat, topK);
  }

  if (top.length === 0) return undefined;
  const body = formatKnowledgeRagContext(top, maxTotalChars);
  if (!body.trim()) return undefined;
  return body;
};
