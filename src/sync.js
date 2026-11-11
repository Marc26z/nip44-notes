import { SimplePool } from "nostr-tools/pool";
import { verifyEvent } from "nostr-tools/pure";
import { FILE_FORMAT, validateEnvelope } from "./core.js";

export const NOTE_KIND = 30078; // NIP-78 application-specific data (addressable)
export const DELETE_KIND = 5; // NIP-09 deletion request
export const NOTE_D_PREFIX = "nip44-notes:";
export const NOTE_T_TAG = "nip44-notes";
export const NOTE_ALT = "Encrypted Markdown note (NIP-44)";
export const RELAYS_KEY = "nip44notes.relays.v1";

export const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://relay.ditto.pub",
];

const ID_RE = /^[0-9a-f]{8,64}$/i;

export function normalizeRelays(input) {
  const raw = Array.isArray(input)
    ? input
    : String(input || "")
        .split(/[\s,]+/)
        .filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const value = String(item || "").trim();
    if (!value || value.startsWith("#")) continue;
    let url;
    try {
      url = new URL(value);
    } catch {
      continue;
    }
    if (url.protocol !== "wss:" && url.protocol !== "ws:") continue;
    if (!url.hostname) continue;
    const normalized = url.toString().replace(/\/$/, "");
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export function loadRelays() {
  try {
    const raw = localStorage.getItem(RELAYS_KEY);
    if (raw === null) return [...DEFAULT_RELAYS];
    const parsed = JSON.parse(raw);
    return normalizeRelays(Array.isArray(parsed) ? parsed : []);
  } catch {
    return [...DEFAULT_RELAYS];
  }
}

export function saveRelays(input) {
  const relays = normalizeRelays(input);
  try {
    localStorage.setItem(RELAYS_KEY, JSON.stringify(relays));
  } catch {
    /* storage may be unavailable */
  }
  return relays;
}

export function noteDTag(id) {
  return `${NOTE_D_PREFIX}${id}`;
}

export function idFromDTag(d) {
  const value = String(d || "");
  if (!value.startsWith(NOTE_D_PREFIX)) return null;
  const id = value.slice(NOTE_D_PREFIX.length);
  return ID_RE.test(id) ? id : null;
}

function toSeconds(timestamp) {
  return Math.max(0, Math.floor((Number(timestamp) || 0) / 1000));
}

export function buildNoteTemplate(envelope, pubkey) {
  const env = validateEnvelope(envelope);
  return {
    kind: NOTE_KIND,
    pubkey,
    created_at: toSeconds(env.updatedAt),
    tags: [
      ["d", noteDTag(env.id)],
      ["t", NOTE_T_TAG],
      ["alt", NOTE_ALT],
      ["client", "nip44-notes"],
    ],
    content: env.ciphertext,
  };
}

export function buildDeleteTemplate(id, pubkey, deletedAt = Date.now()) {
  if (!ID_RE.test(String(id || ""))) throw new Error("Invalid note id");
  return {
    kind: DELETE_KIND,
    pubkey,
    created_at: toSeconds(deletedAt),
    tags: [
      ["a", `${NOTE_KIND}:${pubkey}:${noteDTag(id)}`],
      ["t", NOTE_T_TAG],
      ["alt", "Delete an encrypted NIP44 Notes note"],
      ["client", "nip44-notes"],
    ],
    content: "",
  };
}

export function noteEventFilter(pubkey) {
  return {
    kinds: [NOTE_KIND, DELETE_KIND],
    authors: [pubkey],
    "#t": [NOTE_T_TAG],
    limit: 1000,
  };
}

export function eventToRemote(event) {
  if (!event || typeof event !== "object") return null;
  if (event.kind === DELETE_KIND) {
    for (const tag of event.tags || []) {
      if (!Array.isArray(tag) || tag[0] !== "a") continue;
      const parts = String(tag[1] || "").split(":");
      if (parts.length < 3) continue;
      if (parts[0] !== String(NOTE_KIND)) continue;
      const id = idFromDTag(parts.slice(2).join(":"));
      if (!id) continue;
      return {
        type: "delete",
        id,
        deletedAt: Math.max(0, Number(event.created_at) || 0) * 1000,
        event,
      };
    }
    return null;
  }
  if (event.kind !== NOTE_KIND) return null;
  const d = (event.tags || []).find((tag) => Array.isArray(tag) && tag[0] === "d")?.[1];
  const id = idFromDTag(d);
  if (!id) return null;
  if (typeof event.content !== "string" || !event.content) return null;
  const updatedAt = Math.max(0, Number(event.created_at) || 0) * 1000;
  return { type: "note", id, updatedAt, ciphertext: event.content, event };
}

function tombstoneSeconds(tombstones, id) {
  if (!tombstones) return 0;
  if (tombstones instanceof Map) return toSeconds(tombstones.get(id));
  return toSeconds(tombstones[id]);
}

/**
 * Compare relay events with local envelopes. Pure so it can be tested without
 * relays or a browser.
 *
 * local: { envelopes: Map|object of id -> envelope, tombstones: Map|object of id -> timestamp }
 * remote: array of records from eventToRemote()
 * returns { remoteNotes, remoteDeletes, writes, deletes }
 */
export function planMerge(local, remote) {
  const envelopes =
    local?.envelopes instanceof Map
      ? local.envelopes
      : new Map(Object.entries(local?.envelopes || {}));
  const tombstones = local?.tombstones || {};
  const remoteNotes = new Map();
  const remoteDeletes = new Map();

  for (const record of remote || []) {
    if (!record) continue;
    if (record.type === "note") {
      const previous = remoteNotes.get(record.id);
      if (!previous || toSeconds(record.updatedAt) >= toSeconds(previous.updatedAt)) {
        remoteNotes.set(record.id, record);
      }
    } else if (record.type === "delete") {
      const previous = remoteDeletes.get(record.id);
      if (!previous || record.deletedAt >= previous.deletedAt) {
        remoteDeletes.set(record.id, record);
      }
    }
  }

  const writes = [];
  const deletes = [];

  for (const [id, note] of remoteNotes) {
    const deletion = remoteDeletes.get(id);
    if (deletion && toSeconds(deletion.deletedAt) >= toSeconds(note.updatedAt)) continue;
    const current = envelopes.get(id);
    if (current && toSeconds(current.updatedAt) >= toSeconds(note.updatedAt)) continue;
    writes.push({
      id,
      envelope: {
        format: FILE_FORMAT,
        id,
        createdAt: Number(current?.createdAt) || note.updatedAt,
        updatedAt: note.updatedAt,
        ciphertext: note.ciphertext,
      },
    });
  }

  for (const [id, deletion] of remoteDeletes) {
    const current = envelopes.get(id);
    const note = remoteNotes.get(id);
    if (note && toSeconds(note.updatedAt) > toSeconds(deletion.deletedAt)) continue;
    if (current && toSeconds(current.updatedAt) > toSeconds(deletion.deletedAt)) continue;
    if (tombstoneSeconds(tombstones, id) >= toSeconds(deletion.deletedAt)) continue;
    deletes.push({ id, deletedAt: deletion.deletedAt });
  }

  return { remoteNotes, remoteDeletes, writes, deletes };
}

/**
 * Which local entries should be published because the relays have nothing
 * newer? Tombstones count as entries so deletions propagate.
 */
export function planPush(local, remoteNotes, remoteDeletes) {
  const envelopes =
    local?.envelopes instanceof Map
      ? local.envelopes
      : new Map(Object.entries(local?.envelopes || {}));
  const tombstones = local?.tombstones || {};
  const out = [];

  for (const envelope of envelopes.values()) {
    if (!envelope || !ID_RE.test(String(envelope.id || ""))) continue;
    const localSeconds = toSeconds(envelope.updatedAt);
    const deletion = remoteDeletes?.get(envelope.id);
    if (deletion && toSeconds(deletion.deletedAt) >= localSeconds) continue;
    const note = remoteNotes?.get(envelope.id);
    if (note && toSeconds(note.updatedAt) >= localSeconds) continue;
    out.push({ type: "note", id: envelope.id, envelope });
  }

  const entries =
    tombstones instanceof Map ? tombstones.entries() : Object.entries(tombstones);
  for (const [id, timestamp] of entries) {
    if (!ID_RE.test(String(id || ""))) continue;
    const localSeconds = toSeconds(timestamp);
    if (!localSeconds) continue;
    const deletion = remoteDeletes?.get(id);
    if (deletion && toSeconds(deletion.deletedAt) >= localSeconds) continue;
    const note = remoteNotes?.get(id);
    if (note && toSeconds(note.updatedAt) > localSeconds) continue;
    out.push({ type: "delete", id, deletedAt: Number(timestamp) || 0 });
  }

  out.sort((a, b) => {
    const at = a.type === "note" ? Number(a.envelope.updatedAt) || 0 : a.deletedAt;
    const bt = b.type === "note" ? Number(b.envelope.updatedAt) || 0 : b.deletedAt;
    return at - bt;
  });
  return out;
}

export class RelaySync {
  constructor({ relays, signer, pubkey, onStatus } = {}) {
    this.relays = normalizeRelays(relays);
    this.signer = signer;
    this.pubkey = pubkey || signer?.pubkey;
    this.onStatus = onStatus || (() => {});
    this.pool = null;
    this.closed = false;
  }

  ensurePool() {
    if (!this.pool) this.pool = new SimplePool();
    return this.pool;
  }

  status(state, detail = "") {
    try {
      this.onStatus({ state, detail });
    } catch {
      /* ignore */
    }
  }

  async pull({ maxWait = 6000 } = {}) {
    if (!this.relays.length) throw new Error("No relays configured");
    if (this.closed) throw new Error("Sync is closed");
    if (typeof WebSocket === "undefined") throw new Error("WebSockets are not available");
    this.status("syncing", "Looking for notes…");
    const pool = this.ensurePool();
    const events = await pool.querySync(
      this.relays,
      noteEventFilter(this.pubkey),
      { maxWait },
    );
    const verified = events.filter(
      (event) => event?.pubkey === this.pubkey && verifyEvent(event),
    );
    this.status(
      "ok",
      `${verified.length} relay event${verified.length === 1 ? "" : "s"}`,
    );
    return verified.map(eventToRemote).filter(Boolean);
  }

  async publish(event) {
    if (!this.relays.length) return { accepted: 0, total: 0 };
    if (this.closed) return { accepted: 0, total: 0 };
    if (typeof WebSocket === "undefined") throw new Error("WebSockets are not available");
    const pool = this.ensurePool();
    const results = await Promise.allSettled(pool.publish(this.relays, event));
    const accepted = results.filter((result) => result.status === "fulfilled").length;
    return { accepted, total: results.length };
  }

  async publishTemplate(template) {
    if (!this.signer || typeof this.signer.signEvent !== "function") {
      throw new Error("This key cannot sign relay events");
    }
    const event = await this.signer.signEvent(template);
    return { event, ...(await this.publish(event)) };
  }

  async publishEnvelope(envelope) {
    return this.publishTemplate(buildNoteTemplate(envelope, this.pubkey));
  }

  async publishDelete(id, deletedAt = Date.now()) {
    return this.publishTemplate(buildDeleteTemplate(id, this.pubkey, deletedAt));
  }

  close() {
    this.closed = true;
    if (this.pool) {
      this.pool.destroy();
      this.pool = null;
    }
  }
}
