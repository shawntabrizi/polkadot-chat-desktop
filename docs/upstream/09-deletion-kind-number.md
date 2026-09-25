# RFC-0003 message deletion: kind 20 clashes with DeviceChatAccepted; renumber to 21

Board mission: M3 Protocol foundations

Status: Prototyped in polkadot-chat-desktop (commit b5cbe5d) and polkadot-chat-agents (branch desktop/rfc-0003).

Note: RFC-0003 is open as paritytech/chat-spec#5 (author: the owner). This may fit better as a change to that pull request than as a new issue.

## Problem

- RFC-0003 (paritytech/chat-spec#5) adds `deleted(DeletedContent) -> 20`. It assumes 19 goes to RFC-0002 `compactedMessages` (chat-spec#4, open).
- `mds.md` already uses index 20 for `DeviceChatAccepted`. The pca codec and `@novasamatech/host-chat` 0.10.2 use it too.
- So kind 20 has two meanings.

## Proposed wire change

- `deleted(DeletedContent) -> 21`. Nothing else changes.
- RFC-0003 Unresolved Question 6 already says: "if merge order differs, the number is whatever is next free at merge time". 21 is the next free index after 19 and 20.
- Test vector (pca, byte for byte in both codecs): envelope id "DEL-1", timestamp 1720000000000, target "MSG-3":

  ```
  58 1444454c2d31 0030fd7790010000 00 15 144d53472d33
  ```

  (`58` is compact(22), the opaque message length in a Request; `15` is kind 21.)

Registry of the provisional kinds: https://github.com/shawntabrizi/polkadot-chat-desktop/blob/main/docs/spec/kinds.md

## What the prototype learned

- **Cost.** 0 extra submissions. A deletion rides in the batch. Deletion before delivery shrinks the batch.
- The desktop's first cut used 20 and told the two kinds apart by length. That was fragile, and it was replaced by 21 to match pca.

## Clients that do not support it

- An unknown kind shows as "unsupported". The prototype sends `deleted` only to devices that listed 21 in capabilities (proposal 01).
- To a baseline phone, nothing is sent. The sender's row says "removed here; the phone keeps it".

## Open questions

1. Take 21 now, or wait until RFC-0002 merges and assign both at once?
2. Should chat-spec keep a kind registry file, so numbers are claimed in one place?

Decision wanted: adopt, adopt with changes, or reject. React 👍/👎 or comment.
