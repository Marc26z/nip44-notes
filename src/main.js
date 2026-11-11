import {
  encryptNote,
  decryptEnvelope,
  parseBackup,
  noteToMarkdown,
  deriveTitle,
  deriveExcerpt,
  countWords,
  isMarkdownFileName,
  noteFromMarkdownFile,
  sortNotes,
  relativeTime,
  clockTime,
  fullDate,
  newNote,
} from "./core.js";
import {
  loadIdentity,
  saveIdentity,
  clearIdentity,
  identityNpub,
  identityNsec,
  createLocalIdentity,
  importNsec,
  nip07Available,
  connectNip07,
  makeSigner,
} from "./identity.js";
import {
  setStoragePref,
  folderPickerSupported,
  saveFolderHandle,
  requestFolderPermission,
  createFolderStore,
  chooseFolderHandle,
  openOpfsStore,
  useLocalStorageFallback,
  prepareStore,
  migrateStore,
  requestPersistentStorage,
} from "./store.js";
import { exportBackupFile, exportMarkdownFile, pickFiles } from "./backup.js";
import {
  copyText,
  loadTheme,
  saveTheme,
  applyTheme,
  onSystemThemeChange,
  updateThemeIcon,
  shortNpub,
  isAndroidApp,
  isEditableTarget,
  anyDialogOpen,
  clearNode,
  svgUse,
} from "./ui.js";
import { initMarkdown, renderMarkdown } from "./markdown.js";

initMarkdown(window);

const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "1.0.0";
const TOMBSTONE_KEY = "nip44notes.deleted.v1";

const els = {
  topbar: document.getElementById("topbar"),
  brandLink: document.getElementById("brand-link"),
  identityChip: document.getElementById("identity-chip"),
  identityLabel: document.getElementById("identity-label"),
  installBtn: document.getElementById("install-btn"),
  themeBtn: document.getElementById("theme-btn"),
  settingsBtn: document.getElementById("settings-btn"),

  bootView: document.getElementById("boot-view"),
  bootText: document.getElementById("boot-text"),
  authView: document.getElementById("auth-view"),
  createKeyBtn: document.getElementById("create-key-btn"),
  importForm: document.getElementById("import-form"),
  nsecInput: document.getElementById("nsec-input"),
  importError: document.getElementById("import-error"),
  nip07Btn: document.getElementById("nip07-btn"),

  storageView: document.getElementById("storage-view"),
  chooseFolderBtn: document.getElementById("choose-folder-btn"),
  useAppStorageBtn: document.getElementById("use-app-storage-btn"),
  storageError: document.getElementById("storage-error"),

  reconnectView: document.getElementById("reconnect-view"),
  reconnectFolderName: document.getElementById("reconnect-folder-name"),
  reconnectBtn: document.getElementById("reconnect-btn"),
  reconnectChooseBtn: document.getElementById("reconnect-choose-btn"),
  reconnectOpfsBtn: document.getElementById("reconnect-opfs-btn"),
  reconnectError: document.getElementById("reconnect-error"),

  notesView: document.getElementById("notes-view"),
  searchInput: document.getElementById("search-input"),
  clearSearchBtn: document.getElementById("clear-search-btn"),
  newNoteBtn: document.getElementById("new-note-btn"),
  unreadableBanner: document.getElementById("unreadable-banner"),
  invalidBanner: document.getElementById("invalid-banner"),
  noteCount: document.getElementById("note-count"),
  storageLabel: document.getElementById("storage-label"),
  noteList: document.getElementById("note-list"),
  emptyList: document.getElementById("empty-list"),
  emptyTitle: document.getElementById("empty-title"),
  emptyText: document.getElementById("empty-text"),
  emptyNewBtn: document.getElementById("empty-new-btn"),

  editorEmpty: document.getElementById("editor-empty"),
  editor: document.getElementById("editor"),
  backBtn: document.getElementById("back-btn"),
  saveStatus: document.getElementById("save-status"),
  saveText: document.getElementById("save-text"),
  previewBtn: document.getElementById("preview-btn"),
  copyBtn: document.getElementById("copy-btn"),
  exportBtn: document.getElementById("export-btn"),
  deleteBtn: document.getElementById("delete-btn"),
  noteTitle: document.getElementById("note-title"),
  tabEdit: document.getElementById("tab-edit"),
  tabPreview: document.getElementById("tab-preview"),
  markdownToolbar: document.getElementById("markdown-toolbar"),
  noteBody: document.getElementById("note-body"),
  notePreview: document.getElementById("note-preview"),
  wordCount: document.getElementById("word-count"),

  settingsDialog: document.getElementById("settings-dialog"),
  settingsNpub: document.getElementById("settings-npub"),
  settingsNsec: document.getElementById("settings-nsec"),
  copyNpubBtn: document.getElementById("copy-npub-btn"),
  revealNsecBtn: document.getElementById("reveal-nsec-btn"),
  copyNsecBtn: document.getElementById("copy-nsec-btn"),
  signoutBtn: document.getElementById("signout-btn"),
  identityHint: document.getElementById("identity-hint"),
  settingsStorage: document.getElementById("settings-storage"),
  settingsCount: document.getElementById("settings-count"),
  settingsUnreadable: document.getElementById("settings-unreadable"),
  changeFolderBtn: document.getElementById("change-folder-btn"),
  useOpfsBtn: document.getElementById("use-opfs-btn"),
  reloadBtn: document.getElementById("reload-btn"),
  backupBtn: document.getElementById("backup-btn"),
  importBtn: document.getElementById("import-btn"),
  storageHint: document.getElementById("storage-hint"),
  themeSelect: document.getElementById("theme-select"),
  deleteAllBtn: document.getElementById("delete-all-btn"),
  appVersion: document.getElementById("app-version"),

  confirmDialog: document.getElementById("confirm-dialog"),
  confirmTitle: document.getElementById("confirm-title"),
  confirmText: document.getElementById("confirm-text"),
  confirmCancel: document.getElementById("confirm-cancel"),
  confirmOk: document.getElementById("confirm-ok"),

  recoveryDialog: document.getElementById("recovery-dialog"),
  recoveryNsec: document.getElementById("recovery-nsec"),
  recoveryNpub: document.getElementById("recovery-npub"),
  copyNsec2Btn: document.getElementById("copy-nsec2-btn"),
  copyNpub2Btn: document.getElementById("copy-npub2-btn"),
  recoveryConfirm: document.getElementById("recovery-confirm"),
  recoveryContinue: document.getElementById("recovery-continue"),
  recoveryDiscard: document.getElementById("recovery-discard"),

  toasts: document.getElementById("toasts"),
  fileInput: document.getElementById("file-input"),
};

