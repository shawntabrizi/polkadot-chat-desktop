# RFC: Buttons and Button Presses

|                 |                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------- |
| **Start Date**  | 2026-09-23                                                                                    |
| **Description** | A message can carry rows of buttons; pressing one sends a structured reply or runs a client action |
| **Authors**     | Shawn Tabrizi (with the desktop client team)                                                  |
| **Status**      | Draft in `polkadot-chat-desktop/docs/spec`, not yet submitted to chat-spec                    |
| **Provisional kinds** | `buttons` = 242, `buttonPress` = 243 (see `kinds.md`)                                   |

## Summary

Bots and agents on this protocol can only answer in text. Every service-like interaction ("Yes / No", "Next page", "Claim", "Vote A / B") is a text reply the user must type exactly, which is why Telegram bots grew inline keyboards. This RFC adds a `buttons` attachment to a message and a `buttonPress` reply. Each button has a label and an **action** with a kind. Two kinds are answered on the wire (`command`, `callback`), one is a client action (`url`), and one is **reserved now and specified in a later RFC** (`tx`: a chain call the client dry-runs and signs), so the same message format later drives smart contracts without a second protocol. Every `buttons` message carries plain text, so a client that does not know the kind still shows a readable message.

## Motivation

Agents are peers here. A peer that wants to offer choices needs a way to render them that does not depend on the user typing a magic string, and a way to learn which choice was made without parsing free text. The desktop reference client already turns markdown `/commands` into tappable chips locally; that is a client trick, invisible to phones, and it cannot carry a payload or a link. The contract-bot use case (a contract exposes an ABI; its functions become buttons; pressing one calls the chain) needs an action kind the client executes itself, with the key never leaving the client. Designing the action enum with that slot now avoids a redesign.

## Stakeholders

Bot and agent operators (`pca`), the desktop client, the mobile app team (rendering keyboards), contract developers, spec maintainers.

## Explanation

### Content kinds

```
MessageContent = {
    ...
    buttons(ButtonsContent)         -> 242   // provisional
    buttonPress(ButtonPressContent) -> 243   // provisional
}
ButtonsContent = {
    text: String                    // the message body; the fallback for old clients
    rows: [[Button]]                // up to 8 rows of up to 4 buttons
    oneShot: bool                   // true: the keyboard is removed after one press
}
Button = {
    label: String                   // <= 40 chars
    action: Action
}
Action = {
    command(String)                 -> 0   // client sends the string as a normal text message
    callback(Bytes)                 -> 1   // client sends buttonPress{payload} back to the sender; <= 256 bytes
    url(String)                     -> 2   // client opens the URL after showing it; https or polkadotapp scheme only
    tx(TxIntent)                    -> 3   // RESERVED: specified in RFC 0007-contract-actions
}
ButtonPressContent = {
    messageId: UUID                 // the buttons message
    row: u8, index: u8
    payload: Bytes                  // the callback bytes, echoed
}
```

`Action` is a plain SCALE enum without a length prefix, so a decoder cannot skip an unknown tag: a message with an unknown action tag is undecodable and renders as the base spec's unsupported message. New action kinds are therefore introduced only by a spec revision that bumps the `buttons` kind, and forward-compatible growth lives inside the opaque `tx(Bytes)` payload. Only `tx` renders as a disabled button with its label until RFC 0007 defines it. A client that does not implement this RFC decodes kind 242 as unsupported; under the compatibility rule a sender MUST NOT send it to such a peer and MUST send `text` alone instead (the same string, with the button labels appended as a numbered list so the choices remain readable).

### Sender rules

- `buttons` is a normal message: it has an id, a timestamp, may be replied to, reacted to, edited (an `edited` with the same `messageId` MAY replace `rows`, which is how a bot updates a menu in place) and deleted (RFC-0003; a tombstone removes the keyboard).
- `command` and `callback` are for bots and agents; a person's client MAY send `buttons` too (polls, quick replies), nothing forbids it.
- `url` MUST be `https://` or `polkadotapp://`; clients MUST show the host before opening.

### Recipient rules

