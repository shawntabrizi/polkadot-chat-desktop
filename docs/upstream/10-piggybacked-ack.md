# Efficiency: the ACK doubles the cost of a conversation; let it ride the next request

Board mission: M3 Protocol foundations

Status: Prototyped in polkadot-chat-desktop (commit b5cbe5d) and polkadot-chat-agents (branch desktop/rfc-0003). This is a finding; no wire change was built.

## Problem

- Every fetched batch is acknowledged with one response statement (base spec). In a back-and-forth, each message costs one request submission and one acknowledgement submission.
- So a conversation costs about **2 submissions per message**, one from each side.
- Every submission is validated and gossiped to every node of the shared Statement Store.
- The base spec already has this item as a TODO: "Reduce number of statements for each chat from 4 to 2 by combining requests and aknoledgements in one statement" (base-spec.md, line 2, on main).

## Proposed wire change (for discussion)

- Let a peer's next outgoing request carry the acknowledgement of the batches it read.
- Send a standalone acknowledgement only when no request goes to that peer within a short window (for example 5 s, the same window the prototype uses for read receipts, proposal 02).
- The exact field (in the request statement, or a response that also carries messages) is for chat-spec to choose. We did not build it.

Cost rule and measurements: https://github.com/shawntabrizi/polkadot-chat-desktop/blob/main/docs/spec/efficiency.md

## What the prototype learned

- **Measured.** The desktop counts submissions and acknowledgements in Settings › Diagnostics. The e2e run shows 2 acknowledgements next to 2 submissions for one question and its reply.
- With typing off and read receipts riding the next message (proposal 02), the acknowledgement is now the largest cost that a client cannot remove alone.
- **Store throughput (devnet).** One sender reached 4 statements per second (160 sent, 160 received, p50 ≈ 330 ms, p95 ≈ 370 ms, no rejection). The limit is above that. Throughput is not the problem; shared load is.
- **Pitfall.** A client that blocks a peer still acknowledges its batches, because the SDK acknowledges before the app sees the message. The blocked peer sees "delivered".

## Clients that do not support it

- This is a session-layer change, not a content kind. An old client that waits for a separate acknowledgement would see messages as "not delivered" until the window ends.
- A capabilities feature bit (proposal 01) could gate it per peer during a transition. RFC-0004 took a flag-day approach before launch; the same may be simpler here.

## Open questions

1. Is the TODO still planned? If yes, can this prototype's numbers help size the window?
2. Flag day, or a per-peer feature bit?
3. Should the acknowledgement of a blocked peer's batch be suppressed?

Decision wanted: adopt, adopt with changes, or reject. React 👍/👎 or comment.