const state = {
  identity: null,
  signer: null,
  pendingIdentity: null,
  pendingHandle: null,
  store: null,
  storeHandle: null,
  storeInfo: null,
  notes: new Map(),
  envelopes: new Map(),
  tombstones: {},
  selectedId: null,
  editorId: null,
  draft: null,
  lastSaved: null,
  filter: "",
  mode: "edit",
  unreadable: 0,
  invalid: 0,
  view: "boot",
  saveTimer: 0,
  savePromise: Promise.resolve(),
  nsecRevealed: false,
  nsecTimer: 0,
  listTimer: 0,
};

function toast(message, kind = "info", timeout = 4200) {
  const node = document.createElement("div");
  node.className = `toast toast-${kind}`;
  node.setAttribute("role", kind === "error" ? "alert" : "status");
  node.textContent = message;
  els.toasts.append(node);
  while (els.toasts.children.length > 4) els.toasts.firstElementChild.remove();
  if (timeout > 0) {
    setTimeout(() => {
      node.classList.add("is-leaving");
      setTimeout(() => node.remove(), 220);
    }, timeout);
  }
}

async function copyToClipboard(text, label = "Copied.") {
  const ok = await copyText(text);
  toast(ok ? label : "Could not copy to the clipboard.", ok ? "success" : "error", 2600);
  return ok;
}

function currentNote() {
  return state.selectedId ? state.notes.get(state.selectedId) || null : null;
}

function isEmptyNote(note) {
  return !note || (!String(note.title || "").trim() && !String(note.body || "").trim());
}

function contentSnapshot(note) {
  return `${note.title || ""}\u0000${note.body || ""}`;
}

function tombstoneKey(id) {
  return `${state.identity?.pubkey || ""}:${id}`;
}

function deletedAt(id) {
  return Number(state.tombstones[tombstoneKey(id)] || 0);
}

function markDeleted(id) {
  state.tombstones[tombstoneKey(id)] = Date.now();
  saveTombstones();
}

function loadTombstones() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TOMBSTONE_KEY) || "{}");
    state.tombstones = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    state.tombstones = {};
  }
}

function saveTombstones() {
  try {
    localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(state.tombstones));
  } catch {
    /* ignore */
  }
}

function pruneTombstones() {
  const cutoff = Date.now() - 180 * 24 * 60 * 60 * 1000;
  let changed = false;
  for (const [key, value] of Object.entries(state.tombstones)) {
    if (!Number.isFinite(value) || value < cutoff) {
      delete state.tombstones[key];
      changed = true;
    }
  }
  if (changed) saveTombstones();
}

function opfsSupported() {
  return Boolean(navigator.storage && typeof navigator.storage.getDirectory === "function");
}

function showView(name) {
  const views = {
    boot: els.bootView,
    auth: els.authView,
    storage: els.storageView,
    reconnect: els.reconnectView,
    notes: els.notesView,
  };
  for (const [key, node] of Object.entries(views)) node.hidden = key !== name;
  els.topbar.hidden = name !== "notes";
  state.view = name;
  if (name === "auth") {
    els.nip07Btn.hidden = !nip07Available();
    els.importError.hidden = true;
  }
}

function setBootText(text) {
  els.bootText.textContent = text;
}

function setSaveState(name, text) {
  els.saveStatus.dataset.state = name;
  els.saveText.textContent = text;
}

function updateIdentityUI() {
  if (!state.identity) {
    els.identityChip.hidden = true;
    return;
  }
  const npub = identityNpub(state.identity);
  els.identityChip.hidden = false;
  els.identityLabel.textContent = shortNpub(npub);
  els.identityChip.title = npub;
}

function updateStorageLabel() {
  const info = state.storeInfo;
  if (!info) {
    els.storageLabel.textContent = "Storage";
    return;
  }
  els.storageLabel.textContent = info.kind === "folder" ? info.detail || "Folder" : info.label;
  els.storageLabel.title = `${info.label} — ${info.detail}`;
}

function storageHint(info) {
  if (!info) return "";
  if (info.kind === "folder") {
    return "Files are written to the folder you chose. Keep it backed up, and use the same folder on another device to sync.";
  }
  if (info.kind === "opfs") {
    return "Notes live in this app's private file storage. Export an encrypted backup to move them elsewhere.";
  }
  return "This browser is using fallback storage. Export backups regularly.";
}

function updateFooter() {
  const note = currentNote();
  const words = note ? countWords(note.body) : 0;
  els.wordCount.textContent = `${words} ${words === 1 ? "word" : "words"}`;
}

function renderPreview() {
  const body = els.noteBody.value;
  try {
    els.notePreview.innerHTML = renderMarkdown(body);
  } catch (error) {
    els.notePreview.textContent = "Could not render this Markdown.";
    console.error(error);
  }
}

function setMode(mode, { focus = false } = {}) {
  const preview = mode === "preview";
  state.mode = preview ? "preview" : "edit";
  els.noteBody.hidden = preview;
  els.notePreview.hidden = !preview;
  els.markdownToolbar.hidden = preview;
  els.tabEdit.classList.toggle("is-active", !preview);
  els.tabPreview.classList.toggle("is-active", preview);
  els.tabEdit.setAttribute("aria-selected", String(!preview));
  els.tabPreview.setAttribute("aria-selected", String(preview));
  const label = els.previewBtn.querySelector("span");
  if (label) label.textContent = preview ? "Edit" : "Preview";
  const use = els.previewBtn.querySelector("use");
  if (use) use.setAttribute("href", preview ? "#i-pencil" : "#i-eye");
  if (preview) renderPreview();
  else if (focus) els.noteBody.focus();
}

function fillEditor(note) {
  state.editorId = note.id;
  els.editor.hidden = false;
  els.editorEmpty.hidden = true;
  els.noteTitle.value = note.title;
  els.noteBody.value = note.body;
  setMode("edit", { focus: false });
  updateFooter();
  const saved = state.envelopes.has(note.id);
  setSaveState("saved", saved ? `Saved ${clockTime(note.updatedAt)}` : "Draft");
}

function scheduleListRender() {
  if (state.listTimer) clearTimeout(state.listTimer);
  state.listTimer = setTimeout(() => {
    state.listTimer = 0;
    renderList();
  }, 120);
}

