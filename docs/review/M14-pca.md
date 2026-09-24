# Review M14 pca half — PASS (2026-09-24)

pca fb7d400: Dao contract on devnet Asset Hub `0x073f0e29750b26286befd15619d24ee77e014d87` (block 13635441), `pcddao` group admin, worst-case limits per 0007. Live: four throwaway identities, a v2 group with the bot as admin, treasury funded, proposal #3 pinned, three staked votes with tally replies, execute paid the recipient 0.2 PAS (block 13635779), a stake withdrawn (13635781): `DAO_LIVE_OK`. 666 tests pass, sandbox 143.

Rulings on the agent's questions:
1. Members' H160 addresses on chain next to the group key link one group's accounts publicly. Accepted for devnet v1; the contract note states it; level-2 privacy (per-group posting accounts) would fix it, later.
2. Unmapped recipient: the bot refuses `/propose` to a recipient whose account is not mapped and says why (pca follow-up in M14 fix round).
3. Members registered at each `/propose`: acceptable v1.
4. `BOT_DAO_CONTRACT` in the fleet config when `pcddao` joins the demo fleet (after the desktop half lands).
5. The throwaway identity's heartbeat `noAllowance` is the attestation delay; fine.
