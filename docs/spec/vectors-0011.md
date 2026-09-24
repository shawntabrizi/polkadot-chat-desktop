# Test vectors: spec 0011 (private groups v2)

Status: **(a)–(g) reproduced byte for byte by the pca codec** (2026-09-24,
`polkadot-chat-agents` branch `desktop/rfc-0003`: `bot-core/lib/group-codec.mjs`,
`lib/group-keys.mjs`, kind 249 in `vendor/app-chat-codec.mjs`; pinned in
`bot-core/test/codec.test.mjs`). (h)–(j) and the sealed state in (c) were
computed by that codec (keyed BLAKE2b-256 from `@noble/hashes` 2.2.0,
AES-256-GCM and X25519 from Node `crypto`, Sr25519 from `@scure/sr25519`);
the desktop codec must reproduce them before `content.spec.ts` pins them. The
first drafts were computed on 2026-09-24 with a throwaway script. A
disagreement is a bug in this file until proven otherwise.

Conventions are those of `vectors-0009.md`: `String` = compact length + UTF-8;
`Vec<T>` = compact count + items; `u16`/`u32`/`u64` little-endian;
`AccountId` = 32 raw bytes; `[u8; N]` raw, no length; `Option<T>` = `00` or
`01` + T; `bool` = `00`/`01`; enums = one index byte + the variant. The opaque
message is a compact length then the remote message (`messageId: String`,
`timestamp: u64`, version `00`, content kind byte, content).
`khash(key, x)` = keyed BLAKE2b-256. AEAD = AES-256-GCM, 12-byte nonce, the
16-byte tag appended to the ciphertext.

## Layouts

```
// On the group topic (statement data)
GroupData     = enum { messages(Sealed) = 0, state(Sealed) = 1, rekey(Rekey) = 2 }
Sealed        = { nonce: [u8; 12], ciphertext: Vec<u8> }
GroupMessages = { from: AccountId, topic: Option<u32>, messages: Vec<Vec<u8>> }
GroupState    = { groupId: String, epoch: u32, version: u32, name: String,
                  avatar: Option<[u8; 32]>, defaultPermissions: u16, slowModeSecs: u32,
                  joinPolicy: u8, historyShare: u8, members: Vec<Member>,
                  invites: Vec<Invite>, pinned: Vec<String>, topics: Option<Vec<u8>>,
                  createdAt: u64 }
Member        = { account: AccountId, role: u8, permissions: u16,
                  posting: Vec<AccountId>, joinedAt: u64 }
Invite        = { inviteId: [u8; 16], secret: [u8; 16], createdBy: AccountId,
                  expiresAt: u64, maxUses: u32, uses: u32 }
Rekey         = { newEpoch: u32, entries: Vec<RekeyEntry> }
RekeyEntry    = { hint: [u8; 8], nonce: [u8; 12], box: [u8; 48] }

// Pairwise, content kind 249 (0xf9)
GroupControl  = enum { welcome = 0, joinRequest = 1, joinDecision = 2, history = 3, keyRequest = 4,
                       historyRequest = 5 /* pca proposal, see (h) */ }
Welcome       = { groupId: String, epoch: u32, epochKey: [u8; 32], stateVersion: u32, stateHash: [u8; 32] }
JoinRequest   = { groupId: String, inviteId: [u8; 16], proof: [u8; 32], note: String }
JoinDecision  = { groupId: String, inviteId: [u8; 16], status: u8 }
History       = { groupId: String, items: Vec<HistoryItem>, last: bool }
HistoryItem   = { from: AccountId, message: Vec<u8> }
KeyRequest    = { groupId: String, haveEpoch: u32 }
HistoryRequest = { groupId: String, since: HistorySince, limit: u8 /* 1..=100 */ }   // pca proposal
HistorySince  = enum { messageId(String) = 0, timestamp(u64) = 1 }

// Link fragment (base64url, no padding)
InviteLink    = { groupId: String, name: String, admins: Vec<AccountId>, inviteId: [u8; 16], secret: [u8; 16] }
```

Decoder bounds: members 1..=1024, posting ≤ 8, invites ≤ 16, pinned ≤ 10,
name ≤ 240 bytes, note ≤ 560 bytes, `GroupMessages` plaintext ≤ 4096 bytes,
`topic` and `topics` MUST be `None` (a `Some` makes the item undecodable in
v2). A `groupControl` or group kind (246–249) inside `GroupMessages.messages`
is undecodable, except `groupLeave` (248).

## Fixed inputs

```
groupId  "GRP-2"          K_1 = 0x11 × 32 (epoch 1)
A = 0x01 × 32 (owner)     B = 0x02 × 32 (member)
K(A, B) = 0x55 × 32 (stand-in for the Appendix A secret)   K_2 = 0x66 × 32
```

