# Bounded authenticated registry experiment

## Protocol amendment and scope

The implementation adopts irrevocable per-period activation. Cancellation changes the live registry's future eligibility, not an activated snapshot. All 16 slots are committed and checked; no keeper supplies a candidate subset. This is a **regtest implementation**, not authorization to deploy or expand the marketplace UI.

`contracts/Registry.cash` uses CashScript 0.14.0 and a real mutable, non-minting CashToken NFT as the state baton. Staking collateral and rewards remain BCH. The original BCH-only provider is unchanged; `TokenRegtestProvider` is an explicit opt-in adapter that preserves token category, amount, capability and commitment from local BCHN RPC. It retains the original small-chain serial-scan limitations.

The constructor fixes the state NFT category, first activation height, block spacing, finite number of periods and reward cap. Bounds ensure every activation threshold stays below 500,000,000, preventing accidental switch to timestamp locktime. There is no administrator update branch.

## Authenticated state and sequence assignment

The NFT commitment is double-SHA256 of a fixed 1,574-byte witness:

| Field | Bytes |
| --- | --- |
| Current period | 4 |
| Phase (0 live, 1 activated) | 1 |
| Append-only registration count | 1 |
| Complete live registry | 16 × 49 |
| Complete activated snapshot | 16 × 49 |

Each record contains owner compressed public key (33 bytes), stake S (4), duration T in blocks (4), requested BCH reward R (4), maximum wins (1), wins (1), cancelled (1), and withdrawn (1). Numeric fields use fixed-width little-endian positive Script-number-compatible encodings within the checked ranges. The zero-based **slot is the registration sequence number**; there is no witness-supplied sequence field to trust. Every slot is assigned exactly once by incrementing the authenticated count; cancelled/exhausted/withdrawn slots are never reused. Capacity is 16 lifetime registrations, not 16 simultaneous offers with unlimited recycling.

A registration must name exactly `slot == count`, initialize all mutable flags/counters to zero, provide valid bounded terms, authenticate the owner's signature over the transaction, and add exactly S of collateral via a separate BCH-only funding input. Funding input value is S plus the 10,000-satoshi registration fee. A complete successor state is derived by the covenant; the caller's proposed output commitment must match. The original owner, terms, maximum wins and sequence cannot be edited. A later user can sign with another key only by making a separate registration into a later slot.

The canonical state UTXO serializes competing registrations. The order is the canonical chain of state spends, not mempool arrival, a website timestamp or real-world submission time. Miners can select which competing registration confirms first, and reorgs can change that order. The lower confirmed canonical sequence wins ties.

## State transitions

- **REGISTER (0):** phase 0, available unused slot, owner-signed, adds collateral. No UTC admission claim is made. Registration is blocked during phase 1.
- **CANCEL (1):** owner-signed, sets only the live cancelled flag, in either phase. Repeated cancellation is rejected. Snapshot bytes remain identical even if the period is activated but unsettled.
- **ACTIVATE (2):** anyone, phase 0, after `firstHeight + period * spacing` via CLTV/finality. Copies the **entire** live registry into the snapshot. No membership list, omission bitmap or claimed winner is accepted from a keeper.
- **SETTLE (3):** anyone, phase 1, verifies selected snapshot slot is eligible and compares it against each of the 16 slots (ignoring only unused/ineligible entries). Pays R immediately to the snapshot owner's P2PKH destination, increments that offer's live wins, advances the period and returns to phase 0.
- **WITHDRAW (4):** owner-signed, only phase 0 and only if cancelled/not previously withdrawn. Pays exactly S and marks withdrawn. No collateral withdrawal is possible while **any** snapshot is activated, even for a non-winning or ineligible offer. This deliberately conservative rule protects all unsettled liabilities.
- **ADVANCE EMPTY (5):** anyone, phase 1, scans all 16 snapshot slots and proves no eligible entry exists, then advances without reward. A nonempty period cannot be skipped.

Eligibility is `!cancelled && !withdrawn && wins < maxWins`. An offer remains eligible across subsequent periods until one of these conditions changes. Arbitrary per-offer eligibility period lists/ranges are not yet implemented. Only **one period can be activated at a time**; the next cannot activate before the previous is settled/empty-advanced. There are no simultaneous unsettled snapshots in this version. Delayed activation/settlement cannot change a snapshot after its creation; transactions updating future cancellation serialize on the same state baton and preserve the snapshot commitment.

The previous snapshot bytes are retained as an audit witness after settlement, but phase 0 forbids settling them again. The next activation copies live state afresh. Both the period counter and phase are authenticated; callers cannot jump the period, reopen an active period, reset counters, or resurrect withdrawals.

