import { putXliffBlob, getXliffBlob, deleteXliffBlobs } from '../localBackendClient';

const IDB_NAME = 'smartcat-xliff-blobs';
const IDB_STORE = 'blobs';

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
  });
}

async function idbPut(id: string, data: ArrayBuffer): Promise<void> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(data, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(id: string): Promise<ArrayBuffer | null> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(id);
    req.onsuccess = () => resolve((req.result as ArrayBuffer) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbDeleteMany(ids: string[]): Promise<void> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    for (const id of ids) store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function newXliffBlobId(): string {
  return `xliff-${crypto.randomUUID()}`;
}

export async function saveXliffBlob(id: string, data: ArrayBuffer | Uint8Array): Promise<void> {
  const buf = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  try {
    await putXliffBlob(id, buf);
  } catch {
    await idbPut(id, buf as ArrayBuffer);
  }
}

export async function loadXliffBlob(id: string): Promise<ArrayBuffer | null> {
  try {
    const fromServer = await getXliffBlob(id);
    if (fromServer) return fromServer;
  } catch {
    /* fallback */
  }
  return idbGet(id);
}

export async function removeXliffBlobs(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    await deleteXliffBlobs(ids);
  } catch {
    /* continue */
  }
  try {
    await idbDeleteMany(ids);
  } catch {
    /* ignore */
  }
}

export function bytesToUtf8(bytes: ArrayBuffer): string {
  const bom = new Uint8Array(bytes.slice(0, 3));
  const hasBom = bom[0] === 0xef && bom[1] === 0xbb && bom[2] === 0xbf;
  const decoder = new TextDecoder('utf-8');
  return decoder.decode(hasBom ? bytes.slice(3) : bytes);
}

export function utf8ToBytes(text: string, preserveBom: boolean): Uint8Array {
  const encoded = new TextEncoder().encode(text);
  if (!preserveBom) return encoded;
  const out = new Uint8Array(3 + encoded.length);
  out[0] = 0xef;
  out[1] = 0xbb;
  out[2] = 0xbf;
  out.set(encoded, 3);
  return out;
}

export function detectBom(bytes: ArrayBuffer): boolean {
  const b = new Uint8Array(bytes.slice(0, 3));
  return b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;
}
