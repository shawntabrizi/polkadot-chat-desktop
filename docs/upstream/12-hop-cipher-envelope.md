# HOP attachments: fold RFC-0001 and RFC-0004 into the base spec text

Board mission: M3 Protocol foundations

Related board items: "RFC 0001: file transfer api improvements" and "RFC 0004: Change P-256+AES to X25519+ChaChaPoly1305" (both Done). This issue is the follow-up text work they left.

## Problem

Four sources describe HOP attachments in three ways:

| Source | Cipher | Pool entry |
|---|---|---|
| `base-spec.md` body on main 134cad7 (v0.16, "Message Attachments", lines ~1740–1791) | AES-256-GCM | bare `UploadedFile { totalSize, chunks }` |
| RFC-0001 and RFC-0004, merged 2026-07-31 (chat-spec#3, #6) | ChaCha20-Poly1305, key `khash(ticket, b"encryption")` | versioned `VersionedUploadedFile = v1(inline \| chunked)` |
| The shipped phone apps | ChaCha20-Poly1305 | `V1(Inline \| Chunked{totalSize, chunks})` |
| t3ams standalone (`develop` 952b2870, 2026-07-25) | AES-256-GCM, per-file ticket | not checked |

- The RFCs and the phones agree. The base spec body was not updated. A new implementer who reads only `base-spec.md` builds the wrong cipher and the wrong envelope. Line ~160 and Appendix A still say P-256 and AES-GCM for statements too.
- We built from the base spec text first, and had to find the phones' format in the app code.
- Correction to our own earlier notes: they said "RFC 0001 is not in chat-spec". That was true of our stale local copy (7af4fab, 2026-07-10), not of main.

## What we implemented

- The desktop and pca read two HOP dialects: `rfc0004-chacha` (the RFCs and the phones) and `aesgcm` (the old base-spec text and t3ams). A `P2PMixnetFile` does not name its cipher, so a receiver tries one, then the other; the AEAD tag tells.
- The desktop sends only `rfc0004-chacha`, in the phones' envelope: small files inline in `V1(Inline)`, larger ones in 2,000,000-byte chunks with a `V1(Chunked)` root.
- **The RFC-0001 chain fallback.** On a claim `NotFound`, the desktop asks the node's `bitswap_v1_get`, then Bulletin, for each entry by its blake2b-256 CID. It checks the hash before decryption, never acks a chain read, and retries for 24 h from the first failure (backoff 10 s doubling to 10 min; the RFC recommends up to 1 h).

Why: we follow the RFCs where they and the base-spec text differ, because the phones follow the RFCs. We keep reading `aesgcm` only so that t3ams files open.

## Cost

- **No wire change.** A text fix only.
- **Receive cost of two dialects:** at most one failed AEAD attempt per file. Not measured; it is one decryption of the root.
- **Chain fallback:** at most about 150 attempts in 24 h per missing file, each one claim plus two small reads. No submissions.

## What it gives the user

- Photos between the phones and the desktop, both ways. Live test with the owner's phone, 2026-09-24.
- A file that a node promoted to the chain still opens after 24 h, as RFC-0001 requires. Shown live only up to the chain request: an acked entry is deleted without promotion, and promotion runs only near the 24 h expiry.
- New implementers build the right format from the spec alone, once the text is fixed.

## Clients that do not support it

- Until t3ams moves, a phone and a t3ams standalone client probably cannot open each other's HOP files. Inferred from the ciphers; not tested.
- Our capabilities draft (proposal 01) has a `hopDialects` field only because of this split. If t3ams follows RFC-0004, that field can go.

## Loose ends in the RFC texts

- RFC-0001 was written before RFC-0004. It still says "AES key" and "AES-GCM" in its upload flow and drawbacks. RFC-0004 §3 item 3 governs.
- RFC-0001's Drawbacks and Compatibility cite a "try-versioned-then-legacy decode rule above", but its "Legacy blobs" section says no legacy fallback should be built.
- pca's sender still wrote the bare root in our e2e on 2026-09-24 (ChaCha20-Poly1305, plain `UploadedFile`), which RFC-0001 replaced. The desktop reads both.
- Two names for one envelope: RFC-0001 says `VersionedUploadedFile`; the Android code says `VersionedHopPoolEntry`. We believe the bytes are the same (**unverified** beyond the live photo test).

## Open decisions

1. **Fold or mark.** Fold RFC-0001 and RFC-0004 into `base-spec.md` and `mds.md`, or mark the old sections as superseded with a link? Choose one.
2. **Owner.** Who updates the base-spec text after an RFC merges: the RFC author or the maintainers? Choose one.
3. **t3ams.** Move t3ams to ChaCha20-Poly1305 (RFC-0004 is a flag day)? Or name AES-GCM as a second dialect in the spec? Choose one.
4. **Cipher field.** Should `P2PMixnetFile` name its cipher, or is the flag day enough? Choose one.
5. **Envelope name.** `VersionedUploadedFile` or `VersionedHopPoolEntry`? Choose one.

Status: Built. polkadot-chat-desktop 236727c and 71e625a (HOP receive, both dialects, phone-verified), 82f5d69 (HOP send in the phones' dialect), 412ec85 (docs aligned with chat-spec main), 73cafd4 (RFC-0001 chain fallback). polkadot-chat-agents branch `desktop/rfc-0003` b8b9fc4.

Decision wanted: answer the open decisions, then adopt, adopt with changes, or reject. React 👍/👎 or comment.
