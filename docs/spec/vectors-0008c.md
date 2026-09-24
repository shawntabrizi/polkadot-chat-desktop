# Test vectors: spec 0008 v3 (`pending` on the balance hint)

Produced by the `pca` codec (`polkadot-chat-agents` branch `desktop/rfc-0003`,
`bot-core/vendor/app-chat-codec.mjs`: `encodeOpaqueBotInfoMessage` with
`balance.pending`) on 2026-09-23. The same bytes are pinned in
`bot-core/test/codec.test.mjs` (`BOT_INFO_PENDING_VECTOR`). A second codec
must decode the vectors to the values below and must encode the values below
to the same bytes.

Conventions are the same as `vectors-0008.md` and `vectors-0008b.md`.
`Bytes` is a SCALE compact length, then the bytes. `Option<T>` is `0x00`
(None) or `0x01` then `T`. `u128` is 16 bytes, little-endian.

Content layout (v3): one field appended at the end of `BalanceHint`.

```
BotInfo = { kind: u8, name: String, description: String, greeting: String,
            commands: Vec<Command>, version: u16 LE,
            balance: Option<BalanceHint> }                    // v2, appended
BalanceHint = { chainId: String, contract: Bytes (20), selector: Bytes (4),
                decimals: u8, unit: String, perReply: Option<u128 LE>,
                label: String,
                pending: Option<u128 LE> }                    // v3, appended
```

`balance` is the last field of `BotInfo`, and `pending` is the last field of
`BalanceHint`, so `pending` is the last bytes of the message.

## Units

`pending` is in the same unit as the value the hint's `selector` returns (and
as `perReply`): for the Meter that is the contract's 1e18 scale, **not**
plancks. 0.3 PAS = 3_000_000_000 plancks × NativeToEthRatio 10^8 =
300000000000000000 (3 × 10^17). The client shows `(value − pending) /
10^decimals unit`, which is the number the bot's `/balance` shows.

## Compatibility rules

- **Decoder (v3).** When the message ends right after `label` (every v2
  encoder), `pending` is `null`, which means 0. A `0x00` byte after `label` is
  also `null`. `0x01` is followed by the u128. Any other byte there makes the
  message undecodable (the rest of the batch still decodes).
- **Encoder (`pca`).** With `pending` null it writes nothing after `label`, so
  a hint without it keeps its v2 bytes and `vectors-0008b.md` still holds.
  With `pending` set (0 included) it writes `0x01` and the u128. The `pca`
  bot sends `Some(0)` after a charge (nothing owed).
- The `pca` encoder refuses a `pending` outside u128.
- **v2 decoders.** The `pca` v2 decoder stops at `label` and ignores the
  appended bytes. A decoder that rejects bytes after the body (the desktop's
  `decodeWith` does: `codec.enc(decoded).length !== bytes.length`) reads a v3
  message as undecodable. The spec's "decoders that do not know the field
  ignore it" holds only for a decoder that tolerates trailing bytes.

## Vector (a): v2 hint, no `pending` (127 bytes)

The `BalanceHint` bytes alone (after the `0x01` Some tag of `balance`), as in
`vectors-0008b.md`:

```
09013078643665656332363133353330356138616432353761323064303033333537323834633861613033643062646232623335376162306132323337316531316566325030b0c001431a1addb8c11a060ada4d6a7033cf211070a08231120c5041530100008a5d7845630100000000000000002877697468204d65746572
```

A v3 decoder reads it as the `vectors-0008b.md` hint with `pending = null`.

## Vector (b): v3 hint, `pending` = 0.3 PAS (144 bytes)

Values: the Meter hint of `vectors-0008b.md`, plus
`pending: 300000000000000000` (0.3 PAS in the contract's 1e18 scale).

```
09013078643665656332363133353330356138616432353761323064303033333537323834633861613033643062646232623335376162306132323337316531316566325030b0c001431a1addb8c11a060ada4d6a7033cf211070a08231120c5041530100008a5d7845630100000000000000002877697468204d657465720100009e1869d029040000000000000000
```

It is vector (a) plus 17 bytes:

| Bytes (hex) | Field | Value |
|---|---|---|
| `0901` … `77697468204d65746572` | chainId … label | vector (a), unchanged |
| `01` | pending: Option tag | Some |
| `00009e1869d029040000000000000000` | pending, u128 LE | 300000000000000000 (`0x0429d069189e0000`) |

With `pending` = 0 the tail is `01` + `00000000000000000000000000000000`.

## Vector (c): `botInfo` carrying hint (b)

Values: the BOT-1 document of `vectors-0008.md` (messageId `"BOT-1"`,
timestamp 1720000000000, kind 1, name "Guide", two commands, version 1), plus
hint (b).

Opaque message (275 bytes):

```
450414424f542d310030fd779001000000f40114477569646558506f6c6b61646f7420737570706f7274206775696465684869212041736b206d652061626f757420506f6c6b61646f742e081c7374616b696e67385374616b696e672062617369637328676f7665726e616e636544486f77204f70656e476f7620776f726b7301000109013078643665656332363133353330356138616432353761323064303033333537323834633861613033643062646232623335376162306132323337316531316566325030b0c001431a1addb8c11a060ada4d6a7033cf211070a08231120c5041530100008a5d7845630100000000000000002877697468204d657465720100009e1869d029040000000000000000
```

Remote message (273 bytes) is the same without the first two bytes `4504`.

| Bytes (hex) | Field | Value |
|---|---|---|
| `4504` | compact length of the remote message | 273 (two-byte mode: `0x0445 >> 2`) |
| `14` … `77697468204d65746572` | messageId … label | as in `vectors-0008b.md` (from `14` on) |
| `01` | pending: Option tag | Some |
| `00009e1869d029040000000000000000` | pending, u128 LE | 300000000000000000 |

So the remote message is the `vectors-0008b.md` remote message (256 bytes)
with the 17 bytes of `pending` appended; only the outer length changes
(`0104` → `4504`).

## When the `pca` bot sends it (resend rule)

A meter bot (`pcdmeter.01`) whose `botinfo.json` has a `balance` hint:

- **Each metered reply.** The first real message of each metered turn carries
  a `botInfo` (same `version`) whose `pending` includes that reply. It is
  enqueued in the same tick as the reply, so it rides the reply's request
  statement: no extra submission. Log: `BOT_SENT_BOTINFO { on: "pending",
  pending }`.
- **Each charge.** The final `transactionReference` of a charge (status 1, or
  3) carries a `botInfo` with the pending left after the charge (0 unless a
  reply came in meanwhile), in the same statement as the reference.
- **Other sends** (accept, `/start`, catch-up) carry the current pending once
  the bot has read a balance; before that, no `pending`.

The `version` does not change with `pending`. Spec 0008 says "latest
`version` wins"; for `pending` to update, a client must let a `botInfo` with
an equal `version` replace the stored one (the `pca` bot's own store of a
peer's `botInfo` already does this). A `botInfo` with a lower `version` stays
ignored.
