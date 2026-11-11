import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { nip19, nip44, nip49 } from "nostr-tools";

export const NOTE_SUFFIX = ".md";
export const TOMBSTONE_SUFFIX = ".tombstone";
export const PAYLOAD_VERSION = 1;

const HEX = /^[0-9a-f]+$/i;

export function bytesToHex(bytes) {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export function hexToBytes(hex) {
  if (typeof hex !== "string" || hex.length % 2 || !HEX.test(hex)) {
    throw new Error("Invalid hex");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function randomId(bytes = 12) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return bytesToHex(buf);
}

export function nowMs() {
  return Date.now();
}

/* ------------------------------------------------------------------ keys -- */

export function makeIdentity(passphrase) {
  const secretKey = generateSecretKey();
  return identityFromSecret(secretKey, passphrase);
}

export function identityFromSecret(secretKey, passphrase) {
  if (!(secretKey instanceof Uint8Array) || secretKey.length !== 32) {
    throw new Error("Expected a 32-byte secret key");
  }
  if (typeof passphrase !== "string" || passphrase.length < 8) {
    throw new Error("Use a passphrase of at least 8 characters");
  }
  const pubkey = getPublicKey(secretKey);
  return {
    secretKey,
    pubkey,
    npub: nip19.npubEncode(pubkey),
    ncryptsec: nip49.encrypt(secretKey, passphrase, 16),
  };
}

export function importNsec(input, passphrase) {
  const value = String(input || "").trim();
  if (!value) throw new Error("Paste an nsec key");
  let secretKey;
  if (/^nsec1/i.test(value)) {
    const decoded = nip19.decode(value);
    if (decoded.type !== "nsec") throw new Error("That is not an nsec key");
    secretKey = decoded.data;
  } else if (HEX.test(value) && value.length === 64) {
    secretKey = hexToBytes(value);
  } else {
    throw new Error("Expected an nsec1… key or 64-character hex secret");
  }
  return identityFromSecret(secretKey, passphrase);
}

export function unlockNcryptsec(ncryptsec, passphrase) {
  if (typeof passphrase !== "string" || !passphrase) {
    throw new Error("Enter your passphrase");
  }
  let secretKey;
  try {
    secretKey = nip49.decrypt(String(ncryptsec), passphrase);
  } catch {
    throw new Error("Wrong passphrase");
  }
  if (!secretKey || secretKey.length !== 32) throw new Error("Invalid key file");
  return secretKey;
}

export function encodeNsec(secretKey) {
  return nip19.nsecEncode(secretKey);
}

export function npubFor(secretKey) {
  return nip19.npubEncode(getPublicKey(secretKey));
}

export function conversationKey(secretKey, pubkey) {
  return nip44.getConversationKey(secretKey, pubkey);
}

export function shortNpub(npub) {
  const value = String(npub || "");
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}

/* -------------------------------------------------------------- payloads -- */

export function payloadFor(note) {
  return {
    v: PAYLOAD_VERSION,
    id: note.id,
    title: note.title || "",
    body: note.body || "",
    folder: String(note.folder || ""),
    createdAt: Number(note.createdAt) || nowMs(),
    updatedAt: Number(note.updatedAt) || nowMs(),
  };
}

export function tombstonePayload(id, updatedAt = nowMs()) {
  return {
    v: PAYLOAD_VERSION,
    id,
    deleted: true,
    createdAt: Number(updatedAt) || nowMs(),
    updatedAt: Number(updatedAt) || nowMs(),
  };
}

export function sealPayload(payload, key) {
  return nip44.encrypt(JSON.stringify(payload), key);
}

export function openPayload(ciphertext, key) {
  const text = nip44.decrypt(String(ciphertext).trim(), key);
  const payload = JSON.parse(text);
  if (!payload || typeof payload !== "object") throw new Error("Bad note payload");
  if (!payload.id || typeof payload.id !== "string" || !/^[0-9a-f]{16,64}$/i.test(payload.id)) {
    throw new Error("Bad note id");
  }
  return payload;
}

export function makeNote(fields = {}) {
  const ts = Number(fields.createdAt) || nowMs();
  return {
    id: fields.id || randomId(),
    title: String(fields.title || ""),
    body: String(fields.body || ""),
    folder: String(fields.folder || ""),
    createdAt: ts,
    updatedAt: Number(fields.updatedAt) || ts,
  };
}

export function noteFileName(id) {
  return `${id}${NOTE_SUFFIX}`;
}

export function tombstoneFileName(id) {
  return `${id}${TOMBSTONE_SUFFIX}`;
}

export function fileId(name) {
  const match = /^([0-9a-f]{16,64})\.(md|tombstone)$/i.exec(String(name || ""));
  return match ? match[1] : null;
}

export function isTombstoneFile(name) {
  return String(name || "").endsWith(TOMBSTONE_SUFFIX);
}

export function deriveTitle(body, limit = 90) {
  const lines = String(body || "").split("\n");
  for (const line of lines) {
    const cleaned = line
      .replace(/^#{1,6}\s+/, "")
      .replace(/^[>*+\-\s]+/, "")
      .replace(/[*_`~]/g, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .trim();
    if (cleaned) {
      return cleaned.length > limit ? `${cleaned.slice(0, limit - 1).trimEnd()}…` : cleaned;
    }
  }
  return "";
}

export function displayTitle(note) {
  const title = String(note?.title || "").trim();
  if (title) return title;
  const derived = deriveTitle(note?.body);
  return derived || "Untitled note";
}

export function plainSnippet(note, limit = 140) {
  const body = String(note?.body || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_>#~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!body) return "No text yet";
  return body.length > limit ? `${body.slice(0, limit - 1).trimEnd()}…` : body;
}

export function extractPlainTitle(body) {
  const lines = String(body || "").split("\n");
  for (const line of lines) {
    const cleaned = line
      .replace(/^#{1,6}\s+/, "")
      .replace(/^[>*+\-\s]+/, "")
      .replace(/[*_`~]/g, "")
      .trim();
    if (cleaned) return cleaned.slice(0, 80);
  }
  return "Untitled note";
}

/* -------------------------------------------------------------- markdown -- */

export function noteToMarkdown(note) {
  const title = String(note?.title || "").trim();
  const body = String(note?.body || "").replace(/\s+$/, "");
  const head = title ? `# ${title}\n\n` : "";
  return `${head}${body}${body ? "\n" : ""}`;
}

export function markdownToNote(text, { id, createdAt, updatedAt } = {}) {
  const normalized = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/^\uFEFF/, "");
  const lines = normalized.split("\n");
  let first = lines.findIndex((line) => line.trim() !== "");
  let title = "";
  if (first !== -1 && /^#\s+\S/.test(lines[first])) {
    title = lines[first].replace(/^#\s+/, "").trim();
    lines.splice(first, 1);
    first = -1;
  }
  let body = lines.join("\n");
  body = body.replace(/^\n+/, "").replace(/\s+$/, "");
  const ts = Number(createdAt) || nowMs();
  return makeNote({
    id,
    title,
    body,
    createdAt: ts,
    updatedAt: Number(updatedAt) || ts,
  });
}

export function markdownFilename(note) {
  const base = displayTitle(note)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const id = String(note?.id || "").slice(0, 8);
  return `${base || "note"}${id ? `-${id}` : ""}.md`;
}
