# Capabilities: each device tells its peers what it can decode

Board mission: M3 Protocol foundations

Status: Prototyped in polkadot-chat-desktop (commit b5cbe5d) and polkadot-chat-agents (branch desktop/rfc-0003).

Read this issue first. The other proposals in this set use it to decide who receives a new content kind.

## Problem

- A client that does not know a content kind shows "Unsupported message content. Please update the app." The phone apps show one such bubble for each unknown message.
- An unknown enum index inside a known kind is worse. An unknown `FileVariant` index makes the whole `RichText` undecodable on Android and iOS, and the caption is lost too (checked in the app code; see proposal 07).
- A sender has no way to know what a peer's devices can decode. A person can have a phone and a desktop, and they can decode different sets.
- So today a new kind cannot be sent to anyone without a risk of an "unsupported" bubble.

## Proposed wire change

A new content kind `capabilities` (provisional kind 252):

```
Capabilities = {
    version: u8              // 1
    kinds: [u8; 32]          // bitmap of the content kinds this device decodes and shows
    fileVariants: Vec<u8>    // RichText FileVariant indices it can fetch
    hopDialects: Vec<HopDialect>  // HOP ciphers it can decrypt: legacy = 0 (phones), aesGcm = 1 (t3ams)
    features: u32            // support that no kind bit shows (for example tx actions inside buttons)
}
```

- Each device sends its own set once to each peer. It rides in the next request batch, so it costs no submission. It is never rendered and never notified.
- The receiver stores it per peer device, keyed by the statement's sending device.
- A device that never sent a set is "baseline": base spec and mds kinds only, `FileVariant` 0 only.
- The sender uses the intersection of the sets of every known device of the peer. For each extension it sends the rich form or a fallback (for example, a button menu as numbered text).
- **Gating rule (owner ruling).** A baseline device sees exactly one unsupported bubble per chat: the `capabilities` message itself. Every other extension kind goes to a device only after that device listed it.
- Decoders ignore bytes after the fields they know. A new field is appended and `version` goes up.

Full spec: https://github.com/shawntabrizi/polkadot-chat-desktop/blob/main/docs/spec/0013-capabilities.md

## What the prototype learned

- **Cost.** 0 extra submissions. The opaque message is 60 bytes of the 4,096-byte batch, once per contact and again after an app update. This is tier 1 ("free") under the efficiency rule (https://github.com/shawntabrizi/polkadot-chat-desktop/blob/main/docs/spec/efficiency.md).
- **Live test.** Two desktops exchanged sets and then used the Bulletin file variant and read receipts. A baseline bot got a numbered text menu and a HOP photo. A photo from the owner's phone showed on the desktop, and a desktop photo showed on the phone.
- **Vector.** The test vector in the spec file gives the same bytes in three encoders (Python, scale-ts, the pca codec).
- **Pitfall: the sending device.** The SDK's `RequestMessage` does not say which device sent a message. The desktop reads it from the statement topic and decrypts each incoming statement twice. A `device` field in the SDK would remove the second decryption.
- **Pitfall: a new chat.** Until the first message arrives, a new peer is baseline. So a contact cannot be added to a group before it sent anything. The prototype sends the set with the chat accept to shorten this gap.
- **Pitfall: delete for everyone.** `deleted` is not sent to a baseline phone. The prototype marks the row "removed here; the phone keeps it".
- **Pitfall: HOP with several devices.** The first `hop_ack` removes a HOP entry, so a second device of the same person gets `NotFound`. Capabilities cannot fix this.

## Clients that do not support it

- A baseline client shows one "unsupported" bubble per sending device per chat. It shows one more bubble after a set change (an app update).
- If a push is sent for it, Android shows the same text in the push. The prototype sends no push for it.
- After that, a baseline device receives base-spec content only.

## Open questions

1. **A carrier that baseline clients skip.** For example, a trailing field in `Request`. This is only safe if the Android and iOS decoders ignore trailing bytes (**unverified**). With one, the first bubble goes away.
2. **Base kind or fallback text?** Should chat-spec make `capabilities` a base kind, so future phone builds hide it? The alternative is a per-message fallback text (Matrix and XMTP style), which costs bytes on every message.
3. **The sender's own devices.** Our other devices get our sent messages through the mds sync channel. Should their sets count in the intersection?
4. **HOP dialects after RFC-0004.** RFC-0004 (merged 2026-07-31) makes ChaCha20-Poly1305 the only AEAD, with no cipher-suite field. If all clients follow it, `hopDialects` is not needed. Today t3ams still uses AES-256-GCM for HOP (see proposal 12).
5. Kinds as a 32-byte bitmap or as a sorted list?

Related board item: "Push notifications for headless bot senders". A headless agent's replies raise no push on the phones.

Decision wanted: adopt, adopt with changes, or reject. React 👍/👎 or comment.