function renderList() {
  const all = sortNotes([...state.notes.values()]);
  const query = state.filter.trim().toLowerCase();
  const notes = query
    ? all.filter((note) => `${note.title}\n${note.body}`.toLowerCase().includes(query))
    : all;

  clearNode(els.noteList);
  for (const note of notes) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "note-card" + (note.id === state.selectedId ? " is-active" : "");
    card.dataset.id = note.id;
    card.setAttribute("role", "listitem");

    const top = document.createElement("div");
    top.className = "note-card-top";
    const title = document.createElement("span");
    title.className = "note-card-title";
    title.textContent = deriveTitle(note);
    const time = document.createElement("span");
    time.className = "note-card-time";
    time.textContent = relativeTime(note.updatedAt);
    time.title = fullDate(note.updatedAt);
    top.append(title, time);

    const excerpt = document.createElement("div");
    excerpt.className = "note-card-excerpt";
    excerpt.textContent = deriveExcerpt(note.body) || "No additional text";

    const meta = document.createElement("div");
    meta.className = "note-card-meta";
    meta.append(svgUse("lock"));
    const metaText = document.createElement("span");
    metaText.textContent = state.envelopes.has(note.id) ? "NIP-44 encrypted" : "Draft";
    meta.append(metaText);

    card.append(top, excerpt, meta);
    card.addEventListener("click", () => {
      void navigateToNote(note.id);
    });
    els.noteList.append(card);
  }

  const total = all.length;
  els.noteCount.textContent = `${total} ${total === 1 ? "note" : "notes"}`;
  const empty = notes.length === 0;
  els.noteList.hidden = empty;
  els.emptyList.hidden = !empty;
  if (empty) {
    els.emptyTitle.textContent = query ? "No matches" : "No notes yet";
    els.emptyText.textContent = query
      ? `Nothing matches “${state.filter.trim()}”.`
      : "Create your first encrypted note.";
    els.emptyNewBtn.hidden = Boolean(query);
  }

  els.unreadableBanner.hidden = state.unreadable === 0;
  if (state.unreadable) {
    els.unreadableBanner.textContent = `${state.unreadable} note file${
      state.unreadable === 1 ? "" : "s"
    } cannot be decrypted with this key. Open Settings for details.`;
  }
  els.invalidBanner.hidden = state.invalid === 0;
  if (state.invalid) {
    els.invalidBanner.textContent = `${state.invalid} file${
      state.invalid === 1 ? " is" : "s are"
    } not a valid NIP44 Notes file and ${
      state.invalid === 1 ? "was" : "were"
    } ignored.`;
  }

  updateStorageLabel();
}

function renderAll() {
  updateIdentityUI();
  renderList();
  updateFooter();
  if (els.settingsDialog.open) fillSettings();
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

async function loadNotes() {
  state.notes.clear();
  state.envelopes.clear();
  state.unreadable = 0;
  state.invalid = 0;
  const listed = await state.store.list();
  state.invalid = listed.invalid || 0;
  let undecryptable = 0;
  const results = await mapLimit(listed.envelopes, 3, async (envelope) => {
    try {
      const note = await decryptEnvelope(envelope, (ciphertext) =>
        state.signer.decrypt(ciphertext),
      );
      return { envelope, note };
    } catch {
      return { envelope, note: null };
    }
  });
  for (const { envelope, note } of results) {
    state.envelopes.set(envelope.id, envelope);
    if (note) state.notes.set(note.id, note);
    else undecryptable++;
  }
  state.unreadable = undecryptable;
  loadTombstones();
}

function scheduleSave(delay = 650) {
  if (state.saveTimer) clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    state.saveTimer = 0;
    void saveCurrent();
  }, delay);
}

async function doSave() {
  const note = currentNote();
  if (!note || !state.store || !state.signer) return;
  const snapshot = contentSnapshot(note);
  if (isEmptyNote(note) && !state.envelopes.has(note.id)) {
    setSaveState("saved", "Draft");
    return;
  }
  if (state.lastSaved?.id === note.id && state.lastSaved.snapshot === snapshot) {
    setSaveState("saved", `Saved ${clockTime(state.lastSaved.at)}`);
    return;
  }

  setSaveState("saving", "Encrypting…");
  const updated = { ...note, updatedAt: Date.now() };
  try {
    const envelope = await encryptNote(updated, (plaintext) => state.signer.encrypt(plaintext));
    if (!state.notes.has(updated.id)) return;
    await state.store.write(updated.id, envelope);
    state.envelopes.set(updated.id, envelope);
    const live = state.notes.get(updated.id);
    if (live) live.updatedAt = updated.updatedAt;
    if (state.draft?.id === updated.id) state.draft = null;
    state.lastSaved = { id: updated.id, snapshot, at: updated.updatedAt };
    const current = state.notes.get(updated.id);
    if (current && contentSnapshot(current) !== snapshot) {
      setSaveState("unsaved", "Unsaved changes");
      scheduleSave(400);
    } else {
      setSaveState("saved", `Saved ${clockTime(updated.updatedAt)}`);
    }
    scheduleListRender();
    updateFooter();
  } catch (error) {
    const tooLarge = String(error?.message || "").includes("too large");
    setSaveState("error", tooLarge ? "Note too large" : "Save failed");
    toast(
      error?.message || "Could not save this note.",
      "error",
      tooLarge ? 8000 : 5000,
    );
  }
}

function saveCurrent() {
  state.savePromise = state.savePromise.then(doSave, doSave);
  return state.savePromise;
}

function flushSave() {
  if (state.saveTimer) {
    clearTimeout(state.saveTimer);
    state.saveTimer = 0;
  }
  if (!state.signer || !state.store || !state.selectedId) return Promise.resolve();
  return saveCurrent();
}

function onEditorInput() {
  const note = currentNote();
  if (!note) return;
  note.title = els.noteTitle.value;
  note.body = els.noteBody.value;
  setSaveState("unsaved", "Unsaved");
  updateFooter();
  scheduleListRender();
  scheduleSave();
}

function discardEmptyDraft(draft, keepId) {
  if (draft && draft.id !== keepId && isEmptyNote(draft) && !state.envelopes.has(draft.id)) {
    state.notes.delete(draft.id);
  }
}

async function openNoteView(id, { fromRoute = false } = {}) {
  const note = state.notes.get(id);
  if (!note) {
    history.replaceState(null, "", "#/");
    await showList({ fromRoute: true });
    return;
  }
  if (state.selectedId && state.selectedId !== id) await flushSave();
  if (state.selectedId === id && state.editorId === id) {
    els.notesView.classList.add("is-editing");
    renderList();
    return;
  }
  discardEmptyDraft(state.draft, id);
  state.selectedId = id;
  if (state.envelopes.has(id)) {
    state.lastSaved = { id, snapshot: contentSnapshot(note), at: note.updatedAt };
    state.draft = null;
  } else {
    state.draft = note;
    state.lastSaved = null;
  }
  els.notesView.classList.add("is-editing");
  fillEditor(note);
  renderList();
  if (!fromRoute && location.hash !== `#/n/${id}`) {
    history.pushState(null, "", `#/n/${id}`);
  }
  if (isEmptyNote(note)) {
    setTimeout(() => {
      if (state.selectedId === id) els.noteTitle.focus();
    }, 40);
  }
  requestAnimationFrame(() => {
    const active = els.noteList.querySelector(".note-card.is-active");
    if (active) active.scrollIntoView({ block: "nearest" });
  });
}

