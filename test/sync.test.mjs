import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { generateSecretKey, getPublicKey, verifyEvent } from "nostr-tools/pure";
import { FILE_FORMAT } from "../src/core.js";
import { bytesToHex, makeSigner } from "../src/identity.js";
import {
  DELETE_KIND,
  NOTE_KIND,
  buildDeleteTemplate,
  buildNoteTemplate,
  eventToRemote,
  idFromDTag,
  noteDTag,
  noteEventFilter,
  normalizeRelays,
  planMerge,
  planPush,
} from "../src/sync.js";

const A = "aaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbb";
const C = "cccccccccccccccc";
const D = "dddddddddddddddd";
const E = "eeeeeeeeeeeeeeee";
const PUBKEY = "f".repeat(64);

function envelope(id, updatedAt, ciphertext = `cipher-${id}`) {
  return {
    format: FILE_FORMAT,
    id,
    createdAt: Math.max(0, updatedAt - 1000),
    updatedAt,
    ciphertext,
  };
}

function remoteNote(id, updatedAt, ciphertext = `remote-${id}`) {
  return { type: "note", id, updatedAt, ciphertext };
}

function remoteDelete(id, deletedAt) {
  return { type: "delete", id, deletedAt };
}

test("relay URLs are normalized and deduplicated", () => {
  assert.deepEqual(
    normalizeRelays("wss://relay.one/ wss://relay.one\nhttps://nope wss://relay.two"),
    ["wss://relay.one", "wss://relay.two"],
  );
  assert.deepEqual(normalizeRelays([]), []);
  assert.deepEqual(normalizeRelays(["ws://localhost:7777/"]), ["ws://localhost:7777"]);
});

test("note d tags round-trip valid ids only", () => {
  assert.equal(noteDTag(A), `nip44-notes:${A}`);
  assert.equal(idFromDTag(noteDTag(A)), A);
  assert.equal(idFromDTag("other:aaaaaaaaaaaaaaaa"), null);
  assert.equal(idFromDTag("nip44-notes:not-hex"), null);
});

test("note and delete templates carry the expected tags", () => {
  const note = buildNoteTemplate(envelope(A, 1234567), PUBKEY);
  assert.equal(note.kind, NOTE_KIND);
  assert.equal(note.pubkey, PUBKEY);
  assert.equal(note.created_at, 1234);
  assert.equal(note.content, `cipher-${A}`);
  assert.deepEqual(note.tags[0], ["d", noteDTag(A)]);
  assert.deepEqual(note.tags[1], ["t", "nip44-notes"]);

  const del = buildDeleteTemplate(A, PUBKEY, 2345678);
  assert.equal(del.kind, DELETE_KIND);
  assert.equal(del.created_at, 2345);
  assert.equal(del.content, "");
  assert.deepEqual(del.tags[0], ["a", `${NOTE_KIND}:${PUBKEY}:${noteDTag(A)}`]);
});

test("the local signer produces valid relay events", async () => {
  const secret = generateSecretKey();
  const pubkey = getPublicKey(secret);
  const signer = makeSigner({ type: "local", sk: bytesToHex(secret), pubkey });
  const event = await signer.signEvent(buildNoteTemplate(envelope(A, 1234000), pubkey));
  assert.equal(event.pubkey, pubkey);
  assert.ok(verifyEvent(event));
  assert.equal(event.kind, NOTE_KIND);
  assert.equal(event.content, `cipher-${A}`);
});

test("relay events become remote notes and deletions", () => {
  const note = eventToRemote({
    kind: NOTE_KIND,
    tags: [["d", noteDTag(A)]],
    content: "ciphertext",
    created_at: 100,
  });
  assert.deepEqual(note, {
    type: "note",
    id: A,
    updatedAt: 100000,
    ciphertext: "ciphertext",
    event: {
      kind: NOTE_KIND,
      tags: [["d", noteDTag(A)]],
      content: "ciphertext",
      created_at: 100,
    },
  });

  const del = eventToRemote({
    kind: DELETE_KIND,
    tags: [["a", `${NOTE_KIND}:${PUBKEY}:${noteDTag(B)}`]],
    content: "",
    created_at: 200,
  });
  assert.equal(del.type, "delete");
  assert.equal(del.id, B);
  assert.equal(del.deletedAt, 200000);

  assert.equal(eventToRemote({ kind: NOTE_KIND, tags: [], content: "x", created_at: 1 }), null);
  assert.equal(eventToRemote({ kind: 1, tags: [], content: "x", created_at: 1 }), null);
});

