# Efficiency: the ACK doubles the cost of a conversation; let it ride the next request

Board mission: M3 Protocol foundations

## Problem

The base spec already names this. Line 2 of `base-spec.md` on main (134cad7):

> [TODO]: <> (Reduce number of statements for each chat from 4 to 2 by combining requests and aknoledgements in one statement)

- Peer B MUST answer every fetched request with one `StatementResponse` on its response channel. So in a back-and-forth, each message costs one request submission and one acknowledgement submission.
- So a conversation costs about **2 submissions per message**, one from each side.
- Every submission is validated and gossiped to every node of the shared Statement Store.
- Each side also holds 2 live statements per peer (request and response channels). That is half of the quota problem in proposal 11.

This issue adds our measurement to the TODO and proposes one way to do it. We did not build it.

## What we propose (not built)

- A peer's next outgoing request carries the acknowledgement of the batches it read from that peer.
- A standalone acknowledgement goes only when no request goes to that peer within a short window. Example: 5 s, the same window our read receipts use (proposal 02).
- Then each side needs one channel per peer, not two: the TODO's "4 to 2".
- The exact field is for chat-spec to choose. Two shapes we considered:

| Shape | For | Against |
|---|---|---|
| An `ack: Option<{ requestId, responseCode }>` field in `Request` | One statement, one channel per side | A wire change to `Request`; old decoders must skip it or fail |
| A `Response` that also carries messages | Keeps `Request` as it is | Two statement kinds on one channel; more rules for replacement |

Cost rule and measurements: https://github.com/shawntabrizi/polkadot-chat-desktop/blob/main/docs/spec/efficiency.md

## Cost today, and after

- **Measured today (desktop e2e, devnet).** The desktop counts submissions and acknowledgements in Settings › Diagnostics. One question and its reply showed 2 submissions and 2 acknowledgements: 4 statements for 2 messages.
- **After, in a back-and-forth:** about 1 submission per message. In a one-way burst (a bot that streams several replies with no answer), the saving is smaller: one standalone ACK per window.
- **Slots.** Today 2 live statements per peer per side (4 per chat). After: 1 per side (2 per chat). With the devnet allowance of 50 statements, that moves the ceiling from about 25 to about 50 peers (proposal 11). Arithmetic, not measured.
- **Bytes.** An acknowledgement carries a `requestId` (a UUID) and a code, about 38 bytes before encryption. The full statement size of an ACK: **not measured**.
- **Throughput is not the problem.** One sender reached 4 statements per second on devnet (160 sent, 160 received, p50 ≈ 330 ms, p95 ≈ 370 ms, no rejection). The limit is above that. Shared load is the problem.

## What it gives the user

- Nothing visible, and that is the point: the same "delivered" ticks at about half the shared cost.
- Twice as many active chats before the allowance is full (see Slots above).
- With typing off and read receipts riding the next message (proposal 02), the ACK is now the largest cost that a client cannot remove alone.

## Clients that do not support it

- This is a session-layer change, not a content kind. An old client that waits for a separate acknowledgement would show messages as "not delivered" until the window ends, and then get the standalone ACK.
- A capabilities feature bit (proposal 01) could gate it per peer during a transition. RFC-0004 took a flag-day approach before launch; the same may be simpler here.
- **Pitfall.** A client that blocks a peer still acknowledges its batches, because the SDK acknowledges before the app sees the message. The blocked peer sees "delivered".

## Open decisions

1. **Is the TODO still planned?** Yes / no.
2. **Shape.** An `ack` field in `Request`, or a `Response` that carries messages? Choose one.
3. **Window.** A fixed 5 s, or client choice within a bound? Choose one.
4. **Rollout.** Flag day, or a per-peer feature bit? Choose one.
5. **Blocked peers.** Suppress the acknowledgement of a blocked peer's batch? Yes / no.

Status: Finding only; no wire change built. Measured in polkadot-chat-desktop 1501b72 (M12c: Diagnostics counters, `scripts/probe-statements.mjs`), noted in review 5489a26.

Decision wanted: answer the open decisions, then adopt, adopt with changes, or reject. React 👍/👎 or comment.
