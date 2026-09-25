# Upstream proposal drafts for paritytech/chat-spec

These are drafts of GitHub issues for `paritytech/chat-spec`. Each one asks the maintainers to adopt, change or reject one extension. The prototype is the evidence: this repo (commit b5cbe5d) and `polkadot-chat-agents` branch `desktop/rfc-0003` (b8b9fc4). Nothing here is posted yet. The owner reviews the drafts first.

Each file starts with the issue title. The first lines give the board mission, the status and (for groups) the board item it replaces. The full specs are in `docs/spec/`.

## The drafts

| File | One line |
|---|---|
| `01-capabilities.md` | Each device tells its peers which kinds and file variants it decodes; this gates every other extension; a baseline phone sees one "unsupported" bubble per chat. Read first. |
| `02-typing-and-seen.md` | Read receipts ride the next message (0 extra submissions); typing is off by default because it multiplied the cost of a message by about 5. |
| `03-buttons.md` | Keyboards and structured presses for bots; host leniency for small models; label limits; menu as numbered text for old clients. |
| `04-transactions.md` | `tx` intents inside buttons and one `transactionReference` per transaction; the Revive worst-case limits rule; `expiresAt = 0`. |
| `05-bot-info.md` | A bot describes itself (badge, commands, greeting) with an optional balance hint that shows balance minus pending charges. |
| `06-private-groups-v2.md` | Groups on a secret epoch topic: 1 submission per message, 2 per removal at any size; the MLS survey; cap 256. Supersedes "chat-spec · Groups — Bots in group chats". |
| `07-bulletin-file-variant.md` | Bulletin transaction storage as `FileVariant` 1 next to HOP; measured Bulletin facts; asks chat-spec to define what an unknown `FileVariant` does. |
| `08-bot-directory.md` | Signed bot cards on a well-known statement topic; spec only, not built; individuality#1221 would make the bot mark a chain fact. |
| `09-deletion-kind-number.md` | RFC-0003 `deleted` uses kind 20, which `DeviceChatAccepted` already has; use 21. May fit better as a change to chat-spec#5. |
| `10-piggybacked-ack.md` | The acknowledgement makes a conversation cost about 2 submissions per message; let it ride the next request (already a base-spec TODO). |
| `11-statement-quota.md` | Never-expiring DM statements fill a 50-statement allowance after about 25 peers; evidence for two existing board items. |
| `12-hop-cipher-envelope.md` | RFC-0001 and RFC-0004 are merged, but the base spec text still says AES-GCM and a bare envelope; fold them in; t3ams differs. |
| `13-markdown-dialect.md` | Pin a CommonMark subset for `RichText.text`; render own messages the same as a peer's. |

## Order to post

1. `01` capabilities: the others refer to it.
2. `09` deletion number and `12` HOP text: small fixes to what chat-spec already has.
3. `10` ACK and `11` quota: base-protocol cost findings that affect every design after them.
4. `02` typing and seen, `03` buttons, `05` bot info, `04` transactions: small content kinds, in dependency order.
5. `13` markdown: text only.
6. `07` attachments and `06` groups: the large designs.
7. `08` bot directory: not built; it may wait for individuality#1221.

## Before posting

- Kind numbers marked "provisional" come from `docs/spec/kinds.md`. chat-spec assigns the real ones.
- chat-spec is a private repo. The spec links point to this public repo.
- Items marked **unverified** or **not checked** in a draft stay marked in the issue.
