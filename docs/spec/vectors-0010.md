# Test vectors: spec 0010 (bot directory, `botCard` kind 251)

Status: **draft, not yet cross-checked by a second codec.** Computed on
2026-09-24 with a throwaway Node script: SCALE by hand, BLAKE2b-256 from
`@noble/hashes`, sr25519 from `@scure/sr25519` (the desktop's
`node_modules`). The topic hashes and `info.hash` were recomputed with
Python `hashlib.blake2b(digest_size=32)` and match. The pca codec and the
desktop codec must each reproduce these bytes before they are pinned. A
disagreement is a bug in this file until proven otherwise.

Conventions as `vectors-0012.md`: `String` = compact length + UTF-8;
`Vec<T>` = compact count + items; `u16`/`u32`/`u64`/`u128` little-endian;
`[u8; N]` raw, no length; `Option<T>` = `00` or `01` + T; enums = one index
byte + the variant. Kind 251 = `0xfb`.

## Layout

```
statement data = 0xfb : encode(BotCard)

BotCard = {
    version: u8, username: String, name: String, tagline: String, kind: u8,
    tags: Vec<String>, info: InfoRef, pricing: Pricing, capabilities: u32,
    operator: Option<OperatorClaim>, issuedAt: u64
}
InfoRef       = { version: u16, hash: [u8; 32] }
Pricing       = enum { free = 0,
                       perReply { amount: u128, decimals: u8, unit: String } = 1,
                       varies { note: String } = 2 }
OperatorClaim = { account: [u8; 32], username: String, validUntil: u64, signature: [u8; 64] }

operator message = b"pcd-bot-operator-v1" : botAccount : u64_le(validUntil)
expiry           = (issuedAt + 259200) << 32        // 72 h, sequence 0
```

## Topics and channel

| Name | Preimage | blake2b_256 |
|---|---|---|
| directoryTopic | `50` + `"pcd-bot-directory-v1"` | `72c70e52ebcd578658622a47d7a6e0917926327c2ac44aebf4ffc45fe1484559` |
| cardChannel | `5c` + `"pcd-bot-card-channel-v1"` | `f633f140cf394c0120a213831eada5b453c434e4ed3e869ed3d558ab0f5fd1f8` |
| tagTopic("assistant") | `50 "pcd-bot-directory-v1"` `24 "assistant"` | `f3dd570749930ed37229b67ca5ebbb7a387c68af88305b66cd633f5f9a076379` |
| tagTopic("payments") | `50 …` `20 "payments"` | `36e5b7eec38e876d6732b9d3c12ba7b993b2d314ebd01c055498a82ea6789b5b` |
| tagTopic("game") | `50 …` `10 "game"` | `c919850eb64495b47f3c19e9a965b157cceabf4e45aceb5e89e4c2029cf2444e` |
| tagTopic("utility") | `50 …` `1c "utility"` | `4ae83b245b032c8147c33117fb1ccd5ec9193736df8e2210c138ceb68fdb03f4` |
| cardTopic(bot) | `3c "pcd-bot-card-v1"` + bot account below | `34be66cd580aa71f7acd16666b0799b8a716e26140112de2e9dd7155ab75184f` |

## Keys used

sr25519 mini-secrets (test only): bot = `0x55 × 32`, operator = `0x44 × 32`.

| | Public key (account) |
|---|---|
| bot | `b41236c517514b30a4d6619f4b4354a2ce593cd4b64a7c29dd45e3de6972997a` |
| operator | `98eb422c44ae7f2effe51fc271514ca3d5b6ce61d00c26d43f23944d8e38a454` |

## Vector B1: a card with no operator (the Guide)

`info.hash` = blake2b_256 of the BotInfo content of `vectors-0008.md` (the
remote message after `messageId`, `timestamp`, `version` and the kind byte
`f4`):

```
content = 0114477569646558506f6c6b61646f7420737570706f7274206775696465684869212041736b206d652061626f757420506f6c6b61646f742e081c7374616b696e67385374616b696e672062617369637328676f7665726e616e636544486f77204f70656e476f7620776f726b730100
hash    = db92219c04fe1c1f000edfc1d6c4cbab6ca2e7583cbd443ba142e5626e7d1ac9
```

Values: version 1, username `"pcdguide.70"`, name `"Guide"`, tagline
`"Polkadot support with buttons"`, kind 1, tags `["assistant"]`, info
`{ version: 1, hash: above }`, pricing `free`, capabilities `0x1d` (bits 0,
2, 3, 4: buttons, groups v1, groups v2, attachments received; illustrative),
operator none, issuedAt 1790000000 (2026-09-21 14:13:20 UTC).

Statement data (110 bytes):

