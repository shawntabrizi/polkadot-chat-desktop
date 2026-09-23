# RFC: Bot Info

|                 |                                                                                  |
| --------------- | -------------------------------------------------------------------------------- |
| **Start Date**  | 2026-09-23                                                                        |
| **Description** | A bot describes itself to a peer: name, description, commands, greeting, kind    |
| **Authors**     | Shawn Tabrizi (with the desktop client team)                                      |
| **Status**      | Draft in `polkadot-chat-desktop/docs/spec`                                        |
| **Provisional kind** | `botInfo` = 244 (see `kinds.md`)                                             |

## Summary

Nothing on the wire says "this peer is a bot", what it does, or which commands it understands. Telegram solved this with BotFather metadata and `/start`. This RFC adds one content kind, `botInfo`, that a bot sends when a chat request is accepted, when asked with `/start`, and whenever its description changes. Clients use it to show a bot badge, a description under the name, a command menu in the composer, and a greeting. A later revision may publish the same document under the bot's DotNS name for discovery before a chat exists.

## Explanation

```
MessageContent = { ... botInfo(BotInfo) -> 244 }
BotInfo = {
    kind: u8              // 0 = bot (automated), 1 = agent (an AI acting for a person), 2 = person-operated service
    name: String          // display name, <= 40
    description: String   // <= 280
    greeting: String      // <= 280; shown once when the info first arrives
    commands: [Command]   // <= 32
    version: u16          // bumped by the bot when the document changes
    balance: Option<BalanceHint>   // v2 (M11b): how a client shows "your balance with this bot"
}
BalanceHint = {
    chainId: String       // genesis hash hex
    contract: Bytes       // 20-byte Revive address
    selector: Bytes       // 4-byte ABI selector of a view taking the caller's H160 (e.g. balanceOf(address))
    decimals: u8          // of the returned uint256 for display
    unit: String          // "PAS"
    perReply: Option<u128> // price of one reply in the same unit's smallest denomination, for "~N replies"
    label: String         // "with Meter", "your stake", <= 40
}
Command = { name: String /* without slash, <= 32 */, description: String /* <= 80 */ }
```

- **Sender.** A bot MUST send `botInfo` right after accepting a request, on `/start`, and together with its next reply to any peer that has not received the current `version` (so peers from before the bot had a document, or from before a change, catch up without asking). A person's client never sends it.
- **Recipient.** Store per peer (latest `version` wins). If `balance` is present, read `contract.selector(caller)` at the best block on every new block while the room is open and show `label: <value> <unit>` (plus `~N replies` when `perReply` is set) under the bot's name. Render: a badge next to the name (bot / agent), the description as the header subtitle, `/` in the composer opens the command menu, the greeting as a system-style row on first arrival. Never render `botInfo` as a bubble. A peer that sent `botInfo` is listed under a "Bots" section in search results.
- **Compatibility.** Development mode: sent freely.

## Unresolved

Discovery before a chat (a directory): publish the same document under the bot's DotNS name or the People-chain record; out of scope here.
