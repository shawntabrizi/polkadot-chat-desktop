# Review: spec 0012 Attachments draft (3b7c6c6) — accepted as the multi-device path; HOP interop is an owner decision (2026-09-24)

Finding: the base spec already defines attachments as `richText` + `FileVariant::p2pMixnet` delivered through HOP (`hop_submit` / `hop_claim` / `hop_ack`), an off-chain pool on one Bulletin node; both phone apps ship it for images and videos in 1:1 chats (ChaCha20-Poly1305 and a versioned envelope, which differs from the spec's AES-GCM text). HOP is one-shot (the first device that claims deletes the entry), single-node (256 fixed recipients) and 24 h, so polkadot-desktop never claims and shows "only in the mobile app".

0012 uses Bulletin transaction storage instead: 2 MiB per transaction, feeless, 14-day retention (renewable), content-addressed (CIDv1 raw, blake2b-256), fetched by `bitswap_v1_get` or a gateway. Kind 250 `attachment` carries up to 4 items with mime, media variant (file, image, video, voice with duration and waveform), a blurhash and a ≤ 2 KB thumbnail, a per-attachment key and nonce, chunk hashes (also the CIDs), a store locator and expiry. AES-256-GCM per 2 MB chunk, nonce XOR index, AAD binds index, count and size. Cost: 0 extra statements, ⌈size / 2 MB⌉ feeless transactions, the same for a group of any size. Multi-device and groups work because any device fetches by CID.

Accepted with notes:
- The thumbnail cap of 2 KB (the 4 KB batch limit) with the blurhash first: right.
- Voice notes: Chromium records WebM/Opus, not Ogg; the spec should allow both containers.
- Privacy: the ciphertext is public for 14 days; only the key in the E2E message protects it. State it in the UI copy for the first attachment ("stored encrypted on the Bulletin chain for 14 days").

Owner decision (morning review): **phone interop**. A 1:1 image to a phone user works only through HOP today. Options: (a) implement HOP send/receive in the desktop for 1:1 interop now (one-shot semantics, one device), and 0012 for groups and multi-device; (b) 0012 only, and ask the phone team to adopt it; (c) both, with HOP as the fallback when the peer's client is a phone build. Reviewer recommends (c) for M15, sized as M15a (0012 desktop + pca), M15b (HOP interop), M15c (voice notes).

Second owner decision: who authorizes Bulletin storage for non-persons (the desktop identity, bots). Devnet: `//Eve` as a dev authorizer. Later: a person grants their claim to the bot, or the operator becomes an `AllowedAuthorizer`.

Flag for chat-spec: the HOP cipher in the base spec (AES-GCM) does not match the phone apps (ChaCha20-Poly1305).
