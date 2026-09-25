# Attachments: Bulletin transaction storage as a RichText FileVariant

Board mission: M4 Deeper chain primitives

Status: Prototyped in polkadot-chat-desktop (commit b5cbe5d) and polkadot-chat-agents (branch desktop/rfc-0003).

## Problem

HOP, the base spec's attachment rail, has three limits:

1. **One-shot.** The first `hop_ack` removes the entry. A second device of the same person gets `NotFound`. polkadot-desktop does not claim at all for this reason.
2. **Per node, per recipient.** The entry sits on one node, for ≤ 256 recipient keys fixed at submit. A large group or a late joiner cannot use it.
3. **24 hours.** After that the file is gone unless the node promoted it to the chain.

## Proposed wire change

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

- The sender encrypts on the device, stores each chunk with `TransactionStorage.store` (feeless under a Bulletin authorization), waits for a best block, then sends the message.
- Any device of any recipient fetches the chunks by CID (`bitswap_v1_get` or an HTTPS gateway), checks each hash and decrypts.
- A reply or an edit is `RichText`, so it can carry a file with no new kind.
- The prototype first used a separate kind (250). It moved into the enum to keep one media model, and kind 250 is now read-only.

Full specs: https://github.com/shawntabrizi/polkadot-chat-desktop/blob/main/docs/spec/0014-bulletin-file-variant.md (the variant) and https://github.com/shawntabrizi/polkadot-chat-desktop/blob/main/docs/spec/0012-attachments.md (crypto, upload and download flows, limits).

## Relationship to HOP: both paths

- **Bulletin is the main path.** It works for several devices, for groups of any size, and for 14 days.
- **HOP is the bridge to baseline clients.** Capabilities (proposal 01) decide: the Bulletin variant goes only to a peer whose every device listed `fileVariants ∋ 1`, else HOP in the phones' format. Groups never use HOP.
- RFC-0001 (merged) adds a `bitswap_v1_get` fallback for HOP entries promoted to the chain. That already brings the two rails closer: both end as Bulletin data found by a blake2b-256 CID.

## What the prototype learned

- **Cost.** 0 extra statements: the file reference rides in the message. ⌈size / 2 MB⌉ feeless Bulletin transactions. The cost does not depend on group size.
- **Measured Bulletin facts (devnet, 2026-09-24).**
  - 2 MiB maximum per transaction (`MaxTransactionSize`); a 2,000,000-byte chunk encrypts to 2,000,016 bytes.
  - Retention 201,600 blocks = 14 days.
  - `bitswap_v1_get` returns a 200 KB chunk in 2–4 s but a 2 MB chunk in 30–33 s. The HTTPS gateway returns 2 MB in 6–8 s. So clients try bitswap first up to 512 KB and the gateway first above that.
  - A stored chunk was found in a best block and fetched back by both paths.
- **Live interop.** A photo from the owner's phone opened on the desktop (HOP), and a desktop photo opened on the phone (HOP in the phones' format).
- **Pitfall: authorization for non-persons.** The desktop identity and bots are not persons and cannot claim storage. The prototype uses a devnet grant signed with the public `//Eve` key. That is a stand-in only. The devnet budget ran out during testing (`InsufficientAuthorizerBudget`). The real answer is paritytech/individuality#1222: storage claims are too granular for file-carrying consumers, and a dev-key faucet cannot exist in production.
- **Pitfall: voice notes.** Electron cannot record Ogg. Voice notes are Opus in WebM or Ogg, and receivers must play both.
- **Privacy cost.** The ciphertext is public on the chain for 14 days; only the key in the E2E message protects it. HOP limits fetches to recipient keys.

## Clients that do not support it (the request)

- **An unknown `FileVariant` index makes the whole message unsupported**, caption included. Checked in the code of both phone apps: Android keeps the raw bytes and re-parses them after an update; iOS stores the message as unsupported (a later re-parse is **unverified**). Not tested on a live phone.
- **We ask chat-spec to define this behaviour.** For example: "a decoder that meets an unknown `FileVariant` index shows the text and a placeholder for that item". This needs a length prefix per item, or it stays a rule that senders must gate. Today the base spec does not say.
- Until then, capabilities gate the variant, and a baseline peer gets HOP.

## Open questions

1. Reserve `FileVariant` index 1 for Bulletin before anyone ships it?
2. **AEAD.** The chunks use AES-256-GCM. RFC-0004 makes ChaCha20-Poly1305 the protocol AEAD. Switch before adoption? We think yes.
3. The base `VideoFileMeta` has no width or height. Add them?
4. An audio `FileMeta` variant instead of our `voice` field? It would let HOP carry voice notes too.
5. Renewal of pinned files draws on the hard "permanent" allowance. Who gets it?
6. The Bulletin docs mark HTTP gateways as deprecated. What is the fetch path for clients without bitswap?

Decision wanted: adopt, adopt with changes, or reject. React 👍/👎 or comment.
