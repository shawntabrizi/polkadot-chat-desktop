# Buttons and commands: a message with a keyboard, and a structured press

Board mission: M2 Bot-native app

## Problem

- A bot can answer only in text. Every choice ("Yes / No", "Next page", "Vote A / B") is a text reply that the user must type exactly.
- A bot cannot learn which choice was made without parsing free text.
- A chain call from a bot needs a button that the client runs itself, with the key never leaving the client (proposal 04).

## What we implemented

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

Rules:

- `buttons` is a normal message. It can be replied to, reacted to, edited (a bot updates a menu in place) and deleted.
- A `buttonPress` is accepted only from the peer the keyboard was sent to, and only for a message the receiver sent. It is never a bubble.
- **Over-limit keyboards are refused.** A keyboard over the row, button or label limits is undecodable. A client never renders a partial keyboard. The desktop and pca agree.

Host conventions (not wire), learned from small models:

- A model writes a fenced ```` ```buttons ```` block, or calls a `send_buttons` tool built from the same schema. The host turns it into kind 242.
- A small model (Claude Haiku) wrote a bare fence, a flat array instead of `{"rows": [[…]]}`, and text after the block. A strict parser refused all three, and the user saw raw JSON. Hosts now accept a `buttons`, `json` or untagged fence, a flat array as one row, and a block anywhere in the reply. A block that still fails is stripped and logged, never shown to a person.
- A model wrote quiz answers over 40 characters, and the whole keyboard was dropped. Hosts now shorten a label to 39 characters plus an ellipsis. The wire limit stays 40.
- Through the tool, small models sent bare strings, one flat list, and once a JavaScript expression in a string. The host shapes strings and flat lists and refuses code.

Why this form, and the alternatives we considered:

| Option | Why we did not choose it |
|---|---|
| Buttons as markdown links with a special scheme | A link cannot carry a callback payload or a transaction intent, and a phone would show a dead link. |
| A press as a plain text reply only (`command`) | It works for menus. It cannot carry an opaque id, and the bot must parse text. We kept it as one action. |
| A length prefix on each `Action` | It would let a decoder skip an unknown action. We did not add it: `Action` is a SCALE enum like the rest of the base spec. The cost: a new action kind needs a spec revision (open decision 4). |

Full spec: https://github.com/shawntabrizi/polkadot-chat-desktop/blob/main/docs/spec/0006-buttons.md

## Cost

- **Submissions: 0 extra.** The keyboard rides in the message. A press replaces a typed reply, which would be a submission anyway.
- **Bytes.** Test vectors (5-character ids): a two-button keyboard is 83 bytes; a press is 28 bytes. A full keyboard (32 labels of 40 characters) was not measured. The limit is 8 × 4 × (40 characters of up to 4 UTF-8 bytes) plus the payloads, inside the 4,096-byte batch.

## What it gives the user

- One tap instead of typing an exact answer.
- A bot that can update its menu in place (edit), so the chat does not fill with old menus.
- A safe place for a payment or a contract call: the `tx` button (proposal 04).

## Clients that do not support it

- Buttons are gated by capabilities (proposal 01).
- **Menu as text.** A device that did not list 242 gets a plain `text` message with the choices as numbered lines ("1. Yes · 2. No — reply with a number or the label"). The bot matches the reply as text. Live test: a baseline bot got the numbered menu.
- A `tx` button is left out for a device without feature bit 1. The text says the amount and the recipient.
- A `buttonPress` is never sent to a device that did not list 243.

## Open decisions

1. **Menu-as-text format.** Make it normative, so every bot parses the reply the same way? Yes / no.
2. **Own bubble for `command`.** Should a `command` press show as the user's own bubble (as Telegram does)? The draft says yes.
3. **`callback` size.** Keep 256 bytes (enough for an id, not for an intent)? Yes / choose a size.
4. **Unknown actions.** Accept that a new action kind needs a spec revision? Or add a length prefix per `Action` now, before anyone ships? Choose one.
5. **Leniency.** Should the spec name the host leniency rules (fence forms, flat rows, label shortening) as a SHOULD for hosts? Yes / no.
6. **Later.** A future `input` field on a button (Farcaster Frames v1 style), so a bot can ask for one value? Yes / not now.

Status: Built. polkadot-chat-desktop 399c86b (M8), leniency 6ef0ed3 and 135f164, label shortening 73088d4, gating 82f5d69. polkadot-chat-agents branch `desktop/rfc-0003` b8b9fc4.

Decision wanted: answer the open decisions, then adopt, adopt with changes, or reject. React 👍/👎 or comment.
