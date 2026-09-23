# RFC: Typing and Seen Signals

|                 |                                                                                      |
| --------------- | ------------------------------------------------------------------------------------ |
| **Start Date**  | 2026-09-23                                                                            |
| **Description** | Two ephemeral, never-persisted content kinds: a typing indicator and a read receipt   |
| **Authors**     | Shawn Tabrizi (with the desktop client team)                                          |
| **Status**      | Draft in `polkadot-chat-desktop/docs/spec`, not yet submitted to chat-spec            |
| **Provisional kinds** | `typing` = 240, `seen` = 241 (see `kinds.md`)                                   |

## Summary

The protocol has delivery acknowledgement (a fetched statement is ACKed) but no signal that the peer is composing and no signal that the peer has *read* a message, so clients show "delivered" where every other messenger shows "seen", and a bot that takes ten seconds to answer looks dead. Two new `MessageContent` variants fix this without new infrastructure: `typing`, a short-lived hint that the sender is composing or an agent is working, and `seen`, a batched read receipt. Both are **ephemeral**: they MUST NOT be persisted, rendered as bubbles, ACKed as messages, or included in edit history or compaction. Both are **rate-limited** and switchable per client (read receipts default on in the desktop client).

**Revision 2026-09-23 (efficiency, see `efficiency.md`).** Every standalone signal is one Statement Store submission, and a human message takes 10–20 s to compose, so `typing` at one refresh per 4 s multiplied a message's cost by about five. Therefore: `typing` is **not sent by default** by any client, and bots never send it; a client shows a local "working" state for a peer it knows is a bot (spec 0008) from the moment it sends until the reply arrives, with no wire signal. `seen` stays, but it **rides in the next outgoing request batch** when one is due, so an ordinary back-and-forth adds no submission; a standalone `seen` goes out only when the reader does not reply within the batch window.

## Motivation

Two visible gaps versus Telegram and WhatsApp on an otherwise complete chat: (1) no typing indicator, which matters most for agents, whose replies take seconds and whose only workaround today is a placeholder *message* edited in place, which pollutes history and the edit-history UI; (2) "delivered" is the strongest state a sender sees, although the recipient's client knows exactly when the message was displayed. The Statement Store makes these cheap to add: a statement in the session channel is replaced by the next one, so a `typing` signal that is superseded by the real message costs nothing lasting, and a `seen` signal batches naturally with whatever the recipient sends next.

## Stakeholders

Reference mobile app team; desktop client; `pca` bot framework (the first sender of `typing`); spec maintainers; users, for whom `seen` is a privacy-relevant feature and MUST be switchable off.

## Explanation

### Content kinds

```
MessageContent = {
    ...
    typing(TypingContent) -> 240   // provisional
    seen(SeenContent)     -> 241   // provisional
}
TypingContent = {
    until: u64          // unix ms; the hint expires at this time, at most 10 s ahead
    kind: u8            // 0 = composing (a person), 1 = working (an agent), 2 = stopped
}
SeenContent = {
    upTo: UUID          // every message from the peer with timestamp <= this one's is seen
    at: u64             // unix ms
}
```

Both ride in ordinary `Message` envelopes with their own fresh `messageId`, so they batch, order and deduplicate like any message. They are **not messages to the user**.

### Typing

