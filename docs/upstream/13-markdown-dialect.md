# Markdown: pin the dialect of RichText text, and render own messages the same way

Board mission: M2 Bot-native app

Status: Prototyped in polkadot-chat-desktop (commit b5cbe5d) and polkadot-chat-agents (branch desktop/rfc-0003).

This adds evidence to the existing board item on the markdown dialect.

## Problem

- The base spec says only `text: String? // markdown based text` (`RichText`). It does not say which markdown.
- Two Parity clients already differ:
  - polkadot-desktop renders a large set: CommonMark, GFM tables and strikethrough, task lists, LaTeX math, highlighted code, `==mark==`, `||spoiler||`, named inline tags, `<details>` blocks and tappable `/commands`.
  - This prototype renders a smaller set (below).
  - The phone apps: **not checked**.
- Bots and AI agents write markdown without being asked. What a person sees depends on the client.

## Proposed change (text only, no new wire)

Pin a CommonMark subset as the meaning of `RichText.text`. The set this prototype renders, as a starting point:

- CommonMark blocks and inlines: paragraphs, headings, emphasis, strong, inline code, fenced code, block quotes, ordered and unordered lists, links, thematic breaks.
- GFM tables and strikethrough.
- **A newline is a line break** (chat, not documents).
- Bare URLs become links.
- **Raw HTML is off.** A message is data, not markup: an LLM reply that says `Vec<T>` keeps its `<T>`.
- **Images render as links.** A message must not make the reader's client fetch an arbitrary URL.
- Links open outside the app (in the system browser).
- A client that does not render markdown shows the text as it is. The subset is chosen so that the plain text stays readable.

Extensions (math, spoilers, `/commands`, task lists) could be a named optional tier.

## What the prototype learned

- **Own messages must render too.** The first build rendered markdown only for incoming messages. A sender saw `**bold**` while the peer saw **bold**. The owner asked for the same rendering on both sides, and the prototype now does it. The spec should say that a client renders its own sent text the same way as a peer's.
- **Chat-list previews** strip the marks (a list item or `**bold**` reads as text).
- **Other proposals rely on it.** The menu-as-text fallback (proposal 03) uses a numbered list. The "ask to resend" convention (proposal 07) uses a link with a fragment (`#resend/<messageId>`), which is inert on click.
- **Streaming.** While a bot's reply streams, a half-written fence must not flash as text. The prototype holds back a partial fence until it closes.
- Implementation: markdown-it 15 with HTML off, linkify and breaks on, then DOMPurify as a second layer.

## Clients that do not support it

- No wire change. A client that renders nothing shows the raw text, which the subset keeps readable.

## Open questions

1. Which subset is the base, and which parts are an optional tier?
2. Should the spec forbid images, or allow them behind a tap?
3. What does a phone app render today? (**not checked**)

Decision wanted: adopt, adopt with changes, or reject. React 👍/👎 or comment.
