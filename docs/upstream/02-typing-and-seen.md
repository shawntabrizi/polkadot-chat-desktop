# Typing and seen: a read receipt that rides the next message, and typing off by default

Board mission: M3 Protocol foundations

## Problem

- The protocol has a delivery acknowledgement but no read receipt. A sender sees "delivered" at best.
- The protocol has no typing signal. A bot that takes ten seconds to answer looks dead.
- Each standalone signal is one Statement Store submission. Every submission is validated and gossiped to every node. A careless design multiplies the cost of every message.

## What we implemented

Two ephemeral content kinds. They are never stored as messages, never rendered as bubbles and never notified.

```
typing(TypingContent) -> 240   // provisional
seen(SeenContent)     -> 241   // provisional
TypingContent = { until: u64 /* unix ms, at most 10 s ahead */, kind: u8 /* 0 composing, 1 working, 2 stopped */ }
SeenContent   = { upTo: UUID /* every peer message up to this one is seen */, at: u64 }
```

Rules:

- **Seen rides the next message.** The reader's client holds a pending `seen` for up to 5 s. If the user sends anything to that peer in the window (a message, a reaction, an edit, a button press, a reference), the `seen` goes in the same request batch. If not, it goes alone at the end of the window, at most once per 5 s per peer. The user can turn read receipts off.
- **Typing is off by default.** A client sends `typing` only when the user turns it on, at most once per 10 s per peer. A bot never sends it.
- **A local "working" state.** For a peer known to be a bot (it sent `botInfo`, proposal 05), the client shows "working" from its own send until the reply. There is no wire signal. Timeout: 60 s.
- Neither kind is sent in groups.

Why this form, and the alternatives we considered:

| Option | Why we did not choose it |
|---|---|
| Typing on by default, refreshed every 4 s (our first build, and common in other messengers) | A person takes 10–20 s to write a message. That adds 3–5 submissions to a message that costs one: about × 5. Arithmetic, not a measurement. |
| A typing signal from bots | The common case is a bot that is thinking. The local "working" state covers it with no wire cost. |
| A standalone `seen` for every read | 1 submission per read. The piggyback makes it 0 in a back-and-forth. |
| Put the read position inside the ACK | The ACK is session layer, not content. It would change the base protocol. See proposal 10. |

The owner decided typing by arithmetic on 2026-09-23, while no client in the field sends these kinds. A cut later would need every client to update.

Full spec: https://github.com/shawntabrizi/polkadot-chat-desktop/blob/main/docs/spec/0005-typing-and-seen.md

## Cost

- **`seen`: 0 submissions in a back-and-forth. Else 1 per read session.**
  - Measured (desktop e2e, devnet): our question cost 1 submission. The read inside the 5 s window cost 0. The bot's `seen` rode its reply.
  - Measured (pca, live): a bot answered with one statement that carried both `seen` and the text.
  - Measured (desktop agent with a real model, 2026-09-24): the answer took about 10 s, so the bot's `seen` went alone first. That reply cost **2 submissions**, not 1. The fake engine answers at once and costs 1.
- **`typing`: 0 by default.** With the opt-in: at most 1 per 10 s per peer while the user types.
- **Bytes.** The `seen` vector is 31 bytes with 5-character ids. With two 36-character UUIDs it is about 94 bytes (computed, not measured on the wire). The `typing` vector is 26 bytes (about 57 bytes with a UUID).

## What it gives the user

- "Seen" ticks after "delivered", when both sides allow read receipts.
- A "working" indicator for bots at no wire cost. Measured: it showed at 0.0 s and cleared on the reply.
- A typing indicator only for people who turn it on.

## Clients that do not support it

- Both kinds are gated by capabilities (proposal 01). A device that did not list 240 or 241 never receives them. A pending `seen` to such a peer is dropped; it costs no submission.
- Without the gate, a phone would show one "unsupported" bubble per `seen`. That the phones do so for `seen` was not checked on a phone. The owner accepted only one bubble per chat (the capabilities message).
- A client that does not send `seen` still shows up to "delivered".

## Open decisions

1. **Are read receipts worth their cost at all?** A `seen` costs one submission unless it rides the next message. We made it ride, and we gated it. A slow bot still pays one extra submission per reply. Yes (keep `seen`) / no (drop it from the protocol).
2. **If yes: default on or off for people?** The draft says off for people and on for bots.
3. **Slow bots.** Should a bot hold its `seen` until its turn ends, so it always rides the reply? Yes / no. The alternative is no `seen` from agents at all.
4. **Is opt-in typing worth keeping?** Yes (keep, off by default) / no (drop `typing` and keep only the local "working" state).
5. **Should the spec name the local "working" state** as the normal bot indicator, so every client shows it the same way? Yes / no.
6. Should `typing{working}` carry a short status label for agents? The draft says no.

Status: Built. polkadot-chat-desktop 1ab9c25 (M9), 1501b72 (M12c: typing off by default, seen piggybacks), gating 82f5d69 (M20). polkadot-chat-agents branch `desktop/rfc-0003` b8b9fc4.

Decision wanted: answer the open decisions, then adopt, adopt with changes, or reject. React 👍/👎 or comment.