```
fb012c70636467756964652e373014477569646574506f6c6b61646f7420737570706f7274207769746820627574746f6e73010424617373697374616e740100db92219c04fe1c1f000edfc1d6c4cbab6ca2e7583cbd443ba142e5626e7d1ac9001d00000000803bb16a00000000
```

| Bytes (hex) | Field | Value |
|---|---|---|
| `fb` | kind | 251 `botCard` |
| `01` | version | 1 |
| `2c` | compact length of username | 11 |
| `70636467756964652e3730` | username | `"pcdguide.70"` |
| `14` `4775696465` | name | `"Guide"` |
| `74` `506f6c6b61646f7420737570706f7274207769746820627574746f6e73` | tagline | 29 bytes |
| `01` | kind | 1 agent |
| `04` | compact count of tags | 1 |
| `24` `617373697374616e74` | tags[0] | `"assistant"` |
| `0100` | info.version, u16 | 1 |
| `db92…1ac9` | info.hash | above |
| `00` | pricing | `free` |
| `1d000000` | capabilities, u32 | `0x1d` |
| `00` | operator | none |
| `803bb16a00000000` | issuedAt, u64 | 1790000000 |

Statement fields: topics `[directoryTopic, cardTopic(signer),
tagTopic("assistant")]`, channel `cardChannel`, expiry
`0x6ab5300000000000` (1790259200 << 32; SCALE bytes `000000000030b56a`).
The `cardTopic` in the table above is for the test bot key, not for the
real `pcdguide.70` account.

## Vector B2: a card with pricing and an operator (the Meter)

Operator message (59 bytes), `validUntil` = 1821536000 (2027-09-21 14:13:20 UTC):

```
7063642d626f742d6f70657261746f722d7631 b41236c517514b30a4d6619f4b4354a2ce593cd4b64a7c29dd45e3de6972997a 006f926c00000000
```

(context `"pcd-bot-operator-v1"`, bot account, `u64_le(validUntil)`; no
spaces in the real bytes.)

A valid signature by the operator key over it (sr25519 signatures are
randomized: a signer produces different bytes each time; this vector is for
**verify only**):

```
c279912db70667de1057c5f08cbe4c7f674aa3d817670148fc107abfef919c25afe2eb2e12f30994bedb95c24e93ccae8dca6c4fadb74762a38b64309bb41b81
```

Pricing `perReply { amount: 1000000000, decimals: 10, unit: "PAS" }`
(0.1 PAS):

```
01 00ca9a3b000000000000000000000000 0a 0c504153
```

Values: version 1, username `"pcdmeter.01"`, name `"Meter"`, tagline
`"A paid assistant, 0.1 PAS per reply"`, kind 1, tags
`["payments", "assistant"]`, info `{ version: 3, hash: 0x66 × 32 }`
(placeholder), pricing above, capabilities `0x43` (buttons, tx, balance
hint), operator `{ account: operator key, username: "pcdops.12",
validUntil: 1821536000, signature: above }`, issuedAt 1790000000.

BotCard (259 bytes; the statement data is `fb` followed by these):

```
012c7063646d657465722e3031144d657465728c41207061696420617373697374616e742c20302e312050415320706572207265706c790108207061796d656e747324617373697374616e74030066666666666666666666666666666666666666666666666666666666666666660100ca9a3b0000000000000000000000000a0c504153430000000198eb422c44ae7f2effe51fc271514ca3d5b6ce61d00c26d43f23944d8e38a454247063646f70732e3132006f926c00000000c279912db70667de1057c5f08cbe4c7f674aa3d817670148fc107abfef919c25afe2eb2e12f30994bedb95c24e93ccae8dca6c4fadb74762a38b64309bb41b81803bb16a00000000
```

Topics: `[directoryTopic, cardTopic(signer), tagTopic("payments"),
tagTopic("assistant")]`.

## Vector B3: pricing `varies`

`varies { note: "stake 0.5 PAS per flip" }`:

```
02587374616b6520302e35205041532070657220666c6970
```

## Negative checks

A codec or client MUST reject or drop:

1. Data whose first byte is not `fb`, or `version` ≠ 1.
2. B1 with the tag `"Assistant"` (upper case) or a sixth tag.
3. B1 with a tagline of 81 characters, or an empty name.
4. B2's signature against `validUntil` + 1 (the verify fails; checked with
   the script).
5. B2's claim with `operator.account` = the bot account (ignored, card kept).
6. Any card over 1,024 bytes.
7. A card whose statement topics do not include `directoryTopic` and
   `cardTopic(signer)`.

## Not computable here

- The statement proof (the bot's sr25519 signature over the statement
  fields): randomized, and it depends on the statement encoding of the
  store; the M17 e2e checks it end to end on devnet.
- The real `cardTopic` values of the fleet bots: they need the bots'
  accounts, read in M17 from `~/.pca/bots/<bot>/config.json`.
