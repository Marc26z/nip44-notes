import test from "node:test";
import assert from "node:assert/strict";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { getConversationKey, encrypt, decrypt } from "nostr-tools/nip44";
import {
  FILE_FORMAT,
  MAX_PAYLOAD_BYTES,
  byteLength,
  newId,
  newNote,
  validateEnvelope,
  parseEnvelope,
  serializeEnvelope,
  noteFileName,
  encryptNote,
  decryptEnvelope,
  noteToMarkdown,
  stripMarkdown,
  deriveTitle,
  deriveExcerpt,
  countWords,
  slugify,
  isMarkdownFileName,
  noteFromMarkdownFile,
  createBackup,
  parseBackup,
  mergeEnvelopes,
  sortNotes,
  relativeTime,
} from "../src/core.js";

const secret = generateSecretKey();
const pubkey = getPublicKey(secret);
const conversation = getConversationKey(secret, pubkey);
const encryptFn = (plaintext) => encrypt(plaintext, conversation);
const decryptFn = (ciphertext) => decrypt(ciphertext, conversation);

function envelope(overrides = {}) {
  return {
    format: FILE_FORMAT,
    id: "0123456789abcdef",
    createdAt: 1000,
    updatedAt: 2000,
    ciphertext: "ciphertext",
    ...overrides,
  };
}

test("newNote creates a usable note", () => {
  const before = Date.now();
  const note = newNote();
  assert.match(note.id, /^[0-9a-f]{16}$/);
  assert.equal(note.title, "");
  assert.equal(note.body, "");
  assert.ok(note.createdAt >= before);
  assert.equal(note.createdAt, note.updatedAt);
  assert.equal(newId().length, 16);
});

test("byteLength counts UTF-8 bytes", () => {
  assert.equal(byteLength("hello"), 5);
  assert.equal(byteLength("é"), 2);
  assert.equal(byteLength("🔒"), 4);
});

test("envelopes are validated and serialized", () => {
  const env = validateEnvelope(envelope());
  assert.deepEqual(env, envelope());
  assert.throws(() => validateEnvelope({ ...envelope(), format: "other" }), /format/);
  assert.throws(() => validateEnvelope({ ...envelope(), id: "nope" }), /id/);
  assert.throws(() => validateEnvelope({ ...envelope(), ciphertext: "" }), /ciphertext/);
  assert.throws(() => validateEnvelope({ ...envelope(), updatedAt: NaN }), /updatedAt/);
  const text = serializeEnvelope(env);
  assert.ok(text.endsWith("\n"));
  assert.deepEqual(parseEnvelope(text), env);
  assert.equal(noteFileName(env.id), `${env.id}.nip44`);
  assert.throws(() => noteFileName("bad"), /Invalid/);
});

test("NIP-44 note encryption round-trips", async () => {
  const note = newNote({ title: "Secret", body: "**hello**" });
  const env = await encryptNote(note, encryptFn);
  assert.equal(env.format, FILE_FORMAT);
  assert.equal(env.id, note.id);
  assert.notEqual(env.ciphertext, "**hello**");
  const restored = await decryptEnvelope(env, decryptFn);
  assert.deepEqual(restored, {
    id: note.id,
    title: "Secret",
    body: "**hello**",
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  });
});

test("encryptNote rejects oversized payloads", async () => {
  const note = newNote({ body: "a".repeat(MAX_PAYLOAD_BYTES) });
  await assert.rejects(() => encryptNote(note, encryptFn), /too large/);
});

