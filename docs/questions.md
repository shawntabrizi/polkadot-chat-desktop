# Questions for the owner

Write the question, what you did meanwhile, and the date.

## M0 (2026-09-23)

- **electron-vite beta.** The stable `electron-vite@5.0.0` does not accept vite 8, which the web client's `@vitejs/plugin-react@6.1.1` needs. I pinned `electron-vite@6.0.0-beta.1`. Is a beta acceptable, or do you prefer 5.0.0 with vite 7.3.6 and plugin-react 5.2.0?
- **`timeout` is not installed on this machine.** `docs/milestones/M0.check.sh` (and M1–M4) runs `timeout 180 npm run smoke`. macOS has no `timeout` (and no `gtimeout` here), so the smoke step of the check fails with "command not found" even though `npm run smoke` prints `SMOKE_OK`. I did not change the check scripts. Options: `brew install coreutils` and use `gtimeout`, or a bash fallback in the check scripts.
