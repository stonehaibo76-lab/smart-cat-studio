
import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { Project, TermBase, TranslationMemory, TwinTranslatorProfile, KnowledgeBase } from '../types';
import { MOCK_PROJECTS, MOCK_TBS, MOCK_TMS } from '../constants';

interface SmartCatDB extends DBSchema {
  projects: {
    key: string;
    value: Project;
  };
  termbases: {
    key: string;
    value: TermBase;
  };
  translationMemories: {
    key: string;
    value: TranslationMemory;
  };
  twinTranslators: {
    key: string;
    value: TwinTranslatorProfile;
  };
  knowledgeBases: {
    key: string;
    value: KnowledgeBase;
  };
  settings: {
    key: string;
    value: any;
  };
}

const DB_NAME = 'smart-cat-db';
const DB_VERSION = 4; // v4: 知识库（RAG）

let dbPromise: Promise<IDBPDatabase<SmartCatDB>> | null = null;

export const initDB = () => {
  if (!dbPromise) {
    dbPromise = openDB<SmartCatDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, newVersion, transaction) {
        // 版本1→2→3的迁移逻辑
        if (oldVersion < 1) {
          // 初始版本
          db.createObjectStore('projects', { keyPath: 'id' });
          db.createObjectStore('termbases', { keyPath: 'id' });
          db.createObjectStore('translationMemories', { keyPath: 'id' });
          db.createObjectStore('settings');
        }
        
        if (oldVersion < 2) {
          // 版本1→2的迁移
          // 创建新的object store或更新现有
          if (!db.objectStoreNames.contains('settings')) {
            db.createObjectStore('settings');
          }
        }
        
        if (oldVersion < 3) {
          // 版本2→3：添加孪生译员表
          if (!db.objectStoreNames.contains('twinTranslators')) {
            db.createObjectStore('twinTranslators', { keyPath: 'id' });
          }
        }

        if (oldVersion < 4) {
          if (!db.objectStoreNames.contains('knowledgeBases')) {
            db.createObjectStore('knowledgeBases', { keyPath: 'id' });
          }
        }
      },
    });
  }
  return dbPromise;
};

export const loadAllData = async () => {
   const db = await initDB();
   
   // Load all data in parallel
   const [projects, tbs, tms, twinTranslators, knowledgeBases, aiSettings, editorSettings, quickPrompts, favoriteUrls, customOnlineDictionaries, embeddingSettings] =
     await Promise.all([
       db.getAll('projects'),
       db.getAll('termbases'),
       db.getAll('translationMemories'),
       db.getAll('twinTranslators'),
       db.getAll('knowledgeBases'),
       db.get('settings', 'ai-settings'),
       db.get('settings', 'editor-settings'),
       db.get('settings', 'quick-prompts'),
       db.get('settings', 'favorite-urls'),
       db.get('settings', 'custom-online-dictionaries'),
       db.get('settings', 'embedding-settings')
   ]);

   // Check if DB was initialized before
   const isInitialized = await db.get('settings', 'db-initialized');

   if (!isInitialized) {
       console.log("Database not initialized. Seeding mock data...");
       // Seed Mocks
       const tx = db.transaction(['projects', 'termbases', 'translationMemories', 'twinTranslators', 'settings'], 'readwrite');
       await Promise.all([
           ...MOCK_PROJECTS.map(p => tx.objectStore('projects').put(p)),
           ...MOCK_TBS.map(tb => tx.objectStore('termbases').put(tb)),
           ...MOCK_TMS.map(tm => tx.objectStore('translationMemories').put(tm)),
           tx.objectStore('settings').put(true, 'db-initialized')
       ]);
       await tx.done;
       
       return {
           projects: MOCK_PROJECTS,
           termBases: MOCK_TBS,
           translationMemories: MOCK_TMS,
           twinTranslators: twinTranslators || [],
           knowledgeBases: knowledgeBases || [],
           aiSettings: aiSettings || { provider: 'gemini', model: 'gemini-3-flash-preview' },
           editorSettings: editorSettings || null,
           quickPrompts: quickPrompts || null,
           favoriteUrls: favoriteUrls || null,
           customOnlineDictionaries: customOnlineDictionaries || null,
           embeddingSettings: embeddingSettings || null
       };
   }

   return {
     projects: projects,
     termBases: tbs,
     translationMemories: tms,
     twinTranslators: twinTranslators || [],
     knowledgeBases: knowledgeBases || [],
     aiSettings: aiSettings || { provider: 'gemini', model: 'gemini-3-flash-preview' },
     editorSettings: editorSettings || null,
     quickPrompts: quickPrompts || null,
     favoriteUrls: favoriteUrls || null,
     customOnlineDictionaries: customOnlineDictionaries || null,
     embeddingSettings: embeddingSettings || null
   };
};

// --- Saving Functions ---

export const saveProjects = async (projects: Project[]) => {
    const db = await initDB();
    const tx = db.transaction('projects', 'readwrite');
    await tx.store.clear();
    for (const p of projects) {
        await tx.store.put(p);
    }
    await tx.done;
};

export const saveTermBases = async (tbs: TermBase[]) => {
    const db = await initDB();
    const tx = db.transaction('termbases', 'readwrite');
    await tx.store.clear();
    for (const tb of tbs) {
        await tx.store.put(tb);
    }
    await tx.done;
};

export const saveTMs = async (tms: TranslationMemory[]) => {
    const db = await initDB();
    const tx = db.transaction('translationMemories', 'readwrite');
    await tx.store.clear();
    for (const tm of tms) {
        await tx.store.put(tm);
    }
    await tx.done;
};

// --- 孪生译员相关函数 ---

export const saveTwinTranslators = async (twinTranslators: TwinTranslatorProfile[]) => {
    const db = await initDB();
    const tx = db.transaction('twinTranslators', 'readwrite');
    await tx.store.clear();
    for (const translator of twinTranslators) {
        await tx.store.put(translator);
    }
    await tx.done;
};

export const saveKnowledgeBases = async (list: KnowledgeBase[]) => {
    const db = await initDB();
    const tx = db.transaction('knowledgeBases', 'readwrite');
    await tx.store.clear();
    for (const kb of list) {
        await tx.store.put(kb);
    }
    await tx.done;
};

export const addTwinTranslator = async (translator: TwinTranslatorProfile) => {
    const db = await initDB();
    await db.put('twinTranslators', translator);
};

export const updateTwinTranslator = async (translator: TwinTranslatorProfile) => {
    const db = await initDB();
    await db.put('twinTranslators', translator);
};

export const deleteTwinTranslator = async (id: string) => {
    const db = await initDB();
    await db.delete('twinTranslators', id);
};

export const getTwinTranslatorById = async (id: string): Promise<TwinTranslatorProfile | undefined> => {
    const db = await initDB();
    return await db.get('twinTranslators', id);
};

export const getAllTwinTranslators = async (): Promise<TwinTranslatorProfile[]> => {
    const db = await initDB();
    return await db.getAll('twinTranslators');
};

export const getTwinTranslatorsByLanguagePair = async (languagePair: string): Promise<TwinTranslatorProfile[]> => {
    const db = await initDB();
    const allTranslators = await db.getAll('twinTranslators');
    return allTranslators.filter(t => t.languagePair === languagePair);
};

export const saveSettings = async (key: string, value: any) => {
    const db = await initDB();
    await db.put('settings', value, key);
};
