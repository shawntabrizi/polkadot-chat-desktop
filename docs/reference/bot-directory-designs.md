# Bot directory designs: on-chain marker, listing, operators (2026-09-24)

Research input for `docs/spec/0010-bot-directory.md`. Question: how does a
bot say "I am a bot" on the network, how does a client list and search bots
with no central manifest, and how does a client show who runs a bot? Today
the demo mode ships a built-in list (`src/shared/demoBots.ts`,
docs/decisions.md "## M12i"); a bot is only known as a bot after it sends
`botInfo` (spec 0008) inside a chat.

Labels: **[V]** read in the cited file, page or live answer. **[S]** seen
only in a search snippet: unverified. **[I]** our inference, not stated by
the source.

## Sources

- Statement Store: `paritytech/polkadot-sdk` master `83b147a9b29a`
  (2026-09-23): `substrate/client/statement-store/src/lib.rs`,
  `substrate/client/network/statement/src/lib.rs`.
- People chain: `paritytech/individuality` `main` `0676dbbfe252`
  (2026-09-14): `pallets/resources/src/lib.rs`,
  `pallets/dotns-gateway/src/lib.rs`, `runtimes/next-people-paseo/src/lib.rs`.
- DotNS: `paritytech/dotns-sdk` `main` `96d49d5ec0d6`:
  `packages/cli/src/commands/textRecord.ts`, `packages/cli/src/utils/constants.ts`.
- pca: `polkadot-chat-agents` `origin/desktop/rfc-0003` `2ef2aa7`:
  `bot-core/index.mjs` (heartbeat, expiry), `bot-core/cli.mjs` (commands).
- This repo: `docs/spec/efficiency.md` ("Allowance facts"), `0008-bot-info.md`,
  `src/renderer/domain/identity/{lookup,search}.ts`, `src/shared/demoBots.ts`,
  `.refs/chat-spec/base-spec.md` (chat-spec `7af4fab`).
- Web pages, fetched 2026-09-24: Telegram
  <https://core.telegram.org/bots/features>, <https://core.telegram.org/bots/api>,
  <https://core.telegram.org/api/bots/verification>; Farcaster
  <https://miniapps.farcaster.xyz/docs/guides/publishing>,
  <https://miniapps.farcaster.xyz/docs/guides/discovery>.

## 1. What the client needs (from the code)

- The demo list holds, per bot: `username` (`name.NN`), `tagline` (1–80
  characters), one `tag` of four (`assistant`, `game`, `payments`,
  `utility`). [V] `src/shared/demoBots.ts`.
- Username to account: an exact read of `Resources.UsernameOwnerOf` at the
  best block. [V] `lookup.ts` `createUsernameResolver`. The chat key comes
  from `Resources.Consumers` (`identifier_key`). [V] `lookup.ts`.
- The only list of names today is the identity backend search: HTTP, prefix
  match, a proof of compute per query, 429 after about seven quick queries.
  [V] `search.ts`; docs/decisions.md "## M12i". It returns people and bots
  mixed, with no bot flag.
- `botInfo` (kind 244) gives name, description, commands, kind (bot, agent,
  service), balance hint. It arrives only inside an accepted chat. [V]
  `0008-bot-info.md`.

So a directory must give, before any chat: the username and account, a
display name and tagline, tags, a bot flag, and enough to trust the entry.

## 2. The rails

### People chain (individuality)

- `Resources.Consumers: AccountId → ConsumerInfo` and
  `Resources.UsernameOwnerOf: Username → AccountId`. At most two usernames
  point to one consumer: the lite username (always) and an optional full
  person username. [V] `pallets/resources/src/lib.rs:304-374`.
- The consumer record the client reads has `identifier_key`,
  `full_username`, `lite_username`, `credibility` (`Lite` or
  `Person { alias }`). [V] `lookup.ts` `RawConsumer` (decoded from the live
  runtime). **No free text field, no tag, no "bot" flag.**
- **The identity pallet is removed** from the next People runtime:
  `// Removed: pallet identity at 50 (indiv_pallet_identity)`. [V]
  `runtimes/next-people-paseo/src/lib.rs:1280`. So the classic
  `pallet-identity` fields (display, web, image, `additional`) do not exist
  for these accounts. The old Polkadot People chain still has them, but chat
  identities do not live there. [I]
- The username part of `Resources` is deprecated in favour of
  `pallets/dotns-gateway` (usernames as DotNS names). [V] resources
  `lib.rs:26-34`. The lite label format is `<dns-stem>.<2+ digits>` (for
  example `alice.42`); the digits are allocated, not chosen. [V]
  dotns-gateway `lib.rs:300-306`.
- A "system" or "org" identity: none in these pallets. The only classes are
  lite person and person (`credibility`). [V] `lookup.ts` fields; resources
  `register_lite_person`, `register_person`. [I] An org is a person who
  operates accounts.

