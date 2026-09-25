# Attachments: Bulletin transaction storage as a RichText FileVariant

Board mission: M4 Deeper chain primitives

Related board items: "Resources: long-term storage claims are too granular for file-carrying consumers" (individuality#1222), "individuality · Resources — Keep an unattended bot provisioned with Bulletin storage", "polkadot-chat-agents · Protocol — Bot outbound file upload (hop_submit + bulletin allowance)". This issue is evidence for all three.

## Problem

HOP, the base spec's attachment rail, has three limits:

1. **One-shot.** The first `hop_ack` removes the entry. A second device of the same person gets `NotFound`. RFC-0001 adds a fallback to chain storage, but an acked entry is deleted without promotion (RFC-0001 "Known issues"), so the second device still gets nothing.
2. **Per node, per recipient.** The entry sits on one node, for ≤ 256 recipient keys fixed at submit. A large group or a late joiner cannot use it.
3. **24 hours.** After that the file is gone unless the node promoted it to the chain.

## What we implemented

A second transfer rail as a second `FileVariant`, not a new message kind:

```
FileVariant = enum {
    p2pMixnet(P2PMixnetFile) = 0     // base spec, HOP, unchanged
    bulletin(BulletinFile)   = 1     // this proposal
}
BulletinFile = {
    meta: FileMeta                   // base spec, unchanged; the blurhash goes in meta.thumbnail, as the phones do
    name: Option<String>
    preview: Option<Vec<u8>>         // <= 2,048 bytes
    voice: Option<{ durationMs: u32, waveform: Vec<u8> }>
    key: [u8; 32], nonce: [u8; 12]   // random per attachment
    chunkSize: u32                   // 2,000,000
    chunks: Vec<[u8; 32]>            // blake2b_256 of each encrypted chunk = the Bulletin content hash = the CID digest
    store: Store                     // bulletin { genesis, mirror: Option<String> }
    expiresAt: u64
}
```

Rules:

- The sender encrypts on the device (AES-256-GCM through Web Crypto; see open decision 2), stores each chunk with `TransactionStorage.store` (feeless under a Bulletin authorization), waits for a best block, then sends the message.
- Any device of any recipient fetches the chunks by CID, checks each hash and decrypts. Source order (measured): `bitswap_v1_get` first for chunks up to 512 KB, the HTTPS gateway first above that.
- A reply or an edit is `RichText`, so it can carry a file with no new kind.
- **Both rails.** The Bulletin variant goes only to a peer whose every device listed `fileVariants ∋ 1` (proposal 01). Else HOP in the phones' format. Groups never use HOP.
- **HOP receive meets RFC-0001.** On a claim `NotFound`, the desktop fetches the entry by CID from the node, then from Bulletin, and never acks a chain read. It retries for 24 h from the first failure.
- **Ask to resend** (host convention, no new kind): a receiver whose copy is gone sends "Please resend <name>" with the link `#resend/<messageId>`. The sender re-stores the same ciphertext, so the old message works again.

Why this form, and the alternatives we considered:

| Option | Why we did not choose it |
|---|---|
| A separate content kind (our first build: kind 250) | Two media models. The variant keeps one `RichText` with captions, albums, replies and edits. Kind 250 is now read-only. |
| HOP only | It fails for a second device, for groups and after 24 h. |
| Bulletin only | The phones cannot read it. HOP stays the bridge to baseline clients. |
| One HOP entry per recipient device | A `P2PMixnetFile` carries one ticket. Per-device tickets would need a new field and n uploads. |

Full specs: https://github.com/shawntabrizi/polkadot-chat-desktop/blob/main/docs/spec/0014-bulletin-file-variant.md (the variant) and https://github.com/shawntabrizi/polkadot-chat-desktop/blob/main/docs/spec/0012-attachments.md (crypto, flows, limits).

## Cost

- **Statements: 0 extra.** The file reference rides in the message.
- **Bytes in the message.** Test vector: 194 bytes for one photo with a blurhash (`BulletinFile` alone 164 bytes). With a 2,048-byte preview: 2,334 bytes. Each 2 MB chunk adds a 32-byte hash. Limits: 25 MiB and 4 items per message.
- **Chain.** ⌈size / 2 MB⌉ feeless Bulletin transactions: a 400 KB photo is 1; a 25 MiB file is 14. The cost does not depend on group size. Every byte stays in a block body on every full node for 14 days.
- **Authorization.** A person's claim is 100 transactions and 8 MiB per 14 days: about 20 photos. How many claims a person gets per period is **unverified**.

Measured Bulletin facts (devnet, 2026-09-24):

- 2 MiB maximum per transaction; a 2,000,000-byte chunk encrypts to 2,000,016 bytes.
- Retention 201,600 blocks = 14 days.
- `bitswap_v1_get` returns a 200 KB chunk in 2–4 s but a 2 MB chunk in 30–33 s. The HTTPS gateway returns 2 MB in 6–8 s.
- A stored chunk was found in a best block and fetched back by both paths.

## What it gives the user

- A file opens on every device of the recipient, not only the first one.
- Files in groups of any size, and for late joiners.
- 14 days to open a file instead of 24 hours; after that, "Ask to resend".
- Photos to and from the phone apps still work, over HOP (live test both ways, 2026-09-24).

## Clients that do not support it

- **An unknown `FileVariant` index makes the whole message unsupported**, caption included. Read in the code of both phone apps: Android keeps the raw bytes and parses them again after an update; iOS stores the message as unsupported (a later parse is **unverified**). Not tested on a live phone.
- So the variant goes only to devices that listed it. A baseline peer gets HOP in the phones' format, up to 32 MiB.
- **We ask chat-spec to define this behaviour** (open decision 1).

Pitfalls:

- **Authorization for non-persons.** The desktop identity and bots are not persons and cannot claim storage. The prototype uses a devnet grant signed with the public `//Eve` key. That is a stand-in only. The devnet budget ran out (`InsufficientAuthorizerBudget`, even for 8 MiB on 2026-09-24), so fresh test identities can store nothing, and cannot `hop_submit` either. individuality#1222 is the real answer.
- **Voice notes.** Electron cannot record Ogg. Voice notes are Opus in WebM or Ogg, and receivers must play both.
- **Privacy.** The ciphertext is public on the chain for 14 days. Only the key in the E2E message protects it. HOP limits fetches to recipient keys.

## Open decisions

1. **Unknown variants.** Define what a decoder does with an unknown `FileVariant` index. Choose: (a) show the text and a placeholder for that item (this needs a length prefix per item); (b) a sender rule: never send a variant the peer did not list.
2. **Cipher alignment.** RFC-0004 moved the protocol to ChaCha20-Poly1305. Choose: (a) switch chunk sealing to ChaCha20-Poly1305 before adoption (no new dependency: the desktop uses `@noble/ciphers` for HOP); (b) keep AES-256-GCM and state the divergence.
3. **Reserve index 1** for Bulletin now, before anyone ships another variant? Yes / no.
4. **Storage for non-persons.** Who authorizes Bulletin storage for bots and desktop identities in production? Decide with individuality#1222.
5. **Is the chain load worth it?** Every file costs block space on every full node for 14 days; HOP costs no chain transaction when all recipients ack. Yes (Bulletin as the main path) / no (HOP main, Bulletin for groups only).
6. `VideoFileMeta` has no width or height. Add them? Yes / no.
7. An audio `FileMeta` variant instead of our `voice` field, so HOP can carry voice notes too? Yes / no.
8. The Bulletin docs mark HTTP gateways as deprecated. What is the fetch path for clients without bitswap?

Status: Built. polkadot-chat-desktop 9e1b12d (M15a), 4345b70 (M15b), 56e55a7 (M15c), 236727c and 71e625a (HOP receive), 82f5d69 (M20: the variant, HOP send), 73cafd4 (RFC-0001 chain fallback). polkadot-chat-agents branch `desktop/rfc-0003` b8b9fc4.

Decision wanted: answer the open decisions, then adopt, adopt with changes, or reject. React 👍/👎 or comment.
