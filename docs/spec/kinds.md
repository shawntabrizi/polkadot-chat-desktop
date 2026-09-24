# Provisional content kinds

| Kind | Name | Status | Fallback for old clients | Defined in |
|---|---|---|---|---|
| 21 | `deleted` | upstream RFC-0003 (text says 20, but 20 is `DeviceChatAccepted` in mds.md; RFC Q6 → next free = 21) | none (unsupported bubble; sent only after evidence) | chat-spec |
| 240 | `typing` | implemented (M9); not sent by default since M12c | none; opt-in only | 0005 |
| 241 | `seen` | implemented (M9); rides with the next message since M12c | none; sent freely (development mode) | 0005 |
| 242 | `buttons` | implemented (M8) | the message's own text (menu as text) | 0006 |
| 243 | `buttonPress` | implemented (M8) | n/a | 0006 |
| 244 | `botInfo` | implemented (M10) | none; sent freely | 0008 |
| 245 | `transactionReference` | implemented (M11) | none; sent freely | 0007 |
| 246 | `groupInfo` | implemented (M12) | none | 0009 |
| 247 | `groupMessage` | implemented (M12) | none | 0009 |
| 248 | `groupLeave` | implemented (M12) | none | 0009 |
| 249 | `groupControl` (welcome, joinRequest, joinDecision, history, keyRequest) | draft (0011, M16) | none | 0011 |

| 250 | `attachment` | implemented (M15a–c); to be retired one release after M20 (read forever, sent only to peers that list 250 and not `FileVariant` 1) | the base spec's unsupported bubble; senders use HOP for baseline peers (0013) | 0012, 0014 |
| 251 | `botCard` | draft (0010, M17) | n/a (directory topic, never in a chat) | 0010 |
| 252 | `capabilities` | draft (0013, M20) | none; a baseline client shows one unsupported bubble per sending device (0013 Drawbacks); never rendered on capable clients | 0013 |

Provisional range extended to 250–254 on 2026-09-24 (240–249 full).

Not a kind: `FileVariant.bulletin = 1` inside base kind 15 `richText` (0014, draft, M20) replaces kind 250. Free provisional kinds after 252: 253, 254.
