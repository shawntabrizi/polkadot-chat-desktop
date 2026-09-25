# Typing and seen: a read receipt that rides the next message, and typing off by default

Board mission: M3 Protocol foundations

Status: Prototyped in polkadot-chat-desktop (commit b5cbe5d) and polkadot-chat-agents (branch desktop/rfc-0003).

## Problem

- The protocol has a delivery acknowledgement but no read receipt. A sender sees "delivered" at best.
- The protocol has no typing signal. A bot that takes ten seconds to answer looks dead.
- Each standalone signal is one Statement Store submission. A careless design multiplies the cost of every message.

## Proposed wire change

Two ephemeral content kinds. They are never stored as messages, never rendered as bubbles and never notified.

```
typing(TypingContent) -> 240   // provisional
seen(SeenContent)     -> 241   // provisional
TypingContent = { until: u64 /* unix ms, at most 10 s ahead */, kind: u8 /* 0 composing, 1 working, 2 stopped */ }
SeenContent   = { upTo: UUID /* every peer message up to this one is seen */, at: u64 }
```

- **Seen rides the next message.** The reader's client holds a pending `seen` for up to 5 s. If the user sends anything to that peer in the window, the `seen` goes in the same request batch. If not, it goes alone at the end of the window, at most once per 5 s per peer. The user can turn read receipts off.
- **Typing is off by default.** A client sends `typing` only when the user turns it on (at most once per 10 s per peer). A bot never sends it.
- **Local "working" state.** For a peer known to be a bot (it sent `botInfo`, proposal 05), the client shows "working" from its own send until the reply, with no wire signal (timeout 60 s).
- Neither kind is sent in groups.

Full spec: https://github.com/shawntabrizi/polkadot-chat-desktop/blob/main/docs/spec/0005-typing-and-seen.md

## Why typing is off by default (owner ruling, 2026-09-23)

- A person takes 10–20 s to write a message. A typing refresh every 4 s adds 3–5 submissions to a message that costs one. That multiplies the submission cost by about 5.
- The Statement Store is shared infrastructure, and every submission is validated and gossiped to every node. The efficiency rule says a new kind must not add submissions unless it replaces a user action (https://github.com/shawntabrizi/polkadot-chat-desktop/blob/main/docs/spec/efficiency.md).
- The common case is a bot that is thinking. The local "working" state covers it with no wire cost.
- The owner decided by arithmetic now, while no client in the field sends these kinds. A cut later would need every client to update.

## What the prototype learned

- **Cost.** `seen`: 0 submissions in a back-and-forth, else 1 per read session. `typing`: 0 by default.
- **Measured (desktop e2e, devnet).** Our question cost 1 submission. The read inside the 5 s window cost 0. The bot's `seen` rode its reply. The local "working" state showed at 0.0 s and cleared on the reply.
- **Measured (pca, live).** A bot answered with one statement that carried both `seen` and the text, and sent no `typing`.
- **Pitfall.** Users who had typing on in an earlier build are off after the update. The prototype uses a new settings key for this.
- **Interpretation.** The prototype lets `seen` ride any outgoing content (a reaction, an edit, a button press), not only a text message. It is a submission anyway.

## Clients that do not support it

- Both kinds are gated by capabilities (proposal 01). A device that did not list 240 or 241 never receives them.
- Before the gating, the prototype sent `seen` to everyone. A phone shows an "unsupported" bubble for any unknown kind, so the gating removes that risk. (That the phones showed one per `seen` was not checked on a phone.)
- A client that does not send `seen` still shows up to "delivered".

## Open questions

1. Should read receipts default on for people? The draft says off for people and on for bots.
2. Should `typing{working}` carry a short status label for agents? The draft says no.
3. Should the spec name the local "working" state as the normal bot indicator, so every client shows it the same way?
4. Final kind numbers are for chat-spec to assign.

Decision wanted: adopt, adopt with changes, or reject. React 👍/👎 or comment.
