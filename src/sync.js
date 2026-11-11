import { SimplePool } from "nostr-tools/pool";
import { finalizeEvent } from "nostr-tools/pure";
import { fileId, noteFileName, openPayload, tombstoneFileName } from "./crypto.js";

export const NOTE_KIND = 30078; // NIP-78 application-specific data (addressable)
export const NOTE_D_PREFIX = "nip44-notes:";
export const NOTE_T_TAG = "nip44-notes";
export const NOTE_ALT = "Encrypted Markdown note (NIP-44)";

export const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://relay.ditto.pub",
];

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

export function noteDTag(id) {
  return `${NOTE_D_PREFIX}${id}`;
}

export function idFromDTag(d) {
  const value = String(d || "");
  if (!value.startsWith(NOTE_D_PREFIX)) return null;
  const id = value.slice(NOTE_D_PREFIX.length);
  return fileId(`${id}.md`) ? id : null;
}

export function buildCiphertextEvent({ id, ciphertext, secretKey, createdAt = Date.now() }) {
  if (!fileId(`${id}.md`)) throw new Error("Invalid note id");
  if (!ciphertext) throw new Error("Missing ciphertext");
  return finalizeEvent(
    {
      kind: NOTE_KIND,
      created_at: Math.max(0, Math.floor(createdAt / 1000)),
      tags: [
        ["d", noteDTag(id)],
        ["t", NOTE_T_TAG],
        ["alt", NOTE_ALT],
        ["client", "nip44-notes"],
      ],
      content: ciphertext,
    },
    secretKey,
  );
}

export function buildDeleteEvent(id, secretKey, { publicKey, createdAt = Date.now() } = {}) {
  if (!fileId(`${id}.md`)) throw new Error("Invalid note id");
  return finalizeEvent(
    {
      kind: 5,
      created_at: Math.max(0, Math.floor(createdAt / 1000)),
      tags: [
        ["a", `${NOTE_KIND}:${publicKey}:${noteDTag(id)}`],
        ["t", NOTE_T_TAG],
        ["alt", "Delete an encrypted NIP44 Notes note"],
        ["client", "nip44-notes"],
      ],
      content: "",
    },
    secretKey,
  );
}

export function noteEventFilter(pubkey) {
  return {
    kinds: [NOTE_KIND],
    authors: [pubkey],
    "#t": [NOTE_T_TAG],
    limit: 1000,
  };
}

/**
 * Compare remote events with the note files on disk. Pure so it can be tested
 * without relays or a browser.
 *
 * local: { notes: [{ note, ciphertext, fileName }], tombstones: Map }
 * returns { remote: Map, actions, errors }
 * action = { type: "write-note"|"write-tombstone"|"remove-note"|"remove-tombstone", ... }
 */
export function planMerge(local, events, key) {
  const remote = new Map();
  const actions = [];
  const errors = [];

  const localEntry = (id) => {
    const note = local.notes.find((entry) => entry.note.id === id);
    if (note) return { kind: "note", updatedAt: note.note.updatedAt, entry: note };
    const tomb = local.tombstones?.get(id);
    if (tomb) return { kind: "tombstone", updatedAt: Number(tomb.payload.updatedAt) || 0, entry: tomb };
    return null;
  };

  for (const event of events) {
    if (![NOTE_KIND, 5].includes(event?.kind)) continue;
    if (event.kind === 5) continue;
    const d = (event.tags || []).find((tag) => tag[0] === "d")?.[1];
    const id = idFromDTag(d);
    if (!id) continue;
    let payload;
    try {
      payload = openPayload(event.content, key);
    } catch (error) {
      errors.push({ id, message: error?.message || "Could not decrypt relay event" });
      continue;
    }
    if (payload.id !== id) {
      errors.push({ id, message: "Note id does not match its event tag" });
      continue;
    }
    const updatedAt = Number(payload.updatedAt) || Number(event.created_at) * 1000 || 0;
    const next = { id, payload, event, updatedAt, ciphertext: event.content };

    const previous = remote.get(id);
    if (!previous || updatedAt >= previous.updatedAt) remote.set(id, next);

    const current = localEntry(id);
    if (current && current.updatedAt >= updatedAt) continue;

    if (payload.deleted) {
      actions.push({
        type: "write-tombstone",
        id,
        fileName: tombstoneFileName(id),
        ciphertext: event.content,
        updatedAt,
      });
      actions.push({ type: "remove-note", id });
    } else {
      actions.push({
        type: "write-note",
        id,
        fileName: noteFileName(id),
        ciphertext: event.content,
        updatedAt,
      });
      actions.push({ type: "remove-tombstone", id });
    }
  }

  return { remote, actions, errors };
}

/**
 * Which local entries should be published because the relays have nothing
 * newer? Tombstones count as entries so deletions propagate.
 */
export function planPush(local, remote) {
  const out = [];
  for (const entry of local.notes) {
    const id = entry.note.id;
    const known = remote.get(id);
    if (!known || entry.note.updatedAt > known.updatedAt) {
      out.push({
        id,
        ciphertext: entry.ciphertext,
        updatedAt: entry.note.updatedAt,
        deleted: false,
      });
    }
  }
  for (const [id, entry] of local.tombstones || []) {
    const known = remote.get(id);
    const updatedAt = Number(entry.payload.updatedAt) || 0;
    if (!known || updatedAt > known.updatedAt) {
      out.push({ id, ciphertext: entry.ciphertext, updatedAt, deleted: true });
    }
  }
  out.sort((a, b) => a.updatedAt - b.updatedAt);
  return out;
}

export async function applyMergeActions(repository, actions) {
  let touched = 0;
  for (const action of actions) {
    try {
      if (action.type === "write-note" || action.type === "write-tombstone") {
        await repository.writeCiphertext(action.fileName, action.ciphertext);
        touched += 1;
      } else if (action.type === "remove-note") {
        await repository.removeFile(noteFileName(action.id)).catch(() => {});
      } else if (action.type === "remove-tombstone") {
        await repository.removeFile(tombstoneFileName(action.id)).catch(() => {});
      }
    } catch (error) {
      console.warn("sync action failed", action.type, action.id, error);
    }
  }
  return touched;
}

export class RelaySync {
  constructor({ relays, secretKey, pubkey, onStatus } = {}) {
    this.relays = normalizeRelays(relays);
    this.secretKey = secretKey;
    this.pubkey = pubkey;
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
    this.status("syncing", "Looking for notes…");
    const pool = this.ensurePool();
    const events = await pool.querySync(
      this.relays,
      noteEventFilter(this.pubkey),
      { maxWait },
    );
    this.status("ok", `${events.length} relay event${events.length === 1 ? "" : "s"}`);
    return events;
  }

  async publish(event) {
    if (!this.relays.length) return { accepted: 0, total: 0 };
    if (this.closed) return { accepted: 0, total: 0 };
    const pool = this.ensurePool();
    const results = await Promise.allSettled(pool.publish(this.relays, event));
    const accepted = results.filter((result) => result.status === "fulfilled").length;
    return { accepted, total: results.length };
  }

  async publishNote({ id, ciphertext, createdAt = Date.now() }) {
    const event = buildCiphertextEvent({
      id,
      ciphertext,
      secretKey: this.secretKey,
      createdAt,
    });
    return { event, ...(await this.publish(event)) };
  }

  close() {
    this.closed = true;
    if (this.pool) {
      this.pool.destroy();
      this.pool = null;
    }
  }
}
