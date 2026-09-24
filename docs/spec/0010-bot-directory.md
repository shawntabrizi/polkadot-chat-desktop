# RFC: Bot Directory

|                 |                                                                                  |
| --------------- | -------------------------------------------------------------------------------- |
| **Start Date**  | 2026-09-24                                                                        |
| **Description** | A bot publishes a signed card on a well-known Statement Store topic; clients list, search and verify bots from that topic, with no central manifest |
| **Authors**     | Shawn Tabrizi (with the desktop client team)                                      |
| **Status**      | Draft in `polkadot-chat-desktop/docs/spec`; plan in `docs/milestones/M17.md`; vectors in `vectors-0010.md` |
| **Provisional kinds** | `botCard` = 251 (to be added to `kinds.md`)                               |
| **Research**    | `docs/reference/bot-directory-designs.md` (People chain, DotNS, Statement Store facts; Telegram, Farcaster; five options compared) |

## Summary

A bot publishes one **bot card**: a small SCALE document signed by the bot's
own account, submitted as a Statement Store statement on a fixed
**directory topic**, on a fixed channel (so each account holds at most one
card), with an expiry 72 hours ahead. The bot refreshes it once a day. A
client lists bots by subscribing to the directory topic, checks each card
against the People chain (the username belongs to the signer; the signer has
a chat key), and shows the result in a **Bots** tab with local search. The
card names the bot's **operator** with the operator's signature; the client
shows "Run by @operator" and a person mark when the operator is a verified
person on the People chain. An optional DotNS text record on the operator's
name gives a durable second link. The built-in demo manifest (M12i) goes
away: the demo fleet publishes cards and shows up like any other bot.

Cost: **one submission per bot per day** and one live statement slot. No
chain transaction, no fee, no new contract, no runtime change.

## Motivation

- A person cannot find a bot today unless they already know its username.
  The identity backend search matches prefixes of all usernames, costs a
  proof of compute per query, rate-limits, and does not say which names are
  bots (`src/renderer/domain/identity/search.ts`).
- A bot is marked as a bot only after the chat starts (`botInfo`, 0008).
  Before that, a bot and a person look the same.
- The demo mode (docs/decisions.md "## M12i") ships a list of six
  usernames in the app, with an optional manifest URL. That is a central
  list owned by whoever builds the app; it cannot grow with the network.
- The roadmap asks for a bot directory, a bot marker and a person-vs-bot
  badge (`docs/roadmap.md` "Backlog from the landscape review").

## Stakeholders

- People who want to find a bot: they need a list, search, and a reason to
  trust an entry.
- Bot operators (`pca` users): they need a single command to publish, and a
  cost they can see.
- Client implementers (desktop, phone apps): the design must work on a
  phone with a Statement Store subscription and People-chain reads, which
  the apps already have.
- Statement Store operators: the efficiency rule (`efficiency.md`).

## Explanation

### Notation

`encode`, `hash(Model) = blake2b_256(encode(Model))`, `String`, `Vec<T>`,
`Option<T>` and little-endian integers as in the base spec and
`vectors-0010.md`. "The client" is any chat client; "the bot" is the
account that signs the card.

### Why a Statement Store card

The research compares five places to put a bot marker
(`bot-directory-designs.md` §4). In short: the People chain has no field for
it (the identity pallet is removed from the next People runtime; the
`Resources` consumer record has no free field); a username suffix proves
nothing; a registry contract pays a fee per change and does not know about
personhood; a DotNS text record cannot be listed. A Statement Store card is
gated by the **personhood allowance** (only attested accounts can submit at
all), holds one card per account (fixed channel), drops a dead bot by expiry
at no cost, and is listed by one topic subscription.

### Topics and channel

```
DIRECTORY   = "pcd-bot-directory-v1"
directoryTopic      = hash(String DIRECTORY)
tagTopic(tag)       = hash({ context: String DIRECTORY, tag: String })
cardTopic(account)  = hash({ context: String "pcd-bot-card-v1", account: [u8; 32] })
cardChannel         = hash(String "pcd-bot-card-channel-v1")
```

