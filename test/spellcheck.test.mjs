import test from "node:test";
import assert from "node:assert/strict";
import {
  addCustomWord,
  customWords,
  findMisspellings,
  isKnownWord,
  removeCustomWord,
  resetSpellDictionary,
  setSpellcheckEnabled,
  spellcheckEnabled,
  suggest,
} from "../src/spellcheck.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test("finds misspelled words with exact offsets", () => {
  const text = "This sentnce has a speling eror.";
  const issues = findMisspellings(text);
  assert.deepEqual(
    issues.map((issue) => issue.word),
    ["sentnce", "speling", "eror"],
  );
  for (const issue of issues) {
    assert.equal(text.slice(issue.start, issue.end), issue.word);
  }
});

test("ignores code, links, wikilinks, numbers, acronyms and known words", () => {
  const text = [
    "The meeting notes are ready.",
    "[ ] literal task",
    "`speling inline` and [[speling link]]",
    "https://example.com/speling",
    "[notes](https://example.com/speling)",
    "```",
    "speling fenced",
    "```",
    "NIP44 version 2",
    "Don't worry about teh typo.",
  ].join("\n");
  assert.deepEqual(findMisspellings(text).map((issue) => issue.word), ["teh"]);
});

test("suggests close words, including transpositions", () => {
  assert.equal(suggest("teh")[0], "the");
  assert.equal(suggest("speling")[0], "spelling");
  assert.ok(suggest("recieve").includes("receive"));
  assert.deepEqual(suggest(""), []);
});

test("custom words and the on/off setting persist", () => {
  globalThis.localStorage = memoryStorage();
  try {
    resetSpellDictionary();
    assert.equal(spellcheckEnabled(), true);
    setSpellcheckEnabled(false);
    assert.equal(spellcheckEnabled(), false);
    setSpellcheckEnabled(true);

    assert.equal(isKnownWord("zapstorexyz"), false);
    assert.deepEqual(findMisspellings("zapstorexyz"), [
      { start: 0, end: 11, word: "zapstorexyz" },
    ]);
    assert.equal(addCustomWord("ZapStoreXYZ"), true);
    resetSpellDictionary();
    assert.ok(customWords().includes("zapstorexyz"));
    assert.equal(isKnownWord("zapstorexyz"), true);
    assert.deepEqual(findMisspellings("zapstorexyz"), []);
    removeCustomWord("zapstorexyz");
    resetSpellDictionary();
    assert.equal(isKnownWord("zapstorexyz"), false);
  } finally {
    delete globalThis.localStorage;
    resetSpellDictionary();
  }
});
