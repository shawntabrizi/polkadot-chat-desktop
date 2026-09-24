# Review: spec 0011 Private Groups v2 draft (06374b2) — accepted with changes (2026-09-24)

Verdict: build from this draft. It meets the efficiency rule (one submission per group message, two per removal at any size) and the owner's rulings (one group type, supergroup features, privacy levels, Signal/Telegram/WhatsApp as the bar, t3ams as a reference).

Adopted over the coordinator's position:
- Removal by one rekey statement sealed per member with the base spec's pairwise secret, not one DM per member (2 submissions vs 1023 at n = 1024).
- No per-sender hash ratchet (no forward secrecy gain with a shared epoch key); rotate on removal and every 7 days (Megolm).

Changes required before M16 starts (reviewer will apply to the RFC):
1. **History on request from any member.** The 24 h / 4 KB carry loses messages for a member offline longer than a day. Generalize `history` (kind 249) so a returning member asks any member, preferably a bot admin (always online), for messages since a `messageId` or timestamp over the DM session; providers answer in 4 KB pages. Newcomer history is the same path.
2. **Cap 256 in v2**, format allows 1024 (`Vec<RekeyEntry>` and state size unchanged). Raise when the quota question (below) is settled.
3. **Provisional kinds 250–254** for the range; `kinds.md` gets 249 `groupControl`; README gets the 0011 row (done in this commit).

Owner questions with the reviewer's defaults (morning review):
- Level 1 now, level 2 next (needs person identities: "Sign in with Polkadot app").
- Cap 256.

Findings to raise upstream, independent of groups:
- **Statement quota**: 200 statements / 1 MiB per person on Paseo People (`runtimes/next-people-paseo/src/parameters.rs:41-55`); DMs keep up to 2 statements per peer with maximal expiry, so ~100 active conversations fill a person's quota and later submissions fail with `AccountFull`. Needs a chat-spec and People-chain conversation.
- Contextual statement allowance for unlinkable posting accounts (RFC Unresolved Question 4).

Unverified items the builder must check first: the store adapter can submit with a chosen topic, channel and expiry; which allowance a devnet chat identity holds; whether devnet runs the resources pallet.