test("markdown conversion and title derivation", () => {
  const note = newNote({ title: "Hello", body: "World" });
  assert.equal(noteToMarkdown(note), "# Hello\n\nWorld\n");
  assert.equal(noteToMarkdown({ title: "", body: "World" }), "World\n");
  assert.equal(stripMarkdown("# Title\n\n**bold** [link](https://x.y) `code`"), "Title\n\nbold link code");
  assert.equal(deriveTitle(note), "Hello");
  assert.equal(deriveTitle({ title: "", body: "## First line\n\nMore" }), "First line");
  assert.equal(deriveTitle({ title: "", body: "" }), "Untitled");
  assert.equal(deriveExcerpt("**bold** text"), "bold text");
  assert.equal(countWords("one two **three**"), 3);
  assert.equal(countWords(""), 0);
  assert.equal(slugify("Héllo, World!"), "hello-world");
  assert.equal(slugify(""), "note");
  assert.ok(isMarkdownFileName("a.md"));
  assert.ok(isMarkdownFileName("a.markdown"));
  assert.ok(isMarkdownFileName("a.txt"));
  assert.ok(!isMarkdownFileName("a.nip44"));
});

test("markdown files become notes", () => {
  const note = noteFromMarkdownFile("My File.md", "# Real title\n\nBody text\n", 5000);
  assert.equal(note.title, "Real title");
  assert.equal(note.body, "Body text\n");
  assert.equal(note.createdAt, 5000);
  assert.match(note.id, /^[0-9a-f]{16}$/);

  const plain = noteFromMarkdownFile("Shopping.md", "- milk\n- eggs\n", 6000);
  assert.equal(plain.title, "Shopping");
  assert.equal(plain.body, "- milk\n- eggs\n");
});

test("backups round-trip and validate", () => {
  const a = envelope({ id: "aaaaaaaaaaaaaaaa", updatedAt: 1 });
  const b = envelope({ id: "bbbbbbbbbbbbbbbb", updatedAt: 2 });
  const backup = createBackup([a, b], pubkey);
  assert.equal(backup.format, "nip44-notes-backup/1");
  assert.equal(backup.pubkey, pubkey);
  assert.deepEqual(parseBackup(JSON.stringify(backup)), [a, b]);
  assert.deepEqual(parseBackup(JSON.stringify(a)), [a]);
  assert.deepEqual(parseBackup(JSON.stringify([a])), [a]);
  assert.throws(() => parseBackup("not json"), /valid JSON/);
  assert.throws(() => parseBackup(JSON.stringify({ format: "x" })), /Not a NIP44/);
});

test("mergeEnvelopes respects newer timestamps and tombstones", () => {
  const existing = new Map([
    ["aaaaaaaaaaaaaaaa", envelope({ id: "aaaaaaaaaaaaaaaa", updatedAt: 100 })],
  ]);
  const incoming = [
    envelope({ id: "aaaaaaaaaaaaaaaa", updatedAt: 200 }),
    envelope({ id: "bbbbbbbbbbbbbbbb", updatedAt: 50 }),
    envelope({ id: "cccccccccccccccc", updatedAt: 300 }),
    envelope({ id: "aaaaaaaaaaaaaaaa", updatedAt: 150 }),
  ];
  const result = mergeEnvelopes(existing, incoming, { bbbbbbbbbbbbbbbb: 60 });
  assert.deepEqual(
    result.write.map((env) => env.id),
    ["aaaaaaaaaaaaaaaa", "cccccccccccccccc"],
  );
  assert.equal(result.write[0].updatedAt, 200);
  assert.equal(result.skipped, 1);
  assert.equal(result.kept, 0);

  const kept = mergeEnvelopes(existing, [envelope({ id: "aaaaaaaaaaaaaaaa", updatedAt: 10 })]);
  assert.equal(kept.write.length, 0);
  assert.equal(kept.kept, 1);
});

test("sortNotes is newest first and relativeTime is human readable", () => {
  const notes = [
    { id: "a", title: "A", body: "", createdAt: 1, updatedAt: 100 },
    { id: "b", title: "B", body: "", createdAt: 1, updatedAt: 300 },
    { id: "c", title: "C", body: "", createdAt: 1, updatedAt: 200 },
  ];
  assert.deepEqual(
    sortNotes(notes).map((note) => note.id),
    ["b", "c", "a"],
  );
  const now = Date.now();
  assert.equal(relativeTime(now, now), "just now");
  assert.match(relativeTime(now - 120000, now), /2 minutes/);
  assert.match(relativeTime(now - 7200000, now), /2 hours/);
});
