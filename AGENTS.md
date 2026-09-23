# Working in polkadot-chat-desktop

You are the implementation agent. Read this file, then `PLAN.md`, then the one
milestone file you were given in `docs/milestones/`. Do only that milestone.

## How to work

1. Read the "Read first" files listed in the milestone. Read them fully. Do not
   guess an API from memory when the file is on disk.
2. Follow the milestone steps in order. Each step names the file to create or
   change. Create exactly those files. Do not add files the milestone does not
   name unless a step says "add tests" or "add what the build needs".
3. After every few steps run `npm run check`. Fix errors before moving on.
4. Run the milestone's acceptance commands yourself. Paste their real output
   into `docs/acceptance.md` under a heading for the milestone. If a command
   cannot run on this machine, write why under "Not run". Never write "passed"
   for something you did not run.
5. Record every choice the milestone left open in `docs/decisions.md` (one
   bullet: what you chose and why). Write questions only the owner can answer
   in `docs/questions.md`, then continue with the rest of the milestone.
6. Commit with `git add -A && git commit -m "M<n>: <milestone name>"`. One
   commit per milestone, plus `M<n>: review fixes` commits when asked.
7. Stop. Do not start the next milestone.

## Rules

- Reference code is in `.refs/` (symlinks, git-ignored). Read it. Never import
  from `.refs/` at runtime. Copy what you need into `src/` and put a header
  comment on the copied file: `// Copied from .refs/<path> on <date>; changes: <list>`.
- Allowed runtime dependencies: `@novasamatech/*`, `polkadot-api`,
  `@polkadot-api/*`, `@polkadot-labs/hdkd-helpers`, `@noble/*`, `@scure/*`,
  `scale-ts`, `rxjs`, `dexie`, `neverthrow`, `markdown-it`, `dompurify`,
  `react`, `react-dom`, `electron`, and for the UI: `tailwindcss`, `@tailwindcss/vite`,
  `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge`, `sonner`,
  and the `@radix-ui/*` packages that `npx shadcn add` installs. Anything else needs a line in
  `docs/decisions.md` with the reason. Never `@polkadot/api` or
  `@polkadot/util-crypto`.
- Pin exact versions in `package.json` (no `^`, no `~`).
- Node-only modules (`electron`, `node:*`) only under `src/main` and
  `src/preload`. The renderer must build for the browser.
- Never log, print, or commit a mnemonic, seed, private key, or API key. Not in
  tests, not in docs, not in `console.log`. Use the `LLM_PROXY_KEY` environment
  variable for the proxy key; never write its value anywhere.
- Chain reads and waits use the best block, never the finalized block.
  Show finality as an indicator; never block on it (PLAN.md "Best block
  first"). With `polkadot-api` that means `getTypedApi(...).query.*.getValue(..., { at: 'best' })`
  and `client.bestBlocks$` / `blocks$`, not `finalizedBlock$`.
- TypeScript strict. Small modules, plain functions, explicit types. No class
  hierarchies. Comments explain why, not what.
- Tests: vitest. Anything that touches the Statement Store uses
  `createInMemoryStatementStore` from `@novasamatech/statement-store`. Dexie in
  tests uses `fake-indexeddb` (already a pattern in `.refs/polkadot-chat-web`).
- Do not change files under `docs/milestones/`. Do not edit `PLAN.md` or this
  file. If a milestone step is wrong, say so in `docs/questions.md` and do the
  closest correct thing.
- If `npm install` refuses a pinned version, read `PLAN.md` "Stack" for the
  reason and the rule.
- Keep `git status` clean at the end: everything either committed or in
  `.gitignore`.

## Checklist before you stop

- [ ] `npm run check` is green.
- [ ] Every acceptance command in the milestone was run; real output is in
      `docs/acceptance.md`.
- [ ] `docs/decisions.md` has a bullet for each open choice you made.
- [ ] Committed as `M<n>: ...`. `git status` is clean.
