#!/usr/bin/env node
/**
 * End-to-end run of the built app bundle inside a DOM, without a browser.
 *
 * Always rebuilds first, so it exercises exactly what would ship: the app is
 * loaded from dist/ as a real script tag, then driven through onboarding,
 * writing, autosave, reload, search, preview, and deletion.
 */
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const URL_ROOT = "http://localhost:4173/";
const NOTE_BODY = "## Groceries\n\n- milk\n- **eggs**";

let pageHtml = "";
const openWindows = [];

function ok(step, detail = "") {
  console.log(`  ok ${step}${detail ? ` — ${detail}` : ""}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitFor(label, check, timeout = 6000) {
  const started = Date.now();
  for (;;) {
    if (check()) return;
    if (Date.now() - started > timeout) {
      throw new Error(`Timed out waiting for: ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function buildOnce() {
  const result = spawnSync(process.execPath, [path.join(root, "scripts/build.mjs")], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (result.status !== 0) throw new Error("The build failed");
}

function makeWindow({ seed = [] } = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => errors.push(error?.message || String(error)));

  const dom = new JSDOM(pageHtml, {
    url: URL_ROOT,
    pretendToBeVisual: true,
    runScripts: "dangerously",
    virtualConsole,
  });
  const { window } = dom;

  Object.defineProperty(window, "crypto", { value: webcrypto, configurable: true });
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  });
  window.Element.prototype.scrollIntoView = function scrollIntoView() {};
  window.HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  window.HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
    this.dispatchEvent(new window.Event("close"));
  };

  for (const [key, value] of seed) window.localStorage.setItem(key, value);

  openWindows.push(window);
  return { window, errors };
}

function runApp(window, bundle) {
  const script = window.document.createElement("script");
  script.textContent = bundle;
  window.document.body.append(script);
}

function byId(window, id) {
  return window.document.getElementById(id);
}

function click(element) {
  element.click();
}

function fire(element, type, value) {
  if (value !== undefined) element.value = value;
  element.dispatchEvent(new element.ownerDocument.defaultView.Event(type, { bubbles: true }));
}

