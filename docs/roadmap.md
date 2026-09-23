# Roadmap after v1 (2026-09-23)

Goal: an agent-native, Telegram-quality chat client on Polkadot's encrypted rails. Agents are peers, bots feel like services, an agent can run locally or be published as an on-chain identity.

| # | Milestone | Protocol work | Proof |
|---|---|---|---|
| M7 | Delete for everyone; live bot progress as thinking; typing reveal | RFC-0003 (exists) implemented in desktop + pca | e2e delete round trip; bot logs the deletion |
| M8 | Typing and seen | RFC draft: two ephemeral, rate-limited, never-ACKed kinds | typing dots while the pirate bot works; seen ticks |
| M9 | Buttons | RFC draft: `buttons` on a message + `buttonPress`; action kinds `command`, `url`, `callback`, reserved `tx` | press a button in the app, the demo bot reacts |
| M10 | Bot manifest by DotNS name; contract bot MVP | app convention; `tx` action kind used for contract calls | a contract appears as a chat with read and call buttons |
| M11 | Publish the local agent as an on-chain peer | none | a phone user chats with the desktop's agent |

Decisions (owner, 2026-09-23): the running specification lives in this repo under `docs/spec/`, written as upstream-shaped RFCs as we go, and is sent to `paritytech/chat-spec` only when the owner decides; nothing is pushed to chat-spec meanwhile. `pca` work goes on branches in `polkadot-chat-agents` with the goal of merging later; nothing may break the phone apps, so every extension follows the compatibility rule in `docs/spec/README.md` (receive always, send only after evidence). Provisional kinds 240+ (`docs/spec/kinds.md`); RFC-0003 takes 21 (20 is taken by DeviceChatAccepted).
