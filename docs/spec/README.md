# Running chat protocol specification (desktop + pca extensions)

This folder is where protocol ideas for the agent-native chat client are
written and iterated before anything goes to `paritytech/chat-spec`. It is a
running draft, not a fork: every document here is written in the same shape as
`chat-spec/rfcs/0003-message-deletion.md` (Summary, Motivation, Stakeholders,
Explanation, Drawbacks, Testing/Security/Privacy, Compatibility, Unresolved
Questions), so it can be sent upstream as is when it stabilises. Nothing here
is submitted upstream until the owner decides.

## Development-mode rule (owner decision, 2026-09-23)

All clients on this protocol are in development. Extension kinds are sent
freely: no capability evidence, no advertisement, no gating. A client that does
not know a kind shows the base spec's unsupported message, and that is accepted
while we iterate. Two things remain:

1. **Rate limits are part of the design**, not a compatibility measure:
   `typing` at most once per 4 s per peer, `seen` at most once per 2 s per peer.
2. **Nothing here reaches the master branch of an existing project**
   (`polkadot-chat-agents`, `chat-spec`, the phone apps). Work lives on
   `desktop/*` branches until the owner merges. This repo is new and keeps its
   own main.

The earlier "receive always, send only after evidence" rule and the
identifier-key capability bitmap are recorded in `docs/roadmap.md` as options
for the upstream submission, when legacy clients will exist.

Provisional kind numbers are in the range 240–249 (`kinds.md`); RFC-0003 takes 21.

## Documents

| File | Status | Implemented in |
|---|---|---|
| `kinds.md` | living | registry of provisional kinds and their fallbacks |
| `0003-message-deletion.md` | upstream (chat-spec), implemented | desktop M7, pca `desktop/rfc-0003` |
| `0005-typing-and-seen.md` | draft complete | desktop M9, pca `desktop/rfc-0003` |
| `0006-buttons.md` | draft complete | desktop M8, pca `desktop/rfc-0003` |
| `0007-transactions.md` | draft complete 2026-09-23; `tx` action + `transactionReference` | desktop M11, pca `desktop/rfc-0003` |
| `0008-bot-info.md` | v2 (balance hint) complete 2026-09-23 | desktop M10 + M11b, pca `desktop/rfc-0003` |
