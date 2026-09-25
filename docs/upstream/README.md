# Upstream drafts for paritytech/chat-spec

Drafts for `paritytech/chat-spec`: 11 issues, 1 commit for an open pull request, and 1 comment on a board item. **Posted 2026-09-24.** The drafts here are the source; the posted issues are the live text.

| Draft | Posted |
|---|---|
| 01 capabilities | https://github.com/paritytech/chat-spec/issues/7 |
| 12 HOP text | https://github.com/paritytech/chat-spec/issues/8 |
| 10 piggybacked ACK | https://github.com/paritytech/chat-spec/issues/9 |
| 11 statement quota | https://github.com/paritytech/chat-spec/issues/10 |
| 02 typing and seen | https://github.com/paritytech/chat-spec/issues/11 |
| 03 buttons | https://github.com/paritytech/chat-spec/issues/12 |
| 05 bot info | https://github.com/paritytech/chat-spec/issues/13 |
| 04 transactions | https://github.com/paritytech/chat-spec/issues/14 |
| 07 attachments | https://github.com/paritytech/chat-spec/issues/15 |
| 06 private groups | https://github.com/paritytech/chat-spec/issues/16 |
| 08 bot directory | https://github.com/paritytech/chat-spec/issues/17 |
| tracking: open decisions | https://github.com/paritytech/chat-spec/issues/18 |
| 09 RFC-0003 renumber | commit 10c7c56 on chat-spec#5 (`rfc/message-deletion`) |
| 13 markdown dialect | appended to board draft "Pin the markdown dialect for RichTextContent.text" |

Board: all twelve issues added to paritytech project 297 under their mission. "Link tap opens with preview" and "Bots in group chats" archived with a superseded note. The other linked drafts got a "Related decision record" line.

The evidence is the prototype: this repo (latest commit named in each draft) and `polkadot-chat-agents` branch `desktop/rfc-0003` (b8b9fc4). The full specs are in `docs/spec/`. Base: chat-spec main 134cad7 (RFC-0001 and RFC-0004 merged; the base-spec text not updated).

## The owner's rule for the issues

Each issue is a **decision record** for the chat-spec maintainers, not a feature request. Each one states, in this order:

1. the problem;
2. what we implemented (wire shape, kind number, rules) and why, against the alternatives we considered;
3. what it costs, in submissions (efficiency rule) and in bytes, with measured numbers where we have them;
4. what it gives the user;
5. how it degrades for a client that does not support it (phones show one "unsupported" bubble per unknown kind; capabilities gate every extension);
6. "## Open decisions": each a yes/no or a choice, including "is this worth its cost at all" where that is honest;
7. the status line with commits;
8. the closing "Decision wanted" line.

## The set

| File | Form | Board mission | Board items to link or close |
|---|---|---|---|
| `01-capabilities.md` | issue | M3 Protocol foundations | Link "runtime · Push — Push notifications for headless bot senders" (related, not closed). |
| `02-typing-and-seen.md` | issue | M3 Protocol foundations | None. Add the issue to the board as a new item. |
| `03-buttons.md` | issue | M2 Bot-native app | Link "clients · UX — Command affordance for bot-declared /commands". |
| `04-transactions.md` | issue | M4 Deeper chain primitives | Close "chat-spec · Protocol — RFC: payment-request content kind" (In review) with a link: a request is a `buttons` message with a transfer intent. Link "chat-spec · Protocol — RFC: payment/delivery receipt kind" (the owner decides whether `transactionReference` closes it). |
| `05-bot-info.md` | issue | M2 Bot-native app | Link "clients · Protocol — Distinguish bots from people in the UI" and "clients · UX — Command affordance for bot-declared /commands". |
| `06-private-groups-v2.md` | issue | M3 Protocol foundations | **Close "chat-spec · Groups — Bots in group chats"** with a link (superseded). |
| `07-bulletin-file-variant.md` | issue | M4 Deeper chain primitives | Link "Resources: long-term storage claims are too granular for file-carrying consumers" (individuality#1222), "individuality · Resources — Keep an unattended bot provisioned with Bulletin storage", "polkadot-chat-agents · Protocol — Bot outbound file upload (hop_submit + bulletin allowance)". |
| `08-bot-directory.md` | issue | M2 Bot-native app | Link "Resources: add first-class, person-sponsored bot consumers" (individuality#1221), "individuality · Usernames — Bot username class: `-bot` suffix + lite-stem tightening", "clients · Protocol — Distinguish bots from people in the UI". |
| `09-deletion-kind-number.md` | **PR commit note** for chat-spec#5 | M3 Protocol foundations | Keep "RFC 0003: message deletion" open; note the renumber to 21 on it. |
| `10-piggybacked-ack.md` | issue | M3 Protocol foundations | None. Add the issue to the board as a new item. |
| `11-statement-quota.md` | issue | M3 Protocol foundations | Link both, close neither: "chat-spec · Limits — Publish normative statement size and allowance floors" and "individuality · Resources — Validate max_count sizing for always-on bots". |
| `12-hop-cipher-envelope.md` | issue | M3 Protocol foundations | Link "RFC 0001: file transfer api improvements" and "RFC 0004: Change P-256+AES to X25519+ChaChaPoly1305" (both Done). |
| `13-markdown-dialect.md` | **board comment** | M3 Protocol foundations | Post as a comment on "chat-spec · Rendering — Pin the markdown dialect for RichTextContent.text"; link it from "clients · Rendering — Render a markdown subset in chat bubbles". |

The 11 issue titles:

1. Capabilities: each device tells its peers what it can decode
2. Typing and seen: a read receipt that rides the next message, and typing off by default
3. Buttons and commands: a message with a keyboard, and a structured press
4. Transactions: tx intents in buttons and a transaction reference message
5. Bot info: a bot describes itself, with an optional balance hint
6. Private groups: one statement per message on a secret epoch topic
7. Attachments: Bulletin transaction storage as a RichText FileVariant
8. Bot directory: signed bot cards on a well-known statement topic
9. Efficiency: the ACK doubles the cost of a conversation; let it ride the next request
10. Statement quota: never-expiring DM statements fill a chat identity's allowance for ever
11. HOP attachments: fold RFC-0001 and RFC-0004 into the base spec text

## Order to post

1. `09` commit on chat-spec#5: a fix to what chat-spec already has in review.
2. `01` capabilities: the other issues refer to it.
3. `12` HOP text: a fix to what chat-spec already merged.
4. `10` ACK and `11` quota: base-protocol cost findings that affect every design after them.
5. `02` typing and seen, `03` buttons, `05` bot info, `04` transactions: small content kinds, in dependency order.
6. `13` markdown comment: text only.
7. `07` attachments and `06` groups: the large designs.
8. `08` bot directory: not built; it may wait for individuality#1221.

## Before posting

- Replace "proposal NN" in each draft with the link to the posted issue.
- Kind numbers marked "provisional" come from `docs/spec/kinds.md`. chat-spec assigns the real ones.
- chat-spec is a private repo. The spec links point to this public repo.
- Items marked **unverified** or **not measured** in a draft stay marked in the issue.
- "Link tap opens with preview" (clients · UX): the earlier plan was to close it once a markdown issue existed. Markdown is now a board comment, not an issue, so the owner decides whether the comment is enough to close it.
