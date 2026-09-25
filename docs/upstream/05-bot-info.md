# Bot info: a bot describes itself, with an optional balance hint

Board mission: M2 Bot-native app

Status: Prototyped in polkadot-chat-desktop (commit b5cbe5d) and polkadot-chat-agents (branch desktop/rfc-0003).

## Problem

- Nothing on the wire says "this peer is a bot", what it does, or which commands it knows.
- A client cannot show a bot badge, a command menu or a greeting.
- A metered or staked bot has no way to tell the client where to read "your balance with this bot".

## Proposed wire change

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

- **Sender.** A bot sends `botInfo` after it accepts a request, on `/start`, and with its next reply to any peer that does not have the current `version`. A person's client never sends it.
- **Receiver.** Stores the latest version per peer. Shows a badge, the description as a subtitle, a `/` command menu and the greeting once. Never a bubble.
- **Balance.** If `balance` is present, the client reads `contract.selector(caller)` at the best block while the room is open. It shows **one number**: balance − pending ("0.7 PAS (~7 replies)").

Full spec: https://github.com/shawntabrizi/polkadot-chat-desktop/blob/main/docs/spec/0008-bot-info.md

## What the prototype learned

- **Cost.** At most 1 submission per peer per version, and it usually rides a reply. The v3 `pending` update rides the metered reply: 0 extra.
- **Why v3.** Charges are batched (one chain charge per 5 replies or 10 minutes). The owner saw the header say 1 PAS while `/balance` said 0.7. The bot now sends the pending debit, and the client shows one number. The owner ruled that "1 PAS, 0.3 owed" is jargon; the split may go in a tooltip only.
- **Other uses of `botInfo`.** The client's local "working" state (proposal 02) is shown only for peers that sent `botInfo`. In a v2 group, a bot's `botInfo` rides in its first group statement.
- **Pitfall.** v3 appends `pending` at the end of the message. Older decoders must ignore trailing bytes for this to be safe.
- **Pitfall.** A client that renders a bot's structured state (for example a DAO proposal card) has to parse the bot's English today. A machine-readable field may be wanted later.

## Clients that do not support it

- Gated by capabilities (proposal 01): kind 244.
- A device without it gets the greeting once as plain text, and nothing else.

## Open questions

1. Discovery before a chat: publish the same document in a directory (proposal 08) or under a DotNS name?
2. Should `perReply` and `pending` stay in the chat protocol, or belong to a payments spec?
3. Final kind numbers are for chat-spec to assign.

Decision wanted: adopt, adopt with changes, or reject. React 👍/👎 or comment.
