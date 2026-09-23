# polkadot-chat-desktop

A native desktop chat app on Polkadot's encrypted messaging rails. It is an
Electron shell around the `polkadot-chat-web` React client. It talks to Polkadot
app users and bots over the People-chain Statement Store, with no chat server of
its own. See `PLAN.md` for the scope and the milestones.

## Scripts

- `npm run dev` — start the app with the Vite dev server.
- `npm run build` — build main, preload and renderer into `out/`.
- `npm run check` — type check, unit tests, lint.
- `npm run smoke` — build, start the app hidden, print `SMOKE_OK` when the renderer loads.

Reference code: `.refs/` (git-ignored symlinks; see PLAN.md)
