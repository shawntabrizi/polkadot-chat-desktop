# RFC: Fan-out Groups (v1)

|                 |                                                                                  |
| --------------- | -------------------------------------------------------------------------------- |
| **Start Date**  | 2026-09-23                                                                        |
| **Description** | Small group rooms built on the existing pairwise sessions: a roster, a header, sender fan-out |
| **Authors**     | Shawn Tabrizi (with the desktop client team)                                      |
| **Status**      | Draft in `polkadot-chat-desktop/docs/spec`; implemented in M12                    |
| **Provisional kinds** | `groupInfo` = 246, `groupMessage` = 247, `groupLeave` = 248             |

## Summary

The protocol has no groups; t3ams builds them with MLS on the same store. This RFC adds a v1 that needs no new cryptography: a group is an id, a name, and a roster; every member already has (or can open) a pairwise session with every other member; a member sends a group message by fanning it out over those sessions with a header naming the group; clients fold the copies into one room. Membership changes are messages too. Cost is one statement per recipient per message, acceptable for rooms of up to 16. An MLS transport can replace the fan-out later without changing the room model.

## Explanation

```
MessageContent = {
    ...
    groupInfo(GroupInfo)       -> 246   // roster and metadata; sent to every member on create/change, and to a newcomer
    groupMessage(GroupMessage) -> 247   // a wrapped message for the group
    groupLeave(GroupLeave)     -> 248   // "I left"
}
GroupInfo = {
    groupId: UUID
    name: String                // <= 60
    admin: AccountId            // the creator; only the admin sends roster changes in v1
    members: [Member]           // <= 16, includes the admin
    version: u32                // bumped by the admin on every change; higher wins
    createdAt: u64
}
Member = { account: AccountId, username: String, joinedAt: u64 }
GroupMessage = {
    groupId: UUID
    infoVersion: u32            // the roster version the sender fanned out to
    seq: u64                    // per-sender monotonic counter within the group
    content: MessageContent     // any non-group kind: text, richText, reply, reacted, edited, deleted, buttons, buttonPress, transactionReference, botInfo …
}
GroupLeave = { groupId: UUID }
```

### Rules

- **Create.** The admin generates `groupId`, then sends `groupInfo` v1 to each member over the pairwise session (opening a chat request first where none exists; the request opener carries the `groupInfo`). A member who has not accepted the admin's chat cannot be reached; the client shows them as "invited".
- **Send.** A member sends `groupMessage { groupId, infoVersion, seq, content }` to every *other* member in the roster of the version it holds. `messageId` of the envelope is the same on every copy, so a member that receives two copies (through two paths) dedups by it. Receivers reject a `groupMessage` from an account not in their roster for that group.
- **Roster change.** Admin-only in v1: the admin sends a new `groupInfo` (higher `version`) to every member including newcomers; a removed member receives the new `groupInfo` without itself and MUST stop sending to the group. Members apply the highest version they have seen. Non-admin `groupInfo` is ignored.
- **Leave.** Any member sends `groupLeave` to every member; the admin then sends a new `groupInfo`.
- **Ordering.** Per sender, `seq` orders messages; across senders, timestamp with `seq` as tie-break. A gap in `seq` is shown as "some messages may be missing" once.
- **Reply, react, edit, delete, buttons, tx references** inside a group are ordinary contents wrapped in `groupMessage`; the target `messageId`s are group-wide because envelopes share ids.
- **Bots** are members like anyone: the admin invites a bot's username; the bot fans out its replies to the roster. A bot's `botInfo` arrives wrapped too.
- **Typing/seen** in groups: `typing` fans out; `seen` does not (v1: no read receipts in groups).
- **Consistency.** Fan-out is best-effort; a member offline for long gets messages from the sessions when back (the store keeps them until ACK/expiry as today). No history transfer to newcomers in v1.

### Client model

One room per `groupId` with the roster; the composer sends through the fan-out; the header shows the member count and the admin; a members panel lists them with "invited" / "member" / "left".

### Compatibility

Development mode: sent freely; an old client shows unsupported bubbles for each wrapped message.

## Drawbacks

O(n) statements per message; the admin is a single point of control for the roster; no forward secrecy beyond the pairwise sessions; newcomers see no history. MLS (t3ams) fixes the first three; the room model here survives that swap.

## Testing

Three in-memory identities: create, fan-out, dedup of duplicate copies, reject a non-member, roster bump removes a member, leave, per-sender ordering, a bot member replying to all. Live: a three-person room on devnet with one bot.
