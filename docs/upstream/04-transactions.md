# Transactions: tx intents in buttons and a transaction reference message

Board mission: M4 Deeper chain primitives

Related board items: "chat-spec · Protocol — RFC: payment-request content kind" (a request is a `buttons` message with one transfer intent; no new kind) and "chat-spec · Protocol — RFC: payment/delivery receipt kind" (`transactionReference` is that receipt for payments).

## Problem

- A bot that sells a service, runs a game or asks for a payment has no safe way to ask the user to sign a chain call.
- The chat cannot show "this transaction is in a block" as part of the conversation.
- The key must stay in the client. The bot proposes; the client decodes, dry-runs, shows the effect and signs.

## What we implemented

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

Rules:

- **Signer.** Decode, dry-run at the best block, show an inline strip (title, amount, fee, signer, decoded outcome), sign only on the user's confirmation. A `tx` button looks different from other buttons and never acts on press.
- **One reference per transaction.** The submitter posts status 1 (in block) or 3 (failed). Status 0 goes only if no block includes the transaction within 30 s (in DMs; never in groups). Status 2 (finalized) is never posted: a receiver tracks finality from the chain with the hash.
- **`expiresAt = 0`** fits a fixed call whose bytes cannot go stale (a top-up). A call that depends on state (a stake in a round, a vote) should have a finite expiry. The expiry is a client rule, not an on-chain property.
- **The Revive limits rule.** A dry-run sizes one contract path. The extrinsic can run another (a reorg, or another caller lands first). The **intent author** sets each Revive call's limits from the worst case over all contract paths: deposit limit = max(deposit × 1.5, deposit + 0.1 PAS); gas = measured × 1.5. The **signer** signs with, per field, the larger of the intent's value and its own estimate plus margin (estimate + 20 %; deposit floor estimate + 0.1 PAS).
- **Person-to-person payments** need no new kind. A request is a `buttons` message with one transfer intent. The payment is the payer's reference.
- **Groups.** `tx` buttons work in v2 groups (proposal 06). The reference rides the payer's next group statement.

Why this form, and the alternatives we considered:

| Option | Why we did not choose it |
|---|---|
| A separate payment-request kind | A `buttons` message with one transfer intent does the same job. One signing path for bots and people. |
| Three references per transaction (submitted, in block, finalized; our first draft) | 3 submissions per transaction. Finality is on the chain; a receiver reads it with the hash. We cut it to 1. |
| The bot signs for the user (a custodial key) | The key must never leave the client. |
| Trust the dry-run limits as they are | Seen live: a coin-flip stake failed with `StorageDepositLimitExhausted` after a passing dry-run, and a race failed with `OutOfGas`. So the worst-case rule. |

Full spec: https://github.com/shawntabrizi/polkadot-chat-desktop/blob/main/docs/spec/0007-transactions.md

## Cost

- **Submissions: 1 per transaction** (the reference). 2 for a DM transaction that is not in a block after 30 s (status 0, then the end state). The intent rides in the `buttons` message: 0 extra.
- **Bytes.** Test vectors: a one-call `TxIntent` is 152 bytes; a `buttons` message with it is 207 bytes; a reference is 147 bytes. The `chainId` is a 66-character hex string; raw bytes would save 34 bytes.
- **Chain.** The user's fee for the extrinsic. A metered bot charges in batches: 1 Asset Hub extrinsic per 5 replies or 10 minutes, plus one reference.
- **Measured signing margin.** The first coin-flip stake signs with a gas cap 3.4 × its own estimate, because the intent sizes the settling path. The settling stake signs with 1.5 ×.

## What it gives the user

- Pay a bot, top up a meter, stake in a game or vote in a group DAO from inside the chat.
- A strip that shows what the call does before the user signs.
- A bubble that shows "in block", then "final", read from the chain.

Live use (devnet): a coin flip between two identities settled on chain (the winner got +0.4981 PAS). A metered bot charged once after five replies with one status-1 reference. A DAO bot in a v2 group was proved live on the pca side (`DAO_LIVE_OK`). The desktop end-to-end run is still pending: the new bot had no statement allowance yet (`noAllowance`; the identity backend took over 5 minutes to attest it; proposal 11).

## Clients that do not support it

- Gated by capabilities (proposal 01): feature bit 1 for `tx` actions, kind 245 for references.
- A device without `tx` support gets the button left out. The text says the amount and the recipient.
- A device without kind 245 gets nothing for a reference. The fallback to the base `send` kind for a plain transfer is not built: a reference holds no block hash or amount that `send` needs.

## Open decisions

1. **Fees for persons.** Who pays: a PGAS allowance or a funded account? Devnet uses funded accounts.
2. **Slow transactions.** Keep status 0 at 30 s plus the end state (2 submissions), or only the end state (1)?
3. **Double payment.** A second device can pay the same request twice. Accept (the first paid reference wins)? Yes / no.
4. **`chainId`.** Keep the hex string, or raw 32 bytes? Choose one.
5. **Mixed calls.** Allow raw and Revive calls in one intent, with a client free to refuse them in v1? Yes / no.
6. **Revive limits.** Make the worst-case rule normative for intent authors and signers? Yes / no.

Status: Built. polkadot-chat-desktop 1109a45 (M11), 3cb60f8 (M11b), 1501b72 (M12c: one reference), bdd0e86 (M12g: payments), 37cf8d5 (M14: tx buttons in v2 groups). polkadot-chat-agents branch `desktop/rfc-0003` 289d02c (`expiresAt = 0`) and b8b9fc4.

Decision wanted: answer the open decisions, then adopt, adopt with changes, or reject. React 👍/👎 or comment.