A card statement carries, in this order:
`[directoryTopic, cardTopic(signer), tagTopic(tags[0])?, tagTopic(tags[1])?]`
(the tag topics only for the first two tags; the store allows four topics).
Its channel is `cardChannel`. The store keeps one statement per (account,
channel), so a new card from the same account replaces the old one.

- `directoryTopic`: every card. The Bots tab subscribes to it.
- `cardTopic(account)`: one bot's card. A client that knows an account (a
  chat, a shared card, a username lookup) fetches its card with
  `matchAll([cardTopic(account)])`, without the whole directory. The bot
  also watches it to see that its card is live.
- `tagTopic(tag)`: a phone may list one tag only (`matchAll([directoryTopic,
  tagTopic("game")])`) when the directory is large.

Values: `vectors-0010.md` "Topics".

### The card (`botCard`, kind 251)

```
BotCard = {
    version: u8                 // 1
    username: String            // the bot's username as the chain stores it ("pcdguide.70")
    name: String                // display name, 1..=40 characters
    tagline: String             // 1..=80 characters, one line
    kind: u8                    // as BotInfo.kind: 0 bot, 1 agent, 2 person-operated service
    tags: Vec<String>           // 1..=5 tags, each 1..=20 of [a-z0-9-]
    info: InfoRef               // the botInfo this card summarises
    pricing: Pricing
    capabilities: u32           // bit set, below
    operator: Option<OperatorClaim>
    issuedAt: u64               // unix seconds when the bot signed this card
}
InfoRef = { version: u16, hash: [u8; 32] }   // hash = blake2b_256 of the BotInfo content bytes (0008, no kind byte)
Pricing = enum {
    free = 0,
    perReply { amount: u128, decimals: u8, unit: String /* <= 8 */ } = 1,
    varies { note: String /* <= 40, "stake 0.5 PAS per flip" */ } = 2,
}
OperatorClaim = {
    account: [u8; 32]           // the operator's People-chain account
    username: String            // the operator's username
    validUntil: u64             // unix seconds; the claim is void after it
    signature: [u8; 64]         // sr25519 by `account` over the operator message
}
operator message = b"pcd-bot-operator-v1" : botAccount (32 bytes) : u64_le(validUntil)
```

Statement `data` = `0xfb` (kind 251) followed by `encode(BotCard)`. The
leading kind byte lets a decoder reject foreign data on the topic, and lets
the same bytes travel as a message content kind (see "Sharing a card").

