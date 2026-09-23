
# Polkadot app chat UI (Android, iOS, Desktop)



All three apps share one chat model: one list sorted by time, a "New requests" entry above it, a chat that starts as a one-message request the other side accepts or declines. Own messages right in an inverted (dark) bubble; the peer's left in a container-colour bubble. Ticks: pending, sent, read/delivered. Eight quick reactions everywhere. Only iOS and Desktop render markdown.

## Chat list

- Header "Chats" + new-message icon + search entry. Rows: 64dp avatar, username, timestamp, mute flag, preview line; badges: heart for an unseen reaction, number for unread.
- Preview strings: "You: %s", "Draft: %s", "%s reacted with %s", "%s sent you %s", "📞 Voice call", plurals for photos/videos/files.
- Empty: "No active chats" / "Start a conversation with someone by typing their username". Desktop: "No chats yet" / "Your chats will appear here".
- Requests: a pill "New requests" with a count, only when pending > 0, opening "Message requests" ("Message requests from people who aren't in your contact list appear here."). Rows tagged "Message request" with "Decline" ("Decline message request?"). Desktop has a setting "Hide message requests by default".
- No pinned rows, no bot directory, no verified badge on any platform. Bot rooms are ordinary rooms.

## Starting a chat

- Search placeholder "Type username" / "Search by username or in messages". Sections APPS, CHATS AND CONTACTS, MESSAGES, RECENT. "No results for “%s”".
- Add-contact sheet: "Add a contact and start a chat with %s" / "After you enter the chat, make sure %s starts one with you as well, or your message may not be seen." / "Add to Contacts". Desktop: "Add a new contact to start chatting?" / "Continue"; draft "Say hello... (optional)" / "Send Request".
- Sender: "Invite %s to chat" / "You can only send one message in this request." → "Request message sent" → "Wait for %s to accept your request message before sending the next message."
- Recipient: a banner replaces the composer: "Accept chat request from %s" / "Add %s to your contacts to accept the chat request. They won't know you've seen their message until you accept." / Decline / Accept. After: "%s approved your request" (Android), "%s accepted the request" (iOS).
- Deep links differ: Android `polkadotapp://chat?chatId=<hex>` opens an existing chat only; iOS `polkadotapp://chat?id=<raw>&force=<bool>` (force required) and opens a request draft for a new person. Desktop has none. Android also scans any SS58 QR.

## The room

- Bubbles: incoming `bg.surface.container` top-start; outgoing `bg.surface.containerInverted` top-end; grouped messages get tighter corners; a tail on the last of a group.
- Delivery: Android PENDING/SENT/READ/FAILED icons ("Pending", "Message sent", "Message read"); iOS pending/sent/delivered; Desktop lucide Clock/Check/CheckCheck. "Delivered" on iOS/Desktop = peer ACK = Android "read".
- Reactions: 👍 ❤️ 😂 😮 😢 🙏 🔥 👏 plus a full picker; chips under the bubble; a "Reactions" details dialog.
- Menu: Reply, Copy, Edit, View edit history; swipe-to-reply on Android. Desktop shows Forward/Select/Delete disabled. No delete message type exists on any platform.
- Reply banner "Reply to %s"; edit labels "Edited" / "(edited)"; "Edit history" (Current / Earlier version).
- Composer: Android attach + "Pay" + "Write a message…" + send; other states replace it (accept request, waiting approval, "%s left the chat", unblock, hidden). Desktop: attachments, emoji picker, "Send"; no Pay button.
- Payments: "%s sent you" / "You sent" with statuses Sending…, Detecting…, Sent pending claim, Claiming…, Claimed, Transaction failed.
- Attachments: image/video with blurhash and progress; Desktop shows "This message can only be viewed in the mobile app" for some media. Calls: "Missed voice call" / "Tap to call back". Separators: dates and "New messages" / "Unread messages". No peer typing indicator; Android animates a "typing" reveal for bot messages only.

## Message content types

Text, RichText (+attachments), Reply, Reacted/ReactionRemoved (aggregated, no bubble), Edited (replaces text), CoinagePayment/coinageSend (payment bubble), call offer/answer/ICE/closed (one call bubble, others hidden), ChatRequest / ChatAccepted / DeviceChatAccepted (system rows), ContactAdded / LeftChat (system rows), DeviceAdded / token / compaction commit (hidden sync carriers), compaction unavailable ("Some messages could not be retrieved…"), Custom (255; product/bot renderer), Unsupported ("Unsupported message content. Please update the app."). Android mapper: `ChatMessageUiMapper.kt`; iOS: `ChatViewModelFactory.swift`; Desktop: `session/types.ts` → `MessageFlow.tsx`.

## Bots

- Android built-in bots in `BotsConstants.kt`: Sample, Polkadot Peer, Polkadot Prizes (weekly game), Unique Peer Tattoo (DIM1), Mob Rule; gated by `PEER_BOT_BY_DEFAULT` / `DIM1_BOT_BY_DEFAULT` / `SAMPLE_BOT` (true in debug, false in nightly/release). They subclass `ChatBot`: own footer, menu, appearance, renderers, typing reveal. Sample bot: "Hello, want to chat? I'll echo your messages with a custom style!".
- iOS: `ChatExtensionsRegistry` (reaction, coinage, DIM1, DIM2, Peer, ProofOfInk, WeeklyGame, MobRule, Sample) and `ProductBotProvider` (installed Products as bots with a worker).
- Desktop: bots are product-owned rooms (`MessagePeer.type === 'product'`), drawn by the product's `RendererTree`; entry "Proceed in Chat".
- Markdown: Android none (plain text + links); iOS inline only (Apple parser); Desktop full `markdown-it` + DOMPurify with GFM tables, ==mark==, ||spoiler||, math, task lists, details, code with Copy, and `/commands` as tappable buttons, built "for what an AI agent writes unprompted", safe to re-render while streaming (`src/shared/markdown/`).

## Desktop specifics

Electron 44, React 19, TanStack Router, react-rx, `@novasamatech/tr-ui` 0.3.1 (Button, Dialog, DropdownMenu, Popover, Tooltip, Switch, Avatar, toasts), Tailwind 4 tokens (`bg-bg-surface-*`, `text-fg-*`), lucide icons, react-intl (`feature.chat.*`). Surfaces: dashboard "Last chats" widget, fullscreen `/chat/$chatId`, "Quick Chat" popover, `/settings/chats`, "Messages may be out of sync / Open the mobile app to sync messages" banner. It is a secondary device: media and calls defer to the phone.

## Takeaways for 

1. Copy the strings and the request flow above; users know them.
2. Bubble colours come from the design tokens `bg.surface.container` / `containerInverted`; fetch the values from the design report.
3. Use Desktop's markdown renderer rules (`/commands` as buttons is exactly the hook for ).
4. Implement the Android "typing reveal" for assistant replies; there is no real typing indicator to mimic.
5. Deep link: adopt the iOS form `polkadotapp://chat?id=…&force=…`; it is the one that opens a new request.
