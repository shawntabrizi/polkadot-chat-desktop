# Test vectors: spec 0008 v2 (botInfo with a balance hint)

Produced by the `pca` codec (`polkadot-chat-agents` branch `desktop/rfc-0003`,
`bot-core/vendor/app-chat-codec.mjs`: `encodeOpaqueBotInfoMessage` with
`balance`) on 2026-09-23. The same bytes are pinned in
`bot-core/test/codec.test.mjs` (`BOT_INFO_BALANCE_VECTOR`). A second codec
must decode the vector to the values below and must encode the values below
to the same bytes.

Conventions are the same as `vectors-0008.md`. `Bytes` is a SCALE compact
length, then the bytes. `Option<T>` is `0x00` (None) or `0x01` then `T`.
`u128` is 16 bytes, little-endian.

Content layout (v2):

```
BotInfo = { kind: u8, name: String, description: String, greeting: String,
            commands: Vec<Command>, version: u16 LE,
            balance: Option<BalanceHint> }                    // v2, appended
BalanceHint = { chainId: String, contract: Bytes (20), selector: Bytes (4),
                decimals: u8, unit: String, perReply: Option<u128 LE>,
                label: String }
```

## Compatibility rules

- **Decoder.** When the content ends right after `version` (every v1
  encoder), `balance` is `null`. A `0x00` byte after `version` is also
  `null`. `0x01` is followed by the hint. Any other byte there makes the
  message undecodable (the rest of the batch still decodes).
- **Encoder (`pca`).** With no hint it writes nothing after `version`, so a
  document without a hint keeps its v1 bytes and `vectors-0008.md` still
  holds. With a hint it writes `0x01` and the hint.
- The `pca` encoder refuses: a `contract` that is not 20 bytes, a `selector`
  that is not 4 bytes, `decimals` outside 0–255, an empty `chainId`, an empty
  `unit` or one over 16 characters, an empty `label` or one over 40
  characters, a `perReply` outside u128.
- The `pca` decoder bounds `chainId` at 256 bytes, `unit` at 64 bytes and
  `label` at 160 bytes (4 bytes per character).

## Vector: `botInfo` with the Meter balance hint

Values: the BOT-1 document of `vectors-0008.md`, plus:

```
balance:
  chainId:  "0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2"
  contract: 0x30b0c001431a1addb8c11a060ada4d6a7033cf21
  selector: 0x70a08231          // keccak256("balanceOf(address)")[0..4]
  decimals: 18
  unit:     "PAS"
  perReply: 100000000000000000  // 0.1 PAS in the contract's 1e18 scale
  label:    "with Meter"
```

Opaque message (258 bytes):

```
010414424f542d310030fd779001000000f40114477569646558506f6c6b61646f7420737570706f7274206775696465684869212041736b206d652061626f757420506f6c6b61646f742e081c7374616b696e67385374616b696e672062617369637328676f7665726e616e636544486f77204f70656e476f7620776f726b7301000109013078643665656332363133353330356138616432353761323064303033333537323834633861613033643062646232623335376162306132323337316531316566325030b0c001431a1addb8c11a060ada4d6a7033cf211070a08231120c5041530100008a5d7845630100000000000000002877697468204d65746572
```

Remote message (256 bytes) is the same without the first two bytes `0104`.

Field by field. The rows from `14` (messageId length) to `0100` (version) are
the same bytes as in `vectors-0008.md`; only the outer length and the tail
differ.

| Bytes (hex) | Field | Value |
|---|---|---|
| `0104` | compact length of the remote message | 256 (two-byte mode: `0x0401 >> 2`) |
| `14` … `0100` | messageId … version | as in `vectors-0008.md` (BOT-1, version 1) |
| `01` | balance: Option tag | Some |
| `0901` | compact length of chainId | 66 (two-byte mode: `0x0109 >> 2`) |
| `307864366565633236313335333035613861643235376132306430303333353732383463386161303364306264623262333537616230613232333731653131656632` | chainId (UTF-8) | `"0xd6eec261…71e11ef2"` |
| `50` | compact length of contract | 20 |
| `30b0c001431a1addb8c11a060ada4d6a7033cf21` | contract | the Meter contract |
| `10` | compact length of selector | 4 |
| `70a08231` | selector | `balanceOf(address)` |
| `12` | decimals, u8 | 18 |
| `0c` | compact length of unit | 3 |
| `504153` | unit | `"PAS"` |
| `01` | perReply: Option tag | Some |
| `00008a5d784563010000000000000000` | perReply, u128 LE | 100000000000000000 |
| `28` | compact length of label | 10 |
| `77697468204d65746572` | label | `"with Meter"` |

## How a client uses the hint

Read `contract.selector(caller)` with `ReviveApi_call` at the best block on
each new block while the room is open. The calldata is the selector plus the
caller's H160 left-padded to 32 bytes (the H160 is pallet-revive's mapping of
the chat account, see `contracts/meter.md`). The return is one 32-byte
big-endian `uint256`. Show `label: value / 10^decimals unit`, and, when
`perReply` is set, `~floor(value / perReply) replies`. Example for Alice
(`0x9621dde636de098b43efb0fa9b61facfe328f99d`):

```
0x70a082310000000000000000000000009621dde636de098b43efb0fa9b61facfe328f99d
```

## Hints the `pca` bots send (devnet, 2026-09-23)

| Bot | contract | selector | decimals | unit | perReply | label |
|---|---|---|---|---|---|---|
| `pcdmeter.01` | `0x30b0c001431a1addb8c11a060ada4d6a7033cf21` (Meter) | `0x70a08231` `balanceOf(address)` | 18 | PAS | 100000000000000000 | with Meter |
| `pcdflip.44` | `0x68b113b3ad6abbe9177997ea4645313c72656b58` (Flip) | `0x42623360` `stakeOf(address)` | 18 | PAS | none | your stake |

Both use chainId `0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2`.
