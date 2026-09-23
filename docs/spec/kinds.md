# Provisional content kinds

| Kind | Name | Status | Fallback for old clients | Defined in |
|---|---|---|---|---|
| 21 | `deleted` | upstream RFC-0003 (text says 20, but 20 is `DeviceChatAccepted` in mds.md; RFC Q6 → next free = 21) | none (unsupported bubble; sent only after evidence) | chat-spec |
| 240 | `typing` | implemented (M9) | none; sent freely (development mode) | 0005 |
| 241 | `seen` | implemented (M9) | none; sent freely (development mode) | 0005 |
| 242 | `buttons` | implemented (M8) | the message's own text (menu as text) | 0006 |
| 243 | `buttonPress` | implemented (M8) | n/a | 0006 |
| 244 | `botInfo` | M10 | none; sent freely | 0008 |
| 245 | `transactionReference` | implemented (M11) | none; sent freely | 0007 |
| 246 | `groupInfo` | M12 | none | 0009 |
| 247 | `groupMessage` | M12 | none | 0009 |
| 248 | `groupLeave` | M12 | none | 0009 |