## Ranking, maximum wins and reserves

For A versus B, compare `A.S*A.T*B.R` with `B.S*B.T*A.R`. No division or floating-point scores are used. Equality is allowed only when A has a lower/equal canonical slot; an earlier competitor requires strict superiority. S and R are bounded by 10^6; T by 65,535 blocks. Each product is at most 65,535 × 10^12, safely below the signed 64-bit limit. All records enter through range-checked registration from authenticated empty genesis.

Snapshot eligibility includes the frozen win count and maxWins. Settlement cannot select an exhausted offer, increments only the selected live counter, and never resets it. MaxWins is immutable and at most the finite vault period count. Cancellation after activation does not let the winner avoid its already committed win, payout or collateral liability.

Every transition checks successor value is at least the sum of every unwithdrawn S, plus `remainingPeriods * cap`, plus a 1,000-satoshi floor. The exact output-value equation prevents draining excess funds or adding arbitrary outputs. Unused reward cap remains in the pool. Registration adds its own fee externally; other transitions consume 10,000 satoshis from prefunded excess. The fixture deposits 1,000,000 satoshis before registrations, covering four period caps and a generous finite transition budget. A production genesis builder must provision a documented worst-case fee budget, not just reward liabilities. No top-up or creator surplus/refund exit is implemented; residual reserve/fees remain locked in this experiment.

The one state outpoint, exact successor NFT/capability, exact output counts and phase/period advancement prevent duplicate acceptance/payout. A competing valid transaction becomes a mempool conflict after the winner spends the state. Confirmed replay is also rejected. No keeper signature is required for activation, settlement or empty advancement.

## Duration and collateral: conservative implementation

T is denominated in **blocks** in this experiment. A previously winning offer's withdrawal requires `CHECKSEQUENCEVERIFY` of at least T blocks relative to the current registry UTXO. That UTXO is a descendant of the last winning settlement, so withdrawal cannot occur less than T blocks after that settlement's confirmation. Its S remains fully accounted in the pool, including after future cancellation and during subsequent activated snapshots. Maximum wins do not permit multiple reservations of collateral exceeding the actual pooled S; wins are serialized and S remains deposited for the offer's lifetime.

**This is a conservative minimum, not an exact release schedule.** Any intervening registry transition resets the age anchor and can prolong the wait. A full/active period can also postpone withdrawal; other participants could use remaining transitions to extend it. The test proves immature withdrawal rejection and mature withdrawal acceptance after a quiet interval; it does not prove withdrawal at a guaranteed exact ending height. A per-offer authenticated escrow/relative-lock design is needed before production to avoid this shared-state age extension. No UTC-to-block duration equivalence is claimed. If T must mean seconds, that is another specification/implementation change (BCH relative-time locks use 512-second units).

## Height threshold and liveness

`tx.time >= activationHeight` uses height-type CLTV, and actual transaction finality checks the candidate block height. A declared locktime at the threshold is non-final before that height is available; backdating below the threshold fails the script. The test exercises both paths. All settings are bound to the successor's unchanged locking bytecode.

A lower activation height does **not** guarantee exact UTC alignment or activation at that height. There is no latest admission/cancellation timestamp predicate. If nobody activates, the live roster can continue changing; the eventual complete roster at actual activation becomes binding. A delayed height threshold can also already be satisfied for subsequent periods, allowing catch-up. Keepers need state witness availability, transaction fees, and miner inclusion; consensus cannot automate transaction creation or guarantee prompt execution. Fixed UTC period labels remain scheduling metadata outside this prototype; the contract itself schedules height thresholds. See [the deadline investigation](cancellation-deadlines.md). None of the old timestamp-expiry attack conclusions has changed.

## Genesis and trust boundary

The fixture creates a pre-genesis vout-0 UTXO, then a token genesis with exactly one mutable NFT, no minting authority, the empty-state hash and the intended funded registry output. Category introspection uses the reversed byte order relative to RPC/wallet category IDs. The canonical identity is that genesis outpoint and its constrained descendants; an arbitrary lookalike address/output is not the registry.

**Genesis is a protocol validation boundary, not a magically enforced creation factory.** BCH validates token genesis rules but does not force a creator to use this empty initial state, create only one NFT of the category, choose safe immutable settings, or deposit enough extra fees. A client/indexer must verify and pin the canonical empty, unique, funded genesis before accepting its lineage. Tests construct and inspect the intended genesis; there is no deployed factory or generic untrusted-vault admission validator. No backend is trusted to change a valid lineage or choose winners. A malicious alternate genesis must not be presented as an existing vault. Production must formalize and test genesis admission independently.

