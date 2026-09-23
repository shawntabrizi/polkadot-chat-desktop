# M7b — Unified search in the left pane

## Goal

Typing in the left-pane search field searches three things at once and shows
them as sections, like Telegram Desktop and the phone app: local contacts and
chats first, then the network's username directory, then message text. Picking
a global result starts a request draft. The `+` button stays as a second entry
to the same panel with the field focused.

## Read first

- `src/renderer/ui/Shell.tsx`, `ChatList.tsx`, `Search.tsx` (the current
  New-chat panel and draft room), `domain/identity/search.ts` (username search
  with proof of compute, from M2), `domain/contacts/repository.ts`,
  `domain/chat/messages.ts`, `app/database.ts`.
- `docs/reference/mobile-ux.md` "Starting a chat" (strings: "Type username",
  "Search by username or in messages", sections APPS / CHATS AND CONTACTS /
  MESSAGES / RECENT, "No results for “%s”").
- `.refs/polkadot-design-system/SKILL.md` §7 (rows of paired values, overline
  style for section headers), §10 (row hover, keyboard).

## Steps

1. **One search state.** The left-pane field's text drives a `search` state in
   `Shell.tsx`. Empty: the chat list as today. Non-empty: a results view
   replaces the chat list, with three sections in this order, each with an
   `text-overline text-fg-tertiary` header and rows in the chat-row style:
   a. **Chats and contacts** — local, instant: contacts and rooms whose
      username or display name contains the query (case-insensitive; also the
      Assistant when "assistant" matches). Click opens the room.
   b. **Global search** — after a 400 ms pause and at least 3 letters: the
      identity backend's username search (`domain/identity/search.ts`),
      excluding accounts already in section (a). Row: avatar tone, `name.NN`,
      and a caption "Not a contact yet". Click opens the request draft for
      that account (the existing draft room). Show up to 8 with "Show more"
      to fetch the next page; a small "Searching…" line while pending; a
      quiet "Search unavailable" line on error (never a modal).
   c. **Messages** — local, instant: text and richText rows whose text
      contains the query, newest first, up to 20; row shows the peer name, a
      snippet with the match bolded, and the time. Click opens the room and
      scrolls to that message (add a `scrollToMessageId` param to the room;
      highlight the bubble with `bg-selection-container-active` for 1.5 s).
   Sections with no rows are hidden. If all three are empty: "No results for
   “<q>”" (mobile string) centred.
2. **Keyboard.** ↑/↓ move through result rows across sections, Enter opens
   the highlighted row, Esc clears the search. ⌘K focuses the field (already).
3. **The `+` button** focuses the same field and shows the placeholder
   "Type username" (empty state below it lists recent contacts as a "Recent"
   section, up to 5, from rooms ordered by last message). Remove the separate
   New-chat panel if it becomes redundant; keep the request draft room.
4. **Index for message search.** Add a Dexie compound index or a simple
   in-memory filter over `messages` (measure: with 5 000 rows the query must
   answer under 50 ms; if a filter is too slow, add a `text` index). Record
   the choice.
5. **Specs**: section assembly from fixture data (a contact, a global hit
   that duplicates a contact and must be dropped, a message hit), keyboard
   navigation order, the "No results" case, and a 5 000-row timing test.
6. **Screenshots**: `search.png` in both themes with all three sections
   populated (use the bots and a message containing the query), plus
   `search-empty.png`.
7. **Run**: `npm run check`, `npm run smoke`, `npm run screenshots`.

## Do not

- Do not search message text on the network; messages are local only.
- Do not add a modal or a separate search page.

## Acceptance

```sh
npm run check
npm run smoke
npm run screenshots      # search.png, search-empty.png in both themes
git status --short
```

## Commit

`M7b: unified search (contacts, global, messages)`
