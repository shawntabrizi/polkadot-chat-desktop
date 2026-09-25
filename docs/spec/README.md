# Running chat protocol specification (desktop + pca extensions)

This folder is where protocol ideas for the agent-native chat client are
written and iterated before anything goes to `paritytech/chat-spec`. It is a
running draft, not a fork: every document here is written in the same shape as
`chat-spec/rfcs/0003-message-deletion.md` (Summary, Motivation, Stakeholders,
Explanation, Drawbacks, Testing/Security/Privacy, Compatibility, Unresolved
Questions), so it can be sent upstream as is when it stabilises. Nothing here
is submitted upstream until the owner decides.

## Upstream snapshot (updated 2026-09-24)

These specs are written against `paritytech/chat-spec` main at `134cad7`
(2026-07-31), in `.refs/chat-spec`. Until 2026-09-24 our copy was `7af4fab`
(2026-07-10, branch `rfc/message-deletion`). That copy did not have two RFCs
that main merged on 2026-07-31:

- `rfcs/0001-file-transfer-improvements.md` (RFC-0001): the versioned HOP
  root `VersionedUploadedFile = v1(inline | chunked)`, small files inline,
  and a `bitswap_v1_get` fallback for promoted entries.
- `rfcs/rfc-0004-x25519-chacha20poly1305.md` (RFC-0004): X25519 and
  ChaCha20-Poly1305 replace P-256 and AES-256-GCM in the whole protocol.

`base-spec.md` and `mds.md` are the same in both commits. Their body text
still says P-256 (line ~160, Appendix A) and AES-256-GCM (HOP, lines
~1740–1764). Where the text and the RFCs differ, we follow the RFCs
(`docs/upstream/12-hop-cipher-envelope.md`). `rfcs/0003-message-deletion.md`
is not on main: it is the open pull request chat-spec#5.

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

Provisional kind numbers are in the range 240–254 (`kinds.md`); RFC-0003 takes 21.

## Documents

| File | Status | Implemented in |
|---|---|---|
| `kinds.md` | living | registry of provisional kinds and their fallbacks |
| `efficiency.md` | living | submission-cost rule and the tightenings owed |
| `0003-message-deletion.md` | upstream (chat-spec#5, open; not on main), implemented | desktop M7, pca `desktop/rfc-0003` |
| `0005-typing-and-seen.md` | draft complete; revised 2026-09-23 (typing off by default, seen piggybacks) | desktop M9/M12c, pca `desktop/rfc-0003` |
| `0006-buttons.md` | draft complete | desktop M8, pca `desktop/rfc-0003` |
| `0007-transactions.md` | draft complete 2026-09-23; `tx` action + `transactionReference`; revised 2026-09-23 (one reference per transaction) | desktop M11/M12c, pca `desktop/rfc-0003` |
| `0008-bot-info.md` | v2 (balance hint) complete 2026-09-23 | desktop M10 + M11b, pca `desktop/rfc-0003` |
| `0009-groups.md` | draft complete 2026-09-23 (fan-out v1) | desktop M12, pca `desktop/rfc-0003` |
| `0011-groups-v2.md` | draft 2026-09-24 (private groups: epoch key, one statement per message, privacy levels); review in `docs/review/0011-groups-v2.md` | M16 |
| `0010-bot-directory.md` | draft 2026-09-24 (signed bot cards on a directory topic, kind 251); review in `docs/review/0010-bot-directory.md` | M17 |
| `0012-attachments.md` | implemented M15a–c (Bulletin transaction storage, kind 250); review in `docs/review/0012-attachments.md`; HOP interop decided 2026-09-24 (both paths; see 0013, 0014) | M15 |
| `0013-capabilities.md` | draft 2026-09-24 (per-device `capabilities`, kind 252: kinds bitmap, file variants, HOP dialects, feature bits; sender uses the intersection over the peer's devices; vector in the file) | M20 |
| `0014-bulletin-file-variant.md` | draft 2026-09-24 (0012's file as `FileVariant.bulletin = 1` in `richText`; kind 250 retired after one release); vectors in `vectors-0014.md` | M20 |
