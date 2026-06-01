import React, { useState } from 'react';
import { Icons } from '../components/ui/Icons';
import { TermBase, TranslationMemory, TermBaseEntry, TranslationMemoryUnit, GrammarRuleBook, RegexDictionaryBook } from '../types';
import { GrammarRuleBooksPanel, createEmptyGrammarRuleBook } from '../components/GrammarRuleBooksPanel';
import { RegexDictionaryPanel, createEmptyRegexDictionaryBook } from '../components/RegexDictionaryPanel';
import * as XLSX from 'xlsx';
import { SUPPORTED_LANGUAGES, formatResourceCreatedDateLabel } from '../constants';

interface ResourcesProps {
  termBases: TermBase[];
  translationMemories: TranslationMemory[];
  onAddTerm: (tbId: string, term: TermBaseEntry) => void;
  onUpdateTerm: (tbId: string, term: TermBaseEntry) => void;
  onDeleteTerm: (tbId: string, termId: string) => void;
  onAddTMUnit: (tmId: string, unit: TranslationMemoryUnit) => void;
  onUpdateTMUnit: (tmId: string, unit: TranslationMemoryUnit) => void;
  onDeleteTMUnit: (tmId: string, unitId: string) => void;
  onImportResource?: (type: 'tm' | 'tb', resource: any) => void;
  onDeleteResource?: (type: 'tm' | 'tb' | 'gr' | 'rx', id: string) => void;
  grammarRuleBooks: GrammarRuleBook[];
  onGrammarRuleBooksChange: (books: GrammarRuleBook[]) => void;
  regexDictionaryBooks: RegexDictionaryBook[];
  onRegexDictionaryBooksChange: (books: RegexDictionaryBook[]) => void;
}