async function showList({ fromRoute = false } = {}) {
  if (state.selectedId) await flushSave();
  discardEmptyDraft(state.draft, null);
  state.selectedId = null;
  state.editorId = null;
  state.draft = null;
  state.lastSaved = null;
  els.notesView.classList.remove("is-editing");
  els.editor.hidden = true;
  els.editorEmpty.hidden = false;
  els.noteTitle.value = "";
  els.noteBody.value = "";
  els.notePreview.innerHTML = "";
  updateFooter();
  renderList();
  if (!fromRoute && location.hash !== "#/") history.pushState(null, "", "#/");
}

async function navigateToNote(id) {
  if (location.hash !== `#/n/${id}`) history.pushState(null, "", `#/n/${id}`);
  await openNoteView(id, { fromRoute: true });
}

async function newNoteAction() {
  if (!state.signer || !state.store) return;
  await flushSave();
  if (state.draft && isEmptyNote(state.draft) && !state.envelopes.has(state.draft.id)) {
    await navigateToNote(state.draft.id);
    return;
  }
  const note = newNote();
  state.notes.set(note.id, note);
  state.draft = note;
  state.lastSaved = null;
  await navigateToNote(note.id);
  setTimeout(() => {
    if (state.selectedId === note.id) els.noteTitle.focus();
  }, 40);
}

function parseRoute() {
  const match = /^#\/n\/([0-9a-f]{8,64})$/.exec(location.hash || "");
  return match ? { name: "note", id: match[1] } : { name: "list" };
}

let routing = false;
let routeAgain = false;

async function routeOnce() {
  const target = parseRoute();
  if (target.name === "note") {
    if (state.notes.has(target.id)) {
      await openNoteView(target.id, { fromRoute: true });
      return;
    }
    history.replaceState(null, "", "#/");
  }
  await showList({ fromRoute: true });
}

async function route() {
  if (!state.store) return;
  if (routing) {
    routeAgain = true;
    return;
  }
  routing = true;
  try {
    do {
      routeAgain = false;
      await routeOnce();
    } while (routeAgain);
  } finally {
    routing = false;
  }
}

async function resolveStorage() {
  let result;
  try {
    result = await prepareStore();
  } catch (error) {
    els.storageError.textContent = error?.message || "Could not open storage.";
    els.storageError.hidden = false;
    showView("storage");
    return;
  }
  if (result.status === "choose") {
    updateStorageChoices();
    showView("storage");
    return;
  }
  if (result.status === "permission") {
    state.pendingHandle = result.handle;
    els.reconnectFolderName.textContent = result.handle?.name
      ? `“${result.handle.name}”`
      : "your notes folder";
    els.reconnectError.hidden = true;
    showView("reconnect");
    return;
  }
  await activateStore(result.store, result.handle, result.warning);
}

function updateStorageChoices() {
  els.chooseFolderBtn.hidden = !folderPickerSupported();
  els.storageError.hidden = true;
}

async function activateStore(store, handle, warning) {
  state.store = store;
  state.storeHandle = handle || null;
  state.storeInfo = store.describe();
  state.pendingHandle = null;
  state.selectedId = null;
  state.editorId = null;
  state.draft = null;
  state.lastSaved = null;
  showView("boot");
  setBootText("Decrypting notes…");
  try {
    await loadNotes();
  } catch (error) {
    toast(`Could not read notes: ${error?.message || error}`, "error", 8000);
  }
  showView("notes");
  updateIdentityUI();
  updateStorageLabel();
  renderAll();
  if (!location.hash) history.replaceState(null, "", "#/");
  await route();
  pruneTombstones();
  void requestPersistentStorage();
  if (warning) toast(warning, "warn", 8000);
}

async function chooseFolderForStorage() {
  els.storageError.hidden = true;
  try {
    const handle = await chooseFolderHandle();
    await saveFolderHandle(handle);
    setStoragePref("folder");
    await activateStore(createFolderStore(handle), handle);
  } catch (error) {
    if (error?.name === "AbortError") return;
    els.storageError.textContent = error?.message || "Could not open that folder.";
    els.storageError.hidden = false;
  }
}

async function useAppStorage() {
  els.storageError.hidden = true;
  try {
    const store = await openOpfsStore();
    setStoragePref("opfs");
    await activateStore(store, null);
  } catch (error) {
    try {
      const store = await useLocalStorageFallback();
      await activateStore(
        store,
        null,
        "Private file storage is unavailable, so notes will use browser storage. Export backups regularly.",
      );
    } catch (fallbackError) {
      els.storageError.textContent =
        fallbackError?.message || error?.message || "Could not open storage.";
      els.storageError.hidden = false;
    }
  }
}

async function reconnectFolder() {
  const handle = state.pendingHandle;
  if (!handle) {
    showView("storage");
    return;
  }
  els.reconnectError.hidden = true;
  const granted = await requestFolderPermission(handle);
  if (!granted) {
    els.reconnectError.textContent =
      "Permission was not granted. Try again, choose another folder, or use app storage.";
    els.reconnectError.hidden = false;
    return;
  }
  await activateStore(createFolderStore(handle), handle);
}

async function reconnectChoose() {
  els.reconnectError.hidden = true;
  try {
    const handle = await chooseFolderHandle();
    await saveFolderHandle(handle);
    setStoragePref("folder");
    await activateStore(createFolderStore(handle), handle);
  } catch (error) {
    if (error?.name === "AbortError") return;
    els.reconnectError.textContent = error?.message || "Could not open that folder.";
    els.reconnectError.hidden = false;
  }
}

async function reconnectOpfs() {
  els.reconnectError.hidden = true;
  try {
    const store = await openOpfsStore();
    setStoragePref("opfs");
    await activateStore(
      store,
      null,
      "Using private app storage. Notes from the old folder were not copied because permission was not granted.",
    );
  } catch (error) {
    els.reconnectError.textContent = error?.message || "Could not open app storage.";
    els.reconnectError.hidden = false;
  }
}

function fillRecovery(identity) {
  els.recoveryNsec.textContent = identityNsec(identity);
  els.recoveryNpub.textContent = identityNpub(identity);
  els.recoveryConfirm.checked = false;
  els.recoveryContinue.disabled = true;
  if (!els.recoveryDialog.open) els.recoveryDialog.showModal();
}

async function enterApp(identity) {
  let signer;
  try {
    signer = makeSigner(identity);
  } catch (error) {
    toast(error?.message || "Your signer is not available.", "error", 7000);
    showView("auth");
    return;
  }
  saveIdentity(identity);
  state.identity = identity;
  state.signer = signer;
  state.pendingIdentity = null;
  showView("boot");
  setBootText("Finding your notes…");
  await resolveStorage();
}

