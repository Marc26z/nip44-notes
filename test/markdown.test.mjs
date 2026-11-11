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
