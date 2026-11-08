> Historical single-stake UTC implementation. Current independent allocations are specified in [registry.md](registry.md). Existing instances retain their original bytecode; new tests instantiate `LegacyRegistry` to keep the old safety and counterexample coverage.

# Bounded authenticated registry experiment

## Protocol amendment and scope

The implementation uses fixed UTC reward periods and maturity boundaries, with irrevocable on-chain activation snapshots for eligibility. This supersedes the earlier height/CSV registry experiment. Cancellation changes the live registry's future eligibility, not an activated snapshot. All 16 slots are committed and checked; no keeper supplies a candidate subset. This is a **regtest implementation**, not authorization to deploy or expand the marketplace UI.

`contracts/LegacyRegistry.cash` uses CashScript 0.14.0 and a real mutable, non-minting CashToken NFT as the state baton. Staking collateral and rewards remain BCH. The original BCH-only provider is unchanged; `TokenRegtestProvider` is an explicit opt-in adapter that preserves token category, amount, capability and commitment from local BCHN RPC. It retains the original small-chain serial-scan limitations.

The constructor fixes the state NFT category, UTC epoch E, period length L in seconds, finite number of periods and reward cap. Bounds require E ≥ 500,000,000, L > 0 and E + (2N − 1)L ≤ 2,147,483,647, keeping every activation/maturity timestamp within positive four-byte Script-number encoding. There is no administrator update branch. The UTC contract and 53-byte record layout require a new validated genesis; existing height/CSV instances keep their original immutable rules.

## Authenticated state and sequence assignment

The NFT commitment is double-SHA256 of a fixed 1,702-byte witness:

| Field | Bytes |
| --- | --- |
| Current period | 4 |
| Phase (0 live, 1 activated) | 1 |
| Append-only registration count | 1 |
| Complete live registry | 16 × 53 |
| Complete activated snapshot | 16 × 53 |

Each record contains owner compressed public key (33 bytes), stake S (4), duration T in whole UTC periods (4), requested BCH reward R (4), maximum wins (1), wins (1), cancelled (1), withdrawn (1), and latest winning maturity timestamp (4). Numeric fields use fixed-width little-endian positive Script-number-compatible encodings within the checked ranges. The zero-based **slot is the registration sequence number**; there is no witness-supplied sequence field to trust. Every slot is assigned exactly once by incrementing the authenticated count; cancelled/exhausted/withdrawn slots are never reused. Capacity is 16 lifetime registrations, not 16 simultaneous offers with unlimited recycling.

A registration must name exactly `slot == count`, initialize all mutable flags/counters to zero, provide valid bounded terms, authenticate the owner's signature over the transaction, and add exactly S of collateral via a separate BCH-only funding input. Funding input value is S plus the 10,000-satoshi registration fee. A complete successor state is derived by the covenant; the caller's proposed output commitment must match. The original owner, terms, maximum wins and sequence cannot be edited. A later user can sign with another key only by making a separate registration into a later slot.

The canonical state UTXO serializes competing registrations. The order is the canonical chain of state spends, not mempool arrival, a website timestamp or real-world submission time. Miners can select which competing registration confirms first, and reorgs can change that order. The lower confirmed canonical sequence wins ties.

## State transitions

- **REGISTER (0):** phase 0, available unused slot, owner-signed, adds collateral. No UTC admission claim is made. Registration is blocked during phase 1.
- **CANCEL (1):** owner-signed, sets only the live cancelled flag, in either phase. Repeated cancellation is rejected. Snapshot bytes remain identical even if the period is activated but unsettled.
- **ACTIVATE (2):** anyone, phase 0, after `E + period * L` via CLTV/finality. Copies the **entire** live registry into the snapshot. No membership list, omission bitmap or claimed winner is accepted from a keeper.
- **SETTLE (3):** anyone, phase 1, verifies selected snapshot slot is eligible and compares it against each of the 16 slots (ignoring only unused/ineligible entries). Pays R immediately to the snapshot owner's P2PKH destination, increments that offer's live wins, sets maturity to `max(previous maturity, E + (period + T) * L)`, advances the period and returns to phase 0.
- **WITHDRAW (4):** owner-signed, only phase 0 and only if cancelled/not previously withdrawn. Pays exactly S and marks withdrawn. No collateral withdrawal is possible while **any** snapshot is activated, even for a non-winning or ineligible offer. This deliberately conservative rule protects all unsettled liabilities.
- **ADVANCE EMPTY (5):** anyone, phase 1, scans all 16 snapshot slots and proves no eligible entry exists, then advances without reward. A nonempty period cannot be skipped.

