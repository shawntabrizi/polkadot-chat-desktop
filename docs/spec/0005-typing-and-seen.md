# RFC: Typing and Seen Signals

|                 |                                                                                      |
| --------------- | ------------------------------------------------------------------------------------ |
| **Start Date**  | 2026-09-23                                                                            |
| **Description** | Two ephemeral, never-persisted content kinds: a typing indicator and a read receipt   |
| **Authors**     | Shawn Tabrizi (with the desktop client team)                                          |
| **Status**      | Draft in `polkadot-chat-desktop/docs/spec`, not yet submitted to chat-spec            |
| **Provisional kinds** | `typing` = 240, `seen` = 241 (see `kinds.md`)                                   |

## Summary

The protocol has delivery acknowledgement (a fetched statement is ACKed) but no signal that the peer is composing and no signal that the peer has *read* a message, so clients show "delivered" where every other messenger shows "seen", and a bot that takes ten seconds to answer looks dead. Two new `MessageContent` variants fix this without new infrastructure: `typing`, a short-lived hint that the sender is composing or an agent is working, and `seen`, a batched read receipt. Both are **ephemeral**: they MUST NOT be persisted, rendered as bubbles, ACKed as messages, or included in edit history or compaction. Both are **rate-limited** and **opt-in per client**, and under the compatibility rule of this spec set a client MUST NOT send either kind to a peer that has not sent an extension kind first.

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

- **Sender.** A client MAY send `typing{kind: composing}` when the user starts editing the composer for a peer, then at most once per 4 s while editing, each with `until = now + 6 s`. It MUST send `typing{kind: stopped}` or a real message within `until`, or the hint simply expires. An agent host (a bot) MAY send `typing{kind: working}` when it starts a turn and refresh it at most every 4 s until the answer is sent. A sender MUST NOT send more than one `typing` per 4 s per peer.
- **Batching.** A `typing` signal that is still un-ACKed when the real message is ready MUST be superseded: the sender re-submits the outstanding request without it (the base spec's request-extension rule). Implementations that cannot drop one entry from the outgoing batch (see RFC-0003 case 2 note) send the real message alongside; the recipient then ignores the stale `typing` per the expiry rule.
- **Recipient.** On `typing` from peer B: show B's typing state until `until`, or until any real message from B arrives, or `stopped` arrives, whichever first. Never persist, never notify, never count as unread, never ACK as a message beyond the normal statement ACK. Ignore a `typing` whose `until` is in the past or more than 15 s in the future (clock skew guard).

### Seen

- **Sender (the reader).** When a message from peer B is displayed to the user (room selected, window focused, message in view; the same rule clients use for the local unread count), the client MAY send `seen{upTo: <that message's id>, at: now}`. It MUST batch: at most one `seen` per 2 s per peer, carrying the latest displayed message. It MUST NOT send `seen` if the user disabled read receipts.
- **Recipient (the original sender).** On `seen{upTo}` from B: mark every own message to B with `timestamp <= timestamp(upTo)` as seen at `at`. Idempotent; a `seen` for an unknown `upTo` is applied to messages with a lower timestamp than the latest known and the rest deferred until `upTo` is known (or dropped after the session's pending window). Never persisted as a message; the *state* it produces (seenAt on own messages) is persisted.
- **Ticks.** Delivery states become: pending → sent → delivered (statement ACK) → seen (`seen` received). Clients that sent no `seen` still show up to delivered.

### Compatibility (this spec set's rule)

Receiving both kinds is always implemented. A client MUST NOT send `typing` or `seen` to a peer until that peer has sent it any extension kind (240+ or 21) on the same session, or the operator enabled it explicitly for testing. Older clients decode an unknown kind as unsupported and would render a bubble; the rule prevents that.

### Multi-device

`typing` is not synchronized between a user's own devices (it is ephemeral). `seen` sent by one device SHOULD be forwarded to the user's other devices through the existing device sync so their unread counts converge; the wire signal to the peer is sent once.

### Push notifications

A push whose decrypted content is `typing` or `seen` MUST NOT raise a notification.

## Drawbacks

- Two more per-peer timers and a pending-`seen` set.
- `typing` doubles the number of statements a chatty session submits during composition; the 4 s rate limit bounds it. Bots refresh `working` only while a turn runs.
- Read receipts leak presence. Opt-in default is a product choice: proposed default **off for people, on for bots** (a bot's "seen" is what makes the working indicator credible).

## Testing, Security, and Privacy

Two-client tests: a `typing` shows and expires; a real message clears it; `stopped` clears it; a stale `typing` (past `until`) is ignored; `seen` marks the right set of own messages and no others; duplicates are no-ops; a `seen` for an unknown id is deferred and applied when the id arrives; neither kind is persisted or notified; neither is sent before evidence of support. Security: both ride the authenticated session; `seen` can only affect the sending peer's own messages. Privacy: receipts and typing are opt-in; nothing new is published outside the pairwise channel.

## Performance, Ergonomics, and Compatibility

Negligible: small payloads, superseded before they are fetched in the common case. Additive; old clients unaffected because of the evidence rule.

## Prior Art

XMPP chat states (composing/paused), Matrix `m.typing` (ephemeral EDU, never in history) and `m.receipt` (read markers with `m.read` up-to semantics), Signal typing indicators (rate-limited, never stored). The `upTo` design follows Matrix's read marker.

## Unresolved Questions

1. Should `seen` default on for people? Proposed: off; on for peers flagged as bots.
2. Should `typing{kind: working}` carry a short status label for agents ("Reading files…")? Proposed: no; keep the wire tiny, agents keep status in their placeholder edits until buttons/status arrive.
3. Final kind numbers: assigned upstream at merge time.
