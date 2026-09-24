# Dao contract (DAO chat, M14)

Deployed 2026-09-24 by the `pca` agent (`polkadot-chat-agents` branch
`desktop/rfc-0003`, `contracts/dao/`). Source: `contracts/dao/src/Dao.sol`;
PolkaVM bytecode from `forge build --resolc` at
`contracts/dao/out/Dao.sol/Dao.json` (`bytecode.object`, starts with
`0x50564d00` = "PVM\0", 43 593 bytes). Deployed with
`node contracts/dao/deploy.mjs` (papi, `Revive.instantiate_with_code`, no
ETH-RPC). Plain `forge build` and `forge test` write EVM bytecode to the same
path; run `forge build --resolc` again before a deploy (`deploy.mjs` refuses
non-PVM bytecode). `forge test` in `contracts/dao/`: 8 tests.

| Item | Value |
|---|---|
| Chain | devnet Asset Hub, `asset-hub-paseo`, para 1000 |
| RPC | `wss://asset-hub-paseo-rpc.n.dwellir.com` (fallback `wss://sys.turboflakes.io/asset-hub-paseo`) |
| Genesis hash (spec 0007 `chainId`) | `0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2` |
| Contract address (H160) | `0x073f0e29750b26286befd15619d24ee77e014d87` |
| Deploy block | 13635441 (best block; extrinsic `0x6cfb20837332f17794444ff08c0a0e23c01464477c960615c450d57bf315e744`) |
| Deployer | `//Alice` of the public dev phrase (H160 `0x9621dde636de098b43efb0fa9b61facfe328f99d`); it has no role in the contract |
| Bot | `pcddao` (`BOT_DAO_CONTRACT`, `BOT_DAO_VOTING_SECS`); pca `bot-core/lib/dao.mjs` |

## Model

- A chat group (spec 0011) is known to the contract by
  `groupKey = keccak256(utf8(groupId))` (`daoGroupKey` in pca
  `lib/revive-chain.mjs`). The raw group id never goes on chain.
- **Group admin.** The first `setMembers(groupKey, …)` call claims the group:
  its caller is `groupAdmin(groupKey)` from then on, and only that account
  changes the member list or proposes for the group (`not group admin`).
  In practice the caller is the group's admin bot.
- **Members.** `isMember(groupKey, account)`. The bot registers every member
  of the group state except itself, as `reviveAddress(member account)` (the
  account that signs a `tx` intent is the chat identity's wallet account,
  spec 0007 client rule 3). It syncs the list before each proposal, only
  when the roster changed (one `setMembers` with the adds and removes).
- **Treasury.** `treasury(groupKey)`, filled by anyone with `fund(groupKey)`
  payable. Execution pays from it. Stakes are never part of a treasury.
- **Proposal.** `propose(groupKey, title, target, value, data, deadline) →
  id` (ids from 1; `count()` is the last). Title 1 to 80 bytes, data at most
  256 bytes (empty in v1: a plain transfer), `target` not zero and not the
  contract, `deadline > block.timestamp` (seconds on this runtime).
- **Vote.** `vote(id, support)` payable by a member before the deadline,
  once per account per proposal, with at least `MIN_STAKE` = 0.1 PAS. The
  stake is the vote's weight; `yes` and `no` are the summed stakes.
- **Execute.** `execute(id)` by anyone at or after the deadline when
  `yes > no` (a tie does not pass), once, when the treasury holds `value`:
  it marks the proposal executed, debits the treasury, then calls `target`
  with `value` and `data`.
- **Withdraw.** `withdraw(id)` by a voter at or after the deadline returns
  its whole stake, once, whatever the result.

Reverts (`Error(string)`): `not group admin`, `title is 1 to 80 bytes`,
`data too long`, `bad target`, `deadline passed`, `no proposal`,
`voting closed`, `not a member`, `stake at least 0.1 PAS`, `already voted`,
`voting open`, `already executed`, `not passed`, `treasury too low`,
`call failed`, `no stake`, `withdraw failed`, `no value`.

## Units

