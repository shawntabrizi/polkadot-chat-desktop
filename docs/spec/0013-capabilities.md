# RFC: Capabilities

|                 |                                                                                  |
| --------------- | -------------------------------------------------------------------------------- |
| **Start Date**  | 2026-09-24                                                                        |
| **Description** | Each device tells its peers which content kinds, file variants, HOP dialects and features it supports, so a sender picks a form every device of the peer can show |
| **Authors**     | Shawn Tabrizi (with the desktop client team)                                      |
| **Status**      | Draft in `polkadot-chat-desktop/docs/spec`; plan in `docs/milestones/M20.md`; the test vector is in this file |
| **Provisional kind** | `capabilities` = 252 (see `kinds.md`)                                        |
| **Decision**    | `docs/questions.md` "Attachments phone interop: DECIDED 2026-09-24 (owner, final plan)", step 2 |

## Summary

A new content kind, `capabilities` (252), carries one device's supported
set: a layout version, a bitmap of content kinds, the `FileVariant` indices
it can fetch, the HOP dialects it can decrypt, and feature flags. Each device
sends it once to each peer after a chat starts, again when the set changes,
and to each new contact. It rides in a request batch that goes anyway:
**zero extra submissions**. It is never rendered and never notified.

A device that never sent one is a **baseline client**: it supports the base
spec and mds only. For each outgoing message, the sender takes the
intersection of the sets of **every known device of the peer** and picks the
richest form in it. For an attachment that is the Bulletin `FileVariant`
(0014) when every device lists it, else HOP in a dialect every device lists
(the phones' legacy dialect for a baseline device).

## Motivation

The owner's plan keeps two attachment paths: Bulletin transaction storage
(0012, and 0014 as a `FileVariant`) is the main path; HOP is the bridge to
baseline clients (the phone apps). A sender cannot choose between them
without knowing what the receiving devices support:

1. **A baseline decoder fails on an unknown enum index.** A `RichText` with a
   Bulletin variant is an unsupported message on today's phones, text
   included (0014, "What a baseline client sees", checked in the Android and
   iOS code).
2. **The HOP message does not name its cipher.** `P2PMixnetFile` carries a
   ticket, not a dialect. The phone apps encrypt with ChaCha20-Poly1305
   inside a versioned pool-entry envelope; the base spec text and t3ams use
   AES-256-GCM (`docs/reference/bulletin-and-media.md` §5, §6). pca speaks
   both (`bot-core/lib/hop-client.mjs`, dialects `legacy` and `t3ams`).
3. **Development mode sends every extension kind freely** (README). Phone
   users see "Unsupported message content. Please update the app." for each
   one. With capabilities, a sender can send a fallback instead.
4. **Multi-device.** A person can have a phone and a desktop. The richest
   form for the desktop is not readable on the phone. Capabilities must be per
   device, and the choice must fit all of them.

The old "evidence rule" (0005 before 2026-09-23: send a kind only after the
peer sent one to us) needed no new message, but it could not name file
variants or dialects, and two new clients never started. The identifier-key
capability bitmap (`docs/roadmap.md`) is public and per identity, not per
device. This RFC replaces both.

## Stakeholders

Desktop client (this repo), `pca` (`polkadot-chat-agents`, branch
`desktop/rfc-0003`), the phone app team (they receive this kind as
unsupported until they adopt it), chat-spec maintainers (upstream target,
together with 0014).

## Explanation

### Notation

As 0012: `encode` is SCALE; `[u8; N]` is raw; `Vec<T>` is a compact count
and the items; integers are little-endian.

### Content (kind 252)

```
MessageContent = {
    ...
    capabilities(Capabilities) -> 252
}
Capabilities = {
    version: u8              // layout version, 1
    kinds: [u8; 32]          // bitmap of content kinds this device decodes and shows;
                             // bit k = byte k/8, bit k%8 (LSB first)
    fileVariants: Vec<u8>    // RichText FileVariant indices it can fetch: 0 = p2pMixnet (HOP), 1 = bulletin (0014)
    hopDialects: Vec<HopDialect>
    features: u32            // bit set, below
}
HopDialect = enum {
    legacy = 0               // the phone apps: ChaCha20-Poly1305 and the V1(Inline | Chunked) pool-entry envelope
    aesGcm = 1               // base-spec text: AES-256-GCM, UploadedFile metadata (t3ams)
}
```

Feature bits (for support that no kind bit shows, because it is inside a
kind):

| Bit | Meaning | Spec |
|---|---|---|
| 0 | joins private groups (v2): epoch keys, `groupControl` flows | 0011 |
| 1 | runs `tx` actions (transaction intents) inside `buttons` | 0007 |
| 2–31 | reserved, 0; a decoder ignores unknown bits | |

- The content is 43 bytes for two variants and two dialects.
- **Forward rule.** A decoder reads the fields of the versions it knows and
  ignores bytes after them (the opaque message has its own length, so this
  is safe). A new field is appended and `version` goes up. A change that
  breaks the layout takes a new kind.
- `kinds` lists **every** kind the device supports, base kinds included. A
  bit for a base kind that is clear means "do not send it" (for example a
  bot without calls clears 8–11).
- `hopDialects` names what the device can **decrypt**. The RPC shape of a
  HOP node (by-name or positional parameters) belongs to the node, not the
  client; a client learns it from the node it claims from.

### The baseline set

A device that never sent `capabilities` has this set:

| Field | Baseline value | Source |
|---|---|---|
| kinds | 0, 1, 2, 4, 5, 7–18 (base spec v0.16), 20 (`DeviceChatAccepted`, mds v0.2) | `.refs/chat-spec/base-spec.md` "Remote Message Model"; `mds.md` "Accepting a Chat Request" |
| fileVariants | 0 | base spec "FileVariant" |
| hopDialects | `legacy` | the shipped phone apps (`bulletin-and-media.md` §5); the base spec text says AES-256-GCM, the apps do not |
| features | 0 | |

Baseline `kinds` bitmap: `b7ff17` then 29 zero bytes.

### Sending

- **Who.** Every device sends its own. A device never sends another device's
  set. Bots (pca) send it too.
- **When.** A device queues its `capabilities` for a peer:
  1. when a chat with that peer is accepted (either side) or a contact is
     added;
  2. when its own set changes (an app update); the new set is queued for
     every contact;
  3. when a peer's `deviceAdded` arrives (the new device has not seen it).
- **How.** The queued content rides in the next request batch to that peer
  (base spec: a new message extends the pending request). It never starts a
  submission of its own. Until it goes, the peer treats this device as
  baseline, which is safe: this device receives HOP (M20 step 1) and every
  base kind.
- **Which session.** It goes on the device-level session (mds: topic
  `SessionId(D(A), B)`). The receiver keys it by the **sending device's
  statement account**, which the statement's topic and proof name. The
  content has no device field, so a device cannot speak for another.
- **Groups.** It is not sent in group carriers. Group members that are also
  DM contacts get it on the DM session. A member device with no set is
  treated as reading kind 250 only (a v2 group has only clients that
  implement 0011, and today all of them read kind 250; our inference, not a
  rule of 0011). The group rule for attachments is in 0014 "Sending".

### Receiving

- Store per peer device: `(peer account, device statementAccountId) →
  Capabilities, timestamp`. A later `Message.timestamp` replaces an earlier
  one; an older one is ignored.
- **Never rendered, never notified, never a message row.** No push
  notification is sent for it (a baseline client would notify
  "Unsupported message"; see Drawbacks).
- On `deviceRemoved` from the peer, drop that device's entry.
- On `deviceAdded` from the peer, the new device starts at the baseline set
  until its own `capabilities` arrives.
- Unknown kind bits, file variants, dialects and feature bits are kept but
  not used.

### Choosing a form

For peer P with known devices D₁…Dₙ (the mds roster: `DeviceChatAccepted`,
`deviceAdded`, minus `deviceRemoved`):

```
effective(P) = caps(D₁) ∩ … ∩ caps(Dₙ)      // per field; a device with no entry = baseline
```

The sender sends a kind only if its bit is in `effective(P)`, else the
kind's fallback below. This is Signal's `ALL_DEVICES` account-capability
mode, done on the sender instead of a server.

| Feature | Rich form (needs, in `effective(P)`) | Fallback |
|---|---|---|
| Attachment | `RichText` + `FileVariant.bulletin` (fileVariants ∋ 1) | 1. kind 250 (kinds ∋ 250; transition only, 0014). 2. `RichText` + `FileVariant.p2pMixnet` in a dialect in `hopDialects`, `legacy` first for a baseline device. 3. No common dialect: refuse with "This contact's app cannot receive files from this app". |
| Buttons (242) | `buttons` | `text` with the menu as numbered lines ("1. Yes · 2. No — reply with a number or the label"); a press arrives as text and the bot matches it |
| Transaction intents (feature bit 1) | `tx` action in `buttons` | the button is left out; the text says the amount and the recipient |
| Transaction reference (245) | `transactionReference` | base `send` (kind 2) for a plain transfer; nothing for a contract call |
| Bot info (244) | `botInfo` | nothing; the greeting goes as `text` once |
| Typing, seen (240, 241) | as 0005 | not sent |
| Deleted (21) | as RFC-0003 | not sent |
| Groups v1 (246–248) | fan-out | the peer cannot be added; the UI says why |
| Groups v2 (249, feature bit 0) | welcome | the peer cannot be added; the UI says why |
| Capabilities (252) | always sent (see Drawbacks) | n/a |

**Multi-device example.** Bob has a phone (baseline) and a desktop
(fileVariants {0, 1}). `effective(Bob).fileVariants = {0}`, so Alice's
desktop sends the photo over HOP in the `legacy` dialect. Bob's desktop
receives it over HOP too. When Bob's phone is removed (`deviceRemoved`), the
next photo goes by Bulletin.

**HOP with several devices.** A HOP entry for a ticket is removed by the
first `hop_ack` (base spec v0.16). A device that knows it is one of several
devices of its user SHOULD claim and not ack, so the other devices can claim
too; the entry then lives out its 24 hours and is promoted to Bulletin, where
the phone apps' `bitswap_v1_get` fallback finds it. This departs from the
base spec's SHOULD to ack within the retention window. A baseline phone acks
at once; a sibling device that claims later gets `NotFound`, the entry was
not promoted, and the file is lost for that device (it can ask to resend,
0012). This is a HOP limit that capabilities cannot fix.

### Relation to 0010 bot cards

A bot's card (`botCard`, kind 251) carries a 32-bit capability hint for the
directory, before any chat. A bot's `capabilities` MUST agree with its card:

| 0010 card bit | Equivalent in `capabilities` |
|---|---|
| 0 buttons | kinds ∋ 242 and 243 |
| 1 tx | feature bit 1 and kinds ∋ 245 |
| 2 groups v1 | kinds ∋ 246, 247, 248 |
| 3 groups v2 | feature bit 0 and kinds ∋ 249 |
| 4 receives attachments | fileVariants ≠ ∅ (or kinds ∋ 250 in the transition) |
| 5 sends attachments | not in `capabilities` (a receiver needs no promise) |
| 6 balance hint | kinds ∋ 244 (the hint is inside `botInfo` v2) |

The card is a hint for the UI. `capabilities` is the rule for sending.

### Cost (efficiency rule)

| Event | Submissions | Bytes |
|---|---|---|
| New chat | 0 (rides the first message to the peer) | 60 bytes in the opaque message (vector below) |
| App update that changes the set | 0 (rides the next message to each contact) | 60 bytes per contact |
| Peer adds a device | 0 | 60 bytes |
| Receive | 0 | a store row per peer device |

Tier 1 ("free") in `efficiency.md`. The only cost is the batch budget: 60 of
4,096 bytes, once.

## Test vector

Values (illustrative set: base kinds, 20, 21, 240–252; both variants; both
dialects; feature bits 0 and 1):

```
messageId: "CAP-1"
timestamp: 1720000000000
capabilities: {
  version: 1,
  kinds: {0,1,2,4,5,7..18,20,21,240..252},
  fileVariants: [0, 1],
  hopDialects: [legacy, aesGcm],
  features: 3
}
```

Opaque message (60 bytes):

```
ec144341502d310030fd779001000000fc01b7ff37000000000000000000000000000000000000000000000000000000ff1f08000108000103000000
```

| Bytes (hex) | Field | Value |
|---|---|---|
| `ec` | compact length of the remote message | 59 |
| `14` `4341502d31` | messageId | `"CAP-1"` |
| `0030fd7790010000` | timestamp | 1720000000000 |
| `00` | version of `VersionedMessageContent` | V1 |
| `fc` | contentKind | 252 `capabilities` |
| `01` | `Capabilities.version` | 1 |
| `b7ff37` + 26 × `00` + `ff1f` | kinds bitmap | bytes 0–2: kinds 0,1,2,4,5,7–18,20,21; bytes 30–31: kinds 240–252 |
| `08` `0001` | fileVariants | [0, 1] |
| `08` `0001` | hopDialects | [legacy, aesGcm] |
| `03000000` | features | bits 0, 1 |

Computed 2026-09-24 by a Python SCALE encoder (checked against 0012 vector A)
and by `scale-ts` (the desktop's codec library); both give the same bytes.
Not yet reproduced by the pca codec.

## Privacy

- **Only inside the E2E session.** The set goes in the encrypted request to
  one peer. Nothing is published on a topic. XEP-0115 puts its hash in
  broadcast presence; we do not.
- **Fingerprinting.** The set tells the peer which client and roughly which
  version a device runs, and how many devices the person has (one set per
  device; mds already tells the peer the device list). A peer learns this
  from behaviour anyway. The set holds no app name, version string or
  platform.
- **Bots.** A bot's card is public (0010); its `capabilities` repeats the
  same facts in private.

## Security

- The set is a claim by the sending device. A lie hurts only the liar: the
  peer sends it a form it cannot read.
- It cannot be forged for another device: the receiver keys it by the
  statement's sending device, not by a field.
- A peer that lists a variant to make the sender use Bulletin gets a public
  ciphertext (0012 Privacy). The sender's person accepted that path when the
  owner made Bulletin the main path.

## Drawbacks

- **A baseline client shows the capabilities message.** Today's phones show
  "Unsupported message content. Please update the app." once per sending
  device per chat, and again after a set change. Android also raises a push
  text for it if a push is sent (`ChatPushNotificationHandler.kt:238`); this
  desktop sends no pushes. No carrier that the phones skip is known (see
  Unresolved 1). Accepted under development mode, as for other kinds.
- One more store row per peer device.
- A person with one old device gets the fallback on every device.

## Testing

- Codec: the vector above in the desktop and pca codecs; a decoder ignores
  trailing bytes after `features`; unknown bits survive a round trip.
- Unit: intersection over devices; a device with no entry is baseline;
  `deviceRemoved` drops the entry; a newer timestamp replaces an older set;
  the fallback table, one case per row.
- e2e (M20): desktop → baseline peer: HOP; desktop → capable peer: Bulletin
  variant; desktop → a peer with a capable desktop and a baseline device:
  HOP.

## Compatibility

- New kind 252, sent freely (development mode). Phone apps show unsupported
  once (Drawbacks).
- Once both sides send `capabilities`, development-mode sending of other
  extension kinds ends for that peer: every kind is gated by the table above.
  A peer with no entry gets base forms only.
- `pca` and the desktop must ship receive before they gate sends; else two
  new clients treat each other as baseline until the first message.

## Prior Art

- **Signal** device capabilities: each linked device reports a set; the
  server derives the account's capability in one of three modes, one being
  "the account will have the capability iff all devices on the account have
  the capability" (`Signal-Server`,
  `service/src/main/java/org/whispersystems/textsecuregcm/storage/DeviceCapability.java`,
  fetched 2026-09-24). Our intersection is that mode, done by the sender.
- **XMPP XEP-0115 Entity Capabilities** (Stable, v1.6.0, 2022-03-08,
  https://xmpp.org/extensions/xep-0115.html, fetched 2026-09-24): a hash of
  the feature set in presence, cached by the `ver` string, with a disco#info
  query on a miss. We send the set itself (43 bytes) and privately.
- **Matrix** fallback body: "If a client cannot display the given `msgtype`
  then it SHOULD display the fallback plain text `body` key instead"
  (matrix-spec `content/client-server-api/modules/instant_messaging.md`,
  fetched 2026-09-24).
- **XMTP** content-type fallback: "If the recipient's app doesn't support
  your custom type, it can display the `fallback` text instead"; senders
  should "always provide a `fallback` string"
  (https://docs.xmtp.org/chat-apps/content-types/fallback, fetched
  2026-09-24).
- The base spec has neither: an unknown content is an unsupported message.
  Capabilities let the sender choose, since the receiver cannot fall back.

All four were read on the public pages named; the Signal client-side
handling (how clients read the account capability) is **unverified**.

## Unresolved Questions

1. **A carrier baseline clients skip.** Candidates: a trailing field after
   `data` in `Request` or `MultiDeviceRequest` (only safe if the Android and
   iOS decoders ignore trailing bytes: **unverified**), or a field in
   `RequestContentV2` for the requester. Without one, the first message shows
   one unsupported bubble on a phone.
2. **Does chat-spec want it?** Upstream could adopt `capabilities` as a base
   kind (then future phone builds hide it) with 0014, or prefer a
   per-message fallback text (Matrix and XMTP style), which costs bytes on
   every message. Owner decides when to propose (plan step 4).
3. **Own devices.** The person's own other devices receive our sent messages
   through the mds sync channel, not the statement. A baseline phone of the
   sender would get our Bulletin variant as unsupported. Include own devices
   in the intersection (they would need to exchange sets over sync)?
4. **Kinds bitmap or list?** 32 fixed bytes versus a sorted `Vec<u8>` (about
   30 bytes today). The bitmap is simpler to intersect.
5. **Dialect of an incoming HOP file.** The message does not say which
   dialect the sender used. A receiver tries `legacy` then `aesGcm` (the
   AEAD tag tells). Should `P2PMixnetFile` gain a dialect field upstream?
6. **HOP ack with several own devices** (the "claim, do not ack" rule
   above) needs the sibling device list, which mds gives; confirm with the
   phone team that the promotion fallback is reliable.