Well-known tags (the demo tags, so today's UI keeps its chips): `assistant`,
`game`, `payments`, `utility`. Others are free text within the limits; the
client shows the first well-known tag as the chip and the rest as text.

Capability bits (a hint for the UI; the bot's behaviour is the truth):

| Bit | Meaning | Spec |
|---|---|---|
| 0 | understands and sends buttons, answers `buttonPress` | 0006 |
| 1 | sends `tx` actions and `transactionReference` | 0007 |
| 2 | joins fan-out groups (v1) | 0009 |
| 3 | joins private groups (v2) | 0011 |
| 4 | receives attachments | 0012 |
| 5 | sends attachments | 0012 |
| 6 | declares a balance hint (metered or staked use) | 0008 v2 |
| 7–31 | reserved, 0; a decoder ignores unknown bits | |

The card deliberately leaves out the description, the greeting and the
commands: they are in `botInfo`, which the bot sends when the chat starts.
`info.hash` lets a client that already holds that `botInfo` know whether it
is current, and lets a later revision fetch the full document before a chat.

Size: 110–260 bytes for the fleet (`vectors-0010.md`). A decoder rejects a
card over 1,024 bytes.

### Operator

The operator is the person who runs the bot. The operator signs the
operator message once with their own account (for example with
`pca operator-sign`) and gives the claim to the bot, which includes it in
every card until `validUntil`. The signature binds the operator to this bot
account only; another bot cannot reuse it. The operator ends the claim by
not renewing it; a short `validUntil` (the reference `pca` default is one
year) bounds a stale claim.

The client shows, from strongest to weakest:

1. **Verified operator** — the claim is valid, the operator's username
   belongs to the operator's account (`Resources.UsernameOwnerOf`), and the
   operator's `Resources.Consumers` record has `credibility = Person`. Text:
   "Run by @alice · verified person". This is the "verified operator" of
   the roadmap: a person, proven by proof of personhood, stands behind the
   bot.
2. **Operator** — the claim is valid and the username matches, credibility
   `Lite`. Text: "Run by @alice".
3. **No operator** — no claim, an expired claim, a bad signature, or a
   username that does not match. Text: nothing; the entry is ranked lower.
   A bad signature is never shown as "unverified operator": it is dropped.

A claim where `operator.account` equals the bot's account is ignored (a bot
cannot vouch for itself).

**Optional durable link (DotNS).** An operator who owns a DotNS name MAY set
the text record `chat.bots` on it to a space-separated list of bot
usernames. A client MAY read it on the bot's detail page and show the DotNS
name ("Run by alice.dot"). This needs an Asset Hub read and a name the
operator paid for; it is not required for any other part of this RFC and is
not built in M17.

### Publishing (the bot)

- A bot MUST NOT publish a card while it accepts messages from an allowlist
  only (a private bot is not for the directory).
- A bot publishes its card on start, when a field changes, and **once every
  24 hours**. Expiry = `(issuedAt + 72 h) << 32` (upper 32 bits the
  expiration time, sequence 0). A change within the same second uses
  sequence 1, 2, ….
- A bot publishes at most one card per hour for changes (a field that
  changes more often, such as a live price, belongs in `botInfo`, not here).
- **Eviction.** When an account is at its allowance, the store evicts that
  account's lowest-expiry statement first. A pca bot's chat statements use
  the highest expiry (`0xffffffff << 32 | seq`), so the card is the first
  to go. The bot MUST watch `cardTopic(self)` and re-publish when its card
  disappears, and SHOULD keep one slot of its allowance free for it.
- The bot's card replaces nothing in its chat traffic. The heartbeat stays
  as it is; merging the heartbeat with the card is an unresolved question.

### Listing and checking (the client)

1. Subscribe `matchAll([directoryTopic])` (or with one `tagTopic`) while the
   Bots tab is open; the initial fetch gives every stored card, then live
   ones. Unsubscribe when the tab closes.
2. For each statement: decode `data`; drop it when the first byte is not
   `0xfb`, `version ≠ 1`, a limit is broken, `issuedAt` is more than 10
   minutes in the future or more than 72 hours in the past, or the topics
   do not include `directoryTopic` and `cardTopic(signer)`.
3. Keep the newest card per signer (highest `issuedAt`).
4. Check against the People chain at the best block, in one batched read
   per page of new cards: `UsernameOwnerOf(canonical(username)) == signer`
   and `Consumers(signer)` has a usable 32-byte chat key. A card that fails
   is dropped (it would fail at "Start chat" anyway). Operator claims are
   checked the same way (signature, `validUntil > now`,
   `UsernameOwnerOf(operator.username) == operator.account`, then
   `Consumers(operator.account).credibility`).
5. Store the checked cards in a local table keyed by signer, with the time
   of the check. Re-check a card when its username or operator changes, or
   after 24 hours.

The store gossips only statements that passed its own checks (proof,
allowance), so every card on the topic was submitted by an attested
account. The client's People-chain check adds the username binding, which
the store does not know about.

### Search and ranking

- Search is local over the checked table: the query matches (case-free,
  substring) the username, name, tagline, tags and operator username. The
  identity backend search is not used for bots.
- Order when the query is empty, and within results:
  1. bots I have a chat with (they are also in the chat list);
  2. verified operator, then operator, then no operator;
  3. a well-known tag before free tags only;
  4. first seen by this client, oldest first (a new card cannot jump ahead
     of an established one by refreshing);
  5. name.
  There are no usage counts: nothing in the protocol counts opens or chats,
  and a client MUST NOT publish such counts.
- Pages of 20 rows; "Show more" reveals the next page from the local table.
  The subscription itself is not paged: the store delivers the initial set
  in batches with a `remaining` counter, and the client shows the first page
  as soon as 20 checked cards exist.
- A client MAY cap the in-memory directory (2,000 cards) and switch to a tag
  topic above it. A read-only indexer that serves pages of the same signed
  cards is a later option (Unresolved).

### Reporting and blocking

- **Block** on a directory row: the existing block (M12e blocked list)
  plus "hide from directory" for that signer. Local, as today.
- **Hide** without blocking: local, one tap, undo in the toast.
- **Report**: in v1 the same as Hide plus a local reason; nothing is sent.
  There is no central moderator to send it to. A shared report list
  (curator statements that clients may follow) is Unresolved.
- A bot that is hidden or blocked is never shown in the Bots tab or its
  search, but still resolves by exact username (a person may unblock).

### Sharing a card

`botCard` (251) MAY also be sent as message content in a DM or group, to
recommend a bot. The recipient shows a card bubble with "Start chat". A
shared card is only a hint: before it shows the operator line, the client
fetches the live card with `matchAll([cardTopic(account)])` and applies the
checks above; with no live card it shows the username only. Cost: zero
extra submissions (it rides in a message that is sent anyway).

### Client UI (desktop)

- A **Bots** tab in the left pane next to Chats: a search field, tag chips
  (All, Assistant, Game, Payments, Utility), rows with avatar, name, bot
  badge (0008 kind), tagline, price hint ("0.1 PAS per reply", "Free"),
  "Run by @operator" with a person mark, and a "Start chat" or "Open"
  button. Row hover shows Hide.
- A **detail pane** on row click: the card fields, capability chips
  (Buttons, Payments, Groups, Files), operator line, the bot's username and
  account with Copy, and Start chat / Block / Hide / Report.
- Global search: the "Bots" section lists directory hits (local) above the
  network search hits.
- **Demo mode (M12i)** becomes: after sign-up, the onboarding pane shows the
  first page of the Bots tab ("Meet some bots") with "Start chats with
  all" for the listed demo operator's bots (see Migration); Settings › Demo
  is removed, the Bots tab replaces it.

Phone clients need the same three things: a Statement Store subscription
(they have one for chat), a batched People-chain read (they have one for
identity), and sr25519 verification (they sign with sr25519 already).

### pca

- `pca publish-card <bot>`: builds the card from the bot's config and its
  current `botInfo` (name, kind, `info.version`, `info.hash`), plus new
  config fields `tagline`, `tags`, `pricing`, and the stored operator claim;
  refuses when the bot's access is an allowlist; submits it; prints the card
  hash, the topics and the expiry.
- `pca operator-sign <bot> --operator <path to operator secret>`: signs the
  operator message for the bot's account with a one-year `validUntil` and
  stores the claim in the bot's config. The operator's secret never goes
  into the bot's directory.
- bot-core: publish on start, on change, every 24 hours; watch
  `cardTopic(self)` and re-publish when missing; log `BOT_CARD_PUBLISHED`
  and `BOT_CARD_MISSING`. Env `BOT_CARD=0` turns it off.
- `pca info` shows the card state (live, expires in, missing).

### Migration from the built-in manifest

1. M17 (both repos): the six demo fleet bots get `tagline`, `tags`, `pricing`
   and one operator claim signed by a fleet operator identity; they publish
   cards. The desktop gains the Bots tab reading the topic.
2. The desktop deletes `BUILT_IN_DEMO_BOTS`, `src/main/demoManifest.ts`,
   `PCD_DEMO_MANIFEST_URL` and the `demo:bots` IPC. What stays of the demo:
   one constant, the fleet operator's account per network profile
   (`DEMO_OPERATORS`), used only to pick which directory entries "Start
   chats with all" starts in the onboarding. The list of bots comes from the
   topic, not from the app.
3. On Paseo no fleet runs: the onboarding step stays hidden when no card of
   a demo operator is live.

### Cost (efficiency rule)

| Action | Submissions | Allowance | Chain |
|---|---|---|---|
| Card refresh | **1 per bot per day** | 1 live slot, 110–260 B of 512 KB | none |
| Card change | 1 (at most 1 per hour) | same slot | none |
| Re-publish after eviction | 1 per eviction | same slot | none |
| Listing, search, checks | 0 (reads) | none | batched People-chain reads |
| Sharing a card in a chat | 0 (rides in the message) | none | none |
| Operator claim | 0 (signed off-line) | none | none |
| DotNS `chat.bots` (optional) | 0 | none | 1 Asset Hub tx per change (fee unverified) |

For comparison: a pca bot's heartbeat is 720 submissions per day. The whole
six-bot demo fleet adds 6 submissions per day.

The rule "a new kind MUST NOT add submissions unless it replaces a user
action" is met in spirit, not in letter: the card adds one submission per
bot per day with no user action to replace. It is a tier-2 cost ("one per
event": the event is a day) and replaces an off-network one (the manifest
file). The owner should confirm this.

## Privacy

- A card is public on purpose: it says "this account is a bot, run by this
  operator". An operator who does not want to be linked to a bot leaves out
  the claim.
- Subscribing to `directoryTopic` tells the RPC node that this client opened
  the Bots tab, not which bot it chose. Fetching `cardTopic(account)` tells
  the node which bot the client looks at; a client SHOULD prefer the cached
  directory copy.
- The card links a bot account to its username; that link is already public
  on the People chain.

## Security

- **Forgery:** a card is signed by the statement proof; the client checks
  that the username belongs to the signer. A card cannot claim another
  bot's username.
- **Impersonation by name:** anyone can publish "Guide". The client shows
  the username next to the name and ranks verified operators first. A name
  that equals a verified bot's name from a different account gets no
  special mark (Unresolved: a warning).
- **False operator:** needs the operator's signature over this bot's
  account; the client checks it.
- **Spam:** bounded by the number of attested accounts per human (one card
  per account). Each card costs its publisher an allowance slot. A person
  may publish a card for a person account; that is allowed and harmless.
- **Churn:** the allowance caps live statements, not re-submissions. A
  hostile account can re-publish its card often; clients keep the newest
  per signer and re-render at most once a second. Store-side rate limiting
  per account is an upstream question.
- **A bot that hides that it is a bot** (no card, no `botInfo`) is not
  solved here.

## Drawbacks

- Every client that opens the Bots tab downloads every card (about 250 KB
  per 1,000 bots) the first time.
- Liveness costs one submission per bot per day forever.
- The trust signal is only as strong as the lite-person sybil bound.
- No usage-based ranking: good bots and new bots look alike.

## Testing

- Codec: `vectors-0010.md` byte for byte in both codecs; topic hashes;
  operator signature verify; the negative cases listed there.
- Client checks: a card whose username belongs to another account is
  dropped; an expired or future `issuedAt` is dropped; a bad operator
  signature drops the claim, not the card; newest per signer wins.
- e2e (M17): the six demo fleet bots publish; a fresh client with no manifest
  lists all six within 60 s, starts a chat with one, and the chat works.

## Compatibility

Development mode: sent freely. A client that does not know kind 251 never
subscribes to the directory topic, so cards cost it nothing. A shared card
in a chat shows as the base spec's unsupported bubble on an old client.

## Unresolved Questions

1. **Lite-person sybil bound.** How many attested accounts can one human
   get? If lite attestation is cheap, the directory needs a stronger signal
   (verified operator only by default). This is the biggest open question.
2. **Merge heartbeat and card?** The heartbeat (720 per day) could carry the
   card and give live "online" state, but directory subscribers would then
   receive every heartbeat. Kept separate in v1.
3. **Shared report and curation lists.** Curator accounts could publish
   signed allow or deny lists on a list topic that clients choose to follow
   (a second kind). Who curates by default?
4. **Large directories.** Above ~10k cards: a read-only indexer that serves
   pages of signed cards (the identity backend?), or tag-only listing on
   phones.
5. **Avatars.** A Bulletin CID in the card expires in 14 days (0012); an
   avatar needs a renewal story first.
6. **Full `botInfo` before a chat.** Publish it on `cardTopic` as a second
   statement (a second slot), or keep it chat-only?
7. **Name squatting warnings** for cards whose name equals a verified bot's
   name.
8. **Upstream shape.** Does chat-spec want the directory in the base spec,
   and under which topic name (the `pcd-` prefix is ours)?
9. **Efficiency ruling.** The owner confirms one submission per bot per day
   as acceptable (see Cost).
