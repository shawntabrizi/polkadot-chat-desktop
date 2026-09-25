# Bot directory: signed bot cards on a well-known statement topic

Board mission: M2 Bot-native app

Status: Specified in polkadot-chat-desktop (commit b5cbe5d); not built. The bots it would list run on polkadot-chat-agents (branch desktop/rfc-0003).

## Problem

- A person cannot find a bot unless they know its username. The identity backend search matches all usernames and does not say which are bots.
- A bot is marked as a bot only after the chat starts (`botInfo`, proposal 05).
- The prototype's demo mode ships a fixed list of bot usernames in the app. That is a central list.

## Proposed wire change

- A bot signs one **bot card** and publishes it as a statement on a fixed directory topic and a fixed channel, so each account holds at most one card. Expiry 72 h; the bot refreshes it once a day.
- Card (provisional kind 251, as the leading byte of the statement data): username, name, tagline, kind, tags, a reference to its `botInfo` version and hash, pricing, capability bits, an optional operator claim signed by the operator's account, issuedAt. 110–260 bytes for our demo bots.
- A client subscribes to the topic, checks each card against the People chain (the username belongs to the signer; the signer has a chat key), and searches locally.
- "Run by @operator · verified person" shows when the operator's claim is valid and the operator is a `Person`.

Full spec: https://github.com/shawntabrizi/polkadot-chat-desktop/blob/main/docs/spec/0010-bot-directory.md

## What we learned while writing it (not built)

- **Cost.** 1 submission and 1 live slot per bot per day. The reviewer set aside the letter of the efficiency rule for this ("no submission without a user action"): the card is the bot's presence. For comparison, a bot's heartbeat is 720 submissions a day at a 120 s interval.
- **No chain field for "bot".** The identity pallet is gone from the next People runtime, and username functions are deprecated in favour of DotNS.
- **Eviction.** A full account loses its lowest-expiry statement first. Chat statements never expire, so the card goes first. The bot must watch its card and re-publish.
- **Spam resistance** rests on how many attested accounts one human can get. We do not know that number.

## Relation to paritytech/individuality#1221

paritytech/individuality#1221 proposes first-class, person-sponsored bot consumers (`Credibility::Bot`, a `-bot` username suffix). If it lands, "this account is a bot" and "a person stands behind it" become chain facts. The card then stops being the proof and becomes discovery metadata only: tags, tagline, pricing, capabilities.

## Clients that do not support it

- Cards live on their own topic and never enter a chat. A client that does not subscribe never sees them.
- Nothing changes for the phone apps.

## Open questions

1. Is a Statement Store topic the right home, or should the directory wait for #1221 plus a DotNS record?
2. Merge the card with the bot's heartbeat, so the directory costs no extra submission?
3. Is one refresh per day an acceptable exception to the efficiency rule?
4. Kind 251 is provisional.

Decision wanted: adopt, adopt with changes, or reject. React 👍/👎 or comment.
