import { createBackup, noteToMarkdown, slugify } from "./core.js";

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function todayStamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export async function saveTextFile({ name, text, mime = "text/plain", description = "File" }) {
  if (typeof window.showSaveFilePicker === "function") {
    try {
      const extension = name.includes(".") ? "." + name.split(".").pop() : "";
      const handle = await window.showSaveFilePicker({
        suggestedName: name,
        types: extension
          ? [{ description, accept: { [mime]: [extension] } }]
          : undefined,
      });
      const writable = await handle.createWritable();
      try {
        await writable.write(text);
      } finally {
        await writable.close();
      }
      return "saved";
    } catch (error) {
      if (error?.name === "AbortError") return "cancelled";
      if (error?.name !== "SecurityError" && error?.name !== "NotAllowedError") throw error;
    }
  }
  downloadBlob(new Blob([text], { type: mime }), name);
  return "downloaded";
}

export async function exportBackupFile(envelopes, pubkey) {
  const backup = createBackup(envelopes, pubkey);
  return saveTextFile({
    name: `nip44-notes-backup-${todayStamp()}.json`,
    text: JSON.stringify(backup, null, 2) + "\n",
    mime: "application/json",
    description: "NIP44 Notes encrypted backup",
  });
}

export async function exportMarkdownFile(note) {
  const title = (note.title || "").trim() || "note";
  return saveTextFile({
    name: `${slugify(title)}.md`,
    text: noteToMarkdown(note),
    mime: "text/markdown",
    description: "Markdown note",
  });
}

export async function pickFiles(input) {
  if (typeof window.showOpenFilePicker === "function") {
    try {
      const handles = await window.showOpenFilePicker({
        multiple: true,
        types: [
          {
            description: "NIP44 Notes, backups, and Markdown",
            accept: {
              "application/json": [".json", ".nip44"],
              "text/markdown": [".md", ".markdown"],
              "text/plain": [".txt"],
            },
          },
        ],
      });
      return Promise.all(
        handles.map(async (handle) => {
          const file = await handle.getFile();
          return { name: file.name, text: await file.text() };
        }),
      );
    } catch (error) {
      if (error?.name === "AbortError") return [];
      throw error;
    }
  }

  return new Promise((resolve) => {
    let settled = false;

    const finish = async (files) => {
      if (settled) return;
      settled = true;
      input.removeEventListener("change", onChange);
      window.removeEventListener("focus", onFocus);
      input.value = "";
      resolve(
        await Promise.all(
          files.map(async (file) => ({ name: file.name, text: await file.text() })),
        ),
      );
    };

    const onChange = () => {
      void finish(Array.from(input.files || []));
    };

    const onFocus = () => {
      setTimeout(() => {
        if (!settled && !input.files?.length) void finish([]);
      }, 800);
    };

    input.addEventListener("change", onChange);
    window.addEventListener("focus", onFocus);
    input.click();
  });
}