async function main() {
  console.log("Building the app…");
  buildOnce();
  pageHtml = await readFile(path.join(root, "dist/index.html"), "utf8");
  const bundle = await readFile(path.join(root, "dist/app.js"), "utf8");

  /* ---------------------------------------------------------- session 1 -- */
  console.log("\nSession 1: fresh install");
  const s1 = makeWindow();
  runApp(s1.window, bundle);

  await waitFor("auth view", () => !byId(s1.window, "auth-view").hidden);
  ok("boots to the key screen");

  click(byId(s1.window, "create-key-btn"));
  await waitFor("recovery dialog", () => byId(s1.window, "recovery-dialog").open);
  const nsec = byId(s1.window, "recovery-nsec").textContent;
  assert(/^nsec1/.test(nsec), "recovery dialog shows an nsec");
  const npub = byId(s1.window, "recovery-npub").textContent;
  assert(/^npub1/.test(npub), "recovery dialog shows an npub");

  const confirm = byId(s1.window, "recovery-confirm");
  confirm.checked = true;
  fire(confirm, "change");
  const continueBtn = byId(s1.window, "recovery-continue");
  assert(!continueBtn.disabled, "continue unlocks after confirming");
  click(continueBtn);

  await waitFor("storage view", () => !byId(s1.window, "storage-view").hidden);
  assert(byId(s1.window, "choose-folder-btn").hidden, "folder choice hidden without a picker");
  ok("onboarding reaches the storage choice");

  click(byId(s1.window, "use-app-storage-btn"));
  await waitFor("notes view", () => !byId(s1.window, "notes-view").hidden);
  assert(
    byId(s1.window, "storage-label").textContent.includes("Browser storage"),
    "falls back to browser storage without OPFS",
  );
  ok("enters the app with fallback storage");

  click(byId(s1.window, "new-note-btn"));
  await waitFor("editor", () => !byId(s1.window, "editor").hidden);
  fire(byId(s1.window, "note-title"), "input", "Shopping list");
  fire(byId(s1.window, "note-body"), "input", NOTE_BODY);
  await waitFor("autosave", () => !byId(s1.window, "word-count").textContent.startsWith("0"));

  const noteId = s1.window.location.hash.slice(4);
  assert(/^[0-9a-f]{16}$/.test(noteId), `route is a note route (#/n/${noteId})`);
  const fileKey = `nip44notes.file.${noteId}.nip44`;
  await waitFor("encrypted file", () => s1.window.localStorage.getItem(fileKey) !== null);
  await waitFor("save status", () =>
    byId(s1.window, "save-text").textContent.startsWith("Saved"),
  );
  const raw = s1.window.localStorage.getItem(fileKey);
  const envelope = JSON.parse(raw);
  assert(envelope.format === "nip44-notes/1", "file is a NIP44 Notes envelope");
  assert(!raw.includes("eggs") && !raw.includes("Shopping"), "file does not contain plaintext");
  ok("note saved as an encrypted file", `${fileKey} (${raw.length} bytes)`);

  click(byId(s1.window, "tab-preview"));
  await waitFor("preview", () => !byId(s1.window, "note-preview").hidden);
  const preview = byId(s1.window, "note-preview").innerHTML;
  assert(preview.includes("<h2>Groceries</h2>"), "preview renders the heading");
  assert(preview.includes("<strong>eggs</strong>"), "preview renders bold");
  assert(preview.includes("<li>milk</li>"), "preview renders the list");
  ok("Markdown preview renders");

  /* -------------------------------------------------- folders + wikilinks -- */
  console.log("\nSession 1b: folders and wikilinks");
  click(byId(s1.window, "new-note-btn"));
  await waitFor(
    "fresh editor for a new note",
    () =>
      byId(s1.window, "note-title").value === "" &&
      byId(s1.window, "word-count").textContent === "0 words",
  );
  fire(byId(s1.window, "note-title"), "input", "Ideas");
  fire(
    byId(s1.window, "note-body"),
    "input",
    "Read [[Shopping list]] and [[Future note]].",
  );

  const folderSelect = byId(s1.window, "note-folder");
  folderSelect.value = "__new__";
  fire(folderSelect, "change");
  await waitFor("folder dialog", () => byId(s1.window, "folder-dialog").open);
  fire(byId(s1.window, "folder-name-input"), "input", "Work");
  click(byId(s1.window, "folder-save"));
  await waitFor("folder assigned", () => byId(s1.window, "note-folder").value === "Work");
  await waitFor("folder saved", () =>
    byId(s1.window, "save-text").textContent.startsWith("Saved"),
  );
  ok("note moved into a new folder");

  click(byId(s1.window, "tab-preview"));
  await waitFor("preview", () => !byId(s1.window, "note-preview").hidden);
  const linkPreview = byId(s1.window, "note-preview").innerHTML;
  assert(
    linkPreview.includes(`href="#/n/${noteId}"`),
    "wikilink resolves to the existing note",
  );
  assert(
    linkPreview.includes('class="wikilink is-missing"') &&
      linkPreview.includes('href="#/new?title=Future%20note"'),
    "missing wikilink offers to create the note",
  );
  ok("wikilinks resolve and offer creation");

  const folderFilter = byId(s1.window, "folder-filter");
  folderFilter.value = "Work";
  fire(folderFilter, "change");
  assert(
    s1.window.document.querySelectorAll(".note-card").length === 1 &&
      s1.window.document.querySelector(".note-card-title").textContent === "Ideas",
    "folder filter narrows the list",
  );
  folderFilter.value = "__all__";
  fire(folderFilter, "change");
  assert(s1.window.document.querySelectorAll(".note-card").length === 2, "filter clears");
  ok("folder filter works");

  const missingLink = s1.window.document.querySelector("#note-preview a.wikilink.is-missing");
  assert(missingLink, "missing wikilink is rendered as a link");
  click(missingLink);
  await waitFor(
    "note created from a missing wikilink",
    () => byId(s1.window, "note-title").value === "Future note",
  );
  ok("clicking a missing wikilink creates the note");

  click(byId(s1.window, "delete-btn"));
  await waitFor("confirm dialog", () => byId(s1.window, "confirm-dialog").open);
  click(byId(s1.window, "confirm-ok"));
  await waitFor(
    "created note deleted",
    () => s1.window.document.querySelectorAll(".note-card").length === 2,
  );
  const ideasCard = [...s1.window.document.querySelectorAll(".note-card")].find(
    (card) => card.querySelector(".note-card-title").textContent === "Ideas",
  );
  assert(ideasCard, "the folder note is still listed");
  click(ideasCard);
  await waitFor("editor", () => !byId(s1.window, "editor").hidden);

  click(byId(s1.window, "delete-btn"));
  await waitFor("confirm dialog", () => byId(s1.window, "confirm-dialog").open);
  click(byId(s1.window, "confirm-ok"));
  await waitFor(
    "second note deleted",
    () => s1.window.document.querySelectorAll(".note-card").length === 1,
  );
  ok("temporary folder note deleted before reload");

  /* ---------------------------------------------------------- session 2 -- */
  console.log("\nSession 2: reload with the same browser profile");
  const seed = [];
  for (let i = 0; i < s1.window.localStorage.length; i += 1) {
    const key = s1.window.localStorage.key(i);
    if (key && key.startsWith("nip44notes.")) seed.push([key, s1.window.localStorage.getItem(key)]);
  }
  seed.push(["nip44notes.file.deadbeefdeadbeef.nip44", "not a valid envelope"]);
  const s2 = makeWindow({ seed });
  runApp(s2.window, bundle);

  await waitFor("notes view", () => !byId(s2.window, "notes-view").hidden);
  assert(byId(s2.window, "auth-view").hidden, "stored identity skips onboarding");
  const banner = byId(s2.window, "invalid-banner");
  assert(!banner.hidden && /1 file/.test(banner.textContent), "corrupt file is reported");
  ok("bad files are flagged, not fatal");

  const cards = s2.window.document.querySelectorAll(".note-card");
  assert(cards.length === 1, "the saved note is listed");
  assert(
    cards[0].querySelector(".note-card-title").textContent === "Shopping list",
    "note card shows the title",
  );
  ok("note decrypts after reload");

  click(cards[0]);
  await waitFor("editor", () => !byId(s2.window, "editor").hidden);
  assert(byId(s2.window, "note-title").value === "Shopping list", "title round-trips");
  assert(byId(s2.window, "note-body").value === NOTE_BODY, "body round-trips");
  assert(byId(s2.window, "save-status").dataset.state === "saved", "note is not a draft");
  ok("editor restores the note");

  const search = byId(s2.window, "search-input");
  fire(search, "input", "zzz");
  assert(!byId(s2.window, "empty-list").hidden, "empty state for no matches");
  assert(byId(s2.window, "empty-title").textContent === "No matches", "empty state copy");
  fire(search, "input", "shop");
  assert(s2.window.document.querySelectorAll(".note-card").length === 1, "search matches");
  fire(search, "input", "");
  assert(!byId(s2.window, "note-list").hidden, "clearing search restores the list");
  ok("search filters and clears");

  click(byId(s2.window, "delete-btn"));
  await waitFor("confirm dialog", () => byId(s2.window, "confirm-dialog").open);
  click(byId(s2.window, "confirm-ok"));
  await waitFor("note deleted", () => s2.window.document.querySelectorAll(".note-card").length === 0);
  assert(s2.window.localStorage.getItem(fileKey) === null, "file removed from storage");
  assert(byId(s2.window, "editor").hidden, "editor closes");
  assert(byId(s2.window, "empty-title").textContent === "No notes yet", "empty state copy");
  const identity = JSON.parse(s2.window.localStorage.getItem("nip44notes.identity.v1"));
  const tombstones = JSON.parse(s2.window.localStorage.getItem("nip44notes.deleted.v1"));
  assert(
    tombstones[`${identity.pubkey}:${noteId}`] > 0,
    "deletion recorded as a tombstone",
  );
  ok("note deleted with a tombstone");

  const scriptErrors = [...s1.errors, ...s2.errors];
  assert(scriptErrors.length === 0, `no script errors (got: ${scriptErrors.join("; ")})`);

  console.log("\nAll end-to-end checks passed.");
}

function closeWindows() {
  for (const window of openWindows) {
    try {
      window.close();
    } catch {
      /* already closed */
    }
  }
  openWindows.length = 0;
}

main()
  .then(closeWindows)
  .catch((error) => {
    closeWindows();
    console.error(`\ne2e failed: ${error?.message || error}`);
    process.exitCode = 1;
  });
