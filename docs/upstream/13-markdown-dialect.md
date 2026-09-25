# Board comment: markdown dialect for RichTextContent.text

Not an issue. Post the text below as a comment on the board item "chat-spec · Rendering — Pin the markdown dialect for RichTextContent.text" (M3 Protocol foundations). It is evidence and a proposed subset.

Related board item: "clients · Rendering — Render a markdown subset in chat bubbles" (M2). The same comment can be linked there.

---

Evidence from the polkadot-chat-desktop prototype, for pinning the markdown dialect of `RichTextContent.text`. The base spec says only `text: String? // markdown based text`.

**What the prototype renders** (`src/renderer/domain/markdown/markdown.ts`: markdown-it 15.0.1, default preset, then DOMPurify 3.4.14 as a second layer):

- CommonMark blocks and inlines: paragraphs, headings, emphasis, strong, inline code, fenced and indented code, block quotes, ordered and unordered lists, links, thematic breaks.
- GFM tables and strikethrough (both in markdown-it's default preset).
- A newline is a line break (`breaks: true`). Chat, not documents.
- Bare URLs become links (`linkify: true`), plus our group invite links (`polkadot-chat://g#…`).
- **Raw HTML is off** (`html: false`). A message is data, not markup: an LLM reply that says `Vec<T>` keeps its `<T>`.
- **Images render as links.** A message must not make the reader's client fetch an arbitrary URL.
- Links open outside the app. `javascript:` links are refused.
- No typographer (quotes and dashes stay as typed). No math, spoilers, `==mark==`, task lists, `<details>` or tappable `/commands`.

**Own messages render the same way.** The first build rendered markdown only for incoming messages. A sender saw `**bold**` while the peer saw **bold**. Own bubbles now use the same renderer, with an inverted colour set. Replies and quotes stay plain on both sides. The composer draft stays raw, and the chat-list preview strips the marks. We suggest the spec says: "A client renders its own sent text the same way as a peer's."

**Streaming.** While a bot's reply streams, a half-written ```` ```buttons ```` fence is held back until it closes, so raw JSON does not flash. Ordinary code fences render as code while they stream.

**What other clients render** (from reading the app code; not tested on a live phone):

- Android: no markdown. Plain text and links. **Unverified** on a device.
- iOS: inline markdown only (Apple's parser). No block elements. **Unverified** on a device.
- Polkadot Desktop: a large set: CommonMark, GFM tables and strikethrough, task lists, LaTeX math, highlighted code with Copy, `==mark==`, `||spoiler||`, `<details>`, and `/commands` as tappable buttons.

So one bot reply looks three different ways today. Bots and AI agents write markdown without being asked.

**Proposed base subset** (the text stays readable where a client renders nothing):

1. CommonMark: paragraphs, headings, emphasis, strong, inline code, fenced code, block quotes, lists, links, thematic breaks.
2. GFM tables and strikethrough.
3. A newline is a line break.
4. Bare URLs become links.
5. Raw HTML is shown as text, never rendered.
6. Images are shown as links, never fetched without a tap.
7. A client renders its own messages the same way as a peer's.

An optional tier, named in the spec so clients agree on the syntax: math, spoilers, task lists, `/commands`.

Other drafts rely on it: the menu-as-text fallback for buttons uses a numbered list, and "Ask to resend" uses a link with the fragment `#resend/<messageId>`, which is inert when tapped.

Questions for the maintainers:

1. Is the base subset above right? Yes / change it.
2. Images: forbidden, or allowed behind a tap? Choose one.
3. Should Android and iOS render the base subset? Yes / no.

Built in polkadot-chat-desktop: renderer 05e28f8 (M4), own messages c829af4.