Eligibility is `!cancelled && !withdrawn && wins < maxWins`. An offer remains eligible across subsequent periods until one of these conditions changes. Arbitrary per-offer eligibility period lists/ranges are not yet implemented. Only **one period can be activated at a time**; the next cannot activate before the previous is settled/empty-advanced. There are no simultaneous unsettled snapshots in this version. Delayed activation/settlement cannot change a snapshot after its creation; transactions updating future cancellation serialize on the same state baton and preserve the snapshot commitment.

The previous snapshot bytes are retained as an audit witness after settlement, but phase 0 forbids settling them again. The next activation copies live state afresh. Both the period counter and phase are authenticated; callers cannot jump the period, reopen an active period, reset counters, or resurrect withdrawals.

## Ranking, maximum wins and reserves

For A versus B, compare `A.S*A.T*B.R` with `B.S*B.T*A.R`. No division or floating-point scores are used. Equality is allowed only when A has a lower/equal canonical slot; an earlier competitor requires strict superiority. S and R are bounded by 10^6; T by N (at most 16 periods). Each product is at most 16 × 10^12, safely below the signed 64-bit limit. All records enter through range-checked registration from authenticated empty genesis.

Snapshot eligibility includes the frozen win count and maxWins. Settlement cannot select an exhausted offer, increments only the selected live counter, and never resets it. MaxWins is immutable and at most the finite vault period count. Cancellation after activation does not let the winner avoid its already committed win, payout or collateral liability.

Every transition checks successor value is at least the sum of every unwithdrawn S, plus `remainingPeriods * cap`, plus a 1,000-satoshi floor. The exact output-value equation prevents draining excess funds or adding arbitrary outputs. Unused reward cap remains in the pool. Registration adds its own fee externally; other transitions consume 10,000 satoshis from prefunded excess. The fixture deposits 1,000,000 satoshis before registrations, covering four period caps and a generous finite transition budget. A production genesis builder must provision a documented worst-case fee budget, not just reward liabilities. No top-up or creator surplus/refund exit is implemented; residual reserve/fees remain locked in this experiment.

The one state outpoint, exact successor NFT/capability, exact output counts and phase/period advancement prevent duplicate acceptance/payout. A competing valid transaction becomes a mempool conflict after the winner spends the state. Confirmed replay is also rejected. No keeper signature is required for activation, settlement or empty advancement.

## Fixed UTC reward periods and staking maturity

Define `B(p) = E + p * L`. Reward period p is the half-open UTC interval `[B(p), B(p+1))`, for p from 0 to N−1. Neither activation nor settlement changes these boundaries. A period pays its one selected reward R at actual settlement, even when processed late; it is attributed to p, not the current wall-clock interval. Processing remains strictly sequential, including empty periods, and does not skip missed rewards or invent additional periods.

T means a positive whole number of periods, bounded by N. A win for period p commits collateral until `B(p + T)`. The covenant derives this timestamp and authenticates it in the offer's live record. **This is one pooled S per registered offer, not a separate allocation per win.** Repeated wins retain the maximum maturity across wins; cancellation, unrelated registrations, activations and other settlements cannot shorten or shift it. Withdrawal of previously winning collateral requires timestamp CLTV at that recorded boundary. Never-winning cancelled collateral has no maturity timelock. All withdrawals still require phase 0, owner authorization and cancellation; the conservative activated-snapshot hold can postpone actual withdrawal beyond maturity.

**Late processing does not add a fresh T-period lock.** If a period is activated/settled after its maturity boundary, its reward still pays and its winning collateral may already be time-mature. This follows the chosen fixed UTC economics; it is not a promise of T elapsed periods after actual acceptance. Pooled collateral remains deposited during the delay. There is no shared-state relative-age reset anymore. The latest maturity can extend beyond the finite reward horizon, and withdrawal remains available after the final reward period.

## Activation eligibility and chain-time liveness

