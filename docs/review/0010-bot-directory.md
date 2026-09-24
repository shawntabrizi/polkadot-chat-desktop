# Review: spec 0010 Bot directory draft (c5c95dc, 2ba466d) — accepted (2026-09-24)

Design: each bot signs a bot card (kind 251: username, name, tagline, tags, botInfo version + hash, pricing, capability bits, optional operator claim, issuedAt) and publishes it as one statement on a fixed directory topic and channel (one card per account), expiring after 72 h, refreshed every 24 h. Clients subscribe to the topic, verify each card against the People chain (username owned by the signer; signer has a chat key), and search and rank locally in a Bots tab that replaces the built-in demo manifest. Operators sign the bot's account off-line; "Run by @operator" shows with a verified-person mark when the operator is a `Person`.

Cost: 1 submission and 1 live slot per bot per day; six demo bots add 6 submissions a day (a bot's heartbeat is 720). The efficiency rule's letter ("no submission without a user action") is set aside for directory cards on the reviewer's authority: the card is the bot's presence, refreshed at 1/day, bounded by the bot's own allowance; the owner may overrule.

Findings worth keeping: the identity pallet is gone from the next People runtime (no display/web/image fields); username functions are deprecated in favour of DotNS; the Statement Store has no expiry upper bound, so a full account evicts the card first (the bot re-publishes).

Unresolved for the owner: how many attested lite-person accounts one human can obtain (all spam resistance rests on it).

Build as M17 after the morning decisions; the demo manifest stays until the six fleet bots publish cards.
