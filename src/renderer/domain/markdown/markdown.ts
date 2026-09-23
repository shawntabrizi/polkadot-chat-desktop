// Copied from .refs/polkadot-desktop/src/shared/markdown/createMarkdown.ts on 2026-09-23;
// changes: no rich rules (==mark==, spoilers, math, /commands), no highlight.js
// or KaTeX (not allowed dependencies), no code-block Copy button, no `plain()`.

/**
 * Message text to sanitized HTML. markdown-it with raw HTML off (a message is
 * data, not markup: an LLM reply that says `Vec<T>` keeps its `<T>`), linkify
 * on and breaks on (a newline in a chat message is a line break). No images:
 * a message must not make the app fetch an arbitrary URL, so `![alt](url)` is
 * a link. Links open outside the app (main's window-open handler). DOMPurify
 * then removes anything that is not plain markup, as a second layer.
 */

import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';

const NOOPENER = 'noopener noreferrer';

export const markdownToHtml = (() => {
  const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false });
  const escape = md.utils.escapeHtml;
  md.renderer.rules['image'] = (tokens, idx) => {
    const token = tokens[idx];
    if (!token) return '';
    const src = String(token.attrGet('src') ?? '');
    return `<a href="${escape(src)}" target="_blank" rel="${NOOPENER}">${escape(token.content || src)}</a>`;
  };
  const renderLink =
    md.renderer.rules['link_open'] ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules['link_open'] = (tokens, idx, options, env, self) => {
    tokens[idx]?.attrSet('target', '_blank');
    tokens[idx]?.attrSet('rel', NOOPENER);
    return renderLink(tokens, idx, options, env, self);
  };
  return (text: string): string => md.render(text);
})();

type Sanitize = (html: string) => string;
let sanitize: Sanitize | undefined;

// Created on first use, not at import: a node-environment spec that imports
// this module has no `window`.
const getSanitize = (): Sanitize => {
  if (sanitize) return sanitize;
  const purify = DOMPurify(window);
  // An unsupported DOMPurify returns its input unchanged; fail loud instead.
  if (!purify.isSupported) throw new Error('[markdown] DOMPurify does not support this DOM');
  sanitize = html => purify.sanitize(html, { USE_PROFILES: { html: true }, ADD_ATTR: ['target'] });
  return sanitize;
};

/** Sanitized HTML for one message. Whitespace-only text renders nothing. */
export const renderMarkdown = (text: string): string => (text.trim() === '' ? '' : getSanitize()(markdownToHtml(text)));
