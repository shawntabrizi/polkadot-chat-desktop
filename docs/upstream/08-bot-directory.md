# Bot directory: signed bot cards on a well-known statement topic

Board mission: M2 Bot-native app

Related board items: "Resources: add first-class, person-sponsored bot consumers" (individuality#1221), "individuality · Usernames — Bot username class: `-bot` suffix + lite-stem tightening", "clients · Protocol — Distinguish bots from people in the UI".

## Problem

- A person cannot find a bot unless they know its username. The identity backend search matches all usernames and does not say which are bots.
- A bot is marked as a bot only after the chat starts (`botInfo`, proposal 05).
- The prototype's demo mode ships a fixed list of bot usernames in the app. That is a central list.

## What we specified (not built)

- A bot signs one **bot card** and publishes it as a statement on a fixed directory topic and a fixed channel, so each account holds at most one card. Expiry 72 h. The bot refreshes it once a day.
- Card (provisional kind 251, as the leading byte of the statement data): username, name, tagline, kind, tags, a reference to its `botInfo` version and hash, pricing, capability bits, an optional operator claim signed by the operator's account, `issuedAt`.
- A client subscribes to the topic. It checks each card against the People chain (the username belongs to the signer; the signer has a chat key) and searches locally.
- "Run by @operator · verified person" shows when the operator's claim is valid and the operator is a `Person`.
- A bot that lists kinds in its card counts as having sent capabilities for them (proposal 01).

Why this form, and the alternatives we considered:

| Option | Why we did not choose it |
|---|---|
| A list in the app (today's demo mode) | A central list that only an app release can change. |
| A chain registry (a pallet or a contract) | A fee per bot, and no chain field for "bot" today. The identity pallet is gone from the next People runtime; username functions are deprecated in favour of DotNS. |
| A DotNS record per bot | Resolves one name; it does not let a client search or list. It may hold the card later (open decision 1). |
| Merge the card into the bot's heartbeat | Fewer submissions (open decision 2), but it couples discovery to the bot runtime's liveness probe. |

Full spec: https://github.com/shawntabrizi/polkadot-chat-desktop/blob/main/docs/spec/0010-bot-directory.md

## Cost

- **Submissions: 1 per bot per day.** This breaks the letter of the efficiency rule ("no submission without a user action"). The reviewer set it aside: the card is the bot's presence. For comparison, a bot's heartbeat is 720 submissions a day at a 120 s interval.
- **Allowance: 1 live slot per bot.** A full account loses its lowest-expiry statement first. Chat statements never expire, so the card goes first (proposal 11). The bot must watch its card and publish it again.
- **Bytes.** 110–260 bytes per card for our demo bots (vectors).
- **Client.** One subscription; the People-chain checks are reads, not submissions. The number of cards a client must hold at scale: **not measured**.

## What it gives the user

- Search for bots by name, tag or tagline before a chat starts.
- A bot badge before the first message.
- "Run by @operator · verified person" when a person stands behind the bot.

## Relation to individuality#1221

individuality#1221 proposes first-class, person-sponsored bot consumers (`Credibility::Bot`, a `-bot` username suffix). If it lands, "this account is a bot" and "a person stands behind it" become chain facts. The card then stops being the proof and becomes discovery metadata only: tags, tagline, pricing, capabilities.

## Clients that do not support it

- Cards live on their own topic and never enter a chat. A client that does not subscribe never sees them.
- Nothing changes for the phone apps.

## Open decisions

1. **Is a directory worth one submission per bot per day at all?** Yes (build it on a statement topic) / no (wait for individuality#1221 plus a DotNS record).
2. **Heartbeat.** Merge the card with the bot's heartbeat, so the directory costs no extra submission? Yes / no.
3. **Spam.** Resistance rests on how many attested accounts one human can get. We do not know that number. Accept the risk for v1, or require an operator claim from a `Person`? Choose one.
4. Kind 251 is provisional.

Status: Specified, not built. polkadot-chat-desktop spec c5c95dc, review 6a186ff; plan `docs/milestones/M17.md`. The bots it would list run on polkadot-chat-agents branch `desktop/rfc-0003` b8b9fc4.

Decision wanted: answer the open decisions, then adopt, adopt with changes, or reject. React 👍/👎 or comment.
