# Flip contract (coin flip, M11b)

Deployed 2026-09-23 by the `pca` agent (`polkadot-chat-agents` branch
`desktop/rfc-0003`, `contracts/flip/`). Source: `contracts/flip/src/Flip.sol`;
PolkaVM bytecode from `forge build --resolc` at
`contracts/flip/out/Flip.sol/Flip.json` (`bytecode.object`, starts with
`0x50564d00` = "PVM\0", 14 090 bytes). Deployed with
`node contracts/flip/deploy.mjs` (papi, `Revive.instantiate_with_code`, no
ETH-RPC). Plain `forge build` and `forge test` write EVM bytecode to the same
path; run `forge build --resolc` again before a deploy (`deploy.mjs` refuses
non-PVM bytecode).

| Item | Value |
|---|---|
| Chain | devnet Asset Hub, `asset-hub-paseo`, para 1000 |
| RPC | `wss://asset-hub-paseo-rpc.n.dwellir.com` (fallback `wss://sys.turboflakes.io/asset-hub-paseo`) |
| Genesis hash (spec 0007 `chainId`) | `0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2` |
| Contract address (H160) | `0x68b113b3ad6abbe9177997ea4645313c72656b58` |
| Deploy block | 13620685 (best block; extrinsic `0x670fff1046bcc2a68711fc86b276e549abfc067d09f6b39cc95b996a3509e21b`) |
| Owner (deployer) | `//Alice` of the public dev phrase: H160 `0x9621dde636de098b43efb0fa9b61facfe328f99d` |
| Bot | `pcdflip.44` (`BOT_FLIP_CONTRACT`); it has no role in the contract and signs nothing |

## Rules

- `stake()` payable takes exactly `STAKE` = 0.5 PAS (`5 * 10^17` in the
  contract, `value: 5000000000` plancks in a `Revive.call` or a TxIntent).
  Any other value reverts `stake is 0.5 PAS`.
- The first stake opens round `round()` (from 1). The same account cannot
  stake twice in one round (`already staked`).
- The second stake settles **in the same call**: the contract picks the
  winner, pays the whole pot (1 PAS) to the winner, emits
  `Matched(round, player1, player2)` and `Settled(round, winner, pot)`, and
  starts the next round empty. No second transaction, no oracle.
- `pending()` returns the waiting player (or `address(0)`).
  `stakeOf(address)` returns `STAKE` for the waiting player, else 0 (so
  0 after a settlement). This is the view the `pcdflip` balance hint names
  ("your stake").
- `refund()` (owner only) pays the waiting player back when the round is
  at least `REFUND_AFTER` = 1 hour old (`block.timestamp` is in seconds on
  this runtime, checked 2026-09-23). Reverts: `not owner`, `no open round`,
  `round too recent`.

## Randomness source

`winner = uint256(keccak256(abi.encode(blockhash(block.number - 1), player1, player2))) & 1 == 0 ? player1 : player2`

`block.prevrandao` is **not** used: on pallet-revive it returns the constant
2500000000000000 (`0x8e1bc9bf04000`). A probe contract read it twice on
devnet on 2026-09-23 and got the same value, while `blockhash(block.number - 1)`
changed each block. The owner accepted block randomness for this demo (no
commit-reveal). Known weakness: the second player can dry-run `stake()` and
see the outcome before signing, and a block author can influence the hash.
Do not use this contract for stakes of value.

## Units

As for the Meter (`meter.md`): `NativeToEthRatio` = 10^8, PAS has 10
decimals, so inside the contract 1 PAS = 10^18. `stakeOf` returns contract
units (`500000000000000000` = 0.5 PAS); the `Settled` `pot` is
`1000000000000000000` = 1 PAS. A TxIntent `value` is in plancks.

## Calldata

| Function | Calldata |
|---|---|
| `stake()` payable (value 5000000000 plancks) | `0x3a4b66f1` |
| `stakeOf(address)` view → `uint256` | `0x42623360` + the address left-padded to 32 bytes |
| `pending()` view → `address` | `0xe20ccec3` |
| `round()` / `owner()` / `STAKE()` / `REFUND_AFTER()` | `0x146ca531` / `0x8da5cb5b` / `0x125fdbbc` / `0x19f2ed4d` |
| `refund()` (owner only) | `0x590e1ae3` |

