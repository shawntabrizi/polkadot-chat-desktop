# Changelog

## 0.2.1-preview

- Fix: reopening from the Dock no longer crashes after the app was moved while running (for example from the build folder into Applications). The app now says it was moved and quits cleanly; open it again from its new place.
- Deleted chats stay deleted across restarts; the signing strip docks above the composer; expired transaction buttons explain themselves and offer to ask for a new one; buttons that never expire (top-ups); long button labels are shortened instead of dropping the keyboard.
- Demo mode lists six bots (the Faucet is built into the app); the Color bot answers with swatch images, including the dominant colour of a PNG or JPEG you send.

## 0.2.0-preview

The first build for testers. macOS on Apple Silicon, Polkadot devnet only.
Written from the milestone reviews M7 to M19.

### Chat

- Chat with Polkadot app users and bots over the People-chain Statement Store, with no chat server.
- Delete a message for everyone; the chat shows "Message deleted".
- Search chats, contacts, people on the network and message text in one place (⌘K).
- "Working…" and "seen" marks; you choose whether to send typing indicators and read receipts.
- Delete, archive, pin, mute, mark unread, clear, forward, nickname and block, with a list of blocked people in Settings.
- A deleted chat stays deleted after a restart until a new message comes.
- Profiles: several identities on one Mac, each in its own window, with a picker at launch.
- Show your recovery phrase in Settings › Security, and add a profile from a recovery phrase in the picker.

### Money

- The Pocket panel: your PAS balance, your address as a QR code, and "Get test funds" through the embedded Faucet.
- Send PAS in a chat, and request PAS with a Pay button; a request reads "Paid" only after the chain shows the transfer.
- Every signature shows the amount, the fee and a dry-run result first, in a strip above the message field.
- Transactions show "in block" and "finalized", with links to Subscan or Polkadot.js Apps.

### Agents and bots

- Bot buttons: keyboards with callbacks, commands, links and transaction buttons.
- Bots announce their name, description and commands; type `/` to see them.
- An expired transaction button says when it expired and offers to ask the bot for a new one.
- "Meet the demo bots": six devnet bots to try, also in Settings › Demo.
- The Assistant: an AI contact through an LLM proxy, or through Claude Code, Codex or OpenCode installed on this Mac.
- Publish your Assistant as a bot other people can chat with (Settings › Agent).

### Groups

- Private groups: one message is one network submission at any group size.
- Invite links (`polkadot-chat://`), roles and admins, pinned messages, slow mode and approval to join.
- History is shared with a new member and with a member who was away.

### Attachments

- Photos, albums of up to four, files, voice messages and videos, encrypted and stored on the Bulletin chain.
- Ask the sender to send an attachment again after it expires.
- Settings › Storage shows your Bulletin allowance and frees space from received copies.

### Contracts

- Paid replies (Meter bot): the chat header shows your prepaid balance.
- Coin flip (Flip bot): stake, and the contract pays the winner.
- DAO groups: proposals with a live tally, votes, Execute and Withdraw from a pinned card.

### Known limits

- Devnet only. Test funds have no value.
- The build is not signed or notarized: macOS asks before the first open (see README).
- Each identity has an allowance of 50 statements on the network. An identity that has chatted with about 25 people can fail to post in a group ("AccountFull").
- Polkadot.js Apps cannot decode this runtime; use Subscan for transactions.
- The recovery phrase is the only backup. There is no sync between computers.