## Vector (a): derivations for epoch 1

| Value | Input | Result (hex) |
|---|---|---|
| `Topic_1` | `khash(K_1, b"grp-topic" : 144752502d32 : 01000000)` | `1050ae1226c62b347cb32a7ee60a8dee9b183987090b7ca075346d38fb466c78` |
| `MsgKey_1` | `khash(K_1, b"grp-msg")` | `8934a29c1ff0f0abca5fff48cf5eb15e9acfa1e4be0fbd8593f790fb23145267` |
| `ChMsgs_1` | `khash(K_1, b"grp-ch-msgs")` | `4ed5fab5021a794bd7159322654353d2b5736ebc8cc93196cf0c26f1395c7450` |
| `ChState_1` | `khash(K_1, b"grp-ch-state")` | `e1be9084dc06e458f7caece2db5d292dac751f558d9d94b346079a774401f9a6` |
| `ChRekey_1` | `khash(K_1, b"grp-ch-rekey")` | `5b7884e5795aaf767f27d9325455c20c4f8f22bb1215547041eb97e7bd98ce68` |

`encode(groupId)` is `14 4752502d32` (compact 5, then the bytes).

## Vector (b): a `messages` carrier from A

Inner message: `messageId "GM-1"`, `timestamp 1720000002000`, text `"hello all"`.
Opaque (26 bytes): `6410474d2d31d037fd779001000000002468656c6c6f20616c6c`.

`GroupMessages` plaintext (60 bytes):

```
0101…01 (32)  00  04  6410474d2d31d037fd779001000000002468656c6c6f20616c6c
from          topic=None  count=1  the opaque message
```

AAD = `b"grp" : A : u32 1 : 00` =
`6772700101010101010101010101010101010101010101010101010101010101010101010100000000`.
Nonce = `0x22 × 12`.

`GroupData` (statement data, 91 bytes):

```
00222222222222222222222222 3101 518aa1d987c3ea031a7f5dfbbd628c3b24df6ceb1d68d3f221124b081a8a13f4bc10f3e660ffffb80f63986e753af4a14a6cb2b6907021b02005049ca426a27af4b8387496497accf455808c
```

| Bytes | Field |
|---|---|
| `00` | `GroupData::messages` |
| `22` × 12 | nonce |
| `3101` | compact 76 (two-byte mode) |
| 76 bytes | AES-256-GCM(`MsgKey_1`) ciphertext (60) + tag (16) |

## Vector (c): `GroupState` version 1 (214 bytes)

Values: epoch 1, version 1, name `"Test group"`, no avatar, default
permissions `0x0001`, slow mode 0, join policy 1, history 100; members A
(owner, `0x00ff`, joined 1720000000000) and B (member, `0x0001`, joined
1720000001000), no posting accounts; one invite (`inviteId 0x33 × 16`,
`secret 0x44 × 16`, by A, no expiry, no limit, 0 uses); no pins; topics None;
createdAt 1720000000000.

```
144752502d32 01000000 01000000 28546573742067726f7570 00 0100 00000000 01 64
08
0101…01 02 ff00 00 0030fd7790010000
0202…02 00 0100 00 e833fd7790010000
04 3333…33 4444…44 0101…01 0000000000000000 00000000 00000000
00 00 0030fd7790010000
```

Full hex:
`144752502d32010000000100000028546573742067726f757000010000000000016408010101010101010101010101010101010101010101010101010101010101010102ff00000030fd7790010000020202020202020202020202020202020202020202020202020202020202020200010000e833fd779001000004333333333333333333333333333333334444444444444444444444444444444401010101010101010101010101010101010101010101010101010101010101010000000000000000000000000000000000000030fd7790010000`

`stateHash = blake2b_256(state)` (unkeyed) =
`71cdf88d55888efd322a22deb910897cbfb109fda0ee53eb5fc6860176101d35`.

The sealed `state` statement, signer A, nonce `0x23 × 12`, AAD
`b"grp" : A : u32 1 : 01` =
`67727001010101010101010101010101010101010101010101010101010101010101010100000001`.
`GroupData` (245 bytes: `01`, nonce, `9903` = compact 230, 214 bytes of
ciphertext + 16 of tag):

`012323232323232323232323239903123e6e97e44666b0255a664e8591e892283d70e77f62004ad60790d61c648caa5c5a7b5bffb73587cc5090001c58fb1e5525272ed171093f2a02a5a5b16bfd7f04067005123e351149441cdc0cb5e5ad47873dd0f63a43e6af6f6713b8a985073af067857637472b08de6b2d0fe240d1170ebcf12ed226d59f13bd374c5f2a6404a468304517b19ad17ed442e145aae68934f09c6cb514d61654f41c62b8753f341d3ae3e5a6c79e38863465961da9479baf2993e8bf5c57b9c5b78144b3a980b3c28d848e7609d635619824de6f2f3485505d9159959701c8deaadc4039bc3d496fa4c22a21`