As for the Meter and Flip: `NativeToEthRatio` = 10^8, PAS has 10 decimals,
so inside the contract 1 PAS = 10^18. `MIN_STAKE` = `100000000000000000`.
A proposal's `value` and every event amount are in contract units; a
TxIntent `value` is in plancks (a vote: `1000000000`).

## Calldata

| Function | Selector |
|---|---|
| `setMembers(bytes32,address[],address[])` (group admin) | `0x542cb45c` |
| `fund(bytes32)` payable | `0xbf14c119` |
| `propose(bytes32,string,address,uint256,bytes,uint64)` (group admin) → `uint256` | `0x118f2fc8` |
| `vote(uint256,bool)` payable | `0xc9d27afe` |
| `execute(uint256)` | `0xfe0d94c1` |
| `withdraw(uint256)` | `0x2e1a7d4d` |
| `proposal(uint256)` view → `(bytes32 groupId, address target, uint256 value, uint64 deadline, bool executed, uint256 yes, uint256 no, string title)` | `0x30326c17` |
| `voteOf(uint256,address)` view → `(bool voted, bool support, uint256 stake)` | `0x45ddc85d` |
| `isMember(bytes32,address)` / `groupAdmin(bytes32)` / `treasury(bytes32)` / `count()` | `0x10ad56b3` / `0xb0670d7a` / `0x1b7fd565` / `0x06661abd` |
| `MIN_STAKE()` / `MAX_TITLE_BYTES()` / `MAX_DATA_BYTES()` | `0xcb1c2b5c` / `0x91836003` / `0xf1d11a6c` |

Example, `vote(1, true)`:

```
0xc9d27afe00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000001
```

## Events

| Event | topic0 | Topics / data |
|---|---|---|
| `GroupClaimed(bytes32 indexed groupId, address indexed admin)` | `0x1d3c5b325fc259f3aa3fbf49c958ef56f1dd9032ed890cdc3adcd2641cffc732` | groupId, admin |
| `MemberSet(bytes32 indexed groupId, address indexed account, bool member)` | `0xa3d241d0d4e90fc9999710fc24920692edded7e8872eca2a9ec47f6ba1700ed3` | groupId, account; data = member |
| `Funded(bytes32 indexed groupId, address indexed from, uint256 amount)` | `0xce7089d0668849fb9ca29778c0cbf1e764d9efb048d81fd71fb34c94f26db368` | groupId, from; data = amount |
| `Proposed(uint256 indexed id, bytes32 indexed groupId, address indexed proposer, address target, uint256 value, uint64 deadline, string title)` | `0xb0bdf15b4e7c51c0e1f8c8d7e9efd73a3740946c164511f5cbd8537eb6c2ecc8` | id, groupId, proposer; data = target, value, deadline, title |
| `Voted(uint256 indexed id, address indexed voter, bool support, uint256 stake, uint256 yes, uint256 no)` | `0x2c707893af580790816fd02f801c18abd3c09cbcd05759060a0c85a0072faf7c` | id, voter; data = support, stake, and the totals after this vote |
| `Executed(uint256 indexed id, address indexed target, uint256 value)` | `0x12c8907d32b752d626a36cf18f31719e25f1a3b6f750ee948c22c036373d48aa` | id, target; data = value |
| `Withdrawn(uint256 indexed id, address indexed voter, uint256 amount)` | `0xcf7d23a3cbe4e8b36ff82fd1b05b1b17373dc7804b4ebbd6e2356716ef202372` | id, voter; data = amount |

`Voted` carries the totals, so a watcher needs no read to show the tally.

## Worst-case limits (spec 0007 "Limits of a Revive call")

Measured with `ReviveApi_call` at the best block on devnet, 2026-09-24
(dev accounts, proposal ids 1 and 2). The bot's intents carry
`reviveIntentLimits(worst)`: gas × 1.5, deposit = max(deposit × 1.5,
deposit + 0.1 PAS).