function hideNsec() {
  state.nsecRevealed = false;
  if (state.nsecTimer) clearTimeout(state.nsecTimer);
  state.nsecTimer = 0;
  if (state.identity?.type === "local") {
    els.settingsNsec.textContent = "••••••••••••";
    els.revealNsecBtn.textContent = "Reveal secret";
    els.copyNsecBtn.hidden = true;
  }
}

function toggleNsec() {
  if (state.identity?.type !== "local") return;
  state.nsecRevealed = !state.nsecRevealed;
  if (state.nsecRevealed) {
    els.settingsNsec.textContent = identityNsec(state.identity);
    els.revealNsecBtn.textContent = "Hide secret";
    els.copyNsecBtn.hidden = false;
    if (state.nsecTimer) clearTimeout(state.nsecTimer);
    state.nsecTimer = setTimeout(() => {
      hideNsec();
    }, 30000);
  } else {
    hideNsec();
  }
}

function fillSettings() {
  if (!state.identity) return;
  const npub = identityNpub(state.identity);
  const local = state.identity.type === "local";
  els.settingsNpub.textContent = npub;
  els.settingsNpub.title = npub;
  els.settingsNsec.textContent =
    local && state.nsecRevealed ? identityNsec(state.identity) : "••••••••••••";
  els.revealNsecBtn.hidden = !local;
  els.copyNsecBtn.hidden = !local || !state.nsecRevealed;
  els.revealNsecBtn.textContent = state.nsecRevealed ? "Hide secret" : "Reveal secret";
  els.identityHint.textContent = local
    ? "Your key is stored in this browser. Back it up — without it, notes cannot be decrypted."
    : "Your key is managed by your browser extension. It must support NIP-44 decryption.";

  const info = state.storeInfo;
  els.settingsStorage.textContent = info ? `${info.label} · ${info.detail}` : "…";
  els.settingsStorage.title = els.settingsStorage.textContent;
  els.settingsCount.textContent = String(state.notes.size);

  const problems = [];
  if (state.unreadable) {
    problems.push(
      `${state.unreadable} file${state.unreadable === 1 ? "" : "s"} cannot be decrypted with this key`,
    );
  }
  if (state.invalid) {
    problems.push(
      `${state.invalid} file${state.invalid === 1 ? " is" : "s are"} not valid note files`,
    );
  }
  els.settingsUnreadable.hidden = problems.length === 0;
  els.settingsUnreadable.textContent = problems.length ? problems.join(". ") + "." : "";

  els.changeFolderBtn.hidden = !folderPickerSupported();
  els.useOpfsBtn.hidden = !opfsSupported() || info?.kind === "opfs";
  els.deleteAllBtn.disabled = state.notes.size === 0;
  els.themeSelect.value = loadTheme();
  els.appVersion.textContent = APP_VERSION;
  els.storageHint.textContent = storageHint(info);
}

function openSettings() {
  hideNsec();
  fillSettings();
  if (!els.settingsDialog.open) els.settingsDialog.showModal();
}

function resetSession() {
  if (state.saveTimer) clearTimeout(state.saveTimer);
  state.saveTimer = 0;
  if (state.listTimer) clearTimeout(state.listTimer);
  state.listTimer = 0;
  state.identity = null;
  state.signer = null;
  state.pendingIdentity = null;
  state.pendingHandle = null;
  state.store = null;
  state.storeHandle = null;
  state.storeInfo = null;
  state.notes.clear();
  state.envelopes.clear();
  state.selectedId = null;
  state.editorId = null;
  state.draft = null;
  state.lastSaved = null;
  state.unreadable = 0;
  state.invalid = 0;
  state.filter = "";
  state.savePromise = Promise.resolve();
  els.searchInput.value = "";
  els.clearSearchBtn.hidden = true;
  els.noteTitle.value = "";
  els.noteBody.value = "";
  els.notePreview.innerHTML = "";
  hideNsec();
  updateIdentityUI();
}

function confirmAction({ title, text, okText = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    if (els.confirmDialog.open) {
      resolve(false);
      return;
    }
    let settled = false;
    const cleanup = () => {
      els.confirmOk.removeEventListener("click", onOk);
      els.confirmCancel.removeEventListener("click", onCancel);
      els.confirmDialog.removeEventListener("cancel", onCancel);
      els.confirmDialog.removeEventListener("close", onClose);
    };
    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (els.confirmDialog.open) els.confirmDialog.close();
      resolve(value);
    };
    const onOk = () => finish(true);
    const onCancel = (event) => {
      event?.preventDefault?.();
      finish(false);
    };
    const onClose = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(false);
    };

    els.confirmTitle.textContent = title;
    els.confirmText.textContent = text;
    els.confirmOk.textContent = okText;
    els.confirmOk.classList.toggle("btn-danger", danger);
    els.confirmOk.classList.toggle("btn-primary", !danger);
    els.confirmOk.addEventListener("click", onOk);
    els.confirmCancel.addEventListener("click", onCancel);
    els.confirmDialog.addEventListener("cancel", onCancel);
    els.confirmDialog.addEventListener("close", onClose);
    els.confirmDialog.showModal();
  });
}

async function signOut() {
  const ok = await confirmAction({
    title: "Sign out?",
    text: "Your notes stay encrypted on disk. You will need your secret key to read them again.",
    okText: "Sign out",
    danger: true,
  });
  if (!ok) return;
  await flushSave();
  await state.savePromise.catch(() => {});
  clearIdentity();
  resetSession();
  if (els.settingsDialog.open) els.settingsDialog.close();
  showView("auth");
  toast("Signed out. Your encrypted notes are still on disk.", "info", 5000);
}

async function deleteAllNotes() {
  const count = state.notes.size;
  if (!count) return;
  const ok = await confirmAction({
    title: "Delete all notes?",
    text: `This permanently removes ${count} encrypted note file${
      count === 1 ? "" : "s"
    } from ${state.storeInfo?.label?.toLowerCase() || "storage"}. This cannot be undone.`,
    okText: "Delete all",
    danger: true,
  });
  if (!ok) return;
  if (state.saveTimer) {
    clearTimeout(state.saveTimer);
    state.saveTimer = 0;
  }
  await state.savePromise.catch(() => {});
  try {
    await state.store.clear();
  } catch (error) {
    toast(`Could not delete files: ${error?.message || error}`, "error", 6000);
    return;
  }
  const now = Date.now();
  for (const id of state.envelopes.keys()) {
    state.tombstones[tombstoneKey(id)] = now;
  }
  saveTombstones();
  state.notes.clear();
  state.envelopes.clear();
  state.selectedId = null;
  state.editorId = null;
  state.draft = null;
  state.lastSaved = null;
  els.notesView.classList.remove("is-editing");
  els.editor.hidden = true;
  els.editorEmpty.hidden = false;
  history.replaceState(null, "", "#/");
  renderAll();
  fillSettings();
  toast("All notes deleted.", "success");
}