## Vector (d): `welcome` to B (opaque, 96 bytes)

`messageId "GW-1"`, `timestamp 1720000003000`, epoch 1, `K_1`, state version 1,
the hash from (c).

```
7901 1047572d31 b83bfd7790010000 00 f9 00 144752502d32 01000000 1111…11 01000000 71cdf88d…1d35
```

Full hex:
`79011047572d31b83bfd779001000000f900144752502d320100000011111111111111111111111111111111111111111111111111111111111111110100000071cdf88d55888efd322a22deb910897cbfb109fda0ee53eb5fc6860176101d35`

`7901` is compact 94, the remote message length.

## Vector (e): `joinRequest` from B (opaque, 75 bytes)

`proof = khash(0x44 × 16, b"grp-join" : B)` =
`eba5b4f507de6b1f6405fafdfe30c0da870c1ba104d36e9cb9a5f6a61ece560f`.
Note `"hi"`.

Full hex:
`250110474a2d31a03ffd779001000000f901144752502d3233333333333333333333333333333333eba5b4f507de6b1f6405fafdfe30c0da870c1ba104d36e9cb9a5f6a61ece560f086869`

## Vector (f): rekey entry for B, epoch 2

| Value | Result (hex) |
|---|---|
| `WrapKey(A, B, 2) = khash(K(A,B), b"grp-wrap" : 144752502d32 : 02000000)` | `a235cd89db89439c9653c8c57b87270814dee0f85bd96269118c6f8eb1507422` |
| `hint` = first 8 bytes of `khash(WrapKey, b"grp-hint")` | `e88435e61ddfce6b` |
| `box` = AES-256-GCM(WrapKey, nonce `0x77 × 12`, `K_2`, AAD `02000000`) | `15a235403c6ceca6c1243940b92fc447b3f19cddef5f65f531d7808e482be8a0e7293d5f70648b5dab4a0c43a1bf80c6` |

`RekeyEntry` = `e88435e61ddfce6b` ‖ `77 × 12` ‖ box (68 bytes). A full `Rekey`
with a real `K(A, B)` is vector (i).

## Vector (g): invite link

`InviteLink { "GRP-2", "Test group", [A], 0x33 × 16, 0x44 × 16 }` =
`144752502d3228546573742067726f75700401010101010101010101010101010101010101010101010101010101010101013333333333333333333333333333333344444444444444444444444444444444`,
base64url:
`FEdSUC0yKFRlc3QgZ3JvdXAEAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEzMzMzMzMzMzMzMzMzMzMzRERERERERERERERERERERA`.

## Vector (h): history, joinDecision, keyRequest, historyRequest (opaque)

`history` (84 bytes): `messageId "GH-1"`, `timestamp 1720000005000`, one item
from A carrying the opaque message of (b), `last = true`:
`49011047482d318843fd779001000000f903144752502d320401010101010101010101010101010101010101010101010101010101010101016410474d2d31d037fd779001000000002468656c6c6f20616c6c01`

`joinDecision` (40 bytes): `"GD-1"`, `1720000006000`, invite `0x33 × 16`, status 0 (pending):
`9c1047442d317047fd779001000000f902144752502d323333333333333333333333333333333300`

`keyRequest` (27 bytes): `"GK-1"`, `1720000007000`, `haveEpoch 1`:
`6810474b2d31584bfd779001000000f904144752502d3201000000`

`historyRequest` (pca proposal for the reviewer's "history on request"; 0011
names the request but its enum has no variant for it). Since `messageId
"GM-1"`, limit 100 (30 bytes, `"GQ-1"`, `1720000008000`):
`741047512d31404ffd779001000000f905144752502d320010474d2d3164`
Since `timestamp 1720000000000`, limit 50 (33 bytes, `"GQ-2"`, `1720000008000`):
`801047512d32404ffd779001000000f905144752502d32010030fd779001000032`

## Vector (i): a real `K(A, B)` and a full `Rekey` with 3 entries

Identity chat keys (X25519, the base spec's `//wallet//chat` keypair as the
network uses it since the 2026-09-08 migration; not P-256):
private A = `0x0a × 32`, B = `0x0b × 32`, C = `0x0c × 32`.

