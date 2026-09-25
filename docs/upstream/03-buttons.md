# Buttons and commands: a message with a keyboard, and a structured press

Board mission: M2 Bot-native app

Status: Prototyped in polkadot-chat-desktop (commit b5cbe5d) and polkadot-chat-agents (branch desktop/rfc-0003).

## Problem

- A bot can answer only in text. Every choice ("Yes / No", "Next page", "Vote A / B") is a text reply that the user must type exactly.
- A bot has no way to learn which choice was made without parsing free text.
- A chain call from a bot needs a button that the client runs itself, with the key never leaving the client (proposal 04).

## Proposed wire change

```
buttons(ButtonsContent)         -> 242   // provisional
buttonPress(ButtonPressContent) -> 243   // provisional
ButtonsContent = { text: String, rows: [[Button]] /* <= 8 rows of <= 4 */, oneShot: bool }
Button = { label: String /* <= 40 chars */, action: Action }
Action = enum {
    command(String) = 0   // the client sends the string as a normal text message
    callback(Bytes) = 1   // the client sends buttonPress with these bytes (<= 256) to the sender
    url(String)     = 2   // https or polkadotapp only; the client shows the host and never auto-opens
    tx(Bytes)       = 3   // a transaction intent (proposal 04)
}
ButtonPressContent = { messageId: UUID, row: u8, index: u8, payload: Bytes }
```

- `buttons` is a normal message. It can be replied to, reacted to, edited (a bot updates a menu in place) and deleted.
- A `buttonPress` is accepted only from the peer the keyboard was sent to, and only for a message the receiver sent. It is never a bubble.

Full spec: https://github.com/shawntabrizi/polkadot-chat-desktop/blob/main/docs/spec/0006-buttons.md

## What the prototype learned

- **Cost.** 0 extra submissions. The keyboard rides in the message, and a press replaces a typed reply.
- **Unknown action tag.** `Action` has no length prefix. A decoder cannot skip an unknown tag, so such a message is undecodable and shows as "unsupported". New action kinds need a spec revision.
- **Over-limit keyboards.** A keyboard over the row, button or label limits is treated as undecodable. A client never renders a partial keyboard. The desktop and pca agree on this rule.
- **Leniency for text-only models (host convention, not wire).** A bot's model writes a fenced ```` ```buttons ```` block that the host turns into kind 242. A small model (Claude Haiku) wrote a bare fence, a flat array instead of `{"rows": [[…]]}`, and text after the block. A strict parser refused all three and the user saw raw JSON. Hosts now accept a `buttons`, `json` or untagged fence, a flat array as one row, and a block anywhere in the reply. A block that still fails is stripped and logged, never shown to a person.
- **Long labels.** A model wrote quiz answers over 40 characters, and the whole keyboard was dropped. Hosts now shorten a label to 39 characters plus an ellipsis. The wire limit stays 40.
- **Tool calling.** Hosts with tool-calling engines offer a `send_buttons` tool built from the same schema. A tool call gives the same content as the fenced block. Small models sent bare strings, one flat list, and once a JavaScript expression in a string. The host shapes strings and flat lists and refuses code.

## Clients that do not support it

- Buttons are gated by capabilities (proposal 01).
- **Menu as text.** A device that did not list 242 gets a plain `text` message with the choices as numbered lines ("1. Yes · 2. No — reply with a number or the label"). The bot matches the reply as text.
- Live test: a baseline bot got the numbered menu.

## Open questions

1. Should the menu-as-text format be normative, so every bot parses the reply the same way?
2. Should a `command` press show as the user's own bubble? The draft says yes (as Telegram does).
3. Is 256 bytes enough for `callback`? It is enough for an id, not for an intent.
4. A future `input` field on a button (Farcaster Frames v1 style), so a bot can ask for one value?
5. Final kind numbers are for chat-spec to assign.

Decision wanted: adopt, adopt with changes, or reject. React 👍/👎 or comment.
