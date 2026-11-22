import { WORDS } from "./dictionary.js";

const ENABLED_KEY = "nip44notes.spellcheck.enabled";
const WORDS_KEY = "nip44notes.spellcheck.words";

const WORD_RE = /[A-Za-z]+(?:'[A-Za-z]+)?/g;
const WORDS_LIST = WORDS.split(" ");
const WORD_RANK = new Map(WORDS_LIST.map((word, index) => [word, index]));
let known = null;

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readCustomWords() {
  const raw = storage()?.getItem(WORDS_KEY) ?? "";
  return raw
    .split(/[\s,]+/)
    .map((word) => word.toLowerCase())
    .filter(Boolean);
}

function dictionary() {
  if (!known) {
    known = new Set(WORDS_LIST);
    for (const word of readCustomWords()) known.add(word);
  }
  return known;
}

export function resetSpellDictionary() {
  known = null;
}

export function isKnownWord(word) {
  return dictionary().has(String(word ?? "").toLowerCase());
}

export function customWords() {
  return readCustomWords();
}

export function addCustomWord(word) {
  const clean = String(word ?? "").replace(/[^A-Za-z]/g, "").toLowerCase();
  if (!clean) return false;
  const words = readCustomWords();
  if (!words.includes(clean)) {
    words.push(clean);
    storage()?.setItem(WORDS_KEY, words.join(" "));
  }
  known?.add(clean);
  return true;
}

export function removeCustomWord(word) {
  const clean = String(word ?? "").toLowerCase();
  const words = readCustomWords().filter((entry) => entry !== clean);
  if (words.length) storage()?.setItem(WORDS_KEY, words.join(" "));
  else storage()?.removeItem(WORDS_KEY);
  known = null;
}

export function spellcheckEnabled() {
  const value = storage()?.getItem(ENABLED_KEY);
  return value !== "false";
}

export function setSpellcheckEnabled(enabled) {
  storage()?.setItem(ENABLED_KEY, enabled ? "true" : "false");
}

function blank(match) {
  return match.replace(/[^\n]/g, " ");
}

function maskNonProse(text) {
  let masked = text;
  const chars = masked.split("");
  const erase = (from, to) => {
    for (let i = from; i < to; i += 1) if (chars[i] !== "\n") chars[i] = " ";
  };
  let offset = 0;
  let fence = null;
  for (const line of masked.split("\n")) {
    if (fence) {
      erase(offset, offset + line.length);
      if (new RegExp(`^\\s{0,3}${fence[0]}{${fence.length},}\\s*$`).test(line)) fence = null;
    } else {
      const opener = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (opener) {
        fence = [opener[1][0], opener[1].length];
        erase(offset, offset + line.length);
      }
    }
    offset += line.length + 1;
  }
  masked = chars.join("");
  for (const pattern of [
    /\[\[[^\]\n]*\]\]/g,
    /`[^`\n]*`/g,
    /\]\([^)\n]*\)/g,
    /\b(?:https?:\/\/|www\.)[^\s)]+/gi,
    /<[^>\n]+>/g,
  ]) {
    masked = masked.replace(pattern, blank);
  }
  return masked;
}

export function findMisspellings(text) {
  const masked = maskNonProse(String(text ?? ""));
  const result = [];
  for (const match of masked.matchAll(WORD_RE)) {
    const word = match[0];
    if (word.length < 2 || word.includes("'")) continue;
    if (word === word.toUpperCase()) continue;
    const start = match.index;
    const before = masked[start - 1];
    const after = masked[start + word.length];
    if (/\d/.test(before ?? "") || /\d/.test(after ?? "")) continue;
    if (isKnownWord(word)) continue;
    result.push({ start, end: start + word.length, word: text.slice(start, start + word.length) });
  }
  return result;
}

function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    let best = rows[i][0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + cost);
      }
      best = Math.min(best, rows[i][j]);
    }
    if (best > max) return max + 1;
  }
  return rows[a.length][b.length];
}

export function suggest(word, limit = 6) {
  const target = String(word ?? "").toLowerCase();
  if (!target) return [];
  const max = target.length <= 4 ? 1 : 2;
  const found = [];
  for (let index = 0; index < WORDS_LIST.length; index += 1) {
    const candidate = WORDS_LIST[index];
    if (candidate === target) continue;
    const distance = editDistance(target, candidate, max);
    if (distance <= max) found.push({ candidate, distance, index });
  }
  found.sort((a, b) => a.distance - b.distance || a.index - b.index);
  return found.slice(0, limit).map((entry) => entry.candidate);
}