test("the relay filter asks for notes and delete requests", () => {
  const filter = noteEventFilter(PUBKEY);
  assert.deepEqual(filter.kinds, [NOTE_KIND, DELETE_KIND]);
  assert.deepEqual(filter.authors, [PUBKEY]);
  assert.deepEqual(filter["#t"], ["nip44-notes"]);
});

test("the app security policy permits Nostr relay WebSockets", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const csp = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(
    html,
  )?.[1];
  assert.ok(csp, "the Content Security Policy exists");
  const connect = csp
    .split(";")
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith("connect-src "));
  assert.ok(connect, "the connect-src directive exists");
  const sources = new Set(connect.split(/\s+/).slice(1));
  assert.ok(sources.has("wss:"), "secure relays are not blocked by connect-src");
  assert.ok(sources.has("ws:"), "explicitly configured local relays are not blocked");
});

test("merge takes newer remote notes and preserves local createdAt", () => {
  const local = new Map([
    [A, envelope(A, 100000)],
    [B, envelope(B, 100000)],
  ]);
  const { writes, deletes } = planMerge(
    { envelopes: local, tombstones: {} },
    [remoteNote(A, 200000), remoteNote(B, 50000), remoteNote(C, 300000)],
  );
  assert.deepEqual(writes.map((write) => write.id), [A, C]);
  assert.equal(writes[0].envelope.updatedAt, 200000);
  assert.equal(writes[0].envelope.createdAt, 99000);
  assert.equal(writes[1].envelope.createdAt, 300000);
  assert.equal(deletes.length, 0);
});

test("merge does not overwrite a newer local note", () => {
  const local = new Map([[A, envelope(A, 300000)]]);
  const { writes } = planMerge(
    { envelopes: local, tombstones: {} },
    [remoteNote(A, 200000), remoteNote(A, 250000)],
  );
  assert.equal(writes.length, 0);
});

test("remote deletions win only when they are not older than the local note", () => {
  const local = new Map([
    [A, envelope(A, 100000)],
    [B, envelope(B, 300000)],
    [C, envelope(C, 100000)],
  ]);
  const { deletes } = planMerge(
    { envelopes: local, tombstones: { [C]: 250000 } },
    [remoteDelete(A, 200000), remoteDelete(B, 200000), remoteDelete(C, 200000)],
  );
  assert.deepEqual(deletes.map((deletion) => deletion.id), [A]);
});

test("a newer note beats a deletion event", () => {
  const local = new Map([[A, envelope(A, 100000)]]);
  const merge = planMerge(
    { envelopes: local, tombstones: {} },
    [remoteDelete(A, 200000), remoteNote(A, 300000)],
  );
  assert.equal(merge.writes.length, 1);
  assert.equal(merge.deletes.length, 0);

  const older = planMerge(
    { envelopes: local, tombstones: {} },
    [remoteDelete(A, 300000), remoteNote(A, 200000)],
  );
  assert.equal(older.writes.length, 0);
  assert.deepEqual(older.deletes.map((deletion) => deletion.id), [A]);
});

test("push publishes newer local notes and tombstones", () => {
  const local = new Map([
    [A, envelope(A, 300000)],
    [B, envelope(B, 100000)],
    [D, envelope(D, 100000)],
  ]);
  const pushes = planPush(
    { envelopes: local, tombstones: { [C]: 400000, [E]: 100000 } },
    new Map([
      [A, remoteNote(A, 200000)],
      [B, remoteNote(B, 100000)],
      [C, remoteNote(C, 200000)],
      [E, remoteNote(E, 300000)],
    ]),
    new Map([[D, remoteDelete(D, 200000)]]),
  );
  assert.deepEqual(
    pushes.map((item) => `${item.type}:${item.id}`),
    [`note:${A}`, `delete:${C}`],
  );
});