- Render `text` as the bubble, `rows` as buttons under it, in row order. `oneShot` keyboards disappear after the first press; others stay and the pressed button is highlighted briefly.
- `command`: send `text(<string>)` to the sender as a normal message and show it as the user's own bubble.
- `callback`: send `buttonPress{messageId, row, index, payload}`; show nothing as a bubble; the UI marks the press on the button (spinner until the bot's next message or 10 s).
- `url`: open in the system browser after confirmation with the host visible; never auto-open.
- `tx`: disabled until RFC 0007; label shown, tooltip "This client cannot run chain actions yet".
- Fenced-block authoring (bots and local agents): a reply ending with a ```buttons fence holding `{ "rows": [[{ "label", "action": { "command" | "callback" | "url" } }]], "oneShot"? }` becomes one `buttons` message; a `callback` string with the prefix `base64:` is raw bytes, any other string is UTF-8, max 256 bytes; invalid blocks stay text; a `tx` action in the block follows spec 0007.
- A `buttonPress` MUST be accepted only from the peer the `buttons` message was sent to, and only for a `messageId` the recipient sent. Duplicate presses are delivered as duplicates (bots dedupe by their own means).

### Compatibility (this spec set's rule)

Receiving is always implemented. Sending `buttons` requires evidence that the peer speaks extension kinds; without it, the fallback text form above is sent. `buttonPress` is only ever sent to a peer that sent `buttons`, so it needs no separate evidence.

### Multi-device

`buttons` synchronizes like any message. A `buttonPress` from one device SHOULD be synced to the user's other devices so a oneShot keyboard collapses everywhere.

### Push notifications

A `buttons` message notifies with its `text`. A `buttonPress` never notifies.

## Drawbacks

- Keyboards are a UI surface bots can abuse (dark patterns); the label limit, the row limit, the host-visible URL rule and no auto-open are the guards.
- `callback` payloads are opaque: a compromised bot cannot do more than receive bytes it chose, but clients must not interpret them.
- Two more kinds for mobile to render; the fallback text keeps old clients usable.

## Testing, Security, and Privacy

Round trip tests: render, press `command` → text message; press `callback` → `buttonPress` with the payload; `url` → confirmation, no auto-open; unknown action → disabled; `buttonPress` from the wrong peer or for a foreign `messageId` → ignored; fallback text form sent to a peer without evidence. Security: `buttonPress` binds to a message the recipient sent, on an authenticated session; payload size bounded. Privacy: nothing new leaves the pairwise channel; `url` opens only after the user sees the host.

## Performance, Ergonomics, and Compatibility

Small payloads. Additive. The `tx` slot lets contract actions arrive without changing this format.

## Prior Art

Telegram inline keyboards (`callback_data`, `url`, and web-app buttons), Slack Block Kit actions, Matrix MSC for buttons (unadopted). The reserved `tx` kind mirrors how wallets treat a "sign this" intent: the client, not the counterparty, simulates and signs.

## Unresolved Questions

1. Should `command` presses be visible as the user's bubble (Telegram: yes)? Proposed: yes.
2. Payload limit 256 bytes: enough for an id; not for a whole intent. Contract calls go through `tx`, not `callback`.
3. Final kind numbers upstream.

## Future Directions

An optional `input: { placeholder: String, kind: text|number }` on a button (Farcaster Frames v1 pattern) so a bot can ask for one value; the press then carries the value in `payload`.

RFC 0007 `tx` action (model: EIP-5792 `wallet_sendCalls` with display metadata, plus a `transactionReference` kind for the result): `{ chainId, to, data | abiCall, value, dryRunRequired }` with the client obliged to dry-run and show effects before signing; the bot manifest (commands list, description, greeting) resolvable by DotNS name; a `menu` capability so a bot can publish its command list once.

### Host parsing leniency (revision 2026-09-24)

The fenced block is a host convention for text-only models, not wire format. A small model (owner's report: Claude Haiku in a pca bot) wrote a bare ``` fence, a flat array of buttons instead of `{"rows": [[…]]}`, and a line after the block; the strict parser refused all three and the user saw raw JSON. Hosts SHOULD accept: a fence tagged `buttons`, `json` or untagged whose JSON is either the rows object or a flat array of buttons (one row); the block anywhere in the reply, with text before and after it kept; and SHOULD strip a block that still fails to parse, logging it, rather than show JSON to a person. Stricter models still get the canonical form in the hint. Structured directives through tool calling (roadmap, M13) make this moot for engines that support them.

### Over-limit keyboards (2026-09-24)

A received `buttons` whose rows, buttons per row, or label length exceed the limits is treated as undecodable: the client shows the base spec's unsupported message and never renders a partial keyboard. Hosts (pca, desktop) agree on this rule.