| Call (who signs) | Paths measured | Worst deposit (plancks) | Worst ref_time | Worst proof_size | Intent limits (ref_time / proof_size / deposit) |
|---|---|---|---|---|---|
| `vote` (member, value 1 000 000 000) | first vote on a side: voter slot + side total (52 800 000); a later vote: voter slot only (26 400 000); yes and no weigh the same | 52 800 000 | 1 809 647 480 | 208 505 | 2 714 471 220 / 312 757 / 1 052 800 000 |
| `execute` (anyone) | transfer to an existing account: 0; to an address with no account: 100 000 000 (0.01 PAS, the new account) | 100 000 000 | 2 017 284 286 | 223 543 | 3 025 926 429 / 335 314 / 1 100 000 000 |
| `withdraw` (voter) | one path (a refund) | 0 | 1 083 174 774 | 99 723 | 1 624 762 161 / 149 584 / 1 000 000 000 |
| `setMembers` (bot) | claim + 4 members: 132 000 000; later, 1 add + 1 remove: 26 400 000 | — | 2 389 782 511 | 197 864 | the bot signs from its own dry-run + 20 % |
| `propose` (bot) | 80-byte title | 237 600 000 | 2 913 971 960 | 259 502 | the bot signs from its own dry-run + 20 % |

## The pcddao bot

- In a v2 group where it is an admin with `pin`, a member's
  `/propose <title> | <amount> PAS to <username>` makes the bot sync the
  members, call `propose` (deadline = now + `BOT_DAO_VOTING_SECS`, default
  86 400), post ONE `buttons` message and pin it (one state statement):
  text `Proposal #N: <title>` / `Pay <amount> PAS to <user> from the group
  treasury.` / `Proposed by <user>. Voting closes in <d> (<UTC time>).` /
  a stake line; row 1: `Vote yes (stake 0.1 PAS)` and
  `Vote no (stake 0.1 PAS)` (`tx`: one kind-1 call of `vote(id, true|false)`,
  value 1 000 000 000, the vote limits, `expiresAt` = the deadline); row 2:
  `View on Subscan` (`url`:
  `https://assethub-paseo.subscan.io/extrinsic/<propose hash>`).
  A non-member gets `Refused: only members of <group> can make proposals.`
- Each `Voted` event becomes ONE `reply` to the proposal message:
  `Tally #N: yes 0.2 PAS (2 votes), no 0.1 PAS (1 vote). <user> voted no
  with 0.1 PAS.` (no second line when a reorg delivers the event again).
- 12 s after the deadline: a `buttons` message `Voting on #N "<title>"
  closed: passed|rejected. Yes …, no ….` with `Execute` (`execute(id)`,
  only when passed) and `Withdraw stake` (`withdraw(id)`), both valid for
  7 days; with no votes, a `reply` "… Nobody voted." and no buttons.
- `Executed` becomes one `reply`: `Proposal #N executed: <amount> PAS paid
  to <user>.` `Withdrawn` is only logged.
- `/proposals`: one text with the group's proposals that are open or passed
  and not executed.

## Checked on devnet (2026-09-24)

Measurement run by //Alice (group admin), //Bob, //Charlie, //Dave, //Eve:
proposals 1 and 2, executed in blocks 13635497 and 13635498 (2 went to an
address with no account); Bob withdrew from 1 in block 13635500.

Live proof `node bot-core/scripts/e2e-dao.mjs` (throwaway identities made
with `pca create` in a scratch folder, funded from //Alice, a scratch
`pcddao` bot with 90 s voting, stopped and deleted after):

