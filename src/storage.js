import {
  fileId,
  isTombstoneFile,
  noteFileName,
  openPayload,
  payloadFor,
  sealPayload,
  tombstoneFileName,
  tombstonePayload,
} from "./crypto.js";

const DB_NAME = "nip44-notes";
const DB_VERSION = 1;
const FILE_STORE = "files";
const NOTES_DIR = "notes";
const MAX_FILE_BYTES = 8 * 1024 * 1024;

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB error"));
  });
}

function idbDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
  });
}

class OpfsStore {
  constructor(root, dir) {
    this.root = root;
    this.dir = dir;
    this.backend = "opfs";
    this.label = "App file system (OPFS)";
  }

  static async open() {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(NOTES_DIR, { create: true });
    return new OpfsStore(root, dir);
  }

  async list() {
    const files = [];
    for await (const [name, handle] of this.dir.entries()) {
      if (handle.kind !== "file") continue;
      try {
        const file = await handle.getFile();
        files.push({ name, updatedAt: file.lastModified, size: file.size });
      } catch {
        files.push({ name, updatedAt: 0, size: 0 });
      }
    }
    return files;
  }

  async read(name) {
    const handle = await this.dir.getFileHandle(name);
    return (await handle.getFile()).text();
  }

  async write(name, text) {
    const handle = await this.dir.getFileHandle(name, { create: true });
    if (typeof handle.createWritable !== "function") {
      throw new Error("This browser cannot write app files");
    }
    const writable = await handle.createWritable();
    try {
      await writable.write(text);
    } finally {
      await writable.close();
    }
  }

  async remove(name) {
    await this.dir.removeEntry(name);
  }

  async clear() {
    const names = [];
    for await (const [name, handle] of this.dir.entries()) {
      if (handle.kind === "file") names.push(name);
    }
    await Promise.all(names.map((name) => this.dir.removeEntry(name)));
  }

  async usage() {
    try {
      const estimate = await navigator.storage.estimate();
      return { usage: estimate.usage || 0, quota: estimate.quota || 0 };
    } catch {
      return { usage: 0, quota: 0 };
    }
  }
}

class IdbStore {
  constructor(db) {
    this.db = db;
    this.backend = "indexeddb";
    this.label = "Browser database (IndexedDB)";
  }

  static async open() {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FILE_STORE)) {
        db.createObjectStore(FILE_STORE, { keyPath: "name" });
      }
    };
    const db = await idbRequest(request);
    return new IdbStore(db);
  }

  async list() {
    const tx = this.db.transaction(FILE_STORE, "readonly");
    const rows = await idbRequest(tx.objectStore(FILE_STORE).getAll());
    return rows.map((row) => ({
      name: row.name,
      updatedAt: row.updatedAt || 0,
      size: row.content ? row.content.length : 0,
    }));
  }

  async read(name) {
    const tx = this.db.transaction(FILE_STORE, "readonly");
    const row = await idbRequest(tx.objectStore(FILE_STORE).get(name));
    if (!row) throw new Error(`Missing file: ${name}`);
    return row.content;
  }

  async write(name, text) {
    const tx = this.db.transaction(FILE_STORE, "readwrite");
    tx.objectStore(FILE_STORE).put({ name, content: text, updatedAt: Date.now() });
    await idbDone(tx);
  }

  async remove(name) {
    const tx = this.db.transaction(FILE_STORE, "readwrite");
    tx.objectStore(FILE_STORE).delete(name);
    await idbDone(tx);
  }

  async clear() {
    const tx = this.db.transaction(FILE_STORE, "readwrite");
    tx.objectStore(FILE_STORE).clear();
    await idbDone(tx);
  }

  async usage() {
    try {
      const estimate = await navigator.storage.estimate();
      return { usage: estimate.usage || 0, quota: estimate.quota || 0 };
    } catch {
      return { usage: 0, quota: 0 };
    }
  }
}

