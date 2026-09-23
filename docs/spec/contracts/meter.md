# Meter contract (pay-as-you-go agent, spec 0007)

Deployed 2026-09-23 by the `pca` agent (`polkadot-chat-agents` branch
`desktop/rfc-0003`, `contracts/meter/`). Source: `contracts/meter/src/Meter.sol`;
PolkaVM bytecode from `forge build --resolc` at
`contracts/meter/out/Meter.sol/Meter.json` (`bytecode.object`, starts with
`0x50564d00` = "PVM\0", 14 031 bytes); plain `forge build` and `forge test`
write EVM bytecode to the same path, so run `forge build --resolc` again
before a deploy (`deploy.mjs` refuses non-PVM bytecode). Deployed with
`node contracts/meter/deploy.mjs --bot pcdmeter` (papi, `Revive.instantiate_with_code`, no ETH-RPC).

| Item | Value |
|---|---|
| Chain | devnet Asset Hub, `asset-hub-paseo`, para 1000, spec 2005002 |
| RPC | `wss://asset-hub-paseo-rpc.n.dwellir.com` (fallback `wss://sys.turboflakes.io/asset-hub-paseo`) |
| Genesis hash (spec 0007 `chainId`) | `0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2` |
| Contract address (H160) | `0x30b0c001431a1addb8c11a060ada4d6a7033cf21` |
| Deploy block | 13619379 (best block; extrinsic `0xc0fb45c9754d9d394329106efdaccc989b34844b333d828523f4ee26cc0d8fdc`) |
| Owner (deployer) | `//Alice` of the public dev phrase: AccountId32 `0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d`, H160 `0x9621dde636de098b43efb0fa9b61facfe328f99d` |
| Operator | the `pcdmeter.01` bot's wallet account: AccountId32 `0x9eb681bc39734224669e4e261c271d628e8d87e4c3cb25636c0e248267ea2967`, H160 `0xa8162d8be0e9ed4c48c2a526f7a65497fd6d1f6d` |
| Revive pallet index | 100 (`call` = 1, `instantiate_with_code` = 3, `map_account` = 7) |

Checked after the deploy at the best block: `owner()` and `operator()`
return the two H160s above; a `topUp()` of 1 PAS from Alice (block 13619399)
made `balanceOf(Alice)` = 1000000000000000000; a `charge` from Alice
dry-runs to the revert reason `not operator`. A `charge(Alice, 0.1 PAS)` signed by the
operator (block 13619585, extrinsic
`0x176b187082c4755aa4869ededae9dc2e8d5f1ed05babec3f816fa19214242874`) left
Alice 0.9 PAS; the bot's reference note for it was `balance: 9000000000`.

## Units (read this before you show a balance)

pallet-revive scales native value into the contract: `NativeToEthRatio` =
100 000 000 on this runtime. PAS has 10 decimals (1 PAS = 10^10 plancks), so
inside the contract **1 PAS = 10^18** (18 decimals, like wei).

- The `value` of a `Revive.call` extrinsic and of a TxIntent call is in
  **plancks**: Top up 1 PAS = `value: 10000000000`.
- `balanceOf` returns **contract units**: divide by 10^18 for PAS, or by
  10^8 for plancks. `1000000000000000000` = 1 PAS.
- The bot's `transactionReference` note `balance: <n>` gives **plancks**.
- The price per reply is 0.1 PAS = 1 000 000 000 plancks = 10^17 contract units.

## Address mapping

A chat identity's wallet account is an sr25519 AccountId32. Its address in the
contract (`msg.sender`, and the `balanceOf` argument) is what
pallet-revive's `AccountId32Mapper` gives it: `keccak256(accountId32)[12..32]`
(an account whose last 12 bytes are all `0xEE` maps to its first 20 bytes
instead). `ReviveApi_address(account)` returns the same value. The account
must call `Revive.map_account` once before its first `Revive.call`
(spec 0007 client rule 4).

## Calldata

| Function | Calldata |
|---|---|
| `topUp()` payable | `0xdc29f1de` |
| `balanceOf(address)` view → `uint256` | `0x70a08231` + the address left-padded to 32 bytes |
| `charge(address,uint256)` (operator only) | `0xa3ffa9cd` + address word + amount word |
| `owner()` / `operator()` / `earned()` | `0x8da5cb5b` / `0x570ca735` / `0xd6f19262` |

Example, `balanceOf(Alice)`:

```
0x70a082310000000000000000000000009621dde636de098b43efb0fa9b61facfe328f99d
```

Read it with `ReviveApi_call(origin, dest, value = 0, gas_limit = None,
storage_deposit_limit = None, input_data)` at the best block; the return data
is one 32-byte big-endian `uint256`. Reverts carry `Error(string)`
(`0x08c379a0`...): `no value`, `insufficient balance`, `not operator`,
`not owner`, `exceeds earned`, `transfer failed`.

Event topics: `Charged(address indexed user, uint256 amount, uint256 balance)`
= `0x6eb3b9e9b53f6121601ca14ab3aa367f50ddeb99803e39f569b28817dff1292d`;
`ToppedUp(address indexed user, uint256 amount, uint256 balance)` =
`0xbdde76a89d276b6d334c784be5c2d00d6c2219d11a2f2c80e00b85144845ab4d`.

## ABI

```json
[
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "initialOperator",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "balanceOf",
    "inputs": [
      {
        "name": "user",
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
    "type": "function",
    "name": "charge",
    "inputs": [
      {
        "name": "user",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "earned",
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
    "name": "operator",
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
    "name": "setOperator",
    "inputs": [
      {
        "name": "newOperator",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "topUp",
    "inputs": [],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "withdraw",
    "inputs": [
      {
        "name": "to",
        "type": "address",
        "internalType": "address payable"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "Charged",
    "inputs": [
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "balance",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OperatorChanged",
    "inputs": [
      {
        "name": "operator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ToppedUp",
    "inputs": [
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "balance",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Withdrawn",
    "inputs": [
      {
        "name": "to",
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
  }
]
```
