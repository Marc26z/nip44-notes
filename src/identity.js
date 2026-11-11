import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import * as nip19 from "nostr-tools/nip19";
import * as nip44 from "nostr-tools/nip44";

const STORAGE_KEY = "nip44notes.identity.v1";

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
  } catch {
    return null;
  }
  return null;
}

export function saveIdentity(identity) {
  const data =
    identity.type === "local"
      ? { type: "local", sk: identity.sk, pubkey: identity.pubkey }
      : { type: "nip07", pubkey: identity.pubkey };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function clearIdentity() {
  localStorage.removeItem(STORAGE_KEY);
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

  throw new Error("Unknown identity type");
}
