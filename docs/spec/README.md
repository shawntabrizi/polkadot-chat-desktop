# Running chat protocol specification (desktop + pca extensions)

This folder is where protocol ideas for the agent-native chat client are
written and iterated before anything goes to `paritytech/chat-spec`. It is a
running draft, not a fork: every document here is written in the same shape as
`chat-spec/rfcs/0003-message-deletion.md` (Summary, Motivation, Stakeholders,
Explanation, Drawbacks, Testing/Security/Privacy, Compatibility, Unresolved
Questions), so it can be sent upstream as is when it stabilises. Nothing here
is submitted upstream until the owner decides.

## Compatibility rule for every extension

The phone apps render an unknown content kind as an "Unsupported message
content. Please update the app." bubble. So:

1. **Receiving an extension is always safe** and always implemented.
2. **Sending an extension kind to a peer is allowed only after that peer has
   sent one to us** on the same pairwise session (capability by evidence), or
   the operator has enabled it explicitly for testing. Until then a client
   falls back to what the base spec offers (for deletion: nothing; for typing:
   nothing; for buttons: the plain text fallback carried in the message).
3. **Every extension message carries a plain-text fallback** where one makes
   sense (buttons: the menu as text), so an old client that shows the bubble
   still shows something useful once upstream assigns the kind.
4. **Provisional kind numbers** are in the range 240–249 and are listed in
   `kinds.md`; RFC-0003 takes 21 (20 is DeviceChatAccepted).

## Documents

| File | Status | Implemented in |
|---|---|---|
| `kinds.md` | living | registry of provisional kinds and their fallbacks |
| `0003-message-deletion.md` | upstream (chat-spec), implemented | desktop M7, pca `desktop/rfc-0003` |
| `0005-typing-and-seen.md` | draft written 2026-09-23 | to implement in M8 |
| `0006-buttons.md` | draft written 2026-09-23 (action kinds command, callback, url; `tx` reserved) | to implement in M9 |
| `0007-bot-manifest.md` | to write in M10 | |
