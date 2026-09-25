# HOP attachments: fold RFC-0001 and RFC-0004 into the base spec text

Board mission: M3 Protocol foundations

Status: Prototyped in polkadot-chat-desktop (commit b5cbe5d) and polkadot-chat-agents (branch desktop/rfc-0003).

## Problem

Three sources describe HOP attachments in three ways:

| Source | Cipher | Pool entry |
|---|---|---|
| `base-spec.md` body on main (v0.16, "Message Attachments", lines ~1740–1791) | AES-256-GCM | bare `UploadedFile { totalSize, chunks }` |
| RFC-0001 and RFC-0004, merged 2026-07-31 (chat-spec#3, #6) | ChaCha20-Poly1305, key `khash(ticket, b"encryption")` | versioned `VersionedUploadedFile = v1(inline \| chunked)` |
| The shipped phone apps | ChaCha20-Poly1305 | `V1(Inline \| Chunked{totalSize, chunks})` |
| t3ams standalone (`develop` 952b2870, 2026-07-25) | AES-256-GCM, per-file ticket | not checked |

- The RFCs and the phones agree. The base spec body was not updated, so a new implementer who reads only `base-spec.md` builds the wrong cipher and the wrong envelope. Appendix A still describes P-256 and AES-GCM for statements too.
- We built from the base spec text first and had to find the phones' format in the app code.
- Correction to our own drafts: our research notes said "RFC 0001 is not in chat-spec". That was true of our local copy (7af4fab, 2026-07-10), not of main.

## Proposed change (text only, no new wire)

1. Fold RFC-0001 and RFC-0004 into `base-spec.md` and `mds.md`, or mark the old sections as superseded with a link.
2. Name the envelope once. RFC-0001 calls it `VersionedUploadedFile`; the Android code calls it `VersionedHopPoolEntry`. We believe the bytes are the same (**unverified** beyond the live photo test below).
3. Say what t3ams should do: move to ChaCha20-Poly1305 (RFC-0004 is a flag day), or keep AES-GCM as a named second dialect.

## What the prototype learned

- The desktop and pca speak two HOP dialects: `rfc0004-chacha` (the RFCs and the phones: ChaCha20-Poly1305 and the versioned envelope; our old label was `legacy`) and `aesgcm` (the old base spec text and t3ams; old label `aesGcm`).
- **Live.** A photo from the owner's phone opened on the desktop, and a desktop photo opened on the phone, in the phones' dialect.
- A `P2PMixnetFile` does not say which cipher was used. A receiver tries one, then the other; the AEAD tag tells.
- Our capabilities draft (proposal 01) has a `hopDialects` field only because of this split. If the spec text and t3ams follow RFC-0004, that field can go.
- Our Bulletin and group drafts (proposals 06, 07) chose AES-256-GCM "to match the base spec text". After RFC-0004 they should use ChaCha20-Poly1305.
- The RFC texts have two loose ends. RFC-0001 was written before RFC-0004 and still says "AES key" and "AES-GCM" in its upload flow and drawbacks; RFC-0004 §3 item 3 governs. RFC-0001's Drawbacks and Compatibility cite a "try-versioned-then-legacy decode rule above", but its "Legacy blobs" section says no legacy fallback should be built.
- pca's sender still wrote the bare root in our e2e on 2026-09-24 (ChaCha20-Poly1305, plain `UploadedFile`), which RFC-0001 replaced. The desktop reads both.

## Clients that do not support it

- No wire change. A text fix only.
- Until t3ams moves, a phone and a t3ams standalone client probably cannot open each other's HOP files (inferred from the ciphers; not tested).

## Open questions

1. Who owns updating the base spec text after an RFC merges?
2. Does t3ams follow RFC-0004, or should the spec name AES-GCM as a second dialect?
3. Should `P2PMixnetFile` name its cipher, or is the flag day enough?

Decision wanted: adopt, adopt with changes, or reject. React 👍/👎 or comment.