### DotNS (Asset Hub)

- DotNS is an ENS-shaped set of Revive contracts on Asset Hub: a registry
  and a content resolver with `text(node, key)` records. [V] dotns-sdk
  `textRecord.ts` (reads `DOTNS_CONTENT_RESOLVER.text`), `constants.ts`
  (`PASEO_ASSET_HUB_URL`, devnet Asset Hub `chain 420420417`).
- Setting a text record is an Asset Hub transaction by the name owner. [V]
  `setTextRecord` checks the resolver authorization. Fee and storage deposit
  per record: **unverified** (not measured).
- There is no "list all names with key X" on chain. An indexer would have to
  read events. [I]
- Which runtime hosts `dotns-gateway` today, and whether devnet lite
  usernames already exist as DotNS names: **unverified** (the
  next-people-paseo runtime at `0676dbb` lists neither `DotnsGateway` nor
  Revive).

### Statement Store (People chain nodes)

- A statement has up to 4 topics, an optional 32-byte channel, an expiry,
  data and a proof; one statement per (account, channel); a new one replaces
  the old one only with a strictly higher expiry. [V] see
  `docs/reference/group-designs.md` "The rails" (same commit).
- Submit checks, in order: already expired, size (≤ 1 MiB − 1), duplicate,
  proof, **allowance** (`:statement_allowance:<account>`; `NoAllowance`
  when none), per-account limits with eviction of the account's own
  lowest-expiry statements. [V] client `lib.rs:2716-2740`. **There is no
  upper bound on expiry.** [V] same pipeline; pca already uses expiry
  `0xffffffff << 32 | seq` for its chat statements. [V] `bot-core/index.mjs:824-834`.
- Allowance on devnet: 50 statements, 512 000 bytes live per chat identity,
  granted only by the identity backend's personhood attestation. [V]
  `efficiency.md` "Allowance facts". Paseo: person 200 / 1 MiB, lite person
  50 / 500 KiB. [V] group-designs.md.
- Subscribers filter by topic only (`matchAll` ≤ 4, `matchAny` ≤ 128); the
  initial fetch returns every stored statement that matches, then live ones.
  [V] base-spec "Basic types and Statement Store model".
- A node that joins receives the store's existing statements (initial
  sync); full nodes get all statements unless they opt into a topic
  affinity; light-client peers must advertise a topic bloom first. [V]
  `client/network/statement/src/lib.rs:52-99`.
- Global limits: about 4 million statements and 2 GiB per node; expired
  statements are purged after 48 h. [V] client `lib.rs:172-177`.
- A pca bot already keeps one public statement live: its heartbeat, on a
  private health topic and channel, every 120 s (720 submissions per day).
  [V] `bot-core/index.mjs:4048-4085`, `efficiency.md`.

## 3. Prior art

### Telegram

- BotFather `/newbot` creates a bot. "Your bot's username must end in 'bot',
  like 'tetris_bot' or 'TetrisBot'." [V] bots/features.
- Metadata: description (≤ 512 characters, shown on first open), about text
  (≤ 120, profile page), profile photo, command list; description and about
  can be localized. [V] bots/features.
- The Bot API `User` object has `is_bot: Boolean`. [V] bots/api. The flag is
  set by the server; a client cannot fake it. [I]
- Third-party verification (Bot API 8.2): "official third-party services"
  and bots verified by Telegram can assign a custom-emoji verification icon
  to users and chats (`verifyUser`, `verifyChat`, removal methods). [V]
  api/bots/verification; the method names [S] from the changelog snippet.
- No public bot directory in the API; discovery is global search by
  username and third-party catalogs. [I] (the features page has none).

Lessons: a server-set bot flag plus a naming rule; verification is issued by
named organizations, not self-claimed; the profile is short (120 / 512).

### Farcaster mini apps

- Publishing is a manifest at `/.well-known/farcaster.json` on the app's
  domain: `name`, `iconUrl`, `homeUrl`, `description`, `primaryCategory`,
  `tags` (≤ 5, lowercase, ≤ 20 characters), `noindex`. [V] guides/publishing.
- `accountAssociation`: a signed message that ties the domain to a Farcaster
  account's custody key. [V] guides/publishing. This is operator
  attribution: the app is "by" an FID.
- Discovery: the app must be registered, needs "some user engagement before
  appearing in search", ranks by opens, adds and a trending score, and is
  refreshed daily; dev tunnels are excluded. [V] guides/discovery. The index
  is Farcaster's (Warpcast's) server. [I]

Lessons: the entry is self-published and signed by an owner account; tags
are short and capped; ranking by usage needs a central indexer, which we do
not have and do not want.

## 4. Options compared

Assumptions for the arithmetic: a card of about 110–260 bytes (vectors in
`vectors-0010.md`); a bot refreshes it once a day; 1,000 bots.

