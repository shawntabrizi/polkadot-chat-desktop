# RFC-0003 commit note: renumber `deleted` from 20 to 21

Not an issue. This is a commit for the open pull request paritytech/chat-spec#5 (RFC-0003, branch `rfc/message-deletion`, file `rfcs/0003-message-deletion.md` at 7af4fab). The coordinator applies the three edits below on the PR branch.

Board item: "RFC 0003: message deletion" (M3 Protocol foundations). Keep it open; add a note that the kind number moved to 21.

## Why

- RFC-0003 claims `deleted(DeletedContent) -> 20` and assumes 19 goes to RFC-0002 `compactedMessages` (chat-spec#4, open).
- `mds.md` on main already uses index 20 for `DeviceChatAccepted` (mds.md line ~273). The pca codec and `@novasamatech/host-chat` 0.10.2 use it too.
- So kind 20 has two meanings. 21 is the next free index after 19 and 20. The RFC's own Unresolved question 6 allows this ("the number is whatever is next free at merge time").
- The desktop and pca already send 21. The desktop's first build used 20 and told the two kinds apart by length. That was fragile, and we replaced it.

## Edit 1: the kind assignment (Explanation, "The `deleted` content type", line 34)

Replace:

```
    deleted(DeletedContent) -> 20   // 19 is claimed by RFC-0002 compactedMessages
```

With:

```
    deleted(DeletedContent) -> 21   // 19 is claimed by RFC-0002 compactedMessages; 20 is DeviceChatAccepted (mds.md)
```

## Edit 2: Unresolved question 6 (line 106)

Replace:

```
6. **Discriminant allocation.** This RFC assumes `19` is taken by [RFC-0002](0002-message-compaction.md) and claims `20`; if merge order differs, the number is whatever is next free at merge time.
```

With:

```
6. **Discriminant allocation.** This RFC assumes `19` is taken by [RFC-0002](0002-message-compaction.md) and claims `21`, because `20` is already `DeviceChatAccepted` in [mds.md](../mds.md). If merge order differs, the number is whatever is next free at merge time.
```

## Edit 3: a changelog line

The RFC file has no changelog section. Add this section at the end of the file, after "Future Directions and Related Material":

```
## Changelog

- 2026-09-24: `deleted` renumbered from 20 to 21; 20 is `DeviceChatAccepted` in mds.md. Test vector: envelope id "DEL-1", timestamp 1720000000000, target "MSG-3" encodes as `58 1444454c2d31 0030fd7790010000 00 15 144d53472d33` (`58` is compact(22), the opaque message length in a Request; `15` is kind 21).
```

## Commit message

```
RFC 0003: renumber deleted to 21 (20 is DeviceChatAccepted in mds.md)
```

## Evidence

- Test vector above: byte for byte in the desktop codec and the pca codec.
- Cost is unchanged: 0 extra submissions (a deletion rides in the batch; deletion before delivery shrinks the batch).
- A device that did not list 21 in capabilities (proposal 01) is not sent `deleted`. The sender's row then says "removed here; the phone keeps it".

Status: Built with 21. polkadot-chat-desktop 6a5a8a1 (M7), gating 82f5d69. polkadot-chat-agents branch `desktop/rfc-0003` b8b9fc4.
