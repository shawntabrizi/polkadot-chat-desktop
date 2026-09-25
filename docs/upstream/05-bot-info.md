# Bot info: a bot describes itself, with an optional balance hint

Board mission: M2 Bot-native app

Related board items: "clients · Protocol — Distinguish bots from people in the UI" and "clients · UX — Command affordance for bot-declared /commands". This kind gives both a wire source.

## Problem

- Nothing on the wire says "this peer is a bot", what it does, or which commands it knows.
- A client cannot show a bot badge, a command menu or a greeting.
- A metered or staked bot cannot tell the client where to read "your balance with this bot".

## What we implemented

```
botInfo(BotInfo) -> 244   // provisional
BotInfo = {
    kind: u8               // 0 bot, 1 agent (an AI acting for a person), 2 person-operated service
    name: String           // <= 40
    description: String    // <= 280
    greeting: String       // <= 280, shown once
    commands: [Command]    // <= 32; Command = { name /* <= 32, no slash */, description /* <= 80 */ }
    version: u16           // bumped when the document changes
    balance: Option<BalanceHint>
}
BalanceHint = {
    chainId: String, contract: Bytes /* 20-byte Revive address */, selector: Bytes /* 4-byte view(address) */,
    decimals: u8, unit: String, perReply: Option<u128>, label: String /* <= 40 */,
    pending: u128          // v3: metered by the bot but not yet charged on chain; absent = 0
}
```

Rules:

- **Sender.** A bot sends `botInfo` after it accepts a request, on `/start`, and with its next reply to any peer that does not have the current version. A person's client never sends it.
- **Receiver.** Stores the latest document per peer. A `version` equal to or above the stored one replaces it (v3 resends the same version with a new `pending`). Shows a badge, the description as a subtitle, a `/` command menu and the greeting once. Never a bubble.
- **Balance.** If `balance` is present, the client reads `contract.selector(caller)` at the best block while the room is open. It shows **one number**: balance − pending ("0.7 PAS (~7 replies)").
- **Groups.** A bot's `botInfo` rides inside its first group statement (proposal 06). No standalone statement.

Why this form, and the alternatives we considered:

| Option | Why we did not choose it |
|---|---|
| A chain flag for "bot" | Not available. The identity pallet is gone from the next People runtime, and username functions are deprecated in favour of DotNS. individuality#1221 would add one (proposal 08). `botInfo` stays useful for commands and greeting. |
| A balance number sent by the bot | The client would trust the bot. The hint names a contract view, so the client reads the chain itself. |
| Show "1 PAS, 0.3 owed" | The owner ruled it jargon. Charges are batched, so the header said 1 PAS while `/balance` said 0.7. v3 sends the pending debit, and the client shows one number. The split may go in a tooltip only. |

Full spec: https://github.com/shawntabrizi/polkadot-chat-desktop/blob/main/docs/spec/0008-bot-info.md

## Cost

- **Submissions: at most 1 per peer per version**, and it usually rides a reply (0). The v3 `pending` update rides the metered reply: 0 extra.
- **Bytes.** Test vectors: 130 bytes without a hint; 275 bytes with a v3 hint. Sent once per peer per version.
- **Reads.** One contract view per open room at the best block. No submission.

## What it gives the user

- A bot badge and a one-line description in the room header.
- A `/` command menu from the bot's own list.
- A greeting the first time.
- One balance number for a metered bot, read from the chain.
- A local "working" state while a bot answers (proposal 02), shown only for peers that sent `botInfo`.

## Clients that do not support it

- Gated by capabilities (proposal 01): kind 244.
- A device without it gets the greeting once as plain text, and nothing else.
- v3 appends `pending` at the end. An older decoder must ignore trailing bytes. The desktop and pca do; the phones never receive the kind.

## Open decisions

1. **Discovery before a chat.** Publish the same document in a directory (proposal 08) or under a DotNS name? Choose one, or both.
2. **Payments fields.** Keep `perReply` and `pending` in the chat protocol, or move them to a payments spec? Choose one.
3. **Structured state.** A client that renders a bot's state (for example a DAO proposal card) parses the bot's English today. Add a machine-readable field later? Yes / not now.
4. **Version rule.** "A version equal to or above the stored one replaces it": normative? Yes / no.

Status: Built. polkadot-chat-desktop b894f1e (M10), 3cb60f8 (M11b: balance hint), 377a087 (M12f: v3 `pending`), review 2b9cda1 (version rule), gating 82f5d69. polkadot-chat-agents branch `desktop/rfc-0003` b8b9fc4.

Decision wanted: answer the open decisions, then adopt, adopt with changes, or reject. React 👍/👎 or comment.