| | A. People-chain identity field | B. Username suffix or namespace | C. Registry contract on Asset Hub | D. DotNS text record | **E. Signed card on a Statement Store topic** |
|---|---|---|---|---|---|
| Exists today | **No**: identity pallet removed; `Consumers` has no free field [V] | Convention only: any label `<stem>.<NN>` [V]; nothing enforces "bot" | No; a new contract | Yes: `text(node,key)` [V]; lite names in DotNS unverified | Yes: topics, channels, allowance [V] |
| Cost per bot per day | 0 after a runtime upgrade + 1 tx | 0 | 0 per day; 1 tx + deposit per change (fee unverified) | 0 per day; 1 Asset Hub tx per change (fee unverified) | **1 submission** (refresh), 1 live slot of 50, ~0.3 KB of 512 KB |
| Discoverability | Needs an indexer (no enumeration) | Needs the backend search to add a suffix query; still PoC + 429 | Enumerate with a view call or events: good | No enumeration: needs an indexer | **One topic subscription returns every card** |
| Spam resistance | Personhood (only consumers have records) | None: anyone can pick `fakebot.12`; people can pick it too | Fees and deposit only, unless the contract checks personhood (People chain state is not readable from Asset Hub) [I] | Name cost + fee | **Personhood allowance**: only attested accounts can submit; one card per account (fixed channel) |
| Operator attribution | Would need a new field | None | A field; signed by the caller | A record on the operator's name | Operator signature in the card, checked against the operator's People record |
| Verification | Chain-level (strong) | None | Contract-level | Name owner (strong) | Signature + People-chain credibility (`Person`) of the operator; DotNS as an optional second link |
| Liveness | None (a dead bot stays listed) | None | None | None | **Expiry**: a bot that stops refreshing drops out in 72 h |
| Phone client needs | People connection (has one) | Nothing new | Asset Hub connection + ABI decode (has one for payments) | Asset Hub + namehash + resolver ABI | Statement Store subscription (has one for chat) + People reads (has) |
| Change needs | Runtime upgrade in individuality: not ours | Nothing | Deploy + govern a contract | Nothing on chain; DotNS names for bots | Nothing on chain; a client and pca change |

Findings:

1. **A and B fail.** A needs a runtime change in a repo we do not own, and
   the pallet that had the fields was removed. B marks nothing: the lite
   digits are allocated by the chain and a "bot" stem is only a convention
   anyone can use. B stays useful as a *hint* ("names ending in `bot`") and
   costs nothing, but a client must never trust it.
2. **C** is the classic answer but pays a fee per change, has no link to
   personhood, and needs a governed contract. It also cannot express
   liveness without a keep-alive tx (a fee per day).
3. **D** is the right place for a *durable, owner-proved* statement ("this
   name operates these bots") but cannot list anything.
4. **E** is the cheapest sybil-resistant option: the store already gates
   writes by personhood, one channel caps each account at one card, expiry
   gives liveness for free, and one subscription lists everything. Its
   weaknesses: bytes grow with N on every client that opens the list (see
   §5), and the allowance limits live statements, not submission rate
   (`efficiency.md`), so a hostile account can re-submit its own card often.

## 5. Scale arithmetic for E [I]

- 1,000 bots × ~250 B = ~250 KB on the first open of the Bots tab; later
  opens read the local cache and only the live stream. 10,000 bots = ~2.5 MB:
  too much for a phone on each open. Mitigation: per-tag topics (a phone
  subscribes to one tag at a time) and a cache keyed by card hash. Above
  ~10k, a read-only indexer (the identity backend) can serve pages of the
  same signed cards; the client still verifies each signature, so the
  indexer can hide entries but cannot forge them.
- Network: 1,000 bots × 1 refresh per day = 1,000 submissions per day for
  the whole directory, against 720 per day per bot for today's heartbeat.
- Store: 1,000 × 250 B = 250 KB per node; negligible against the 2 GiB cap.

## 6. What the reviewer asked, answered

- **How a bot marks itself on chain:** by publishing a card (E). There is no
  People-chain field to set; the card is signed by the bot's own account and
  lives in the People chain's Statement Store. Optional durable link: a
  DotNS text record on the operator's name (D).
- **Listing without a manifest:** subscribe to the directory topic.
- **Operators:** the card carries the operator's account, username and a
  signature by the operator over the bot's account; the client shows "Run by
  @operator" and a person mark when the operator's `credibility` is `Person`.

## Open facts (unverified)

- The sybil bound of a lite person: how many attested accounts one human can
  get from the identity backend. The whole spam argument rests on it.
- Asset Hub fee and deposit for a DotNS text record.
- Whether devnet lite usernames (for example `pcdguide.70`) resolve as DotNS
  names today, and which runtime hosts `dotns-gateway`.
- Whether the public RPC nodes the phone apps use run as full nodes (receive
  every topic) or with a topic affinity.
