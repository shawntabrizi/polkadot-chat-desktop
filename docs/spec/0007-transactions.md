# RFC: Transaction Actions and References (draft outline)

|                 |                                                                                  |
| --------------- | -------------------------------------------------------------------------------- |
| **Start Date**  | 2026-09-23                                                                        |
| **Description** | The `tx` button action and a `transactionReference` message                      |
| **Status**      | Outline; completed in M11 once the target contract and fee path are chosen       |
| **Provisional kind** | `transactionReference` = 245; `tx` is `Action` tag 3 of spec 0006            |

## Shape (to be completed)

```
TxIntent = {                       // payload of Action::tx(Bytes), SCALE
    chainId: String                // genesis hash hex or a known alias ("paseo-asset-hub")
    calls: [Call]                  // executed as one batch; EIP-5792 wallet_sendCalls shape
    display: { title: String, description: String, amount: Option<String>, asset: Option<String> }
    dryRunRequired: bool           // client MUST dry-run and show effects before signing; default true
}
Call = { kind: u8 /* 0 = extrinsic call data, 1 = revive contract call */, to: Option<Bytes>, data: Bytes, value: u128 }
TransactionReference = { chainId: String, hash: Bytes, status: u8 /* 0 submitted, 1 in block, 2 finalized, 3 failed */, note: String }
```

Rules: the client, never the counterparty, holds the key and signs; the client dry-runs and shows the effect and the fee; the sender of a `transactionReference` is whoever submitted; a reference renders as a first-class bubble with the state and a link.

Open: fee path for persons (PGAS allowance vs funded account), Revive account mapping, which contract first.