Activation requires timestamp CLTV at `B(p)`. BCH finality uses parent median-time-past (MTP), and the declared locktime must be strictly below that cutoff. This prevents activation before the chain-time lower bound; it does not guarantee confirmation at an exact wall-clock instant. Scripts cannot read current UTC or enforce a transaction expiry using an old declared locktime.

The **actual canonical on-chain activation transition** defines offer eligibility. It copies every live slot, including cancellations and wins, into the authenticated snapshot. A registration or cancellation confirmed in the baton lineage before activation affects that snapshot, even if it occurs after the nominal UTC boundary. Registration is blocked during phase 1. Cancellation after activation changes live state for later snapshots only; it cannot undo an activated win or its collateral liability. Miner ordering and reorgs determine the canonical lineage; a website clock does not adjudicate eligibility.

For example, with midnight UTC daily periods, a two-period win for Monday matures Wednesday at 00:00 UTC. If Monday's snapshot activates Tuesday at 03:00 UTC, the snapshot's roster binds Monday's reward, while maturity stays Wednesday at 00:00 UTC. A cancellation before that delayed activation excludes the offer; one after activation leaves Monday's snapshot intact.

If activation is delayed past multiple UTC boundaries, later lower bounds may already be satisfied, allowing sequential catch-up. Each later activation freezes its own then-live roster. Keepers need witnesses, fees and miner inclusion; consensus cannot schedule transactions or guarantee prompt settlement. This explicitly replaces the earlier document's recommendation against post-UTC pre-activation eligibility changes. The unsafe upper-deadline counterexample remains valid; see [the deadline investigation](cancellation-deadlines.md).

## Genesis and trust boundary

The fixture creates a pre-genesis vout-0 UTXO, then a token genesis with exactly one mutable NFT, no minting authority, the empty-state hash and the intended funded registry output. Category introspection uses the reversed byte order relative to RPC/wallet category IDs. The canonical identity is that genesis outpoint and its constrained descendants; an arbitrary lookalike address/output is not the registry.

**Genesis is a protocol validation boundary, not a magically enforced creation factory.** BCH validates token genesis rules but does not force a creator to use this empty initial state, create only one NFT of the category, choose safe immutable settings, or deposit enough extra fees. A client/indexer must verify and pin the canonical empty, unique, funded genesis before accepting its lineage. Tests construct and inspect the intended genesis; there is no deployed factory or generic untrusted-vault admission validator. No backend is trusted to change a valid lineage or choose winners. A malicious alternate genesis must not be presented as an existing vault. Production must formalize and test genesis admission independently.

The state provider and `src/legacy-registry.ts` only construct/discover witnesses and outputs. BCHN verifies hashes, signatures, append position, range checks, all state updates, full-roster copying, ranking, counters, reserves, withdrawal conditions, phase and output amounts. TypeScript performs address/key construction and genesis preparation; it does not decide eligibility or authorize winner selection on behalf of the covenant.

## Tests and remaining deployment limits

`tests/registry.test.ts` uses only the existing RPC endpoint `127.0.0.1:18443/wallet/dev`, with regtest/network-disabled assertions. It registers all 16 offers, waits on the normal clock and mines until MTP crosses UTC boundaries, activates the complete snapshot, cancels an offer after activation, settles, tests next-period eligibility, withdraws mature collateral, and advances authenticated empty periods. Accepted transitions are broadcast and mined; negative transactions are checked through BCHN `testmempoolaccept` with actual script, signature, timestamp CLTV, conflict or replay results.

Required adversarial coverage includes premature activation (future and backdated locktime), delayed UTC activation, post-UTC pre-activation registration/cancellation, post-activation cancellation, snapshot omission, forged append sequence and authenticated order, earliest equal-score tie, a lower-ranked winner, maximum wins, insufficient signature authority, snapshot modification during cancellation, collateral held during activation, forged/shifted maturity, repeated-win maturity extension, immature/mature and duplicate withdrawal, duplicate settlement, capacity overflow, false empty-period advancement and finite period horizon. Existing integration, deadline attack and three-offer vault tests remain part of `npm test`.

Evidence is recorded in `docs/registry-test-result.json`. Consensus acceptance on this node does **not** establish public-network relay standardness. The state witness plus covenant exceeds the historical 1,650-byte scriptSig policy limit. BCHN 29.2.0 `policy.cpp` raises that limit to 10,000 bytes when May 2026 rules are active, so the historical limit must not be presented as a current automatic rejection. Measured transactions fit this newer size bound; regtest acceptance still does not exercise every public-network relay setting. Explicit standard-policy testing and worst-case execution-budget analysis remain required before deployment. Do not silently loosen node policy and present it as public-network compatibility.