```
IDENTITIES_OK A=pcdaoaevaj.87 B=pcdaobevaj.54 C=pcdaocevaj.31 BOT=pcddaoxevaj.15
FUNDED pcdaoaevaj.87@13635708 pcdaobevaj.54@13635709 pcdaocevaj.31@13635710 pcddaoxevaj.15@13635711
V2_CREATED group=b87deb61-9230-4d9a-9e59-077b3c1c77a2 members=4 bot=admin(0xff)
TREASURY_OK 0.5 PAS block=13635722
(bot) BOT_DAO_MEMBERS_SET add=3 block=13635724
PROPOSED #3 block=13635725 hash=0xec95e9562e7351eab9a04d0f33205c121483aa50f05d0cb18ec9c1eed6373620 pinned=true
VOTED pcdaoaevaj.87 yes block=13635728 line="Tally #3: yes 0.1 PAS (1 vote), no 0 PAS (0 votes). pcdaoaevaj.87 voted yes with 0.1 PAS."
VOTED pcdaobevaj.54 yes block=13635731 line="Tally #3: yes 0.2 PAS (2 votes), no 0 PAS (0 votes). pcdaobevaj.54 voted yes with 0.1 PAS."
VOTED pcdaocevaj.31 no block=13635733 line="Tally #3: yes 0.2 PAS (2 votes), no 0.1 PAS (1 vote). pcdaocevaj.31 voted no with 0.1 PAS."
CLOSED "Voting on #3 "M14 live test" closed: passed. Yes 0.2 PAS, no 0.1 PAS." buttons=Execute/Withdraw stake
EXECUTED by pcdaoaevaj.87 block=13635779 hash=0x6df42bcc5e19939d9cca0379067fb522e07a5028673134593d4e5b12b1ce6598 B +0.2 PAS
WITHDRAWN pcdaobevaj.54 block=13635781 hash=0x25e5661a5779c1e6cbf707d00f66e560ae61bccc0bc2ee1357716c728d759818 amount=0.1 PAS
DAO_LIVE_OK
```

The voters signed each button's intent as a client does: decode, check the
chain and expiry, `Revive.map_account` first when unmapped, dry-run, sign
with max(intent limits, estimate + 20 %). The bot spent 0.032 PAS (mapping,
three members, one proposal).

## Known limits

- **Privacy.** Registered members are public H160s next to the group key:
  anyone can link the accounts of one group (not the group's name or
  messages). M14 asks for on-chain membership; a Merkle root of members or
  a per-proposal snapshot would reduce the link, not remove it.
- **Claim race.** The first `setMembers` for a group key claims it. The key
  is a hash of a secret group id, so an outsider cannot claim a group before
  its bot unless the id leaks.
- **Recipient mapping.** Execution sends `value` to an H160. A person's
  account that was never mapped (`Revive.map_account`) has no H160 owner:
  the transfer creates the fallback account `h160 ++ 0xEE×12` (seen: the
  0.01 PAS deposit on execute), which the person cannot reach. The bot does
  checks this since pca 2ef2aa7 and refuses `/propose` to an unmapped recipient; the recipient should map (any contract call does it)
  before Execute.
- **Membership snapshot.** A member who joins after the last proposal is
  registered only at the next `/propose`, so it cannot vote on proposals
  made before.

## ABI

```json
[
  {
    "type": "function",
    "name": "MAX_DATA_BYTES",
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
    "name": "MAX_TITLE_BYTES",
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
    "name": "MIN_STAKE",
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
    "name": "count",
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
    "name": "execute",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "fund",
    "inputs": [
      {
        "name": "groupId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "groupAdmin",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
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
    "name": "isMember",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "proposal",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "groupId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "target",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "value",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "deadline",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "executed",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "yes",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "no",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "title",
        "type": "string",
        "internalType": "string"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "propose",
    "inputs": [
      {
        "name": "groupId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "title",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "target",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "value",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "data",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "deadline",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "outputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setMembers",
    "inputs": [
      {
        "name": "groupId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "add",
        "type": "address[]",
        "internalType": "address[]"
      },
      {
        "name": "remove",
        "type": "address[]",
        "internalType": "address[]"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "treasury",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
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
    "name": "vote",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "support",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "voteOf",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "voter",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "voted",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "support",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "stake",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "withdraw",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "Executed",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "target",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "value",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Funded",
    "inputs": [
      {
        "name": "groupId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "from",
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
    "name": "GroupClaimed",
    "inputs": [
      {
        "name": "groupId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "admin",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "MemberSet",
    "inputs": [
      {
        "name": "groupId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "member",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Proposed",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "groupId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "proposer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "target",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "value",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "deadline",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "title",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Voted",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "voter",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "support",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "stake",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "yes",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "no",
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
        "name": "id",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "voter",
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
