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

| 250 | `attachment` | draft (0012, M15) | the base spec's unsupported bubble | 0012 |

Provisional range extended to 250–254 on 2026-09-24 (240–249 full).