Remaining scope: CashToken **staking** asset enforcement, independent per-offer escrow release, eligibility period lists, admission factory validation, prompt chain-time invocation, standard relay compatibility, automated keeper software, fee top-ups/final reserve recovery, client indexer/reorg recovery, and independent audit. No marketplace UI or mainnet deployment is added.

Primary references: [CashScript token introspection and category encoding](https://cashscript.org/docs/design/cashtokens), [CashScript locktime/relative-age variables](https://cashscript.org/docs/language/globals), and [BCHN 29.2 policy source](https://github.com/bitcoin-cash-node/bitcoin-cash-node/tree/v29.2.0/src/policy).

## Enforcement summary

| Rule | Enforcement boundary |
| --- | --- |
| Assigned sequence, immutable terms, owner cancellation authorization | Covenant and BCH signatures |
| Exact live-to-snapshot copy, later snapshot preservation | Covenant hash and state-update equations |
| All 16 slot comparisons, exact score/tie order, max wins | Covenant, no trusted TypeScript winner decision |
| Fixed UTC activation lower bounds | Timestamp CLTV/MTP finality; no upper deadline or exact wall-clock inclusion |
| One settlement, no duplicate payout | Canonical UTXO spend plus phase/period transition |
| Pool reserve and all unwithdrawn collateral conservation | Covenant successor-value lower bound and exact outputs |
| Activated-but-unsettled collateral held | Covenant blocks all withdrawals in phase 1 |
| Fixed winning maturity | Authenticated `max(previous, B(p+T))`, enforced by timestamp CLTV; no post-settlement minimum |
| Unique empty canonical genesis and safe initial provisioning | Fixture/client validation; no on-chain creation factory |
| Independent escrow release and staking-token category | Not implemented; BCH pool with UTC maturity and active-phase withdrawal hold |
| Prompt invocation, witness discovery, miner inclusion | Keeper/indexer/miner liveness, not autonomous consensus |
| Public relay policy compatibility | Not proven by isolated regtest acceptance |

## Verification review (2026-11-08)

This review verifies the accepted UTC/snapshot covenant without introducing new contract features or changing the 53-byte record format. `tests/registry-verification.test.ts` adds fresh instances on the existing chain, uses historical immutable UTC boundaries to exercise late processing without clock changes, and records transaction IDs, acceptance/rejection messages, balances and the preserved chain checkpoint in `docs/registry-verification-result.json`. The existing 16-offer test supplies capacity, sequence, tie, future-maturity and live-clock coverage.

| Requested property | Verification result and enforcement boundary |
| --- | --- |
| Settlement after scheduled maturity | Covenant derives the original `B(p+T)` even when parent MTP is already later; forged extension rejected. Settlement and owner withdrawal can spend dependent unconfirmed successors and confirm in the same block, with no new duration or confirmation-age wait. Requires cancellation, phase 0, enough fees and miner inclusion. |
| Snapshot cannot change, reopen or be replaced | Authenticated state hash, exact successor derivation and phase checks reject altered cancellation snapshots, substituted witnesses, reopening phase 0, reactivation, and reopening a settled old period. Next-period activation intentionally replaces the previous audit snapshot with a new complete live roster. |
| Cancellation preserves unsettled collateral | Consensus rejects refund outputs and withdrawal-flag changes on CANCEL; WITHDRAW is blocked throughout phase 1, even for a cancelled, already-mature winner. Live cancellation cannot prove an activated snapshot empty. |
| A period settles at most once | Consensus requires phase 1, advances the cursor exactly once, and consumes the canonical UTXO. Duplicate settlement against an unspent successor is script-rejected; competing transactions conflict and mined replay fails as spent/already confirmed. An empty period advances without a reward. |
| Repeated wins with independent allocations | **Unmet requirement.** Three valid wins pay three rewards after one S deposit. Each settlement has only state and reward outputs; it overwrites one latest-maturity field and never creates an independent escrow/allocation. Only one S can be withdrawn. The counterexample test passes by asserting this observed limitation; it does not certify the requested per-win allocation property. |
| Reserve under delays / out-of-order requests | Exact balances, every reward, 10,000-satoshi transition fees, collateral refunds and remaining cap liability reconcile during delayed sequential settlement. Cursor jumps, cursor rollback, duplicate settlement and a one-satoshi reserve drain are rejected. **Out-of-order settlement is unsupported and forbidden**, not a tested alternative execution order. |
| Complete eligible roster and correct maximum | Activation copies every authenticated live slot, including ineligible entries and their flags. Omission of a strictly higher-ranked offer fails; the complete snapshot rejects the lower-ranked winner. The existing test also scans all 16 slots and rejects omission of the last slot. Keeper-supplied membership lists are never trusted. |
| Sequence and earliest-submission ties | **Implemented and consensus-enforced for canonical registration order.** REGISTER requires slot == authenticated count and increments it once; immutable slot order breaks exact-score ties. Forged sequence/reordered state and later equal-score selection fail in BCHN. This does not enforce earliest wall-clock or mempool submission; miners and reorgs determine canonical state-spend order. |

### Remaining vulnerabilities and limitations

- **Per-win collateral allocation is absent.** Treating the current contract as independently reserving S for each overlapping win would overstate its collateral. The reserve bound sums one S per unwithdrawn offer, not S times unsettled/maturing wins. A later win also postpones withdrawal of the entire S until the latest maturity; an earlier portion cannot release independently. Separate offers by the same owner can deposit separate stakes, but that is not a separate allocation created by each win of one offer. Implementing that requirement needs a separately reviewed state/escrow design and potentially a new genesis.
- **Fee exhaustion can strand an activated instance.** A dedicated fixture deposits 17,000 satoshis plus 6,000 collateral: 6,000 total reward caps, a 1,000 floor and one 10,000 activation fee. After activation its 13,000 balance still covers collateral, all reward caps and the floor, but settlement would violate the remaining reserve after paying its fee. BCHN correctly rejects it. There is no general top-up/recovery branch. Initial admission must budget all transitions, not only rewards.
- **Withdrawal liveness is weaker than time maturity.** Any activated period blocks all withdrawals until settlement/empty advancement. A missing witness, unaffordable fee, missing caller or miner censorship can delay withdrawal indefinitely. Sequential catch-up and competing permissionless activations can postpone release; maturity alone is not a guaranteed withdrawal time.
- **Canonical genesis remains a client validation boundary.** The fixture verifies its intended empty state and token output; no general on-chain admission factory guarantees safe settings, uniqueness or provisioning for arbitrary lookalike instances. All lineage guarantees assume a validated canonical genesis and available state witnesses.
- **Timing and fairness have explicit limits.** Fixed UTC arithmetic is enforced through timestamp locktime lower bounds and parent MTP, not a wall clock. No UTC admission/cancellation upper deadline, exact execution time, earliest real-world submission, censorship resistance or reorg immunity is established. See [CashScript locktime semantics](https://cashscript.org/docs/language/globals) and [BIP113](https://bips.dev/113/).
- **Production compatibility remains unverified.** Staking collateral is BCH, not enforced fungible CashTokens. Standard public relay policy, worst-case execution budgets, independent audit, witness/indexer recovery, eligibility ranges, reserve recovery and keeper operation remain outstanding. This verification is not a deployment approval.

### Keeper assumptions versus consensus

Keepers have no authority to choose a lower-ranked winner, omit an offer, mutate the activated roster, bypass maturity, withdraw collateral during phase 1, change a period number or redirect a reward. Those rules are checked by BCHN on each canonical spend. Keepers/indexers must nevertheless make authenticated witnesses available, construct transactions and supply the operational fee budget; miners must include them. Consensus safety does not create a transaction at a UTC boundary, guarantee progress, or repair an underfunded instance. The same-block late withdrawal demonstrates absence of a mandatory extra wait in the tested state, not guaranteed prompt inclusion for every state.

### Exact run results

The new audit case passed in 13,889.8217 ms on BCHN 29.2.0: **17 accepted transactions and 29 expected adversarial rejections**. Its fresh instances extended the chain from height 648 to 656; `getblockhash(648)` still matched the original checkpoint. No data reset, rollback, clock override, policy change or production deployment was performed. The contract source and state format were unchanged during this verification; each fixture has a new token genesis.

Late settlement retained scheduled maturity `1794165700`, with containing-block parent MTP `1794175683`. Settlement `1259ad8cb175287933ba7447fdcc50638e5a5c23c90aa9a87659c79cdc385109` and withdrawal `a0ae24c059b780a350ce2c24c55104a600bdca6cdea942a6d9b97a7179b3d14d` confirmed in the same block `461dbc9cfcdb1b41e41054acd5d8f3850e1c15572452b3b78a7e3bcfcf13f9d0`. The withdrawal spent the unconfirmed settlement successor before that block was mined.

The independent-allocation counterexample paid three 1,000-satoshi rewards for periods 0, 1 and 2 after one 6,000-satoshi deposit, recording maturities `1794165700`, `1794165710` and `1794165720` in the same field. Only 6,000 collateral was ever counted; one final 6,000 refund was possible. Final value reconciled to 917,000 satoshis from the 1,000,000 reserve plus stake, rewards, transition fees and refund. **Passing this counterexample test confirms a missing requirement, not independent allocations.**

A preliminary audit-only development run failed because the test builder kept `B(0)` as declared locktime for activation of period 1; the fixture was corrected to use `B(currentPeriod)`. BCHN's rejection was correct and no covenant change was needed.

Final command: `mise exec -- npm test`. Compilation and TypeScript checking passed. BCHN integration runner: **5 tests, 5 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo; total 207,268.144251 ms**.

| Integration test | Result | Runtime (ms) |
| --- | --- | ---: |
| Local BCHN funding / invalid spend / confirmation | PASS | 1278.754703 |
| Deadline counterexample / irrevocable period | PASS | 82396.611717 |
| New registry verification, including allocation counterexample | PASS | 13889.8217 |
| Existing complete 16-offer UTC registry | PASS | 87191.136103 |
| Original bounded vault | PASS | 6454.460482 |

Full compiler/test output: `docs/registry-verification-run.txt`. Detailed new verification evidence: `docs/registry-verification-result.json`. The existing registry's current run is in `docs/registry-test-result.json`; the 2026-11-06 counts below are historical, not this run. Negative tests use BCHN `testmempoolaccept` against unspent inputs; their rejection does not mean each candidate was also attempted inside a separately constructed invalid block. Positive audit transitions were broadcast; post-suite checks confirmed all 20 fixture transactions (17 transitions and 3 genesis transactions) are mined. The final chain reached height 733, and the original startup checkpoint at height 622 still has hash `7cdac7169c65d7bd44acbaf48a8fc0c7834f28a2fe842ce701f2f2448c123524`. The existing registry run recorded 44 accepted candidates and 24 expected rejections, in addition to the new audit case's 17 accepted and 29 rejected.

## Earlier UTC verification (2026-11-06)

On 2026-11-06, `npm test` passed compilation, type checking and all four BCHN integration tests (0 failures) in about 182 seconds. After adding the final reward-horizon withdrawal checks, type checking and the final registry-only test also passed (about 94 seconds including startup). The UTC registry evidence records 44 accepted candidates and 24 adversarial rejections, including fixed maturity after repeated wins and withdrawal after the finite reward horizon. Accepted state transitions were broadcast and mined.

Current sizes: covenant 1596 bytes, state witness 1702 bytes, activation 3537 bytes, settlement 3571 bytes. See `docs/registry-test-result.json` for transaction IDs, immutable epoch/period length and actual BCHN rejection messages.

## Historical results before the UTC amendment

The measurements below describe the superseded 49-byte height/CSV records. Current UTC results are in `docs/registry-test-result.json`; they must not be interpreted using the historical layout.


On 2026-11-06 the complete `npm test` suite passed compilation, type checking and all **4 integration tests (0 failures)** in about 102 seconds, including the original infrastructure and deadline-counterexample tests. A subsequent registry-only run also passed after adding explicit genesis-admission assertions and a CSV-valid but immature withdrawal rejected by BIP68.

The final registry is 1536 bytes; state witness is 1574 bytes; activation is 3349 bytes; settlement is 3383 bytes. The registry run recorded 42 accepted candidates and 21 adversarial rejections. Accepted canonical transitions were broadcast and their chain was mined; one independent duplicate candidate was checked but intentionally not broadcast until it conflicted. See the JSON for individual consensus error messages and transaction IDs.