The state provider and `src/registry.ts` only construct/discover witnesses and outputs. BCHN verifies hashes, signatures, append position, range checks, all state updates, full-roster copying, ranking, counters, reserves, withdrawal conditions, phase and output amounts. TypeScript performs address/key construction and genesis preparation; it does not decide eligibility or authorize winner selection on behalf of the covenant.

## Tests and remaining deployment limits

`tests/registry.test.ts` uses only the existing RPC endpoint `127.0.0.1:18443/wallet/dev`, with regtest/network-disabled assertions. It registers all 16 offers, waits by mining past a height threshold, activates the complete snapshot, cancels an offer after activation, settles, tests next-period eligibility, withdraws mature collateral, and advances authenticated empty periods. Accepted transitions are broadcast and mined; negative transactions are checked through BCHN `testmempoolaccept` with actual script, signature, CLTV, BIP68, conflict or replay results.

Required adversarial coverage includes premature activation (future and backdated locktime), delayed activation, late cancellation, snapshot omission, forged append sequence and authenticated order, earliest equal-score tie, a lower-ranked winner, maximum wins, insufficient signature authority, snapshot modification during cancellation, collateral held during activation, immature/mature and duplicate withdrawal, duplicate settlement, capacity overflow, false empty-period advancement and finite period horizon. Existing integration, deadline attack and three-offer vault tests remain part of `npm test`.

Evidence is recorded in `docs/registry-test-result.json`. Consensus acceptance on this node does **not** establish public-network relay standardness. The state witness plus covenant exceeds the historical 1,650-byte scriptSig policy limit. BCHN 29.2.0 `policy.cpp` raises that limit to 10,000 bytes when May 2026 rules are active, so the historical limit must not be presented as a current automatic rejection. Measured transactions fit this newer size bound; regtest acceptance still does not exercise every public-network relay setting. Explicit standard-policy testing and worst-case execution-budget analysis remain required before deployment. Do not silently loosen node policy and present it as public-network compatibility.

Remaining scope: CashToken **staking** asset enforcement, independent per-offer escrow release, eligibility period lists, admission factory validation, provable UTC scheduling, standard relay compatibility, automated keeper software, fee top-ups/final reserve recovery, client indexer/reorg recovery, and independent audit. No marketplace UI or mainnet deployment is added.

Primary references: [CashScript token introspection and category encoding](https://cashscript.org/docs/design/cashtokens), [CashScript locktime/relative-age variables](https://cashscript.org/docs/language/globals), and [BCHN 29.2 policy source](https://github.com/bitcoin-cash-node/bitcoin-cash-node/tree/v29.2.0/src/policy).

## Enforcement summary

| Rule | Enforcement boundary |
| --- | --- |
| Assigned sequence, immutable terms, owner cancellation authorization | Covenant and BCH signatures |
| Exact live-to-snapshot copy, later snapshot preservation | Covenant hash and state-update equations |
| All 16 slot comparisons, exact score/tie order, max wins | Covenant, no trusted TypeScript winner decision |
| Height minimum for activation | BCH CLTV/finality; no upper deadline or UTC guarantee |
| One settlement, no duplicate payout | Canonical UTXO spend plus phase/period transition |
| Pool reserve and all unwithdrawn collateral conservation | Covenant successor-value lower bound and exact outputs |
| Activated-but-unsettled collateral held | Covenant blocks all withdrawals in phase 1 |
| Winning duration minimum | BCH CSV/BIP68, conservatively extended by other state updates |
| Unique empty canonical genesis and safe initial provisioning | Fixture/client validation; no on-chain creation factory |
| Exact independent escrow maturity and staking-token category | Not implemented; BCH pool and conservative block locks only |
| Prompt invocation, witness discovery, miner inclusion | Keeper/indexer/miner liveness, not autonomous consensus |
| Public relay policy compatibility | Not proven by isolated regtest acceptance |

## Recorded results

On 2026-11-06 the complete `npm test` suite passed compilation, type checking and all **4 integration tests (0 failures)** in about 102 seconds, including the original infrastructure and deadline-counterexample tests. A subsequent registry-only run also passed after adding explicit genesis-admission assertions and a CSV-valid but immature withdrawal rejected by BIP68.

The final registry is 1536 bytes; state witness is 1574 bytes; activation is 3349 bytes; settlement is 3383 bytes. The registry run recorded 42 accepted candidates and 21 adversarial rejections. Accepted canonical transitions were broadcast and their chain was mined; one independent duplicate candidate was checked but intentionally not broadcast until it conflicted. See the JSON for individual consensus error messages and transaction IDs.
