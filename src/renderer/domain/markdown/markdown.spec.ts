import { describe, expect, it } from 'vitest';

import { markdownToHtml } from './markdown';

// The LLM's reply is untrusted text shown in the app's own page. These check
// the first layer (markdown-it); DOMPurify, the second, needs a DOM.
describe('markdownToHtml', () => {
  it('renders the markdown an assistant writes', () => {
    const html = markdownToHtml('**bold** and `code`\n\n- one\n- two');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<li>one</li>');
  });

  it('shows raw HTML as text, so a reply cannot inject markup', () => {
    const html = markdownToHtml('<img src=x onerror=alert(1)> Vec<T>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html).toContain('Vec&lt;T&gt;');
  });

  it('makes a pasted group invite link clickable (main opens it in the app), and no other polkadotapp text', () => {
    expect(markdownToHtml('join us: polkadot-chat://g#AAEC_-x9')).toContain('<a href="polkadot-chat://g#AAEC_-x9" target="_blank" rel="noopener noreferrer">');
    // The M16b form, for one release: links already shared still open.
    expect(markdownToHtml('join us: polkadotapp://g#AAEC_-x9')).toContain('<a href="polkadotapp://g#AAEC_-x9" target="_blank" rel="noopener noreferrer">');
    expect(markdownToHtml('polkadotapp://pair?handshake=00')).not.toContain('<a ');
  });

  it('turns an image into a link, so a reply cannot make the app fetch a URL', () => {
    const html = markdownToHtml('![logo](https://example.com/a.png)');
    expect(html).not.toContain('<img');
    expect(html).toContain('<a href="https://example.com/a.png" target="_blank" rel="noopener noreferrer">logo</a>');
  });

  it("renders a contact's message as markdown and strips raw HTML, as Room.tsx shows it", () => {
    const html = markdownToHtml('**bold** <script>alert(1)</script>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).not.toContain('<script');
  });

  it('opens links outside the app and refuses javascript: links', () => {
    expect(markdownToHtml('[x](https://example.com)')).toContain('target="_blank" rel="noopener noreferrer"');
    expect(markdownToHtml('[x](javascript:alert(1))')).not.toContain('href="javascript:');
  });
});