async function adoptStore(store, handle, pref, message) {
  const previous = state.store;
  let extra = "";
  if (previous && previous !== store) {
    const result = await migrateStore(previous, store);
    extra = ` ${result.copied} note${result.copied === 1 ? "" : "s"} copied`;
    if (result.kept) extra += `, ${result.kept} already present`;
    extra += ".";
  }
  if (pref === "folder") {
    await saveFolderHandle(handle);
    setStoragePref("folder");
  } else {
    setStoragePref(pref);
  }
  state.store = store;
  state.storeHandle = handle || null;
  state.storeInfo = store.describe();
  await loadNotes();
  state.editorId = null;
  if (state.selectedId && state.notes.has(state.selectedId)) {
    fillEditor(state.notes.get(state.selectedId));
  } else if (state.selectedId) {
    state.selectedId = null;
    history.replaceState(null, "", "#/");
    els.notesView.classList.remove("is-editing");
    els.editor.hidden = true;
    els.editorEmpty.hidden = false;
  }
  renderAll();
  fillSettings();
  toast(message + extra, "success", 6500);
}

async function changeFolder() {
  if (!folderPickerSupported()) return;
  try {
    const handle = await chooseFolderHandle();
    await adoptStore(
      createFolderStore(handle),
      handle,
      "folder",
      `Using “${handle.name}”.`,
    );
  } catch (error) {
    if (error?.name === "AbortError") return;
    toast(error?.message || "Could not open that folder.", "error", 6000);
  }
}

async function switchToOpfs() {
  try {
    const store = await openOpfsStore();
    await adoptStore(store, null, "opfs", "Switched to private app storage.");
  } catch (error) {
    toast(error?.message || "Could not open app storage.", "error", 6000);
  }
}

async function reloadFromDisk() {
  await flushSave();
  const selected = state.selectedId;
  try {
    await loadNotes();
  } catch (error) {
    toast(`Could not read notes: ${error?.message || error}`, "error", 6000);
    return;
  }
  state.editorId = null;
  if (selected && state.notes.has(selected)) {
    fillEditor(state.notes.get(selected));
  } else if (selected) {
    state.selectedId = null;
    history.replaceState(null, "", "#/");
    els.notesView.classList.remove("is-editing");
    els.editor.hidden = true;
    els.editorEmpty.hidden = false;
  }
  renderAll();
  fillSettings();
  toast("Reloaded from disk.", "success", 2600);
}

async function exportBackup() {
  await flushSave();
  const envelopes = [...state.envelopes.values()];
  if (!envelopes.length) {
    toast("There are no notes to back up.", "warn");
    return;
  }
  try {
    const result = await exportBackupFile(envelopes, state.signer.pubkey);
    if (result === "cancelled") return;
    toast(
      result === "saved" ? "Encrypted backup saved." : "Encrypted backup downloaded.",
      "success",
      5000,
    );
  } catch (error) {
    toast(error?.message || "Could not export backup.", "error", 6000);
  }
}

async function importEnvelopeList(envelopes) {
  const result = { imported: 0, kept: 0, skipped: 0, failed: 0 };
  for (const envelope of envelopes) {
    if (deletedAt(envelope.id) >= envelope.updatedAt) {
      result.skipped++;
      continue;
    }
    const local = state.envelopes.get(envelope.id);
    if (local && local.updatedAt >= envelope.updatedAt) {
      result.kept++;
      continue;
    }
    let note;
    try {
      note = await decryptEnvelope(envelope, (ciphertext) => state.signer.decrypt(ciphertext));
    } catch {
      result.failed++;
      continue;
    }
    try {
      await state.store.write(note.id, envelope);
    } catch {
      result.failed++;
      continue;
    }
    state.envelopes.set(note.id, envelope);
    state.notes.set(note.id, note);
    result.imported++;
  }
  return result;
}