- **Default: not sent.** A client MUST NOT send `typing` unless the user turned it on (an opt-in setting, off by default, labelled with its cost). A bot MUST NOT send `typing{kind: working}`; the receiving client infers "working" locally for a known bot (spec 0008 `botInfo` received) from its own send until the reply, `deleted`, or a 60 s timeout, and shows a thinking row after 20 s as before.
- **Sender (opt-in only).** A client with typing on MAY send `typing{kind: composing}` after the user has edited the composer for 1 s, then at most once per 10 s while editing, each with `until = now + 12 s`. It MUST send `typing{kind: stopped}` or a real message within `until`, or the hint simply expires. A sender MUST NOT send more than one `typing` per 10 s per peer.
- **Batching.** A `typing` signal that is still un-ACKed when the real message is ready MUST be superseded: the sender re-submits the outstanding request without it (the base spec's request-extension rule). Implementations that cannot drop one entry from the outgoing batch (see RFC-0003 case 2 note) send the real message alongside; the recipient then ignores the stale `typing` per the expiry rule.
- **Recipient.** On `typing` from peer B: show B's typing state until `until`, or until any real message from B arrives, or `stopped` arrives, whichever first. Never persist, never notify, never count as unread, never ACK as a message beyond the normal statement ACK. Ignore a `typing` whose `until` is in the past or more than 15 s in the future (clock skew guard).

### Seen

- **Sender (the reader).** When a message from peer B is displayed to the user (room selected, window focused, message in view; the same rule clients use for the local unread count), the client MAY send `seen{upTo: <that message's id>, at: now}`. It MUST batch: the pending `seen` waits up to 5 s; if a real message to the same peer is sent within that window, the `seen` MUST go in the same request batch (one submission); otherwise it goes out alone at the end of the window, at most one per 5 s per peer, carrying the latest displayed message. It MUST NOT send `seen` if the user disabled read receipts.
- **Recipient (the original sender).** On `seen{upTo}` from B: mark every own message to B with `timestamp <= timestamp(upTo)` as seen at `at`. Idempotent; a `seen` for an unknown `upTo` is applied to messages with a lower timestamp than the latest known and the rest deferred until `upTo` is known (or dropped after the session's pending window). Never persisted as a message; the *state* it produces (seenAt on own messages) is persisted.
- **Ticks.** Delivery states become: pending → sent → delivered (statement ACK) → seen (`seen` received). Clients that sent no `seen` still show up to delivered.

### Compatibility

Development mode (see `README.md`): both kinds are sent freely; a client that does not know them shows the base spec's unsupported message. The rate limits above are part of the design and stay regardless of mode. When legacy clients exist upstream, the retired evidence rule or a capability advertisement (roadmap) can gate sending.

### Multi-device

`typing` is not synchronized between a user's own devices (it is ephemeral). `seen` sent by one device SHOULD be forwarded to the user's other devices through the existing device sync so their unread counts converge; the wire signal to the peer is sent once.

### Push notifications

A push whose decrypted content is `typing` or `seen` MUST NOT raise a notification.

## Drawbacks

- Two more per-peer timers and a pending-`seen` set.
- `typing` multiplies the number of statements a session submits during composition (about ×5 at a 4 s refresh), which is why it is opt-in and off by default, and why bots never send it. With typing off and `seen` riding the next message, a 1:1 conversation costs one submission per message.
- Read receipts leak presence. Opt-in default is a product choice: proposed default **off for people, on for bots** (a bot's "seen" is what makes the working indicator credible).

## Testing, Security, and Privacy

Two-client tests: a `typing` shows and expires; a real message clears it; `stopped` clears it; a stale `typing` (past `until`) is ignored; `seen` marks the right set of own messages and no others; duplicates are no-ops; a `seen` for an unknown id is deferred and applied when the id arrives; neither kind is persisted or notified; neither is sent before evidence of support. Security: both ride the authenticated session; `seen` can only affect the sending peer's own messages. Privacy: receipts and typing are opt-in; nothing new is published outside the pairwise channel.

## Performance, Ergonomics, and Compatibility

Submission cost (`efficiency.md`): `seen` 0 per message in a back-and-forth, 1 per read session otherwise; `typing` 0 by default. Small payloads. Additive; old clients unaffected because of the evidence rule.

## Prior Art

XMPP chat states (composing/paused), Matrix `m.typing` (ephemeral EDU, never in history) and `m.receipt` (read markers with `m.read` up-to semantics), Signal typing indicators (rate-limited, never stored). The `upTo` design follows Matrix's read marker.

## Unresolved Questions

1. Should `seen` default on for people? Proposed: off; on for peers flagged as bots.
2. Should `typing{kind: working}` carry a short status label for agents ("Reading files…")? Proposed: no; keep the wire tiny, agents keep status in their placeholder edits until buttons/status arrive.
3. Final kind numbers: assigned upstream at merge time.
