export const $ = (selector, root = document) => root.querySelector(selector);

export function el(id) {
  return document.getElementById(id);
}

export function shortNpub(npub) {
  if (!npub) return "";
  if (npub.length <= 18) return npub;
  return `${npub.slice(0, 10)}…${npub.slice(-6)}`;
}

export function isAndroidApp() {
  try {
    return window.NativeBridge?.getPlatform?.() === "android";
  } catch {
    return false;
  }
}

export function isMobileLayout() {
  return window.matchMedia("(max-width: 860px)").matches;
}

export async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "-1000px";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

const THEME_KEY = "nip44notes.theme.v1";

export function loadTheme() {
  const value = localStorage.getItem(THEME_KEY);
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function saveTheme(value) {
  localStorage.setItem(THEME_KEY, value);
}

export function resolveTheme(value) {
  if (value === "light" || value === "dark") return value;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applyTheme(value) {
  const resolved = resolveTheme(value);
  document.documentElement.dataset.theme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = resolved === "light" ? "#f6f2e9" : "#0d0f15";
  return resolved;
}

export function onSystemThemeChange(callback) {
  const media = window.matchMedia("(prefers-color-scheme: light)");
  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", callback);
  } else if (typeof media.addListener === "function") {
    media.addListener(callback);
  }
}

export function updateThemeIcon(button, resolved) {
  const use = button.querySelector("use");
  if (use) use.setAttribute("href", resolved === "light" ? "#i-moon" : "#i-sun");
  button.setAttribute("aria-label", resolved === "light" ? "Switch to dark theme" : "Switch to light theme");
  button.title = button.getAttribute("aria-label");
}

export function setText(node, text) {
  if (node) node.textContent = text;
}

export function clearNode(node) {
  while (node && node.firstChild) node.removeChild(node.firstChild);
}

export function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function icon(name, className = "") {
  return `<svg class="icon ${className}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

export function svgUse(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** power).toFixed(power === 0 ? 0 : 1)} ${units[power]}`;
}

export function isEditableTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export function anyDialogOpen() {
  return Boolean(document.querySelector("dialog[open]"));
}