| Value | Result (hex) |
|---|---|
| public A | `f77ff4b10788bfdca62ca0bb160d427cf5762d85f2b5cad6807ec9c3febbde09` |
| public B | `73b2d8b76aa9b53660032bc8f5d8bee3a3ae4e3b3a7fd49ade81f7347a34aa68` |
| public C | `97c3b10b4d6c133a78ea5dcc1cf6421d3f81ae37b1f628ce14ca6fce7730f333` |
| `K(A, B)` = X25519(priv A, pub B) = X25519(priv B, pub A), raw (no HKDF: the value that keys `SessionId`) | `c09d8a17f54f06a53f844eacbc6273017581b9bc53b5f31f3d338cc3ffd7b86b` |
| `K(A, A)` (the admin's own entry) | `064b7cec534810674268cef049e065e9bd363d131a4a09a42be2059a9fb8ab61` |
| `K(A, C)` | `cf41b439fa7668d5fe9909b55584224eb2d94140dd93fb300232a881cebd2317` |
| `WrapKey(A, B, 2)` | `a8e7aed9504f25bc13fd30a10a13885b037080c5e78821ecbeabe87a00364045` |

Admin A opens epoch 2 with `K_2 = 0x66 × 32` for members A, B and C; entry
nonces `0x77 × 12` (A), `0x78 × 12` (B), `0x79 × 12` (C). Entries sorted by
hint: A `b15f17a0bfb8af0b`, C `c4308e7ad84cbaf7`, B `efe9e3c7fbfce4f5`.

`GroupData::rekey` (210 bytes: `02`, `newEpoch 02000000`, `0c` = compact 3,
3 × 68):

`02020000000cb15f17a0bfb8af0b777777777777777777777777dbd8cd740c9be5aab7e6491eb762d54cbafd76ba4e16172d4e39314bc80732091243fc23c759246c06ee2d11dc7ad59dc4308e7ad84cbaf7797979797979797979797979ef6aa68e222cbad29059038d624cb81b494e7174997965653bb378e63dcc1645d5adf5f8b63e8d1e3d412ba949d6ce22efe9e3c7fbfce4f5787878787878787878787878ee0eee9d9efd1676595fdb40359409c67530e199c596ae7edcfad16406b2c74731552a15be72a6aa22e5affed6d32862`

B opens its entry with `K(B, A)` and gets `0x66 × 32`; so does C; a fourth
key (`0x0d × 32`) finds no entry.

## Vector (j): a full `GroupStatement` (Sr25519 proof)

Signer: the Sr25519 key of mini-secret `0x01 × 32`, path `//wallet` =
`a83e8af1ed0f17a66fbf999cde3e95b2afb987e1eed2f762716d86d731263550` (so
`from` and the AAD signer are this key, not `0x01 × 32`). Same message, `K_1`
and nonce `0x22 × 12` as (b):

`GroupData` (91 bytes):
`002222222222222222222222223101f8b52a296bcdfca474c1c566625d18888a67ea0bf2bb2591517eccde2aad27a5bc10f3e660ffffb80f63986e753af4a14a6cb2b6907021b02005049c7bc7441d8decf3a59fa0041c117ae7ec`

`expiry` at now = 1_790_000_000: `(now + 1_209_600) << 32 | (now − 1_763_164_800)` = `0x6ac3b08001997900`.

`signature_material` = `encode(expiry) : encode(channel = ChMsgs_1) :
encode(topic1 = Topic_1) : encode(data)` with the `Field` index bytes 02,
03, 04, 08 (169 bytes):
`020079990180b0c36a034ed5fab5021a794bd7159322654353d2b5736ebc8cc93196cf0c26f1395c7450041050ae1226c62b347cb32a7ee60a8dee9b183987090b7ca075346d38fb466c78086d01002222222222222222222222223101f8b52a296bcdfca474c1c566625d18888a67ea0bf2bb2591517eccde2aad27a5bc10f3e660ffffb80f63986e753af4a14a6cb2b6907021b02005049c7bc7441d8decf3a59fa0041c117ae7ec`

The statement (268 bytes) = `14` (compact 5 fields) ‖ `00` (field `proof`)
‖ `00` (Sr25519) ‖ signature (64) ‖ signer (32) ‖ `signature_material`.
Sr25519 signatures are randomized, so only the signature bytes change between
runs; one run:
`140000c07d1cb890fbcd8d7fb09fc6ed22a57edc8ffa23106563b7aaea5fa9edc6054ad92a2371676dba0395529fd05e04ac2bacdc3c059e38d241f265bc9ae324ff85a83e8af1ed0f17a66fbf999cde3e95b2afb987e1eed2f762716d86d731263550020079990180b0c36a034ed5fab5021a794bd7159322654353d2b5736ebc8cc93196cf0c26f1395c7450041050ae1226c62b347cb32a7ee60a8dee9b183987090b7ca075346d38fb466c78086d01002222222222222222222222223101f8b52a296bcdfca474c1c566625d18888a67ea0bf2bb2591517eccde2aad27a5bc10f3e660ffffb80f63986e753af4a14a6cb2b6907021b02005049c7bc7441d8decf3a59fa0041c117ae7ec`

A checker verifies the signature over `signature_material` with the signer
key and compares everything else byte for byte.
