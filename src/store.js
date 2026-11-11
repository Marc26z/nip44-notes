import { FILE_EXT, noteFileName, parseEnvelope, serializeEnvelope } from "./core.js";

const PREF_KEY = "nip44notes.storage.v1";
const LOCAL_PREFIX = "nip44notes.file.";
const DB_NAME = "nip44-notes";
const DB_STORE = "kv";
const FOLDER_KEY = "notesDir";
const OPFS_DIR = "notes";

function idbOpen() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DB_STORE)) {
        request.result.createObjectStore(DB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet(key) {
  const db = await idbOpen();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readonly");
      const req = tx.objectStore(DB_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function idbSet(key, value) {
  const db = await idbOpen();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Storage transaction aborted"));
    });
  } finally {
    db.close();
  }
}

async function idbDel(key) {
  const db = await idbOpen();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export function getStoragePref() {
  const value = localStorage.getItem(PREF_KEY);
  return value === "folder" || value === "opfs" || value === "local" ? value : null;
}

export function setStoragePref(value) {
  if (value === null) localStorage.removeItem(PREF_KEY);
  else localStorage.setItem(PREF_KEY, value);
}

export function folderPickerSupported() {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

export function filePickerSupported() {
  return (
    typeof window !== "undefined" &&
    typeof window.showOpenFilePicker === "function" &&
    typeof window.showSaveFilePicker === "function"
  );
}

export async function loadSavedFolderHandle() {
  try {
    return (await idbGet(FOLDER_KEY)) || null;
  } catch {
    return null;
  }
}

export async function saveFolderHandle(handle) {
  await idbSet(FOLDER_KEY, handle);
}

export async function forgetFolderHandle() {
  try {
    await idbDel(FOLDER_KEY);
  } catch {
    /* ignore */
  }
}

export async function queryFolderPermission(handle) {
  if (!handle || typeof handle.queryPermission !== "function") return "granted";
  try {
    return await handle.queryPermission({ mode: "readwrite" });
  } catch {
    return "prompt";
  }
}

export async function requestFolderPermission(handle) {
  if (!handle || typeof handle.requestPermission !== "function") return true;
  try {
    return (await handle.requestPermission({ mode: "readwrite" })) === "granted";
  } catch {
    return false;
  }
}

class DirectoryStore {
  constructor(dir, kind) {
    this.dir = dir;
    this.kind = kind;
  }

  describe() {
    if (this.kind === "folder") {
      return {
        kind: "folder",
        label: "Folder",
        detail: this.dir.name ? `“${this.dir.name}”` : "Selected folder",
      };
    }
    return { kind: "opfs", label: "Private app storage", detail: "Files kept by NIP44 Notes" };
  }

  async list() {
    const envelopes = [];
    let invalid = 0;
    for await (const entry of this.dir.values()) {
      if (entry.kind !== "file" || !entry.name.endsWith(FILE_EXT)) continue;
      try {
        const file = await entry.getFile();
        envelopes.push(parseEnvelope(await file.text()));
      } catch {
        invalid++;
      }
    }
    return { envelopes, invalid };
  }

  async read(id) {
    const handle = await this.dir.getFileHandle(noteFileName(id));
    const file = await handle.getFile();
    return parseEnvelope(await file.text());
  }

  async write(id, envelope) {
    const handle = await this.dir.getFileHandle(noteFileName(id), { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(serializeEnvelope(envelope));
    } finally {
      await writable.close();
    }
  }

  async remove(id) {
    try {
      await this.dir.removeEntry(noteFileName(id));
    } catch (error) {
      if (error?.name !== "NotFoundError") throw error;
    }
  }

  async clear() {
    const names = [];
    for await (const entry of this.dir.values()) {
      if (entry.kind === "file" && entry.name.endsWith(FILE_EXT)) names.push(entry.name);
    }
    for (const name of names) {
      try {
        await this.dir.removeEntry(name);
      } catch {
        /* ignore */
      }
    }
  }
}

class LocalStore {
  constructor() {
    this.kind = "local";
  }

  describe() {
    return {
      kind: "local",
      label: "Browser storage",
      detail: "Fallback storage in this browser",
    };
  }

  async list() {
    const envelopes = [];
    let invalid = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(LOCAL_PREFIX)) continue;
      try {
        envelopes.push(parseEnvelope(localStorage.getItem(key)));
      } catch {
        invalid++;
      }
    }
    return { envelopes, invalid };
  }

  async read(id) {
    const raw = localStorage.getItem(LOCAL_PREFIX + noteFileName(id));
    if (!raw) throw new Error("Note not found");
    return parseEnvelope(raw);
  }

  async write(id, envelope) {
    localStorage.setItem(LOCAL_PREFIX + noteFileName(id), serializeEnvelope(envelope));
  }

  async remove(id) {
    localStorage.removeItem(LOCAL_PREFIX + noteFileName(id));
  }

  async clear() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(LOCAL_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  }
}

export function createFolderStore(handle) {
  return new DirectoryStore(handle, "folder");
}

export async function chooseFolderHandle() {
  if (!folderPickerSupported()) throw new Error("This browser cannot open a folder picker");
  return window.showDirectoryPicker({
    id: "nip44-notes",
    mode: "readwrite",
    startIn: "documents",
  });
}

export async function pickFolderStore() {
  const handle = await chooseFolderHandle();
  await saveFolderHandle(handle);
  setStoragePref("folder");
  return { store: createFolderStore(handle), handle };
}

export async function openOpfsStore() {
  if (!navigator.storage || typeof navigator.storage.getDirectory !== "function") {
    throw new Error("This browser does not support private file storage");
  }
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle(OPFS_DIR, { create: true });
  return new DirectoryStore(dir, "opfs");
}

export async function useOpfsStorage() {
  const store = await openOpfsStore();
  setStoragePref("opfs");
  return store;
}

export async function useLocalStorageFallback() {
  setStoragePref("local");
  return new LocalStore();
}

export async function prepareStore() {
  const pref = getStoragePref();
  if (pref === "folder") {
    const handle = await loadSavedFolderHandle();
    if (!handle) {
      setStoragePref(null);
      return { status: "choose" };
    }
    const permission = await queryFolderPermission(handle);
    if (permission !== "granted") {
      return { status: "permission", handle };
    }
    return { status: "ready", store: createFolderStore(handle), handle };
  }
  if (pref === "opfs") {
    try {
      return { status: "ready", store: await openOpfsStore(), handle: null };
    } catch {
      return {
        status: "ready",
        store: new LocalStore(),
        handle: null,
        warning: "Private file storage is unavailable, so notes are using browser storage.",
      };
    }
  }
  if (pref === "local") {
    return { status: "ready", store: new LocalStore(), handle: null };
  }
  return { status: "choose" };
}

export async function migrateStore(from, to) {
  if (!from || !to || from === to) return { copied: 0, kept: 0 };
  const { envelopes } = await from.list();
  const target = await to.list();
  const existing = new Map(target.envelopes.map((env) => [env.id, env]));
  let copied = 0;
  let kept = 0;
  for (const envelope of envelopes) {
    const current = existing.get(envelope.id);
    if (current && current.updatedAt >= envelope.updatedAt) {
      kept++;
      continue;
    }
    await to.write(envelope.id, envelope);
    copied++;
  }
  return { copied, kept };
}

export async function requestPersistentStorage() {
  try {
    if (navigator.storage && typeof navigator.storage.persist === "function") {
      return await navigator.storage.persist();
    }
  } catch {
    /* ignore */
  }
  return false;
}
