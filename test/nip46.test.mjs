import test from "node:test";
import assert from "node:assert/strict";
import { getPublicKey } from "nostr-tools/pure";
import {
  bytesToHex,
  clearIdentity,
  connectBunker,
  createNostrConnectSession,
  loadIdentity,
  makeSigner,
  saveIdentity,
} from "../src/identity.js";

function useStorage() {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  return values;
}

const session = {
  type: "nip46",
  pubkey: "b".repeat(64),
  clientSk: "c".repeat(64),
  remote: "d".repeat(64),
  relays: ["wss://relay.example"],
  secret: "deadbeef",
};

test("remote signer sessions persist across reloads", () => {
  useStorage();
  assert.equal(loadIdentity(), null);
  saveIdentity(session);
  assert.deepEqual(loadIdentity(), session);
  clearIdentity();
  assert.equal(loadIdentity(), null);
});

test("broken remote signer sessions are ignored", () => {
  useStorage();
  globalThis.localStorage.setItem(
    "nip44notes.identity.v1",
    JSON.stringify({ ...session, relays: "wss://relay.example" }),
  );
  assert.equal(loadIdentity(), null);
  globalThis.localStorage.setItem(
    "nip44notes.identity.v1",
    JSON.stringify({ ...session, clientSk: "nope" }),
  );
  assert.equal(loadIdentity(), null);
});

test("nostrconnect links carry the relays, secret and NIP-44 permissions", () => {
  const connect = createNostrConnectSession(["wss://relay.example"]);
  const url = new URL(connect.uri);
  assert.equal(url.protocol, "nostrconnect:");
  assert.equal(url.hostname, getPublicKey(connect.clientSecretKey));
  assert.deepEqual(url.searchParams.getAll("relay"), ["wss://relay.example"]);
  assert.equal(url.searchParams.get("secret"), connect.secret);
  assert.match(url.searchParams.get("perms"), /nip44_encrypt/);
  assert.match(url.searchParams.get("perms"), /nip44_decrypt/);
  assert.equal(url.searchParams.get("name"), "NIP44 Notes");
  assert.ok(!connect.uri.includes(bytesToHex(connect.clientSecretKey)));
});

test("an incomplete signer session cannot make a signer", () => {
  assert.throws(() => makeSigner({ ...session, clientSk: "" }), /session is incomplete/);
});

test("bunker links are validated before any connection is attempted", async () => {
  await assert.rejects(connectBunker("not-a-bunker"), /valid bunker/);
});
