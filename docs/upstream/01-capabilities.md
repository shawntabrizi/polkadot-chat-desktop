# Capabilities: each device tells its peers what it can decode

Board mission: M3 Protocol foundations

Read this issue first. The other proposals in this set use it to decide who receives a new content kind.

## Problem

- A client that does not know a content kind shows "Unsupported message content. Please update the app." The phone apps show one such bubble for each unknown message.
- An unknown enum index inside a known kind is worse. An unknown `FileVariant` index makes the whole `RichText` undecodable on Android and iOS, and the caption is lost too (read in the code of both apps; not tested on a live phone; see proposal 07).
- A sender cannot know what a peer's devices can decode. A person can have a phone and a desktop, and they can decode different sets.
- So today no client can send a new kind to anyone without the risk of an "unsupported" bubble.

## What we implemented

A new content kind `capabilities` (provisional kind 252):

```
Capabilities = {
    version: u8                   // 1
    kinds: [u8; 32]               // bitmap of the content kinds this device decodes and shows (base kinds included)
    fileVariants: Vec<u8>         // RichText FileVariant indices it can fetch: 0 = HOP, 1 = Bulletin (proposal 07)
    hopDialects: Vec<HopDialect>  // rfc0004-chacha = 0 (RFC-0004 + RFC-0001, the phones), aesgcm = 1 (t3ams, old base-spec text)
    features: u32                 // bit 0 private groups (proposal 06), bit 1 tx actions in buttons (proposal 04)
}
```

Rules:

- Each device sends its own set once to each peer, in a request batch that goes anyway. It is never rendered and never notified.
- The receiver stores the set per peer device, keyed by the statement's sending device. It drops the set on `DeviceRemoved`.
- A device that never sent a set is "baseline": base-spec and mds kinds only, `FileVariant` 0 only.
- The sender uses the intersection of the sets of every known device of the peer (Signal's "all devices" mode). For each extension it sends the rich form or a fallback. Example: a button menu becomes numbered text.
- **Gating rule (owner ruling, 2026-09-24).** A baseline device sees exactly one unsupported bubble per chat: the `capabilities` message itself. Every other extension kind goes to a device only after that device listed it.
- A bot that describes itself (`botInfo`, proposal 05, or a directory card, proposal 08) counts as having sent its set.
- Decoders ignore bytes after the fields they know. A new field is appended and `version` goes up.

Why this form, and the alternatives we considered:

| Option | Why we did not choose it |
|---|---|
| Send new kinds freely (our development mode until 2026-09-24) | A phone shows one bubble per `seen`, per `botInfo`, per press. Acceptable for a test fleet only. |
| A fallback text inside every message (Matrix `body`, XMTP `fallback`) | It costs bytes on every message. It cannot fix an unknown `FileVariant`, which breaks the whole message. |
| A hash of the set, with a query on a miss (XMPP XEP-0115) | A query is one more submission and one more ACK. The set itself is only 43 bytes. |
| A carrier that baseline clients skip (a trailing field in `Request`) | Safe only if the Android and iOS decoders ignore trailing bytes. That is **unverified**. With one, the first bubble goes away (open decision 1). |
| Bitmap or sorted list for `kinds` | Bitmap: 32 fixed bytes, simple to intersect. A list is about 30 bytes today. |

Full spec: https://github.com/shawntabrizi/polkadot-chat-desktop/blob/main/docs/spec/0013-capabilities.md

## Cost

- **Submissions: 0.** The set rides the first message to each peer, and again after an app update that changes the set. Tier 1 ("free") under the efficiency rule (https://github.com/shawntabrizi/polkadot-chat-desktop/blob/main/docs/spec/efficiency.md).
- **Bytes: 60** in the opaque message (43 bytes of content), once per peer, of the 4,096-byte batch. Computed from the test vector, which three encoders reproduce byte for byte (Python, scale-ts, the pca codec).
- **Receiver: 0 submissions.** One stored row per peer device.
- **Hidden cost: a second decryption.** The SDK's `RequestMessage` does not say which device sent a message. The desktop reads the device from the statement topic, so it decrypts each incoming statement twice. Time per statement: not measured.

## What it gives the user

- A person with a new client gets buttons, read receipts, groups and multi-device files from a peer that has them too.
- A person on a phone gets base-spec content that it can show: a numbered menu instead of a keyboard, a HOP photo instead of a Bulletin photo. It sees one "unsupported" bubble per chat, not one per extension message.
- The group member picker can say why a contact cannot join a group ("Uses a client without group support", "Not known yet: message them first").

Live test (2026-09-24, devnet): two desktops exchanged sets, then used the Bulletin file variant and read receipts. A baseline bot got a numbered text menu and a HOP photo. A photo from the owner's phone showed on the desktop, and a desktop photo showed on the phone.

## Clients that do not support it

- **The phones today:** one "Unsupported message content. Please update the app." bubble per sending device per chat. One more bubble after a set change (an app update). No push is sent for it. After that, the phone receives base-spec content only.
- **Delete for everyone:** `deleted` is not sent to a baseline phone. The sender's row says "removed here; the phone keeps it".
- **A new chat:** until the first message arrives, the peer is baseline. So a contact cannot be added to a group before it sent something. The accepting desktop sends its set with the accept to make this gap short.
- **A contact that answered without a set** is treated as baseline ("Uses a client without group support").

## Open decisions

1. **Carrier.** Should chat-spec define a carrier that baseline clients skip (for example a trailing field in `Request`), so the first bubble goes away? Yes / no. This needs a check of the phone decoders first.
2. **Base kind or fallback text?** Choose: (a) make `capabilities` a base kind, so future phone builds hide it; (b) a per-message fallback text (Matrix, XMTP) instead; (c) neither.
3. **Is one "unsupported" bubble per chat an acceptable cost** for extensions on a phone? Yes / no. If no, extensions wait for decision 1 or 2.
4. **Own devices.** Our other devices get our sent messages through the mds sync channel. Should their sets count in the intersection? Yes / no.
5. **`hopDialects`.** RFC-0004 is a flag day with no cipher-suite field. If t3ams moves to ChaCha20-Poly1305 (proposal 12), remove the field before adoption? Yes / no.
6. **SDK field.** Add a `device` field to the SDK's `RequestMessage`, so a client does not decrypt twice? Yes / no.
7. **`kinds`:** 32-byte bitmap or sorted list?

Related board item: "runtime · Push — Push notifications for headless bot senders". A headless agent's replies raise no push on the phones.

Status: Built. polkadot-chat-desktop 82f5d69 (M20), review b8e5ad9 (phone-verified both ways), picker 000391c and b5cbe5d; spec abbb962, owner ruling 6b764ff. polkadot-chat-agents branch `desktop/rfc-0003` b8b9fc4.

Decision wanted: answer the open decisions, then adopt, adopt with changes, or reject. React 👍/👎 or comment.
