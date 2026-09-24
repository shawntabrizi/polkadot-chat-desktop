# RFC: Transaction Actions and References

|                 |                                                                                  |
| --------------- | -------------------------------------------------------------------------------- |
| **Start Date**  | 2026-09-23                                                                        |
| **Description** | The `tx` button action (a call the client dry-runs and signs) and a `transactionReference` message |
| **Authors**     | Shawn Tabrizi (with the desktop client team)                                      |
| **Status**      | Draft in `polkadot-chat-desktop/docs/spec`; implemented in M11                    |
| **Provisional kind** | `transactionReference` = 245; `tx` is `Action` tag 3 of spec 0006            |

## Summary

A bot can offer a button whose action is a chain call. The client, never the bot, holds the key: it decodes the intent, dry-runs it, shows the effect and the fee, and signs on the user's confirmation. Whoever submits then posts a `transactionReference` so the chat shows "submitted → in block → finalized / failed" as a first-class bubble with the hash. Model: EIP-5792 `wallet_sendCalls` with display metadata, as XMTP and Farcaster use, adapted to Substrate extrinsics and Revive contract calls.

## Explanation

```
TxIntent = {                          // SCALE payload of Action::tx(Bytes)
    version: u8                       // 1
    chainId: String                   // genesis hash hex (0x…) of the target chain
    calls: [Call]                     // 1..8, executed in order (batched by the client as utility.batchAll when >1)
    display: Display
    dryRunRequired: bool              // MUST be true in v1; a client MUST refuse to sign without a dry-run
    expiresAt: u64                    // unix ms; the button is disabled after this
}
Call = {
    kind: u8                          // 0 = raw extrinsic call data (pallet index, call index, args as SCALE)
                                      // 1 = Revive contract call: `to` = 20-byte contract address, `data` = ABI-encoded calldata
    to: Option<Bytes>
    data: Bytes                       // <= 16 KiB
    value: u128                       // native units transferred with the call (0 for none)
    gasRefTime: Option<u64>, gasProofSize: Option<u64>, storageDepositLimit: Option<u128>   // kind 1 only; client re-estimates on dry-run
}
Display = { title: String /* <= 60 */, description: String /* <= 280 */, amount: Option<String>, asset: Option<String> }

MessageContent = { ... transactionReference(TransactionReference) -> 245 }
TransactionReference = {
    chainId: String
    hash: Bytes                       // extrinsic hash
    status: u8                        // 0 submitted, 1 in block (best), 2 finalized, 3 failed
    block: Option<u32>
    note: String                      // <= 140; "Top-up of 1 PAS", "Flip settled: you won"
    intentMessageId: Option<String>   // the buttons message this answers, if any
}
```

### Client rules (the signer)

1. On press: decode `TxIntent`; refuse if `chainId` is not one the client is connected to, if `expiresAt` passed, or if `dryRunRequired` is false.
2. Dry-run at the best block: for kind 0 `TransactionPaymentApi_query_info` + `DryRunApi`/`system_dryRun` where available; for kind 1 `ReviveApi_call` to get the result, gas, and storage deposit. Show an inline strip (never a modal): title, description, amount and asset, the estimated fee, the account that signs, and the decoded outcome (revert reason on failure). Buttons: Sign, Cancel.
3. Sign with the identity's wallet key (the same account as the chat identity). Submit; watch at the best block; post **one** `transactionReference` to the peer that sent the intent: status 1 when the transaction is in a block, or status 3 when it failed. Status 0 (submitted) is posted only if no block includes the transaction within 30 s, and status 2 (finalized) is never posted on its own: a receiver that holds the hash and chain id tracks finality from the chain (revision 2026-09-23, `efficiency.md`: one submission per transaction, not three). Show all states on the pressed button and as a bubble locally.
4. Revive: if the signer's account is not yet mapped, prepend `Revive.map_account` as the first call of the batch (once; remembered).
5. Rate limit: one pending signing strip per room.
6. **Appearance.** A `tx` button MUST look different from other buttons: a wallet icon, the amount and asset from `display` beside the label, and a tooltip saying it signs a transaction. It MUST never act on press; press opens the strip, and Sign stays disabled until the dry-run has returned. Expired intents render disabled.

### Bot rules (the author)

- A bot produces a `tx` button through the fenced ```buttons block: `{"label":"Top up 1 PAS","action":{"tx":{ "chainId":"0x…","calls":[{"kind":1,"to":"0x…","data":"0x…","value":"10000000000"}],"display":{"title":"Top up","description":"Adds 1 PAS to your balance with Guide","amount":"1","asset":"PAS"},"expiresAt":1720000000000}}}`. pca encodes it.
- On receiving a `transactionReference`, the bot MAY read the chain to confirm (best block) and continue the conversation; it MUST NOT trust the reference alone for anything of value.

### Compatibility

Development mode: sent freely. A client without `tx` support shows the button disabled (spec 0006 rule). `transactionReference` renders as an unsupported bubble on old clients.

## Drawbacks and open points

Fee payment by persons (PGAS allowance vs funded account) is outside this spec; devnet uses funded accounts. Multi-call intents with mixed kinds are allowed but clients may refuse them in v1. Final kind numbers upstream.

### Person-to-person payments (M12g, 2026-09-24)

No new wire kind. A **request** is a `buttons` message (0006) with one `tx` button whose intent is `Balances.transfer_keep_alive(requester, amount)` with `display.title = "Pay <requester> <amount> PAS"`, `expiresAt = now + 7 d`. A **payment** is the payer's `transactionReference` with `note = "req:<request messageId> <words>"`; the requester marks the request paid only when such a reference is in a block AND the chain shows the transfer to it for that amount. A **direct send** posts a reference with `note = "Sent <amount> PAS[ · <words>]"`; the receiver SHOULD verify the transfer on chain before presenting it as received. A "Decline" is a plain text "Declined: <title>". Unresolved: a second device may pay a request twice (v1 accepts this; the first paid reference wins).

### Limits of a Revive call (revision 2026-09-24, from the flip race)

A dry-run sizes one contract path; the extrinsic may run another (a reorg, or another caller landing first). Seen live: the flip's second stake failed with `StorageDepositLimitExhausted`, and the mirror race with `OutOfGas`. Rules:
- The **author** of a `tx` intent sets each kind-1 call's `storageDepositLimit`, `gasRefTime` and `gasProofSize` from the call's worst case over all contract paths: deposit limit = max(deposit × 1.5, deposit + 0.1 PAS); gas = measured × 1.5. These are caps; the signer pays only what the call uses.
- The **signer** signs with, per field, the larger of the intent's value and its own estimate plus margin. For an intent without limits (a brain's buttons block), the signer floors the deposit at estimate + 0.1 PAS; gas stays at estimate + 20 %, so such intents remain exposed to path changes.
- A reference's "in block" may name a best block later reorged away; the bubble tracks finality from the chain (M12c), so the final block can differ.
