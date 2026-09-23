# Questions for the owner

Write the question, what you did meanwhile, and the date.

## M0 (2026-09-23)

- **electron-vite beta.** The stable `electron-vite@5.0.0` does not accept vite 8, which the web client's `@vitejs/plugin-react@6.1.1` needs. I pinned `electron-vite@6.0.0-beta.1`. Is a beta acceptable, or do you prefer 5.0.0 with vite 7.3.6 and plugin-react 5.2.0?
- **`timeout` is not installed on this machine.** `docs/milestones/M0.check.sh` (and M1–M4) runs `timeout 180 npm run smoke`. macOS has no `timeout` (and no `gtimeout` here), so the smoke step of the check fails with "command not found" even though `npm run smoke` prints `SMOKE_OK`. I did not change the check scripts. Options: `brew install coreutils` and use `gtimeout`, or a bash fallback in the check scripts.

## M1 (2026-09-23)

- **Digits in test usernames.** The backend (and `normalizeUsername`) takes letters only, but the acceptance command uses `pcdtest<4 digits>` and `M1.check.sh` uses `pcdrev$RANDOM`. The script spells the digits as letters (`pcdtest9080` → `pcdtestjaia`) and says so in a `note:` line. Would you rather have the check names be letters only (for example a random letter suffix)?
- **Logout for an owned identity.** Settings still has "Log out" from the paired web client. With the identity owned by this machine, logout now clears the local chat rows and the app re-seeds them at once, so it does nothing visible. Should logout go away, or become "delete this identity from this computer" (which loses the name, as there is no backup in v1)?
- **Settings labels.** Settings still says "Paired", "Phone device" and "Paired at". For a self-owned identity the phone rows show this device's own keys. I did not change Settings in M1 (not in the step list). Change it in a later milestone?
