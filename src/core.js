import * as nip44 from "nostr-tools/nip44";

export const FILE_EXT = ".nip44";
export const FILE_FORMAT = "nip44-notes/1";
export const BACKUP_FORMAT = "nip44-notes-backup/1";
export const MAX_PAYLOAD_BYTES = 60000;

const ID_RE = /^[0-9a-f]{8,64}$/;

const encoder = new TextEncoder();

export function byteLength(text) {
  return encoder.encode(text).length;
}

export function newId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function normalizeFolder(value) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .replace(/\\/g, "/")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .split("/")
    .map((part) => part.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .join("/")
    .slice(0, 120)
    .replace(/^\/+|\/+$/g, "");
}

export function listFolders(notes) {
  const seen = new Map();
  for (const note of notes) {
    const folder = normalizeFolder(note?.folder);
    if (!folder) continue;
    const key = folder.toLowerCase();
    if (!seen.has(key)) seen.set(key, folder);
  }
  return [...seen.values()].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
  );
}

export function newNote(overrides = {}) {
  const now = Date.now();
  return {
    id: overrides.id ?? newId(),
    title: typeof overrides.title === "string" ? overrides.title : "",
    body: typeof overrides.body === "string" ? overrides.body : "",
    folder: normalizeFolder(overrides.folder),
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

export function conversationKey(secretKey, pubkey) {
  return nip44.getConversationKey(secretKey, pubkey);
}

export function validateEnvelope(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Note file is not a JSON object");
  }
  if (value.format !== FILE_FORMAT) {
    throw new Error("Unsupported note file format");
  }
  if (typeof value.id !== "string" || !ID_RE.test(value.id)) {
    throw new Error("Note file has an invalid id");
  }
  if (typeof value.ciphertext !== "string" || value.ciphertext.length === 0) {
    throw new Error("Note file has no ciphertext");
  }
  if (value.ciphertext.length > 140000) {
    throw new Error("Note file is too large");
  }
  for (const key of ["createdAt", "updatedAt"]) {
    if (!Number.isFinite(value[key]) || value[key] < 0) {
      throw new Error(`Note file has an invalid ${key}`);
    }
  }
  return {
    format: FILE_FORMAT,
    id: value.id,
    createdAt: Math.round(value.createdAt),
    updatedAt: Math.round(value.updatedAt),
    ciphertext: value.ciphertext,
  };
}

export function parseEnvelope(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Note file is not valid JSON");
  }
  return validateEnvelope(data);
}

export function serializeEnvelope(envelope) {
  return JSON.stringify(validateEnvelope(envelope), null, 2) + "\n";
}

export function noteFileName(id) {
  if (!ID_RE.test(id)) throw new Error("Invalid note id");
  return `${id}${FILE_EXT}`;
}

export async function encryptNote(note, encrypt) {
  const title = typeof note.title === "string" ? note.title : "";
  const body = typeof note.body === "string" ? note.body : "";
  const folder = normalizeFolder(note.folder);
  const payload = JSON.stringify({ title, body, folder });
  if (byteLength(payload) > MAX_PAYLOAD_BYTES) {
    throw new Error("This note is too large. NIP-44 messages are limited to 64 KB.");
  }
  const ciphertext = await encrypt(payload);
  if (typeof ciphertext !== "string" || ciphertext.length === 0) {
    throw new Error("Encryption returned no ciphertext");
  }
  return validateEnvelope({
    format: FILE_FORMAT,
    id: note.id,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    ciphertext,
  });
}

export async function decryptEnvelope(envelope, decrypt) {
  const env = validateEnvelope(envelope);
  const plaintext = await decrypt(env.ciphertext);
  let payload;
  try {
    payload = JSON.parse(plaintext);
  } catch {
    throw new Error("Encrypted note contains invalid data");
  }
  return {
    id: env.id,
    title: typeof payload.title === "string" ? payload.title : "",
    body: typeof payload.body === "string" ? payload.body : "",
    folder: normalizeFolder(payload.folder),
    createdAt: env.createdAt,
    updatedAt: env.updatedAt,
  };
}

export function noteToMarkdown(note) {
  const title = (note.title || "").trim();
  const body = note.body || "";
  if (!title) return body.endsWith("\n") ? body : body + "\n";
  return `# ${title}\n\n${body.replace(/^\n+/, "")}${body.endsWith("\n") ? "" : "\n"}`;
}

export function stripMarkdown(markdown) {
  const stripped = String(markdown || "")
    .replace(/```[\s\S]*?```/g, "\n\n")
    .replace(/~~~[\s\S]*?~~~/g, "\n\n")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[\[([^\[\]\n]+?)\]\]/g, (_, inner) => {
      const pipe = inner.indexOf("|");
      return (pipe === -1 ? inner : inner.slice(pipe + 1)).trim();
    })
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^\s*([-*_])(?:\s*\1){2,}\s*$/gm, "\n")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
  return stripped
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function deriveTitle(note) {
  const explicit = (note.title || "").trim();
  if (explicit) return explicit;
  const firstLine = (note.body || "")
    .split("\n")
    .map((line) => stripMarkdown(line).trim())
    .find((line) => line.length > 0);
  if (!firstLine) return "Untitled";
  return firstLine.length > 80 ? firstLine.slice(0, 79).trimEnd() + "…" : firstLine;
}

