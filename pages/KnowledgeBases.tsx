import React, { useState, useRef } from 'react';
import mammoth from 'mammoth';
import { KnowledgeBase, Project, EmbeddingSettings } from '../types';
import { chunkKnowledgeText } from '../services/knowledgeRagService';
import { embedTexts } from '../services/embeddingClient';
import { Icons } from '../components/ui/Icons';

interface KnowledgeBasesPageProps {
  knowledgeBases: KnowledgeBase[];
  onKnowledgeBasesChange: (list: KnowledgeBase[]) => void;
  projects: Project[];
  embeddingSettings: EmbeddingSettings;
}

const generateKbId = () => `kb-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export const KnowledgeBasesPage: React.FC<KnowledgeBasesPageProps> = ({
  knowledgeBases,
  onKnowledgeBasesChange,
  projects,
  embeddingSettings
}) => {
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<KnowledgeBase | null>(null);
  const [showDeleteId, setShowDeleteId] = useState<string | null>(null);
  const [isSavingKb, setIsSavingKb] = useState(false);
  const [reembeddingId, setReembeddingId] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [rawText, setRawText] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
  const [isDocxImporting, setIsDocxImporting] = useState(false);
  const docxInputRef = useRef<HTMLInputElement>(null);

  const handleDocxSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (picked.length === 0) return;

    const docxFiles = picked.filter((f) => f.name.toLowerCase().endsWith('.docx'));
    if (docxFiles.length === 0) {
      alert('请选择 .docx 格式的 Word 文档（不支持旧版 .doc）。');
      return;
    }
    if (docxFiles.length < picked.length) {
      alert(
        `已跳过 ${picked.length - docxFiles.length} 个非 .docx 文件；将导入 ${docxFiles.length} 个文档。`
      );
    }

    setIsDocxImporting(true);
    try {
      const parts: string[] = [];
      for (const file of docxFiles) {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        const text = (result.value || '').replace(/\r\n/g, '\n').trim();
        if (!text) {
          alert(`「${file.name}」未提取到文本，已跳过。`);
          continue;
        }
        if (docxFiles.length > 1) {
          parts.push(`【${file.name}】\n${text}`);
        } else {
          parts.push(text);
        }
        if (result.messages?.length) {
          const warns = result.messages.filter((m) => m.type === 'warning').map((m) => m.message);
          if (warns.length) console.warn('mammoth:', file.name, warns);
        }
      }
      if (parts.length === 0) {
        alert('未能从所选文档中提取到可用文本。');
        return;
      }
      const merged = parts.join('\n\n');
      setRawText((prev) => {
        const p = prev.trim();
        return p ? `${p}\n\n${merged}` : merged;
      });
    } catch (err) {
      console.error(err);
      alert('读取 Word 文档失败，请重试或另存为 .docx 后再导入。');
    } finally {
      setIsDocxImporting(false);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setName('');
    setDescription('');
    setRawText('');
    setEnabled(true);
    setSelectedProjectIds(new Set());
    setShowModal(true);
  };

  const openEdit = (kb: KnowledgeBase) => {
    setEditing(kb);
    setName(kb.name);
    setDescription(kb.description || '');
    setRawText(kb.rawText);
    setEnabled(kb.enabled);
    setSelectedProjectIds(new Set(kb.projectIds));
    setShowModal(true);
  };

  const toggleProject = (id: string) => {
    setSelectedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const saveKb = async () => {
    if (!name.trim()) {
      alert('请填写知识库名称');
      return;
    }
    const trimmed = rawText.replace(/\r\n/g, '\n').trim();
    if (!trimmed) {
      alert('请粘贴或输入知识正文');
      return;
    }

    setIsSavingKb(true);
    try {
      const now = new Date().toISOString();
      const id = editing?.id ?? generateKbId();
      let chunks = chunkKnowledgeText(trimmed, { baseId: id, maxChars: 300, overlap: 50 });

      if (embeddingSettings.enabled && embeddingSettings.serviceUrl?.trim()) {
        try {
          const texts = chunks.map((c) => c.text);
          const { vectors, model } = await embedTexts(
            embeddingSettings.serviceUrl,
            texts,
            embeddingSettings.apiKey?.trim() || undefined
          );
          chunks = chunks.map((c, i) => ({
            ...c,
            embedding: vectors[i],
            embeddingModel: model
          }));
        } catch (e) {
          console.error(e);
          const msg = e instanceof Error ? e.message : String(e);
          alert(`向量生成失败，已仅保存文本块（将使用词法 RAG）。\n${msg}`);
          chunks = chunks.map((c) => ({ ...c, embedding: undefined, embeddingModel: undefined }));
        }
      } else {
        chunks = chunks.map((c) => ({ ...c, embedding: undefined, embeddingModel: undefined }));
      }

      const row: KnowledgeBase = {
        id,
        name: name.trim(),
        description: description.trim() || undefined,
        projectIds: Array.from(selectedProjectIds),
        enabled,
        rawText: trimmed,
        chunks,
        createdAt: editing?.createdAt ?? now,
        updatedAt: now
      };

      const next = editing
        ? knowledgeBases.map((k) => (k.id === id ? row : k))
        : [...knowledgeBases, row];
      onKnowledgeBasesChange(next);
      setShowModal(false);
      setEditing(null);
    } finally {
      setIsSavingKb(false);
    }
  };

  const reembedKb = async (kb: KnowledgeBase) => {
    if (!embeddingSettings.enabled || !embeddingSettings.serviceUrl?.trim()) {
      alert('请先在「系统设置」中启用本地向量服务并填写服务地址。');
      return;
    }
    setReembeddingId(kb.id);
    try {
      const chunks = chunkKnowledgeText(kb.rawText, { baseId: kb.id, maxChars: 300, overlap: 50 });
      const { vectors, model } = await embedTexts(
        embeddingSettings.serviceUrl,
        chunks.map((c) => c.text),
        embeddingSettings.apiKey?.trim() || undefined
      );
      const newChunks = chunks.map((c, i) => ({
        ...c,
        embedding: vectors[i],
        embeddingModel: model
      }));
      const now = new Date().toISOString();
      const updated: KnowledgeBase = { ...kb, chunks: newChunks, updatedAt: now };
      onKnowledgeBasesChange(knowledgeBases.map((k) => (k.id === kb.id ? updated : k)));
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : String(e);
      alert(`重新向量化失败：${msg}`);
    } finally {
      setReembeddingId(null);
    }
  };

  const confirmDelete = () => {
    if (!showDeleteId) return;
    onKnowledgeBasesChange(knowledgeBases.filter((k) => k.id !== showDeleteId));
    setShowDeleteId(null);
  };

  return (
    <div className="h-full flex flex-col bg-slate-50">
      <div className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">翻译知识库</h1>
            <p className="mt-1 text-sm text-slate-600">
              为项目提供可检索的参考资料；翻译与孪生译员生成时会按当前句段自动选取最相关的片段（RAG）。
              若不勾选任何项目，则该库对<strong>所有项目</strong>生效。
            </p>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            <Icons.Plus className="w-4 h-4 inline mr-2" />
            新建知识库
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {knowledgeBases.length === 0 ? (
          <div className="text-center py-16 text-slate-500 bg-white rounded-xl border border-dashed border-slate-200">
            <Icons.Sparkles className="w-12 h-12 mx-auto mb-3 text-slate-300" />
            <p>
              暂无知识库。创建后可粘贴文本或导入 Word（.docx），系统将自动切块用于检索。
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {knowledgeBases.map((kb) => (
              <div
                key={kb.id}
                className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex flex-col"
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-semibold text-slate-900 truncate">{kb.name}</h2>
                  <span
                    className={`text-xs px-2 py-0.5 rounded shrink-0 ${
                      kb.enabled ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {kb.enabled ? '已启用' : '已停用'}
                  </span>
                </div>
                {kb.description && (
                  <p className="text-xs text-slate-500 mt-1 line-clamp-2">{kb.description}</p>
                )}
                <div className="mt-3 text-xs text-slate-600 space-y-1 flex-1">
                  <div>
                    绑定项目：
                    {kb.projectIds.length === 0 ? (
                      <span className="text-blue-700 font-medium"> 全局</span>
                    ) : (
                      <span>
                        {' '}
                        {kb.projectIds
                          .map((pid) => projects.find((p) => p.id === pid)?.name || pid)
                          .join('、')}
                      </span>
                    )}
                  </div>
                  <div>
                    切块数：<span className="font-mono">{kb.chunks.length}</span> · 原文约{' '}
                    {kb.rawText.length} 字
                  </div>
                  <div>
                    已向量化：{' '}
                    <span className="font-mono">
                      {kb.chunks.filter((c) => c.embedding && c.embedding.length > 0).length}
                    </span>{' '}
                    / {kb.chunks.length}
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => openEdit(kb)}
                    className="flex-1 min-w-[4rem] py-1.5 text-sm border border-slate-200 rounded-lg hover:bg-slate-50"
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    disabled={reembeddingId === kb.id || !embeddingSettings.enabled}
                    onClick={() => void reembedKb(kb)}
                    className="flex-1 min-w-[4rem] py-1.5 text-sm border border-teal-200 text-teal-800 rounded-lg hover:bg-teal-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    title={
                      embeddingSettings.enabled
                        ? '按当前正文重新切块并请求本地服务生成向量'
                        : '请先在设置中启用向量服务'
                    }
                  >
                    {reembeddingId === kb.id ? '向量计算中…' : '重算向量'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDeleteId(kb.id)}
                    className="px-3 py-1.5 text-sm text-red-600 border border-red-100 rounded-lg hover:bg-red-50"
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">
                {editing ? '编辑知识库' : '新建知识库'}
              </h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="p-1 rounded hover:bg-slate-100"
              >
                <Icons.X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">名称</label>
                <input
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：客户 A 风格指南"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">说明（可选）</label>
                <input
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                  />
                  启用（停用后不会参与检索）
                </label>
              </div>
              <div>
                <div className="text-sm font-medium text-slate-700 mb-2">
                  绑定项目（不选 = 全局知识库）
                </div>
                <div className="max-h-36 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1">
                  {projects.length === 0 ? (
                    <p className="text-xs text-slate-400">暂无项目，将仅可创建全局库</p>
                  ) : (
                    projects.map((p) => (
                      <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedProjectIds.has(p.id)}
                          onChange={() => toggleProject(p.id)}
                        />
                        <span className="truncate">{p.name}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                  <label className="block text-sm font-medium text-slate-700">知识正文</label>
                  <div className="flex items-center gap-2">
                    <input
                      ref={docxInputRef}
                      type="file"
                      accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      multiple
                      className="hidden"
                      onChange={handleDocxSelected}
                    />
                    <button
                      type="button"
                      disabled={isDocxImporting}
                      onClick={() => docxInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50"
                    >
                      <Icons.Upload className="w-3.5 h-3.5" />
                      {isDocxImporting ? '读取中…' : '导入 Word（.docx，可多选）'}
                    </button>
                  </div>
                </div>
                <p className="text-xs text-slate-500 mb-1.5">
                  支持粘贴/输入文本，或一次选择多个 .docx 导入；新内容会追加到现有正文末尾。
                </p>
                <textarea
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono min-h-[200px]"
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder="粘贴长文本，或使用「导入 Word」… 保存时将按约 300 字窗口、50 字重叠自动切块。"
                />
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg"
              >
                取消
              </button>
              <button
                type="button"
                disabled={isSavingKb}
                onClick={() => void saveKb()}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {isSavingKb ? '保存中（含向量）…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteId && (
        <div className="fixed inset-0 z-[201] flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <p className="text-slate-800">确定删除该知识库？此操作不可恢复。</p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDeleteId(null)}
                className="px-4 py-2 text-sm border border-slate-200 rounded-lg"
              >
                取消
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                className="px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
