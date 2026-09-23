# Review M7b — PASS (2026-09-23)

`docs/milestones/M7b.check.sh` → `CHECK PASS: M7b`. Screenshot reviewed: three sections (Chats and contacts / Global search / Messages) with overline headers, bolded match in the message snippet, "Not a contact yet" caption. 5 000-row message search at 10 ms. Headless automation (`PCD_HEADLESS=1`) works via `capturePage` on a hidden window; scripts default to it.

Answers to docs/questions.md:
- Reply rows: search them too (their text is user text). Next fix round.
- Picking a result keeps the results (Telegram style): keep.
- Backend rate limit: unknown; the 15 s cap with "Search unavailable" is the right guard.

No fix round now. Carry: search reply rows; try `--visible` once by hand.