Example, `stakeOf(Alice)`:

```
0x426233600000000000000000000000009621dde636de098b43efb0fa9b61facfe328f99d
```

The Stake button `pcdflip` sends is one Revive call (TxIntent call kind 1):
`{ "kind": 1, "to": "0x68b113b3ad6abbe9177997ea4645313c72656b58", "data": "0x3a4b66f1", "value": "5000000000" }`,
display `{ "title": "Coin flip stake", "amount": "0.5", "asset": "PAS" }`,
expiring 10 minutes after it is sent.

## Events

| Event | topic0 | Topics / data |
|---|---|---|
| `Staked(uint256 indexed round, address indexed player)` | `0x6e47dcdd359b6cd69456f0f97d394bd4540a2e7c4adc1b9da076859df53756c7` | round, player |
| `Matched(uint256 indexed round, address player1, address player2)` | `0x039001364086d9a73dc6636014a1c98fdd036554d71f5fb9f8f2be3fef7637bf` | round; data = two address words |
| `Settled(uint256 indexed round, address indexed winner, uint256 pot)` | `0x2c35d68fdf40b18e913bb877373b4a4fc67810e2546dc5c9f9208eb8494057cb` | round, winner; data = pot |
| `Refunded(uint256 indexed round, address indexed player, uint256 amount)` | `0x7ca5472b7ea78c2c0141c5a12ee6d170cf4ce8ed06be3d22c8252ddfc7a6a2c4` | round, player; data = amount |

On a settlement the `pcdflip` bot sends a `transactionReference` to both
players: status 1, the settling block, the hash of the second player's
`stake()` extrinsic, note `Flip settled: <winner username or 0x…> won 1 PAS`.

## Checked on devnet (2026-09-23)

After the deploy, at the best block: `owner()` = Alice's H160, `round()` = 1,
`pending()` = 0, `STAKE()` = 500000000000000000; a dry-run `stake()` with 1
planck reverts `stake is 0.5 PAS`, with 5000000000 plancks it succeeds.
Round 1 was played by //Bob (H160 `0x41dccbd49b26c50d34355ed86ff0fa9e489d1e01`,
block 13620744, extrinsic `0xca6371400e687924813e0e70337e937833701cfc70aff2264cbad8a074869d7c`)
and //Charlie (H160 `0xe2235a2ffe0354b27a6a1c543be6bf2920ff2134`, block
13620746, extrinsic `0xd5f90ee2157e0f487c305a215710b21201aaaa20e04872fc7190375533e0d677`).
It settled in that block: winner Charlie, pot 1 PAS. The bot's watcher
(`lib/flip.mjs`) saw both `Staked` events and the `Settled` event, and
computed the settling extrinsic hash from the block body, which matched the
submitted hash. Round 2 (Bob block 13621046, Charlie block 13621047,
settling extrinsic `0xcb7a34d23cd0b0c0e14747eee30dde5e83d45589b86cb840891178819e669158`)
went to Bob; the running `pcdflip.44` bot logged `BOT_FLIP_STAKED` twice and
`BOT_FLIP_SETTLED`, and `BOT_FLIP_UNKNOWN_PLAYER` for both (they are not its
chat peers, so no reference was sent). The next open round is 3.

## ABI

```json
[
  {
    "type": "constructor",
    "inputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "REFUND_AFTER",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "STAKE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "owner",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pending",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "refund",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "round",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "stake",
    "inputs": [],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "stakeOf",
    "inputs": [
      {
        "name": "player",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "Matched",
    "inputs": [
      {
        "name": "round",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "player1",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "player2",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Refunded",
    "inputs": [
      {
        "name": "round",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "player",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Settled",
    "inputs": [
      {
        "name": "round",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "winner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "pot",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Staked",
    "inputs": [
      {
        "name": "round",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "player",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  }
]
```
