import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import * as nip19 from "nostr-tools/nip19";
import * as nip44 from "nostr-tools/nip44";
import { SimplePool } from "nostr-tools/pool";
import { BunkerSigner, createNostrConnectURI, parseBunkerInput } from "nostr-tools/nip46";

const STORAGE_KEY = "nip44notes.identity.v1";

/** Relays that carry NIP-46 remote signer traffic (kind 24133). */
export const SIGNER_RELAYS = [
  "wss://nos.lol",
  "wss://relay.damus.io",
  "wss://relay.primal.net",
  "wss://nostr.mom",
];

const SIGNER_PERMS = ["get_public_key", "sign_event", "nip44_encrypt", "nip44_decrypt"];
const SIGNER_NAME = "NIP44 Notes";
const SIGNER_TIMEOUT = 180000;

let signerPool = null;
let activeBunker = null;

export function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex) {
  if (typeof hex !== "string" || hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) {
    throw new Error("Invalid hex key");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function isHexKey(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

function cleanRelays(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((r) => typeof r === "string" && /^wss?:\/\//i.test(r)))];
}

function signerAppUrl() {
  return typeof location !== "undefined" && location.origin
    ? location.origin + location.pathname
    : "";
}

function getSignerPool() {
  if (!signerPool) signerPool = new SimplePool();
  return signerPool;
}

export function loadIdentity() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data?.type === "local" && isHexKey(data.sk) && isHexKey(data.pubkey)) {
      return { type: "local", sk: data.sk.toLowerCase(), pubkey: data.pubkey.toLowerCase() };
    }
    if (data?.type === "nip07" && isHexKey(data.pubkey)) {
      return { type: "nip07", pubkey: data.pubkey.toLowerCase() };
    }
    if (
      data?.type === "nip46" &&
      isHexKey(data.pubkey) &&
      isHexKey(data.clientSk) &&
      isHexKey(data.remote) &&
      cleanRelays(data.relays).length
    ) {
      return {
        type: "nip46",
        pubkey: data.pubkey.toLowerCase(),
        clientSk: data.clientSk.toLowerCase(),
        remote: data.remote.toLowerCase(),
        relays: cleanRelays(data.relays),
        secret: typeof data.secret === "string" ? data.secret : null,
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function saveIdentity(identity) {
  let data;
  if (identity.type === "local") {
    data = { type: "local", sk: identity.sk, pubkey: identity.pubkey };
  } else if (identity.type === "nip46") {
    data = {
      type: "nip46",
      pubkey: identity.pubkey,
      clientSk: identity.clientSk,
      remote: identity.remote,
      relays: identity.relays,
      secret: identity.secret,
    };
  } else {
    data = { type: "nip07", pubkey: identity.pubkey };
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function clearIdentity() {
  localStorage.removeItem(STORAGE_KEY);
}

export async function closeSignerSession() {
  const signer = activeBunker;
  activeBunker = null;
  if (signer) {
    try {
      await signer.close();
    } catch {
      /* the signer may already be gone */
    }
  }
  if (signerPool) {
    try {
      signerPool.destroy();
    } catch {
      /* nothing to close */
    }
    signerPool = null;
  }
}

export function identityNpub(identity) {
  return identity ? nip19.npubEncode(identity.pubkey) : "";
}

export function identityNsec(identity) {
  if (!identity || identity.type !== "local") return "";
  return nip19.nsecEncode(hexToBytes(identity.sk));
}

export function createLocalIdentity() {
  const secret = generateSecretKey();
  const sk = bytesToHex(secret);
  const pubkey = getPublicKey(secret);
  return { type: "local", sk, pubkey };
}

export function importNsec(input) {
  const value = String(input || "").trim();
  if (!value) throw new Error("Paste an nsec or a 64-character hex key");
  let secret;
  if (isHexKey(value)) {
    secret = hexToBytes(value);
  } else {
    let decoded;
    try {
      decoded = nip19.decode(value);
    } catch {
      throw new Error("That does not look like a valid nsec");
    }
    if (decoded.type !== "nsec") throw new Error("That is not a secret key (nsec)");
    secret = decoded.data;
  }
  const pubkey = getPublicKey(secret);
  return { type: "local", sk: bytesToHex(secret), pubkey };
}

export function nip07Available() {
  return Boolean(
    typeof window !== "undefined" &&
      window.nostr &&
      typeof window.nostr.getPublicKey === "function" &&
      window.nostr.nip44 &&
      typeof window.nostr.nip44.encrypt === "function" &&
      typeof window.nostr.nip44.decrypt === "function",
  );
}

export async function connectNip07() {
  if (!nip07Available()) {
    throw new Error("No NIP-07 signer with NIP-44 support was found");
  }
  const pubkey = String(await window.nostr.getPublicKey()).toLowerCase();
  if (!isHexKey(pubkey)) throw new Error("The signer returned an invalid public key");
  return { type: "nip07", pubkey };
}

/** Start a client-initiated (nostrconnect://) signer session. */
export function createNostrConnectSession(relays = SIGNER_RELAYS) {
  const clientSecretKey = generateSecretKey();
  const clientPubkey = getPublicKey(clientSecretKey);
  const secret = bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(16)));
  const list = cleanRelays(relays);
  const uri = createNostrConnectURI({
    clientPubkey,
    relays: list,
    secret,
    perms: SIGNER_PERMS,
    name: SIGNER_NAME,
    url: signerAppUrl(),
  });
  return { clientSecretKey, clientSk: bytesToHex(clientSecretKey), secret, relays: list, uri };
}

function identityFromBunker({ signer, clientSk, remote, relays, secret, pubkey }) {
  activeBunker = signer;
  return {
    type: "nip46",
    pubkey,
    clientSk,
    remote,
    relays: cleanRelays(relays),
    secret: secret || null,
  };
}

/** Wait for Amber (or another NIP-46 signer) to approve a nostrconnect:// URI. */
export async function awaitNostrConnect(session, { signal, timeout = SIGNER_TIMEOUT } = {}) {
  const signer = await BunkerSigner.fromURI(
    session.clientSecretKey,
    session.uri,
    { pool: getSignerPool(), timeout: 60000 },
    signal || timeout,
  );
  try {
    const pubkey = await signer.getPublicKey();
    if (!isHexKey(pubkey)) throw new Error("The signer returned an invalid public key");
    return identityFromBunker({
      signer,
      clientSk: session.clientSk,
      remote: signer.bp.pubkey,
      relays: signer.bp.relays,
      secret: session.secret,
      pubkey: String(pubkey).toLowerCase(),
    });
  } catch (error) {
    try {
      await signer.close();
    } catch {
      /* ignore */
    }
    throw error;
  }
}

/** Connect with a bunker:// link pasted from a signer app. */
export async function connectBunker(input, { timeout = SIGNER_TIMEOUT } = {}) {
  const value = String(input || "").trim();
  if (!value.startsWith("bunker://")) throw new Error("Enter a valid bunker:// connection string");
  let bp;
  try {
    bp = await parseBunkerInput(value);
  } catch {
    bp = null;
  }
  if (!bp) throw new Error("Enter a valid bunker:// connection string");
  const relays = cleanRelays(bp.relays);
  if (!relays.length) throw new Error("That bunker link has no relay");
  const clientSecretKey = generateSecretKey();
  const signer = BunkerSigner.fromBunker(clientSecretKey, { ...bp, relays }, {
    pool: getSignerPool(),
    timeout: 60000,
  });
  try {
    await signer.connect({ name: SIGNER_NAME, url: signerAppUrl() });
    const pubkey = await signer.getPublicKey();
    if (!isHexKey(pubkey)) throw new Error("The signer returned an invalid public key");
    return identityFromBunker({
      signer,
      clientSk: bytesToHex(clientSecretKey),
      remote: bp.pubkey,
      relays,
      secret: bp.secret,
      pubkey: String(pubkey).toLowerCase(),
    });
  } catch (error) {
    try {
      await signer.close();
    } catch {
      /* ignore */
    }
    throw error;
  }
}

export function makeSigner(identity) {
  if (!identity) throw new Error("No identity");
  const pubkey = identity.pubkey;
  const npub = identityNpub(identity);

  if (identity.type === "local") {
    const secret = hexToBytes(identity.sk);
    const key = nip44.getConversationKey(secret, pubkey);
    return {
      type: "local",
      pubkey,
      npub,
      async encrypt(plaintext) {
        return nip44.encrypt(plaintext, key);
      },
      async decrypt(ciphertext) {
        return nip44.decrypt(ciphertext, key);
      },
      signEvent(template) {
        return finalizeEvent(template, secret);
      },
    };
  }

  if (identity.type === "nip07") {
    if (!nip07Available()) {
      throw new Error("Your browser extension is not available or does not support NIP-44");
    }
    return {
      type: "nip07",
      pubkey,
      npub,
      async encrypt(plaintext) {
        return window.nostr.nip44.encrypt(pubkey, plaintext);
      },
      async decrypt(ciphertext) {
        return window.nostr.nip44.decrypt(pubkey, ciphertext);
      },
      async signEvent(template) {
        return window.nostr.signEvent(template);
      },
    };
  }

  if (identity.type === "nip46") {
    if (!isHexKey(identity.clientSk) || !isHexKey(identity.remote) || !cleanRelays(identity.relays).length) {
      throw new Error("The signer session is incomplete. Sign in again.");
    }
    let signer = activeBunker;
    if (!signer) {
      signer = BunkerSigner.fromBunker(
        hexToBytes(identity.clientSk),
        {
          pubkey: identity.remote,
          relays: cleanRelays(identity.relays),
          secret: identity.secret || null,
        },
        { pool: getSignerPool(), timeout: 60000 },
      );
      activeBunker = signer;
    }
    return {
      type: "nip46",
      pubkey,
      npub,
      signer,
      async encrypt(plaintext) {
        return signer.nip44Encrypt(pubkey, plaintext);
      },
      async decrypt(ciphertext) {
        return signer.nip44Decrypt(pubkey, ciphertext);
      },
      async signEvent(template) {
        return signer.signEvent(template);
      },
    };
  }

  throw new Error("Unknown identity type");
}
