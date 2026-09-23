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
}
Command = { name: String /* without slash, <= 32 */, description: String /* <= 80 */ }
```

- **Sender.** A bot MUST send `botInfo` on the identity channel right after accepting a request, and on `/start`; MAY resend on change (higher `version`). A person's client never sends it.
- **Recipient.** Store per peer (latest `version` wins). Render: a badge next to the name (bot / agent), the description as the header subtitle, `/` in the composer opens the command menu, the greeting as a system-style row on first arrival. Never render `botInfo` as a bubble. A peer that sent `botInfo` is listed under a "Bots" section in search results.
- **Compatibility.** Development mode: sent freely.

## Unresolved

Discovery before a chat (a directory): publish the same document under the bot's DotNS name or the People-chain record; out of scope here.
