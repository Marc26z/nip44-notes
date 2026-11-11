import { marked } from "marked";
import DOMPurify from "dompurify";

marked.use({
  gfm: true,
  breaks: false,
  pedantic: false,
});

const TAGS = [
  "a", "p", "br", "em", "strong", "del", "code", "pre", "blockquote",
  "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "hr",
  "table", "thead", "tbody", "tr", "th", "td", "img", "input",
  "sup", "sub", "span", "div", "details", "summary", "kbd",
];

const ATTRS = [
  "href", "title", "src", "alt", "class", "type", "checked", "disabled",
  "start", "colspan", "rowspan", "loading", "decoding", "referrerpolicy",
  "target", "rel", "align",
];

let purifier = null;
let hooksInstalled = false;

function safeHref(value) {
  const href = String(value || "").trim();
  if (!href) return false;
  if (href.startsWith("#")) return true;
  try {
    const url = new URL(href, "https://notes.invalid/");
    return ["http:", "https:", "mailto:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function safeImage(value) {
  const src = String(value || "").trim();
  if (!src) return false;
  if (/^data:image\/(png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i.test(src)) return true;
  try {
    const url = new URL(src, "https://notes.invalid/");
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function installHooks(instance) {
  if (hooksInstalled) return;
  hooksInstalled = true;
  instance.addHook("afterSanitizeAttributes", (node) => {
    const tag = node.tagName?.toLowerCase();
    if (tag === "a") {
      const href = node.getAttribute("href");
      if (href && !safeHref(href)) {
        node.removeAttribute("href");
      } else if (href) {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
    } else if (tag === "img") {
      const src = node.getAttribute("src");
      if (!src || !safeImage(src)) {
        node.remove();
        return;
      }
      node.setAttribute("loading", "lazy");
      node.setAttribute("decoding", "async");
      node.setAttribute("referrerpolicy", "no-referrer");
    } else if (tag === "input") {
      if (node.getAttribute("type") !== "checkbox") {
        node.remove();
        return;
      }
      node.setAttribute("disabled", "");
    }
  });
}

function ensurePurifier() {
  if (!purifier) {
    if (typeof window === "undefined") {
      throw new Error("Markdown rendering needs a browser window");
    }
    purifier = DOMPurify(window);
    installHooks(purifier);
  }
  return purifier;
}

export function initMarkdown(win) {
  purifier = DOMPurify(win);
  hooksInstalled = false;
  installHooks(purifier);
}

export function renderMarkdown(markdown) {
  const text = String(markdown ?? "");
  if (!text.trim()) return "";
  const html = marked.parse(text, { async: false });
  return ensurePurifier().sanitize(String(html), {
    ALLOWED_TAGS: TAGS,
    ALLOWED_ATTR: ATTRS,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ["style", "script", "iframe", "object", "embed", "form", "svg", "math"],
    USE_PROFILES: { html: true },
  });
}
