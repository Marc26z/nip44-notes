import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { initMarkdown, renderMarkdown } from "../src/markdown.js";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
initMarkdown(dom.window);

test("renders Markdown structure", () => {
  const html = renderMarkdown("# Title\n\n**bold** and *italic*\n\n- one\n- two\n\n> quote\n\n`code`");
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<blockquote>/);
  assert.match(html, /<code>code<\/code>/);
});

test("sanitizes scripts, handlers, and unsafe URLs", () => {
  const html = renderMarkdown(
    [
      "<script>alert(1)</script>",
      '<img src="https://example.com/a.png" onerror="alert(1)">',
      "[bad](javascript:alert(1))",
      "<iframe src=\"https://evil.example\"></iframe>",
      '<a href="https://example.com" onclick="alert(1)">good</a>',
    ].join("\n\n"),
  );
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /onerror/i);
  assert.doesNotMatch(html, /onclick/i);
  assert.doesNotMatch(html, /javascript:/i);
  assert.doesNotMatch(html, /<iframe/i);
  assert.match(html, /href="https:\/\/example.com"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /src="https:\/\/example.com\/a.png"/);
  assert.match(html, /loading="lazy"/);
});

test("keeps safe data images and disables task checkboxes", () => {
  const html = renderMarkdown(
    "![dot](data:image/png;base64,iVBORw0KGgo=)\n\n- [x] done\n- [ ] todo",
  );
  assert.match(html, /src="data:image\/png;base64,/);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /disabled/);
});

test("empty Markdown renders nothing", () => {
  assert.equal(renderMarkdown(""), "");
  assert.equal(renderMarkdown("   \n"), "");
});

test("renders resolved wikilinks as internal note links", () => {
  const resolveWikilink = (target) =>
    target.toLowerCase() === "alpha" ? { id: "abcdef0123456789", title: "Alpha" } : null;
  const html = renderMarkdown("See [[Alpha]] and [[Alpha|the alpha note]].", {
    resolveWikilink,
  });
  assert.match(html, /<a class="wikilink" href="#\/n\/abcdef0123456789"/);
  assert.match(html, />the alpha note<\/a>/);
  assert.doesNotMatch(html, /target="_blank"/);
});

test("wikilinks with headings are labelled and aliases win", () => {
  const resolveWikilink = () => ({ id: "abcdef0123456789", title: "Alpha" });
  const heading = renderMarkdown("[[Alpha#Details]]", { resolveWikilink });
  assert.match(heading, />Alpha › Details<\/a>/);
  const alias = renderMarkdown("[[Alpha#Details|read this]]", { resolveWikilink });
  assert.match(alias, />read this<\/a>/);
});

test("missing wikilinks lead to creating a note", () => {
  const html = renderMarkdown("[[New Note]]");
  assert.match(html, /class="wikilink is-missing"/);
  assert.match(html, /href="#\/new\?title=New%20Note"/);
  assert.match(html, /title="Create “New Note”"/);
});

test("wikilink syntax inside code stays literal", () => {
  const html = renderMarkdown("`[[Not a link]]`\n\n```\n[[Still code]]\n```");
  assert.doesNotMatch(html, /class="wikilink/);
  assert.match(html, /\[\[Not a link\]\]/);
  assert.match(html, /\[\[Still code\]\]/);
});