export function deriveExcerpt(body, max = 180) {
  const text = stripMarkdown(body).replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text;
}

export function countWords(text) {
  const clean = stripMarkdown(text);
  if (!clean) return 0;
  return clean.split(/\s+/).filter(Boolean).length;
}

export function slugify(title, fallback = "note") {
  const slug = String(title || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || fallback;
}

export function isMarkdownFileName(name) {
  return /\.(md|markdown|txt)$/i.test(String(name || ""));
}

export function noteFromMarkdownFile(name, text, now = Date.now()) {
  const base = String(name || "note").replace(/\.(md|markdown|txt)$/i, "").trim();
  let title = base && base !== "note" ? base : "";
  let body = String(text || "");
  const heading = body.match(/^#\s+(.+?)\s*(?:\r?\n|$)/);
  if (heading) {
    title = heading[1].trim() || title;
    body = body.slice(heading[0].length).replace(/^\r?\n+/, "");
  }
  return {
    id: newId(),
    title,
    body,
    folder: "",
    createdAt: now,
    updatedAt: now,
  };
}

export function createBackup(envelopes, pubkey) {
  return {
    format: BACKUP_FORMAT,
    version: 1,
    pubkey: pubkey || "",
    exportedAt: Date.now(),
    notes: envelopes.map(validateEnvelope),
  };
}

export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Backup is not valid JSON");
  }
  if (Array.isArray(data)) {
    return data.map(validateEnvelope);
  }
  if (data && data.format === FILE_FORMAT) {
    return [validateEnvelope(data)];
  }
  if (data && data.format === BACKUP_FORMAT) {
    if (!Array.isArray(data.notes)) throw new Error("Backup has no notes");
    return data.notes.map(validateEnvelope);
  }
  throw new Error("Not a NIP44 Notes backup");
}

export function mergeEnvelopes(existing, incoming, tombstones = {}) {
  const current = existing instanceof Map ? existing : new Map(Object.entries(existing || {}));
  const newestIncoming = new Map();
  for (const raw of incoming) {
    let env;
    try {
      env = validateEnvelope(raw);
    } catch {
      continue;
    }
    const seen = newestIncoming.get(env.id);
    if (!seen || env.updatedAt > seen.updatedAt) newestIncoming.set(env.id, env);
  }
  const write = [];
  let skipped = 0;
  let kept = 0;
  for (const env of newestIncoming.values()) {
    const deletedAt = Number(tombstones[env.id] || 0);
    if (deletedAt >= env.updatedAt) {
      skipped++;
      continue;
    }
    const local = current.get(env.id);
    if (!local || env.updatedAt > local.updatedAt) {
      write.push(env);
    } else {
      kept++;
    }
  }
  return { write, skipped, kept };
}

export function sortNotes(notes) {
  return [...notes].sort((a, b) => {
    if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
    return deriveTitle(a).localeCompare(deriveTitle(b));
  });
}

export function normalizeWikilinkTarget(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(/\.md$/i, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function buildNoteLinkIndex(notes) {
  const index = new Map();
  for (const note of sortNotes(notes)) {
    const names = new Set();
    const explicit = String(note.title || "").trim();
    if (explicit) names.add(explicit);
    const derived = deriveTitle(note);
    if (derived && derived !== "Untitled") names.add(derived);
    const folder = normalizeFolder(note.folder);
    for (const name of names) {
      const key = normalizeWikilinkTarget(name);
      if (key && !index.has(key)) index.set(key, note);
      if (folder) {
        const pathKey = normalizeWikilinkTarget(`${folder}/${name}`);
        if (pathKey && !index.has(pathKey)) index.set(pathKey, note);
      }
    }
  }
  return index;
}

export function resolveNoteLink(index, target) {
  if (!(index instanceof Map)) return null;
  const key = normalizeWikilinkTarget(target);
  return key ? index.get(key) || null : null;
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function relativeTime(timestamp, now = Date.now()) {
  const diff = Math.round((Number(timestamp) - now) / 1000);
  const abs = Math.abs(diff);
  if (abs < 45) return "just now";
  if (abs < 3600) return relative.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return relative.format(Math.round(diff / 3600), "hour");
  if (abs < 604800) return relative.format(Math.round(diff / 86400), "day");
  if (abs < 2592000) return relative.format(Math.round(diff / 604800), "week");
  if (abs < 31536000) return relative.format(Math.round(diff / 2592000), "month");
  return relative.format(Math.round(diff / 31536000), "year");
}

export function clockTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fullDate(timestamp) {
  return new Date(timestamp).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