export const Resources: React.FC<ResourcesProps> = ({ 
  termBases, translationMemories,
  onAddTerm, onUpdateTerm, onDeleteTerm,
  onAddTMUnit, onUpdateTMUnit, onDeleteTMUnit,
  onImportResource, onDeleteResource,
  grammarRuleBooks,
  onGrammarRuleBooksChange,
  regexDictionaryBooks,
  onRegexDictionaryBooksChange
}) => {
  const [activeTab, setActiveTab] = useState<'tb' | 'tm' | 'gr' | 'rx'>('tb');
  const [selectedFileId, setSelectedFileId] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  
  // Import states
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importMode, setImportMode] = useState<'overwrite' | 'merge'>('merge');
  const [importDestination, setImportDestination] = useState<'existing' | 'new'>('existing');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [showImportOptions, setShowImportOptions] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newResourceName, setNewResourceName] = useState('');
  const [newResourceSourceLang, setNewResourceSourceLang] = useState('en-US');
  const [newResourceTargetLang, setNewResourceTargetLang] = useState('zh-CN');
  const [importResults, setImportResults] = useState<{success: number, skipped: number, total: number} | null>(null);
  const [showImportResults, setShowImportResults] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  
  // Delete confirmation states
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<{id: string, source: string} | null>(null);
  
  // Initialize selection
  React.useEffect(() => {
      if (activeTab === 'tb' && termBases.length > 0 && !selectedFileId) {
          setSelectedFileId(termBases[0].id);
      } else if (activeTab === 'tm' && translationMemories.length > 0 && !selectedFileId) {
          setSelectedFileId(translationMemories[0].id);
      } else if (activeTab === 'gr' && grammarRuleBooks.length > 0 && !selectedFileId) {
          setSelectedFileId(grammarRuleBooks[0].id);
      } else if (activeTab === 'rx' && regexDictionaryBooks.length > 0 && !selectedFileId) {
          setSelectedFileId(regexDictionaryBooks[0].id);
      }
  }, [activeTab, termBases, translationMemories, grammarRuleBooks, regexDictionaryBooks, selectedFileId]);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [currentEntryId, setCurrentEntryId] = useState<string | null>(null);

  // Form State
  const [sourceInput, setSourceInput] = useState('');
  const [targetInput, setTargetInput] = useState('');
  
  // Delete Resource Modal
  const [deleteResourceModalOpen, setDeleteResourceModalOpen] = useState(false);
  
  // Merge Memory Bases Modal
  const [mergeModalOpen, setMergeModalOpen] = useState(false);
  const [selectedSourceTMs, setSelectedSourceTMs] = useState<string[]>([]);
  const [targetTMId, setTargetTMId] = useState<string>('');
  const [mergeProgress, setMergeProgress] = useState(0);
  const [isMerging, setIsMerging] = useState(false);
  const [mergeResults, setMergeResults] = useState<{success: number, skipped: number, total: number} | null>(null);
  const [showMergeResults, setShowMergeResults] = useState(false);

  // Get Current Active File Data
  const currentTB = termBases.find(tb => tb.id === selectedFileId);
  const currentTM = translationMemories.find(tm => tm.id === selectedFileId);
  const currentGR = grammarRuleBooks.find((g) => g.id === selectedFileId);
  const currentRX = regexDictionaryBooks.find((r) => r.id === selectedFileId);
  const currentResourceName =
    activeTab === 'tb'
      ? currentTB?.name
      : activeTab === 'tm'
        ? currentTM?.name
        : activeTab === 'gr'
          ? currentGR?.name
          : currentRX?.name;

  // Filter Data
  const getFilteredData = () => {
      if (activeTab === 'tb' && currentTB) {
          return currentTB.entries.filter(t => t.source.toLowerCase().includes(searchTerm.toLowerCase()));
      }
      if (activeTab === 'tm' && currentTM) {
          return currentTM.units.filter(t => t.source.toLowerCase().includes(searchTerm.toLowerCase()));
      }
      return [];
  };
  const filteredData = getFilteredData();

  const openAddModal = () => {
      setEditMode(false);
      setSourceInput('');
      setTargetInput('');
      setCurrentEntryId(null);
      setIsModalOpen(true);
  };

  const handleCreateEmptyResource = () => {
      if (!newResourceName.trim()) {
          alert('请输入资源名称');
          return;
      }

      if (activeTab === 'gr') {
          const nb = createEmptyGrammarRuleBook(
              newResourceName.trim(),
              newResourceSourceLang,
              newResourceTargetLang
          );
          onGrammarRuleBooksChange([...grammarRuleBooks, nb]);
          setSelectedFileId(nb.id);
          setShowCreateModal(false);
          setNewResourceName('');
          return;
      }

      if (activeTab === 'rx') {
          const nb = createEmptyRegexDictionaryBook(
              newResourceName.trim(),
              newResourceSourceLang,
              newResourceTargetLang
          );
          onRegexDictionaryBooksChange([...regexDictionaryBooks, nb]);
          setSelectedFileId(nb.id);
          setShowCreateModal(false);
          setNewResourceName('');
          return;
      }

      if (onImportResource) {
          const newId = `${activeTab}-${Date.now()}`;
          const createdAt = new Date().toISOString().split('T')[0];

          if (activeTab === 'tb') {
              const newTB: TermBase = {
                  id: newId,
                  name: newResourceName.trim(),
                  sourceLang: newResourceSourceLang,
                  targetLang: newResourceTargetLang,
                  entries: [],
                  createdAt
              };
              onImportResource('tb', newTB);
              setSelectedFileId(newId);
          } else {
              const newTM: TranslationMemory = {
                  id: newId,
                  name: newResourceName.trim(),
                  sourceLang: newResourceSourceLang,
                  targetLang: newResourceTargetLang,
                  units: [],
                  createdAt
              };
              onImportResource('tm', newTM);
              setSelectedFileId(newId);
          }

          setShowCreateModal(false);
          setNewResourceName('');
      }
  };

  const handleOpenCreateModal = () => {
      setShowCreateModal(true);
      setNewResourceName('');
  };

  const openEditModal = (item: any) => {
      setEditMode(true);
      setSourceInput(item.source);
      setTargetInput(item.target);
      setCurrentEntryId(item.id);
      setIsModalOpen(true);
  };

  const handleSave = () => {
    if(!sourceInput || !targetInput) return;

    // Check for duplicate entries
    const normalizedSource = sourceInput.trim().toLowerCase();
    let hasDuplicate = false;

    if (activeTab === 'tb' && selectedFileId) {
        const currentTB = termBases.find(tb => tb.id === selectedFileId);
        if (currentTB) {
            hasDuplicate = currentTB.entries.some(entry => 
                entry.source.trim().toLowerCase() === normalizedSource && 
                entry.id !== currentEntryId
            );
        }
    } else if (activeTab === 'tm' && selectedFileId) {
        const currentTM = translationMemories.find(tm => tm.id === selectedFileId);
        if (currentTM) {
            hasDuplicate = currentTM.units.some(unit => 
                unit.source.trim().toLowerCase() === normalizedSource && 
                unit.id !== currentEntryId
            );
        }
    }

    if (hasDuplicate) {
        alert(`已存在相同的${activeTab === 'tb' ? '术语' : '记忆单元'}条目，无法添加重复内容。`);
        return;
    }

    if (activeTab === 'tb' && selectedFileId) {
        if (editMode && currentEntryId) {
            onUpdateTerm(selectedFileId, { id: currentEntryId, source: sourceInput, target: targetInput });
        } else {
            onAddTerm(selectedFileId, { id: `t-${Date.now()}`, source: sourceInput, target: targetInput });
        }
    } else if (activeTab === 'tm' && selectedFileId) {
        if (editMode && currentEntryId) {
            onUpdateTMUnit(selectedFileId, { 
                id: currentEntryId, 
                source: sourceInput, 
                target: targetInput,
                lastUsed: new Date().toISOString().split('T')[0],
                usageCount: 0
            });
        } else {
            onAddTMUnit(selectedFileId, { 
                id: `tm-${Date.now()}`, 
                source: sourceInput, 
                target: targetInput,
                lastUsed: new Date().toISOString().split('T')[0],
                usageCount: 0
            });
        }
    }
    setIsModalOpen(false);
  };

  // --- File Actions ---

  const handleExportFile = () => {
      if (activeTab === 'tb' && currentTB) {
          const data = currentTB.entries.map(t => ({ Source: t.source, Target: t.target }));
          const worksheet = XLSX.utils.json_to_sheet(data);
          const workbook = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(workbook, worksheet, "TermBase");
          XLSX.writeFile(workbook, `${currentTB.name}.xlsx`);
      } else if (activeTab === 'tm' && currentTM) {
          const data = currentTM.units.map(t => ({ Source: t.source, Target: t.target }));
          const worksheet = XLSX.utils.json_to_sheet(data);
          const workbook = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(workbook, worksheet, "TM");
          XLSX.writeFile(workbook, `${currentTM.name}.xlsx`);
      } else if (activeTab === 'gr' && currentGR) {
          const blob = new Blob([JSON.stringify(currentGR, null, 2)], { type: 'application/json;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${currentGR.name.replace(/[^\w\u4e00-\u9fa5\-]+/g, '_')}.grammar.json`;
          a.click();
          URL.revokeObjectURL(url);
      } else if (activeTab === 'rx' && currentRX) {
          const blob = new Blob([JSON.stringify(currentRX, null, 2)], { type: 'application/json;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${currentRX.name.replace(/[^\w\u4e00-\u9fa5\-]+/g, '_')}.regex.json`;
          a.click();
          URL.revokeObjectURL(url);
      }
  };

  const handleDeleteCurrentResource = () => {
      if (!selectedFileId) return;
      if (activeTab === 'gr') {
          if (onDeleteResource) onDeleteResource('gr', selectedFileId);
          setDeleteResourceModalOpen(false);
          setSelectedFileId('');
          return;
      }
      if (activeTab === 'rx') {
          if (onDeleteResource) onDeleteResource('rx', selectedFileId);
          setDeleteResourceModalOpen(false);
          setSelectedFileId('');
          return;
      }
      if (onDeleteResource) {
          onDeleteResource(activeTab, selectedFileId);
          setDeleteResourceModalOpen(false);
          setSelectedFileId('');
      }
  };

  // --- Merge Memory Bases Functions ---

  const handleOpenMergeModal = () => {
      setSelectedSourceTMs([]);
      setTargetTMId('');
      setMergeProgress(0);
      setMergeResults(null);
      setMergeModalOpen(true);
  };

  const processMerge = async () => {
      if (!targetTMId || selectedSourceTMs.length === 0 || !onImportResource) return;

      try {
          setIsMerging(true);
          setMergeProgress(0);
          setShowMergeResults(false);

          // Get target TM
          const targetTM = translationMemories.find(tm => tm.id === targetTMId);
          if (!targetTM) {
              alert('目标记忆库不存在');
              return;
          }

          // Get source TMs
          const sourceTMs = translationMemories.filter(tm => selectedSourceTMs.includes(tm.id));
          if (sourceTMs.length === 0) {
              alert('请选择至少一个源记忆库');
              return;
          }

          // Collect all units from source TMs
          let allUnits: TranslationMemoryUnit[] = [];
          sourceTMs.forEach(tm => {
              allUnits = [...allUnits, ...tm.units];
          });

          setMergeProgress(20);
          await new Promise(resolve => setTimeout(resolve, 300));

          // Merge units into target TM
          const existingSources = new Set(targetTM.units.map(u => u.source.toLowerCase()));
          let newUnits = [...targetTM.units];
          let skipped = 0;

          for (const unit of allUnits) {
              if (!existingSources.has(unit.source.toLowerCase())) {
                  newUnits.push({
                      ...unit,
                      id: `tm-merge-${Date.now()}-${newUnits.length}`,
                      lastUsed: new Date().toISOString().split('T')[0],
                      usageCount: 0
                  });
                  existingSources.add(unit.source.toLowerCase());
              } else {
                  skipped++;
              }
          }

          setMergeProgress(80);
          await new Promise(resolve => setTimeout(resolve, 300));

          // Update target TM
          const updatedTM: TranslationMemory = {
              ...targetTM,
              units: newUnits
          };

          onImportResource('tm', updatedTM);

          setMergeProgress(100);
          await new Promise(resolve => setTimeout(resolve, 300));

          setMergeResults({ 
              success: newUnits.length - targetTM.units.length, 
              skipped, 
              total: allUnits.length 
          });
          setShowMergeResults(true);
      } catch (error) {
          console.error('合并记忆库失败:', error);
          alert('合并记忆库失败，请重试');
      } finally {
          setIsMerging(false);
      }
  };

  const handleConfirmDelete = () => {
      if (!itemToDelete || !selectedFileId) return;

      if (activeTab === 'tb') {
          onDeleteTerm(selectedFileId, itemToDelete.id);
      } else {
          onDeleteTMUnit(selectedFileId, itemToDelete.id);
      }

      setItemToDelete(null);
      setShowDeleteConfirm(false);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (activeTab === 'gr' || activeTab === 'rx') {
          alert(
              activeTab === 'gr'
                  ? '规则词典请先选中左侧词典，在右侧「句式规则」工具栏使用「导入 Excel」；整库备份仍可通过 JSON 导出。'
                  : '正则表达式词典请在右侧面板使用「导入 Excel」；整库备份可使用 JSON 导出。'
          );
          e.target.value = '';
          return;
      }

      const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
      if (!isExcel) {
          alert("仅支持 Excel (.xlsx, .xls) 格式文件导入。");
          return;
      }

      setImportFile(file);
      setShowImportOptions(true);
      
      e.target.value = '';
  };

  const processImport = async () => {
      if (!importFile || (importDestination === 'existing' && !selectedFileId)) return;

      // Transaction handling: Save backup state before import
      let backupResource = null;

      try {
          setIsImporting(true);
          setImportProgress(0);
          setImportResults(null);

          // Save backup of current resource if updating existing one
          if (importDestination === 'existing' && selectedFileId) {
              if (activeTab === 'tb') {
                  backupResource = termBases.find(tb => tb.id === selectedFileId);
              } else {
                  backupResource = translationMemories.find(tm => tm.id === selectedFileId);
              }
          }

          // Read and parse Excel file
          const data = await importFile.arrayBuffer();
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          
          // Get raw data as array of arrays [ ['Source', 'Target'], ['Hello', '你好'] ]
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

          // Map data (Assume Col A is Source, Col B is Target)
          const parsedEntries = jsonData.map((row, index) => {
              if (!row || row.length < 2) return null;
              
              const s = String(row[0] || '').trim();
              const t = String(row[1] || '').trim();
              
              // Simple heuristic to skip header row if it looks like "Source/Target" or "原文/译文"
              if (index === 0) {
                  const lowerS = s.toLowerCase();
                  const lowerT = t.toLowerCase();
                  if ((lowerS === 'source' || lowerS === '原文') && (lowerT === 'target' || lowerT === '译文')) {
                      return null;
                  }
              }
              if (!s || !t) return null;
              return { source: s, target: t };
          }).filter((item): item is { source: string, target: string } => item !== null);

          setImportProgress(30);

          // Simulate processing delay for progress indication
          await new Promise(resolve => setTimeout(resolve, 300));

          if (importDestination === 'existing' && selectedFileId) {
              // Import to existing resource
              if (activeTab === 'tb') {
                  const currentTB = termBases.find(tb => tb.id === selectedFileId);
                  if (currentTB) {
                      let newEntries: TermBaseEntry[] = [];
                      let skipped = 0;

                      if (importMode === 'overwrite') {
                          // Overwrite all entries
                          newEntries = parsedEntries.map((e, i) => ({
                              id: `t-imp-${Date.now()}-${i}`,
                              source: e.source,
                              target: e.target
                          }));
                      } else {
                          // Merge new entries, skip duplicates
                          const existingSources = new Set(currentTB.entries.map(e => e.source.toLowerCase()));
                          newEntries = [...currentTB.entries];
                          
                          for (const entry of parsedEntries) {
                              if (!existingSources.has(entry.source.toLowerCase())) {
                                  newEntries.push({
                                      id: `t-imp-${Date.now()}-${newEntries.length}`,
                                      source: entry.source,
                                      target: entry.target
                                  });
                                  existingSources.add(entry.source.toLowerCase());
                              } else {
                                  skipped++;
                              }
                          }
                      }

                      // Update term base entries
                      if (onImportResource) {
                          const updatedTB: TermBase = {
                              ...currentTB,
                              entries: newEntries
                          };
                          onImportResource('tb', updatedTB);
                      }

                      setImportResults({ success: newEntries.length - (importMode === 'merge' ? currentTB.entries.length : 0), skipped, total: parsedEntries.length });
                  }
              } else {
                  const currentTM = translationMemories.find(tm => tm.id === selectedFileId);
                  if (currentTM) {
                      let newUnits: TranslationMemoryUnit[] = [];
                      let skipped = 0;

                      if (importMode === 'overwrite') {
                          // Overwrite all units
                          newUnits = parsedEntries.map((e, i) => ({
                              id: `tm-imp-${Date.now()}-${i}`,
                              source: e.source,
                              target: e.target,
                              lastUsed: new Date().toISOString().split('T')[0],
                              usageCount: 0
                          }));
                      } else {
                          // Merge new units, skip duplicates
                          const existingSources = new Set(currentTM.units.map(u => u.source.toLowerCase()));
                          newUnits = [...currentTM.units];
                          
                          for (const entry of parsedEntries) {
                              if (!existingSources.has(entry.source.toLowerCase())) {
                                  newUnits.push({
                                      id: `tm-imp-${Date.now()}-${newUnits.length}`,
                                      source: entry.source,
                                      target: entry.target,
                                      lastUsed: new Date().toISOString().split('T')[0],
                                      usageCount: 0
                                  });
                                  existingSources.add(entry.source.toLowerCase());
                              } else {
                                  skipped++;
                              }
                          }
                      }

                      // Update translation memory units
                      if (onImportResource) {
                          const updatedTM: TranslationMemory = {
                              ...currentTM,
                              units: newUnits
                          };
                          onImportResource('tm', updatedTM);
                      }

                      setImportResults({ success: newUnits.length - (importMode === 'merge' ? currentTM.units.length : 0), skipped, total: parsedEntries.length });
                  }
              }
          } else if (importDestination === 'new') {
              // Create new resource from imported file
              if (onImportResource) {
                  const newId = `${activeTab}-${Date.now()}`;
                  const createdAt = new Date().toISOString().split('T')[0];

                  if (activeTab === 'tb') {
                      const newTB: TermBase = {
                          id: newId,
                          name: importFile.name.split('.')[0],
                          sourceLang: 'en-US',
                          targetLang: 'zh-CN',
                          entries: parsedEntries.map((e, i) => ({
                              id: `t-imp-${Date.now()}-${i}`,
                              source: e.source,
                              target: e.target
                          })),
                          createdAt
                      };
                      onImportResource('tb', newTB);
                      setSelectedFileId(newId);
                  } else {
                      const newTM: TranslationMemory = {
                          id: newId,
                          name: importFile.name.split('.')[0],
                          sourceLang: 'en-US',
                          targetLang: 'zh-CN',
                          units: parsedEntries.map((e, i) => ({
                              id: `tm-imp-${Date.now()}-${i}`,
                              source: e.source,
                              target: e.target,
                              lastUsed: new Date().toISOString().split('T')[0],
                              usageCount: 0
                          })),
                          createdAt
                      };
                      onImportResource('tm', newTM);
                      setSelectedFileId(newId);
                  }

                  setImportResults({ success: parsedEntries.length, skipped: 0, total: parsedEntries.length });
              }
          }

          setImportProgress(100);
          await new Promise(resolve => setTimeout(resolve, 300));
          setShowImportResults(true);
      } catch (error) {
          console.error("Import failed", error);
          
          // Rollback to backup state if import failed
          if (backupResource && onImportResource && (activeTab === 'tm' || activeTab === 'tb')) {
              onImportResource(activeTab, backupResource);
          }
          
          alert("导入失败，请确保文件是有效的 Excel (.xlsx) 格式。");
      } finally {
          setIsImporting(false);
          setShowImportOptions(false);
      }
  };

  return (
    <div className="p-8 h-full overflow-y-auto relative flex flex-col">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">语言资源</h1>
          <p className="text-slate-500 mt-1">维护您的核心翻译资产。</p>
          <p className="text-slate-500 text-sm mt-1 max-w-3xl leading-relaxed">
            术语库、记忆库、<strong className="text-slate-700">规则词典</strong>与<strong className="text-slate-700">正则表达式词典</strong>均在编辑后约 1
            秒自动写入当前<strong className="text-slate-700">本地 SQLite</strong>（与项目挂载关系一并持久化）。须保持本地数据库服务可用（例如{' '}
            <code className="text-xs bg-slate-100 px-1 rounded">npm run server</code> 或{' '}
            <code className="text-xs bg-slate-100 px-1 rounded">npm run dev:with-db</code>）。
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-6 border-b border-slate-200 mb-6 shrink-0">
        <button 
            onClick={() => { setActiveTab('tb'); setSelectedFileId(termBases[0]?.id || ''); }}
            className={`pb-3 text-sm font-bold transition-colors relative ${activeTab === 'tb' ? 'text-blue-600' : 'text-slate-500 hover:text-slate-800'}`}
        >
            <div className="flex items-center gap-2">
                <Icons.TermBase className="w-4 h-4"/>
                术语库 (Term Bases)
            </div>
            {activeTab === 'tb' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-blue-600 rounded-t-full"/>}
        </button>
        <button 
            onClick={() => { setActiveTab('tm'); setSelectedFileId(translationMemories[0]?.id || ''); }}
            className={`pb-3 text-sm font-bold transition-colors relative ${activeTab === 'tm' ? 'text-blue-600' : 'text-slate-500 hover:text-slate-800'}`}
        >
            <div className="flex items-center gap-2">
                <Icons.Database className="w-4 h-4"/>
                翻译记忆 (Translation Memories)
            </div>
             {activeTab === 'tm' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-blue-600 rounded-t-full"/>}
        </button>
        <button
            onClick={() => {
                setActiveTab('gr');
                setSelectedFileId(grammarRuleBooks[0]?.id || '');
            }}
            className={`pb-3 text-sm font-bold transition-colors relative ${activeTab === 'gr' ? 'text-amber-700' : 'text-slate-500 hover:text-slate-800'}`}
        >
            <div className="flex items-center gap-2">
                <Icons.Concordance className="w-4 h-4" />
                规则词典
            </div>
            {activeTab === 'gr' && (
                <div className="absolute bottom-0 left-0 h-0.5 w-full rounded-t-full bg-amber-600" />
            )}
        </button>
        <button
            onClick={() => {
                setActiveTab('rx');
                setSelectedFileId(regexDictionaryBooks[0]?.id || '');
            }}
            className={`pb-3 text-sm font-bold transition-colors relative ${activeTab === 'rx' ? 'text-violet-700' : 'text-slate-500 hover:text-slate-800'}`}
        >
            <div className="flex items-center gap-2">
                <Icons.RegexDict className="w-4 h-4" />
                正则表达式词典
            </div>
            {activeTab === 'rx' && (
                <div className="absolute bottom-0 left-0 h-0.5 w-full rounded-t-full bg-violet-600" />
            )}
        </button>
      </div>

      <div className="flex gap-6 flex-1 min-h-0">
          {/* Sidebar: File List */}
          <div className="w-64 border-r border-slate-200 pr-4 flex flex-col">
              <div className="flex justify-between items-center mb-3 gap-2">
                 <h3 className="text-xs font-bold text-slate-500 uppercase">
                     {activeTab === 'tb'
                         ? '可用术语库'
                         : activeTab === 'tm'
                           ? '可用记忆库'
                           : activeTab === 'gr'
                             ? '规则词典列表'
                             : '正则词典列表'}
                 </h3>
                 {(activeTab === 'gr' || activeTab === 'rx') && (
                     <button
                         type="button"
                         onClick={handleOpenCreateModal}
                         className="shrink-0 flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-600 hover:text-blue-800 border border-blue-200 rounded-lg hover:bg-blue-50"
                         title="创建空库"
                     >
                         <Icons.File className="w-3.5 h-3.5" />
                         创建
                     </button>
                 )}
              </div>
              
              <div className="space-y-2 overflow-y-auto flex-1">
                {(activeTab === 'tb'
                    ? termBases
                    : activeTab === 'tm'
                      ? translationMemories
                      : activeTab === 'gr'
                        ? grammarRuleBooks
                        : regexDictionaryBooks
                ).map((file: any) => {
                    const recordCount =
                        activeTab === 'tb'
                            ? file.entries.length
                            : activeTab === 'tm'
                              ? file.units.length
                              : activeTab === 'gr'
                                ? file.rules.length + (file.categoryLexicon?.length ?? 0)
                                : file.entries.length;
                    const dateLabel = formatResourceCreatedDateLabel(file.createdAt);
                    return (
                    <button
                        key={file.id}
                        onClick={() => setSelectedFileId(file.id)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-start gap-2 transition-colors ${
                            selectedFileId === file.id
                                ? activeTab === 'rx'
                                    ? 'bg-violet-50 text-violet-800 font-medium'
                                    : 'bg-blue-50 text-blue-700 font-medium'
                                : 'hover:bg-slate-50 text-slate-700'
                        }`}
                    >
                        {activeTab === 'tb' ? (
                            <Icons.TermBase className="w-4 h-4 opacity-50 shrink-0 mt-0.5" />
                        ) : activeTab === 'tm' ? (
                            <Icons.Database className="w-4 h-4 opacity-50 shrink-0 mt-0.5" />
                        ) : activeTab === 'gr' ? (
                            <Icons.Concordance className="w-4 h-4 shrink-0 text-amber-600/70 mt-0.5" />
                        ) : (
                            <Icons.RegexDict className="w-4 h-4 shrink-0 text-violet-600/80 mt-0.5" />
                        )}
                        <div className="min-w-0 flex-1">
                            <div className={`truncate ${selectedFileId === file.id ? 'font-medium' : ''}`}>{file.name}</div>
                            <div className={`mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] leading-tight ${selectedFileId === file.id ? (activeTab === 'rx' ? 'text-violet-700/90' : 'text-blue-600/80') : 'text-slate-400'}`}>
                                <span>{recordCount} 条</span>
                                <span className="truncate" title={`${dateLabel}创建`}>{dateLabel}创建</span>
                            </div>
                        </div>
                    </button>
                    );
                })}
              </div>
              
              {/* Delete Button for File */}
              <div className="pt-4 border-t border-slate-100 mt-2">
                  <button 
                    onClick={() => setDeleteResourceModalOpen(true)}
                    disabled={!selectedFileId}
                    className="w-full flex items-center justify-center gap-2 text-red-500 hover:bg-red-50 p-2 rounded-lg text-xs font-semibold disabled:opacity-50"
                  >
                      <Icons.Trash className="w-3 h-3" />
                      删除当前库
                  </button>
              </div>
          </div>

          {activeTab === 'gr' ? (
              <GrammarRuleBooksPanel
                  books={grammarRuleBooks}
                  selectedBookId={selectedFileId}
                  onChange={onGrammarRuleBooksChange}
                  regexDictionaryBooks={regexDictionaryBooks}
              />
          ) : activeTab === 'rx' ? (
              <RegexDictionaryPanel
                  books={regexDictionaryBooks}
                  selectedBookId={selectedFileId}
                  onChange={onRegexDictionaryBooksChange}
              />
          ) : (
          <div className="flex-1 flex flex-col min-w-0">
             <div className="flex items-center justify-between mb-4">
                <div className="relative w-64">
                    <Icons.Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input 
                        type="text" 
                        placeholder="在此库中搜索..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 text-sm bg-white border border-slate-200 rounded-xl outline-none focus:border-blue-500"
                    />
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                        type="button"
                        onClick={handleOpenCreateModal}
                        className="flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 text-sm font-medium text-slate-700"
                        title="创建空库"
                    >
                        <Icons.File className="w-4 h-4 text-slate-600" />
                        创建
                    </button>
                    <label
                        className="flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 text-sm font-medium text-slate-700 cursor-pointer"
                        title="从 Excel 导入"
                    >
                        <Icons.Upload className="w-4 h-4 text-slate-600" />
                        导入
                        <input type="file" className="hidden" accept=".xlsx,.xls,.json,.txt" onChange={handleImportFile} />
                    </label>
                    <button onClick={handleExportFile} className="flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 text-sm font-medium text-slate-700" title="导出当前库">
                        <Icons.Download className="w-4 h-4 text-slate-600"/> 导出
                    </button>
                    {activeTab === 'tm' && (
                        <button onClick={handleOpenMergeModal} className="flex items-center gap-2 border border-slate-200 rounded-lg hover:bg-slate-50 text-sm font-medium text-slate-700 px-3 py-2" title="合并记忆库">
                            <Icons.Database className="w-4 h-4 text-slate-600"/> 合并
                        </button>
                    )}
                    {activeTab === 'tb' && (
                        <button onClick={openAddModal} className="flex items-center gap-2 bg-blue-600 text-white px-3 py-2 rounded-lg text-sm hover:bg-blue-700 shadow-sm font-medium">
                            <Icons.Plus className="w-4 h-4"/> 添加条目
                        </button>
                    )}
                </div>
             </div>

             <div className="flex-1 overflow-auto bg-white rounded-xl border border-slate-200 shadow-sm">
                <table className="w-full text-left">
                    <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500 sticky top-0">
                        <tr>
                            <th className="px-6 py-3">Source</th>
                            <th className="px-6 py-3">Target</th>
                            <th className="px-6 py-3 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {filteredData.length > 0 ? filteredData.map((item: any) => (
                            <tr key={item.id} className="hover:bg-slate-50">
                                <td className="px-6 py-3 text-sm text-slate-900 cursor-text select-text">{item.source}</td>
                                <td className="px-6 py-3 text-sm text-slate-600 cursor-text select-text">{item.target}</td>
                                <td className="px-6 py-3 text-right flex justify-end gap-2">
                                     <button onClick={() => openEditModal(item)} className="text-slate-400 hover:text-blue-500">
                                        <Icons.Edit className="w-4 h-4"/>
                                    </button>
                                    <button onClick={() => {
                                        setItemToDelete({ id: item.id, source: item.source });
                                        setShowDeleteConfirm(true);
                                    }} className="text-slate-400 hover:text-red-500">
                                        <Icons.Trash className="w-4 h-4"/>
                                    </button>
                                </td>
                            </tr>
                        )) : (
                            <tr>
                                <td colSpan={3} className="px-6 py-12 text-center text-slate-400 text-sm">
                                    没有找到数据
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
             </div>
          </div>
          )}
      </div>

       {/* Add/Edit Term Modal */}
       {isModalOpen && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
                       <h2 className="text-lg font-bold text-slate-900 mb-4">{editMode ? '编辑' : '添加'} {activeTab === 'tb' ? '术语' : activeTab === 'tm' ? '记忆单元' : '规则'}</h2>
                  <div className="space-y-4">
                      <div>
                          <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">原文 (Source)</label>
                          <input 
                            className="w-full border p-2 rounded text-sm" 
                            placeholder="Source" 
                            value={sourceInput} 
                            onChange={e => setSourceInput(e.target.value)} 
                            autoFocus
                        />
                      </div>
                      <div>
                        <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">译文 (Target)</label>
                        <input 
                            className="w-full border p-2 rounded text-sm" 
                            placeholder="Target" 
                            value={targetInput} 
                            onChange={e => setTargetInput(e.target.value)} 
                        />
                      </div>
                  </div>
                  <div className="flex justify-end gap-2 mt-6">
                      <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded text-sm">取消</button>
                      <button onClick={handleSave} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium">保存</button>
                  </div>
              </div>
          </div>
       )}

       {/* Delete Resource Confirmation Modal */}
       {deleteResourceModalOpen && (
           <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-in zoom-in-95 duration-200">
                <div className="flex flex-col items-center text-center">
                    <div className="w-12 h-12 bg-red-100 text-red-500 rounded-full flex items-center justify-center mb-4">
                        <Icons.Trash className="w-6 h-6" />
                    </div>
                    <h2 className="text-lg font-bold text-slate-900 mb-2">删除库</h2>
                    <p className="text-sm text-slate-500 mb-6">
                        您确定要删除 <b>{currentResourceName}</b> 吗？此操作无法撤销。
                    </p>
                    <div className="flex gap-3 w-full">
                        <button 
                            onClick={() => setDeleteResourceModalOpen(false)}
                            className="flex-1 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
                        >
                            取消
                        </button>
                        <button 
                            onClick={handleDeleteCurrentResource}
                            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg shadow-md shadow-red-500/20"
                        >
                            确认删除
                        </button>
                    </div>
                </div>
            </div>
           </div>
       )}

       {/* Create Empty Resource Modal */}
       {showCreateModal && (
           <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowCreateModal(false)}>
               <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
                   <div className="flex justify-between items-center mb-4">
                       <h2 className="text-lg font-bold text-slate-900">
                           {activeTab === 'tb'
                               ? '创建术语库'
                               : activeTab === 'tm'
                                 ? '创建记忆库'
                                 : activeTab === 'gr'
                                   ? '创建规则词典'
                                   : '创建正则表达式词典'}
                       </h2>
                       <button
                           onClick={() => setShowCreateModal(false)}
                           className="text-slate-400 hover:text-slate-600"
                       >
                           <Icons.X className="w-5 h-5" />
                       </button>
                   </div>

                   <div className="space-y-4 mb-6">
                       <div>
                           <label className="block text-sm font-medium text-slate-700 mb-2">资源名称</label>
                           <input
                               type="text"
                               value={newResourceName}
                               onChange={(e) => setNewResourceName(e.target.value)}
                               placeholder={`例如：${activeTab === 'tb' ? '产品术语库' : activeTab === 'tm' ? '技术文档记忆库' : activeTab === 'gr' ? '英中句式规则' : '英中正则表达式'}`}
                               className="w-full border border-slate-300 rounded-lg p-2.5 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                           />
                       </div>

                       <div className="grid grid-cols-2 gap-4">
                           <div>
                               <label className="block text-sm font-medium text-slate-700 mb-2">源语言</label>
                               <select
                                   value={newResourceSourceLang}
                                   onChange={(e) => setNewResourceSourceLang(e.target.value)}
                                   className="w-full border border-slate-300 rounded-lg p-2.5 bg-white outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                               >
                                   {SUPPORTED_LANGUAGES.map(lang => (
                                       <option key={lang.code} value={lang.code}>{lang.name}</option>
                                   ))}
                               </select>
                           </div>
                           <div>
                               <label className="block text-sm font-medium text-slate-700 mb-2">目标语言</label>
                               <select
                                   value={newResourceTargetLang}
                                   onChange={(e) => setNewResourceTargetLang(e.target.value)}
                                   className="w-full border border-slate-300 rounded-lg p-2.5 bg-white outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                               >
                                   {SUPPORTED_LANGUAGES.map(lang => (
                                       <option key={lang.code} value={lang.code}>{lang.name}</option>
                                   ))}
                               </select>
                           </div>
                       </div>

                       <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                           <div className="flex items-start gap-3">
                               <Icons.Info className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />
                               <div>
                                   <h4 className="text-sm font-medium text-blue-800 mb-1">创建提示</h4>
                                   <p className="text-xs text-blue-700">
                                       创建后的资源库为空，您可以：
                                       <ul className="mt-1.5 space-y-1 ml-4 list-disc">
                                           <li>手动添加条目</li>
                                           <li>从Excel文件导入内容</li>
                                           <li>在翻译过程中自动添加条目</li>
                                       </ul>
                                   </p>
                               </div>
                           </div>
                       </div>
                   </div>

                   <div className="flex justify-end gap-2">
                       <button
                           onClick={() => setShowCreateModal(false)}
                           className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded text-sm"
                       >
                           取消
                       </button>
                       <button
                           onClick={handleCreateEmptyResource}
                           disabled={!newResourceName.trim()}
                           className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium disabled:bg-blue-300 disabled:cursor-not-allowed"
                       >
                           创建
                       </button>
                   </div>
               </div>
           </div>
       )}

       {/* Import Options Modal */}
       {showImportOptions && (
           <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
               <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 animate-in zoom-in-95 duration-200">
                   <h2 className="text-lg font-bold text-slate-900 mb-4">导入选项</h2>
                   <p className="text-sm text-slate-500 mb-6">
                       您选择导入文件: <b>{importFile?.name}</b>
                   </p>

                   <div className="space-y-4 mb-6">
                       <div>
                           <h3 className="text-sm font-medium text-slate-700 mb-2">导入目标</h3>
                           <div className="space-y-2">
                               <label className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-slate-50 ${importDestination === 'existing' ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}>
                                   <input
                                       type="radio"
                                       name="importDestination"
                                       value="existing"
                                       checked={importDestination === 'existing'}
                                       onChange={() => setImportDestination('existing')}
                                       className="text-blue-600"
                                       disabled={!selectedFileId}
                                   />
                                   <div>
                                       <div className="font-medium text-slate-800">导入到现有库</div>
                                       <div className="text-xs text-slate-500">
                                           {selectedFileId ? `导入到: ${currentResourceName}` : '没有可用的现有库'}
                                       </div>
                                   </div>
                               </label>
                               <label className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-slate-50 ${importDestination === 'new' ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}>
                                   <input
                                       type="radio"
                                       name="importDestination"
                                       value="new"
                                       checked={importDestination === 'new'}
                                       onChange={() => setImportDestination('new')}
                                       className="text-blue-600"
                                   />
                                   <div>
                                       <div className="font-medium text-slate-800">创建新库</div>
                                       <div className="text-xs text-slate-500">根据导入文件创建新的术语库或记忆库</div>
                                   </div>
                               </label>
                           </div>
                       </div>

                       {importDestination === 'existing' && (
                           <div>
                               <h3 className="text-sm font-medium text-slate-700 mb-2">导入模式</h3>
                               <div className="space-y-2">
                                   <label className="flex items-center gap-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50">
                                       <input
                                           type="radio"
                                           name="importMode"
                                           value="overwrite"
                                           checked={importMode === 'overwrite'}
                                           onChange={() => setImportMode('overwrite')}
                                           className="text-blue-600"
                                       />
                                       <div>
                                           <div className="font-medium text-slate-800">覆盖现有条目</div>
                                           <div className="text-xs text-slate-500">替换库中的所有现有条目</div>
                                       </div>
                                   </label>
                                   <label className="flex items-center gap-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50">
                                       <input
                                           type="radio"
                                           name="importMode"
                                           value="merge"
                                           checked={importMode === 'merge'}
                                           onChange={() => setImportMode('merge')}
                                           className="text-blue-600"
                                       />
                                       <div>
                                           <div className="font-medium text-slate-800">合并新增条目</div>
                                           <div className="text-xs text-slate-500">仅添加新条目，跳过重复内容</div>
                                       </div>
                                   </label>
                               </div>
                           </div>
                       )}

                       {/* Warning message for overwrite mode */}
                       {importDestination === 'existing' && importMode === 'overwrite' && selectedFileId && (
                           <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                               <div className="flex items-start gap-3">
                                   <Icons.Warning className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
                                   <div>
                                       <h4 className="text-sm font-bold text-red-800 mb-1">警告：此操作不可逆！</h4>
                                       <p className="text-xs text-red-700 mb-2">
                                           选择"覆盖现有条目"将完全替换当前库中的所有内容。
                                           这意味着所有现有数据将被永久删除，无法恢复。
                                       </p>
                                       <p className="text-xs text-red-700 mb-3">
                                           请确保您已经备份了所有重要数据，或者确认不再需要当前库中的内容。
                                       </p>
                                       <div className="flex items-center gap-2">
                                           <input
                                               type="checkbox"
                                               id="confirmOverwrite"
                                               checked={confirmOverwrite}
                                               onChange={(e) => setConfirmOverwrite(e.target.checked)}
                                               className="text-red-600"
                                           />
                                           <label htmlFor="confirmOverwrite" className="text-xs text-red-700 cursor-pointer">
                                               我理解此操作将永久删除现有数据，无法恢复
                                           </label>
                                       </div>
                                   </div>
                               </div>
                           </div>
                       )}
                   </div>
                   
                   <div className="flex justify-end gap-2">
                       <button 
                           onClick={() => {
                               setShowImportOptions(false);
                               setConfirmOverwrite(false);
                           }}
                           className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded text-sm"
                       >
                           取消
                       </button>
                       <button
                           onClick={processImport}
                           disabled={
                               importDestination === 'existing' &&
                               importMode === 'overwrite' &&
                               Boolean(selectedFileId) &&
                               !confirmOverwrite
                           }
                           className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium disabled:bg-blue-300 disabled:cursor-not-allowed"
                       >
                           开始导入
                       </button>
                   </div>
               </div>
           </div>
       )}

       {/* Import Progress Modal */}
       {isImporting && (
           <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
               <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 animate-in zoom-in-95 duration-200">
                   <h2 className="text-lg font-bold text-slate-900 mb-4">正在导入</h2>
                   <p className="text-sm text-slate-500 mb-6">
                       正在处理文件: <b>{importFile?.name}</b>
                   </p>
                   
                   <div className="space-y-4">
                       <div>
                           <div className="flex justify-between text-sm mb-1">
                               <span className="text-slate-500">处理进度</span>
                               <span className="text-slate-700 font-medium">{importProgress}%</span>
                           </div>
                           <div className="w-full bg-slate-200 rounded-full h-2">
                               <div 
                                   className="bg-blue-600 h-2 rounded-full transition-all duration-300 ease-in-out"
                                   style={{ width: `${importProgress}%` }}
                               ></div>
                           </div>
                       </div>
                   </div>
               </div>
           </div>
       )}

       {/* Import Results Modal */}
       {showImportResults && importResults && (
           <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
               <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 animate-in zoom-in-95 duration-200">
                   <div className="flex items-center gap-2 mb-4">
                       <div className="w-10 h-10 bg-green-100 text-green-600 rounded-full flex items-center justify-center">
                           <Icons.Check className="w-5 h-5" />
                       </div>
                       <h2 className="text-lg font-bold text-slate-900">导入完成</h2>
                   </div>
                   
                   <div className="space-y-4 mb-6">
                       <p className="text-sm text-slate-500">
                           文件 <b>{importFile?.name}</b> 导入成功！
                       </p>
                       
                       <div className="grid grid-cols-3 gap-4 text-center">
                           <div className="p-3 bg-slate-50 rounded-lg">
                               <div className="text-2xl font-bold text-slate-900">{importResults.total}</div>
                               <div className="text-xs text-slate-500">总条目</div>
                           </div>
                           <div className="p-3 bg-green-50 rounded-lg">
                               <div className="text-2xl font-bold text-green-600">{importResults.success}</div>
                               <div className="text-xs text-slate-500">成功导入</div>
                           </div>
                           <div className="p-3 bg-yellow-50 rounded-lg">
                               <div className="text-2xl font-bold text-yellow-600">{importResults.skipped}</div>
                               <div className="text-xs text-slate-500">跳过重复</div>
                           </div>
                       </div>
                   </div>
                   
                   <div className="flex justify-end">
                       <button 
                           onClick={() => setShowImportResults(false)}
                           className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium"
                       >
                           确定
                       </button>
                   </div>
               </div>
           </div>
       )}

       {/* Delete Item Confirmation Modal */}
       {showDeleteConfirm && itemToDelete && (
           <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-in zoom-in-95 duration-200">
                <div className="flex flex-col items-center text-center">
                    <div className="w-12 h-12 bg-red-100 text-red-500 rounded-full flex items-center justify-center mb-4">
                        <Icons.Trash className="w-6 h-6" />
                    </div>
                    <h2 className="text-lg font-bold text-slate-900 mb-2">删除{activeTab === 'tb' ? '术语' : activeTab === 'tm' ? '记忆单元' : '规则'}</h2>
                    <p className="text-sm text-slate-500 mb-6">
                        您确定要删除条目 <b>{itemToDelete.source}</b> 吗？此操作无法撤销。
                    </p>
                    <div className="flex gap-3 w-full">
                        <button 
                            onClick={() => {
                                setShowDeleteConfirm(false);
                                setItemToDelete(null);
                            }}
                            className="flex-1 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
                        >
                            取消
                        </button>
                        <button 
                            onClick={handleConfirmDelete}
                            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg shadow-md shadow-red-500/20"
                        >
                            确认删除
                        </button>
                    </div>
                </div>
            </div>
           </div>
       )}

       {/* Merge Memory Bases Modal */}
       {mergeModalOpen && (
           <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
               <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 animate-in zoom-in-95 duration-200">
                   <h2 className="text-lg font-bold text-slate-900 mb-4">合并记忆库</h2>
                   <p className="text-sm text-slate-500 mb-6">
                       选择要合并的源记忆库和目标记忆库
                   </p>
                    
                   <div className="space-y-6 mb-6">
                       {/* Source TMs */}
                       <div>
                           <h3 className="text-sm font-medium text-slate-700 mb-3">源记忆库（可多选）</h3>
                           <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                               {translationMemories.map(tm => (
                                   <label key={tm.id} className="flex items-center gap-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50">
                                       <input 
                                           type="checkbox" 
                                           checked={selectedSourceTMs.includes(tm.id)} 
                                           onChange={(e) => {
                                               if (e.target.checked) {
                                                   setSelectedSourceTMs(prev => [...prev, tm.id]);
                                               } else {
                                                   setSelectedSourceTMs(prev => prev.filter(id => id !== tm.id));
                                               }
                                           }}
                                           className="text-blue-600"
                                           disabled={tm.id === targetTMId}
                                       />
                                       <div className="flex-1 min-w-0">
                                           <div className="font-medium text-slate-800 truncate">{tm.name}</div>
                                           <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
                                               <span>{tm.units.length} 条</span>
                                               <span className="truncate">{formatResourceCreatedDateLabel(tm.createdAt)}创建</span>
                                           </div>
                                       </div>
                                   </label>
                               ))}
                           </div>
                       </div>
                       
                       {/* Target TM */}
                       <div>
                           <h3 className="text-sm font-medium text-slate-700 mb-3">目标记忆库（单选）</h3>
                           <div className="space-y-2">
                               {translationMemories.map(tm => (
                                   <label key={tm.id} className="flex items-center gap-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50">
                                       <input 
                                           type="radio" 
                                           name="targetTM" 
                                           checked={targetTMId === tm.id} 
                                           onChange={() => {
                                               setTargetTMId(tm.id);
                                               // Remove target from source selection if it was selected
                                               setSelectedSourceTMs(prev => prev.filter(id => id !== tm.id));
                                           }}
                                           className="text-blue-600"
                                       />
                                       <div className="flex-1 min-w-0">
                                           <div className="font-medium text-slate-800 truncate">{tm.name}</div>
                                           <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
                                               <span>{tm.units.length} 条</span>
                                               <span className="truncate">{formatResourceCreatedDateLabel(tm.createdAt)}创建</span>
                                           </div>
                                       </div>
                                   </label>
                               ))}
                           </div>
                       </div>
                   </div>
                   
                   <div className="flex justify-end gap-2">
                       <button 
                           onClick={() => setMergeModalOpen(false)}
                           className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded text-sm"
                       >
                           取消
                       </button>
                       <button 
                           onClick={processMerge}
                           disabled={!targetTMId || selectedSourceTMs.length === 0}
                           className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium disabled:bg-blue-300 disabled:cursor-not-allowed"
                       >
                           开始合并
                       </button>
                   </div>
               </div>
           </div>
       )}

       {/* Merge Progress Modal */}
       {isMerging && (
           <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
               <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-in zoom-in-95 duration-200">
                   <h2 className="text-lg font-bold text-slate-900 mb-4">正在合并记忆库</h2>
                   <p className="text-sm text-slate-500 mb-6">
                       正在处理合并操作...
                   </p>
                   
                   <div className="space-y-4">
                       <div>
                           <div className="flex justify-between text-sm mb-1">
                               <span className="text-slate-500">处理进度</span>
                               <span className="text-slate-700 font-medium">{mergeProgress}%</span>
                           </div>
                           <div className="w-full bg-slate-200 rounded-full h-2">
                               <div 
                                   className="bg-blue-600 h-2 rounded-full transition-all duration-300 ease-in-out"
                                   style={{ width: `${mergeProgress}%` }}
                               ></div>
                           </div>
                       </div>
                   </div>
               </div>
           </div>
       )}

       {/* Merge Results Modal */}
       {showMergeResults && mergeResults && (
           <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
               <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-in zoom-in-95 duration-200">
                   <div className="flex items-center gap-2 mb-4">
                       <div className="w-10 h-10 bg-green-100 text-green-600 rounded-full flex items-center justify-center">
                           <Icons.Check className="w-5 h-5" />
                       </div>
                       <h2 className="text-lg font-bold text-slate-900">合并完成</h2>
                   </div>
                   
                   <div className="space-y-4 mb-6">
                       <p className="text-sm text-slate-500">
                           记忆库合并成功！
                       </p>
                       
                       <div className="grid grid-cols-3 gap-4 text-center">
                           <div className="p-3 bg-slate-50 rounded-lg">
                               <div className="text-2xl font-bold text-slate-900">{mergeResults.total}</div>
                               <div className="text-xs text-slate-500">总条目</div>
                           </div>
                           <div className="p-3 bg-green-50 rounded-lg">
                               <div className="text-2xl font-bold text-green-600">{mergeResults.success}</div>
                               <div className="text-xs text-slate-500">成功合并</div>
                           </div>
                           <div className="p-3 bg-yellow-50 rounded-lg">
                               <div className="text-2xl font-bold text-yellow-600">{mergeResults.skipped}</div>
                               <div className="text-xs text-slate-500">跳过重复</div>
                           </div>
                       </div>
                   </div>
                   
                   <div className="flex justify-end">
                       <button 
                           onClick={() => {
                               setShowMergeResults(false);
                               setMergeModalOpen(false);
                           }}
                           className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium"
                       >
                           确定
                       </button>
                   </div>
               </div>
           </div>
       )}
    </div>
  );
};