export async function openFileStore() {
  if (typeof indexedDB === "undefined" && !navigator.storage?.getDirectory) {
    throw new Error("This browser cannot store files");
  }
  if (navigator.storage?.getDirectory) {
    try {
      const store = await OpfsStore.open();
      await store.list();
      return store;
    } catch (error) {
      console.warn("OPFS unavailable, falling back to IndexedDB", error);
    }
  }
  return IdbStore.open();
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Notes live as one file per note. A note file is a NIP-44 v2 payload whose
 * plaintext is JSON: {v, id, title, body, createdAt, updatedAt}. Deletions are
 * kept as encrypted tombstones so they can beat stale copies during sync.
 */
export class NotesRepository {
  constructor(store, key, pubkey) {
    this.store = store;
    this.key = key;
    this.pubkey = pubkey;
  }

  async load() {
    const files = await this.store.list();
    const notes = [];
    const tombstones = new Map();
    const errors = [];

    for (const file of files) {
      if (!fileId(file.name)) continue;
      let ciphertext;
      let payload;
      try {
        ciphertext = await this.store.read(file.name);
        payload = openPayload(ciphertext, this.key);
      } catch (error) {
        errors.push({ name: file.name, message: error?.message || "Could not read file" });
        continue;
      }
      if (payload.deleted) {
        tombstones.set(payload.id, {
          payload,
          ciphertext,
          fileName: file.name,
        });
        continue;
      }
      notes.push({
        note: {
          id: payload.id,
          title: String(payload.title || ""),
          body: String(payload.body || ""),
          folder: String(payload.folder || ""),
          createdAt: Number(payload.createdAt || file.updatedAt || Date.now()),
          updatedAt: Number(payload.updatedAt || file.updatedAt || Date.now()),
        },
        ciphertext,
        fileName: file.name,
      });
    }

    const visible = notes.filter((entry) => {
      const tomb = tombstones.get(entry.note.id);
      return !tomb || tomb.payload.updatedAt < entry.note.updatedAt;
    });
    visible.sort((a, b) => b.note.updatedAt - a.note.updatedAt);

    return { notes: visible, tombstones, errors, files };
  }

  async sealNote(note) {
    const payload = payloadFor(note);
    const ciphertext = sealPayload(payload, this.key);
    return { payload, ciphertext, fileName: noteFileName(payload.id) };
  }

  async saveNote(note) {
    const sealed = await this.sealNote(note);
    await this.store.write(sealed.fileName, sealed.ciphertext);
    try {
      await this.store.remove(tombstoneFileName(sealed.payload.id));
    } catch {
      /* no tombstone */
    }
    return {
      note: {
        id: sealed.payload.id,
        title: sealed.payload.title,
        body: sealed.payload.body,
        folder: sealed.payload.folder,
        createdAt: sealed.payload.createdAt,
        updatedAt: sealed.payload.updatedAt,
      },
      ...sealed,
    };
  }

  async sealTombstone(id, updatedAt) {
    const payload = tombstonePayload(id, updatedAt);
    const ciphertext = sealPayload(payload, this.key);
    return { payload, ciphertext, fileName: tombstoneFileName(id) };
  }

  async deleteNote(id, updatedAt = Date.now()) {
    const sealed = await this.sealTombstone(id, updatedAt);
    await this.store.write(sealed.fileName, sealed.ciphertext);
    try {
      await this.store.remove(noteFileName(id));
    } catch {
      /* file already gone */
    }
    return sealed;
  }

  async writeCiphertext(fileName, ciphertext) {
    if (!fileId(fileName)) throw new Error(`Refusing to write ${fileName}`);
    if (typeof ciphertext !== "string" || !ciphertext || ciphertext.length > MAX_FILE_BYTES) {
      throw new Error(`Refusing to write ${fileName}: bad content`);
    }
    await this.store.write(fileName, ciphertext);
  }

  async removeFile(fileName) {
    if (!fileId(fileName)) throw new Error(`Refusing to remove ${fileName}`);
    await this.store.remove(fileName);
  }

  async backup() {
    const files = await this.store.list();
    const out = [];
    for (const file of files) {
      if (!fileId(file.name)) continue;
      out.push({ name: file.name, data: await this.store.read(file.name) });
    }
    return {
      app: "nip44-notes",
      v: 1,
      pubkey: this.pubkey,
      exportedAt: new Date().toISOString(),
      format: "nip44-v2",
      files: out,
    };
  }

  async restoreBackup(json) {
    let backup = json;
    if (typeof json === "string") {
      try {
        backup = JSON.parse(json);
      } catch {
        throw new Error("That is not a valid backup file");
      }
    }
    if (!backup || backup.app !== "nip44-notes" || !Array.isArray(backup.files)) {
      throw new Error("That is not a NIP44 Notes backup");
    }
    let written = 0;
    for (const file of backup.files) {
      if (!file || !fileId(file.name)) continue;
      const data = String(file.data || "");
      if (!data || data.length > MAX_FILE_BYTES) continue;
      await this.store.write(file.name, data);
      written += 1;
    }
    if (!written) throw new Error("The backup contained no note files");
    return { written };
  }

  async wipe() {
    await this.store.clear();
  }

  async purgeTombstones(maxAgeMs = 1000 * 60 * 60 * 24 * 120) {
    const files = await this.store.list();
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;
    for (const file of files) {
      if (!isTombstoneFile(file.name)) continue;
      try {
        const payload = openPayload(await this.store.read(file.name), this.key);
        if (Number(payload.updatedAt) < cutoff) {
          await this.store.remove(file.name);
          removed += 1;
        }
      } catch {
        /* leave unreadable files alone */
      }
    }
    return removed;
  }
}
