# Provisional content kinds

| Kind | Name | Status | Fallback for old clients | Defined in |
|---|---|---|---|---|
| 21 | `deleted` | upstream RFC-0003 (text says 20, but 20 is `DeviceChatAccepted` in mds.md; RFC Q6 → next free = 21) | none (unsupported bubble; sent only after evidence) | chat-spec |
| 240 | `typing` | reserved for M8 | never sent without evidence | 0005 |
| 241 | `seen` | reserved for M8 | never sent without evidence | 0005 |
| 242 | `buttons` | reserved for M9 | the message's own text (menu as text) | 0006 |
| 243 | `buttonPress` | reserved for M9 | sent as plain text `/command` when no evidence | 0006 |
