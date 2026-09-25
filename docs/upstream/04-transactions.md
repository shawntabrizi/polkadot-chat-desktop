# Transactions: tx intents in buttons and a transaction reference message

Board mission: M4 Deeper chain primitives

Status: Prototyped in polkadot-chat-desktop (commit b5cbe5d) and polkadot-chat-agents (branch desktop/rfc-0003).

## Problem

- A bot that sells a service, runs a game or asks for a payment has no safe way to ask the user to sign a chain call.
- The chat has no way to show "this transaction is in a block" as part of the conversation.
- The key must stay in the client. The bot proposes; the client decodes, dry-runs, shows the effect and signs.

## Proposed wire change

`tx` is `Action` tag 3 of the buttons proposal (03). Its payload is a SCALE `TxIntent`:

```
TxIntent = {
    version: u8                  // 1
    chainId: String              // genesis hash of the target chain
    calls: [Call]                // 1..8, batched with utility.batchAll when more than one
    display: { title, description, amount?, asset? }
    dryRunRequired: bool         // MUST be true; a client refuses to sign without a dry-run
    expiresAt: u64               // unix ms; 0 = never expires
}
Call = { kind: u8 /* 0 raw call data, 1 Revive contract call */, to: Option<Bytes>, data: Bytes,
         value: u128, gasRefTime?, gasProofSize?, storageDepositLimit? }

transactionReference(TransactionReference) -> 245   // provisional
TransactionReference = { chainId, hash, status: u8 /* 0 submitted, 1 in block, 2 finalized, 3 failed */,
                         block: Option<u32>, note: String, intentMessageId: Option<String> }
```

- **Signer rules.** Decode, dry-run at the best block, show an inline strip (title, amount, fee, signer, decoded outcome), sign only on the user's confirmation. A `tx` button looks different from other buttons and never acts on press.
- **One reference per transaction.** The submitter posts status 1 (in block) or 3 (failed). Status 0 goes only if no block includes the transaction within 30 s. Status 2 (finalized) is never posted; a receiver tracks finality from the chain with the hash.
- **`expiresAt = 0`** is right for a fixed call whose bytes cannot go stale (a top-up). State-dependent calls (a stake in a round, a vote) should have a finite expiry. The expiry is a client rule, not an on-chain property.
- **Person-to-person payments** need no new kind: a request is a `buttons` message with one transfer intent, and the payment is the payer's reference.

Full spec: https://github.com/shawntabrizi/polkadot-chat-desktop/blob/main/docs/spec/0007-transactions.md

## What the prototype learned

- **Cost.** 1 submission per transaction (the reference). The first draft posted three (submitted, in block, finalized); the revision cut it to one.
- **Live use (devnet).** A coin flip between two identities settled on chain (the winner got +0.4981 PAS). A metered bot charged once after five replies with one status-1 reference. Batched charges are 1 Asset Hub extrinsic per 5 replies or 10 minutes.
- **The Revive limits rule.** A dry-run sizes one contract path. The extrinsic can run another (a reorg, or another caller lands first). Seen live: the flip's second stake failed with `StorageDepositLimitExhausted` after a passing dry-run, and a race failed with `OutOfGas`. The rule now:
  - The **intent author** sets each Revive call's limits from the worst case over all contract paths: deposit limit = max(deposit × 1.5, deposit + 0.1 PAS); gas = measured × 1.5.
  - The **signer** signs with, per field, the larger of the intent's value and its own estimate plus margin (estimate + 20 %, deposit floor estimate + 0.1 PAS).
  - Measured: the first flip stake signs with a gas cap 3.4 × its own estimate, because the intent sizes the settling path. The settling stake signs with 1.5 ×.
- **Reorgs.** An "in block" reference can name a best block that is later retracted. The bubble tracks finality from the chain, so the final block can differ.
- **Revive accounts.** An unmapped signer needs `Revive.map_account` first. The client prepends it once.
- **Explorers.** The hosted Polkadot.js Apps did not decode asset-hub-paseo 2005002 extrinsics (format v5). Subscan did, so the prototype links to Subscan.

## Clients that do not support it

- Gated by capabilities (proposal 01): feature bit 1 for `tx` actions, kind 245 for references.
- A device without `tx` support gets the button left out, and the text says the amount and the recipient.
- A device without kind 245 gets the base `send` kind for a plain transfer, and nothing for a contract call.

## Open questions

1. Who pays fees for persons (PGAS allowance or a funded account)? Devnet uses funded accounts.
2. A slow transaction gets status 0 at 30 s and then its end state: two references. Keep that, or only status 0?
3. A second device can pay the same request twice. The draft accepts it (the first paid reference wins).
4. `tx` buttons in groups: the prototype does not let them be pressed in v1. Allow them?
5. Mixed raw and Revive calls in one intent: allowed, but a client may refuse them in v1.

Decision wanted: adopt, adopt with changes, or reject. React 👍/👎 or comment.