function looksLikeBackup(text) {
  const trimmed = String(text || "").trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function isMarkdownImport(name, text) {
  const lower = String(name || "").toLowerCase();
  if (/\.(md|markdown)$/.test(lower)) return true;
  if (lower.endsWith(".txt")) return !looksLikeBackup(text);
  return false;
}

async function importFiles() {
  await flushSave();
  try {
    const files = await pickFiles(els.fileInput);
    if (!files.length) return;
    const summary = { imported: 0, kept: 0, skipped: 0, failed: 0, markdown: 0 };
    for (const file of files) {
      try {
        if (isMarkdownImport(file.name, file.text)) {
          const note = noteFromMarkdownFile(file.name, file.text);
          const envelope = await encryptNote(note, (plaintext) =>
            state.signer.encrypt(plaintext),
          );
          await state.store.write(note.id, envelope);
          state.envelopes.set(note.id, envelope);
          state.notes.set(note.id, note);
          summary.markdown++;
        } else {
          const envelopes = parseBackup(file.text);
          const result = await importEnvelopeList(envelopes);
          summary.imported += result.imported;
          summary.kept += result.kept;
          summary.skipped += result.skipped;
          summary.failed += result.failed;
        }
      } catch (error) {
        summary.failed++;
        console.warn("Import failed", file.name, error);
      }
    }
    if (state.selectedId && state.notes.has(state.selectedId)) {
      state.editorId = null;
      fillEditor(state.notes.get(state.selectedId));
    }
    renderAll();
    fillSettings();

    const parts = [];
    if (summary.imported) {
      parts.push(`${summary.imported} encrypted note${summary.imported === 1 ? "" : "s"}`);
    }
    if (summary.markdown) {
      parts.push(`${summary.markdown} Markdown note${summary.markdown === 1 ? "" : "s"}`);
    }
    if (summary.kept) parts.push(`${summary.kept} already current`);
    if (summary.skipped) parts.push(`${summary.skipped} skipped`);
    if (summary.failed) parts.push(`${summary.failed} failed`);
    toast(
      parts.length ? `Imported: ${parts.join(", ")}.` : "Nothing new to import.",
      summary.failed ? "warn" : "success",
      7000,
    );
  } catch (error) {
    if (error?.name === "AbortError") return;
    toast(error?.message || "Could not import files.", "error", 7000);
  }
}

async function copyCurrent() {
  const note = currentNote();
  if (!note) return;
  await copyToClipboard(noteToMarkdown(note), "Markdown copied.");
}

async function exportCurrent() {
  const note = currentNote();
  if (!note) return;
  await flushSave();
  try {
    const result = await exportMarkdownFile(note);
    if (result === "cancelled") return;
    toast(result === "saved" ? "Markdown file saved." : "Markdown file downloaded.", "success");
  } catch (error) {
    toast(error?.message || "Could not export Markdown.", "error", 6000);
  }
}

async function deleteCurrent() {
  const note = currentNote();
  if (!note) return;
  const ok = await confirmAction({
    title: "Delete this note?",
    text: `“${deriveTitle(note)}” will be removed from ${
      state.storeInfo?.label?.toLowerCase() || "storage"
    }. This cannot be undone.`,
    okText: "Delete",
    danger: true,
  });
  if (!ok) return;
  if (state.saveTimer) {
    clearTimeout(state.saveTimer);
    state.saveTimer = 0;
  }
  await state.savePromise.catch(() => {});
  const id = note.id;
  if (state.envelopes.has(id)) {
    markDeleted(id);
    try {
      await state.store.remove(id);
    } catch (error) {
      toast(`Could not delete the file: ${error?.message || error}`, "error", 6000);
      return;
    }
  }
  state.envelopes.delete(id);
  state.notes.delete(id);
  state.selectedId = null;
  state.editorId = null;
  state.draft = null;
  state.lastSaved = null;
  history.replaceState(null, "", "#/");
  els.notesView.classList.remove("is-editing");
  els.editor.hidden = true;
  els.editorEmpty.hidden = false;
  els.noteTitle.value = "";
  els.noteBody.value = "";
  els.notePreview.innerHTML = "";
  renderAll();
  toast("Note deleted.", "success");
}

function surroundSelection(before, after, placeholder) {
  const area = els.noteBody;
  const start = area.selectionStart;
  const end = area.selectionEnd;
  const value = area.value;
  const selected = value.slice(start, end) || placeholder;
  area.value = value.slice(0, start) + before + selected + after + value.slice(end);
  area.focus();
  area.selectionStart = start + before.length;
  area.selectionEnd = start + before.length + selected.length;
  onEditorInput();
}

function prefixLines(prefix) {
  const area = els.noteBody;
  const start = area.selectionStart;
  const end = area.selectionEnd;
  const value = area.value;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  let lineEnd = value.indexOf("\n", end);
  if (lineEnd === -1) lineEnd = value.length;
  const block = value.slice(lineStart, lineEnd);
  const lines = block.split("\n");
  const next = lines.map((line, index) => `${prefix}${line}`).join("\n");
  area.value = value.slice(0, lineStart) + next + value.slice(lineEnd);
  area.focus();
  area.selectionStart = lineStart;
  area.selectionEnd = lineStart + next.length;
  onEditorInput();
}

function insertLink() {
  const area = els.noteBody;
  const start = area.selectionStart;
  const end = area.selectionEnd;
  const value = area.value;
  const label = value.slice(start, end) || "link text";
  const snippet = `[${label}](https://)`;
  area.value = value.slice(0, start) + snippet + value.slice(end);
  area.focus();
  const urlStart = start + label.length + 3;
  area.selectionStart = urlStart;
  area.selectionEnd = urlStart + 8;
  onEditorInput();
}

function applyMarkdown(action) {
  if (state.mode === "preview") setMode("edit", { focus: true });
  switch (action) {
    case "bold":
      surroundSelection("**", "**", "bold text");
      break;
    case "italic":
      surroundSelection("*", "*", "italic text");
      break;
    case "heading":
      prefixLines("## ");
      break;
    case "list":
      prefixLines("- ");
      break;
    case "quote":
      prefixLines("> ");
      break;
    case "code":
      surroundSelection("`", "`", "code");
      break;
    case "link":
      insertLink();
      break;
    default:
      break;
  }
}

function onSearch() {
  state.filter = els.searchInput.value;
  els.clearSearchBtn.hidden = state.filter.length === 0;
  renderList();
}

function setupEvents() {
  els.createKeyBtn.addEventListener("click", () => {
    const identity = createLocalIdentity();
    state.pendingIdentity = identity;
    fillRecovery(identity);
  });

  els.importForm.addEventListener("submit", (event) => {
    event.preventDefault();
    els.importError.hidden = true;
    try {
      const identity = importNsec(els.nsecInput.value);
      els.nsecInput.value = "";
      state.pendingIdentity = identity;
      fillRecovery(identity);
    } catch (error) {
      els.importError.textContent = error?.message || "That key could not be read.";
      els.importError.hidden = false;
    }
  });

  els.nip07Btn.addEventListener("click", async () => {
    try {
      const identity = await connectNip07();
      await enterApp(identity);
    } catch (error) {
      toast(error?.message || "Could not connect to the extension.", "error", 7000);
    }
  });

  els.chooseFolderBtn.addEventListener("click", () => {
    void chooseFolderForStorage();
  });
  els.useAppStorageBtn.addEventListener("click", () => {
    void useAppStorage();
  });
  els.reconnectBtn.addEventListener("click", () => {
    void reconnectFolder();
  });
  els.reconnectChooseBtn.addEventListener("click", () => {
    void reconnectChoose();
  });
  els.reconnectOpfsBtn.addEventListener("click", () => {
    void reconnectOpfs();
  });

  els.newNoteBtn.addEventListener("click", () => {
    void newNoteAction();
  });
  els.emptyNewBtn.addEventListener("click", () => {
    void newNoteAction();
  });

  els.searchInput.addEventListener("input", onSearch);
  els.searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (els.searchInput.value) {
      event.preventDefault();
      els.searchInput.value = "";
      onSearch();
    } else {
      els.searchInput.blur();
    }
  });
  els.clearSearchBtn.addEventListener("click", () => {
    els.searchInput.value = "";
    onSearch();
    els.searchInput.focus();
  });

  els.noteTitle.addEventListener("input", onEditorInput);
  els.noteTitle.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    els.noteBody.focus();
    const end = els.noteBody.value.length;
    els.noteBody.setSelectionRange(end, end);
  });
  els.noteBody.addEventListener("input", onEditorInput);
  els.noteBody.addEventListener("keydown", (event) => {
    if (event.key === "Tab" && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      const start = els.noteBody.selectionStart;
      const end = els.noteBody.selectionEnd;
      const value = els.noteBody.value;
      els.noteBody.value = value.slice(0, start) + "  " + value.slice(end);
      els.noteBody.selectionStart = start + 2;
      els.noteBody.selectionEnd = start + 2;
      onEditorInput();
      return;
    }
    if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === "b") {
      event.preventDefault();
      applyMarkdown("bold");
    } else if (key === "i") {
      event.preventDefault();
      applyMarkdown("italic");
    } else if (key === "k") {
      event.preventDefault();
      applyMarkdown("link");
    }
  });

  els.tabEdit.addEventListener("click", () => setMode("edit", { focus: true }));
  els.tabPreview.addEventListener("click", () => setMode("preview"));
  els.previewBtn.addEventListener("click", () => {
    setMode(state.mode === "preview" ? "edit" : "preview", {
      focus: state.mode === "preview",
    });
  });
  els.markdownToolbar.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("[data-md]") : null;
    if (!button) return;
    applyMarkdown(button.dataset.md);
  });

  els.backBtn.addEventListener("click", () => {
    void showList();
  });
  els.copyBtn.addEventListener("click", () => {
    void copyCurrent();
  });
  els.exportBtn.addEventListener("click", () => {
    void exportCurrent();
  });
  els.deleteBtn.addEventListener("click", () => {
    void deleteCurrent();
  });

  els.identityChip.addEventListener("click", openSettings);
  els.settingsBtn.addEventListener("click", openSettings);
  els.storageLabel.addEventListener("click", openSettings);
  els.unreadableBanner.addEventListener("click", openSettings);
  els.invalidBanner.addEventListener("click", openSettings);

  els.themeBtn.addEventListener("click", () => {
    const next = applyTheme(loadTheme()) === "light" ? "dark" : "light";
    saveTheme(next);
    const resolved = applyTheme(next);
    updateThemeIcon(els.themeBtn, resolved);
    els.themeSelect.value = next;
  });
  els.themeSelect.addEventListener("change", () => {
    const value = els.themeSelect.value;
    saveTheme(value);
    const resolved = applyTheme(value);
    updateThemeIcon(els.themeBtn, resolved);
  });

  els.copyNpubBtn.addEventListener("click", () => {
    if (state.identity) void copyToClipboard(identityNpub(state.identity), "npub copied.");
  });
  els.revealNsecBtn.addEventListener("click", toggleNsec);
  els.copyNsecBtn.addEventListener("click", () => {
    if (state.identity?.type === "local") {
      void copyToClipboard(identityNsec(state.identity), "nsec copied.");
    }
  });
  els.signoutBtn.addEventListener("click", () => {
    void signOut();
  });

  els.changeFolderBtn.addEventListener("click", () => {
    void changeFolder();
  });
  els.useOpfsBtn.addEventListener("click", () => {
    void switchToOpfs();
  });
  els.reloadBtn.addEventListener("click", () => {
    void reloadFromDisk();
  });
  els.backupBtn.addEventListener("click", () => {
    void exportBackup();
  });
  els.importBtn.addEventListener("click", () => {
    void importFiles();
  });
  els.deleteAllBtn.addEventListener("click", () => {
    void deleteAllNotes();
  });

  els.settingsDialog.addEventListener("close", hideNsec);

  els.copyNsec2Btn.addEventListener("click", () => {
    const identity = state.pendingIdentity;
    if (identity) void copyToClipboard(identityNsec(identity), "nsec copied.");
  });
  els.copyNpub2Btn.addEventListener("click", () => {
    const identity = state.pendingIdentity;
    if (identity) void copyToClipboard(identityNpub(identity), "npub copied.");
  });
  els.recoveryConfirm.addEventListener("change", () => {
    els.recoveryContinue.disabled = !els.recoveryConfirm.checked;
  });
  els.recoveryContinue.addEventListener("click", () => {
    if (!els.recoveryConfirm.checked || !state.pendingIdentity) return;
    const identity = state.pendingIdentity;
    state.pendingIdentity = null;
    els.recoveryDialog.close();
    void enterApp(identity);
  });
  els.recoveryDiscard.addEventListener("click", () => {
    state.pendingIdentity = null;
    els.recoveryDialog.close();
    showView("auth");
    toast("Key discarded. Create or import a key to start again.", "info", 5000);
  });
  els.recoveryDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
  });

  els.brandLink.addEventListener("click", (event) => {
    if (state.view !== "notes") return;
    event.preventDefault();
    void showList();
  });

  window.addEventListener("hashchange", () => {
    void route();
  });

  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || anyDialogOpen() || state.view !== "notes") return;
    const mod = event.metaKey || event.ctrlKey;
    if (mod && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === "n" && !event.shiftKey) {
        event.preventDefault();
        void newNoteAction();
        return;
      }
      if (key === "s") {
        event.preventDefault();
        void flushSave().then(() => toast("Saved.", "success", 1500));
        return;
      }
      if (key === "f" && !event.shiftKey) {
        event.preventDefault();
        els.searchInput.focus();
        els.searchInput.select();
        return;
      }
      if (key === "e" || (key === "p" && event.shiftKey)) {
        event.preventDefault();
        void exportCurrent();
        return;
      }
    }
    if (event.key === "/" && !isEditableTarget(event.target)) {
      event.preventDefault();
      els.searchInput.focus();
    }
  });

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!target) return;
      const href = target.getAttribute("href") || "";
      if (href.startsWith("#")) return;
      if (isAndroidApp()) {
        event.preventDefault();
        const url = target.href || href;
        void copyText(url).then((ok) => {
          toast(
            ok ? "Link copied. Paste it into your browser." : "Could not copy the link.",
            ok ? "info" : "error",
            4000,
          );
        });
        return;
      }
      if (!/^(https?:|mailto:)/i.test(target.href)) event.preventDefault();
    },
    true,
  );

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && state.saveTimer) {
      clearTimeout(state.saveTimer);
      state.saveTimer = 0;
      void saveCurrent();
    }
  });
  window.addEventListener("pagehide", () => {
    if (state.saveTimer) {
      clearTimeout(state.saveTimer);
      state.saveTimer = 0;
    }
    void saveCurrent();
  });

  onSystemThemeChange(() => {
    if (loadTheme() !== "system") return;
    const resolved = applyTheme("system");
    updateThemeIcon(els.themeBtn, resolved);
  });

  let installPrompt = null;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    els.installBtn.hidden = false;
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    els.installBtn.hidden = true;
  });
  els.installBtn.addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    try {
      await installPrompt.userChoice;
    } finally {
      installPrompt = null;
      els.installBtn.hidden = true;
    }
  });
  if (window.matchMedia("(display-mode: standalone)").matches) {
    els.installBtn.hidden = true;
  }
}

async function boot() {
  const resolved = applyTheme(loadTheme());
  updateThemeIcon(els.themeBtn, resolved);
  els.themeSelect.value = loadTheme();
  loadTombstones();
  pruneTombstones();
  state.identity = loadIdentity();
  if (!state.identity) {
    showView("auth");
    return;
  }
  try {
    state.signer = makeSigner(state.identity);
  } catch (error) {
    toast(error?.message || "Your signer is not available.", "error", 7000);
    showView("auth");
    return;
  }
  showView("boot");
  await resolveStorage();
}

setupEvents();
void boot();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
